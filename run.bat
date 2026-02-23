@echo off
chcp 65001 >nul
title PARABLE-TUBEMETRIC  설정 중...

set "ROOT=%~dp0"
set "SCRAPER_DIR=%ROOT%scraper"
set "VENV_DIR=%ROOT%.venv"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"

:: ── Python 감지 ────────────────────────────────────────────────────────────
set "PYTHON="
for %%p in (python python3 py) do (
    if not defined PYTHON (
        where %%p >nul 2>&1 && set "PYTHON=%%p"
    )
)
if not defined PYTHON (
    echo.
    echo  [오류] Python을 찾을 수 없습니다.
    echo  https://python.org/downloads 에서 Python 3.10 이상을 설치하세요.
    echo  설치 시 "Add Python to PATH" 를 반드시 체크하세요.
    echo.
    pause
    exit /b 1
)

:: ── 가상환경 생성 (최초 1회) ───────────────────────────────────────────────
if not exist "%VENV_PY%" (
    echo  [설정] 가상환경을 생성합니다... (최초 1회)
    "%PYTHON%" -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo  [오류] 가상환경 생성 실패
        pause
        exit /b 1
    )
    echo  [설정] 가상환경 생성 완료
)

:: ── 패키지 설치 확인 (최초 1회) ───────────────────────────────────────────
"%VENV_PY%" -c "import undetected_chromedriver" >nul 2>&1
if errorlevel 1 (
    echo  [설치] 필요한 패키지를 설치합니다... ^(1~3분 소요^)
    "%VENV_PY%" -m pip install --upgrade pip -q
    "%VENV_PY%" -m pip install -r "%SCRAPER_DIR%\requirements.txt"
    if errorlevel 1 (
        echo.
        echo  [오류] 패키지 설치 실패. 인터넷 연결을 확인하세요.
        pause
        exit /b 1
    )
    echo  [설치] 완료!
)

:: ── GUI 실행 후 이 CMD 창 닫기 ────────────────────────────────────────────
title PARABLE-TUBEMETRIC
start "" "%VENV_PY%" "%SCRAPER_DIR%\launcher_gui.py"
exit
