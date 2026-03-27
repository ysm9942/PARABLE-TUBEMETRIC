"""
TikTok 스크래핑 API — curl_cffi + yt-dlp 기반

1차: curl_cffi로 TikTok 웹 API 직접 호출 (브라우저 TLS 지문 우회)
2차: yt-dlp fallback
"""
import re
import json
import time
import urllib.parse
from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel

try:
    from curl_cffi import requests as cffi_requests
    HAS_CURL_CFFI = True
except ImportError:
    HAS_CURL_CFFI = False

try:
    import yt_dlp
    HAS_YT_DLP = True
except ImportError:
    HAS_YT_DLP = False

router = APIRouter()


class TikTokRequest(BaseModel):
    usernames: list[str]
    limit: int = 30


# ── 공통 헤더 ──────────────────────────────────────────────────────────────

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.tiktok.com/",
    "Origin": "https://www.tiktok.com",
}


# ── curl_cffi 기반 스크래퍼 ────────────────────────────────────────────────

def _get_sec_uid(username: str) -> str | None:
    """TikTok 프로필 페이지에서 secUid를 추출한다."""
    if not HAS_CURL_CFFI:
        return None
    try:
        url = f"https://www.tiktok.com/@{username}"
        r = cffi_requests.get(
            url,
            headers=_BROWSER_HEADERS,
            impersonate="chrome124",
            timeout=15,
        )
        # __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON에서 secUid 파싱
        m = re.search(r'"secUid"\s*:\s*"([^"]+)"', r.text)
        if m:
            return m.group(1)
        # 대안: userInfo 블록
        m2 = re.search(r'"secUid":"([^"]+)"', r.text)
        return m2.group(1) if m2 else None
    except Exception:
        return None


def _fetch_via_curl_cffi(username: str, limit: int) -> list[dict] | None:
    """curl_cffi로 TikTok 내부 API 호출, 영상 목록 반환."""
    if not HAS_CURL_CFFI:
        return None

    sec_uid = _get_sec_uid(username)
    if not sec_uid:
        return None

    videos: list[dict] = []
    cursor = 0

    while len(videos) < limit:
        count = min(30, limit - len(videos))
        params = {
            "aid": "1988",
            "count": str(count),
            "cursor": str(cursor),
            "secUid": sec_uid,
        }
        api_url = "https://www.tiktok.com/api/post/item_list/?" + urllib.parse.urlencode(params)

        try:
            r = cffi_requests.get(
                api_url,
                headers=_BROWSER_HEADERS,
                impersonate="chrome124",
                timeout=15,
            )
            data = r.json()
        except Exception:
            break

        items = data.get("itemList") or []
        for item in items:
            stats = item.get("stats", {})
            videos.append({
                "id": item.get("id", ""),
                "title": item.get("desc", ""),
                "url": f"https://www.tiktok.com/@{username}/video/{item.get('id', '')}",
                "viewCount": int(stats.get("playCount", 0) or 0),
                "likeCount": int(stats.get("diggCount", 0) or 0),
                "commentCount": int(stats.get("commentCount", 0) or 0),
                "duration": int((item.get("video") or {}).get("duration", 0) or 0),
                "uploadDate": _ts_to_date(item.get("createTime", 0)),
                "thumbnail": (item.get("video") or {}).get("cover", ""),
            })

        has_more = data.get("hasMore", False)
        cursor = data.get("cursor", 0)
        if not has_more or not items:
            break

    return videos if videos else None


# ── yt-dlp fallback ────────────────────────────────────────────────────────

def _fetch_via_ytdlp(username: str, limit: int) -> list[dict]:
    """yt-dlp로 TikTok 프로필 영상 수집 (fallback)."""
    if not HAS_YT_DLP:
        return []

    url = f"https://www.tiktok.com/@{username}"
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,   # 빠른 목록 추출
        "ignoreerrors": True,
        "skip_download": True,
        "playlistend": limit,
        "extractor_args": {"tiktok": {"webpage_download": ["1"]}},
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception:
        return []

    entries = (info or {}).get("entries") or []
    videos = []
    for e in (entries or []):
        if not e:
            continue
        videos.append({
            "id": str(e.get("id", "")),
            "title": e.get("title", ""),
            "url": e.get("url") or e.get("webpage_url", ""),
            "viewCount": int(e.get("view_count", 0) or 0),
            "likeCount": int(e.get("like_count", 0) or 0),
            "commentCount": int(e.get("comment_count", 0) or 0),
            "duration": int(e.get("duration", 0) or 0),
            "uploadDate": e.get("upload_date", ""),
            "thumbnail": e.get("thumbnail", ""),
        })
    return videos


# ── 유틸 ──────────────────────────────────────────────────────────────────

def _ts_to_date(ts) -> str:
    """Unix timestamp → 'YYYYMMDD' 문자열."""
    try:
        return datetime.utcfromtimestamp(int(ts)).strftime("%Y%m%d")
    except Exception:
        return ""


# ── 라우터 ────────────────────────────────────────────────────────────────

@router.post("/videos")
async def fetch_tiktok_videos(req: TikTokRequest):
    """TikTok 유저의 영상 목록을 수집한다."""
    results = []

    for raw in req.usernames:
        username = raw.strip().lstrip("@")
        if not username:
            continue

        videos = None

        # 1차: curl_cffi (TikTok 내부 API)
        try:
            videos = _fetch_via_curl_cffi(username, req.limit)
        except Exception:
            videos = None

        # 2차: yt-dlp fallback
        if not videos:
            try:
                videos = _fetch_via_ytdlp(username, req.limit)
            except Exception:
                videos = []

        videos = videos or []
        results.append({
            "username": username,
            "videoCount": len(videos),
            "videos": videos,
            "avgViews": round(sum(v["viewCount"] for v in videos) / len(videos)) if videos else 0,
            "status": "completed" if videos else "empty",
            "scrapedAt": datetime.utcnow().isoformat() + "Z",
        })

    return results
