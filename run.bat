@echo off
chcp 65001 >nul
title PARABLE-TUBEMETRIC 스크래퍼

echo ================================================
echo  PARABLE-TUBEMETRIC 자동 스크래퍼
echo ================================================
echo.

:: ── 경로 설정 ─────────────────────────────────────
set SCRIPT_DIR=%~dp0
set SCRAPER_DIR=%SCRIPT_DIR%scraper
set TARGETS_FILE=%SCRAPER_DIR%\targets.txt

:: ── Python 경로 자동 감지 ─────────────────────────
set PYTHON=python
where python >nul 2>&1 || (
    set PYTHON=python3
    where python3 >nul 2>&1 || (
        echo [오류] Python을 찾을 수 없습니다.
        echo Python이 설치되어 있는지 확인하세요.
        pause
        exit /b 1
    )
)

:: ── targets.txt 읽어서 채널 목록 추출 ────────────
echo [정보] 채널 목록을 불러오는 중...
set CHANNEL_ARGS=

for /f "usebackq eol=# tokens=*" %%L in ("%TARGETS_FILE%") do (
    set "LINE=%%L"
    :: 공백만 있는 줄 건너뜀
    if not "%%L"=="" (
        set "CHANNEL_ARGS=%CHANNEL_ARGS% %%L"
    )
)

if "%CHANNEL_ARGS%"=="" (
    echo [오류] scraper\targets.txt 에 채널이 없습니다.
    echo 파일을 열어 채널 핸들을 추가하세요. 예: @채널핸들
    notepad "%TARGETS_FILE%"
    pause
    exit /b 1
)

echo [정보] 스크래핑 대상:%CHANNEL_ARGS%
echo.

:: ── 스크래퍼 실행 ─────────────────────────────────
cd /d "%SCRAPER_DIR%"

echo [시작] 채널 스크래핑 + GitHub push 시작...
echo.

%PYTHON% main.py --push channel%CHANNEL_ARGS%

if %errorlevel% neq 0 (
    echo.
    echo [실패] 스크래퍼 실행 중 오류가 발생했습니다. 위 로그를 확인하세요.
    pause
    exit /b 1
)

echo.
echo ================================================
echo  완료! 사이트에서 결과를 확인하세요.
echo ================================================
echo.
pause
