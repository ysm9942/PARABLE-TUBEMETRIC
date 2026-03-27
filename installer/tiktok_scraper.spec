# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller 빌드 스펙 — TikTok 동영상 스크래퍼 서버

빌드 명령:
  cd installer
  pyinstaller tiktok_scraper.spec

결과물: dist/tiktok-scraper[.exe]
  실행 시 http://localhost:8004 에서 REST API 서버가 뜹니다.
"""

block_cipher = None

a = Analysis(
    ["../scraper/tiktok_server.py"],
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
        "selenium.webdriver.support.ui",
        "selenium.webdriver.support.expected_conditions",
        "selenium.common.exceptions",
        # ── tiktok_scraper.py 의존성 ───────────────────────────────────────
        "tiktok_scraper",
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
        # ── 패키징 유틸 ───────────────────────────────────────────────────
        "packaging",
        "packaging.version",
        # ── dotenv (선택) ─────────────────────────────────────────────────
        "dotenv",
        # ── 기타 표준 라이브러리 ───────────────────────────────────────────
        "email.mime.text",
        "email.mime.multipart",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
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
        "bs4",
        "lxml",
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
    name="tiktok-scraper",
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
