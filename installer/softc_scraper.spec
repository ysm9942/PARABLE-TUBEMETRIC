# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller 빌드 스펙 — SoftC.one 크롤러 서버

빌드 명령:
  cd installer
  pyinstaller softc_scraper.spec

결과물: dist/softc-scraper[.exe]
  실행 시 http://localhost:8002 에서 REST API 서버가 뜹니다.
"""

import sys
import os

block_cipher = None

a = Analysis(
    ["../scraper/softc_server.py"],
    pathex=[".", "../scraper"],
    binaries=[],
    datas=[],
    hiddenimports=[
        # ── FastAPI / uvicorn ──────────────────────────────────────────────
        "uvicorn",
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "fastapi",
        "fastapi.middleware.cors",
        "starlette",
        "starlette.middleware",
        "starlette.middleware.cors",
        # ── pydantic ──────────────────────────────────────────────────────
        "pydantic",
        "pydantic.v1",
        # ── undetected-chromedriver + selenium ────────────────────────────
        "undetected_chromedriver",
        "selenium",
        "selenium.webdriver",
        "selenium.webdriver.chrome",
        "selenium.webdriver.chrome.options",
        "selenium.webdriver.chrome.service",
        "selenium.webdriver.common.by",
        "selenium.webdriver.common.action_chains",
        "selenium.webdriver.support.ui",
        "selenium.webdriver.support.expected_conditions",
        "selenium.common.exceptions",
        # ── HTML 파싱 ──────────────────────────────────────────────────────
        "bs4",
        "lxml",
        "lxml.etree",
        # ── 비동기 / 네트워크 ──────────────────────────────────────────────
        "anyio",
        "anyio._backends._asyncio",
        "h11",
        "requests",
        "requests.adapters",
        "urllib3",
        "certifi",
        "charset_normalizer",
        # ── websocket (uc 내부 사용) ───────────────────────────────────────
        "websocket",
        "websocket._core",
        "_websocket",
        # ── 패키징 유틸 (uc 버전 비교) ────────────────────────────────────
        "packaging",
        "packaging.version",
        # ── 기타 표준 라이브러리 ───────────────────────────────────────────
        "email.mime.text",
        "email.mime.multipart",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # 불필요한 패키지 제거 (크기 절감)
        "tkinter",
        "customtkinter",
        "matplotlib",
        "pandas",
        "openpyxl",
        "PIL",
        "IPython",
        "jupyter",
        "playwright",
        "numpy",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="softc-scraper",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,   # 백그라운드 실행 (콘솔 창 숨김)
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)
