# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller 빌드 스펙 — TubeMetric Local Agent

빌드 명령:
  cd installer
  pyinstaller tubemetric.spec
"""

import sys
import os

block_cipher = None

# backend 폴더를 번들에 포함
backend_datas = [("../backend", "backend")]

a = Analysis(
    ["local_server.py"],
    pathex=[".", "../backend"],
    binaries=[],
    datas=backend_datas,
    hiddenimports=[
        # uvicorn
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
        # fastapi / starlette
        "fastapi",
        "fastapi.middleware.cors",
        "starlette",
        "starlette.middleware",
        "starlette.middleware.cors",
        # pydantic
        "pydantic",
        "pydantic.v1",
        # http 클라이언트
        "httpx",
        "httpx._transports",
        "httpx._transports.default",
        "curl_cffi",
        "curl_cffi.requests",
        # HTML 파싱
        "bs4",
        "beautifulsoup4",
        # playwright
        "playwright",
        "playwright.async_api",
        "playwright.sync_api",
        "playwright_stealth",
        # 기타
        "anyio",
        "anyio._backends._asyncio",
        "h11",
        "email.mime.text",
        "email.mime.multipart",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # 불필요한 패키지 제거 (크기 절감)
        "tkinter",
        "matplotlib",
        "numpy",
        "pandas",
        "PIL",
        "IPython",
        "jupyter",
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
    name="tubemetric-agent",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # 백그라운드 실행 (콘솔 창 숨김)
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)
