"""
라이브 지표 분석 API — viewership.softc.one 기반

CHZZK / SOOP(아프리카TV) 크리에이터의 방송 시청자 지표를 수집한다.
softc.one은 SPA이므로 Playwright(headless Chromium)로 파싱한다.
Playwright가 없으면 httpx로 직접 접근을 시도한다.
"""
import asyncio
import logging
import re
import traceback
from datetime import datetime, timedelta
from urllib.parse import quote

logger = logging.getLogger(__name__)

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
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


def _parse_api_responses(api_responses: list[dict], creator_id: str, platform: str, categories: list[str]) -> list[dict]:
    """Playwright가 가로챈 API JSON 응답에서 방송 기록을 추출한다."""
    rows = []
    for api_resp in api_responses:
        data = api_resp.get("data", {})
        streams = []

        # 다양한 응답 구조 처리
        if isinstance(data, list):
            streams = data
        elif isinstance(data, dict):
            # {streams: [...]} / {data: [...]} / {items: [...]} / {results: [...]}
            for key in ("streams", "data", "items", "results", "streamList", "list"):
                candidate = data.get(key)
                if isinstance(candidate, list) and len(candidate) > 0:
                    streams = candidate
                    break
            # 중첩 구조: {data: {streams: [...]}} 등
            if not streams:
                for v in data.values():
                    if isinstance(v, dict):
                        for key2 in ("streams", "data", "items", "results"):
                            candidate2 = v.get(key2)
                            if isinstance(candidate2, list) and len(candidate2) > 0:
                                streams = candidate2
                                break
                    if streams:
                        break
            # 단일 레벨 dict에 뷰어 데이터가 있으면 리스트로 감싸기
            if not streams and any(k in data for k in ("peakViewers", "maxViewer", "avgViewers", "averageViewer")):
                streams = [data]

        if not streams:
            continue

        for s in streams:
            if not isinstance(s, dict):
                continue
            cat = str(s.get("category", s.get("categoryName", s.get("gameName", ""))))
            title = str(s.get("title", s.get("streamTitle", s.get("name", ""))))
            peak = s.get("peakViewers", s.get("maxViewer", s.get("peak_viewers", s.get("peakCcv", 0))))
            avg = s.get("avgViewers", s.get("averageViewer", s.get("avg_viewers", s.get("avgCcv", 0))))
            dur = s.get("durationMin", s.get("duration", s.get("airTime", s.get("air_time", 0))))
            # duration이 초 단위일 수 있음 (3600 이상이면 초로 간주)
            if isinstance(dur, (int, float)) and dur > 1440:
                dur = int(dur / 60)

            date_val = s.get("date", s.get("startDate", s.get("startedAt", s.get("started_at", ""))))
            date_str = str(date_val)[:10] if date_val else ""

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

        if rows:
            logger.info("[API] API 응답에서 %d개 방송 기록 추출 (URL: %s)", len(rows), api_resp.get("url", "?"))
            break  # 첫 번째 유효한 응답에서 추출 성공하면 중단

    return rows


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
                # --single-process, --disable-gpu 제거: Cloudflare가 봇으로 감지하는 주요 신호
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
                resp_url = response.url
                is_json = "json" in ct
                is_next_data = "/_next/data/" in resp_url and resp_url.endswith(".json")

                if (is_json or is_next_data) and response.status == 200:
                    body = await response.text()
                    # 스트림/뷰어 관련 키워드 또는 _next/data 응답
                    stream_keywords = ['"streams"', '"peakViewers"', '"maxViewer"', '"averageViewer"', '"avgViewers"', '"peakCcv"', '"avgCcv"']
                    if is_next_data or any(kw in body for kw in stream_keywords):
                        data = json.loads(body)
                        # Next.js _next/data 응답은 {pageProps: {...}} 구조
                        if isinstance(data, dict) and "pageProps" in data:
                            data = data["pageProps"]
                        api_responses.append({"url": resp_url, "data": data})
                        logger.info("[Playwright] API 응답 가로채기 성공: %s (%d bytes)", resp_url, len(body))
            except Exception:
                pass

        page.on("response", _on_response)

        # stealth 패치 적용 (navigator.webdriver 숨기기 등)
        if stealth_async:
            await stealth_async(page)

        # stealth 여부와 관계없이 추가 패치 적용
        await page.add_init_script("""
            // navigator.webdriver 숨기기
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            // 언어/플러그인 스푸핑
            Object.defineProperty(navigator, 'languages', {get: () => ['ko-KR', 'ko', 'en-US', 'en']});
            Object.defineProperty(navigator, 'plugins', {get: () => [
                {name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer'},
                {name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai'},
                {name: 'Native Client', filename: 'internal-nacl-plugin'},
            ]});
            // Chrome 오브젝트 스푸핑
            window.chrome = {
                runtime: {},
                loadTimes: function() {},
                csi: function() {},
                app: {}
            };
            // permissions 스푸핑
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications'
                    ? Promise.resolve({state: Notification.permission})
                    : originalQuery(parameters)
            );
        """)

        # 초기 페이지 로드
        logger.info("[Playwright] 페이지 로드 시작: %s", url)
        resp = await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        status = resp.status if resp else "no response"
        logger.info("[Playwright] 초기 응답 상태: %s", status)

        # Cloudflare / Vercel 보안 챌린지 처리
        for attempt in range(5):
            body = await page.content()
            is_challenge = (
                "cf-challenge" in body
                or "Just a moment" in body
                or "Checking your browser" in body
                or ("ray id" in body.lower() and resp and resp.status in (403, 503))
                or "vercel.link/security-checkpoint" in body
                or "브라우저를 확인하고 있습니다" in body
                or "Vercel 보안 검문소" in body
            )
            if not is_challenge:
                if attempt > 0:
                    logger.info("[Playwright] 보안 챌린지 통과! (시도 %d)", attempt)
                break

            challenge_type = "Vercel" if "vercel.link" in body or "브라우저를 확인" in body else "Cloudflare"
            logger.warning("[Playwright] %s 챌린지 감지 (시도 %d/5), 15초 대기...", challenge_type, attempt + 1)
            await asyncio.sleep(15)

            # CF JS가 챌린지 완료 후 networkidle 상태가 됨
            try:
                await page.wait_for_load_state("networkidle", timeout=20000)
            except Exception:
                pass

            # 챌린지 해결됐는지 재확인
            body = await page.content()
            still_blocked = (
                "cf-challenge" in body
                or "Just a moment" in body
                or "Checking your browser" in body
                or "vercel.link/security-checkpoint" in body
                or "브라우저를 확인하고 있습니다" in body
            )
            if not still_blocked:
                logger.info("[Playwright] 보안 챌린지 통과! (시도 %d)", attempt + 1)
                break

            # 여전히 블록됨 → 재탐색
            if attempt < 4:
                logger.info("[Playwright] 챌린지 미해결, 재탐색 시도...")
                resp = await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                status = resp.status if resp else "no response"
                logger.info("[Playwright] 재탐색 응답: %s", status)
        else:
            logger.error("[Playwright] 보안 챌린지 5회 모두 실패. 본문 앞 500자: %s", (await page.content())[:500])

        # 방송 기록 요소가 렌더링될 때까지 대기
        try:
            await page.wait_for_selector("a[href*='/streams/']", timeout=15000)
            logger.info("[Playwright] 방송 기록 요소 발견")
        except Exception:
            page_title = await page.title()
            snippet = (await page.content())[:2000]
            logger.warning("[Playwright] 방송 기록 요소 미발견. 페이지 제목: '%s', 본문 앞 2000자: %s", page_title, snippet)

        # 추가 렌더링 대기 (SPA 데이터 로딩 여유)
        await asyncio.sleep(1)

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
    """curl_cffi(Chrome TLS 핑거프린트 위장)로 Cloudflare 우회 시도.
    curl_cffi 미설치 시 httpx로 폴백.
    """
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Upgrade-Insecure-Requests": "1",
    }

    # curl_cffi: Chrome의 TLS/HTTP2 핑거프린트를 그대로 복제 → Cloudflare 우회 가능
    try:
        from curl_cffi.requests import AsyncSession
        logger.info("[HTTP] curl_cffi로 접근 시도 (Chrome124 TLS 핑거프린트): %s", url)
        async with AsyncSession(impersonate="chrome124") as session:
            resp = await session.get(url, headers=headers, timeout=20, allow_redirects=True)
            resp.raise_for_status()
            logger.info("[HTTP] curl_cffi 응답 상태: %s, 길이: %d", resp.status_code, len(resp.text))
            return resp.text
    except ImportError:
        logger.info("[HTTP] curl_cffi 미설치, httpx 폴백 사용")
    except Exception as e:
        logger.warning("[HTTP] curl_cffi 실패: %s, httpx 폴백 사용", e)

    import httpx
    async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
        resp = await client.get(url, headers={
            **headers,
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
        })
        resp.raise_for_status()
        return resp.text


@router.get("/test-api")
async def test_softc_api(platform: str = "chzzk", creator_id: str = "ec857bee6cded06df19dae85cf37f878"):
    """softc.one의 내부 API를 직접 호출해 데이터 반환 가능 여부를 테스트."""
    import httpx
    import json

    plat_path = PLATFORM_MAP.get(platform, platform)
    start_utc = "2025-03-01T00:00:00.000Z"
    end_utc = "2025-03-18T14:59:59.999Z"

    # 여러 가능한 API 경로를 시도
    api_candidates = [
        f"https://viewership.softc.one/api/streams?channelId={creator_id}&platform={plat_path}&startDateTime={start_utc}&endDateTime={end_utc}",
        f"https://viewership.softc.one/api/channel/{plat_path}/{creator_id}/streams?startDateTime={start_utc}&endDateTime={end_utc}",
        f"https://viewership.softc.one/api/v1/streams?channelId={creator_id}&platform={plat_path}",
        f"https://viewership.softc.one/api/v1/channel/{plat_path}/{creator_id}/streams",
    ]

    results = []
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": f"https://viewership.softc.one/channel/{plat_path}/{creator_id}/streams",
        "Origin": "https://viewership.softc.one",
    }

    async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
        for url in api_candidates:
            try:
                resp = await client.get(url, headers=headers)
                body = resp.text[:1000]
                try:
                    data = resp.json()
                    body = json.dumps(data, ensure_ascii=False)[:1000]
                except Exception:
                    pass
                results.append({
                    "url": url,
                    "status": resp.status_code,
                    "content_type": resp.headers.get("content-type", ""),
                    "body_preview": body,
                })
            except Exception as e:
                results.append({
                    "url": url,
                    "status": "error",
                    "error": str(e),
                })

    return {"api_tests": results}


@router.get("/debug")
async def debug_scraper(platform: str = "chzzk", creator_id: str = "ec857bee6cded06df19dae85cf37f878"):
    """Render.com에서 Playwright가 실제로 무엇을 받는지 진단하는 디버그 엔드포인트."""
    import json

    start_date = "2025-03-01"
    end_date = "2025-03-18"
    url = _build_url(platform, creator_id, start_date, end_date)

    result = {
        "url": url,
        "playwright_available": False,
        "html_length": 0,
        "page_title": "",
        "has_cloudflare_challenge": False,
        "has_stream_links": False,
        "stream_link_count": 0,
        "has_next_data": False,
        "api_responses_count": 0,
        "html_snippet_start": "",
        "html_snippet_body": "",
        "error": None,
    }

    try:
        import playwright  # noqa: F401
        result["playwright_available"] = True
    except ImportError:
        result["error"] = "playwright not installed"
        return result

    try:
        html, api_responses = await _fetch_with_playwright(url)
        result["html_length"] = len(html)
        result["api_responses_count"] = len(api_responses)
        result["has_stream_links"] = "/streams/" in html
        result["stream_link_count"] = html.count("href=\"/channel/") + html.count("href=\"/streams/")

        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")
        result["page_title"] = soup.title.string if soup.title else ""
        result["has_cloudflare_challenge"] = "cf-challenge" in html or "Just a moment" in html
        result["has_vercel_challenge"] = "vercel.link/security-checkpoint" in html or "브라우저를 확인하고 있습니다" in html
        result["has_next_data"] = bool(soup.find("script", id="__NEXT_DATA__"))

        # HTML 앞부분과 body 앞부분 스니펫
        result["html_snippet_start"] = html[:1000]
        body = soup.find("body")
        if body:
            result["html_snippet_body"] = str(body)[:2000]

        # API 응답 요약
        if api_responses:
            result["api_responses_summary"] = []
            for resp in api_responses[:3]:
                summary = {"url": resp.get("url", ""), "keys": []}
                data = resp.get("data", {})
                if isinstance(data, dict):
                    summary["keys"] = list(data.keys())[:20]
                elif isinstance(data, list):
                    summary["keys"] = f"list[{len(data)}]"
                result["api_responses_summary"].append(summary)

    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
        result["traceback"] = traceback.format_exc()

    return result


async def _fetch_one_creator(
    creator: dict,
    start_date: str,
    end_date: str,
    start_year: int,
    categories: list[str],
    use_playwright: bool,
) -> dict:
    """단일 크리에이터의 방송 기록을 수집한다 (병렬 처리용)."""
    platform = creator.get("platform", "chzzk").lower()
    creator_id = creator.get("creatorId", "").strip()
    if not creator_id:
        return None

    url = _build_url(platform, creator_id, start_date, end_date)
    method = "playwright" if use_playwright else "httpx"
    logger.info("[Live] 수집 시작: %s/%s (방법: %s) → %s", platform, creator_id, method, url)

    try:
        rows = []
        api_responses = []

        if use_playwright:
            html, api_responses = await _fetch_with_playwright(url)
        else:
            html = await _fetch_with_httpx(url)

        if api_responses:
            rows = _parse_api_responses(api_responses, creator_id, platform, categories)
        if not rows:
            rows = _parse_next_data(html, creator_id, platform, start_year, categories)
        if not rows:
            rows = _parse_html(html, creator_id, platform, start_year, categories)

        logger.info("[Live] 수집 성공: %s/%s — %d개 방송 기록 (방법: %s)", platform, creator_id, len(rows), "api" if api_responses and rows else "next_data" if rows else "html")

        return {
            "creatorId": creator_id,
            "platform": platform.upper(),
            "streamCount": len(rows),
            "streams": rows,
            "avgViewers": round(sum(r["avgViewers"] for r in rows) / len(rows)) if rows else 0,
            "peakViewers": max((r["peakViewers"] for r in rows), default=0),
            "totalDurationMin": sum(r["durationMin"] for r in rows),
            "status": "completed",
            "scrapedAt": datetime.utcnow().isoformat() + "Z",
        }

    except Exception as e:
        tb = traceback.format_exc()
        error_detail = f"{type(e).__name__}: {e}"
        logger.error("[Live] 수집 실패: %s/%s — %s\n%s", platform, creator_id, error_detail, tb)

        return {
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
        }


@router.post("/streams")
async def fetch_live_streams(req: LiveRequest):
    """크리에이터들의 방송 기록을 병렬로 수집한다."""
    start_year = int(req.startDate.split("-")[0])

    # Playwright 사용 가능 여부 확인
    use_playwright = True
    try:
        import playwright  # noqa: F401
    except ImportError:
        use_playwright = False
        logging.warning("playwright 미설치 — httpx 폴백 사용 (SPA 렌더링 불가, 빈 결과 가능)")

    # 모든 크리에이터를 동시에 수집 (병렬)
    tasks = [
        _fetch_one_creator(c, req.startDate, req.endDate, start_year, req.categories, use_playwright)
        for c in req.creators
    ]
    results = await asyncio.gather(*tasks)

    return [r for r in results if r is not None]


# ── 로그 확인 / GitHub push ────────────────────────────────────────────────────

@router.get("/logs", response_class=PlainTextResponse)
async def get_logs():
    """메모리에 보관된 최근 로그를 텍스트로 반환한다."""
    from logger_config import memory_handler
    lines = memory_handler.get_lines()
    if not lines:
        return "로그 없음 (서버 재시작 후 요청이 없었거나 로깅 미설정)"
    return "\n".join(lines)


@router.post("/logs/push")
async def push_logs_to_github(branch: str = "main"):
    """현재 메모리 로그를 GitHub에 logs/scraping_YYYYMMDD_HHMMSS.txt 로 업로드한다.

    환경변수 GITHUB_TOKEN, GITHUB_REPO 가 설정돼 있어야 한다.
    """
    import base64
    import os
    import httpx
    from logger_config import memory_handler

    token = os.environ.get("GITHUB_TOKEN", "")
    repo = os.environ.get("GITHUB_REPO", "")
    if not token or not repo:
        raise HTTPException(
            status_code=400,
            detail="GITHUB_TOKEN, GITHUB_REPO 환경변수를 설정하세요.",
        )

    lines = memory_handler.get_lines()
    content = "\n".join(lines) if lines else "(로그 없음)"
    now = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    gh_path = f"logs/scraping_{now}.txt"

    url = f"https://api.github.com/repos/{repo}/contents/{gh_path}"
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
    }
    payload = {
        "message": f"logs: scraping log {now} ({len(lines)} lines)",
        "content": base64.b64encode(content.encode("utf-8")).decode(),
        "branch": branch,
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.put(url, headers=headers, json=payload)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitHub API 요청 실패: {e}")

    if r.status_code not in (200, 201):
        raise HTTPException(
            status_code=500,
            detail=f"GitHub push 실패: {r.status_code} — {r.text[:300]}",
        )

    html_url = r.json().get("content", {}).get("html_url", "")
    logger.info("[Logs] GitHub push 완료: %s (%d줄)", gh_path, len(lines))
    return {
        "pushed": gh_path,
        "lines": len(lines),
        "branch": branch,
        "url": html_url,
    }
