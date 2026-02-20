"""
개별 YouTube 영상 상세 정보 스크래퍼
"""
import json
import re
import time
from datetime import datetime
from typing import Optional

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC

from browser import wait
from shorts_detector import is_short, parse_duration_seconds


def _extract_yt_initial_data(driver) -> Optional[dict]:
    src = driver.page_source
    m = re.search(r'var ytInitialData\s*=\s*(\{.*?\});\s*(?:</script>|var )', src, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    return None


def _parse_comments_from_dom(driver, max_count: int = 6) -> list:
    """DOM에서 상위 댓글 추출"""
    comments = []
    try:
        comment_els = driver.find_elements(By.CSS_SELECTOR, "ytd-comment-thread-renderer")[:max_count]
        for el in comment_els:
            try:
                author = el.find_element(By.CSS_SELECTOR, "#author-text").text.strip()
                text = el.find_element(By.CSS_SELECTOR, "#content-text").text.strip()
                try:
                    likes = el.find_element(By.CSS_SELECTOR, "#vote-count-middle").text.strip()
                    like_count = int(likes.replace(",", "")) if likes.isdigit() else 0
                except Exception:
                    like_count = 0
                comments.append({
                    "author": author,
                    "text": text,
                    "likeCount": like_count,
                    "publishedAt": "",
                })
            except Exception:
                continue
    except Exception:
        pass
    return comments


def scrape_video(driver, video_input: str) -> dict:
    """
    단일 영상 페이지를 스크래핑해서 상세 정보 반환.
    video_input: 영상 ID (11자) 또는 YouTube URL
    """
    # 영상 ID 추출
    m = re.search(r"(?:v=|/shorts/|youtu\.be/)([A-Za-z0-9_-]{11})", video_input)
    video_id = m.group(1) if m else (video_input.strip() if len(video_input.strip()) == 11 else None)

    if not video_id:
        return {"videoId": video_input, "status": "error", "error": "영상 ID를 인식할 수 없습니다."}

    url = f"https://www.youtube.com/watch?v={video_id}"
    print(f"[영상 스크래핑] {video_id}")
    driver.get(url)

    try:
        wait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "ytd-watch-flexy, ytd-app"))
        )
    except Exception:
        pass
    time.sleep(3)

    title = ""
    channel_title = ""
    view_count = 0
    like_count = 0
    comment_count = 0
    thumbnail = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    duration_text = ""
    published_at = ""

    # ytInitialData에서 추출 시도
    yt_data = _extract_yt_initial_data(driver)
    if yt_data:
        try:
            contents = (
                yt_data["contents"]["twoColumnWatchNextResults"]
                ["results"]["results"]["contents"]
            )
            for item in contents:
                primary = item.get("videoPrimaryInfoRenderer", {})
                if primary:
                    runs = primary.get("title", {}).get("runs", [])
                    title = "".join(r.get("text", "") for r in runs)
                    view_text = (
                        primary.get("viewCount", {})
                        .get("videoViewCountRenderer", {})
                        .get("viewCount", {})
                        .get("simpleText", "")
                    )
                    if view_text:
                        nums = re.findall(r"\d+", view_text.replace(",", ""))
                        view_count = int("".join(nums)) if nums else 0

                secondary = item.get("videoSecondaryInfoRenderer", {})
                if secondary:
                    channel_title = (
                        secondary.get("owner", {})
                        .get("videoOwnerRenderer", {})
                        .get("title", {})
                        .get("runs", [{}])[0]
                        .get("text", "")
                    )
        except Exception:
            pass

    # DOM 폴백
    if not title:
        try:
            el = driver.find_element(By.CSS_SELECTOR, "h1.ytd-video-primary-info-renderer yt-formatted-string")
            title = el.text.strip()
        except Exception:
            try:
                el = driver.find_element(By.CSS_SELECTOR, "h1.style-scope.ytd-watch-metadata")
                title = el.text.strip()
            except Exception:
                pass

    if not channel_title:
        try:
            el = driver.find_element(By.CSS_SELECTOR, "#channel-name a, ytd-channel-name a")
            channel_title = el.text.strip()
        except Exception:
            pass

    if view_count == 0:
        try:
            el = driver.find_element(By.CSS_SELECTOR, ".view-count, #count .view-count-renderer")
            nums = re.findall(r"\d+", el.text.replace(",", ""))
            view_count = int("".join(nums)) if nums else 0
        except Exception:
            pass

    # 좋아요 수 (aria-label 파싱)
    try:
        like_el = driver.find_element(
            By.CSS_SELECTOR,
            "ytd-toggle-button-renderer like-button-view-model button, #top-level-buttons-computed ytd-toggle-button-renderer:first-child"
        )
        aria = like_el.get_attribute("aria-label") or ""
        nums = re.findall(r"[\d,]+", aria)
        like_count = int(nums[0].replace(",", "")) if nums else 0
    except Exception:
        pass

    # 재생시간 (ytInitialPlayerResponse에서)
    try:
        src = driver.page_source
        dur_match = re.search(r'"approxDurationMs"\s*:\s*"(\d+)"', src)
        if dur_match:
            ms = int(dur_match.group(1))
            total_sec = ms // 1000
            h, rem = divmod(total_sec, 3600)
            m_val, s_val = divmod(rem, 60)
            duration_text = f"{h}:{m_val:02d}:{s_val:02d}" if h else f"{m_val}:{s_val:02d}"
    except Exception:
        pass

    # 댓글 로드 (스크롤)
    driver.execute_script("window.scrollTo(0, 600);")
    time.sleep(3)
    top_comments = _parse_comments_from_dom(driver)

    duration_sec = parse_duration_seconds(duration_text)

    return {
        "videoId": video_id,
        "title": title or f"(영상 {video_id})",
        "channelTitle": channel_title,
        "thumbnail": thumbnail,
        "viewCount": view_count,
        "likeCount": like_count,
        "commentCount": comment_count,
        "topComments": top_comments,
        "duration": duration_text,
        "isShort": is_short(duration_text, video_id),
        "publishedAt": published_at,
        "status": "completed",
        "scrapedAt": datetime.utcnow().isoformat() + "Z",
    }


def scrape_channel_ad_videos(driver, channel_url: str, start_date: str, end_date: str) -> list:
    """
    채널의 영상 목록을 가져온 뒤 날짜 범위 내 영상에 광고 분석 실행.
    (channel_scraper + ad_detector 조합)
    """
    from channel_scraper import scrape_channel
    from ad_detector import analyze_video_for_ad
    from datetime import datetime as dt

    channel_data = scrape_channel(driver, channel_url, max_scrolls=5)
    all_videos = channel_data.get("shortsList", []) + channel_data.get("longsList", [])

    start_dt = dt.fromisoformat(start_date.replace("Z", ""))
    end_dt = dt.fromisoformat(end_date.replace("Z", ""))

    ad_videos = []
    for v in all_videos:
        pub_str = v.get("publishedAt", "")
        if pub_str:
            try:
                pub_dt = dt.fromisoformat(pub_str.replace("Z", ""))
                if not (start_dt <= pub_dt <= end_dt):
                    continue
            except Exception:
                pass

        detection = analyze_video_for_ad(driver, v["id"])
        if detection.get("is_ad"):
            ad_videos.append({**v, "detection": detection})

    return ad_videos
