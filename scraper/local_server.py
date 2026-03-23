"""
PARABLE-TUBEMETRIC 로컬 서버 (백엔드 프록시 방식)

GitHub 토큰 불필요. BACKEND_URL 하나만 있으면 됩니다.

사용법: python scraper/local_server.py
  - 패키지 자동 설치
  - .env 없으면 초기 설정 마법사 자동 실행
  - 백엔드를 통해 큐 폴링 및 결과 push
"""

# ── 0. 패키지 자동 설치 ────────────────────────────────────────────────────────
import importlib
import subprocess
import sys

_REQUIRED = ["requests", "python-dotenv", "instaloader"]

def _ensure_packages():
    missing = [p for p in _REQUIRED
               if importlib.util.find_spec(p.replace("-", "_")) is None]
    if missing:
        print(f"[설치] 패키지 설치 중: {', '.join(missing)}", flush=True)
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

# 고정값 — 변경 불필요
_DEFAULT_BACKEND = "https://parable-tubemetric-api.onrender.com"


# ── 2. 초기 설정 마법사 ────────────────────────────────────────────────────────

def _setup_wizard():
    print()
    print("╔══════════════════════════════════════════╗")
    print("║  PARABLE-TUBEMETRIC  첫 실행 초기 설정   ║")
    print("╚══════════════════════════════════════════╝")
    print()
    print(f"백엔드 서버 주소 (기본값: {_DEFAULT_BACKEND})")
    url = input(f"BACKEND_URL [엔터 = 기본값 사용]: ").strip()
    if not url:
        url = _DEFAULT_BACKEND

    _ENV_FILE.write_text(
        f"BACKEND_URL={url}\n"
        f"POLL_INTERVAL=30\n",
        encoding="utf-8",
    )
    print(f"\n✓ 설정 저장됨: {_ENV_FILE}")
    print("  (다음 실행부터는 이 과정이 생략됩니다)\n")


# ── 3. 환경변수 로드 ───────────────────────────────────────────────────────────

BACKEND_URL   = ""
POLL_INTERVAL = 30

def _load_env():
    global BACKEND_URL, POLL_INTERVAL

    if not _ENV_FILE.exists():
        _setup_wizard()

    from dotenv import load_dotenv
    load_dotenv(dotenv_path=_ENV_FILE, override=False)

    BACKEND_URL   = os.environ.get("BACKEND_URL", _DEFAULT_BACKEND).rstrip("/")
    POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "30"))


# ── 유틸 ──────────────────────────────────────────────────────────────────────

def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S")

def log(msg: str):
    print(f"[{_ts()}] {msg}", flush=True)


# ── 백엔드 큐 API ─────────────────────────────────────────────────────────────

def _list_queue() -> list[dict]:
    """백엔드를 통해 대기 중인 작업 목록 조회"""
    try:
        r = requests.get(f"{BACKEND_URL}/api/scraper/queue", timeout=15)
        return r.json() if r.ok else []
    except Exception:
        return []


def _download(url: str) -> dict | None:
    try:
        r = requests.get(url, timeout=15)
        return r.json() if r.ok else None
    except Exception:
        return None


def _mark_done(filename: str, sha: str) -> bool:
    """백엔드를 통해 큐 파일 삭제 (완료 표시)"""
    try:
        r = requests.post(
            f"{BACKEND_URL}/api/scraper/queue/{filename}/done",
            json={"sha": sha},
            timeout=15,
        )
        return r.ok
    except Exception:
        return False


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

    # ── Instagram 릴스 ────────────────────────────────────────────────────────
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

    # ── TikTok ────────────────────────────────────────────────────────────────
    if job_type == "tiktok":
        try:
            from run_scraper_ci import process_tiktok
            process_tiktok(job)
            return True
        except Exception as e:
            log(f"[오류] TikTok 스크래퍼 실패: {e}")
            return False

    # ── YouTube ───────────────────────────────────────────────────────────────
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

        if _mark_done(name, sha):
            log(f"[큐] 완료 처리: {name}")
        else:
            log(f"[경고] 완료 처리 실패 (수동 삭제 필요): {name}")

        log(f"[완료] {name} → {'✓ 성공' if ok else '✗ 실패'}")


# ── 진입점 ────────────────────────────────────────────────────────────────────

def main():
    _load_env()

    log("[서버] PARABLE-TUBEMETRIC 로컬 서버 시작")
    log(f"       백엔드: {BACKEND_URL}")
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
