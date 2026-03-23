"""
Instagram 릴스 스크래핑 API — instaloader 기반 (로그인 불필요)

GitHub ⭐11k+ / 최신 유지보수 2026-03-21 (v4.15.1)
https://github.com/instaloader/instaloader

공개 계정의 릴스를 로그인 없이 수집한다.
실패 시 curl_cffi fallback.
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


class InstagramRequest(BaseModel):
    usernames: list[str]
    amount: int = 10


# ---------------------------------------------------------------------------
# Primary: instaloader
# ---------------------------------------------------------------------------

def _scrape_user_reels_instaloader(username: str, amount: int) -> list[dict]:
    """instaloader로 공개 계정 릴스를 수집한다."""
    import instaloader

    L = instaloader.Instaloader(
        quiet=True,
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        post_metadata_txt_pattern="",
    )

    profile = instaloader.Profile.from_username(L.context, username)

    reels: list[dict] = []
    for post in profile.get_posts():
        if not post.is_video:
            continue

        code = post.shortcode or ""
        # video_play_count = 릴스 재생수 (view_count보다 정확)
        view_count = int(
            getattr(post, "video_play_count", None) or
            getattr(post, "video_view_count", None) or
            0
        )
        reels.append({
            "username": username,
            "media_pk": str(post.mediaid),
            "code": code,
            "caption_text": (post.caption or "")[:300],
            "taken_at": post.date_utc.isoformat(),
            "like_count": int(post.likes or 0),
            "comment_count": int(post.comments or 0),
            "view_count": view_count,
            "video_duration": float(getattr(post, "video_duration", 0) or 0),
            "thumbnail_url": post.url or "",
            "url": f"https://www.instagram.com/reel/{code}/" if code else None,
        })

        if len(reels) >= amount:
            break

        time.sleep(random.uniform(0.4, 1.0))

    return reels


# ---------------------------------------------------------------------------
# Fallback: curl_cffi → Instagram 내부 API
# ---------------------------------------------------------------------------

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


def _parse_media_curl(media: dict, username: str) -> dict:
    code = media.get("code") or media.get("shortcode") or ""
    cap_obj = media.get("caption")
    caption = (
        cap_obj.get("text", "") if isinstance(cap_obj, dict)
        else (cap_obj or "")
    )
    iv = media.get("image_versions2") or {}
    candidates = iv.get("candidates") or []
    thumb = candidates[0].get("url", "") if candidates else ""
    view_count = int(
        media.get("view_count") or media.get("play_count") or
        media.get("ig_play_count") or 0
    )
    taken_at = media.get("taken_at") or 0
    taken_at_iso = (
        datetime.fromtimestamp(taken_at, tz=timezone.utc).isoformat()
        if taken_at else datetime.now(timezone.utc).isoformat()
    )
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
    """curl_cffi + Instagram 내부 API fallback."""
    from curl_cffi import requests as cf

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

    reels: list[dict] = []
    max_id = ""
    while len(reels) < amount:
        resp = cf.post(
            "https://www.instagram.com/api/v1/clips/user/",
            headers={**_IG_HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
            data={
                "target_user_id": str(user_id),
                "page_size": str(min(12, amount - len(reels))),
                "max_id": max_id,
            },
            impersonate="chrome120",
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
        items = data.get("items") or []
        for item in items:
            reels.append(_parse_media_curl(item.get("media") or item, username))
        paging = data.get("paging_info") or {}
        if not paging.get("more_available") or not items:
            break
        max_id = str(paging.get("max_id") or "")
        time.sleep(random.uniform(0.5, 1.2))

    return reels[:amount]


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def _scrape_user(username: str, amount: int) -> dict:
    """instaloader → curl_cffi 순서로 시도한다."""
    reels: list[dict] = []
    error = None

    try:
        reels = _scrape_user_reels_instaloader(username, amount)
    except Exception as e1:
        try:
            reels = _scrape_user_reels_curl(username, amount)
        except Exception as e2:
            error = f"instaloader: {e1} | curl: {e2}"

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
    """Instagram 릴스를 수집한다. 로그인 불필요 — instaloader → curl_cffi 순서로 시도."""
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
