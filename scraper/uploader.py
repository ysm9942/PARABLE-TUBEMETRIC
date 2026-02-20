"""
결과 JSON 저장 + index.json 갱신 + GitHub push 유틸리티.

로컬 git repo에 결과를 커밋하고 push하면,
Vercel의 React 앱이 raw.githubusercontent.com에서 직접 JSON을 읽는다.
Firebase / GitHub Actions 불필요.
"""
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path


# 프로젝트 루트 (scraper/ 의 부모)
ROOT = Path(__file__).parent.parent
INDEX_FILE = ROOT / "results" / "index.json"


# ──────────────────────────────────────────────
# Git 헬퍼
# ──────────────────────────────────────────────

def _run_git(args: list[str]) -> bool:
    try:
        result = subprocess.run(
            ["git", *args], cwd=ROOT, capture_output=True, text=True
        )
        if result.returncode != 0:
            print(f"[git 오류] git {' '.join(args)}\n{result.stderr}", file=sys.stderr)
            return False
        return True
    except FileNotFoundError:
        print("[오류] git 명령을 찾을 수 없습니다.", file=sys.stderr)
        return False


# ──────────────────────────────────────────────
# index.json 관리
# ──────────────────────────────────────────────

def _load_index() -> dict:
    if INDEX_FILE.exists():
        with open(INDEX_FILE, encoding="utf-8") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                pass
    return {"updatedAt": "", "channels": [], "videos": [], "ads": []}


def _save_index(index: dict):
    index["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)


def _upsert_index(data_type: str, entry_id: str, entry_name: str, filename: str, scraped_at: str):
    """index.json 에 항목을 추가하거나 최신 파일로 업데이트"""
    index = _load_index()
    collection = index.setdefault(data_type, [])

    new_entry = {
        "id": entry_id,
        "name": entry_name,
        "filename": filename,
        "scrapedAt": scraped_at,
    }

    # 같은 ID가 이미 있으면 교체, 없으면 앞에 삽입
    for i, e in enumerate(collection):
        if e.get("id") == entry_id:
            collection[i] = new_entry
            break
    else:
        collection.insert(0, new_entry)

    _save_index(index)


# ──────────────────────────────────────────────
# 공개 API
# ──────────────────────────────────────────────

def save_result(data: dict, data_type: str, identifier: str) -> Path:
    """
    결과 dict를 results/{data_type}/{identifier}_{timestamp}.json 에 저장하고
    results/index.json 을 업데이트한다.

    data_type: "channels" | "videos" | "ads"
    identifier: channelId 또는 videoId
    """
    out_dir = ROOT / "results" / data_type
    out_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = out_dir / f"{identifier}_{timestamp}.json"

    with open(filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    relative_path = str(filename.relative_to(ROOT)).replace("\\", "/")
    scraped_at = data.get("scrapedAt", datetime.utcnow().isoformat() + "Z")

    # index.json 갱신
    entry_name = data.get("channelName") or data.get("title") or identifier
    _upsert_index(data_type, identifier, entry_name, relative_path, scraped_at)

    print(f"[저장] {relative_path}")
    return filename


def push_to_github(filepath: Path, commit_msg: str = "") -> bool:
    """
    저장된 결과 파일 + index.json 을 git add → commit → push.
    """
    rel = str(filepath.relative_to(ROOT)).replace("\\", "/")
    msg = commit_msg or f"scraper: add result {rel}"

    print(f"[GitHub] push 시작: {rel}")

    # 결과 파일과 index.json 을 함께 스테이징
    if not _run_git(["add", rel, "results/index.json"]):
        return False

    # 변경 사항 확인
    status = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=ROOT, capture_output=True, text=True
    )
    if not status.stdout.strip():
        print("[GitHub] 변경 사항 없음, push 생략")
        return True

    if not _run_git(["commit", "-m", msg]):
        return False

    if not _run_git(["push"]):
        return False

    print(f"[GitHub] push 완료 ✓")
    return True


def save_and_push(data: dict, data_type: str, identifier: str) -> Path:
    """save_result + push_to_github 한 번에 실행"""
    filepath = save_result(data, data_type, identifier)
    push_to_github(filepath)
    return filepath
