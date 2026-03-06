"""
Undetected ChromeDriver 브라우저 설정
"""
import re
import subprocess
import undetected_chromedriver as uc
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


def _get_chrome_major_version() -> int | None:
    """설치된 Chrome의 메이저 버전을 자동 감지 (reg query 방식 — Windows에서 가장 안정적)"""
    # Windows: reg query (winreg보다 신뢰성 높음)
    reg_cmds = [
        r'reg query "HKEY_CURRENT_USER\Software\Google\Chrome\BLBeacon" /v version',
        r'reg query "HKEY_LOCAL_MACHINE\Software\Google\Chrome\BLBeacon" /v version',
        r'reg query "HKEY_LOCAL_MACHINE\Software\WOW6432Node\Google\Chrome\BLBeacon" /v version',
    ]
    for cmd in reg_cmds:
        try:
            out = subprocess.check_output(
                cmd, shell=True, text=True, encoding="utf-8", errors="ignore"
            )
            m = re.search(r"(\d+)\.\d+\.\d+\.\d+", out)
            if m:
                return int(m.group(1))
        except Exception:
            continue
    # Linux/Mac fallback
    for cmd in (["google-chrome", "--version"], ["google-chrome-stable", "--version"],
                ["chromium-browser", "--version"], ["chromium", "--version"]):
        try:
            out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL).decode()
            m = re.search(r"(\d+)\.", out)
            if m:
                return int(m.group(1))
        except Exception:
            continue
    return None


def create_driver(headless: bool = False) -> uc.Chrome:
    """
    스텔스 모드 Chrome 드라이버 생성.
    headless=True 시 창 없이 실행 (서버 환경용).
    """
    options = uc.ChromeOptions()

    if headless:
        options.add_argument("--headless=new")

    # 봇 탐지 우회를 위한 기본 옵션
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--lang=ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7")
    options.add_argument("--window-size=1280,900")
    options.add_argument(
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )

    version = _get_chrome_major_version()
    print(f"🔎 감지된 Chrome major version: {version if version else '자동감지'}")
    if version:
        driver = uc.Chrome(options=options, version_main=version)
    else:
        driver = uc.Chrome(options=options)
    driver.set_page_load_timeout(30)
    return driver


def wait(driver: uc.Chrome, timeout: int = 10) -> WebDriverWait:
    return WebDriverWait(driver, timeout)
