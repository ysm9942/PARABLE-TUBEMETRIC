"""
SoftC.one 크롤러 — FastAPI 서버 버전 (GUI 없음)

viewership.softc.one 에서 CHZZK / SOOP 방송 지표를 수집하여
REST API로 결과를 제공합니다.

포트: 8002  (TubeMetric Agent 8001 과 충돌 없음)

API 엔드포인트:
  GET  /api/health           — 서버 상태 확인
  POST /api/crawl/start      — 크롤링 시작
  GET  /api/crawl/status     — 진행 상태 + 로그 조회
  POST /api/crawl/stop       — 크롤링 중지

빌드:
  cd installer && pyinstaller softc_scraper.spec
"""

import sys
import os
import re
import time
import random
import threading
import subprocess
import builtins
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import List, Optional
from urllib.parse import quote

# ── 타입 힌트 호환성 (Python 3.9 이하) ───────────────────────────────────────
if sys.version_info < (3, 10):
    from typing import Union

# ── 외부 라이브러리 ───────────────────────────────────────────────────────────
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# ── 전역 로그 버퍼 (최대 500줄) ──────────────────────────────────────────────
_LOG: deque = deque(maxlen=500)
_orig_print = builtins.print


def _log_print(*args, sep=" ", end="\n", file=None, flush=False):
    """print() 를 가로채 로그 버퍼에도 저장."""
    msg = sep.join(str(a) for a in args)
    if msg.strip():
        ts = datetime.now().strftime("%H:%M:%S")
        _LOG.append(f"[{ts}] {msg}")
    _orig_print(*args, sep=sep, end=end, file=file, flush=flush)


builtins.print = _log_print

# ── 전역 잡(Job) 상태 ────────────────────────────────────────────────────────
_job_lock  = threading.Lock()
_stop_evt  = threading.Event()

_job_state: dict = {
    "status":           "idle",   # idle | running | done | error
    "progress_current": "",
    "progress_done":    0,
    "progress_total":   0,
    "results":          [],
    "error":            None,
}


# ══════════════════════════════════════════════════════════════════════════════
# 크롤러 핵심 로직  (GUI 코드 제거 / headless 전환)
# ══════════════════════════════════════════════════════════════════════════════

def _crawl_creator(
    platform: str,
    creator_id: str,
    start_dt: datetime,
    end_dt: datetime,
    categories: list,
    stop_event: threading.Event,
) -> list:
    """
    viewership.softc.one 에서 크리에이터의 방송 지표를 수집.
    headless Chrome 으로 실행됩니다.

    platform   : 'chzzk' 또는 'soop'
    creator_id : 크리에이터 채널 ID
    """
    import undetected_chromedriver as uc
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import (
        TimeoutException,
        StaleElementReferenceException,
    )
    from bs4 import BeautifulSoup

    # ── Chrome 버전 감지 (Windows 레지스트리) ─────────────────────────────
    def _get_chrome_ver() -> Optional[int]:
        cmds = [
            r'reg query "HKEY_CURRENT_USER\Software\Google\Chrome\BLBeacon" /v version',
            r'reg query "HKEY_LOCAL_MACHINE\Software\Google\Chrome\BLBeacon" /v version',
            r'reg query "HKEY_LOCAL_MACHINE\Software\WOW6432Node\Google\Chrome\BLBeacon" /v version',
        ]
        for cmd in cmds:
            try:
                out = subprocess.check_output(
                    cmd, shell=True, text=True,
                    encoding="utf-8", errors="ignore",
                )
                m = re.search(r"(\d+)\.\d+\.\d+\.\d+", out)
                if m:
                    return int(m.group(1))
            except Exception:
                continue
        return None

    # ── URL 구성 ──────────────────────────────────────────────────────────
    BASE       = "https://viewership.softc.one"
    PLAT_PATH  = {"chzzk": "naverchzzk", "soop": "afreeca"}.get(platform, platform)
    start_utc  = (
        start_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        - timedelta(hours=9)
    ).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    end_utc    = (
        end_dt.replace(hour=14, minute=59, second=59, microsecond=999000)
        - timedelta(hours=9)
    ).strftime("%Y-%m-%dT%H:%M:%S.999Z")
    url = (
        f"{BASE}/channel/{PLAT_PATH}/{creator_id}/streams"
        f"?startDateTime={quote(start_utc)}&endDateTime={quote(end_utc)}"
    )

    # ── CSS 셀렉터 ────────────────────────────────────────────────────────
    STREAM_SEL  = (
        "a[href*='/streams/'] > button.min-h-11.py-2.hidden.lg\\:flex"
        ".gap-4.text-xs.items-center.font-medium.leading-none"
        ".rounded-lg.px-6.transition-all"
    )
    PAGE_BTN_SEL = "button.font-inter.text-xs.w-8.h-8"

    # ── 드라이버 초기화 (headless) ────────────────────────────────────────
    print(f"  [{creator_id}] 드라이버 시작 중...")
    chrome_major = _get_chrome_ver()
    print(f"  [{creator_id}] Chrome major: {chrome_major if chrome_major else '자동감지'}")

    opts = uc.ChromeOptions()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1920,1080")
    opts.add_argument("--disable-blink-features=AutomationControlled")

    try:
        if chrome_major:
            driver = uc.Chrome(options=opts, version_main=chrome_major)
        else:
            driver = uc.Chrome(options=opts)
        driver.implicitly_wait(3)
    except Exception as e:
        import traceback
        print(f"  [{creator_id}] [드라이버 오류] {e}\n{traceback.format_exc()}")
        raise

    print(f"  [{creator_id}] 드라이버 준비 완료")

    # ── 페이지네이션 헬퍼 ─────────────────────────────────────────────────
    def _num_page_btns():
        btns = driver.find_elements(By.CSS_SELECTOR, PAGE_BTN_SEL)
        return [b for b in btns if (b.text or "").strip().isdigit()]

    def _click_page(target: str, timeout=5.0) -> bool:
        end_t = time.time() + timeout
        while time.time() < end_t:
            btns = _num_page_btns()
            btn  = next((b for b in btns if (b.text or "").strip() == target), None)
            if btn:
                try:
                    driver.execute_script(
                        "arguments[0].scrollIntoView({block:'center'});", btn
                    )
                    time.sleep(0.2)
                    btn.click()
                    return True
                except (StaleElementReferenceException, Exception):
                    pass
            time.sleep(0.2)
        return False

    def _wait_page_change(before_text: str, timeout=7.0) -> bool:
        end_t = time.time() + timeout
        while time.time() < end_t:
            try:
                elems = driver.find_elements(By.CSS_SELECTOR, STREAM_SEL)
                after = (elems[0].text or "").strip() if elems else ""
                if after and after != before_text:
                    return True
            except Exception:
                pass
            time.sleep(0.2)
        return False

    # ── 페이지 파싱 ───────────────────────────────────────────────────────
    def _parse_page() -> list:
        soup = BeautifulSoup(driver.page_source, "html.parser")
        rows = []
        for a in soup.select("a[href*='/streams/']"):
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

            # 카테고리 / 제목
            col0  = cols[0] if cols else None
            divs  = col0.find_all("div") if col0 else []
            cat   = _t(divs[0]) if len(divs) >= 1 else _t(col0)
            title = _t(divs[1]) if len(divs) >= 2 else ""

            # 날짜 (MM.DD 형식)
            period   = _t(cols[1]) if len(cols) > 1 else ""
            date_m   = re.search(r'(\d{1,2})\.(\d{2})', period)
            date_str = (
                f"{start_dt.year}-{int(date_m.group(1)):02d}-{int(date_m.group(2)):02d}"
                if date_m else ""
            )

            # 방송시간(h) → 분
            dur_text = _t(cols[2]) if len(cols) > 2 else ""
            dur_m    = re.search(r'(\d+(?:\.\d+)?)', dur_text)
            dur_min  = int(float(dur_m.group(1)) * 60) if dur_m else 0

            peak = _n(cols[3]) if len(cols) > 3 else 0
            avg  = _n(cols[4]) if len(cols) > 4 else 0

            # 카테고리 필터
            if categories and cat and not any(
                c.lower() in cat.lower() for c in categories
            ):
                continue

            rows.append({
                "creator":      creator_id,
                "platform":     platform.upper(),
                "title":        title,
                "category":     cat,
                "peak_viewers": peak,
                "avg_viewers":  avg,
                "date":         date_str,
                "duration_min": dur_min,
            })
        return rows

    # ── 메인 크롤링 루프 ──────────────────────────────────────────────────
    results = []
    try:
        print(f"  [{creator_id}] URL: {url}")
        driver.get(url)
        try:
            WebDriverWait(driver, 15).until(
                EC.presence_of_all_elements_located((By.CSS_SELECTOR, STREAM_SEL))
            )
        except TimeoutException:
            print(f"  [{creator_id}] ⚠ 요소 대기 타임아웃 — 파싱 시도 계속")

        page = 1
        while not stop_event.is_set():
            print(f"  [{creator_id}] {page}페이지 파싱 중...")
            rows = _parse_page()
            results.extend(rows)
            print(f"  [{creator_id}] → {len(rows)}건")

            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(0.5)

            next_page = str(page + 1)
            if not any((b.text or "").strip() == next_page for b in _num_page_btns()):
                break

            before = ""
            try:
                elems  = driver.find_elements(By.CSS_SELECTOR, STREAM_SEL)
                before = (elems[0].text or "").strip() if elems else ""
            except Exception:
                pass

            if not _click_page(next_page):
                break

            _wait_page_change(before)
            page += 1
            time.sleep(random.uniform(2.0, 4.0))

    finally:
        try:
            driver.quit()
        except Exception:
            pass

    return results


def _parse_creator_line(line: str, default_platform: str = "chzzk"):
    """
    'chzzk:채널ID' / 'soop:아이디' / URL 형식을 (platform, creator_id) 튜플로 변환.
    파싱 실패 시 None 반환.
    """
    line = line.strip()
    if not line or line.startswith("#"):
        return None

    # viewership.softc.one URL 직접 입력 지원
    if line.startswith("http"):
        m = re.search(r"softc\.one/channel/([^/]+)/([^/?#\s]+)", line)
        if m:
            raw_plat, cid = m.group(1), m.group(2)
            plat = "chzzk" if raw_plat == "naverchzzk" else raw_plat
            return (plat, cid) if cid else None
        return None

    if ":" in line:
        plat, cid = line.split(":", 1)
        plat = plat.strip().lower()
        cid  = cid.strip().lstrip("@")
        if plat not in ("chzzk", "soop"):
            plat = default_platform
    else:
        plat = default_platform
        cid  = line.lstrip("@").strip()

    return (plat, cid) if cid else None


def _run_crawl_job(
    creators: list,
    start_dt: datetime,
    end_dt: datetime,
    categories: list,
):
    """백그라운드 스레드에서 실행되는 크롤 잡."""
    global _job_state

    with _job_lock:
        _job_state.update({
            "status":           "running",
            "progress_current": "",
            "progress_done":    0,
            "progress_total":   len(creators),
            "results":          [],
            "error":            None,
        })

    all_results = []
    total = len(creators)

    try:
        for idx, (platform, creator_id) in enumerate(creators, 1):
            if _stop_evt.is_set():
                print(f"[잡] 중지 요청 — {creator_id} 건너뜀")
                break

            with _job_lock:
                _job_state["progress_current"] = creator_id
                _job_state["progress_done"]    = idx - 1

            print(f"\n[{idx}/{total}] {platform.upper()} : {creator_id} 수집 시작")

            try:
                rows = _crawl_creator(
                    platform, creator_id,
                    start_dt, end_dt,
                    categories, _stop_evt,
                )
                all_results.extend(rows)
                print(f"[{idx}/{total}] {creator_id} → {len(rows)}건 완료")
            except Exception as e:
                print(f"[{idx}/{total}] {creator_id} 오류: {e}")

        with _job_lock:
            _job_state.update({
                "status":           "done",
                "progress_done":    total,
                "progress_current": "",
                "results":          all_results,
            })
        print(f"\n[잡] 완료 — 총 {len(all_results)}건")

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[잡] 치명적 오류: {e}\n{tb}")
        with _job_lock:
            _job_state.update({
                "status": "error",
                "error":  str(e),
            })


# ══════════════════════════════════════════════════════════════════════════════
# FastAPI 앱
# ══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("=" * 55)
    print("  SoftC.one 크롤러 서버 시작")
    print("  http://localhost:8002")
    print("=" * 55)
    yield
    print("[서버] 종료")


app = FastAPI(
    title="SoftC Scraper Agent",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 요청 모델 ─────────────────────────────────────────────────────────────────

class CrawlStartRequest(BaseModel):
    """
    creators  : ["chzzk:채널ID", "soop:아이디", "https://viewership.softc.one/..."]
    start_date: "YYYY-MM-DD"
    end_date  : "YYYY-MM-DD"
    categories: [] 이면 전체 카테고리 수집
    """
    creators:   List[str]
    start_date: str
    end_date:   str
    categories: List[str] = []


# ── 엔드포인트 ────────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "mode": "softc-scraper", "version": "1.0.0"}


@app.post("/api/crawl/start")
async def crawl_start(req: CrawlStartRequest):
    """크롤링 잡 시작."""
    with _job_lock:
        if _job_state["status"] == "running":
            raise HTTPException(status_code=409, detail="이미 실행 중인 잡이 있습니다.")

    # 날짜 파싱
    try:
        start_dt = datetime.strptime(req.start_date, "%Y-%m-%d")
        end_dt   = datetime.strptime(req.end_date,   "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="날짜 형식은 YYYY-MM-DD 이어야 합니다.")

    if start_dt > end_dt:
        raise HTTPException(status_code=400, detail="시작일이 종료일보다 늦습니다.")

    # 크리에이터 파싱
    creators = []
    for line in req.creators:
        parsed = _parse_creator_line(line)
        if parsed:
            creators.append(parsed)

    if not creators:
        raise HTTPException(status_code=400, detail="유효한 크리에이터가 없습니다.")

    # 잡 초기화
    _LOG.clear()
    _stop_evt.clear()

    thread = threading.Thread(
        target=_run_crawl_job,
        args=(creators, start_dt, end_dt, req.categories),
        daemon=True,
    )
    thread.start()

    return {
        "status":  "started",
        "total":   len(creators),
        "creators": [f"{p}:{c}" for p, c in creators],
    }


@app.get("/api/crawl/status")
async def crawl_status():
    """잡 진행 상태 + 최근 로그 반환."""
    with _job_lock:
        state = dict(_job_state)

    return {
        "status":   state["status"],
        "progress": {
            "current": state["progress_current"],
            "done":    state["progress_done"],
            "total":   state["progress_total"],
        },
        "results_count": len(state["results"]),
        "results":       state["results"],
        "error":         state["error"],
        "log":           list(_LOG)[-100:],   # 최근 100줄
    }


@app.post("/api/crawl/stop")
async def crawl_stop():
    """실행 중인 잡을 중지 요청."""
    _stop_evt.set()
    return {"status": "stopping"}


# ── 진입점 ────────────────────────────────────────────────────────────────────

def main():
    uvicorn.run(app, host="127.0.0.1", port=8002, log_level="warning")


if __name__ == "__main__":
    main()
