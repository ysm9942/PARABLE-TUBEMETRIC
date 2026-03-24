"""
PARABLE-TUBEMETRIC Instagram 릴스 스크래퍼 — undetected_chromedriver 기반

로컬 PC(가정용 IP)에서 실제 Chrome 브라우저를 열어 Instagram 릴스 탭을 크롤링합니다.
fetch/XHR 인터셉터로 Instagram 내부 API 응답을 캡처합니다.

사용법:
  python instagram_scraper.py @user1 @user2 --amount 10 --push
  python instagram_scraper.py user1 user2 --amount 20

환경 변수 (선택):
  IG_USERNAME : Instagram 로그인 아이디 (설정하면 비공개 계정도 수집 가능)
  IG_PASSWORD : Instagram 로그인 비밀번호
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# ── 경로 설정 ──────────────────────────────────────────────────────────────────
SCRAPER_DIR = Path(__file__).parent

try:
    from dotenv import load_dotenv
    _env = SCRAPER_DIR / ".env"
    if _env.exists():
        load_dotenv(dotenv_path=_env, override=False)
except ImportError:
    pass

IG_USERNAME = os.environ.get("IG_USERNAME", "").strip()
IG_PASSWORD = os.environ.get("IG_PASSWORD", "").strip()


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


# ── Chrome 버전 감지 ──────────────────────────────────────────────────────────

def _get_chrome_ver() -> Optional[int]:
    if sys.platform.startswith("win"):
        cmds = [
            r'reg query "HKEY_CURRENT_USER\Software\Google\Chrome\BLBeacon" /v version',
            r'reg query "HKEY_LOCAL_MACHINE\Software\Google\Chrome\BLBeacon" /v version',
            r'reg query "HKEY_LOCAL_MACHINE\Software\WOW6432Node\Google\Chrome\BLBeacon" /v version',
        ]
        for cmd in cmds:
            try:
                out = subprocess.check_output(cmd, shell=True, text=True, encoding="utf-8", errors="ignore")
                m = re.search(r"(\d+)\.\d+\.\d+\.\d+", out)
                if m:
                    return int(m.group(1))
            except Exception:
                continue
    else:
        for binary in ("google-chrome", "google-chrome-stable", "chromium-browser", "chromium"):
            try:
                out = subprocess.check_output([binary, "--version"], text=True, stderr=subprocess.DEVNULL)
                m = re.search(r"(\d+)\.\d+", out)
                if m:
                    return int(m.group(1))
            except Exception:
                continue
    return None


# ── JS 인터셉터 (fetch + XHR) ─────────────────────────────────────────────────

_INTERCEPT_JS = """
(function() {
    if (window._igInterceptorInstalled) return;
    window._igInterceptorInstalled = true;
    window._igCaptures = [];

    // fetch 인터셉터
    const _origFetch = window.fetch;
    window.fetch = async function(...args) {
        const resp = await _origFetch(...args);
        try {
            const url = (typeof args[0] === 'string') ? args[0] : (args[0].url || '');
            if (url.includes('clips/user') || url.includes('reels_media') ||
                url.includes('graphql/query') || url.includes('api/v1/clips')) {
                const clone = resp.clone();
                clone.json().then(data => {
                    window._igCaptures.push({url: url, data: data});
                }).catch(() => {});
            }
        } catch(e) {}
        return resp;
    };

    // XHR 인터셉터
    const _origOpen = XMLHttpRequest.prototype.open;
    const _origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._igUrl = url;
        return _origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', function() {
            try {
                const url = this._igUrl || '';
                if (url.includes('clips/user') || url.includes('reels_media') ||
                    url.includes('graphql/query') || url.includes('api/v1/clips')) {
                    const data = JSON.parse(this.responseText);
                    window._igCaptures.push({url: url, data: data});
                }
            } catch(e) {}
        });
        return _origSend.call(this, ...args);
    };
})();
"""


# ── 파싱 ──────────────────────────────────────────────────────────────────────

def _parse_media(media: dict, username: str) -> dict:
    """Instagram media dict → 표준 reel dict"""
    code = media.get("code") or media.get("shortcode") or ""
    cap = media.get("caption") or {}
    caption_text = (cap.get("text") or "") if isinstance(cap, dict) else str(cap or "")

    taken_at = media.get("taken_at", 0)
    if isinstance(taken_at, (int, float)) and taken_at > 0:
        taken_at_iso = datetime.fromtimestamp(taken_at, tz=timezone.utc).isoformat()
    else:
        taken_at_iso = ""

    thumbnails = (media.get("image_versions2") or {}).get("candidates") or []
    thumbnail_url = thumbnails[0].get("url", "") if thumbnails else ""

    return {
        "username":       username,
        "media_pk":       str(media.get("pk") or media.get("id") or ""),
        "code":           code,
        "caption_text":   caption_text[:300],
        "taken_at":       taken_at_iso,
        "like_count":     int(media.get("like_count") or 0),
        "comment_count":  int(media.get("comment_count") or 0),
        "view_count":     int(media.get("play_count") or media.get("view_count") or 0),
        "video_duration": float(media.get("video_duration") or 0),
        "thumbnail_url":  thumbnail_url,
        "url":            f"https://www.instagram.com/reel/{code}/" if code else "",
    }


def _extract_reels_from_captures(captures: list, username: str) -> list[dict]:
    """캡처된 API 응답들에서 릴스 목록을 추출"""
    reels: list[dict] = []
    seen: set[str] = set()

    for cap in captures:
        data = cap.get("data") or {}

        # ── clips/user API 형식 ──────────────────────────────────────────────
        items = data.get("items") or []
        for item in items:
            media = item.get("media") or item
            code = media.get("code") or media.get("shortcode") or str(media.get("pk") or "")
            if code and code not in seen:
                seen.add(code)
                reels.append(_parse_media(media, username))

        # ── GraphQL xdt_api__v1__clips 형식 ─────────────────────────────────
        gql_data = (data.get("data") or {})
        for key, val in gql_data.items():
            if not isinstance(val, dict):
                continue
            edges = val.get("edges") or []
            for edge in edges:
                node = edge.get("node") or {}
                media = node.get("media") or node
                code = media.get("code") or media.get("shortcode") or str(media.get("pk") or "")
                if code and code not in seen:
                    seen.add(code)
                    reels.append(_parse_media(media, username))

    return reels


# ── 드라이버 빌드 ──────────────────────────────────────────────────────────────

def _build_driver():
    import undetected_chromedriver as uc

    chrome_major = _get_chrome_ver()
    log(f"[Chrome] 버전: {chrome_major or '자동감지'}")

    opts = uc.ChromeOptions()
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--start-maximized")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    # headless=False — Instagram은 headless 감지 시 접근 차단

    driver = (
        uc.Chrome(options=opts, version_main=chrome_major)
        if chrome_major
        else uc.Chrome(options=opts)
    )
    driver.implicitly_wait(5)
    return driver


# ── 로그인 (선택) ──────────────────────────────────────────────────────────────

def _try_login(driver) -> bool:
    """IG_USERNAME / IG_PASSWORD 환경변수가 있으면 로그인 시도"""
    if not (IG_USERNAME and IG_PASSWORD):
        return False

    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    log("[로그인] Instagram 로그인 시도...")
    driver.get("https://www.instagram.com/accounts/login/")
    human_sleep(2.5, 4.0)

    try:
        wait = WebDriverWait(driver, 15)
        user_field = wait.until(EC.presence_of_element_located((By.NAME, "username")))
        user_field.clear()
        user_field.send_keys(IG_USERNAME)
        human_sleep(0.5, 1.0)

        pw_field = driver.find_element(By.NAME, "password")
        pw_field.clear()
        pw_field.send_keys(IG_PASSWORD)
        human_sleep(0.5, 1.0)

        pw_field.submit()
        human_sleep(3.0, 5.0)
        log("[로그인] 완료")
        return True
    except Exception as e:
        log(f"[로그인] 실패: {e}")
        return False


# ── 릴스 수집 ──────────────────────────────────────────────────────────────────

def _dismiss_modal(driver) -> None:
    """로그인 유도 팝업 닫기"""
    from selenium.webdriver.common.by import By

    selectors = [
        "svg[aria-label='닫기']",
        "svg[aria-label='Close']",
        "button[aria-label='닫기']",
        "button[aria-label='Close']",
        "div[role='dialog'] button",
    ]
    for sel in selectors:
        try:
            btns = driver.find_elements(By.CSS_SELECTOR, sel)
            if btns:
                driver.execute_script("arguments[0].click();", btns[0])
                human_sleep(0.5, 1.0)
                log("[팝업] 로그인 모달 닫기 완료")
                return
        except Exception:
            continue


def fetch_user_reels(driver, username: str, amount: int) -> dict:
    """단일 유저의 릴스 탭을 크롤링하고 요약 dict를 반환한다."""
    from selenium.webdriver.common.by import By

    log(f"[수집] @{username} 시작 (최대 {amount}개)")

    # 인터셉터 주입 후 릴스 탭 이동
    driver.execute_script(_INTERCEPT_JS)
    driver.get(f"https://www.instagram.com/{username}/reels/")
    human_sleep(3.0, 5.0)

    # 인터셉터가 새 페이지에서 다시 주입돼야 하므로 재실행
    driver.execute_script(_INTERCEPT_JS)
    human_sleep(1.0, 2.0)

    # 로그인 모달 닫기
    _dismiss_modal(driver)

    # 스크롤하며 데이터 로딩
    scroll_count = max(3, (amount // 6) + 2)
    for i in range(scroll_count):
        driver.execute_script("window.scrollBy(0, window.innerHeight * 2);")
        human_sleep(1.5, 2.5)

        captures = driver.execute_script("return window._igCaptures || [];")
        reels = _extract_reels_from_captures(captures, username)
        log(f"  [스크롤 {i+1}/{scroll_count}] 캡처된 릴스: {len(reels)}개")
        if len(reels) >= amount:
            break

    captures = driver.execute_script("return window._igCaptures || [];")
    reels = _extract_reels_from_captures(captures, username)

    # API 응답이 없으면 DOM 파싱 fallback
    if not reels:
        log("[fallback] API 응답 없음 — DOM에서 shortcode 추출 시도")
        reels = _dom_fallback(driver, username, amount)

    reels = reels[:amount]
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


def _dom_fallback(driver, username: str, amount: int) -> list[dict]:
    """API 인터셉트 실패 시 DOM href에서 shortcode만 추출"""
    from selenium.webdriver.common.by import By

    links = driver.find_elements(By.CSS_SELECTOR, "a[href*='/reel/']")
    reels = []
    seen: set[str] = set()
    for link in links:
        href = link.get_attribute("href") or ""
        m = re.search(r"/reel/([A-Za-z0-9_-]+)", href)
        if m:
            code = m.group(1)
            if code not in seen:
                seen.add(code)
                reels.append({
                    "username":       username,
                    "media_pk":       "",
                    "code":           code,
                    "caption_text":   "",
                    "taken_at":       "",
                    "like_count":     0,
                    "comment_count":  0,
                    "view_count":     0,
                    "video_duration": 0.0,
                    "thumbnail_url":  "",
                    "url":            f"https://www.instagram.com/reel/{code}/",
                })
        if len(reels) >= amount:
            break
    log(f"[fallback] DOM에서 {len(reels)}개 shortcode 추출")
    return reels


# ── 메인 실행 ─────────────────────────────────────────────────────────────────

def run(usernames: list[str], amount: int = 10, push: bool = False) -> list[dict]:
    driver = None
    results: list[dict] = []

    try:
        driver = _build_driver()

        # 로그인 (env 설정된 경우)
        if IG_USERNAME and IG_PASSWORD:
            _try_login(driver)
            human_sleep(2.0, 3.0)

        for raw in usernames:
            username = _clean_username(raw)
            if not username:
                continue
            try:
                data = fetch_user_reels(driver, username, amount)
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

    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Instagram 릴스 스크래퍼 (undetected_chromedriver · 로컬 PC 실행)"
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
