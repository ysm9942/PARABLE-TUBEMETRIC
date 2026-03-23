"""
Instagram 릴스 스크래핑 API

[클라우드 서버 한계]
Instagram은 AWS/Render/Railway 등 데이터센터 IP를 IP 레벨에서 차단합니다.
IG_SESSION_ID 환경변수(브라우저 쿠키)가 설정된 경우 yt-dlp로 인증 요청을 시도합니다.
설정되지 않은 경우 로컬 스크래퍼를 사용하도록 안내합니다.

[환경변수]
IG_SESSION_ID : Instagram 브라우저 세션 쿠키 값
  브라우저 DevTools → Application → Cookies → instagram.com → sessionid 값
"""
import asyncio
import os
import random
import re
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()
_executor = ThreadPoolExecutor(max_workers=2)

IG_SESSION_ID = os.environ.get("IG_SESSION_ID", "").strip()


class InstagramRequest(BaseModel):
    usernames: list[str]
    amount: int = 10


# ---------------------------------------------------------------------------
# yt-dlp + session cookie
# ---------------------------------------------------------------------------

def _make_cookies_file(session_id: str) -> str:
    """yt-dlp용 Netscape 형식 쿠키 파일을 /tmp에 생성한다."""
    content = (
        "# Netscape HTTP Cookie File\n"
        f".instagram.com\tTRUE\t/\tTRUE\t2147483647\tsessionid\t{session_id}\n"
    )
    path = "/tmp/ig_cookies.txt"
    with open(path, "w") as f:
        f.write(content)
    return path


def _scrape_ytdlp(username: str, amount: int, cookies_file: str) -> list[dict]:
    """yt-dlp로 릴스 메타데이터를 수집한다."""
    import yt_dlp

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "ignoreerrors": True,
        "playlistend": amount,
        "cookiefile": cookies_file,
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            ),
        },
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(
            f"https://www.instagram.com/{username}/reels/",
            download=False,
        )

    if not info:
        return []

    entries = info.get("entries") if info.get("_type") == "playlist" else [info]
    reels: list[dict] = []

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
    reels: list[dict] = []
    error: str | None = None

    cookies_file = _make_cookies_file(IG_SESSION_ID)
    try:
        reels = _scrape_ytdlp(username, amount, cookies_file)
    except Exception as e:
        error = str(e)

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
    """
    Instagram 릴스 수집.
    IG_SESSION_ID 환경변수 필요 (브라우저 sessionid 쿠키 값).
    미설정 시 503 반환 → 프론트엔드가 로컬 스크래퍼로 자동 폴백.
    """
    if not IG_SESSION_ID:
        raise HTTPException(
            status_code=503,
            detail=(
                "IG_SESSION_ID 미설정 — 로컬 스크래퍼를 사용합니다. "
                "클라우드에서 직접 수집하려면 백엔드 환경변수에 "
                "IG_SESSION_ID (Instagram sessionid 쿠키)를 추가하세요."
            ),
        )

    loop = asyncio.get_event_loop()
    results = []

    for raw in req.usernames:
        v = raw.strip()
        url_match = re.search(r"instagram\.com/([^/?#\s]+)", v)
        if url_match:
            v = url_match.group(1)
        username = v.lstrip("@").rstrip("/")
        if not username:
            continue

        result = await loop.run_in_executor(_executor, _scrape_user, username, req.amount)
        results.append(result)
        await asyncio.sleep(random.uniform(1.5, 3.0))

    return results
