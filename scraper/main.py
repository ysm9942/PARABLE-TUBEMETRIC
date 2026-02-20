"""
PARABLE-TUBEMETRIC 로컬 스크래퍼 CLI
undetected-chromedriver로 YouTube를 스크래핑한 뒤
결과를 JSON으로 저장하고 GitHub에 push한다.
GitHub Actions가 이를 감지해 Firebase Firestore에 동기화한다.

사용법:
  python main.py channel @handle [--scrolls 10] [--push]
  python main.py video VIDEO_ID1 VIDEO_ID2 ... [--push]
  python main.py ad @handle --start 2024-01-01 --end 2024-03-31 [--push]
"""
import argparse
import sys
from datetime import datetime

from browser import create_driver
from channel_scraper import scrape_channel
from video_scraper import scrape_video
from ad_detector import analyze_video_for_ad
from uploader import save_result, push_to_github, save_and_push


# ──────────────────────────────────────────────
# 서브커맨드 핸들러
# ──────────────────────────────────────────────

def cmd_channel(args):
    driver = create_driver(headless=args.headless)
    try:
        for channel_input in args.channels:
            try:
                result = scrape_channel(driver, channel_input, max_scrolls=args.scrolls)
                channel_id = result["channelId"]
                if args.push:
                    save_and_push(result, "channels", channel_id)
                else:
                    save_result(result, "channels", channel_id)
            except Exception as e:
                print(f"[오류] {channel_input}: {e}", file=sys.stderr)
    finally:
        driver.quit()


def cmd_video(args):
    driver = create_driver(headless=args.headless)
    try:
        for vid_input in args.videos:
            try:
                result = scrape_video(driver, vid_input)
                video_id = result["videoId"]
                if args.push:
                    save_and_push(result, "videos", video_id)
                else:
                    save_result(result, "videos", video_id)
            except Exception as e:
                print(f"[오류] {vid_input}: {e}", file=sys.stderr)
    finally:
        driver.quit()


def cmd_ad(args):
    """채널 영상을 순회하며 광고 여부를 분석"""
    from channel_scraper import scrape_channel

    start_dt = datetime.fromisoformat(args.start)
    end_dt = datetime.fromisoformat(args.end)

    driver = create_driver(headless=args.headless)
    try:
        for channel_input in args.channels:
            try:
                # 1. 채널 영상 목록 수집
                print(f"[광고분석] 채널 수집: {channel_input}")
                channel_data = scrape_channel(driver, channel_input, max_scrolls=5)
                all_videos = channel_data.get("shortsList", []) + channel_data.get("longsList", [])

                # 2. 날짜 필터
                filtered = []
                for v in all_videos:
                    pub_str = v.get("publishedAt", "")
                    if pub_str:
                        try:
                            pub_dt = datetime.fromisoformat(pub_str.replace("Z", ""))
                            if start_dt <= pub_dt <= end_dt:
                                filtered.append(v)
                        except Exception:
                            filtered.append(v)
                    else:
                        filtered.append(v)

                print(f"  → 날짜 범위 내 영상: {len(filtered)}개")

                # 3. 각 영상 광고 분석
                ad_videos = []
                for v in filtered:
                    detection = analyze_video_for_ad(driver, v["id"])
                    if detection.get("is_ad"):
                        ad_videos.append({**v, "detection": detection})

                # 4. 결과 조합
                total_views = sum(v.get("viewCount", 0) for v in ad_videos)
                result = {
                    "channelId": channel_data["channelId"],
                    "channelName": channel_data["channelName"],
                    "thumbnail": channel_data["thumbnail"],
                    "adVideos": ad_videos,
                    "totalAdCount": len(ad_videos),
                    "totalViews": total_views,
                    "avgViews": round(total_views / len(ad_videos)) if ad_videos else 0,
                    "status": "completed",
                    "scrapedAt": datetime.utcnow().isoformat() + "Z",
                }

                if args.push:
                    save_and_push(result, "ads", channel_data["channelId"])
                else:
                    save_result(result, "ads", channel_data["channelId"])

            except Exception as e:
                print(f"[오류] {channel_input}: {e}", file=sys.stderr)
    finally:
        driver.quit()


# ──────────────────────────────────────────────
# CLI 파서
# ──────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python main.py",
        description="PARABLE-TUBEMETRIC 로컬 스크래퍼",
    )
    parser.add_argument("--headless", action="store_true", help="헤드리스 모드로 실행")
    parser.add_argument("--push", action="store_true", help="결과를 GitHub에 push")

    sub = parser.add_subparsers(dest="command", required=True)

    # channel 서브커맨드
    p_channel = sub.add_parser("channel", help="채널 분석")
    p_channel.add_argument("channels", nargs="+", help="채널 핸들 또는 URL (여러 개 가능)")
    p_channel.add_argument("--scrolls", type=int, default=10, help="스크롤 횟수 (기본: 10)")
    p_channel.set_defaults(func=cmd_channel)

    # video 서브커맨드
    p_video = sub.add_parser("video", help="개별 영상 분석")
    p_video.add_argument("videos", nargs="+", help="영상 ID 또는 URL (여러 개 가능)")
    p_video.set_defaults(func=cmd_video)

    # ad 서브커맨드
    p_ad = sub.add_parser("ad", help="채널 광고 영상 분석")
    p_ad.add_argument("channels", nargs="+", help="채널 핸들 또는 URL")
    p_ad.add_argument("--start", required=True, help="시작 날짜 (YYYY-MM-DD)")
    p_ad.add_argument("--end", required=True, help="종료 날짜 (YYYY-MM-DD)")
    p_ad.set_defaults(func=cmd_ad)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
