"""
TubeMetric Local Agent
로컬에서 실행되는 경량 서버 — 라이브 지표 스크래핑 담당

Render 서버는 클라우드 IP라서 Vercel Security Checkpoint에 막히므로,
사용자 PC에서 직접 실행해 로컬 IP(VPN 포함)로 요청한다.
브라우저에서 localhost:8001로 접근.
"""
import sys
import os
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


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
