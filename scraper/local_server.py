"""
PARABLE-TUBEMETRIC 로컬 서버 (GitHub Queue 폴링 방식)

사용법: python scraper/local_server.py
  - 패키지 자동 설치
  - .env 없으면 초기 설정 마법사 자동 실행
  - 이후 GitHub 큐를 폴링하며 수집 요청 처리
"""

# ── 0. 패키지 자동 설치 (import 전에 실행) ────────────────────────────────────
import subprocess
import sys

_REQUIRED = ["requests", "python-dotenv", "instaloader"]

def _ensure_packages():
    missing = []
    for pkg in _REQUIRED:
        import importlib
        mod = pkg.replace("-", "_").split("[")[0]
        if importlib.util.find_spec(mod) is None:
            missing.append(pkg)
    if missing:
        print(f"[설치] 필요한 패키지 설치 중: {', '.join(missing)}", flush=True)
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "--quiet", *missing]
        )
        print("[설치] 완료", flush=True)

_ensure_packages()

# ── 1. 나머지 import ───────────────────────────────────────────────────────────
import os
import time
from datetime import datetime
from pathlib import Path

import requests

SCRAPER_DIR = Path(__file__).parent
_ENV_FILE   = SCRAPER_DIR / ".env"

_DEFAULT_REPO   = "ysm9942/PARABLE-TUBEMETRIC"
_DEFAULT_BRANCH = "main"


# ── 2. 초기 설정 마법사 ────────────────────────────────────────────────────────

def _setup_wizard():
    """처음 실행 시 .env 파일을 대화형으로 생성."""
    print()
    print("╔══════════════════════════════════════════╗")
    print("║  PARABLE-TUBEMETRIC  첫 실행 초기 설정   ║")
    print("╚══════════════════════════════════════════╝")
    print()
    print("GitHub Personal Access Token이 필요합니다.")
    print("발급 주소: https://github.com/settings/tokens")
    print("필요 권한: Contents (Read & Write)")
    print()

    while True:
        token = input("GitHub Token (ghp_...): ").strip()
        if token.startswith("ghp_") or token.startswith("github_pat_"):
            break
        if token:
            print("  ※ 토큰은 'ghp_' 또는 'github_pat_' 로 시작해야 합니다.\n")

    _ENV_FILE.write_text(
        f"GITHUB_TOKEN={token}\n"
        f"GITHUB_REPO={_DEFAULT_REPO}\n"
        f"GITHUB_BRANCH={_DEFAULT_BRANCH}\n"
        f"POLL_INTERVAL=30\n",
        encoding="utf-8",
    )
    print(f"\n✓ 설정 저장됨: {_ENV_FILE}")
    print("  (다음 실행부터는 이 과정이 생략됩니다)\n")


# ── 3. 환경변수 로드 ───────────────────────────────────────────────────────────

def _load_env():
    global GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH, POLL_INTERVAL, _API, _HDR

    # .env 없으면 마법사 실행
    if not _ENV_FILE.exists():
        _setup_wizard()

    from dotenv import load_dotenv
    load_dotenv(dotenv_path=_ENV_FILE, override=False)

    GITHUB_TOKEN  = os.environ.get("GITHUB_TOKEN", "")
    GITHUB_REPO   = os.environ.get("GITHUB_REPO",  _DEFAULT_REPO)
    GITHUB_BRANCH = os.environ.get("GITHUB_BRANCH", _DEFAULT_BRANCH)
    POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "30"))

    if not GITHUB_TOKEN:
        # .env는 있는데 토큰이 비어있으면 다시 마법사
        print("[경고] .env에 GITHUB_TOKEN이 없습니다. 설정을 다시 진행합니다.")
        _ENV_FILE.unlink(missing_ok=True)
        _setup_wizard()
        load_dotenv(dotenv_path=_ENV_FILE, override=True)
        GITHUB_TOKEN  = os.environ.get("GITHUB_TOKEN", "")
        GITHUB_REPO   = os.environ.get("GITHUB_REPO",  _DEFAULT_REPO)

    _API = f"https://api.github.com/repos/{GITHUB_REPO}"
    _HDR = {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept":        "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

# 전역 초기화 (load_env 호출 전 placeholder)
GITHUB_TOKEN = GITHUB_REPO = GITHUB_BRANCH = ""
POLL_INTERVAL = 30
_API = _HDR = None  # type: ignore


# ── 유틸 ──────────────────────────────────────────────────────────────────────

def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S")

def log(msg: str):
    print(f"[{_ts()}] {msg}", flush=True)


# ── GitHub API 헬퍼 ───────────────────────────────────────────────────────────

def _list_queue() -> list[dict]:
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
    try:
        r = requests.get(url, timeout=15)
        return r.json() if r.ok else None
    except Exception:
        return None


def _delete_queue_file(filename: str, sha: str) -> bool:
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
    job_type = job.get("type", "channel")
    handles  = job.get("handles") or (
        [job["handle"]] if job.get("handle") else []
    )
    opts = job.get("options", {})

    if not handles:
        log(f"[오류] 핸들 목록이 비어있음: {job}")
        return False

    # ── Instagram 릴스 스크래퍼 ──────────────────────────────────────────────
    if job_type == "instagram":
        cmd = [sys.executable, str(SCRAPER_DIR / "instagram_scraper.py")]
        cmd.extend(handles)
        cmd += ["--amount", str(opts.get("amount", 10))]
        cmd.append("--push")

        log(f"[실행] Instagram: {' '.join(cmd)}")
        try:
            proc = subprocess.run(cmd, cwd=str(SCRAPER_DIR), timeout=600)
            return proc.returncode == 0
        except subprocess.TimeoutExpired:
            log("[오류] Instagram 스크래퍼 타임아웃 (10분)")
            return False
        except Exception as e:
            log(f"[오류] Instagram 스크래퍼 실행 실패: {e}")
            return False

    # ── TikTok 스크래퍼 ──────────────────────────────────────────────────────
    if job_type == "tiktok":
        try:
            from run_scraper_ci import process_tiktok
            process_tiktok(job)
            return True
        except Exception as e:
            log(f"[오류] TikTok 스크래퍼 실패: {e}")
            return False

    # ── YouTube 스크래퍼 ──────────────────────────────────────────────────────
    cmd = [sys.executable, str(SCRAPER_DIR / "main.py")]
    if opts.get("headless", True):
        cmd.append("--headless")
    cmd.append("--push")
    cmd.append(job_type)
    cmd.extend(handles)

    if job_type == "channel" and opts.get("scrolls"):
        cmd += ["--scrolls", str(opts["scrolls"])]
    if opts.get("start") and opts.get("end"):
        cmd += ["--start", opts["start"], "--end", opts["end"]]

    log(f"[실행] YouTube: {' '.join(cmd)}")
    try:
        proc = subprocess.run(cmd, cwd=str(SCRAPER_DIR), timeout=600)
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

        if _delete_queue_file(name, sha):
            log(f"[큐] 파일 삭제 완료: {name}")
        else:
            log(f"[경고] 큐 파일 삭제 실패 (수동 삭제 필요): {name}")

        log(f"[완료] {name} → {'✓ 성공' if ok else '✗ 실패'}")


# ── 진입점 ────────────────────────────────────────────────────────────────────

def main():
    _load_env()

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
