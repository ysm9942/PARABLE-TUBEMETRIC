"""
PARABLE-TUBEMETRIC — 내장 인증 정보
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

!! 이 파일은 절대 git에 커밋하지 마세요 (.gitignore 에 등록됨) !!

빌드 전 토큰 인코딩 방법:
  python -c "import base64; print(base64.b64encode(b'ghp_실제토큰').decode())"
  출력된 값을 아래 _GITHUB_TOKEN_B64 에 붙여넣기

토큰을 바꾸려면 이 파일을 수정하고 exe를 다시 빌드하세요.
"""
import base64

# ── 여기만 수정하면 됩니다 ─────────────────────────────────────────────────────

_GITHUB_TOKEN_B64 = ""            # base64 인코딩된 GitHub 토큰
GITHUB_REPO       = "ysm9942/PARABLE-TUBEMETRIC"
GITHUB_BRANCH     = "main"

YOUTUBE_API_KEY   = ""            # YouTube Data API v3 키

# ─────────────────────────────────────────────────────────────────────────────


def get_github_token() -> str:
    """내장 GitHub 토큰을 복호화해서 반환. 미설정 시 빈 문자열."""
    if not _GITHUB_TOKEN_B64:
        return ""
    try:
        return base64.b64decode(_GITHUB_TOKEN_B64).decode()
    except Exception:
        return ""
