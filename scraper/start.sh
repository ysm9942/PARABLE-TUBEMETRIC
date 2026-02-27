#!/usr/bin/env bash
# PARABLE-TUBEMETRIC 로컬 스크래퍼 서버 시작 스크립트

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================================"
echo "  PARABLE-TUBEMETRIC - 로컬 스크래퍼 서버"
echo "============================================================"
echo ""

# .env 파일 로드 (있는 경우)
if [ -f ".env" ]; then
    echo "[설정] .env 파일을 로드합니다..."
    set -a
    # shellcheck disable=SC1091
    source <(grep -v '^\s*#' .env | grep -v '^\s*$')
    set +a
    echo "[설정] 로드 완료"
    echo ""
else
    echo "[경고] .env 파일이 없습니다."
    echo "       .env.example 을 복사해서 .env 를 만들고 값을 설정하세요."
    echo ""
    echo "   cp .env.example .env"
    echo "   nano .env"
    echo ""
fi

# GITHUB_TOKEN 확인
if [ -z "${GITHUB_TOKEN:-}" ]; then
    echo "[오류] GITHUB_TOKEN 이 설정되지 않았습니다."
    echo ""
    echo "  방법 1: scraper/.env 파일에 추가:"
    echo "          GITHUB_TOKEN=ghp_..."
    echo ""
    echo "  방법 2: 터미널에서 직접 설정:"
    echo "          export GITHUB_TOKEN=ghp_... && bash start.sh"
    echo ""
    exit 1
fi

# GITHUB_REPO 확인
if [ -z "${GITHUB_REPO:-}" ]; then
    echo "[오류] GITHUB_REPO 가 설정되지 않았습니다."
    echo ""
    echo "  scraper/.env 파일에 추가:"
    echo "  GITHUB_REPO=owner/repo-name"
    echo ""
    exit 1
fi

# Python 확인
if command -v python3 &>/dev/null; then
    PYTHON=python3
elif command -v python &>/dev/null; then
    PYTHON=python
else
    echo "[오류] Python 을 찾을 수 없습니다."
    echo "       https://www.python.org 에서 Python 3.10 이상을 설치하세요."
    exit 1
fi

echo "[Python] $($PYTHON --version)"
echo ""

# 패키지 설치
echo "[설치] 필요한 패키지를 확인/설치합니다..."
if ! $PYTHON -m pip install -r requirements.txt -q; then
    echo "[오류] 패키지 설치 실패. 인터넷 연결을 확인하세요."
    exit 1
fi
echo "[설치] 완료"
echo ""

# 서버 실행
echo "[서버] 시작합니다. 종료: Ctrl+C"
echo ""
exec $PYTHON local_server.py
