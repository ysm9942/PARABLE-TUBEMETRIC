"""
Undetected ChromeDriver 브라우저 설정
"""
import re
import subprocess
import undetected_chromedriver as uc
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


def _get_chrome_major_version() -> int | None:
    """설치된 Chrome의 메이저 버전을 자동 감지"""
    # Linux/Mac
    for cmd in (["google-chrome", "--version"], ["google-chrome-stable", "--version"],
                ["chromium-browser", "--version"], ["chromium", "--version"],
                ["google-chrome.exe", "--version"]):
        try:
            out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL).decode()
            m = re.search(r"(\d+)\.", out)
            if m:
                return int(m.group(1))
        except Exception:
            continue
    # Windows 레지스트리 (여러 경로 시도)
    try:
        import winreg
        reg_paths = [
            (winreg.HKEY_CURRENT_USER,  r"Software\Google\Chrome\BLBeacon"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Google\Chrome\BLBeacon"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Google\Chrome\BLBeacon"),
        ]
        for hive, path in reg_paths:
            try:
                key = winreg.OpenKey(hive, path)
                ver, _ = winreg.QueryValueEx(key, "version")
                return int(ver.split(".")[0])
            except Exception:
                continue
    except Exception:
        pass
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
    driver = uc.Chrome(options=options, use_subprocess=True, version_main=version)
    driver.set_page_load_timeout(30)
    return driver


def wait(driver: uc.Chrome, timeout: int = 10) -> WebDriverWait:
    return WebDriverWait(driver, timeout)
