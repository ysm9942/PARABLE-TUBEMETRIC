# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for PARABLE-TUBEMETRIC
# 빌드: pyinstaller PARABLE-TUBEMETRIC.spec
#

import sys
from pathlib import Path

block_cipher = None

a = Analysis(
    ['launcher_gui.py'],
    pathex=['.'],
    binaries=[],
    datas=[
        ('.env.example', '.'),
    ],
    hiddenimports=[
        # 로컬 스크래퍼 모듈
        'config',
        'browser',
        'channel_scraper',
        'video_scraper',
        'ad_detector',
        'shorts_detector',
        'uploader',
        'local_server',
        # selenium / undetected-chromedriver (라이브 지표 탭)
        'undetected_chromedriver',
        'selenium',
        'selenium.webdriver',
        'selenium.webdriver.chrome',
        'selenium.webdriver.chrome.service',
        'selenium.webdriver.chrome.options',
        'selenium.webdriver.support.ui',
        'selenium.webdriver.support.expected_conditions',
        'selenium.webdriver.common.by',
        'selenium.webdriver.common.keys',
        # instagrapi (Instagram 탭)
        'instagrapi',
        'instagrapi.client',
        'instagrapi.exceptions',
        'instagrapi.types',
        'instagrapi.mixins',
        # TikTokApi + Playwright (TikTok 탭)
        'TikTokApi',
        'TikTokApi.api',
        'TikTokApi.api.user',
        'TikTokApi.api.video',
        'playwright',
        'playwright.async_api',
        'playwright.sync_api',
        # 데이터 처리
        'openpyxl',
        'openpyxl.styles',
        'openpyxl.utils',
        'pandas',
        'pandas.core',
        # 네트워크 / 기타
        'requests',
        'dotenv',
        'tkinter',
        'tkinter.scrolledtext',
        'tkinter.messagebox',
        'pkg_resources.py2_warn',
        'certifi',
        'urllib3',
        'charset_normalizer',
        'asyncio',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
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
    name='PARABLE-TUBEMETRIC',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # GUI 모드 (콘솔 창 없음)
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)
