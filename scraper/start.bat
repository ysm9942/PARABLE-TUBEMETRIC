@echo off
chcp 65001 >nul
title PARABLE-TUBEMETRIC 로컬 서버

echo ============================================================
echo   PARABLE-TUBEMETRIC - 로컬 스크래퍼 서버
echo ============================================================
echo.

cd /d "%~dp0"

if exist ".env" (
    echo [설정] .env 파일 발견 - Python이 자동으로 로드합니다.
    echo.
) else (
    echo [경고] .env 파일이 없습니다.
    echo         .env.example 을 복사하여 .env 를 만들고 값을 설정하세요.
    echo.
    echo   copy .env.example .env
    echo.
)

python --version >nul 2>&1
if errorlevel 1 (
    echo [오류] Python 을 찾을 수 없습니다.
    echo         https://www.python.org 에서 Python 3.10 이상을 설치하세요.
    pause
    exit /b 1
)

echo [설치] 필요한 패키지를 확인/설치합니다...
python -m pip install -r requirements.txt -q
if errorlevel 1 (
    echo [오류] 패키지 설치 실패. 인터넷 연결을 확인하세요.
    pause
    exit /b 1
)
echo [설치] 완료
echo.

echo [서버] 시작합니다. 종료: Ctrl+C 또는 창 닫기
echo.
python local_server.py

pause
