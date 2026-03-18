"""
PARABLE-TUBEMETRIC Backend API

EXE의 undetected_chromedriver 기반 스크래핑을 대체하는 서버리스 백엔드.
yt-dlp + YouTube Data API + instagrapi로 브라우저 없이 동일한 기능을 제공한다.

무료 배포 대상: Render.com, Railway.app, Fly.io 등
"""
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from routers import youtube, instagram, tiktok, live  # noqa: E402

app = FastAPI(
    title="PARABLE-TUBEMETRIC API",
    description="YouTube/Instagram/TikTok/Live 분석 백엔드",
    version="1.0.0",
)

# CORS — Vercel 프론트엔드에서의 요청을 허용
ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000",
).split(",")

# Vercel 배포 도메인 자동 허용
ALLOWED_ORIGINS = [o.strip() for o in ALLOWED_ORIGINS if o.strip()]
if not any("vercel" in o or "parable" in o.lower() for o in ALLOWED_ORIGINS):
    ALLOWED_ORIGINS.append("https://*.vercel.app")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 개발 단계: 모든 origin 허용
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(youtube.router, prefix="/api/youtube", tags=["YouTube"])
app.include_router(instagram.router, prefix="/api/instagram", tags=["Instagram"])
app.include_router(tiktok.router, prefix="/api/tiktok", tags=["TikTok"])
app.include_router(live.router, prefix="/api/live", tags=["Live"])


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "PARABLE-TUBEMETRIC API"}
