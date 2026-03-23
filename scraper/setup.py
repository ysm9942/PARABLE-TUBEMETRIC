"""
PARABLE-TUBEMETRIC 로컬 스크래퍼 초기 설정
  python scraper/setup.py

실행하면:
  1. scraper/.env 자동 생성 (BACKEND_URL만 필요, GitHub 토큰 불필요)
  2. 필요한 패키지 자동 설치
"""
import subprocess
import sys
from pathlib import Path

ENV_FILE = Path(__file__).parent / ".env"

DEFAULT_BACKEND = "https://parable-tubemetric-api.onrender.com"
PACKAGES        = ["requests", "python-dotenv", "instaloader"]

BANNER = """
╔══════════════════════════════════════════╗
║  PARABLE-TUBEMETRIC  로컬 스크래퍼 설정  ║
╚══════════════════════════════════════════╝
"""

def write_env(backend_url: str):
    content = (
        f"BACKEND_URL={backend_url}\n"
        f"POLL_INTERVAL=30\n"
    )
    ENV_FILE.write_text(content, encoding="utf-8")
    print(f"\n✓ .env 파일 생성: {ENV_FILE}")

def install_packages():
    print("\n패키지 설치 중...")
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "--quiet", *PACKAGES]
    )
    print("✓ 패키지 설치 완료")

def main():
    print(BANNER)

    if ENV_FILE.exists():
        ans = input(".env 파일이 이미 있습니다. 덮어쓰시겠습니까? [y/N] ").strip().lower()
        if ans != "y":
            print("설정을 건너뜁니다.")
            install_packages()
        else:
            url = input(f"BACKEND_URL [엔터 = {DEFAULT_BACKEND}]: ").strip() or DEFAULT_BACKEND
            write_env(url)
            install_packages()
    else:
        url = input(f"BACKEND_URL [엔터 = {DEFAULT_BACKEND}]: ").strip() or DEFAULT_BACKEND
        write_env(url)
        install_packages()

    print("\n══════════════════════════════════════════")
    print("  설정 완료! 아래 명령어로 서버를 시작하세요:")
    print()
    print("    python scraper/local_server.py")
    print()
    print("══════════════════════════════════════════\n")

if __name__ == "__main__":
    main()
