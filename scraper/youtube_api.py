"""
YouTube Data API v3 클라이언트 (Python/EXE 전용)

API 키 우선순위:
  1. config.py 내장값 (YOUTUBE_API_KEY) — EXE 빌드 시 내장
  2. tubemetric_keys.json 런타임 저장값
  3. 환경변수 YOUTUBE_API_KEY
"""
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

import requests

from shorts_detector import parse_duration_seconds, is_short

# ── 경로 ──────────────────────────────────────────────────────────────────────
if getattr(sys, 'frozen', False):
    _BASE = Path(sys.executable).parent
else:
    _BASE = Path(__file__).parent

_KEYS_FILE = _BASE / "tubemetric_keys.json"

BASE_URL = "https://www.googleapis.com/youtube/v3"


# ── API 키 로드 ───────────────────────────────────────────────────────────────
def _get_api_key() -> str:
    """config.py 내장값 → keys 파일 → 환경변수 순서로 API 키를 반환."""
    # 1순위: config.py 내장값 (EXE 빌드 시 내장)
    try:
        from config import YOUTUBE_API_KEY
        if YOUTUBE_API_KEY:
            return YOUTUBE_API_KEY
    except (ImportError, AttributeError):
        pass
    # 2순위: 런타임 keys 파일
    if _KEYS_FILE.exists():
        try:
            import json
            data = json.loads(_KEYS_FILE.read_text(encoding="utf-8"))
            if data.get("youtube_api_key"):
                return data["youtube_api_key"]
        except Exception:
            pass
    # 3순위: 환경변수
    import os
    return os.environ.get("YOUTUBE_API_KEY", "")


def _key() -> str:
    key = _get_api_key()
    if not key:
        raise RuntimeError(
            "YouTube API Key가 없습니다.\n"
            "config.py 의 YOUTUBE_API_KEY 에 키를 입력하고 EXE를 재빌드하세요."
        )
    return key


# ── 유틸 ──────────────────────────────────────────────────────────────────────
def extract_video_id(url_or_id: str) -> str:
    """URL 또는 영상 ID에서 11자리 videoId를 추출."""
    if len(url_or_id) == 11 and re.match(r'^[a-zA-Z0-9_-]{11}$', url_or_id):
        return url_or_id
    m = re.search(r'(?:v=|/shorts/|youtu\.be/)([a-zA-Z0-9_-]{11})', url_or_id)
    return m.group(1) if m else url_or_id


def _get(endpoint: str, params: dict) -> dict:
    params["key"] = _key()
    r = requests.get(f"{BASE_URL}/{endpoint}", params=params, timeout=20)
    r.raise_for_status()
    return r.json()


# ── 채널 정보 ─────────────────────────────────────────────────────────────────
def get_channel_info(input_str: str) -> dict:
    """채널 핸들/@handle/URL/UCxxx ID를 받아 채널 기본 정보를 반환."""
    s = input_str.strip()

    # URL에서 경로만 추출
    if "youtube.com/" in s or "youtu.be/" in s:
        try:
            from urllib.parse import urlparse
            parsed = urlparse(s if s.startswith("http") else "https://" + s)
            s = parsed.path + ("?" + parsed.query if parsed.query else "")
        except Exception:
            pass

    params: dict = {"part": "snippet,contentDetails,statistics"}
    id_match     = re.search(r'UC[a-zA-Z0-9_-]{22}', s)
    handle_match = re.search(r'@([^/?&\s]+)', s)

    if id_match:
        params["id"] = id_match.group(0)
    elif handle_match:
        params["forHandle"] = "@" + handle_match.group(1)
    else:
        # 검색으로 채널 찾기
        sr = _get("search", {"part": "snippet", "q": input_str, "type": "channel", "maxResults": 1})
        items = sr.get("items", [])
        if not items:
            raise ValueError(f"채널을 찾을 수 없습니다: {input_str}")
        params["id"] = items[0]["id"]["channelId"]

    data = _get("channels", params)
    items = data.get("items", [])
    if not items:
        raise ValueError(f"채널 정보 없음: {input_str}")

    ch = items[0]
    thumbs = ch["snippet"]["thumbnails"]
    return {
        "id":                ch["id"],
        "title":             ch["snippet"]["title"],
        "thumbnail":         (thumbs.get("high") or thumbs.get("default", {})).get("url", ""),
        "subscriberCount":   ch["statistics"].get("subscriberCount", 0),
        "uploadsPlaylistId": ch["contentDetails"]["relatedPlaylists"]["uploads"],
    }


# ── 채널 통계 수집 ────────────────────────────────────────────────────────────
def fetch_channel_stats(
    uploads_playlist_id: str,
    shorts_cfg: dict,
    longs_cfg: dict,
    progress_cb: Optional[Callable[[str], None]] = None,
) -> dict:
    """
    업로드 플레이리스트를 순회하며 쇼츠/롱폼/라이브를 분류하고 통계를 반환.

    cfg 키:
      enabled, target, period, useDateFilter, useCountFilter
    """
    def _cutoff(cfg: dict):
        if not cfg.get("useDateFilter") or cfg.get("period") == "all":
            return None
        days = {"7d": 7, "30d": 30, "90d": 90}.get(cfg.get("period", "all"), None)
        if days is None:
            return None
        from datetime import timedelta
        return datetime.utcnow() - timedelta(days=days)

    shorts_cutoff = _cutoff(shorts_cfg)
    longs_cutoff  = _cutoff(longs_cfg)

    shorts: list = []
    longs:  list = []
    lives:  list = []
    next_page: Optional[str] = None
    safety = 0

    while safety < 500:
        safety += 1

        shorts_done = (not shorts_cfg.get("enabled") or
                       (shorts_cfg.get("useCountFilter") and len(shorts) >= shorts_cfg.get("target", 30)))
        longs_done  = (not longs_cfg.get("enabled") or
                       (longs_cfg.get("useCountFilter") and len(longs) >= longs_cfg.get("target", 10)))
        if shorts_done and longs_done:
            break

        pl_params: dict = {"part": "contentDetails", "playlistId": uploads_playlist_id, "maxResults": 50}
        if next_page:
            pl_params["pageToken"] = next_page
        pl_data  = _get("playlistItems", pl_params)
        pl_items = pl_data.get("items", [])
        if not pl_items:
            break

        next_page = pl_data.get("nextPageToken")
        vid_ids   = [i["contentDetails"]["videoId"] for i in pl_items]

        vd = _get("videos", {
            "part": "snippet,contentDetails,statistics,liveStreamingDetails",
            "id":   ",".join(vid_ids),
        })

        oldest_pub = None
        for v in vd.get("items", []):
            pub_str = v["snippet"]["publishedAt"]
            pub_dt  = datetime.fromisoformat(pub_str.replace("Z", "+00:00")).replace(tzinfo=None)
            if oldest_pub is None or pub_dt < oldest_pub:
                oldest_pub = pub_dt

            duration_sec = parse_duration_seconds(v["contentDetails"]["duration"])
            is_short_v   = is_short(v["contentDetails"]["duration"])
            is_live      = bool(v.get("liveStreamingDetails"))

            info = {
                "id":          v["id"],
                "title":       v["snippet"]["title"],
                "thumbnail":   (v["snippet"]["thumbnails"].get("high") or
                                v["snippet"]["thumbnails"].get("default", {})).get("url", ""),
                "publishedAt": pub_str,
                "viewCount":   int(v["statistics"].get("viewCount", 0)),
                "duration":    v["contentDetails"]["duration"],
                "isShort":     is_short_v,
                "isLiveStream": is_live,
            }

            if is_live:
                if len(lives) < 10:
                    lives.append(info)
            elif is_short_v:
                if (shorts_cfg.get("enabled") and
                        (not shorts_cfg.get("useCountFilter") or len(shorts) < shorts_cfg.get("target", 30))):
                    if not shorts_cfg.get("useDateFilter") or shorts_cutoff is None or pub_dt >= shorts_cutoff:
                        shorts.append(info)
            else:
                if (longs_cfg.get("enabled") and
                        (not longs_cfg.get("useCountFilter") or len(longs) < longs_cfg.get("target", 10))):
                    if not longs_cfg.get("useDateFilter") or longs_cutoff is None or pub_dt >= longs_cutoff:
                        longs.append(info)

        if progress_cb:
            progress_cb(f"  수집 중... 쇼츠 {len(shorts)}개 / 롱폼 {len(longs)}개")

        # 날짜 기반 조기 종료
        if oldest_pub is not None:
            effective_cutoff = None
            if shorts_cfg.get("useDateFilter") and shorts_cutoff:
                effective_cutoff = shorts_cutoff
            if longs_cfg.get("useDateFilter") and longs_cutoff:
                if effective_cutoff is None or longs_cutoff < effective_cutoff:
                    effective_cutoff = longs_cutoff
            if effective_cutoff and oldest_pub < effective_cutoff:
                break

        if not next_page:
            break

    def _avg(lst):
        return round(sum(v["viewCount"] for v in lst) / len(lst)) if lst else 0

    return {
        "avgShortsViews": _avg(shorts),
        "shortsCount":    len(shorts),
        "avgLongViews":   _avg(longs),
        "longCount":      len(longs),
        "avgTotalViews":  _avg(shorts + longs),
        "totalCount":     len(shorts) + len(longs),
        "shortsList":     shorts,
        "longsList":      longs,
        "liveList":       lives,
    }


# ── 개별 영상 수집 ────────────────────────────────────────────────────────────
def fetch_videos_by_ids(video_ids: list[str]) -> list[dict]:
    """영상 ID 목록으로 상세 정보를 수집한다."""
    valid = [vid for vid in video_ids if len(vid) == 11]
    if not valid:
        return []

    data  = _get("videos", {"part": "snippet,contentDetails,statistics", "id": ",".join(valid)})
    results = []
    for v in data.get("items", []):
        results.append({
            "videoId":      v["id"],
            "title":        v["snippet"]["title"],
            "channelTitle": v["snippet"]["channelTitle"],
            "thumbnail":    (v["snippet"]["thumbnails"].get("high") or
                             v["snippet"]["thumbnails"].get("default", {})).get("url", ""),
            "viewCount":    int(v["statistics"].get("viewCount", 0)),
            "likeCount":    int(v["statistics"].get("likeCount", 0)),
            "commentCount": int(v["statistics"].get("commentCount", 0)),
            "duration":     v["contentDetails"]["duration"],
            "publishedAt":  v["snippet"]["publishedAt"],
            "isShort":      is_short(v["contentDetails"]["duration"]),
        })
    return results


# ── 광고 NLP 분석 ─────────────────────────────────────────────────────────────
_AD_WEIGHTS = {
    "high": ["유료 광고", "유료광고", "광고 포함", "paid promotion", "includes paid promotion",
             "sponsored by", "ad:", "광고입니다"],
    "mid":  ["협찬", "스폰", "sponsor", "sponsorship", "제공받아", "지원받아", "파트너십", "원고료", "제작비"],
    "low":  ["affiliate", "제휴 링크", "수수료", "커미션", "gifted", "#ad", "#sponsored", "#협찬", "#광고"],
    "neg":  ["광고 아님", "내돈내산", "not sponsored", "no sponsorship"],
}


def _detect_ad_nlp(video_id: str, title: str, description: str) -> dict:
    text = (title + " " + description).lower()
    score = 0
    matched = []
    for p in _AD_WEIGHTS["high"]:
        if p.lower() in text:
            score += 3; matched.append(p)
    for p in _AD_WEIGHTS["mid"]:
        if p.lower() in text:
            score += 2; matched.append(p)
    for p in _AD_WEIGHTS["low"]:
        if p.lower() in text:
            score += 1; matched.append(p)
    for p in _AD_WEIGHTS["neg"]:
        if p.lower() in text:
            score -= 2

    is_ad = score >= 3
    ad_type = "unknown"
    if is_ad:
        if "수수료" in text or "affiliate" in text:
            ad_type = "affiliate"
        elif "제공받아" in text:
            ad_type = "gifted"
        elif score >= 5:
            ad_type = "paid_promotion"
        else:
            ad_type = "sponsorship"

    evidence = []
    if is_ad:
        evidence.append(f"키워드 감지: {', '.join(matched[:3])}")
    else:
        evidence.append("광고 신호 없음")

    return {
        "is_ad":      is_ad,
        "confidence": 0.75 if is_ad else 0.55,
        "method":     "nlp",
        "evidence":   evidence,
        "score":      score,
        "ad_type":    ad_type,
    }


# ── 광고 영상 분석 ────────────────────────────────────────────────────────────
def analyze_ad_videos_api(
    uploads_playlist_id: str,
    start_date: datetime,
    end_date: datetime,
    progress_cb: Optional[Callable[[str], None]] = None,
) -> list[dict]:
    """업로드 플레이리스트를 순회하며 광고 영상을 NLP로 탐지한다."""
    ad_videos = []
    next_page: Optional[str] = None
    safety = 0

    while safety < 100:
        safety += 1
        pl_params: dict = {"part": "contentDetails", "playlistId": uploads_playlist_id, "maxResults": 50}
        if next_page:
            pl_params["pageToken"] = next_page
        pl_data  = _get("playlistItems", pl_params)
        pl_items = pl_data.get("items", [])
        if not pl_items:
            break

        next_page = pl_data.get("nextPageToken")
        vid_ids   = [i["contentDetails"]["videoId"] for i in pl_items]

        vd = _get("videos", {"part": "snippet,contentDetails,statistics", "id": ",".join(vid_ids)})
        early_stop = False
        for v in vd.get("items", []):
            pub_dt = datetime.fromisoformat(
                v["snippet"]["publishedAt"].replace("Z", "+00:00")
            ).replace(tzinfo=None)

            if pub_dt < start_date:
                early_stop = True
                break
            if pub_dt > end_date:
                continue

            det = _detect_ad_nlp(v["id"], v["snippet"]["title"], v["snippet"].get("description", ""))
            if det["is_ad"]:
                ad_videos.append({
                    "id":           v["id"],
                    "title":        v["snippet"]["title"],
                    "thumbnail":    (v["snippet"]["thumbnails"].get("high") or
                                     v["snippet"]["thumbnails"].get("default", {})).get("url", ""),
                    "publishedAt":  v["snippet"]["publishedAt"],
                    "viewCount":    int(v["statistics"].get("viewCount", 0)),
                    "likeCount":    int(v["statistics"].get("likeCount", 0)),
                    "commentCount": int(v["statistics"].get("commentCount", 0)),
                    "duration":     v["contentDetails"]["duration"],
                    "isShort":      is_short(v["contentDetails"]["duration"]),
                    "detection":    det,
                })

        if progress_cb:
            progress_cb(f"  광고 {len(ad_videos)}개 감지 중...")
        if early_stop or not next_page:
            break

    return ad_videos
