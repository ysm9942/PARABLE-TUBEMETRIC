"""
TikTok 동영상 스크래퍼 — undetected_chromedriver 기반 DOM 파싱

• 프로필 페이지에서 최신 영상 수집
• '고정됨(Pinned)' 영상 자동 제외
• 조회수만 그리드에서 파싱 (좋아요/댓글은 개별 페이지 진입 필요 → 생략)
"""

import re
import time
from datetime import datetime, timezone

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


# ── 숫자 파싱 ─────────────────────────────────────────────────────────────

def _parse_num(text: str) -> int:
    """TikTok 조회수 파싱: '679.2K' → 679200, '10.6M' → 10600000"""
    if not text:
        return 0
    text = text.strip().replace(',', '')
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


# ── 드라이버 빌드 ─────────────────────────────────────────────────────────

def _build_driver(headless: bool = True):
    options = uc.ChromeOptions()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--lang=ko-KR,ko")
    options.add_argument("--disable-blink-features=AutomationControlled")
    return uc.Chrome(options=options)


# ── JS 헬퍼 ──────────────────────────────────────────────────────────────

def _js_items(driver) -> list:
    """JS querySelectorAll로 비디오 카드 수집 (display:none 포함)"""
    return driver.execute_script(
        "return Array.from(document.querySelectorAll('div[data-e2e=\"user-post-item\"]'));"
    )


def _is_pinned(driver, item) -> bool:
    """고정됨 배지 존재 여부 확인"""
    try:
        badge_text = driver.execute_script(
            "var b = arguments[0].querySelector('div[data-e2e=\"video-card-badge\"]');"
            "return b ? b.textContent : '';",
            item,
        )
        return bool(badge_text and ("고정됨" in badge_text or "Pinned" in badge_text.lower()))
    except Exception:
        return False


def _extract_item(driver, item) -> dict | None:
    """DOM 항목에서 URL·조회수·썸네일 추출"""
    try:
        data = driver.execute_script("""
            var el = arguments[0];
            // URL
            var a = el.querySelector('a[href*="/video/"], a[href*="/photo/"]');
            var url = a ? a.href : '';
            // 조회수
            var sv = el.querySelector('strong[data-e2e="video-views"]');
            var views = sv ? sv.textContent.trim() : '0';
            // 썸네일
            var thumb = '';
            var imgs = el.querySelectorAll('img');
            for (var i = 0; i < imgs.length; i++) {
                var src = imgs[i].currentSrc || imgs[i].src || '';
                if (src && src.indexOf('tiktok') !== -1 && src.indexOf('base64') === -1 && src.indexOf('gif') === -1) {
                    thumb = src;
                    break;
                }
            }
            return {url: url, views: views, thumbnail: thumb};
        """, item)
        if not data or not data.get("url"):
            return None

        url: str = data["url"]
        # id 추출
        m = re.search(r"/(video|photo)/(\d+)", url)
        video_id = m.group(2) if m else url

        return {
            "id": video_id,
            "url": url,
            "viewCount": _parse_num(data.get("views", "0")),
            "thumbnail": data.get("thumbnail", ""),
            "title": "",
            "likeCount": 0,
            "commentCount": 0,
            "duration": 0,
            "uploadDate": "",
        }
    except Exception:
        return None


# ── 메인 수집 함수 ────────────────────────────────────────────────────────

def fetch_user_videos(driver, username: str, amount: int) -> dict:
    username = username.lstrip("@").strip()
    url = f"https://www.tiktok.com/@{username}"
    driver.get(url)

    # 페이지 로드 대기
    try:
        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, 'div[data-e2e="user-post-item"]'))
        )
    except Exception:
        time.sleep(4)

    videos: list[dict] = []
    seen_ids: set[str] = set()
    scroll_attempts = 0
    max_scrolls = max(10, (amount // 8) + 5)
    last_count = 0
    stall = 0

    while len(videos) < amount and scroll_attempts < max_scrolls:
        items = _js_items(driver)

        for item in items:
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

        # 새 항목이 없으면 stall 카운트
        if len(videos) == last_count:
            stall += 1
            if stall >= 3:
                break
        else:
            stall = 0
        last_count = len(videos)

        driver.execute_script("window.scrollBy(0, 1800);")
        time.sleep(1.5)
        scroll_attempts += 1

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


# ── 진입점 ────────────────────────────────────────────────────────────────

def run(usernames: list[str], amount: int = 20, headless: bool = True) -> list[dict]:
    driver = _build_driver(headless=headless)
    results = []
    try:
        for raw in usernames:
            username = raw.lstrip("@").strip()
            if not username:
                continue
            print(f"[TikTok] @{username} 수집 시작 (amount={amount})")
            try:
                result = fetch_user_videos(driver, username, amount)
                print(f"[TikTok] @{username} → {result['videoCount']}개, 평균 {result['avgViews']:,} 조회")
                results.append(result)
            except Exception as e:
                print(f"[TikTok] @{username} 오류: {e}")
                results.append({
                    "username": username,
                    "videoCount": 0,
                    "videos": [],
                    "avgViews": 0,
                    "status": "error",
                    "error": str(e),
                    "scrapedAt": datetime.now(timezone.utc).isoformat(),
                })
    finally:
        try:
            driver.quit()
        except Exception:
            pass
    return results
