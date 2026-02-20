"""
Undetected ChromeDriver 브라우저 설정
"""
import undetected_chromedriver as uc
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


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

    driver = uc.Chrome(options=options, use_subprocess=True)
    driver.set_page_load_timeout(30)
    return driver


def wait(driver: uc.Chrome, timeout: int = 10) -> WebDriverWait:
    return WebDriverWait(driver, timeout)
