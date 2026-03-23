"""
Instagram 릴스 스크래핑 API — instagrapi 기반

[환경변수]
IG_USERNAME : Instagram 계정 아이디
IG_PASSWORD : Instagram 계정 비밀번호
"""
import asyncio
import os
import random
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()
_executor = ThreadPoolExecutor(max_workers=2)

IG_USERNAME = os.environ.get("IG_USERNAME", "").strip()
IG_PASSWORD = os.environ.get("IG_PASSWORD", "").strip()

SESSION_FILE = Path("/tmp/ig_session.json")

_client = None


def _get_client():
    """instagrapi 클라이언트를 싱글턴으로 반환. 세션 파일이 있으면 재사용."""
    global _client
    if _client is not None:
        return _client

    from instagrapi import Client
    from instagrapi.exceptions import LoginRequired

    cl = Client()
    cl.delay_range = [1, 3]

    if SESSION_FILE.exists():
        try:
            cl.load_settings(SESSION_FILE)
            cl.login(IG_USERNAME, IG_PASSWORD)
            cl.dump_settings(SESSION_FILE)
            _client = cl
            return _client
        except LoginRequired:
            SESSION_FILE.unlink(missing_ok=True)

    cl.login(IG_USERNAME, IG_PASSWORD)
    cl.dump_settings(SESSION_FILE)
    _client = cl
    return _client


class InstagramRequest(BaseModel):
    usernames: list[str]
    amount: int = 10


def _scrape_user(username: str, amount: int) -> dict:
    from instagrapi.exceptions import ClientError, UserNotFound

    reels: list[dict] = []
    error: str | None = None

    try:
        cl = _get_client()
        user_id = cl.user_id_from_username(username)
        # product_type="clips" 필터로 릴스만 가져옴
        medias = cl.user_clips(user_id, amount=amount)

        for m in medias:
            taken_at = m.taken_at
            if taken_at and taken_at.tzinfo is None:
                taken_at = taken_at.replace(tzinfo=timezone.utc)

            thumb = ""
            if m.thumbnail_url:
                thumb = str(m.thumbnail_url)

            reels.append({
                "username": username,
                "media_pk": str(m.pk),
                "code": m.code,
                "caption_text": (m.caption_text or "")[:300],
                "taken_at": taken_at.isoformat() if taken_at else datetime.now(timezone.utc).isoformat(),
                "like_count": int(m.like_count or 0),
                "comment_count": int(m.comment_count or 0),
                "view_count": int(m.view_count or 0),
                "video_duration": float(m.video_duration or 0),
                "thumbnail_url": thumb,
                "url": f"https://www.instagram.com/reel/{m.code}/",
            })

    except UserNotFound:
        error = f"유저를 찾을 수 없습니다: {username}"
    except ClientError as e:
        error = str(e)
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
    Instagram 릴스 수집 (instagrapi).
    IG_USERNAME / IG_PASSWORD 환경변수 필요.
    """
    if not IG_USERNAME or not IG_PASSWORD:
        raise HTTPException(
            status_code=503,
            detail=(
                "IG_USERNAME 또는 IG_PASSWORD 미설정 — "
                "백엔드 환경변수에 Instagram 계정 정보를 추가하세요."
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
