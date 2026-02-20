"""
YouTube 채널 페이지 스크래퍼 (undetected-chromedriver 기반)
ytInitialData JSON을 파싱해 영상 목록과 채널 정보를 추출한다.
"""
import json
import re
import time
from datetime import datetime, timedelta
from typing import Optional

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC

from browser import wait
from shorts_detector import is_short


# ──────────────────────────────────────────────
# 내부 헬퍼
# ──────────────────────────────────────────────

def _extract_yt_initial_data(driver) -> Optional[dict]:
    """페이지 소스에서 ytInitialData JSON 추출"""
    src = driver.page_source
    patterns = [
        r'var ytInitialData\s*=\s*(\{.*?\});\s*(?:</script>|var )',
        r'window\["ytInitialData"\]\s*=\s*(\{.*?\});',
    ]
    for pattern in patterns:
        m = re.search(pattern, src, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                continue
    return None


def _get_text(obj, *keys, default=""):
    """중첩 dict 안전 탐색"""
    for k in keys:
        if not isinstance(obj, dict):
            return default
        obj = obj.get(k, {})
    if isinstance(obj, str):
        return obj
    return default


def _parse_view_count(text: str) -> int:
    """
    '1.2만 조회수', '123,456회', '1.5M views' 등을 int로 변환
    """
    text = text.lower().replace(",", "").replace(" ", "")
    # 한국어 만/억
    if "억" in text:
        num = re.search(r"[\d.]+", text)
        return int(float(num.group()) * 1_0000_0000) if num else 0
    if "만" in text:
        num = re.search(r"[\d.]+", text)
        return int(float(num.group()) * 10000) if num else 0
    # 영어 K/M/B
    if "b" in text:
        num = re.search(r"[\d.]+", text)
        return int(float(num.group()) * 1_000_000_000) if num else 0
    if "m" in text:
        num = re.search(r"[\d.]+", text)
        return int(float(num.group()) * 1_000_000) if num else 0
    if "k" in text:
        num = re.search(r"[\d.]+", text)
        return int(float(num.group()) * 1_000) if num else 0
    num = re.search(r"\d+", text)
    return int(num.group()) if num else 0


def _parse_relative_date(text: str) -> str:
    """
    '3일 전', '2주 전', '1개월 전', '3 months ago' 등을 ISO 날짜로 근사 변환.
    정확하지 않아도 되므로 오늘 기준 근사값을 반환.
    """
    now = datetime.utcnow()
    text = text.lower()

    patterns = [
        (r"(\d+)\s*(?:초|second)", timedelta(seconds=1)),
        (r"(\d+)\s*(?:분|minute)", timedelta(minutes=1)),
        (r"(\d+)\s*(?:시간|hour)", timedelta(hours=1)),
        (r"(\d+)\s*(?:일|day)", timedelta(days=1)),
        (r"(\d+)\s*(?:주|week)", timedelta(weeks=1)),
        (r"(\d+)\s*(?:개월|달|month)", timedelta(days=30)),
        (r"(\d+)\s*(?:년|year)", timedelta(days=365)),
    ]
    for pattern, unit in patterns:
        m = re.search(pattern, text)
        if m:
            delta = unit * int(m.group(1))
            return (now - delta).strftime("%Y-%m-%dT%H:%M:%SZ")

    return now.strftime("%Y-%m-%dT%H:%M:%SZ")


def _resolve_channel_url(channel_input: str) -> str:
    """채널 입력값을 YouTube 영상 목록 URL로 변환"""
    inp = channel_input.strip()
    # UC... 채널 ID
    if re.match(r"UC[a-zA-Z0-9_-]{22}", inp):
        return f"https://www.youtube.com/channel/{inp}/videos"
    # @handle
    if inp.startswith("@"):
        return f"https://www.youtube.com/{inp}/videos"
    # 이미 URL인 경우
    if "youtube.com" in inp:
        if "/videos" not in inp:
            inp = inp.rstrip("/") + "/videos"
        return inp
    # 그 외: 핸들로 가정
    return f"https://www.youtube.com/@{inp}/videos"


def _scroll_to_load(driver, max_scrolls: int = 15, pause: float = 1.8):
    """스크롤해서 더 많은 영상 로드"""
    last_height = driver.execute_script("return document.documentElement.scrollHeight")
    for _ in range(max_scrolls):
        driver.execute_script("window.scrollTo(0, document.documentElement.scrollHeight);")
        time.sleep(pause)
        new_height = driver.execute_script("return document.documentElement.scrollHeight")
        if new_height == last_height:
            break
        last_height = new_height


# ──────────────────────────────────────────────
# ytInitialData 파싱
# ──────────────────────────────────────────────

def _parse_channel_info_from_data(data: dict) -> dict:
    """ytInitialData에서 채널 기본 정보 추출"""
    try:
        header = data["header"]["pageHeaderRenderer"]
        title = _get_text(header, "pageTitle")
        banner = (
            header.get("content", {})
            .get("pageHeaderViewModel", {})
            .get("banner", {})
            .get("imageBannerViewModel", {})
            .get("image", {})
            .get("sources", [{}])[0]
            .get("url", "")
        )
        return {"title": title, "banner": banner}
    except Exception:
        pass

    # fallback: microformat
    try:
        mf = data["microformat"]["microformatDataRenderer"]
        return {
            "title": mf.get("title", ""),
            "thumbnail": mf.get("thumbnail", {}).get("thumbnails", [{}])[-1].get("url", ""),
        }
    except Exception:
        return {}


def _extract_video_renderers(data: dict) -> list:
    """ytInitialData 탭 콘텐츠에서 videoRenderer 목록 추출"""
    renderers = []
    try:
        tabs = data["contents"]["twoColumnBrowseResultsRenderer"]["tabs"]
        for tab in tabs:
            tab_renderer = tab.get("tabRenderer", {})
            if not tab_renderer.get("selected"):
                continue
            content = tab_renderer.get("content", {})
            # richGridRenderer (일반 채널)
            rich_grid = content.get("richGridRenderer", {})
            for item in rich_grid.get("contents", []):
                vr = (
                    item.get("richItemRenderer", {})
                    .get("content", {})
                    .get("videoRenderer", {})
                )
                if vr:
                    renderers.append(vr)
    except Exception:
        pass
    return renderers


def _parse_video_renderer(vr: dict) -> Optional[dict]:
    """videoRenderer 객체 → VideoDetail dict"""
    video_id = vr.get("videoId", "")
    if not video_id:
        return None

    title = _get_text(vr, "title", "runs", default="")
    if not title:
        # simpleText
        title = _get_text(vr, "title", "simpleText", default="(제목 없음)")
    if isinstance(vr.get("title", {}).get("runs"), list):
        title = "".join(r.get("text", "") for r in vr["title"]["runs"])

    # 조회수
    view_text = _get_text(vr, "viewCountText", "simpleText", default="")
    if not view_text:
        view_text = "".join(
            r.get("text", "") for r in vr.get("viewCountText", {}).get("runs", [])
        )
    view_count = _parse_view_count(view_text)

    # 게시일
    published_text = _get_text(vr, "publishedTimeText", "simpleText", default="")
    published_at = _parse_relative_date(published_text) if published_text else ""

    # 썸네일
    thumbnails = vr.get("thumbnail", {}).get("thumbnails", [])
    thumbnail = thumbnails[-1].get("url", "") if thumbnails else ""

    # 재생시간
    length_text = _get_text(vr, "lengthText", "simpleText", default="")
    if not length_text:
        length_text = "".join(
            r.get("text", "") for r in vr.get("lengthText", {}).get("runs", [])
        )

    is_live = bool(vr.get("badges") and any(
        "LIVE" in str(b) for b in vr.get("badges", [])
    ))

    return {
        "id": video_id,
        "title": title,
        "thumbnail": thumbnail,
        "publishedAt": published_at,
        "viewCount": view_count,
        "duration": length_text,
        "isShort": is_short(length_text, video_id),
        "isLiveStream": is_live,
    }


# ──────────────────────────────────────────────
# DOM 기반 폴백 (ytInitialData 파싱 실패 시)
# ──────────────────────────────────────────────

def _scrape_videos_from_dom(driver) -> list:
    """DOM에서 직접 영상 카드 파싱 (폴백)"""
    videos = []
    try:
        items = driver.find_elements(By.CSS_SELECTOR, "ytd-rich-item-renderer")
        for item in items:
            try:
                title_el = item.find_element(By.CSS_SELECTOR, "#video-title")
                href = title_el.get_attribute("href") or ""
                m = re.search(r"v=([A-Za-z0-9_-]{11})", href)
                if not m:
                    continue
                video_id = m.group(1)
                title = title_el.text.strip()

                # 메타데이터 스팬 (조회수, 날짜)
                spans = item.find_elements(By.CSS_SELECTOR, "#metadata-line span")
                view_count = _parse_view_count(spans[0].text) if spans else 0
                published_at = _parse_relative_date(spans[1].text) if len(spans) > 1 else ""

                # 재생시간
                try:
                    dur_el = item.find_element(
                        By.CSS_SELECTOR, "ytd-thumbnail-overlay-time-status-renderer span"
                    )
                    duration = dur_el.text.strip()
                except Exception:
                    duration = ""

                # 썸네일
                try:
                    img = item.find_element(By.CSS_SELECTOR, "img.yt-core-image")
                    thumbnail = img.get_attribute("src") or ""
                except Exception:
                    thumbnail = ""

                videos.append({
                    "id": video_id,
                    "title": title,
                    "thumbnail": thumbnail,
                    "publishedAt": published_at,
                    "viewCount": view_count,
                    "duration": duration,
                    "isShort": is_short(duration, video_id),
                    "isLiveStream": False,
                })
            except Exception:
                continue
    except Exception:
        pass
    return videos


# ──────────────────────────────────────────────
# 공개 API
# ──────────────────────────────────────────────

def scrape_channel(driver, channel_input: str, max_scrolls: int = 10) -> dict:
    """
    채널의 영상 목록을 스크래핑해서 반환.

    반환 형식:
    {
        "channelId": str,
        "channelName": str,
        "thumbnail": str,
        "shortsList": [...],
        "longsList": [...],
        "liveList": [...],
        "avgShortsViews": int,
        "avgLongViews": int,
        ...
    }
    """
    url = _resolve_channel_url(channel_input)
    print(f"[채널 스크래핑] {url}")
    driver.get(url)

    # 페이지 로딩 대기
    try:
        wait(driver, 10).until(
            EC.presence_of_element_located((By.TAG_NAME, "ytd-app"))
        )
    except Exception:
        pass
    time.sleep(3)

    # ytInitialData 추출 시도
    data = _extract_yt_initial_data(driver)
    channel_info = _parse_channel_info_from_data(data) if data else {}

    # 채널 ID는 URL에서 추출
    current_url = driver.current_url
    cid_match = re.search(r"channel/(UC[a-zA-Z0-9_-]{22})", current_url)
    channel_id = cid_match.group(1) if cid_match else channel_input.replace("@", "")

    # 채널 아이콘 (ytInitialData > header > avatar)
    thumbnail = ""
    if data:
        try:
            avatars = (
                data["header"]["c4TabbedHeaderRenderer"]["avatar"]["thumbnails"]
            )
            thumbnail = avatars[-1]["url"]
        except Exception:
            pass

    channel_name = channel_info.get("title", "") or channel_id

    # 구독자 수
    subscriber_count = "0"
    if data:
        try:
            subscriber_count = (
                data["header"]["c4TabbedHeaderRenderer"]
                ["subscriberCountText"]["simpleText"]
            )
        except Exception:
            pass

    # 스크롤로 영상 더 로드
    _scroll_to_load(driver, max_scrolls=max_scrolls)

    # 영상 목록 파싱 (ytInitialData 우선, DOM 폴백)
    videos = []
    if data:
        for vr in _extract_video_renderers(data):
            parsed = _parse_video_renderer(vr)
            if parsed:
                videos.append(parsed)

    # ytInitialData로 못 가져왔으면 DOM 파싱
    if not videos:
        print("[폴백] DOM 파싱으로 전환")
        videos = _scrape_videos_from_dom(driver)

    shorts = [v for v in videos if v["isShort"] and not v["isLiveStream"]]
    longs = [v for v in videos if not v["isShort"] and not v["isLiveStream"]]
    lives = [v for v in videos if v["isLiveStream"]]

    def avg_views(lst):
        return round(sum(v["viewCount"] for v in lst) / len(lst)) if lst else 0

    all_non_live = shorts + longs
    result = {
        "channelId": channel_id,
        "channelName": channel_name,
        "thumbnail": thumbnail,
        "subscriberCount": subscriber_count,
        "shortsList": shorts,
        "longsList": longs,
        "liveList": lives[:10],
        "shortsCountFound": len(shorts),
        "longCountFound": len(longs),
        "totalCountFound": len(all_non_live),
        "avgShortsViews": avg_views(shorts),
        "avgLongViews": avg_views(longs),
        "avgTotalViews": avg_views(all_non_live),
        "status": "completed",
        "scrapedAt": datetime.utcnow().isoformat() + "Z",
    }
    print(f"[완료] {channel_name}: Shorts {len(shorts)}개, 롱폼 {len(longs)}개")
    return result
