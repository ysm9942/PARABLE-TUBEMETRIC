"""
PARABLE-TUBEMETRIC Instagram 릴스 스크래퍼 — DOM + CDP Hover 기반

instagram.com/{username}/reels/ 에서 릴스 썸네일 DOM을 직접 파싱합니다.
- 조회수: 썸네일에 항상 표시된 span
- 좋아요 / 댓글: CDP mouseMoved 이벤트로 CSS :hover 트리거 후 span 수집
  (headless 모드에서도 CDP는 CSS :hover를 정상 트리거)

사용법:
  python instagram_scraper.py @user1 @user2 --amount 10
  python instagram_scraper.py user1 user2 --amount 20 --no-headless

환경 변수 (선택):
  IG_USERNAME : Instagram 로그인 아이디 (비공개 계정 수집 시)
  IG_PASSWORD : Instagram 로그인 비밀번호
"""
from __future__ import annotations

import argparse
import atexit
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

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

# ── 숫자 파싱 (한국 단위 지원) ────────────────────────────────────────────────

def _parse_num(text: str) -> int:
    """Instagram 표시 숫자 → int.  '161.4만' → 1614000,  '8,534' → 8534"""
    t = (text or "").strip().replace(",", "").replace(" ", "")
    m = re.match(r"^([\d.]+)([만억천]?)$", t)
    if not m:
        digits = re.sub(r"\D", "", t)
        return int(digits) if digits else 0
    n = float(m.group(1))
    u = m.group(2)
    if u == "만":   n *= 10_000
    elif u == "억": n *= 100_000_000
    elif u == "천": n *= 1_000
    return int(n)


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


# ── 드라이버 빌드 ──────────────────────────────────────────────────────────────

def _build_driver(headless: bool = True):
    import undetected_chromedriver as uc

    chrome_major = _get_chrome_ver()
    log(f"[Chrome] 버전: {chrome_major or '자동감지'}  headless={headless}")

    # 각 드라이버 인스턴스마다 독립적인 Chrome 프로파일 사용
    # → SoftC(8002) 등 다른 Chrome 프로세스와 충돌 방지 (invalid session id 오류 해소)
    tmp_dir = tempfile.mkdtemp(prefix="ig_chrome_")
    atexit.register(shutil.rmtree, tmp_dir, ignore_errors=True)

    opts = uc.ChromeOptions()
    opts.add_argument(f"--user-data-dir={tmp_dir}")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--window-size=1920,1080")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    if headless:
        opts.add_argument("--headless=new")

    driver = (
        uc.Chrome(options=opts, version_main=chrome_major)
        if chrome_major
        else uc.Chrome(options=opts)
    )
    driver.implicitly_wait(5)

    # 드라이버 quit 시 임시 디렉토리 정리
    _original_quit = driver.quit
    def _patched_quit():
        try:
            _original_quit()
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)
    driver.quit = _patched_quit  # type: ignore

    return driver


# ── 로그인 (선택) ──────────────────────────────────────────────────────────────

def _try_login(driver) -> bool:
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


# ── 모달 닫기 ─────────────────────────────────────────────────────────────────

def _dismiss_modal(driver) -> None:
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
                log("[팝업] 모달 닫기 완료")
                return
        except Exception:
            continue


# ── stat span CSS 선택자 ──────────────────────────────────────────────────────
# 조회수·좋아요·댓글 모두 동일한 CSS 클래스 (사용자 확인)
STAT_SPAN = (
    "span.html-span.xdj266r.x14z9mp.xat24cr"
    ".x1lziwak.xexx8yu.xyri2b.x18d9i69"
    ".x1c1uobl.x1hl2dhg.x16tdsg8.x1vvkbs"
)
# 폴백 (클래스 일부만)
STAT_SPAN_FB = "span.xdj266r.x14z9mp.xat24cr"

# JS로 querySelectorAll → textContent 수집 (display:none 포함)
_JS_COLLECT = """
var els = arguments[0].querySelectorAll(arguments[1]);
var res = [];
for (var i = 0; i < els.length; i++) {
    var t = (els[i].textContent || '').trim();
    if (t) res.push(t);
}
return res;
"""


def _js_stat_nums(driver, container_el, css: str) -> list[int]:
    """JS querySelectorAll로 stat span 숫자를 DOM 순서대로 반환 (hidden 포함)."""
    try:
        texts = driver.execute_script(_JS_COLLECT, container_el, css) or []
        return [_parse_num(t) for t in texts]
    except Exception:
        return []


# ── CDP hover (CSS :hover 트리거 — headless/비headless 모두 동작) ──────────────

def _cdp_hover(driver, element) -> None:
    """CDP Input.dispatchMouseEvent로 요소 위에 마우스 이동 → CSS :hover 트리거."""
    try:
        rect = driver.execute_script(
            "var r=arguments[0].getBoundingClientRect();"
            "return {x: r.left + r.width/2, y: r.top + r.height/2};",
            element,
        )
        driver.execute_cdp_cmd("Input.dispatchMouseEvent", {
            "type":    "mouseMoved",
            "x":       int(rect["x"]),
            "y":       int(rect["y"]),
            "button":  "none",
            "modifiers": 0,
        })
    except Exception:
        pass


def _cdp_unhover(driver) -> None:
    """마우스를 화면 밖으로 이동시켜 hover 해제."""
    try:
        driver.execute_cdp_cmd("Input.dispatchMouseEvent", {
            "type": "mouseMoved", "x": 0, "y": 0,
            "button": "none", "modifiers": 0,
        })
    except Exception:
        pass


# ── 단일 릴스 통계 수집 ───────────────────────────────────────────────────────

def _scrape_reel(driver, link_el) -> tuple[int, int, int, str]:
    """(view_count, like_count, comment_count, thumbnail_url) 반환."""

    # 화면 중앙 스크롤 후 이미지 로드 대기
    driver.execute_script(
        "arguments[0].scrollIntoView({block:'center', behavior:'instant'});", link_el
    )
    time.sleep(0.2)

    # 썸네일 URL — src / currentSrc / srcset 순으로 시도
    thumbnail_url = driver.execute_script("""
        var img = arguments[0].querySelector('img');
        if (!img) return '';
        if (img.currentSrc) return img.currentSrc;
        if (img.src) return img.src;
        if (img.srcset) return img.srcset.split(',')[0].trim().split(' ')[0];
        return '';
    """, link_el) or ""

    # 컨테이너: link의 부모 요소 (hover overlay가 <a> 밖/앞에 위치)
    try:
        container = driver.execute_script("return arguments[0].parentElement;", link_el)
    except Exception:
        container = link_el

    # ── hover 전: link_el 내부에서 조회수 수집 (항상 보임) ───────────────
    before = _js_stat_nums(driver, link_el, STAT_SPAN)
    if not before:
        before = _js_stat_nums(driver, link_el, STAT_SPAN_FB)
    view_count = before[0] if before else 0

    # ── CDP hover → CSS :hover 트리거 ────────────────────────────────────
    _cdp_hover(driver, link_el)
    time.sleep(0.35)   # CSS transition + React 렌더 대기

    # ── hover 후: container 전체 수집 → 조회수 제외하면 좋아요·댓글 ────────
    # DOM 순서: [좋아요, 댓글, 조회수] (hover overlay가 <a> 앞에 위치)
    after = _js_stat_nums(driver, container, STAT_SPAN)
    if not after:
        after = _js_stat_nums(driver, container, STAT_SPAN_FB)

    _cdp_unhover(driver)

    # view_count는 before에서 확정. after에서 view_count를 제외한 나머지 = 좋아요·댓글
    like_count = comment_count = 0
    hover_nums = [n for n in after if n != view_count] if view_count else after

    if len(hover_nums) >= 2:
        like_count, comment_count = hover_nums[0], hover_nums[1]
    elif len(hover_nums) == 1:
        like_count = hover_nums[0]
    elif len(after) >= 3:
        # view_count가 0이어서 필터링 못 한 경우 — DOM 순서 직접 사용
        like_count, comment_count, view_count = after[0], after[1], after[2]
    elif len(after) == 2:
        like_count, comment_count = after[0], after[1]

    return view_count, like_count, comment_count, thumbnail_url


# ── 릴스 탭 수집 메인 ─────────────────────────────────────────────────────────

MONTHS_EN = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}

def _fetch_reel_meta(driver, code: str) -> tuple[str, str]:
    """개별 릴스 페이지에서 og:title과 날짜를 추출합니다.
    Returns (title, taken_at_iso) — 실패 시 빈 문자열 반환.
    """
    try:
        reel_url = f"https://www.instagram.com/reel/{code}/"
        driver.get(reel_url)
        human_sleep(1.5, 2.5)

        # og:title → 제목
        title = ""
        try:
            og = driver.find_element("css selector", 'meta[property="og:title"]')
            title = og.get_attribute("content") or ""
            # "Instagram의 해봄님 : ..." → 콜론 이후 불필요한 경우 그대로 사용
        except Exception:
            pass

        # description meta → 날짜 추출
        taken_at = ""
        try:
            desc_el = driver.find_element("css selector", 'meta[name="description"]')
            desc = desc_el.get_attribute("content") or ""
            # 예: "8,565 likes, 189 comments - haebom_m - December 10, 2024: ..."
            m = re.search(
                r"(January|February|March|April|May|June|July|August|September|October|November|December)"
                r"\s+(\d{1,2}),\s+(\d{4})",
                desc, re.IGNORECASE,
            )
            if m:
                month = MONTHS_EN[m.group(1).lower()]
                day   = int(m.group(2))
                year  = int(m.group(3))
                taken_at = f"{year:04d}-{month:02d}-{day:02d}T00:00:00Z"
        except Exception:
            pass

        return title, taken_at

    except Exception as e:
        log(f"  ⚠ {code} 메타 수집 오류: {e}")
        return "", ""


def fetch_user_reels(driver, username: str, amount: int) -> dict:
    from selenium.webdriver.common.by import By

    log(f"[수집] @{username} 시작 (최대 {amount}개)")

    # ── Phase 1: 릴스 그리드에서 통계 수집 ───────────────────────────────────
    driver.get(f"https://www.instagram.com/{username}/reels/")
    human_sleep(2.5, 4.0)
    _dismiss_modal(driver)

    raw_reels: list[dict] = []
    seen_codes: set[str] = set()
    no_new_rounds = 0

    while len(raw_reels) < amount and no_new_rounds < 5:
        links = driver.find_elements(By.CSS_SELECTOR, "a[href*='/reel/']")
        new_this_round = 0

        for link in links:
            if len(raw_reels) >= amount:
                break

            href = link.get_attribute("href") or ""
            m = re.search(r"/reel/([A-Za-z0-9_-]+)", href)
            if not m:
                continue
            code = m.group(1)
            if code in seen_codes:
                continue
            seen_codes.add(code)

            try:
                view_count, like_count, comment_count, thumbnail_url = _scrape_reel(driver, link)
                raw_reels.append({
                    "code":          code,
                    "like_count":    like_count,
                    "comment_count": comment_count,
                    "view_count":    view_count,
                    "thumbnail_url": thumbnail_url,
                })
                new_this_round += 1
                log(f"  [{len(raw_reels):02d}] {code}: 조회수={view_count:,}  좋아요={like_count:,}  댓글={comment_count:,}")

            except Exception as e:
                log(f"  ⚠ {code} 파싱 오류: {e}")

        if new_this_round == 0:
            no_new_rounds += 1
        else:
            no_new_rounds = 0

        if len(raw_reels) < amount:
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            human_sleep(1.5, 2.0)

    # ── Phase 2: 개별 릴스 페이지 방문 → 제목·날짜 수집 ────────────────────
    reels: list[dict] = []
    for idx, r in enumerate(raw_reels):
        code = r["code"]
        log(f"  [메타 {idx+1}/{len(raw_reels)}] {code} 제목·날짜 수집 중...")
        title, taken_at = _fetch_reel_meta(driver, code)
        reels.append({
            "username":      username,
            "media_pk":      "",
            "code":          code,
            "caption_text":  title,
            "taken_at":      taken_at,
            "like_count":    r["like_count"],
            "comment_count": r["comment_count"],
            "view_count":    r["view_count"],
            "thumbnail_url": r["thumbnail_url"],
            "url":           f"https://www.instagram.com/reel/{code}/",
        })

    count = len(reels)
    avg_views    = round(sum(r["view_count"]    for r in reels) / count) if count else 0
    avg_likes    = round(sum(r["like_count"]    for r in reels) / count) if count else 0
    avg_comments = round(sum(r["comment_count"] for r in reels) / count) if count else 0

    log(f"[완료] @{username}: {count}개, 평균 조회수 {avg_views:,}")
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

def run(usernames: list[str], amount: int = 10, push: bool = False, headless: bool = True) -> list[dict]:
    driver = None
    results: list[dict] = []

    try:
        driver = _build_driver(headless=headless)

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

    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Instagram 릴스 스크래퍼 (DOM + CDP Hover 기반)"
    )
    parser.add_argument("usernames", nargs="+", help="@핸들 또는 유저명")
    parser.add_argument("--amount",      type=int, default=10,  help="유저당 수집할 릴스 수")
    parser.add_argument("--no-headless", action="store_true",   help="headless=False (브라우저 창 표시)")
    parser.add_argument("--push",        action="store_true",   help="결과를 GitHub에 push")
    args = parser.parse_args()

    results = run(args.usernames, amount=args.amount, push=args.push, headless=not args.no_headless)

    print("\n── 수집 결과 요약 ──────────────────────────────────")
    for r in results:
        if r.get("error"):
            print(f"  @{r['username']}: 오류 — {r['error']}")
        else:
            print(f"  @{r['username']}: 릴스 {r['reelCount']}개, 평균 조회수 {r['avgViews']:,}")
    print()


if __name__ == "__main__":
    main()
