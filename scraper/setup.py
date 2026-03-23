"""
PARABLE-TUBEMETRIC 로컬 스크래퍼 초기 설정
  python scraper/setup.py

실행하면:
  1. GitHub 토큰 입력 안내
  2. scraper/.env 자동 생성
  3. 필요한 패키지 자동 설치
"""
import subprocess
import sys
from pathlib import Path

ENV_FILE = Path(__file__).parent / ".env"

REPO      = "ysm9942/PARABLE-TUBEMETRIC"
BRANCH    = "main"
PACKAGES  = ["requests", "python-dotenv", "instaloader"]

BANNER = """
╔══════════════════════════════════════════╗
║  PARABLE-TUBEMETRIC  로컬 스크래퍼 설정  ║
╚══════════════════════════════════════════╝
"""

def ask_token() -> str:
    print("GitHub Personal Access Token이 필요합니다.")
    print("발급 주소: https://github.com/settings/tokens")
    print("필요 권한: Contents (Read & Write)\n")
    while True:
        token = input("GitHub Token (ghp_...): ").strip()
        if token.startswith("ghp_") or token.startswith("github_pat_"):
            return token
        if token:
            print("  ※ 토큰은 'ghp_' 또는 'github_pat_' 로 시작해야 합니다. 다시 입력하세요.")

def write_env(token: str):
    content = (
        f"GITHUB_TOKEN={token}\n"
        f"GITHUB_REPO={REPO}\n"
        f"GITHUB_BRANCH={BRANCH}\n"
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

    # 이미 존재하면 덮어쓸지 확인
    if ENV_FILE.exists():
        ans = input(".env 파일이 이미 있습니다. 덮어쓰시겠습니까? [y/N] ").strip().lower()
        if ans != "y":
            print("설정을 건너뜁니다.")
        else:
            token = ask_token()
            write_env(token)
    else:
        token = ask_token()
        write_env(token)

    install_packages()

    print("\n══════════════════════════════════════════")
    print("  설정 완료! 아래 명령어로 서버를 시작하세요:")
    print()
    print("    python scraper/local_server.py")
    print()
    print("  서버가 실행 중이면 웹에서 요청 시 자동 수집됩니다.")
    print("══════════════════════════════════════════\n")

if __name__ == "__main__":
    main()
