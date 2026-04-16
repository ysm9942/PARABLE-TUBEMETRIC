"""
SoftC.one 크롤러 라우터 — Render.com 백엔드 통합 버전

Linux 서버(Render)에서 headless=False Chrome 실행을 위해
Xvfb 가상 디스플레이를 사용합니다.

엔드포인트:
  GET  /api/softc/health         — 상태 확인
  POST /api/softc/crawl/start    — 크롤링 시작
  GET  /api/softc/crawl/status   — 진행 상태 + 로그
  POST /api/softc/crawl/stop     — 크롤링 중지
"""

import os
import re
import sys
import time
import random
import threading
import subprocess
from collections import deque
from datetime import datetime, timedelta
from typing import List, Optional
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

# ── 전역 로그 버퍼 ──────────────────────────────────────────────────────────
_LOG: deque = deque(maxlen=500)

def _log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    _LOG.append(f"[{ts}] {msg}")


# ── 전역 잡(Job) 상태 ────────────────────────────────────────────────────────
_job_lock = threading.Lock()
_stop_evt = threading.Event()

_job_state: dict = {
    "status":           "idle",
    "progress_current": "",
    "progress_done":    0,
    "progress_total":   0,
    "results":          [],
    "error":            None,
}

_IS_LINUX = sys.platform.startswith("linux")


# ══════════════════════════════════════════════════════════════════════════════
# 크롤러 핵심 로직
# ══════════════════════════════════════════════════════════════════════════════

def _get_chrome_ver() -> Optional[int]:
    """Windows: 레지스트리, Linux: google-chrome --version"""
    if _IS_LINUX:
        try:
            out = subprocess.check_output(
                ["google-chrome", "--version"], text=True, stderr=subprocess.DEVNULL
            )
            m = re.search(r"(\d+)\.\d+\.\d+", out)
            return int(m.group(1)) if m else None
        except Exception:
            return None
    else:
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


def _crawl_creator(
    platform: str,
    creator_id: str,
    start_dt: datetime,
    end_dt: datetime,
    categories: list,
    stop_event: threading.Event,
) -> list:
    import undetected_chromedriver as uc
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import TimeoutException, StaleElementReferenceException
    from bs4 import BeautifulSoup

    # ── URL 구성 ──────────────────────────────────────────────────────────
    BASE      = "https://viewership.softc.one"
    PLAT_PATH = {"chzzk": "naverchzzk", "soop": "afreeca", "youtube": "youtube", "cime": "cime"}.get(platform, platform)
    start_utc = (
        start_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        - timedelta(hours=9)
    ).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    end_utc = (
        end_dt.replace(hour=14, minute=59, second=59, microsecond=999000)
        - timedelta(hours=9)
    ).strftime("%Y-%m-%dT%H:%M:%S.999Z")
    url = (
        f"{BASE}/channel/{PLAT_PATH}/{creator_id}/streams"
        f"?startDateTime={quote(start_utc)}&endDateTime={quote(end_utc)}"
    )

    STREAM_SEL  = (
        "a[href*='/streams/'] > button.min-h-11.py-2.hidden.lg\\:flex"
        ".gap-4.text-xs.items-center.font-medium.leading-none"
        ".rounded-lg.px-6.transition-all"
    )
    PAGE_BTN_SEL = "button.font-inter.text-xs.w-8.h-8"

    # ── Chrome 옵션 ───────────────────────────────────────────────────────
    _log(f"[{creator_id}] 드라이버 시작 중...")
    chrome_major = _get_chrome_ver()
    _log(f"[{creator_id}] Chrome major: {chrome_major if chrome_major else '자동감지'}")

    opts = uc.ChromeOptions()
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1920,1080")
    opts.add_argument("--disable-blink-features=AutomationControlled")

    # ── Xvfb 가상 디스플레이 (Linux 전용) ────────────────────────────────
    vdisplay = None
    if _IS_LINUX:
        try:
            from xvfbwrapper import Xvfb
            vdisplay = Xvfb(width=1920, height=1080, colordepth=24)
            vdisplay.start()
            _log(f"[{creator_id}] Xvfb 가상 디스플레이 시작")
        except Exception as e:
            _log(f"[{creator_id}] Xvfb 시작 실패 (무시): {e}")
            vdisplay = None

    try:
        if chrome_major:
            driver = uc.Chrome(options=opts, version_main=chrome_major)
        else:
            driver = uc.Chrome(options=opts)
        driver.implicitly_wait(3)
    except Exception as e:
        import traceback
        _log(f"[{creator_id}] 드라이버 오류: {e}\n{traceback.format_exc()}")
        if vdisplay:
            try:
                vdisplay.stop()
            except Exception:
                pass
        raise

    _log(f"[{creator_id}] 드라이버 준비 완료")

    # ── 페이지네이션 헬퍼 ─────────────────────────────────────────────────
    def _num_page_btns():
        btns = driver.find_elements(By.CSS_SELECTOR, PAGE_BTN_SEL)
        return [b for b in btns if (b.text or "").strip().isdigit()]

    def _click_page(target: str, timeout=5.0) -> bool:
        end_t = time.time() + timeout
        while time.time() < end_t:
            btns = _num_page_btns()
            btn = next((b for b in btns if (b.text or "").strip() == target), None)
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

            col0  = cols[0] if cols else None
            divs  = col0.find_all("div") if col0 else []
            cat   = _t(divs[0]) if len(divs) >= 1 else _t(col0)
            title = _t(divs[1]) if len(divs) >= 2 else ""

            period   = _t(cols[1]) if len(cols) > 1 else ""
            date_m   = re.search(r'(\d{1,2})\.(\d{2})', period)
            date_str = (
                f"{start_dt.year}-{int(date_m.group(1)):02d}-{int(date_m.group(2)):02d}"
                if date_m else ""
            )

            dur_text = _t(cols[2]) if len(cols) > 2 else ""
            dur_m    = re.search(r'(\d+(?:\.\d+)?)', dur_text)
            dur_min  = int(float(dur_m.group(1)) * 60) if dur_m else 0

            peak = _n(cols[3]) if len(cols) > 3 else 0
            avg  = _n(cols[4]) if len(cols) > 4 else 0

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
        _log(f"[{creator_id}] URL: {url}")
        driver.get(url)
        try:
            WebDriverWait(driver, 15).until(
                EC.presence_of_all_elements_located((By.CSS_SELECTOR, STREAM_SEL))
            )
        except TimeoutException:
            _log(f"[{creator_id}] ⚠ 요소 대기 타임아웃 — 파싱 시도 계속")

        page = 1
        while not stop_event.is_set():
            _log(f"[{creator_id}] {page}페이지 파싱 중...")
            rows = _parse_page()
            results.extend(rows)
            _log(f"[{creator_id}] → {len(rows)}건")

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
        if vdisplay:
            try:
                vdisplay.stop()
            except Exception:
                pass

    return results


def _parse_creator_line(line: str, default_platform: str = "chzzk"):
    line = line.strip()
    if not line or line.startswith("#"):
        return None

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
        if plat not in ("chzzk", "soop", "youtube", "cime"):
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
                _log(f"[잡] 중지 요청 — {creator_id} 건너뜀")
                break

            with _job_lock:
                _job_state["progress_current"] = creator_id
                _job_state["progress_done"]    = idx - 1

            _log(f"[{idx}/{total}] {platform.upper()} : {creator_id} 수집 시작")

            try:
                rows = _crawl_creator(
                    platform, creator_id,
                    start_dt, end_dt,
                    categories, _stop_evt,
                )
                all_results.extend(rows)
                _log(f"[{idx}/{total}] {creator_id} → {len(rows)}건 완료")
            except Exception as e:
                _log(f"[{idx}/{total}] {creator_id} 오류: {e}")

        with _job_lock:
            _job_state.update({
                "status":           "done",
                "progress_done":    total,
                "progress_current": "",
                "results":          all_results,
            })
        _log(f"[잡] 완료 — 총 {len(all_results)}건")

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        _log(f"[잡] 치명적 오류: {e}\n{tb}")
        with _job_lock:
            _job_state.update({
                "status": "error",
                "error":  str(e),
            })


# ══════════════════════════════════════════════════════════════════════════════
# 엔드포인트
# ══════════════════════════════════════════════════════════════════════════════

class CrawlStartRequest(BaseModel):
    creators:   List[str]
    start_date: str
    end_date:   str
    categories: List[str] = []


@router.get("/health")
def softc_health():
    return {
        "status": "ok",
        "mode":   "softc-scraper",
        "env":    "linux" if _IS_LINUX else "windows",
        "xvfb":   _IS_LINUX,
    }


@router.post("/crawl/start")
def crawl_start(req: CrawlStartRequest):
    with _job_lock:
        if _job_state["status"] == "running":
            raise HTTPException(status_code=409, detail="이미 실행 중인 잡이 있습니다.")

    try:
        start_dt = datetime.strptime(req.start_date, "%Y-%m-%d")
        end_dt   = datetime.strptime(req.end_date,   "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="날짜 형식은 YYYY-MM-DD 이어야 합니다.")

    if start_dt > end_dt:
        raise HTTPException(status_code=400, detail="시작일이 종료일보다 늦습니다.")

    creators = [p for line in req.creators if (p := _parse_creator_line(line))]
    if not creators:
        raise HTTPException(status_code=400, detail="유효한 크리에이터가 없습니다.")

    _LOG.clear()
    _stop_evt.clear()

    threading.Thread(
        target=_run_crawl_job,
        args=(creators, start_dt, end_dt, req.categories),
        daemon=True,
    ).start()

    return {
        "status":   "started",
        "total":    len(creators),
        "creators": [f"{p}:{c}" for p, c in creators],
    }


@router.get("/crawl/status")
def crawl_status():
    with _job_lock:
        state = dict(_job_state)

    return {
        "status":        state["status"],
        "progress": {
            "current": state["progress_current"],
            "done":    state["progress_done"],
            "total":   state["progress_total"],
        },
        "results_count": len(state["results"]),
        "results":       state["results"],
        "error":         state["error"],
        "log":           list(_LOG)[-100:],
    }


@router.post("/crawl/stop")
def crawl_stop():
    _stop_evt.set()
    return {"status": "stopping"}
