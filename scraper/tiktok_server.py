"""
TikTok 동영상 스크래퍼 — FastAPI 서버 버전 (로컬 에이전트)

로컬 PC에서 실행되며 브라우저로 TikTok 동영상 지표를 수집하여
REST API로 결과를 제공합니다.

포트: 8004

API 엔드포인트:
  GET  /api/health           — 서버 상태 확인
  POST /api/crawl/start      — 크롤링 시작
  GET  /api/crawl/status     — 진행 상태 + 로그 조회
  POST /api/crawl/stop       — 크롤링 중지
"""

import builtins
import os
import sys
import threading
from collections import deque
from datetime import datetime, timezone
from typing import List

from fastapi import FastAPI
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


# ── 크롤링 잡 실행 ────────────────────────────────────────────────────────────

def _run_crawl_job(usernames: list[str], amount: int, headless: bool):
    global _job_state
    with _job_lock:
        _job_state.update({
            "status":           "running",
            "progress_current": "",
            "progress_done":    0,
            "progress_total":   len(usernames),
            "results":          [],
            "error":            None,
        })

    all_results = []
    total = len(usernames)

    try:
        from tiktok_scraper import _build_driver, fetch_user_videos

        driver = _build_driver(headless=headless)
        try:
            for idx, raw in enumerate(usernames, 1):
                if _stop_evt.is_set():
                    break
                username = raw.lstrip("@").strip()
                if not username:
                    continue

                with _job_lock:
                    _job_state["progress_current"] = username
                    _job_state["progress_done"] = idx - 1

                print(f"\n[{idx}/{total}] @{username} 수집 시작")
                try:
                    data = fetch_user_videos(driver, username, amount)
                    all_results.append(data)
                    print(f"  ✅ @{username} → {data['videoCount']}개, 평균 {data['avgViews']:,} 조회")
                except Exception as e:
                    print(f"  ❌ @{username} 오류: {e}")
                    all_results.append({
                        "username":   username,
                        "videoCount": 0,
                        "videos":     [],
                        "avgViews":   0,
                        "status":     "error",
                        "error":      str(e),
                        "scrapedAt":  datetime.now(timezone.utc).isoformat(),
                    })
        finally:
            try:
                driver.quit()
            except Exception:
                pass

        with _job_lock:
            _job_state["results"]          = all_results
            _job_state["progress_done"]    = total
            _job_state["progress_current"] = ""
            _job_state["status"]           = "done"

    except Exception as e:
        print(f"[치명적 오류] {e}")
        with _job_lock:
            _job_state["status"] = "error"
            _job_state["error"]  = str(e)


# ── FastAPI 앱 ────────────────────────────────────────────────────────────────

app = FastAPI(title="TubeMetric TikTok Agent", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class CrawlStartRequest(BaseModel):
    usernames: List[str]
    amount:    int  = 20
    headless:  bool = True


@app.get("/api/health")
def health():
    return {"status": "ok", "port": 8004, "service": "tiktok-agent"}


@app.post("/api/crawl/start")
def start_crawl(req: CrawlStartRequest):
    with _job_lock:
        if _job_state["status"] == "running":
            return {"status": "already_running"}

    _stop_evt.clear()
    t = threading.Thread(
        target=_run_crawl_job,
        args=(req.usernames, req.amount, req.headless),
        daemon=True,
    )
    t.start()
    return {"status": "started"}


@app.get("/api/crawl/status")
def get_status():
    with _job_lock:
        return {
            "status":           _job_state["status"],
            "progress_current": _job_state["progress_current"],
            "progress_done":    _job_state["progress_done"],
            "progress_total":   _job_state["progress_total"],
            "results":          _job_state["results"],
            "error":            _job_state["error"],
            "logs":             list(_LOG)[-50:],
        }


@app.post("/api/crawl/stop")
def stop_crawl():
    _stop_evt.set()
    with _job_lock:
        if _job_state["status"] == "running":
            _job_state["status"] = "idle"
    return {"status": "stopped"}


# ── 진입점 ────────────────────────────────────────────────────────────────────

def main():
    # PyInstaller console=False 시 stdout/stderr가 None → devnull로 리디렉트
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")

    uvicorn.run(app, host="127.0.0.1", port=8004, log_level="warning")


if __name__ == "__main__":
    main()
