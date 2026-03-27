"""
TikTok 동영상 스크래퍼

수집 전략 (순서대로 시도):
  1. yt-dlp + 로컬 Chrome 쿠키  → 가장 안정적 (실제 쿠키 사용)
  2. yt-dlp (쿠키 없이)          → 쿠키 추출 실패 시 fallback
  3. undetected_chromedriver      → yt-dlp 완전 실패 시 DOM 파싱

TikTok 봇 감지 핵심: msToken·ttwid 등 쿠키 유효성.
실제 Chrome 쿠키를 그대로 전달하면 정상 사용자로 인식.
"""

import re
import time
from datetime import datetime, timezone


# ── 숫자 파싱 ─────────────────────────────────────────────────────────────

def _parse_num(text) -> int:
    """'679.2K' → 679200, '10.6M' → 10600000, 숫자도 처리"""
    if isinstance(text, (int, float)):
        return int(text)
    if not text:
        return 0
    text = str(text).strip().replace(',', '')
    for suffix, mult in [('B', 1_000_000_000), ('M', 1_000_000), ('K', 1_000)]:
        if text.upper().endswith(suffix):
            try:
                return int(float(text[:-1]) * mult)
            except Exception:
                return 0
    try:
        return int(text)
    except Exception:
        return 0


# ══════════════════════════════════════════════════════════════════════════════
# 방법 1: yt-dlp + 브라우저 쿠키
# ══════════════════════════════════════════════════════════════════════════════

def _fetch_via_ytdlp(username: str, amount: int, use_browser_cookies: bool = True) -> dict:
    """
    yt-dlp로 TikTok 영상 목록 수집.
    use_browser_cookies=True: 로컬 Chrome 쿠키 자동 추출 → 봇 감지 우회
    """
    import yt_dlp

    # pinned 포함 여유분 추가 수집
    fetch_count = amount + 5

    ydl_opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "playlist_items": f"1-{fetch_count}",
        "socket_timeout": 30,
        "retries": 2,
    }

    if use_browser_cookies:
        # Chrome 쿠키 우선, 실패 시 Firefox 시도
        for browser in ("chrome", "firefox", "edge"):
            try:
                ydl_opts["cookiesfrombrowser"] = (browser,)
                result = _run_ytdlp(username, ydl_opts, amount)
                if result["videoCount"] > 0:
                    print(f"  [yt-dlp/{browser}쿠키] @{username} → {result['videoCount']}개")
                    return result
            except Exception as e:
                print(f"  [yt-dlp/{browser}쿠키] 실패: {e}")
                ydl_opts.pop("cookiesfrombrowser", None)

    # 쿠키 없이 재시도
    ydl_opts.pop("cookiesfrombrowser", None)
    return _run_ytdlp(username, ydl_opts, amount)


def _run_ytdlp(username: str, ydl_opts: dict, amount: int) -> dict:
    import yt_dlp

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(
            f"https://www.tiktok.com/@{username}",
            download=False,
        )

    if not info:
        raise ValueError("빈 응답")

    entries = info.get("entries") or []
    videos = []

    for entry in entries:
        if not entry:
            continue

        # yt-dlp가 pinned 필드를 제공하는 경우 건너뜀
        if entry.get("pinned") or entry.get("is_pinned"):
            print(f"    [고정됨 스킵] {entry.get('id', '')}")
            continue

        view_count = _parse_num(entry.get("view_count", 0))
        video_id = entry.get("id", "")
        url = entry.get("webpage_url") or entry.get("url") or ""

        videos.append({
            "id": video_id,
            "url": url,
            "title": entry.get("title", ""),
            "viewCount": view_count,
            "likeCount": _parse_num(entry.get("like_count", 0)),
            "commentCount": _parse_num(entry.get("comment_count", 0)),
            "uploadDate": str(entry.get("upload_date", "") or ""),
            "thumbnail": entry.get("thumbnail", ""),
            "duration": int(entry.get("duration") or 0),
        })

        if len(videos) >= amount:
            break

    avg_views = round(sum(v["viewCount"] for v in videos) / len(videos)) if videos else 0

    return {
        "username": username,
        "videoCount": len(videos),
        "videos": videos,
        "avgViews": avg_views,
        "status": "completed",
        "scrapedAt": datetime.now(timezone.utc).isoformat(),
    }


# ══════════════════════════════════════════════════════════════════════════════
# 방법 2: undetected_chromedriver (DOM 파싱 fallback)
# ══════════════════════════════════════════════════════════════════════════════

def _build_driver(headless: bool = False):
    import undetected_chromedriver as uc
    options = uc.ChromeOptions()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--lang=ko-KR,ko")
    options.add_argument(
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
    options.add_argument("--start-maximized")
    return uc.Chrome(options=options, use_subprocess=True)


def _js_items(driver) -> list:
    return driver.execute_script(
        "return Array.from(document.querySelectorAll('div[data-e2e=\"user-post-item\"]'));"
    )


def _is_pinned(driver, item) -> bool:
    try:
        badge_text = driver.execute_script(
            "var b = arguments[0].querySelector('div[data-e2e=\"video-card-badge\"]');"
            "return b ? b.textContent : '';",
            item,
        )
        return bool(badge_text and ("고정됨" in badge_text or "pinned" in badge_text.lower()))
    except Exception:
        return False


def _extract_item(driver, item) -> dict | None:
    try:
        data = driver.execute_script("""
            var el = arguments[0];
            var a = el.querySelector('a[href*="/video/"], a[href*="/photo/"]');
            var url = a ? a.href : '';
            var sv = el.querySelector('strong[data-e2e="video-views"]');
            var views = sv ? sv.textContent.trim() : '0';
            var thumb = '';
            var imgs = el.querySelectorAll('img');
            for (var i = 0; i < imgs.length; i++) {
                var src = imgs[i].currentSrc || imgs[i].src || '';
                if (src && src.indexOf('tiktok') !== -1 && src.indexOf('base64') === -1) {
                    thumb = src; break;
                }
            }
            return {url: url, views: views, thumbnail: thumb};
        """, item)
        if not data or not data.get("url"):
            return None
        url: str = data["url"]
        m = re.search(r"/(video|photo)/(\d+)", url)
        video_id = m.group(2) if m else url
        return {
            "id": video_id, "url": url,
            "viewCount": _parse_num(data.get("views", "0")),
            "thumbnail": data.get("thumbnail", ""),
            "title": "", "likeCount": 0, "commentCount": 0,
            "duration": 0, "uploadDate": "",
        }
    except Exception:
        return None


def _fetch_via_browser(username: str, amount: int, headless: bool = False) -> dict:
    """undetected_chromedriver DOM 스크래핑 (fallback)"""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    username = username.lstrip("@").strip()
    driver = _build_driver(headless=headless)
    try:
        # TikTok 메인 먼저 → 쿠키 확보
        driver.get("https://www.tiktok.com/")
        time.sleep(3)

        driver.get(f"https://www.tiktok.com/@{username}")
        try:
            WebDriverWait(driver, 25).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, 'div[data-e2e="user-post-item"]'))
            )
        except Exception:
            time.sleep(5)

        videos: list[dict] = []
        seen_ids: set[str] = set()
        last_count = 0
        stall = 0
        max_scrolls = max(10, (amount // 8) + 5)

        for _ in range(max_scrolls):
            for item in _js_items(driver):
                if _is_pinned(driver, item):
                    continue
                v = _extract_item(driver, item)
                if not v or v["id"] in seen_ids:
                    continue
                seen_ids.add(v["id"])
                videos.append(v)
                if len(videos) >= amount:
                    break
            if len(videos) >= amount:
                break
            if len(videos) == last_count:
                stall += 1
                if stall >= 3:
                    break
            else:
                stall = 0
            last_count = len(videos)
            driver.execute_script("window.scrollBy(0, 1800);")
            time.sleep(1.5)
    finally:
        try:
            driver.quit()
        except Exception:
            pass

    videos = videos[:amount]
    avg_views = round(sum(v["viewCount"] for v in videos) / len(videos)) if videos else 0
    return {
        "username": username,
        "videoCount": len(videos),
        "videos": videos,
        "avgViews": avg_views,
        "status": "completed",
        "scrapedAt": datetime.now(timezone.utc).isoformat(),
    }


# ══════════════════════════════════════════════════════════════════════════════
# 공개 인터페이스 (instagram_server.py에서 호출)
# ══════════════════════════════════════════════════════════════════════════════

def fetch_user_videos(driver_unused, username: str, amount: int,
                      headless: bool = False) -> dict:
    """
    driver_unused: 하위 호환성 유지용 (무시됨, 내부에서 직접 생성)
    순서: yt-dlp(쿠키) → yt-dlp(무쿠키) → 브라우저 DOM 파싱
    """
    username = username.lstrip("@").strip()
    print(f"  [TikTok] @{username} 수집 시작 (amount={amount})")

    # 1. yt-dlp + 브라우저 쿠키
    try:
        result = _fetch_via_ytdlp(username, amount, use_browser_cookies=True)
        if result["videoCount"] > 0:
            return result
        print(f"  [yt-dlp] 0개 수집됨 → 브라우저 fallback")
    except Exception as e:
        print(f"  [yt-dlp] 실패: {e} → 브라우저 fallback")

    # 2. 브라우저 DOM 파싱 (undetected_chromedriver)
    print(f"  [browser] @{username} 브라우저로 재시도...")
    return _fetch_via_browser(username, amount, headless=headless)


def run(usernames: list[str], amount: int = 20, headless: bool = False) -> list[dict]:
    """독립 실행용 (driver 없이 직접 호출)"""
    results = []
    for raw in usernames:
        username = raw.lstrip("@").strip()
        if not username:
            continue
        try:
            result = fetch_user_videos(None, username, amount, headless=headless)
            print(f"[TikTok] @{username} → {result['videoCount']}개, 평균 {result['avgViews']:,} 조회")
            results.append(result)
        except Exception as e:
            print(f"[TikTok] @{username} 오류: {e}")
            results.append({
                "username": username, "videoCount": 0, "videos": [],
                "avgViews": 0, "status": "error", "error": str(e),
                "scrapedAt": datetime.now(timezone.utc).isoformat(),
            })
    return results
