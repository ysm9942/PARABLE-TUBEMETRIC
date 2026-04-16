"""
SoftC.one 크롤러 — FastAPI 서버 버전 (GUI 없음 · headless=False)

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
import shutil
import tempfile
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

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# ── 전역 로그 버퍼 (최대 500줄) ──────────────────────────────────────────────
_LOG: deque = deque(maxlen=500)
_orig_print = builtins.print


def _log_print(*args, sep=" ", end="\n", file=None, flush=False):
    msg = sep.join(str(a) for a in args)
    if msg.strip():
        ts = datetime.now().strftime("%H:%M:%S")
        _LOG.append(f"[{ts}] {msg}")
    _orig_print(*args, sep=sep, end=end, file=file, flush=flush)


builtins.print = _log_print

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

# ── 크롤링 파라미터 ───────────────────────────────────────────────────────────
DELAY_MIN         = 2
DELAY_MAX         = 4
TARGET_COOLDOWN   = (3, 6)
PAGEWAIT_SEC      = 10
URL_MAX_RETRY     = 2
PAGE_FULL_SIZE    = 100   # 이 행수면 다음 페이지 반드시 존재

# ── 블랙리스트 ────────────────────────────────────────────────────────────────
BLACKLIST_CATS   = {"연령제한", "미설정", "주", "lb"}
EXACT_BLOCK_CATS = {"노"}


# ══════════════════════════════════════════════════════════════════════════════
# DOM 파싱 유틸
# ══════════════════════════════════════════════════════════════════════════════

def _text(el):
    return el.get_text(strip=True) if el else ""


def _norm_num(s):
    if not s:
        return ""
    s = str(s).strip()
    m = re.match(r'^([+\-]?\d{1,3}(?:,\d{3})*|\d+)\s*([kK]?)$', s)
    if not m:
        return s
    n = int(m.group(1).replace(",", ""))
    if m.group(2):
        n *= 1000
    return str(n)


def _has_classes(tag, classes):
    return (
        tag.name == "div"
        and tag.has_attr("class")
        and all(c in tag["class"] for c in classes)
    )


def extract_category_and_title(raw_text: str, forced_cats=None):
    if not raw_text:
        return "", ""
    text = str(raw_text)
    found = []
    if forced_cats:
        for c in forced_cats:
            if c and c not in found:
                found.append(c)
        for c in sorted(forced_cats, key=len, reverse=True):
            text = text.replace(str(c), " ")
    filtered = [
        c for c in found
        if c.strip() not in EXACT_BLOCK_CATS
        and not any(b in c for b in BLACKLIST_CATS)
    ]
    title_remain = text
    for cat in sorted(filtered, key=len, reverse=True):
        title_remain = title_remain.replace(cat, " ")
    title_remain = re.sub(r"[\s\|\[\]\(\)·,:/\\\-]+", " ", title_remain).strip(" _-·,|").strip()
    return ", ".join(filtered), title_remain


def parse_buttons_dom(btns, creator_id: str, platform: str, start_year: int) -> list:
    rows = []
    for b in btns:
        try:
            cols = b.find_all("div", recursive=False)
            if len(cols) < 5:
                cols = b.find_all("div", recursive=True)

            col0 = cols[0] if cols else None
            cat_text, title_text = "", ""
            forced = []
            if col0:
                badge = col0.find(lambda t: _has_classes(
                    t, ["flex", "items-center", "gap-1", "whitespace-nowrap", "overflow-hidden"]
                ))
                if badge:
                    fc = _text(badge)
                    if fc:
                        forced.append(fc)
                smalls = col0.find_all("div")
                cat_text   = _text(smalls[0]) if len(smalls) >= 1 else ""
                title_text = _text(smalls[1]) if len(smalls) >= 2 else ""
            combined = " ".join(t for t in [cat_text, title_text] if t).strip() or _text(b)
            cat, title = extract_category_and_title(combined, forced_cats=forced)

            # 날짜
            period = ""
            if len(cols) > 1:
                lines = [d.get_text(strip=True) for d in cols[1].find_all("div")]
                period = " ".join(lines) if lines else _text(cols[1])
            date_m   = re.search(r'(\d{1,2})\.(\d{2})', period)
            date_str = (
                f"{start_year}-{int(date_m.group(1)):02d}-{int(date_m.group(2)):02d}"
                if date_m else ""
            )

            # 방송시간 h → min
            dur_text = ""
            if len(cols) > 2:
                sp = cols[2].find("span", class_="font-mono")
                num = _text(sp) if sp else _text(cols[2])
                dur_text = f"{num}h" if num else ""
            dur_m   = re.search(r'(\d+(?:\.\d+)?)', dur_text)
            dur_min = int(float(dur_m.group(1)) * 60) if dur_m else 0

            def _col_num(idx):
                if len(cols) <= idx:
                    return 0
                sp  = cols[idx].find("span", class_="font-mono")
                raw = _text(sp) if sp else _text(cols[idx])
                v   = re.sub(r"[^\d]", "", raw)
                return int(v) if v else 0

            def _col_str(idx):
                if len(cols) <= idx:
                    return ""
                sp = cols[idx].find("span", class_="font-mono")
                return _norm_num(_text(sp) if sp else _text(cols[idx]).replace("\n", " ").strip())

            rows.append({
                "creator":         creator_id,
                "platform":        platform.upper(),
                "title":           title,
                "category":        cat,
                "peak_viewers":    _col_num(3),
                "avg_viewers":     _col_num(4),
                "date":            date_str,
                "duration_min":    dur_min,
                "total_chat":      _col_str(5),
                "follower_change": _col_str(6),
            })
        except Exception:
            rows.append({
                "creator": creator_id, "platform": platform.upper(),
                "title": "", "category": "", "peak_viewers": 0, "avg_viewers": 0,
                "date": "", "duration_min": 0, "total_chat": "", "follower_change": "",
            })
    return rows


# ══════════════════════════════════════════════════════════════════════════════
# Chrome 버전 감지
# ══════════════════════════════════════════════════════════════════════════════

def _get_chrome_ver() -> Optional[int]:
    if sys.platform.startswith("win"):
        cmds = [
            r'reg query "HKEY_CURRENT_USER\Software\Google\Chrome\BLBeacon" /v version',
            r'reg query "HKEY_LOCAL_MACHINE\Software\Google\Chrome\BLBeacon" /v version',
            r'reg query "HKEY_LOCAL_MACHINE\Software\WOW6432Node\Google\Chrome\BLBeacon" /v version',
        ]
        for cmd in cmds:
            try:
                out = subprocess.check_output(cmd, shell=True, text=True, encoding="utf-8", errors="ignore")
                m = re.search(r"(\d+)\.\d+\.\d+\.\d+", out)
                if m:
                    return int(m.group(1))
            except Exception:
                continue
    else:
        for binary in ("google-chrome", "google-chrome-stable", "chromium-browser", "chromium"):
            try:
                out = subprocess.check_output([binary, "--version"], text=True, stderr=subprocess.DEVNULL)
                m = re.search(r"(\d+)\.\d+", out)
                if m:
                    return int(m.group(1))
            except Exception:
                continue
    return None


# ══════════════════════════════════════════════════════════════════════════════
# 크롤러 (headless=False · undetected_chromedriver)
# ══════════════════════════════════════════════════════════════════════════════

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
    from selenium.common.exceptions import (
        TimeoutException,
        StaleElementReferenceException,
        ElementClickInterceptedException,
    )
    from selenium.webdriver.common.action_chains import ActionChains
    from bs4 import BeautifulSoup

    STREAM_SEL   = (
        "a[href*='/streams/'] > button.min-h-11.py-2.hidden.lg\\:flex"
        ".gap-4.text-xs.items-center.font-medium.leading-none"
        ".rounded-lg.px-6.transition-all"
    )
    PAGE_BTN_SEL = "button.font-inter.text-xs.w-8.h-8"

    PLAT_PATH = {"chzzk": "naverchzzk", "soop": "afreeca", "youtube": "youtube", "cime": "cime"}.get(platform, platform)
    start_utc = (
        start_dt.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(hours=9)
    ).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    end_utc = (
        end_dt.replace(hour=14, minute=59, second=59, microsecond=999000) - timedelta(hours=9)
    ).strftime("%Y-%m-%dT%H:%M:%S.999Z")
    url = (
        f"https://viewership.softc.one/channel/{PLAT_PATH}/{creator_id}/streams"
        f"?startDateTime={quote(start_utc)}&endDateTime={quote(end_utc)}"
    )

    # ── headless=False Chrome ─────────────────────────────────────────────
    print(f"  [{creator_id}] 드라이버 시작...")
    chrome_major = _get_chrome_ver()
    print(f"  [{creator_id}] Chrome: {chrome_major or '자동감지'}")

    # 독립적인 Chrome 프로파일 → 다른 스크래퍼(8001/8003)와 충돌 방지
    tmp_dir = tempfile.mkdtemp(prefix="sc_chrome_")

    opts = uc.ChromeOptions()
    opts.add_argument(f"--user-data-dir={tmp_dir}")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--start-maximized")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    # ※ --headless 를 추가하지 않으므로 headless=False (실제 브라우저 창 표시)

    try:
        driver = uc.Chrome(options=opts, version_main=chrome_major) if chrome_major else uc.Chrome(options=opts)
        driver.implicitly_wait(3)
    except Exception as e:
        import traceback
        shutil.rmtree(tmp_dir, ignore_errors=True)
        print(f"  [{creator_id}] 드라이버 오류: {e}\n{traceback.format_exc()}")
        raise

    print(f"  [{creator_id}] 드라이버 준비")

    # ── 페이지네이션 헬퍼 ─────────────────────────────────────────────────
    def _get_num_btns():
        btns = driver.find_elements(By.CSS_SELECTOR, PAGE_BTN_SEL)
        return [b for b in btns if (b.text or "").strip().isdigit()]

    def _scroll_bottom():
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(random.uniform(0.15, 0.35))

    def _scroll_top():
        driver.execute_script("window.scrollTo(0, 0);")
        time.sleep(random.uniform(0.10, 0.25))

    def _wait_btn(target: str, timeout=3.5) -> bool:
        end = time.time() + timeout
        while time.time() < end:
            if any((b.text or "").strip() == target for b in _get_num_btns()):
                return True
            time.sleep(0.15)
        return False

    def _robust_click(target: str) -> bool:
        if not _wait_btn(target, 4.0):
            return False
        for _ in range(4):
            try:
                btn = next((b for b in _get_num_btns() if (b.text or "").strip() == target), None)
                if not btn:
                    time.sleep(0.2)
                    continue
                driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
                time.sleep(random.uniform(0.15, 0.35))
                try:
                    WebDriverWait(driver, 3).until(EC.element_to_be_clickable(btn))
                except Exception:
                    pass
                for clicker in [
                    lambda b=btn: b.click(),
                    lambda b=btn: ActionChains(driver).move_to_element(b).pause(0.1).click(b).perform(),
                    lambda b=btn: driver.execute_script("arguments[0].click();", b),
                ]:
                    try:
                        clicker()
                        return True
                    except (ElementClickInterceptedException, StaleElementReferenceException):
                        pass
                    except Exception:
                        pass
            except Exception:
                time.sleep(0.2)
        return False

    def _first_row_text():
        try:
            rows = driver.find_elements(By.CSS_SELECTOR, STREAM_SEL)
            return (rows[0].text or "").strip() if rows else "", rows
        except Exception:
            return "", []

    def _wait_page_change(before: str, before_rows, timeout=7.0) -> bool:
        try:
            if before_rows:
                WebDriverWait(driver, 3).until(EC.staleness_of(before_rows[0]))
        except Exception:
            pass
        end_t = time.time() + timeout
        while time.time() < end_t:
            try:
                WebDriverWait(driver, 3).until(
                    EC.presence_of_all_elements_located((By.CSS_SELECTOR, STREAM_SEL))
                )
                rows = driver.find_elements(By.CSS_SELECTOR, STREAM_SEL)
                after = (rows[0].text or "").strip() if rows else ""
                if after and after != before:
                    return True
            except Exception:
                pass
            time.sleep(0.2)
        return False

    def _force_go_to_page(target: str, max_rounds=5) -> bool:
        for _ in range(max_rounds):
            _scroll_bottom()
            before, before_rows = _first_row_text()
            if not _wait_btn(target, 2.8):
                _scroll_top()
                _scroll_bottom()
                if not _wait_btn(target, 2.2):
                    try:
                        driver.refresh()
                    except Exception:
                        pass
                    time.sleep(random.uniform(0.8, 1.4))
                    continue
            if not _robust_click(target):
                try:
                    driver.refresh()
                except Exception:
                    pass
                time.sleep(random.uniform(0.8, 1.4))
                continue
            if _wait_page_change(before, before_rows, 7.0):
                return True
            time.sleep(random.uniform(0.6, 1.0))
        return False

    def _parse_current():
        soup = BeautifulSoup(driver.page_source, "html.parser")
        btns = soup.select(STREAM_SEL)
        rows = parse_buttons_dom(btns, creator_id, platform, start_dt.year)
        if categories:
            rows = [r for r in rows if r["category"] and any(
                c.lower() in r["category"].lower() for c in categories
            )]
        return btns, rows

    # ── 크롤링 루프 ───────────────────────────────────────────────────────
    def _attempt_once():
        print(f"  [{creator_id}] {url}")
        driver.get(url)
        try:
            WebDriverWait(driver, PAGEWAIT_SEC).until(
                EC.presence_of_all_elements_located((By.CSS_SELECTOR, STREAM_SEL))
            )
        except TimeoutException:
            print(f"  [{creator_id}] ⚠ 요소 대기 타임아웃")
        time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))

        results = []
        page = 1
        while not stop_event.is_set():
            btns, rows = _parse_current()
            results.extend(rows)
            row_count = len(btns)
            print(f"  [{creator_id}] {page}p → {row_count}행 ({len(rows)}건)")
            time.sleep(random.uniform(0.8, 1.6))

            next_pg   = str(page + 1)
            must_next = (row_count >= PAGE_FULL_SIZE)
            _scroll_bottom()

            if must_next:
                if not _force_go_to_page(next_pg, max_rounds=6):
                    raise RuntimeError(f"{page}p가 {PAGE_FULL_SIZE}행인데 {next_pg}p 진입 실패")
                page += 1
                time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))
                continue

            if not _wait_btn(next_pg, 1.8):
                break
            before, before_rows = _first_row_text()
            if not _robust_click(next_pg):
                break
            _wait_page_change(before, before_rows, 7.0)
            page += 1
            time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))

        if not results:
            raise RuntimeError("파싱 결과가 없습니다.")
        return results

    try:
        for attempt in range(1, URL_MAX_RETRY + 1):
            try:
                print(f"   ↻ 시도 {attempt}/{URL_MAX_RETRY}")
                return _attempt_once()
            except Exception as e:
                print(f"   ⚠ 실패({attempt}): {e}")
                if attempt < URL_MAX_RETRY:
                    cd = random.uniform(3.0, 6.0)
                    print(f"   ⏳ {cd:.1f}s 후 재시도")
                    time.sleep(cd)
                else:
                    raise
    finally:
        try:
            driver.quit()
        except Exception:
            pass
        shutil.rmtree(tmp_dir, ignore_errors=True)


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
        if plat not in ("chzzk", "soop"):
            plat = default_platform
    else:
        plat = default_platform
        cid  = line.lstrip("@").strip()
    return (plat, cid) if cid else None


def _run_crawl_job(creators: list, start_dt: datetime, end_dt: datetime, categories: list):
    global _job_state
    with _job_lock:
        _job_state.update({
            "status": "running", "progress_current": "",
            "progress_done": 0, "progress_total": len(creators),
            "results": [], "error": None,
        })

    all_results = []
    total = len(creators)
    try:
        for idx, (platform, creator_id) in enumerate(creators, 1):
            if _stop_evt.is_set():
                break
            with _job_lock:
                _job_state["progress_current"] = creator_id
                _job_state["progress_done"]    = idx - 1
            print(f"\n[{idx}/{total}] {platform.upper()} : {creator_id}")
            if idx > 1:
                cd = random.uniform(*TARGET_COOLDOWN)
                print(f"  ⏳ 쿨다운 {cd:.1f}s")
                time.sleep(cd)
            try:
                rows = _crawl_creator(platform, creator_id, start_dt, end_dt, categories, _stop_evt)
                all_results.extend(rows)
                print(f"  ✅ {creator_id} → {len(rows)}건")
            except Exception as e:
                print(f"  ❌ {creator_id} 오류: {e}")

        with _job_lock:
            _job_state.update({
                "status": "done", "progress_done": total,
                "progress_current": "", "results": all_results,
            })
        print(f"\n[완료] 총 {len(all_results)}건")
    except Exception as e:
        import traceback
        print(f"[치명 오류] {e}\n{traceback.format_exc()}")
        with _job_lock:
            _job_state.update({"status": "error", "error": str(e)})


# ══════════════════════════════════════════════════════════════════════════════
# FastAPI 앱
# ══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("=" * 55)
    print("  TubeMetric SoftC Scraper Agent  v1.1")
    print("  http://localhost:8002")
    print("  headless=False · undetected_chromedriver")
    print("=" * 55)
    yield
    print("[서버] 종료")


app = FastAPI(title="SoftC Scraper Agent", version="1.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CrawlStartRequest(BaseModel):
    creators:   List[str]
    start_date: str
    end_date:   str
    categories: List[str] = []


@app.get("/api/health")
async def health():
    return {"status": "ok", "mode": "softc-scraper-local", "version": "1.1.0"}


@app.post("/api/crawl/start")
async def crawl_start(req: CrawlStartRequest):
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

    return {"status": "started", "total": len(creators), "creators": [f"{p}:{c}" for p, c in creators]}


@app.get("/api/crawl/status")
async def crawl_status():
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


@app.post("/api/crawl/stop")
async def crawl_stop():
    _stop_evt.set()
    return {"status": "stopping"}


def main():
    # PyInstaller console=False 모드에서 sys.stdout/stderr가 None이면
    # uvicorn 로깅 초기화가 NoneType.isatty() 오류로 실패함 → devnull로 대체
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")

    uvicorn.run(app, host="127.0.0.1", port=8002, log_level="warning", log_config=None)


if __name__ == "__main__":
    main()
