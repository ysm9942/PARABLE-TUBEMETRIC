"""
TubeMetric Local Agent
로컬에서 실행되는 경량 서버 — 라이브 지표 스크래핑 담당

Render 서버는 클라우드 IP라서 Vercel Security Checkpoint에 막히므로,
사용자 PC에서 직접 실행해 로컬 IP(VPN 포함)로 요청한다.
브라우저에서 localhost:8001로 접근.
"""
import sys
import os
import subprocess
import threading
from contextlib import asynccontextmanager

# PyInstaller로 빌드된 경우 backend 경로 설정
if getattr(sys, "frozen", False):
    _base = sys._MEIPASS  # type: ignore
    _backend = os.path.join(_base, "backend")
else:
    _backend = os.path.join(os.path.dirname(__file__), "..", "backend")

sys.path.insert(0, _backend)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn


def _ensure_playwright():
    """첫 실행 시 Playwright Chromium 자동 설치."""
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            browser.close()
        print("[Agent] Playwright Chromium 확인 완료")
    except Exception:
        print("[Agent] Playwright Chromium 설치 중... (약 150MB, 잠시 기다려주세요)")
        try:
            # PyInstaller 번들에서는 playwright 내부 드라이버 사용
            from playwright._impl._driver import compute_driver_executable
            driver = str(compute_driver_executable())
            result = subprocess.run(
                [driver, "install", "chromium"],
                capture_output=True,
                text=True,
            )
        except ImportError:
            # 일반 Python 환경
            result = subprocess.run(
                [sys.executable, "-m", "playwright", "install", "chromium"],
                capture_output=True,
                text=True,
            )

        if result.returncode == 0:
            print("[Agent] Playwright Chromium 설치 완료!")
        else:
            print("[Agent] 설치 오류:", result.stderr[:300])


@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup: 백그라운드에서 Playwright 확인
    thread = threading.Thread(target=_ensure_playwright, daemon=True)
    thread.start()
    yield
    # shutdown: 정리 작업 없음


app = FastAPI(title="TubeMetric Local Agent", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 라이브 지표 라우터
from routers.live import router as live_router
app.include_router(live_router, prefix="/api/live")


@app.get("/api/health")
async def health():
    return {"status": "ok", "mode": "local-agent", "version": "1.0.0"}


def main():
    print("=" * 50)
    print("  TubeMetric Local Agent 시작")
    print("  http://localhost:8001")
    print("=" * 50)
    uvicorn.run(app, host="127.0.0.1", port=8001, log_level="warning")


if __name__ == "__main__":
    main()
