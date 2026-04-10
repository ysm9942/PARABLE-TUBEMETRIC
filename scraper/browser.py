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


def _make_options(headless: bool) -> uc.ChromeOptions:
    """매 시도마다 새 옵션 인스턴스 필요 (uc가 내부적으로 상태 변경함)."""
    options = uc.ChromeOptions()
    if headless:
        options.add_argument("--headless=new")
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
    return options


def create_driver(headless: bool = False) -> uc.Chrome:
    """
    스텔스 모드 Chrome 드라이버 생성 — 버전 불문 호환 전략.
    Chrome이 자동 업데이트되어 메이저 버전이 바뀌어도 재설치 없이 동작하도록
    다단계 폴백을 수행한다.

    전략:
      1) 감지된 Chrome major로 uc.Chrome(version_main=N)
      2) version_main 없이 자동 감지
      3) use_subprocess=True 재시도
    """
    version = _get_chrome_major_version()
    print(f"🔎 감지된 Chrome major version: {version if version else '자동감지'}")

    attempts: list[tuple[str, dict]] = []
    if version:
        attempts.append(("version_main", {"version_main": version}))
    attempts.append(("auto_detect", {}))
    attempts.append(("use_subprocess", {"use_subprocess": True}))
    if version:
        attempts.append(("version_main+subprocess", {"version_main": version, "use_subprocess": True}))

    last_err: Exception | None = None
    driver: uc.Chrome | None = None
    for label, kwargs in attempts:
        try:
            print(f"🚀 Chrome 드라이버 시도: {label} {kwargs or ''}")
            options = _make_options(headless)
            driver = uc.Chrome(options=options, **kwargs)
            print(f"✅ Chrome 드라이버 생성 성공 ({label})")
            break
        except Exception as e:
            last_err = e
            print(f"❌ {label} 실패: {type(e).__name__}: {str(e)[:200]}")
            try:
                if driver:
                    driver.quit()
            except Exception:
                pass
            driver = None

    if driver is None:
        raise RuntimeError(
            f"Chrome 드라이버 생성 실패 (모든 폴백 시도 소진). 마지막 오류: {last_err}"
        )

    driver.set_page_load_timeout(30)
    return driver


def wait(driver: uc.Chrome, timeout: int = 10) -> WebDriverWait:
    return WebDriverWait(driver, timeout)
