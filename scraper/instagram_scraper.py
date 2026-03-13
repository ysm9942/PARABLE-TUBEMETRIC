"""
PARABLE-TUBEMETRIC Instagram 릴스 스크래퍼

instagrapi를 사용해 Instagram 계정의 최근 릴스 지표를 수집하고
uploader.py를 통해 GitHub에 결과를 push합니다.

사용법:
  python instagram_scraper.py @user1 @user2 --amount 10 --push
  python instagram_scraper.py user1 user2 --amount 20

환경 변수 (scraper/.env 또는 시스템 환경변수):
  IG_USERNAME  : Instagram 로그인 아이디
  IG_PASSWORD  : Instagram 로그인 비밀번호

세션 파일:
  scraper/ig_session.json  (자동 생성/갱신)
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ── 경로 설정 ──────────────────────────────────────────────────────────────────
SCRAPER_DIR = Path(__file__).parent

# .env 로드 (환경변수가 이미 설정된 경우 덮어쓰지 않음)
try:
    from dotenv import load_dotenv
    _env = SCRAPER_DIR / ".env"
    if _env.exists():
        load_dotenv(dotenv_path=_env, override=False)
except ImportError:
    pass

IG_USERNAME   = os.environ.get("IG_USERNAME", "")
IG_PASSWORD   = os.environ.get("IG_PASSWORD", "")
SESSION_FILE  = str(SCRAPER_DIR / "ig_session.json")


# ── 유틸 ──────────────────────────────────────────────────────────────────────

def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S")

def log(msg: str) -> None:
    print(f"[{_ts()}] {msg}", flush=True)

def human_sleep(a: float = 1.5, b: float = 3.5) -> None:
    time.sleep(random.uniform(a, b))


# ── 로그인 ────────────────────────────────────────────────────────────────────

def _build_client():
    from instagrapi import Client
    return Client()

def _login(username: str, password: str):
    from instagrapi import Client
    from instagrapi.exceptions import LoginRequired, ChallengeRequired, PleaseWaitFewMinutes

    session_path = Path(SESSION_FILE)
    cl = _build_client()

    try:
        if session_path.exists():
            log("[Instagram] 기존 세션 파일 로드 중...")
            cl.load_settings(SESSION_FILE)
            cl.login(username, password)
        else:
            log("[Instagram] 신규 로그인 중...")
            cl.login(username, password)
            cl.dump_settings(SESSION_FILE)
            log(f"[Instagram] 세션 저장: {SESSION_FILE}")
        return cl
    except LoginRequired:
        log("[Instagram] 세션 만료 → 재로그인...")
        session_path.unlink(missing_ok=True)
        cl = _build_client()
        cl.login(username, password)
        cl.dump_settings(SESSION_FILE)
        return cl
    except ChallengeRequired as e:
        raise RuntimeError(
            "Instagram 챌린지 인증이 필요합니다. "
            "Instagram 앱/웹에서 직접 로그인 후 세션 파일을 다시 생성하세요."
        ) from e
    except PleaseWaitFewMinutes as e:
        raise RuntimeError(
            "Instagram이 일시적으로 요청을 제한했습니다. 잠시 후 다시 시도하세요."
        ) from e


# ── 데이터 수집 ───────────────────────────────────────────────────────────────

def _media_to_dict(media: Any, username: str) -> dict:
    return {
        "username":       username,
        "media_pk":       str(getattr(media, "pk", "") or ""),
        "code":           getattr(media, "code", None),
        "caption_text":   (getattr(media, "caption_text", "") or "")[:300],
        "taken_at":       (getattr(media, "taken_at", None) or datetime.now(timezone.utc)).isoformat(),
        "like_count":     int(getattr(media, "like_count", 0) or 0),
        "comment_count":  int(getattr(media, "comment_count", 0) or 0),
        "view_count":     int(getattr(media, "view_count", 0) or 0),
        "video_duration": float(getattr(media, "video_duration", 0) or 0),
        "thumbnail_url":  str(getattr(media, "thumbnail_url", "") or ""),
        "url":            f"https://www.instagram.com/reel/{getattr(media, 'code', '')}/"
                          if getattr(media, "code", None) else None,
    }


def fetch_user_reels(cl, username: str, amount: int) -> dict:
    """단일 유저의 릴스를 수집하고 요약 dict 반환"""
    from instagrapi.exceptions import ClientError

    log(f"[수집] @{username} 시작 (최대 {amount}개)")

    user_id = cl.user_id_from_username(username)
    human_sleep()

    clips = cl.user_clips(user_id, amount=amount)
    reels: list[dict] = []

    for clip in clips:
        try:
            detail = cl.media_info(clip.pk)
            reels.append(_media_to_dict(detail, username))
            human_sleep(1.0, 2.2)
        except ClientError:
            reels.append(_media_to_dict(clip, username))
            human_sleep(1.0, 2.2)

    reels.sort(key=lambda r: r["taken_at"], reverse=True)

    # 요약 통계
    count     = len(reels)
    avg_views    = round(sum(r["view_count"]    for r in reels) / count) if count else 0
    avg_likes    = round(sum(r["like_count"]    for r in reels) / count) if count else 0
    avg_comments = round(sum(r["comment_count"] for r in reels) / count) if count else 0

    scraped_at = datetime.now(timezone.utc).isoformat()

    result = {
        "username":    username,
        "reelCount":   count,
        "avgViews":    avg_views,
        "avgLikes":    avg_likes,
        "avgComments": avg_comments,
        "scrapedAt":   scraped_at,
        "reels":       reels,
    }

    log(f"[완료] @{username}: {count}개 릴스, 평균 조회수 {avg_views:,}")
    return result


# ── 메인 실행 ─────────────────────────────────────────────────────────────────

def run(usernames: list[str], amount: int = 10, push: bool = False) -> list[dict]:
    if not IG_USERNAME or not IG_PASSWORD:
        sys.exit(
            "[오류] IG_USERNAME, IG_PASSWORD 환경변수를 설정하세요.\n"
            "  scraper/.env 파일에 추가하거나 시스템 환경변수로 설정하세요."
        )

    cl = _login(IG_USERNAME, IG_PASSWORD)
    results: list[dict] = []

    for raw in usernames:
        username = raw.strip().lstrip("@")
        if not username:
            continue
        try:
            data = fetch_user_reels(cl, username, amount)
            results.append(data)

            if push:
                from uploader import save_and_push
                save_and_push(data, "instagram", username)

            human_sleep(2.0, 4.0)
        except Exception as e:
            log(f"[오류] @{username}: {e}")
            results.append({
                "username":  username,
                "reelCount": 0,
                "avgViews":  0,
                "avgLikes":  0,
                "avgComments": 0,
                "scrapedAt": datetime.now(timezone.utc).isoformat(),
                "reels":     [],
                "error":     str(e),
            })
            if push:
                from uploader import save_and_push
                save_and_push(results[-1], "instagram", username)

    return results


def main():
    parser = argparse.ArgumentParser(description="Instagram 릴스 스크래퍼")
    parser.add_argument("usernames", nargs="+", help="@핸들 또는 유저명 (공백으로 구분)")
    parser.add_argument("--amount", type=int, default=10, help="유저당 수집할 릴스 수 (기본값: 10)")
    parser.add_argument("--push", action="store_true", help="결과를 GitHub에 push")
    args = parser.parse_args()

    results = run(args.usernames, amount=args.amount, push=args.push)

    # 결과 요약 출력
    print("\n── 수집 결과 요약 ──────────────────────────────────")
    for r in results:
        status = f"오류: {r.get('error', '')}" if r.get("error") else f"릴스 {r['reelCount']}개, 평균 조회수 {r['avgViews']:,}"
        print(f"  @{r['username']}: {status}")
    print()


if __name__ == "__main__":
    main()
