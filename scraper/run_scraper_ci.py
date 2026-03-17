"""
PARABLE-TUBEMETRIC GitHub Actions CI 스크래퍼

Selenium/Chrome 없이 YouTube Data API + instagrapi + yt-dlp 만으로 동작합니다.
GitHub Actions에서 results/queue/*.json 을 처리하고 결과를 저장합니다.

필요한 GitHub Secrets:
  YOUTUBE_API_KEY  : YouTube Data API v3 키 (필수)
  IG_USERNAME      : Instagram 아이디 (Instagram 분석 시 필요)
  IG_PASSWORD      : Instagram 비밀번호 (Instagram 분석 시 필요)
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

# scraper 디렉토리를 import 경로에 추가
SCRAPER_DIR = Path(__file__).parent
ROOT_DIR = SCRAPER_DIR.parent
sys.path.insert(0, str(SCRAPER_DIR))

# .env 로드 (로컬 테스트용)
try:
    from dotenv import load_dotenv
    _env = SCRAPER_DIR / ".env"
    if _env.exists():
        load_dotenv(dotenv_path=_env, override=False)
except ImportError:
    pass

QUEUE_DIR = ROOT_DIR / "results" / "queue"

# CI에서는 결과를 프로젝트 루트의 results/ 에 저장해야 함
# (uploader.py 기본값은 scraper/results/ 이므로 덮어쓰기)
import uploader
uploader.RESULTS_DIR = ROOT_DIR / "results"


def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S")


def log(msg: str) -> None:
    print(f"[{_ts()}] {msg}", flush=True)


# ── YouTube 채널 분석 ──────────────────────────────────────────────────────────

def process_channel(job: dict) -> None:
    import youtube_api
    from uploader import save_result

    handles = job.get("handles", [])
    opts = job.get("opts", {})

    # 수집 설정 (프론트에서 opts로 넘어온 값 또는 기본값)
    shorts_cfg: dict = {
        "enabled": True,
        "target": opts.get("shortsTarget", 30),
        "useDateFilter": bool(opts.get("start")),
        "useCountFilter": not bool(opts.get("start")),
        "period": opts.get("shortsPeriod", "all"),
    }
    longs_cfg: dict = {
        "enabled": True,
        "target": opts.get("longsTarget", 30),
        "useDateFilter": bool(opts.get("start")),
        "useCountFilter": not bool(opts.get("start")),
        "period": opts.get("longsPeriod", "all"),
    }

    for handle in handles:
        try:
            log(f"[YouTube] 채널 분석 시작: {handle}")
            ch = youtube_api.get_channel_info(handle)
            log(f"  → {ch['title']} (구독자 {ch['subscriberCount']:,})")

            stats = youtube_api.fetch_channel_stats(
                ch["uploadsPlaylistId"],
                shorts_cfg,
                longs_cfg,
                progress_cb=log,
            )

            result = {
                "channelId":       ch["id"],
                "channelName":     ch["title"],
                "thumbnail":       ch["thumbnail"],
                "subscriberCount": int(ch.get("subscriberCount", 0)),
                "shortsList":      stats["shortsList"],
                "longsList":       stats["longsList"],
                "liveList":        stats.get("liveList", []),
                "shortsCountFound": stats["shortsCount"],
                "longCountFound":  stats["longCount"],
                "totalCountFound": stats["totalCount"],
                "avgShortsViews":  stats["avgShortsViews"],
                "avgLongViews":    stats["avgLongViews"],
                "avgTotalViews":   stats["avgTotalViews"],
                "status":          "completed",
                "scrapedAt":       datetime.utcnow().isoformat() + "Z",
                "scrapedBy":       {"operator": "github-actions", "hostname": "github"},
            }

            save_result(result, "channels", ch["id"])
            log(f"[완료] {ch['title']}: Shorts {stats['shortsCount']}개, 롱폼 {stats['longCount']}개")

        except Exception as e:
            log(f"[오류] {handle}: {e}")


# ── YouTube 영상 분석 ──────────────────────────────────────────────────────────

def process_video(job: dict) -> None:
    import youtube_api
    from uploader import save_result

    handles = job.get("handles", [])
    try:
        videos = youtube_api.fetch_videos_by_ids(handles)
        for v in videos:
            save_result(v, "videos", v["videoId"])
            log(f"[완료] 영상: {v['title']}")
    except Exception as e:
        log(f"[오류] 영상 분석: {e}")


# ── YouTube 광고 분석 ──────────────────────────────────────────────────────────

def process_ad(job: dict) -> None:
    import youtube_api
    from uploader import save_result

    handles = job.get("handles", [])
    opts = job.get("opts", {})

    start_str = opts.get("start", "")
    end_str = opts.get("end", "")

    try:
        start_dt = datetime.fromisoformat(start_str) if start_str else datetime(2020, 1, 1)
        end_dt = datetime.fromisoformat(end_str) if end_str else datetime.utcnow()
    except ValueError:
        start_dt, end_dt = datetime(2020, 1, 1), datetime.utcnow()

    for handle in handles:
        try:
            log(f"[광고 분석] 채널: {handle}")
            ch = youtube_api.get_channel_info(handle)
            ad_videos = youtube_api.analyze_ad_videos_api(
                ch["uploadsPlaylistId"],
                start_dt,
                end_dt,
                progress_cb=log,
            )

            result = {
                "channelId":   ch["id"],
                "channelName": ch["title"],
                "adVideos":    ad_videos,
                "totalAdCount": len(ad_videos),
                "adTotalViews": sum(v.get("viewCount", 0) for v in ad_videos),
                "adAvgViews":  (
                    round(sum(v.get("viewCount", 0) for v in ad_videos) / len(ad_videos))
                    if ad_videos else 0
                ),
                "startDate":   start_str,
                "endDate":     end_str,
                "status":      "completed",
                "scrapedAt":   datetime.utcnow().isoformat() + "Z",
            }

            save_result(result, "ads", ch["id"])
            log(f"[완료] 광고 영상 {len(ad_videos)}개 감지")

        except Exception as e:
            log(f"[오류] {handle}: {e}")


# ── Instagram 분석 ────────────────────────────────────────────────────────────

def process_instagram(job: dict) -> None:
    ig_user = os.environ.get("IG_USERNAME", "")
    ig_pass = os.environ.get("IG_PASSWORD", "")

    if not ig_user or not ig_pass:
        log("[Instagram] IG_USERNAME / IG_PASSWORD 환경변수 미설정 — 건너뜀")
        log("  → GitHub Secrets에 IG_USERNAME, IG_PASSWORD를 추가하세요")
        return

    try:
        from instagram_scraper import run
        handles = job.get("handles", [])
        amount = job.get("opts", {}).get("amount", 10)
        log(f"[Instagram] {', '.join(handles)} — 릴스 {amount}개")
        run(handles, amount=amount, push=True)
    except Exception as e:
        log(f"[오류] Instagram: {e}")


# ── TikTok 분석 ───────────────────────────────────────────────────────────────

def process_tiktok(job: dict) -> None:
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        log("[TikTok] yt-dlp 미설치 — 건너뜀")
        return

    from uploader import save_result

    handles = job.get("handles", [])
    opts = job.get("opts", {})
    browser = opts.get("cookieBrowser")  # "chrome" | "edge" | "firefox" | None

    for handle in handles:
        username = handle.lstrip("@")
        url = f"https://www.tiktok.com/@{username}"
        log(f"[TikTok] 수집: @{username}")

        ydl_opts: dict = {
            "quiet": True,
            "extract_flat": True,
            "playlistend": opts.get("limit", 30),
        }
        if browser:
            ydl_opts["cookiesfrombrowser"] = (browser,)

        try:
            import yt_dlp
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)

            entries = (info or {}).get("entries", [])
            videos = []
            for e in entries:
                videos.append({
                    "id":          e.get("id", ""),
                    "title":       e.get("title", ""),
                    "url":         e.get("webpage_url", ""),
                    "viewCount":   e.get("view_count", 0),
                    "likeCount":   e.get("like_count", 0),
                    "commentCount": e.get("comment_count", 0),
                    "duration":    e.get("duration", 0),
                    "uploadDate":  e.get("upload_date", ""),
                    "thumbnail":   e.get("thumbnail", ""),
                })

            result = {
                "username":   username,
                "videoCount": len(videos),
                "videos":     videos,
                "avgViews":   round(sum(v["viewCount"] for v in videos) / len(videos)) if videos else 0,
                "status":     "completed",
                "scrapedAt":  datetime.utcnow().isoformat() + "Z",
            }
            save_result(result, "tiktok", username)
            log(f"[완료] @{username}: {len(videos)}개 영상")

        except Exception as e:
            log(f"[오류] @{username}: {e}")


# ── 메인 진입점 ───────────────────────────────────────────────────────────────

_HANDLERS = {
    "channel":   process_channel,
    "video":     process_video,
    "ad":        process_ad,
    "instagram": process_instagram,
    "tiktok":    process_tiktok,
}


def main() -> None:
    if not QUEUE_DIR.exists():
        log("[큐] 큐 디렉토리 없음 — 종료")
        return

    queue_files = sorted(QUEUE_DIR.glob("*.json"))
    if not queue_files:
        log("[큐] 처리할 작업 없음 — 종료")
        return

    log(f"[큐] {len(queue_files)}개 작업 처리 시작")

    for queue_file in queue_files:
        job_name = queue_file.stem
        try:
            job = json.loads(queue_file.read_text("utf-8"))
            job_type = job.get("type", "channel")
            handles = job.get("handles", [])

            log(f"[작업] {job_type} | {', '.join(handles)}")

            handler = _HANDLERS.get(job_type)
            if handler:
                handler(job)
            else:
                log(f"[경고] 알 수 없는 작업 유형: {job_type}")

        except Exception as e:
            log(f"[오류] {job_name}: {e}")

    log("[큐] 모든 작업 완료")


if __name__ == "__main__":
    main()
