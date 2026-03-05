"""
PARABLE-TUBEMETRIC — 내장 인증 정보
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

!! 이 파일은 절대 git에 커밋하지 마세요 (.gitignore 에 등록됨) !!

토큰을 바꾸려면 이 파일을 수정하고 exe를 다시 빌드하세요.
"""

# ── 여기만 수정하면 됩니다 ─────────────────────────────────────────────────────

GITHUB_TOKEN  = "ghp_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
"            # GitHub Personal Access Token (ghp_...)
GITHUB_REPO   = "ysm9942/PARABLE-TUBEMETRIC"
GITHUB_BRANCH = "main"

YOUTUBE_API_KEY = "AIzaSyDyg1ThpwHJIL2lHJW9bixqiDawMBUK2uo"          # YouTube Data API v3 키 (AIzaSy...)

# ─────────────────────────────────────────────────────────────────────────────


def get_github_token() -> str:
    return GITHUB_TOKEN
