"""
Instagram 릴스 스크래핑 API — instagrapi 기반

instagram_scraper.py의 기능을 REST API로 제공한다.
서버 시작 시 한 번 로그인하고 세션을 유지한다.
"""
import os
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

IG_USERNAME = os.environ.get("IG_USERNAME", "")
IG_PASSWORD = os.environ.get("IG_PASSWORD", "")
SESSION_FILE = str(Path(__file__).parent.parent / "ig_session.json")

# 글로벌 클라이언트 (lazy init)
_client = None


class InstagramRequest(BaseModel):
    usernames: list[str]
    amount: int = 10


def _get_client():
    global _client
    if _client is not None:
        return _client

    if not IG_USERNAME or not IG_PASSWORD:
        raise HTTPException(
            status_code=503,
            detail="IG_USERNAME / IG_PASSWORD 환경변수가 설정되지 않았습니다.",
        )

    try:
        from instagrapi import Client
        from instagrapi.exceptions import LoginRequired

        cl = Client()
        session_path = Path(SESSION_FILE)

        if session_path.exists():
            cl.load_settings(SESSION_FILE)
            try:
                cl.login(IG_USERNAME, IG_PASSWORD)
            except LoginRequired:
                session_path.unlink(missing_ok=True)
                cl = Client()
                cl.login(IG_USERNAME, IG_PASSWORD)
                cl.dump_settings(SESSION_FILE)
        else:
            cl.login(IG_USERNAME, IG_PASSWORD)
            cl.dump_settings(SESSION_FILE)

        _client = cl
        return cl
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Instagram 로그인 실패: {str(e)}")


def _media_to_dict(media: Any, username: str) -> dict:
    return {
        "username": username,
        "media_pk": str(getattr(media, "pk", "") or ""),
        "code": getattr(media, "code", None),
        "caption_text": (getattr(media, "caption_text", "") or "")[:300],
        "taken_at": (getattr(media, "taken_at", None) or datetime.now(timezone.utc)).isoformat(),
        "like_count": int(getattr(media, "like_count", 0) or 0),
        "comment_count": int(getattr(media, "comment_count", 0) or 0),
        "view_count": int(getattr(media, "view_count", 0) or 0),
        "video_duration": float(getattr(media, "video_duration", 0) or 0),
        "thumbnail_url": str(getattr(media, "thumbnail_url", "") or ""),
        "url": (
            f"https://www.instagram.com/reel/{getattr(media, 'code', '')}/"
            if getattr(media, "code", None)
            else None
        ),
    }


@router.post("/reels")
async def fetch_reels(req: InstagramRequest):
    """Instagram 릴스를 수집한다. instagram_scraper.py의 fetch_user_reels()와 동일."""
    cl = _get_client()
    results = []

    for raw in req.usernames:
        username = raw.strip().lstrip("@")
        if not username:
            continue

        try:
            from instagrapi.exceptions import ClientError

            user_id = cl.user_id_from_username(username)
            time.sleep(random.uniform(1.5, 3.5))

            clips = cl.user_clips(user_id, amount=req.amount)
            reels = []

            for clip in clips:
                try:
                    detail = cl.media_info(clip.pk)
                    reels.append(_media_to_dict(detail, username))
                except ClientError:
                    reels.append(_media_to_dict(clip, username))
                time.sleep(random.uniform(1.0, 2.2))

            reels.sort(key=lambda r: r["taken_at"], reverse=True)

            count = len(reels)
            results.append({
                "username": username,
                "reelCount": count,
                "avgViews": round(sum(r["view_count"] for r in reels) / count) if count else 0,
                "avgLikes": round(sum(r["like_count"] for r in reels) / count) if count else 0,
                "avgComments": round(sum(r["comment_count"] for r in reels) / count) if count else 0,
                "scrapedAt": datetime.now(timezone.utc).isoformat(),
                "reels": reels,
            })

            time.sleep(random.uniform(2.0, 4.0))

        except Exception as e:
            results.append({
                "username": username,
                "reelCount": 0,
                "avgViews": 0,
                "avgLikes": 0,
                "avgComments": 0,
                "scrapedAt": datetime.now(timezone.utc).isoformat(),
                "reels": [],
                "error": str(e),
            })

    return results
