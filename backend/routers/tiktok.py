"""
TikTok 스크래핑 API — yt-dlp 기반

run_scraper_ci.py의 process_tiktok()을 REST API로 제공한다.
"""
import os
from datetime import datetime

import yt_dlp
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class TikTokRequest(BaseModel):
    usernames: list[str]
    limit: int = 30


@router.post("/videos")
async def fetch_tiktok_videos(req: TikTokRequest):
    """TikTok 유저의 영상 목록을 수집한다."""
    results = []

    for raw in req.usernames:
        username = raw.strip().lstrip("@")
        if not username:
            continue

        url = f"https://www.tiktok.com/@{username}"

        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": False,
            "ignoreerrors": True,
            "skip_download": True,
            "playlistend": req.limit,
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)

            entries = (info or {}).get("entries", [])
            videos = []
            for e in entries:
                if not e:
                    continue
                videos.append({
                    "id": e.get("id", ""),
                    "title": e.get("title", ""),
                    "url": e.get("webpage_url", ""),
                    "viewCount": int(e.get("view_count", 0) or 0),
                    "likeCount": int(e.get("like_count", 0) or 0),
                    "commentCount": int(e.get("comment_count", 0) or 0),
                    "duration": int(e.get("duration", 0) or 0),
                    "uploadDate": e.get("upload_date", ""),
                    "thumbnail": e.get("thumbnail", ""),
                })

            results.append({
                "username": username,
                "videoCount": len(videos),
                "videos": videos,
                "avgViews": round(sum(v["viewCount"] for v in videos) / len(videos)) if videos else 0,
                "status": "completed",
                "scrapedAt": datetime.utcnow().isoformat() + "Z",
            })

        except Exception as e:
            results.append({
                "username": username,
                "videoCount": 0,
                "videos": [],
                "avgViews": 0,
                "status": "error",
                "error": str(e),
                "scrapedAt": datetime.utcnow().isoformat() + "Z",
            })

    return results
