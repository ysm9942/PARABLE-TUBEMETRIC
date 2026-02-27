@echo off
chcp 65001 >nul
title PARABLE-TUBEMETRIC .exe 빌드

echo ============================================================
echo   PARABLE-TUBEMETRIC - .exe 빌더
echo ============================================================
echo.

cd /d "%~dp0"

python --version >nul 2>&1
if errorlevel 1 (
    echo [오류] Python 을 찾을 수 없습니다.
    echo         https://www.python.org 에서 Python 3.10 이상을 설치하세요.
    pause
    exit /b 1
)

echo [설치] PyInstaller 및 필요 패키지 설치 중...
python -m pip install pyinstaller -q
python -m pip install -r requirements.txt -q
echo [설치] 완료
echo.

echo [빌드] .exe 파일 생성 중... (1~3분 소요)
pyinstaller PARABLE-TUBEMETRIC.spec
if errorlevel 1 (
    echo [오류] 빌드 실패. 위 오류 메시지를 확인하세요.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   빌드 완료!
echo   dist\PARABLE-TUBEMETRIC.exe 파일을 배포하면 됩니다.
echo ============================================================
echo.
pause
