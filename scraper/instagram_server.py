"""
Instagram 릴스 스크래퍼 — FastAPI 서버 버전 (로컬 에이전트)

로컬 PC에서 실행되며 브라우저로 Instagram 릴스 지표를 수집하여
REST API로 결과를 제공합니다.

포트: 8003

API 엔드포인트:
  GET  /api/health              — 서버 상태 확인
  POST /api/crawl/start         — Instagram 크롤링 시작
  GET  /api/crawl/status        — Instagram 진행 상태 + 로그 조회
  POST /api/crawl/stop          — Instagram 크롤링 중지
  POST /api/tiktok/start        — TikTok 크롤링 시작
  GET  /api/tiktok/status       — TikTok 진행 상태 조회
  POST /api/tiktok/stop         — TikTok 크롤링 중지
"""

import builtins
import os
import sys
import threading
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import List

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

# ── Instagram 전역 잡(Job) 상태 ───────────────────────────────────────────────
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

# ── TikTok 전역 잡(Job) 상태 ──────────────────────────────────────────────────
_tk_job_lock = threading.Lock()
_tk_stop_evt = threading.Event()

_tk_job_state: dict = {
    "status":           "idle",
    "progress_current": "",
    "progress_done":    0,
    "progress_total":   0,
    "results":          [],
    "error":            None,
}


# ══════════════════════════════════════════════════════════════════════════════
# Instagram 크롤링 잡
# ══════════════════════════════════════════════════════════════════════════════

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
        from instagram_scraper import _build_driver, _try_login, fetch_user_reels, _clean_username
        import random

        IG_USERNAME = os.environ.get("IG_USERNAME", "").strip()
        IG_PASSWORD = os.environ.get("IG_PASSWORD", "").strip()

        driver = _build_driver(headless=headless)
        try:
            if IG_USERNAME and IG_PASSWORD:
                _try_login(driver)

            for idx, raw in enumerate(usernames, 1):
                if _stop_evt.is_set():
                    break
                username = _clean_username(raw)
                if not username:
                    continue

                with _job_lock:
                    _job_state["progress_current"] = username
                    _job_state["progress_done"] = idx - 1

                print(f"\n[{idx}/{total}] @{username} 수집 시작")
                try:
                    data = fetch_user_reels(driver, username, amount)
                    all_results.append(data)
                    print(f"  ✅ @{username} → {data['reelCount']}개")
                except Exception as e:
                    print(f"  ❌ @{username} 오류: {e}")
                    all_results.append({
                        "username":    username,
                        "reelCount":   0,
                        "avgViews":    0,
                        "avgLikes":    0,
                        "avgComments": 0,
                        "scrapedAt":   datetime.now(timezone.utc).isoformat(),
                        "reels":       [],
                        "error":       str(e),
                    })

                if idx < total and not _stop_evt.is_set():
                    import time
                    cd = random.uniform(2.0, 4.0)
                    print(f"  ⏳ 쿨다운 {cd:.1f}s")
                    time.sleep(cd)

        finally:
            try:
                driver.quit()
            except Exception:
                pass

        with _job_lock:
            _job_state.update({
                "status":           "done",
                "progress_done":    total,
                "progress_current": "",
                "results":          all_results,
            })
        print(f"\n[완료] 총 {len(all_results)}개 계정")

    except Exception as e:
        import traceback
        print(f"[치명 오류] {e}\n{traceback.format_exc()}")
        with _job_lock:
            _job_state.update({"status": "error", "error": str(e)})


# ══════════════════════════════════════════════════════════════════════════════
# TikTok 크롤링 잡
# ══════════════════════════════════════════════════════════════════════════════

def _run_tiktok_job(usernames: list[str], amount: int, headless: bool):
    global _tk_job_state
    with _tk_job_lock:
        _tk_job_state.update({
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
        from tiktok_scraper import fetch_user_videos

        for idx, raw in enumerate(usernames, 1):
            if _tk_stop_evt.is_set():
                break
            username = raw.lstrip("@").strip()
            if not username:
                continue

            with _tk_job_lock:
                _tk_job_state["progress_current"] = username
                _tk_job_state["progress_done"] = idx - 1

            print(f"\n[TikTok {idx}/{total}] @{username} 수집 시작")
            try:
                data = fetch_user_videos(None, username, amount, headless=headless)
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

            if idx < total and not _tk_stop_evt.is_set():
                import time, random
                cd = random.uniform(2.0, 4.0)
                print(f"  ⏳ 쿨다운 {cd:.1f}s")
                time.sleep(cd)

        with _tk_job_lock:
            _tk_job_state.update({
                "status":           "done",
                "progress_done":    total,
                "progress_current": "",
                "results":          all_results,
            })
        print(f"\n[TikTok 완료] 총 {len(all_results)}개 계정")

    except Exception as e:
        import traceback
        print(f"[TikTok 치명 오류] {e}\n{traceback.format_exc()}")
        with _tk_job_lock:
            _tk_job_state.update({"status": "error", "error": str(e)})


# ══════════════════════════════════════════════════════════════════════════════
# FastAPI 앱
# ══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("=" * 55)
    print("  TubeMetric Instagram + TikTok Scraper Agent  v1.1")
    print("  http://localhost:8003")
    print("  headless=new · undetected_chromedriver")
    print("=" * 55)
    yield
    print("[서버] 종료")


app = FastAPI(title="Instagram + TikTok Scraper Agent", version="1.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CrawlStartRequest(BaseModel):
    usernames: List[str]
    amount:    int  = 10
    headless:  bool = True


class TikTokStartRequest(BaseModel):
    usernames: List[str]
    amount:    int  = 20
    headless:  bool = True


@app.get("/api/health")
async def health():
    return {"status": "ok", "mode": "instagram-tiktok-scraper-local", "version": "1.1.0"}


# ── Instagram 엔드포인트 ──────────────────────────────────────────────────────

@app.post("/api/crawl/start")
async def crawl_start(req: CrawlStartRequest):
    with _job_lock:
        if _job_state["status"] == "running":
            raise HTTPException(status_code=409, detail="이미 실행 중인 잡이 있습니다.")

    usernames = [u.strip().lstrip("@") for u in req.usernames if u.strip()]
    if not usernames:
        raise HTTPException(status_code=400, detail="유효한 계정이 없습니다.")
    if req.amount < 1 or req.amount > 50:
        raise HTTPException(status_code=400, detail="amount는 1~50 사이여야 합니다.")

    _LOG.clear()
    _stop_evt.clear()
    threading.Thread(
        target=_run_crawl_job,
        args=(usernames, req.amount, req.headless),
        daemon=True,
    ).start()

    return {"status": "started", "total": len(usernames), "usernames": usernames}


@app.get("/api/crawl/status")
async def crawl_status():
    with _job_lock:
        state = dict(_job_state)
    return {
        "status": state["status"],
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


# ── TikTok 엔드포인트 ─────────────────────────────────────────────────────────

@app.post("/api/tiktok/start")
async def tiktok_start(req: TikTokStartRequest):
    with _tk_job_lock:
        if _tk_job_state["status"] == "running":
            raise HTTPException(status_code=409, detail="이미 실행 중인 TikTok 잡이 있습니다.")

    usernames = [u.strip().lstrip("@") for u in req.usernames if u.strip()]
    if not usernames:
        raise HTTPException(status_code=400, detail="유효한 계정이 없습니다.")
    if req.amount < 1 or req.amount > 50:
        raise HTTPException(status_code=400, detail="amount는 1~50 사이여야 합니다.")

    _tk_stop_evt.clear()
    threading.Thread(
        target=_run_tiktok_job,
        args=(usernames, req.amount, req.headless),
        daemon=True,
    ).start()

    return {"status": "started", "total": len(usernames), "usernames": usernames}


@app.get("/api/tiktok/status")
async def tiktok_status():
    with _tk_job_lock:
        state = dict(_tk_job_state)
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


@app.post("/api/tiktok/stop")
async def tiktok_stop():
    _tk_stop_evt.set()
    return {"status": "stopping"}


def main():
    # PyInstaller console=False 모드에서 sys.stdout/stderr가 None이면
    # uvicorn 로깅 초기화가 NoneType.isatty() 오류로 실패함 → devnull로 대체
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")

    uvicorn.run(app, host="127.0.0.1", port=8003, log_level="warning", log_config=None)


if __name__ == "__main__":
    main()

