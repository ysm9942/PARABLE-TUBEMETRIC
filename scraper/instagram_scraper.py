"""
PARABLE-TUBEMETRIC Instagram 릴스 스크래퍼 — instaloader 기반

로컬 PC(가정용 IP)에서 실행하면 로그인 없이 공개 계정 릴스를 수집합니다.
클라우드 서버에서는 Instagram이 데이터센터 IP를 차단하므로 로컬 실행을 권장합니다.

사용법:
  python instagram_scraper.py @user1 @user2 --amount 10 --push
  python instagram_scraper.py user1 user2 --amount 20

환경 변수 (선택):
  IG_SESSION_ID : Instagram 브라우저 세션 쿠키 (가져오는 법: 브라우저 DevTools
                  → Application → Cookies → instagram.com → sessionid 값)
                  설정하면 수집 안정성이 높아집니다.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ── 경로 설정 ──────────────────────────────────────────────────────────────────
SCRAPER_DIR = Path(__file__).parent

try:
    from dotenv import load_dotenv
    _env = SCRAPER_DIR / ".env"
    if _env.exists():
        load_dotenv(dotenv_path=_env, override=False)
except ImportError:
    pass

IG_SESSION_ID = os.environ.get("IG_SESSION_ID", "").strip()


# ── 유틸 ──────────────────────────────────────────────────────────────────────

def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S")

def log(msg: str) -> None:
    print(f"[{_ts()}] {msg}", flush=True)

def human_sleep(a: float = 1.0, b: float = 2.5) -> None:
    time.sleep(random.uniform(a, b))

def _clean_username(raw: str) -> str:
    v = raw.strip()
    m = re.search(r"instagram\.com/([^/?#\s]+)", v)
    if m:
        v = m.group(1)
    return v.lstrip("@").rstrip("/")


# ── instaloader 초기화 ────────────────────────────────────────────────────────

def _build_loader():
    import instaloader

    L = instaloader.Instaloader(
        quiet=True,
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        post_metadata_txt_pattern="",
        max_connection_attempts=3,
    )

    if IG_SESSION_ID:
        log("[Instagram] IG_SESSION_ID 쿠키 적용 중...")
        L.context._session.cookies.set(
            "sessionid", IG_SESSION_ID, domain=".instagram.com"
        )

    return L


# ── 데이터 수집 ───────────────────────────────────────────────────────────────

def _post_to_dict(post, username: str) -> dict:
    code = post.shortcode or ""
    view_count = int(
        getattr(post, "video_play_count", None) or
        getattr(post, "video_view_count", None) or
        0
    )
    return {
        "username":       username,
        "media_pk":       str(post.mediaid),
        "code":           code,
        "caption_text":   (post.caption or "")[:300],
        "taken_at":       post.date_utc.isoformat(),
        "like_count":     int(post.likes or 0),
        "comment_count":  int(post.comments or 0),
        "view_count":     view_count,
        "video_duration": float(getattr(post, "video_duration", 0) or 0),
        "thumbnail_url":  post.url or "",
        "url":            f"https://www.instagram.com/reel/{code}/" if code else None,
    }


def fetch_user_reels(L, username: str, amount: int) -> dict:
    """단일 유저의 릴스를 수집하고 요약 dict를 반환한다."""
    import instaloader

    log(f"[수집] @{username} 시작 (최대 {amount}개)")

    try:
        profile = instaloader.Profile.from_username(L.context, username)
    except instaloader.exceptions.ProfileNotExistsException:
        raise RuntimeError(f"존재하지 않는 계정입니다: @{username}")
    except instaloader.exceptions.LoginRequiredException:
        raise RuntimeError(
            f"@{username} 계정이 비공개이거나 로그인이 필요합니다. "
            "IG_SESSION_ID 환경변수를 설정하세요."
        )

    reels: list[dict] = []

    for post in profile.get_posts():
        if not post.is_video:
            continue
        reels.append(_post_to_dict(post, username))
        log(f"  [{len(reels)}/{amount}] {post.shortcode} — 재생 {reels[-1]['view_count']:,}")
        if len(reels) >= amount:
            break
        human_sleep(0.8, 1.8)

    count = len(reels)
    avg_views    = round(sum(r["view_count"]    for r in reels) / count) if count else 0
    avg_likes    = round(sum(r["like_count"]    for r in reels) / count) if count else 0
    avg_comments = round(sum(r["comment_count"] for r in reels) / count) if count else 0

    log(f"[완료] @{username}: {count}개 릴스, 평균 조회수 {avg_views:,}")
    return {
        "username":    username,
        "reelCount":   count,
        "avgViews":    avg_views,
        "avgLikes":    avg_likes,
        "avgComments": avg_comments,
        "scrapedAt":   datetime.now(timezone.utc).isoformat(),
        "reels":       reels,
    }


# ── 메인 실행 ─────────────────────────────────────────────────────────────────

def run(usernames: list[str], amount: int = 10, push: bool = False) -> list[dict]:
    L = _build_loader()
    results: list[dict] = []

    for raw in usernames:
        username = _clean_username(raw)
        if not username:
            continue
        try:
            data = fetch_user_reels(L, username, amount)
            results.append(data)

            if push:
                from uploader import save_and_push
                save_and_push(data, "instagram", username)

            human_sleep(2.0, 4.0)

        except Exception as e:
            log(f"[오류] @{username}: {e}")
            results.append({
                "username":    username,
                "reelCount":   0,
                "avgViews":    0,
                "avgLikes":    0,
                "avgComments": 0,
                "scrapedAt":   datetime.now(timezone.utc).isoformat(),
                "reels":       [],
                "error":       str(e),
            })
            if push:
                from uploader import save_and_push
                save_and_push(results[-1], "instagram", username)

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Instagram 릴스 스크래퍼 (로컬 PC 실행 권장)"
    )
    parser.add_argument("usernames", nargs="+", help="@핸들 또는 유저명")
    parser.add_argument("--amount", type=int, default=10, help="유저당 수집할 릴스 수")
    parser.add_argument("--push", action="store_true", help="결과를 GitHub에 push")
    args = parser.parse_args()

    results = run(args.usernames, amount=args.amount, push=args.push)

    print("\n── 수집 결과 요약 ──────────────────────────────────")
    for r in results:
        if r.get("error"):
            print(f"  @{r['username']}: 오류 — {r['error']}")
        else:
            print(f"  @{r['username']}: 릴스 {r['reelCount']}개, 평균 조회수 {r['avgViews']:,}")
    print()


if __name__ == "__main__":
    main()
