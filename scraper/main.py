"""
PARABLE-TUBEMETRIC 로컬 스크래퍼 CLI
undetected-chromedriver로 YouTube를 스크래핑한 뒤
결과를 JSON으로 저장하고 GitHub에 push한다.
GitHub Actions가 이를 감지해 Firebase Firestore에 동기화한다.

사용법:
  python main.py channel @handle [--scrolls 10] [--ad] [--start 2024-01-01] [--end 2024-03-31] [--push]
  python main.py video VIDEO_ID1 VIDEO_ID2 ... [--push]
"""
import argparse
import sys
from datetime import datetime

from browser import create_driver
from channel_scraper import scrape_channel
from video_scraper import scrape_video
from ad_detector import analyze_video_for_ad
from uploader import save_result, save_and_push


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

                # 날짜 필터 (--start/--end 지정 시 shortsList/longsList 모두 필터링)
                if args.start and args.end:
                    start_dt = datetime.fromisoformat(args.start)
                    end_dt = datetime.fromisoformat(args.end)

                    def _date_filter(videos):
                        out = []
                        for v in videos:
                            pub_str = v.get("publishedAt", "")
                            if pub_str:
                                try:
                                    pub_dt = datetime.fromisoformat(pub_str.replace("Z", ""))
                                    if start_dt <= pub_dt <= end_dt:
                                        out.append(v)
                                except Exception:
                                    out.append(v)
                            else:
                                out.append(v)
                        return out

                    result["shortsList"] = _date_filter(result.get("shortsList", []))
                    result["longsList"] = _date_filter(result.get("longsList", []))
                    result["liveList"] = _date_filter(result.get("liveList", []))
                    print(f"  → 날짜 필터 적용: Shorts {len(result['shortsList'])}개, 롱폼 {len(result['longsList'])}개")

                if args.ad:
                    all_videos = result.get("shortsList", []) + result.get("longsList", [])
                    print(f"  → 광고 분석 대상: {len(all_videos)}개")

                    ad_videos = []
                    for v in all_videos:
                        detection = analyze_video_for_ad(driver, v["id"])
                        v["detection"] = detection
                        if detection.get("is_ad"):
                            ad_videos.append(v)

                    ad_total_views = sum(v.get("viewCount", 0) for v in ad_videos)
                    result["adVideos"] = ad_videos
                    result["totalAdCount"] = len(ad_videos)
                    result["adTotalViews"] = ad_total_views
                    result["adAvgViews"] = round(ad_total_views / len(ad_videos)) if ad_videos else 0

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
    p_channel = sub.add_parser("channel", help="채널 분석 (--ad 옵션으로 광고 영상 분석 포함)")
    p_channel.add_argument("channels", nargs="+", help="채널 핸들 또는 URL (여러 개 가능)")
    p_channel.add_argument("--scrolls", type=int, default=10, help="스크롤 횟수 (기본: 10)")
    p_channel.add_argument("--ad", action="store_true", help="각 영상 광고 여부 분석")
    p_channel.add_argument("--start", default=None, help="광고 분석 날짜 필터 시작 (YYYY-MM-DD)")
    p_channel.add_argument("--end", default=None, help="광고 분석 날짜 필터 종료 (YYYY-MM-DD)")
    p_channel.set_defaults(func=cmd_channel)

    # video 서브커맨드
    p_video = sub.add_parser("video", help="개별 영상 분석")
    p_video.add_argument("videos", nargs="+", help="영상 ID 또는 URL (여러 개 가능)")
    p_video.set_defaults(func=cmd_video)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
