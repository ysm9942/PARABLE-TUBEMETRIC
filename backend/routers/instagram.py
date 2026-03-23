"""
Instagram 릴스 스크래핑 API — curl_cffi + yt-dlp 기반 (로그인 불필요)

curl_cffi의 브라우저 TLS impersonation으로 Instagram 내부 API를 직접 호출한다.
실패 시 yt-dlp로 fallback. IG_USERNAME / IG_PASSWORD 환경변수 불필요.
공개 계정만 지원.
"""
import asyncio
import random
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()
_executor = ThreadPoolExecutor(max_workers=3)

_IG_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    ),
    "X-IG-App-ID": "936619743392459",
    "Accept": "*/*",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    "Referer": "https://www.instagram.com/",
    "Origin": "https://www.instagram.com",
}


class InstagramRequest(BaseModel):
    usernames: list[str]
    amount: int = 10


def _parse_media(media: dict, username: str) -> dict:
    code = media.get("code") or media.get("shortcode") or ""

    caption = ""
    cap_obj = media.get("caption")
    if isinstance(cap_obj, dict):
        caption = cap_obj.get("text", "")
    elif isinstance(cap_obj, str):
        caption = cap_obj

    thumb = ""
    iv = media.get("image_versions2") or {}
    candidates = iv.get("candidates") or []
    if candidates:
        thumb = candidates[0].get("url", "")

    view_count = int(
        media.get("view_count") or
        media.get("play_count") or
        media.get("ig_play_count") or
        0
    )

    taken_at = media.get("taken_at") or 0
    if isinstance(taken_at, (int, float)) and taken_at > 0:
        taken_at_iso = datetime.fromtimestamp(taken_at, tz=timezone.utc).isoformat()
    else:
        taken_at_iso = datetime.now(timezone.utc).isoformat()

    return {
        "username": username,
        "media_pk": str(media.get("id") or media.get("pk") or ""),
        "code": code,
        "caption_text": caption[:300],
        "taken_at": taken_at_iso,
        "like_count": int(media.get("like_count") or 0),
        "comment_count": int(media.get("comment_count") or 0),
        "view_count": view_count,
        "video_duration": float(media.get("video_duration") or 0),
        "thumbnail_url": thumb,
        "url": f"https://www.instagram.com/reel/{code}/" if code else None,
    }


def _scrape_user_reels_curl(username: str, amount: int) -> list[dict]:
    """curl_cffi로 Instagram 내부 API를 직접 호출해 릴스를 수집한다."""
    from curl_cffi import requests as cf

    # 1) user_id 조회
    resp = cf.get(
        f"https://i.instagram.com/api/v1/users/web_profile_info/?username={username}",
        headers=_IG_HEADERS,
        impersonate="chrome120",
        timeout=20,
    )
    resp.raise_for_status()
    user_data = (resp.json().get("data") or {}).get("user") or {}
    user_id = user_data.get("id") or user_data.get("pk")
    if not user_id:
        raise ValueError(f"사용자를 찾을 수 없습니다: @{username}")

    time.sleep(random.uniform(0.8, 1.5))

    # 2) 릴스 목록 페이지네이션
    reels: list[dict] = []
    max_id = ""

    while len(reels) < amount:
        page_size = min(12, amount - len(reels))
        resp = cf.post(
            "https://www.instagram.com/api/v1/clips/user/",
            headers={**_IG_HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
            data={
                "target_user_id": str(user_id),
                "page_size": str(page_size),
                "max_id": max_id,
            },
            impersonate="chrome120",
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()

        items = data.get("items") or []
        for item in items:
            media = item.get("media") or item
            reels.append(_parse_media(media, username))

        paging = data.get("paging_info") or {}
        if not paging.get("more_available") or not items:
            break
        max_id = str(paging.get("max_id") or "")
        time.sleep(random.uniform(0.5, 1.2))

    return reels[:amount]


def _scrape_user_reels_ytdlp(username: str, amount: int) -> list[dict]:
    """yt-dlp fallback으로 릴스를 수집한다."""
    import yt_dlp

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "ignoreerrors": True,
        "playlistend": amount,
    }

    reels: list[dict] = []
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(
            f"https://www.instagram.com/{username}/reels/",
            download=False,
        )

    if not info:
        return []

    entries = info.get("entries") if info.get("_type") == "playlist" else [info]
    for entry in (entries or [])[:amount]:
        if not entry:
            continue
        code = entry.get("id") or ""
        ts = entry.get("timestamp") or 0
        reels.append({
            "username": username,
            "media_pk": code,
            "code": code,
            "caption_text": (entry.get("description") or entry.get("title") or "")[:300],
            "taken_at": (
                datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
                if ts else datetime.now(timezone.utc).isoformat()
            ),
            "like_count": int(entry.get("like_count") or 0),
            "comment_count": int(entry.get("comment_count") or 0),
            "view_count": int(entry.get("view_count") or 0),
            "video_duration": float(entry.get("duration") or 0),
            "thumbnail_url": entry.get("thumbnail") or "",
            "url": (
                entry.get("webpage_url") or
                (f"https://www.instagram.com/reel/{code}/" if code else None)
            ),
        })

    return reels


def _scrape_user(username: str, amount: int) -> dict:
    """curl_cffi → yt-dlp 순서로 시도한다."""
    reels: list[dict] = []
    error = None

    try:
        reels = _scrape_user_reels_curl(username, amount)
    except Exception as e1:
        try:
            reels = _scrape_user_reels_ytdlp(username, amount)
        except Exception as e2:
            error = f"curl: {e1} | yt-dlp: {e2}"

    count = len(reels)
    result: dict = {
        "username": username,
        "reelCount": count,
        "avgViews": round(sum(r["view_count"] for r in reels) / count) if count else 0,
        "avgLikes": round(sum(r["like_count"] for r in reels) / count) if count else 0,
        "avgComments": round(sum(r["comment_count"] for r in reels) / count) if count else 0,
        "scrapedAt": datetime.now(timezone.utc).isoformat(),
        "reels": reels,
    }
    if error:
        result["error"] = error
    return result


@router.post("/reels")
async def fetch_reels(req: InstagramRequest):
    """Instagram 릴스를 수집한다. 로그인 불필요 — curl_cffi → yt-dlp 순서로 시도."""
    loop = asyncio.get_event_loop()
    results = []

    for raw in req.usernames:
        username = raw.strip().lstrip("@")
        if not username:
            continue

        result = await loop.run_in_executor(_executor, _scrape_user, username, req.amount)
        results.append(result)
        await asyncio.sleep(random.uniform(1.0, 2.5))

    return results
