"""
YouTube 스크래핑 API — yt-dlp 기반 (undetected_chromedriver 대체)

yt-dlp는 브라우저 없이 YouTube 페이지의 모든 메타데이터를 추출할 수 있다.
ytInitialData, ytInitialPlayerResponse 등을 HTTP 요청으로 직접 파싱하므로
undetected_chromedriver와 동일한 데이터를 훨씬 빠르게 얻을 수 있다.

주요 이점:
- Chrome 설치 불필요
- 봇 탐지 우회 내장 (쿠키, 헤더 자동 관리)
- 서버리스 환경에서 실행 가능
- undetected_chromedriver보다 10배 이상 빠름
"""
import os
import re
from datetime import datetime
from typing import Optional

import yt_dlp
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter()

YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "")


# ── Pydantic 모델 ─────────────────────────────────────────────────────────────

class ChannelRequest(BaseModel):
    handle: str
    shorts_target: int = 30
    longs_target: int = 10
    use_date_filter: bool = False
    period: str = "all"  # "7d", "30d", "90d", "all"


class VideoRequest(BaseModel):
    video_ids: list[str]


class AdRequest(BaseModel):
    handle: str
    start_date: str = ""  # ISO format
    end_date: str = ""


# ── yt-dlp 헬퍼 ──────────────────────────────────────────────────────────────

def _ydl_opts(quiet: bool = True) -> dict:
    """yt-dlp 기본 옵션 (다운로드 없이 메타데이터만 추출)"""
    return {
        "quiet": quiet,
        "no_warnings": True,
        "extract_flat": False,
        "skip_download": True,
        "ignoreerrors": True,
        # 봇 탐지 우회를 위한 설정
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        },
    }


def _parse_duration_seconds(duration) -> int:
    """yt-dlp의 duration (초 단위 float/int) 또는 ISO8601을 int로 변환"""
    if isinstance(duration, (int, float)):
        return int(duration)
    if isinstance(duration, str):
        m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration)
        if m:
            return int(m[1] or 0) * 3600 + int(m[2] or 0) * 60 + int(m[3] or 0)
        parts = duration.split(":")
        try:
            parts = [int(p) for p in parts]
            if len(parts) == 2:
                return parts[0] * 60 + parts[1]
            if len(parts) == 3:
                return parts[0] * 3600 + parts[1] * 60 + parts[2]
        except ValueError:
            pass
    return 0


def _format_duration(seconds: int) -> str:
    """초를 'M:SS' 또는 'H:MM:SS' 형식으로 변환"""
    if seconds <= 0:
        return "0:00"
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def _is_short(duration_sec: int) -> bool:
    return 0 < duration_sec <= 180


# ── 채널 분석 (yt-dlp) ───────────────────────────────────────────────────────

def _resolve_channel_url(handle: str) -> str:
    inp = handle.strip()
    if re.match(r"UC[a-zA-Z0-9_-]{22}", inp):
        return f"https://www.youtube.com/channel/{inp}/videos"
    if inp.startswith("@"):
        return f"https://www.youtube.com/{inp}/videos"
    if "youtube.com" in inp:
        if "/videos" not in inp:
            inp = inp.rstrip("/") + "/videos"
        return inp
    return f"https://www.youtube.com/@{inp}/videos"


@router.post("/channel")
async def scrape_channel(req: ChannelRequest):
    """
    yt-dlp로 채널의 영상 목록을 추출한다.
    undetected_chromedriver의 scrape_channel()과 동일한 결과를 반환.
    """
    url = _resolve_channel_url(req.handle)

    # yt-dlp로 채널 탭(영상 목록) 추출
    opts = _ydl_opts()
    opts["playlistend"] = max(req.shorts_target, req.longs_target) * 3  # 충분히 수집

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"채널 스크래핑 실패: {str(e)}")

    if not info:
        raise HTTPException(status_code=404, detail="채널 정보를 찾을 수 없습니다.")

    # 채널 기본 정보
    channel_id = info.get("channel_id") or info.get("uploader_id") or ""
    channel_name = info.get("channel") or info.get("uploader") or req.handle
    thumbnail = info.get("channel_url", "")

    # 구독자 수 (yt-dlp가 제공하는 경우)
    subscriber_count = str(info.get("channel_follower_count", 0) or 0)

    # 영상 목록 파싱
    entries = info.get("entries") or []
    shorts = []
    longs = []
    lives = []

    # 날짜 필터 계산
    cutoff = None
    if req.use_date_filter and req.period != "all":
        days = {"7d": 7, "30d": 30, "90d": 90}.get(req.period, 0)
        if days > 0:
            from datetime import timedelta
            cutoff = datetime.utcnow() - timedelta(days=days)

    for entry in entries:
        if not entry:
            continue

        video_id = entry.get("id") or entry.get("url", "").split("v=")[-1][:11]
        if not video_id or len(video_id) != 11:
            continue

        duration_sec = _parse_duration_seconds(entry.get("duration", 0))
        upload_date = entry.get("upload_date", "")  # YYYYMMDD
        published_at = ""
        if upload_date and len(upload_date) == 8:
            published_at = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:8]}T00:00:00Z"

        # 날짜 필터
        if cutoff and published_at:
            try:
                pub_dt = datetime.fromisoformat(published_at.replace("Z", "+00:00")).replace(tzinfo=None)
                if pub_dt < cutoff:
                    continue
            except ValueError:
                pass

        is_live = bool(entry.get("is_live") or entry.get("was_live"))
        is_short = _is_short(duration_sec)

        video_info = {
            "id": video_id,
            "title": entry.get("title", ""),
            "thumbnail": entry.get("thumbnail") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            "publishedAt": published_at,
            "viewCount": int(entry.get("view_count", 0) or 0),
            "duration": _format_duration(duration_sec),
            "isShort": is_short,
            "isLiveStream": is_live,
        }

        if is_live:
            if len(lives) < 10:
                lives.append(video_info)
        elif is_short:
            if len(shorts) < req.shorts_target:
                shorts.append(video_info)
        else:
            if len(longs) < req.longs_target:
                longs.append(video_info)

    def avg_views(lst):
        return round(sum(v["viewCount"] for v in lst) / len(lst)) if lst else 0

    all_non_live = shorts + longs
    return {
        "channelId": channel_id,
        "channelName": channel_name,
        "thumbnail": thumbnail,
        "subscriberCount": subscriber_count,
        "shortsList": shorts,
        "longsList": longs,
        "liveList": lives,
        "shortsCountFound": len(shorts),
        "longCountFound": len(longs),
        "totalCountFound": len(all_non_live),
        "avgShortsViews": avg_views(shorts),
        "avgLongViews": avg_views(longs),
        "avgTotalViews": avg_views(all_non_live),
        "status": "completed",
        "scrapedAt": datetime.utcnow().isoformat() + "Z",
    }


# ── 개별 영상 분석 (yt-dlp) ──────────────────────────────────────────────────

@router.post("/videos")
async def scrape_videos(req: VideoRequest):
    """
    yt-dlp로 개별 영상의 상세 정보를 추출한다.
    video_scraper.py의 scrape_video()와 동일한 결과를 반환.
    """
    results = []
    opts = _ydl_opts()

    for vid in req.video_ids:
        # 영상 ID 정리
        m = re.search(r"(?:v=|/shorts/|youtu\.be/)([A-Za-z0-9_-]{11})", vid)
        video_id = m.group(1) if m else (vid.strip() if len(vid.strip()) == 11 else None)

        if not video_id:
            results.append({"videoId": vid, "status": "error", "error": "영상 ID를 인식할 수 없습니다."})
            continue

        url = f"https://www.youtube.com/watch?v={video_id}"
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)

            if not info:
                results.append({"videoId": video_id, "status": "error", "error": "영상 정보를 가져올 수 없습니다."})
                continue

            duration_sec = _parse_duration_seconds(info.get("duration", 0))

            # 댓글 추출 (yt-dlp가 제공하는 경우)
            comments = []
            for c in (info.get("comments") or [])[:6]:
                comments.append({
                    "author": c.get("author", ""),
                    "text": c.get("text", ""),
                    "likeCount": int(c.get("like_count", 0) or 0),
                    "publishedAt": c.get("timestamp", ""),
                })

            upload_date = info.get("upload_date", "")
            published_at = ""
            if upload_date and len(upload_date) == 8:
                published_at = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:8]}T00:00:00Z"

            results.append({
                "videoId": video_id,
                "title": info.get("title", f"(영상 {video_id})"),
                "channelTitle": info.get("channel") or info.get("uploader", ""),
                "thumbnail": info.get("thumbnail") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                "viewCount": int(info.get("view_count", 0) or 0),
                "likeCount": int(info.get("like_count", 0) or 0),
                "commentCount": int(info.get("comment_count", 0) or 0),
                "topComments": comments,
                "duration": _format_duration(duration_sec),
                "isShort": _is_short(duration_sec),
                "publishedAt": published_at,
                "status": "completed",
                "scrapedAt": datetime.utcnow().isoformat() + "Z",
            })
        except Exception as e:
            results.append({"videoId": video_id, "status": "error", "error": str(e)})

    return results


# ── 광고 감지 (yt-dlp 메타데이터 + NLP) ──────────────────────────────────────

# NLP 키워드 가중치 (ad_detector.py에서 포팅)
_AD_WEIGHTS = {
    "high": [
        "유료 광고", "유료광고", "광고 포함", "paid promotion",
        "includes paid promotion", "sponsored by", "ad:", "광고입니다",
    ],
    "mid": [
        "협찬", "스폰", "sponsor", "sponsorship",
        "제공받아", "지원받아", "파트너십", "원고료", "제작비",
    ],
    "low": [
        "affiliate", "제휴 링크", "수수료", "커미션",
        "gifted", "PR", "#ad", "#sponsored", "#협찬", "#광고",
    ],
    "negative": ["광고 아님", "내돈내산", "not sponsored", "no sponsorship"],
}

_WEIGHT_VALUES = {"high": 3, "mid": 2, "low": 1, "negative": -2}


def _detect_nlp(video_id: str, title: str, description: str) -> dict:
    """NLP 텍스트 분석으로 광고 감지"""
    text = (title + " " + description).lower()
    text = re.sub(r"https?://\S+", "<URL>", text)
    text = re.sub(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", "<CONTACT>", text)

    score = 0
    matched = []

    for level, phrases in _AD_WEIGHTS.items():
        for phrase in phrases:
            if phrase.lower() in text:
                score += _WEIGHT_VALUES[level]
                matched.append({"phrase": phrase, "weight": level, "source": "text"})

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

    confidence = 0.75 if is_ad else 0.55
    reasoning = (
        f"텍스트 분석 결과 '{matched[0]['phrase']}' 등 강한 광고 신호가 포착되었습니다."
        if is_ad and matched
        else "광고를 암시하는 키워드가 발견되지 않았습니다."
    )

    return {
        "video_id": video_id,
        "ad_disclosure": is_ad,
        "ad_type": ad_type,
        "confidence": confidence,
        "matched_phrases": matched[:5],
        "reasoning": reasoning,
    }


def _detect_paid_flag_from_metadata(info: dict) -> dict:
    """
    yt-dlp가 추출한 메타데이터에서 paidPromotion 플래그를 탐색.
    undetected_chromedriver로 ytInitialPlayerResponse를 파싱하던 것과 동일한 효과.

    yt-dlp는 내부적으로 YouTube 페이지의 JSON을 파싱하므로
    paidPromotion 관련 필드가 있으면 추출할 수 있다.
    """
    paid_promotion = "unknown"
    evidence = []

    # yt-dlp가 'license' 필드에 paid content 정보를 넣거나,
    # 또는 원본 JSON (info.get("_raw")) 에서 찾을 수 있다.
    # formats 등의 메타데이터에서 paid 관련 키를 검색
    info_str = str(info)

    ad_keys = ["paidPromotion", "isPaidPromotion", "paidProductPlacement", "productPlacement"]
    for key in ad_keys:
        pattern = rf'["\']?{key}["\']?\s*[:=]\s*(true|True|1)'
        if re.search(pattern, info_str):
            paid_promotion = True
            evidence.append({
                "source": "yt-dlp metadata",
                "key": key,
                "value": "true",
                "note": "Paid promotion flag detected via yt-dlp",
            })
            break

    if paid_promotion == "unknown":
        for key in ad_keys:
            pattern = rf'["\']?{key}["\']?\s*[:=]\s*(false|False|0)'
            if re.search(pattern, info_str):
                paid_promotion = False
                break

    confidence = 0.8 if paid_promotion is True else (0.6 if paid_promotion is False else 0.2)

    return {
        "paid_promotion": paid_promotion,
        "confidence": confidence,
        "evidence": evidence[:3],
    }


def _combine_ad_results(paid_flag: dict, nlp: dict) -> dict:
    """paid_flag + NLP 결과를 결합해 최종 광고 판정"""
    is_paid = paid_flag["paid_promotion"] is True
    is_nlp = nlp["ad_disclosure"] is True

    if is_paid and is_nlp:
        is_ad, method = True, "both"
    elif is_paid:
        is_ad, method = True, "paid_flag"
    elif is_nlp:
        is_ad, method = True, "nlp"
    else:
        is_ad, method = False, "none"

    if is_ad:
        final_conf = (
            max(paid_flag["confidence"], nlp["confidence"])
            if method == "both"
            else (paid_flag["confidence"] if is_paid else nlp["confidence"])
        )
    else:
        final_conf = min(0.6, (paid_flag["confidence"] + nlp["confidence"]) / 2)

    evidence = []
    if is_paid:
        evidence.append("시스템 플래그 감지 (Paid Promotion)")
    if is_nlp and nlp["matched_phrases"]:
        evidence.append(f"설명란 키워드 감지 ({nlp['matched_phrases'][0]['phrase']})")
    if not is_ad:
        evidence.append("광고 신호 없음/불충분")

    return {
        "is_ad": is_ad,
        "confidence": round(final_conf, 3),
        "method": method,
        "evidence": evidence[:2],
        "score": (5 if is_paid else 0) + (3 if is_nlp else 0),
        "paid_flag": paid_flag,
        "nlp": nlp,
    }


@router.post("/ad-detect")
async def detect_ads(req: AdRequest):
    """
    yt-dlp로 채널의 영상을 순회하며 광고 영상을 탐지한다.
    ad_detector.py의 analyze_video_for_ad()와 동일한 결과를 반환하되,
    브라우저 없이 yt-dlp 메타데이터 + NLP 분석으로 처리한다.
    """
    url = _resolve_channel_url(req.handle)

    opts = _ydl_opts()
    opts["playlistend"] = 200  # 최대 200개 영상 검사

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"채널 스크래핑 실패: {str(e)}")

    if not info:
        raise HTTPException(status_code=404, detail="채널 정보를 찾을 수 없습니다.")

    channel_id = info.get("channel_id") or info.get("uploader_id") or ""
    channel_name = info.get("channel") or info.get("uploader") or req.handle

    # 날짜 필터
    start_dt = None
    end_dt = None
    try:
        if req.start_date:
            start_dt = datetime.fromisoformat(req.start_date)
        if req.end_date:
            end_dt = datetime.fromisoformat(req.end_date)
    except ValueError:
        pass

    entries = info.get("entries") or []
    ad_videos = []

    for entry in entries:
        if not entry:
            continue

        video_id = entry.get("id") or ""
        if len(video_id) != 11:
            continue

        # 날짜 필터
        upload_date = entry.get("upload_date", "")
        if upload_date and len(upload_date) == 8:
            published_at = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:8]}T00:00:00Z"
            try:
                pub_dt = datetime.fromisoformat(published_at.replace("Z", "+00:00")).replace(tzinfo=None)
                if start_dt and pub_dt < start_dt:
                    continue
                if end_dt and pub_dt > end_dt:
                    continue
            except ValueError:
                pass
        else:
            published_at = ""

        title = entry.get("title", "")
        description = entry.get("description", "")

        # 광고 감지
        paid_flag = _detect_paid_flag_from_metadata(entry)
        nlp = _detect_nlp(video_id, title, description)
        combined = _combine_ad_results(paid_flag, nlp)

        if combined["is_ad"]:
            duration_sec = _parse_duration_seconds(entry.get("duration", 0))
            ad_videos.append({
                "id": video_id,
                "title": title,
                "thumbnail": entry.get("thumbnail") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                "publishedAt": published_at,
                "viewCount": int(entry.get("view_count", 0) or 0),
                "likeCount": int(entry.get("like_count", 0) or 0),
                "commentCount": int(entry.get("comment_count", 0) or 0),
                "duration": _format_duration(duration_sec),
                "isShort": _is_short(duration_sec),
                "detection": combined,
            })

    return {
        "channelId": channel_id,
        "channelName": channel_name,
        "adVideos": ad_videos,
        "totalAdCount": len(ad_videos),
        "adTotalViews": sum(v.get("viewCount", 0) for v in ad_videos),
        "adAvgViews": (
            round(sum(v.get("viewCount", 0) for v in ad_videos) / len(ad_videos))
            if ad_videos else 0
        ),
        "startDate": req.start_date,
        "endDate": req.end_date,
        "status": "completed",
        "scrapedAt": datetime.utcnow().isoformat() + "Z",
    }


# ── 단일 영상 광고 감지 ──────────────────────────────────────────────────────

@router.get("/ad-detect/{video_id}")
async def detect_ad_single(video_id: str):
    """
    단일 영상의 광고 여부를 분석한다.
    EXE의 analyze_video_for_ad()를 yt-dlp로 대체.
    """
    url = f"https://www.youtube.com/watch?v={video_id}"
    opts = _ydl_opts()

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"영상 분석 실패: {str(e)}")

    if not info:
        raise HTTPException(status_code=404, detail="영상 정보를 찾을 수 없습니다.")

    paid_flag = _detect_paid_flag_from_metadata(info)
    nlp = _detect_nlp(
        video_id,
        info.get("title", ""),
        info.get("description", ""),
    )
    return _combine_ad_results(paid_flag, nlp)
