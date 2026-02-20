"""
결과 JSON 저장 + GitHub push 유틸리티
로컬 git repo에 결과를 커밋하고 push한다.
GitHub Actions가 push를 감지해 Firebase로 동기화한다.
"""
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path


# 프로젝트 루트 (scraper/ 의 부모)
ROOT = Path(__file__).parent.parent


def _run_git(args: list[str], cwd: Path = ROOT) -> bool:
    """git 명령 실행. 실패 시 False 반환"""
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"[git 오류] git {' '.join(args)}\n{result.stderr}", file=sys.stderr)
            return False
        return True
    except FileNotFoundError:
        print("[오류] git 명령을 찾을 수 없습니다.", file=sys.stderr)
        return False


def save_result(data: dict, data_type: str, identifier: str) -> Path:
    """
    결과 dict를 results/{data_type}/{identifier}_{timestamp}.json 에 저장.

    data_type: "channels" | "videos" | "ads"
    identifier: channelId 또는 videoId
    """
    out_dir = ROOT / "results" / data_type
    out_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = out_dir / f"{identifier}_{timestamp}.json"

    with open(filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"[저장] {filename.relative_to(ROOT)}")
    return filename


def push_to_github(filepath: Path, commit_msg: str = "") -> bool:
    """
    저장된 파일을 git add → commit → push.
    실패 시 False 반환하고 로컬 파일은 보존.
    """
    rel = str(filepath.relative_to(ROOT))
    msg = commit_msg or f"scraper: add result {rel}"

    print(f"[GitHub] push 시작: {rel}")

    if not _run_git(["add", rel]):
        return False

    # 변경 사항이 없으면 commit 건너뜀
    status = subprocess.run(
        ["git", "status", "--porcelain", rel],
        cwd=ROOT, capture_output=True, text=True
    )
    if not status.stdout.strip():
        print("[GitHub] 변경 사항 없음, push 생략")
        return True

    if not _run_git(["commit", "-m", msg]):
        return False

    if not _run_git(["push"]):
        return False

    print(f"[GitHub] push 완료: {rel}")
    return True


def save_and_push(data: dict, data_type: str, identifier: str) -> Path:
    """save_result + push_to_github 한 번에 실행"""
    filepath = save_result(data, data_type, identifier)
    push_to_github(filepath)
    return filepath
