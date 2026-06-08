@echo off
:: TubeMetric 에이전트 순차 시작 스크립트
:: 각 에이전트를 4초 간격으로 시작하여 포트/Chrome 충돌 방지
:: 라이브 에이전트(8001) → SoftC 에이전트(8002) → Instagram·TikTok 에이전트(8003)

set "DIR=%~dp0"

echo [1/3] 라이브 지표 에이전트 시작 (포트 8001)...
start "" "%DIR%tubemetric-agent.exe"
timeout /t 4 /nobreak >nul

echo [2/3] SoftC 에이전트 시작 (포트 8002)...
start "" "%DIR%softc-scraper.exe"
timeout /t 4 /nobreak >nul

echo [3/3] Instagram/TikTok 에이전트 시작 (포트 8003)...
start "" "%DIR%instagram-scraper.exe"

echo 모든 에이전트가 시작되었습니다.
