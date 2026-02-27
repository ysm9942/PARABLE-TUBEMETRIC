"""
PARABLE-TUBEMETRIC 로컬 서버 (GitHub Queue 폴링 방식)

Vercel 사이트에서 채널을 입력하면 GitHub results/queue/ 에 요청 파일이 생성됩니다.
이 서버는 해당 폴더를 주기적으로 체크하고, 새 요청이 있으면 스크래퍼를 실행합니다.

필요한 환경 변수:
  GITHUB_TOKEN  : GitHub Personal Access Token (contents:write 권한)
  GITHUB_REPO   : "owner/repo-name"  예: ysm9942/PARABLE-TUBEMETRIC
  GITHUB_BRANCH : 브랜치명 (기본값: main)
  POLL_INTERVAL : 폴링 간격 초 (기본값: 30)

사용법:
  set GITHUB_TOKEN=ghp_...
  set GITHUB_REPO=owner/repo
  python scraper/local_server.py
"""

import os
import sys
import time
import subprocess
from datetime import datetime
from pathlib import Path

import requests

ROOT        = Path(__file__).parent.parent
SCRAPER_DIR = Path(__file__).parent

# .env 파일 자동 로드 (환경변수가 이미 설정된 경우 덮어쓰지 않음)
try:
    from dotenv import load_dotenv
    _env_file = SCRAPER_DIR / ".env"
    if _env_file.exists():
        load_dotenv(dotenv_path=_env_file, override=False)
        print(f"[설정] .env 파일 로드됨: {_env_file}", flush=True)
except ImportError:
    pass

GITHUB_TOKEN  = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REPO   = os.environ.get("GITHUB_REPO", "")
GITHUB_BRANCH = os.environ.get("GITHUB_BRANCH", "main")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "30"))

_API  = f"https://api.github.com/repos/{GITHUB_REPO}"
_HDR  = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept":        "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


# ── 유틸 ──────────────────────────────────────────────────────────────────────

def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S")

def log(msg: str):
    print(f"[{_ts()}] {msg}", flush=True)


# ── GitHub API 헬퍼 ───────────────────────────────────────────────────────────

def _list_queue() -> list[dict]:
    """results/queue/ 의 .json 파일 목록 반환"""
    r = requests.get(
        f"{_API}/contents/results/queue",
        headers=_HDR,
        params={"ref": GITHUB_BRANCH},
        timeout=15,
    )
    if not r.ok:
        return []
    return [
        f for f in r.json()
        if isinstance(f, dict)
        and f.get("name", "").endswith(".json")
        and f.get("name") != ".gitkeep"
    ]


def _download(url: str) -> dict | None:
    """파일 내용 JSON으로 다운로드"""
    try:
        r = requests.get(url, timeout=15)
        return r.json() if r.ok else None
    except Exception:
        return None


def _delete_queue_file(filename: str, sha: str) -> bool:
    """큐 파일 삭제 (처리 완료 표시)"""
    r = requests.delete(
        f"{_API}/contents/results/queue/{filename}",
        headers=_HDR,
        json={
            "message": f"scraper: done {filename}",
            "sha": sha,
            "branch": GITHUB_BRANCH,
        },
        timeout=15,
    )
    return r.status_code in (200, 204)


# ── 스크래퍼 실행 ─────────────────────────────────────────────────────────────

def _run_scraper(job: dict) -> bool:
    """job dict에 따라 main.py 실행"""
    job_type = job.get("type", "channel")
    handles  = job.get("handles") or (
        [job["handle"]] if job.get("handle") else []
    )
    opts = job.get("options", {})

    if not handles:
        log(f"[오류] 핸들 목록이 비어있음: {job}")
        return False

    cmd = [sys.executable, str(SCRAPER_DIR / "main.py")]
    if opts.get("headless", True):
        cmd.append("--headless")
    cmd.append("--push")
    cmd.append(job_type)
    cmd.extend(handles)

    if job_type == "channel" and opts.get("scrolls"):
        cmd += ["--scrolls", str(opts["scrolls"])]

    log(f"[실행] {' '.join(cmd)}")
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(SCRAPER_DIR),
            timeout=600,   # 10분 타임아웃
        )
        return proc.returncode == 0
    except subprocess.TimeoutExpired:
        log("[오류] 스크래퍼 타임아웃 (10분)")
        return False
    except Exception as e:
        log(f"[오류] 스크래퍼 실행 실패: {e}")
        return False


# ── 큐 처리 루프 ──────────────────────────────────────────────────────────────

def _process_queue():
    items = _list_queue()
    if not items:
        return

    log(f"[큐] {len(items)}개 작업 발견")

    for item in items:
        name = item["name"]
        sha  = item["sha"]
        url  = item.get("download_url")

        log(f"[작업] 처리 시작: {name}")

        job = _download(url)
        if not job:
            log(f"[오류] 파일 읽기 실패, 건너뜀: {name}")
            continue

        handles = job.get("handles") or ([job.get("handle")] if job.get("handle") else [])
        log(f"       채널: {', '.join(handles)}")

        ok = _run_scraper(job)

        # 큐 파일 삭제 → Vercel에서 "완료"로 인식
        if _delete_queue_file(name, sha):
            log(f"[큐] 파일 삭제 완료: {name}")
        else:
            log(f"[경고] 큐 파일 삭제 실패 (수동 삭제 필요): {name}")

        log(f"[완료] {name} → {'✓ 성공' if ok else '✗ 실패'}")


# ── 진입점 ────────────────────────────────────────────────────────────────────

def main():
    if not GITHUB_TOKEN:
        sys.exit(
            "[오류] GITHUB_TOKEN 환경변수를 설정하세요.\n"
            "  Windows: set GITHUB_TOKEN=ghp_...\n"
            "  Mac/Linux: export GITHUB_TOKEN=ghp_..."
        )
    if not GITHUB_REPO:
        sys.exit(
            "[오류] GITHUB_REPO 환경변수를 설정하세요.\n"
            "  예: set GITHUB_REPO=ysm9942/PARABLE-TUBEMETRIC"
        )

    log(f"[서버] PARABLE-TUBEMETRIC 로컬 서버 시작")
    log(f"       레포: {GITHUB_REPO} / 브랜치: {GITHUB_BRANCH}")
    log(f"       폴링 간격: {POLL_INTERVAL}초 | Ctrl+C 로 중지")
    log("")

    while True:
        try:
            _process_queue()
        except KeyboardInterrupt:
            log("[서버] 중지됨")
            break
        except Exception as e:
            log(f"[오류] {e}")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
