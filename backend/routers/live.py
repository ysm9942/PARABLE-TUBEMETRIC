"""
라이브 지표 분석 API — viewership.softc.one 기반

CHZZK / SOOP(아프리카TV) 크리에이터의 방송 시청자 지표를 수집한다.
softc.one은 SPA이므로 Playwright(headless Chromium)로 파싱한다.
Playwright가 없으면 httpx로 직접 접근을 시도한다.
"""
import logging
import re
import traceback
from datetime import datetime, timedelta
from urllib.parse import quote

logger = logging.getLogger(__name__)

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

PLATFORM_MAP = {"chzzk": "naverchzzk", "soop": "afreeca"}


class LiveRequest(BaseModel):
    creators: list[dict]  # [{"platform": "chzzk", "creatorId": "abc123"}, ...]
    startDate: str  # YYYY-MM-DD
    endDate: str  # YYYY-MM-DD
    categories: list[str] = []


class StreamRecord(BaseModel):
    creator: str
    platform: str
    title: str
    category: str
    peakViewers: int
    avgViewers: int
    date: str
    durationMin: int


def _build_url(platform: str, creator_id: str, start_date: str, end_date: str) -> str:
    plat_path = PLATFORM_MAP.get(platform, platform)
    start_dt = datetime.strptime(start_date, "%Y-%m-%d")
    end_dt = datetime.strptime(end_date, "%Y-%m-%d")
    start_utc = (start_dt.replace(hour=0, minute=0, second=0) - timedelta(hours=9)).strftime(
        "%Y-%m-%dT%H:%M:%S.000Z"
    )
    end_utc = (end_dt.replace(hour=14, minute=59, second=59) - timedelta(hours=9)).strftime(
        "%Y-%m-%dT%H:%M:%S.999Z"
    )
    base = "https://viewership.softc.one"
    return f"{base}/channel/{plat_path}/{creator_id}/streams?startDateTime={quote(start_utc)}&endDateTime={quote(end_utc)}"


def _parse_next_data(html: str, creator_id: str, platform: str, start_year: int, categories: list[str]) -> list[dict]:
    """__NEXT_DATA__ JSON에서 방송 기록을 추출 시도."""
    import json
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    script = soup.find("script", id="__NEXT_DATA__")
    if not script or not script.string:
        return []

    try:
        data = json.loads(script.string)
        # Next.js pageProps 안에 스트림 데이터가 있을 수 있음
        props = data.get("props", {}).get("pageProps", {})
        streams = props.get("streams") or props.get("data") or props.get("streamList") or []
        if not streams and isinstance(props, dict):
            # 중첩된 구조 탐색
            for v in props.values():
                if isinstance(v, list) and len(v) > 0 and isinstance(v[0], dict):
                    if any(k in v[0] for k in ("peakViewers", "avgViewers", "maxViewer", "averageViewer")):
                        streams = v
                        break
        if not streams:
            logger.info("[NextData] __NEXT_DATA__ 존재하나 스트림 데이터 미발견. keys: %s", list(props.keys())[:10])
            return []

        rows = []
        for s in streams:
            cat = s.get("category", s.get("categoryName", ""))
            title = s.get("title", s.get("streamTitle", ""))
            peak = s.get("peakViewers", s.get("maxViewer", 0))
            avg = s.get("avgViewers", s.get("averageViewer", 0))
            dur = s.get("durationMin", s.get("duration", 0))
            date_str = s.get("date", s.get("startDate", ""))[:10]

            if categories and cat and not any(c.lower() in cat.lower() for c in categories):
                continue
            rows.append({
                "creator": creator_id,
                "platform": platform.upper(),
                "title": title,
                "category": cat,
                "peakViewers": int(peak) if peak else 0,
                "avgViewers": int(avg) if avg else 0,
                "date": date_str,
                "durationMin": int(dur) if dur else 0,
            })
        logger.info("[NextData] __NEXT_DATA__에서 %d개 방송 기록 추출", len(rows))
        return rows
    except Exception as e:
        logger.warning("[NextData] __NEXT_DATA__ 파싱 실패: %s", e)
        return []


def _parse_html(html: str, creator_id: str, platform: str, start_year: int, categories: list[str]) -> list[dict]:
    """softc.one SPA에서 방송 기록을 파싱한다."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    rows = []

    stream_sel = "a[href*='/streams/']"
    stream_links = soup.select(stream_sel)
    logger.info("[ParseHTML] 발견된 스트림 링크 수: %d", len(stream_links))

    for a in stream_links:
        # 데스크톱 버튼 우선 선택 (hidden lg:flex), 없으면 아무 버튼
        btns = a.find_all("button")
        btn = None
        for b in btns:
            classes = b.get("class", [])
            class_str = " ".join(classes) if isinstance(classes, list) else str(classes)
            if "lg:flex" in class_str or "lg\\:flex" in class_str:
                btn = b
                break
        if not btn:
            btn = a.find("button")
        if not btn:
            continue

        cols = btn.find_all("div", recursive=False)
        if not cols:
            cols = btn.find_all("div")

        if len(cols) < 5:
            logger.debug("[ParseHTML] 컬럼 수 부족: %d (최소 5 필요)", len(cols))
            continue

        def _t(el):
            return el.get_text(strip=True) if el else ""

        def _n(el):
            txt = _t(el)
            # 쉼표 포함 숫자 처리 (예: "1,144")
            s = re.sub(r"[^\d]", "", txt)
            return int(s) if s else 0

        col0 = cols[0] if cols else None
        divs = col0.find_all("div", recursive=False) if col0 else []
        # 재귀적으로 찾기 (중첩된 div 구조)
        if len(divs) <= 1:
            divs = col0.find_all("div") if col0 else []

        cat_text = ""
        title_text = ""
        if len(divs) >= 2:
            # divs[0]은 보통 wrapper, 그 안에 카테고리/제목이 있음
            inner_divs = divs[0].find_all("div") if divs[0] else []
            if len(inner_divs) >= 2:
                cat_text = _t(inner_divs[0])
                title_text = _t(inner_divs[1])
            else:
                cat_text = _t(divs[0])
                title_text = _t(divs[1])
        elif len(divs) == 1:
            cat_text = _t(divs[0])

        # LIVE 태그 제거
        cat_text = re.sub(r"^LIVE\s*", "", cat_text)

        period = _t(cols[1]) if len(cols) > 1 else ""
        date_m = re.search(r"(\d{1,2})\.(\d{2})", period)
        date_str = (
            f"{start_year}-{int(date_m.group(1)):02d}-{int(date_m.group(2)):02d}"
            if date_m
            else ""
        )

        dur_text = _t(cols[2]) if len(cols) > 2 else ""
        dur_m = re.search(r"(\d+(?:\.\d+)?)", dur_text)
        dur_min = int(float(dur_m.group(1)) * 60) if dur_m else 0

        peak = _n(cols[3]) if len(cols) > 3 else 0
        avg = _n(cols[4]) if len(cols) > 4 else 0

        if categories and cat_text and not any(c.lower() in cat_text.lower() for c in categories):
            continue

        rows.append({
            "creator": creator_id,
            "platform": platform.upper(),
            "title": title_text,
            "category": cat_text,
            "peakViewers": peak,
            "avgViewers": avg,
            "date": date_str,
            "durationMin": dur_min,
        })

    logger.info("[ParseHTML] HTML에서 %d개 방송 기록 파싱 완료", len(rows))
    return rows


async def _fetch_with_playwright(url: str) -> tuple[str, list[dict]]:
    """Playwright headless Chromium + stealth 패치로 SPA 렌더링 후 HTML 반환.

    Returns:
        (html, api_responses): HTML 문자열과 가로챈 API JSON 응답 목록
    """
    import asyncio
    import json
    from playwright.async_api import async_playwright

    try:
        from playwright_stealth import stealth_async
    except ImportError:
        stealth_async = None

    api_responses = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-features=IsolateOrigins,site-per-process",
                "--disable-dev-shm-usage",
                "--no-sandbox",
                "--disable-gpu",
                "--single-process",
            ],
        )
        context = await browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="ko-KR",
            timezone_id="Asia/Seoul",
            java_script_enabled=True,
        )
        page = await context.new_page()

        # API 응답 가로채기 — JSON 응답 중 스트림 데이터 포함 여부 확인
        async def _on_response(response):
            try:
                ct = response.headers.get("content-type", "")
                if "json" in ct and response.status == 200:
                    body = await response.text()
                    if any(kw in body for kw in ['"streams"', '"peakViewers"', '"maxViewer"', '"averageViewer"', '"avgViewers"']):
                        data = json.loads(body)
                        api_responses.append({"url": response.url, "data": data})
                        logger.info("[Playwright] API 응답 가로채기 성공: %s (%d bytes)", response.url, len(body))
            except Exception:
                pass

        page.on("response", _on_response)

        # stealth 패치 적용 (navigator.webdriver 숨기기 등)
        if stealth_async:
            await stealth_async(page)
        else:
            await page.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
                Object.defineProperty(navigator, 'languages', {get: () => ['ko-KR', 'ko', 'en-US', 'en']});
                Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
                window.chrome = {runtime: {}};
            """)

        # Cloudflare 체크 대기 — 최대 3회 재시도
        logger.info("[Playwright] 페이지 로드 시작: %s", url)
        for attempt in range(3):
            resp = await page.goto(url, wait_until="networkidle", timeout=50000)
            status = resp.status if resp else "no response"
            logger.info("[Playwright] 응답 상태: %s (시도 %d/3)", status, attempt + 1)

            # Cloudflare 챌린지 페이지 감지 (403/503 + cf-challenge)
            if resp and resp.status in (403, 503):
                body = await page.content()
                if "cf-challenge" in body or "Just a moment" in body:
                    logger.warning("[Playwright] Cloudflare 챌린지 감지, 10초 대기 후 재시도")
                    await asyncio.sleep(10)
                    await page.wait_for_load_state("networkidle", timeout=20000)
                    continue
                else:
                    logger.error("[Playwright] HTTP %s 반환, Cloudflare 아님. 본문 앞 500자: %s", resp.status, body[:500])
            break

        # 방송 기록 요소가 렌더링될 때까지 대기
        try:
            await page.wait_for_selector("a[href*='/streams/']", timeout=25000)
            logger.info("[Playwright] 방송 기록 요소 발견")
        except Exception:
            page_title = await page.title()
            snippet = (await page.content())[:2000]
            logger.warning("[Playwright] 방송 기록 요소 미발견. 페이지 제목: '%s', 본문 앞 2000자: %s", page_title, snippet)

        # 추가 렌더링 대기 (SPA 데이터 로딩 여유)
        await asyncio.sleep(3)

        html = await page.content()
        html_len = len(html)
        logger.info("[Playwright] HTML 수집 완료 (%d bytes), 가로챈 API 응답: %d개", html_len, len(api_responses))

        # 디버그: 스트림 링크 수 확인
        stream_count = html.count("/streams/")
        logger.info("[Playwright] HTML 내 '/streams/' 패턴 수: %d", stream_count)

        await context.close()
        await browser.close()
        return html, api_responses


async def _fetch_with_httpx(url: str) -> str:
    """httpx로 직접 접근 시도 (SSR이 아닌 경우 빈 결과일 수 있음)."""
    import httpx

    async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
        resp = await client.get(url, headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            "Accept-Encoding": "gzip, deflate, br",
            "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
        })
        resp.raise_for_status()
        return resp.text


@router.post("/streams")
async def fetch_live_streams(req: LiveRequest):
    """크리에이터들의 방송 기록을 수집한다."""
    all_results = []
    start_year = int(req.startDate.split("-")[0])

    # Playwright 사용 가능 여부 확인
    use_playwright = True
    try:
        import playwright  # noqa: F401
    except ImportError:
        use_playwright = False
        import logging
        logging.warning("playwright 미설치 — httpx 폴백 사용 (SPA 렌더링 불가, 빈 결과 가능)")

    for creator in req.creators:
        platform = creator.get("platform", "chzzk").lower()
        creator_id = creator.get("creatorId", "").strip()
        if not creator_id:
            continue

        url = _build_url(platform, creator_id, req.startDate, req.endDate)

        method = "playwright" if use_playwright else "httpx"
        logger.info("[Live] 수집 시작: %s/%s (방법: %s) → %s", platform, creator_id, method, url)

        try:
            rows = []
            api_responses = []

            if use_playwright:
                html, api_responses = await _fetch_with_playwright(url)
            else:
                html = await _fetch_with_httpx(url)

            # 1단계: 가로챈 API JSON 응답에서 직접 추출 시도
            if api_responses:
                for api_resp in api_responses:
                    api_data = api_resp.get("data", {})
                    logger.info("[Live] API 응답 키: %s (URL: %s)", list(api_data.keys()) if isinstance(api_data, dict) else type(api_data).__name__, api_resp.get("url", "?"))
                    # TODO: API 응답 구조에 맞게 파싱 (구조 확인 후 구현)

            # 2단계: __NEXT_DATA__에서 추출 시도
            if not rows:
                rows = _parse_next_data(html, creator_id, platform, start_year, req.categories)

            # 3단계: HTML DOM 파싱 (기존 방식)
            if not rows:
                rows = _parse_html(html, creator_id, platform, start_year, req.categories)

            logger.info("[Live] 수집 성공: %s/%s — %d개 방송 기록 (방법: %s)", platform, creator_id, len(rows), "api" if api_responses and rows else "next_data" if rows else "html")

            all_results.append({
                "creatorId": creator_id,
                "platform": platform.upper(),
                "streamCount": len(rows),
                "streams": rows,
                "avgViewers": round(sum(r["avgViewers"] for r in rows) / len(rows)) if rows else 0,
                "peakViewers": max((r["peakViewers"] for r in rows), default=0),
                "totalDurationMin": sum(r["durationMin"] for r in rows),
                "status": "completed",
                "scrapedAt": datetime.utcnow().isoformat() + "Z",
            })

        except Exception as e:
            tb = traceback.format_exc()
            error_detail = f"{type(e).__name__}: {e}"
            logger.error("[Live] 수집 실패: %s/%s — %s\n%s", platform, creator_id, error_detail, tb)

            all_results.append({
                "creatorId": creator_id,
                "platform": platform.upper(),
                "streamCount": 0,
                "streams": [],
                "avgViewers": 0,
                "peakViewers": 0,
                "totalDurationMin": 0,
                "status": "error",
                "error": error_detail,
                "scrapedAt": datetime.utcnow().isoformat() + "Z",
            })

    return all_results
