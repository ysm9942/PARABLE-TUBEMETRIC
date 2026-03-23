"""
Instagram 릴스 스크래핑 API — Playwright 네트워크 인터셉션 기반

실제 Chromium 브라우저로 Instagram 릴스 페이지를 열어
브라우저가 자동으로 호출하는 clips/user API 응답을 가로챈다.
playwright-stealth로 봇 탐지 우회. 로그인 불필요. 공개 계정 지원.
"""
import asyncio
import json
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()
_executor = ThreadPoolExecutor(max_workers=2)

_MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
    "Mobile/15E148 Safari/604.1"
)


class InstagramRequest(BaseModel):
    usernames: list[str]
    amount: int = 10


# ---------------------------------------------------------------------------
# 공통 파싱
# ---------------------------------------------------------------------------

def _parse_api_media(media: dict, username: str) -> dict:
    """clips/user API 응답의 media 객체를 파싱한다."""
    code = media.get("code") or media.get("shortcode") or ""
    cap_obj = media.get("caption")
    caption = (
        cap_obj.get("text", "") if isinstance(cap_obj, dict) else (cap_obj or "")
    )
    iv = media.get("image_versions2") or {}
    thumb = ((iv.get("candidates") or [{}])[0]).get("url", "")
    view_count = int(
        media.get("play_count") or media.get("view_count") or
        media.get("ig_play_count") or 0
    )
    taken_at = media.get("taken_at") or 0
    return {
        "username": username,
        "media_pk": str(media.get("id") or media.get("pk") or ""),
        "code": code,
        "caption_text": caption[:300],
        "taken_at": (
            datetime.fromtimestamp(taken_at, tz=timezone.utc).isoformat()
            if taken_at else datetime.now(timezone.utc).isoformat()
        ),
        "like_count": int(media.get("like_count") or 0),
        "comment_count": int(media.get("comment_count") or 0),
        "view_count": view_count,
        "video_duration": float(media.get("video_duration") or 0),
        "thumbnail_url": thumb,
        "url": f"https://www.instagram.com/reel/{code}/" if code else None,
    }


def _parse_graphql_edge(node: dict, username: str) -> dict:
    """GraphQL 엣지 노드를 파싱한다."""
    code = node.get("shortcode") or ""
    caption_edges = (node.get("edge_media_to_caption") or {}).get("edges") or []
    caption = caption_edges[0].get("node", {}).get("text", "") if caption_edges else ""
    thumb = node.get("display_url") or node.get("thumbnail_src") or ""
    taken_at = node.get("taken_at_timestamp") or 0
    return {
        "username": username,
        "media_pk": str(node.get("id") or ""),
        "code": code,
        "caption_text": caption[:300],
        "taken_at": (
            datetime.fromtimestamp(taken_at, tz=timezone.utc).isoformat()
            if taken_at else datetime.now(timezone.utc).isoformat()
        ),
        "like_count": int(
            (node.get("edge_liked_by") or node.get("edge_media_preview_like") or {}).get("count", 0)
        ),
        "comment_count": int(
            (node.get("edge_media_to_comment") or {}).get("count", 0)
        ),
        "view_count": int(node.get("video_view_count") or node.get("video_play_count") or 0),
        "video_duration": float(node.get("video_duration") or 0),
        "thumbnail_url": thumb,
        "url": f"https://www.instagram.com/reel/{code}/" if code else None,
    }


# ---------------------------------------------------------------------------
# Primary: Playwright 네트워크 인터셉션
# ---------------------------------------------------------------------------

def _scrape_playwright(username: str, amount: int) -> list[dict]:
    """
    Playwright + playwright-stealth으로 Instagram 릴스 페이지를 열고
    브라우저가 자체적으로 호출하는 clips/user 및 GraphQL API 응답을 인터셉션한다.
    """
    from playwright.sync_api import sync_playwright
    try:
        from playwright_stealth import stealth_sync
        _has_stealth = True
    except ImportError:
        _has_stealth = False

    collected: list[dict] = []
    intercepted_responses: list[dict] = []

    def on_response(response):
        url = response.url
        if not any(k in url for k in ("clips/user", "api/graphql", "api/v1/feed")):
            return
        try:
            data = response.json()
            intercepted_responses.append(data)
        except Exception:
            pass

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
            ],
        )
        ctx = browser.new_context(
            user_agent=_MOBILE_UA,
            viewport={"width": 390, "height": 844},
            locale="ko-KR",
            timezone_id="Asia/Seoul",
        )
        page = ctx.new_page()
        if _has_stealth:
            stealth_sync(page)

        page.on("response", on_response)

        try:
            page.goto(
                f"https://www.instagram.com/{username}/reels/",
                wait_until="domcontentloaded",
                timeout=30_000,
            )
            # 팝업 닫기 시도 (로그인 유도 모달)
            for selector in [
                'div[role="dialog"] button',
                'button:has-text("나중에 하기")',
                'button:has-text("Not Now")',
                '[aria-label="닫기"]',
            ]:
                try:
                    page.click(selector, timeout=2000)
                    break
                except Exception:
                    pass

            # API 응답 대기 (최대 8초)
            page.wait_for_timeout(8000)

            # 스크롤로 추가 로드
            if len(collected) < amount:
                for _ in range(3):
                    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    page.wait_for_timeout(2000)

        except Exception:
            pass
        finally:
            browser.close()

    # 인터셉션된 응답 파싱
    for data in intercepted_responses:
        # clips/user 형식
        items = data.get("items") or []
        for item in items:
            media = item.get("media") or item
            if isinstance(media, dict):
                collected.append(_parse_api_media(media, username))

        # GraphQL 형식
        user_obj = (
            (data.get("data") or {}).get("user") or
            (data.get("graphql") or {}).get("user") or {}
        )
        edge_obj = (
            user_obj.get("edge_felix_video_timeline") or
            user_obj.get("edge_owner_to_timeline_media") or {}
        )
        for edge in (edge_obj.get("edges") or []):
            node = edge.get("node") or {}
            if node.get("is_video"):
                collected.append(_parse_graphql_edge(node, username))

        if len(collected) >= amount:
            break

    return collected[:amount]


# ---------------------------------------------------------------------------
# Fallback: curl_cffi → Instagram 내부 API
# ---------------------------------------------------------------------------

_IG_HEADERS = {
    "User-Agent": _MOBILE_UA,
    "X-IG-App-ID": "936619743392459",
    "Accept": "*/*",
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Referer": "https://www.instagram.com/",
    "Origin": "https://www.instagram.com",
}


def _scrape_curl(username: str, amount: int) -> list[dict]:
    """curl_cffi Chrome 120 impersonation fallback."""
    from curl_cffi import requests as cf

    resp = cf.get(
        f"https://i.instagram.com/api/v1/users/web_profile_info/?username={username}",
        headers=_IG_HEADERS,
        impersonate="chrome120",
        timeout=20,
    )
    resp.raise_for_status()
    user_data = (resp.json().get("data") or {}).get("user") or {}
    user_id = user_data.get("id") or user_data.get("pk")
    if not user_id:
        raise ValueError(f"사용자를 찾을 수 없습니다: @{username}")

    time.sleep(random.uniform(0.8, 1.5))
    reels: list[dict] = []
    max_id = ""

    while len(reels) < amount:
        resp = cf.post(
            "https://www.instagram.com/api/v1/clips/user/",
            headers={**_IG_HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
            data={
                "target_user_id": str(user_id),
                "page_size": str(min(12, amount - len(reels))),
                "max_id": max_id,
            },
            impersonate="chrome120",
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
        for item in (data.get("items") or []):
            reels.append(_parse_api_media(item.get("media") or item, username))
        paging = data.get("paging_info") or {}
        if not paging.get("more_available") or not data.get("items"):
            break
        max_id = str(paging.get("max_id") or "")
        time.sleep(random.uniform(0.5, 1.2))

    return reels[:amount]


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def _scrape_user(username: str, amount: int) -> dict:
    """Playwright → curl_cffi 순서로 시도한다."""
    reels: list[dict] = []
    errors: list[str] = []

    try:
        reels = _scrape_playwright(username, amount)
    except Exception as e:
        errors.append(f"playwright: {e}")

    if not reels:
        try:
            reels = _scrape_curl(username, amount)
        except Exception as e:
            errors.append(f"curl: {e}")

    count = len(reels)
    result: dict = {
        "username": username,
        "reelCount": count,
        "avgViews": round(sum(r["view_count"] for r in reels) / count) if count else 0,
        "avgLikes": round(sum(r["like_count"] for r in reels) / count) if count else 0,
        "avgComments": round(sum(r["comment_count"] for r in reels) / count) if count else 0,
        "scrapedAt": datetime.now(timezone.utc).isoformat(),
        "reels": reels,
    }
    if errors and not reels:
        result["error"] = " | ".join(errors)
    return result


@router.post("/reels")
async def fetch_reels(req: InstagramRequest):
    """Instagram 릴스 수집 — Playwright 인터셉션 → curl_cffi fallback."""
    loop = asyncio.get_event_loop()
    results = []

    for raw in req.usernames:
        v = raw.strip()
        url_match = re.search(r"instagram\.com/([^/?#\s]+)", v)
        if url_match:
            v = url_match.group(1)
        username = v.lstrip("@").rstrip("/")
        if not username:
            continue

        result = await loop.run_in_executor(_executor, _scrape_user, username, req.amount)
        results.append(result)
        await asyncio.sleep(random.uniform(1.5, 3.0))

    return results
