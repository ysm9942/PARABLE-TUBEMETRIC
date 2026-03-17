"""
라이브 지표 분석 API — viewership.softc.one 기반

CHZZK / SOOP(아프리카TV) 크리에이터의 방송 시청자 지표를 수집한다.
softc.one은 SPA이므로 Playwright(headless Chromium)로 파싱한다.
Playwright가 없으면 httpx로 직접 접근을 시도한다.
"""
import re
from datetime import datetime, timedelta
from urllib.parse import quote

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


def _parse_html(html: str, creator_id: str, platform: str, start_year: int, categories: list[str]) -> list[dict]:
    """softc.one SPA에서 방송 기록을 파싱한다."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    rows = []

    stream_sel = "a[href*='/streams/']"
    for a in soup.select(stream_sel):
        btn = a.find("button")
        if not btn:
            continue
        cols = btn.find_all("div", recursive=False)
        if not cols:
            cols = btn.find_all("div")

        def _t(el):
            return el.get_text(strip=True) if el else ""

        def _n(el):
            s = re.sub(r"[^\d]", "", _t(el))
            return int(s) if s else 0

        col0 = cols[0] if cols else None
        divs = col0.find_all("div") if col0 else []
        cat_text = _t(divs[0]) if len(divs) >= 1 else _t(col0)
        title_text = _t(divs[1]) if len(divs) >= 2 else ""

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

    return rows


async def _fetch_with_playwright(url: str) -> str:
    """Playwright headless Chromium으로 SPA 렌더링 후 HTML 반환."""
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto(url, wait_until="networkidle", timeout=30000)
        # 방송 기록 요소가 렌더링될 때까지 대기
        try:
            await page.wait_for_selector("a[href*='/streams/']", timeout=15000)
        except Exception:
            pass  # 데이터가 없을 수도 있음
        html = await page.content()
        await browser.close()
        return html


async def _fetch_with_httpx(url: str) -> str:
    """httpx로 직접 접근 시도 (SSR이 아닌 경우 빈 결과일 수 있음)."""
    import httpx

    async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
        resp = await client.get(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
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

    for creator in req.creators:
        platform = creator.get("platform", "chzzk").lower()
        creator_id = creator.get("creatorId", "").strip()
        if not creator_id:
            continue

        url = _build_url(platform, creator_id, req.startDate, req.endDate)

        try:
            if use_playwright:
                html = await _fetch_with_playwright(url)
            else:
                html = await _fetch_with_httpx(url)

            rows = _parse_html(html, creator_id, platform, start_year, req.categories)

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
            all_results.append({
                "creatorId": creator_id,
                "platform": platform.upper(),
                "streamCount": 0,
                "streams": [],
                "avgViewers": 0,
                "peakViewers": 0,
                "totalDurationMin": 0,
                "status": "error",
                "error": str(e),
                "scrapedAt": datetime.utcnow().isoformat() + "Z",
            })

    return all_results
