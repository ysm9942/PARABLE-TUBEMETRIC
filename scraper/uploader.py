"""
결과 JSON 로컬 저장 + GitHub Contents API push.

git 설치 없이도 동작하며, config.py 에 내장된 토큰을 사용한다.
로컬에는 exe 옆 results/ 폴더에 저장되고,
GitHub 레포에는 API로 직접 올린다.
"""
import base64
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import requests as _req

# ── 경로 설정 ─────────────────────────────────────────────────────────────────
if getattr(sys, 'frozen', False):
    _BASE = Path(sys.executable).parent
else:
    _BASE = Path(__file__).parent

RESULTS_DIR = _BASE / "results"


# ── 인증 정보 로드 ─────────────────────────────────────────────────────────────
def _get_creds() -> tuple[str, str, str]:
    """(token, repo, branch) 반환. config.py → .env → 환경변수 순서로 시도."""
    try:
        from config import get_github_token, GITHUB_REPO, GITHUB_BRANCH
        token = get_github_token()
        if token:
            return token, GITHUB_REPO, GITHUB_BRANCH
    except ImportError:
        pass

    import os
    try:
        from dotenv import load_dotenv
        env = _BASE / ".env"
        if env.exists():
            load_dotenv(env)
    except ImportError:
        pass

    return (
        os.environ.get("GITHUB_TOKEN", ""),
        os.environ.get("GITHUB_REPO", ""),
        os.environ.get("GITHUB_BRANCH", "main"),
    )


# ── GitHub Contents API ────────────────────────────────────────────────────────
def _gh_put(token: str, repo: str, branch: str,
            path: str, content: str, message: str) -> bool:
    """파일 생성 또는 업데이트 (SHA 자동 처리)."""
    url = f"https://api.github.com/repos/{repo}/contents/{path}"
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
    }
    r = _req.get(url, headers=headers, params={"ref": branch}, timeout=15)
    sha = r.json().get("sha") if r.status_code == 200 else None

    payload: dict = {
        "message": message,
        "content": base64.b64encode(content.encode("utf-8")).decode(),
        "branch": branch,
    }
    if sha:
        payload["sha"] = sha

    r = _req.put(url, headers=headers, json=payload, timeout=30)
    if r.status_code not in (200, 201):
        print(f"[GitHub API 오류] {r.status_code}: {r.json().get('message', '')}")
        return False
    return True


# ── index.json 관리 ───────────────────────────────────────────────────────────
def _load_local_index() -> dict:
    path = RESULTS_DIR / "index.json"
    if path.exists():
        try:
            return json.loads(path.read_text("utf-8"))
        except json.JSONDecodeError:
            pass
    return {"updatedAt": "", "channels": [], "videos": [], "ads": []}


def _upsert_index(index: dict, data_type: str, entry_id: str,
                  entry_name: str, filename: str, scraped_at: str):
    collection = index.setdefault(data_type, [])
    new_entry = {
        "id": entry_id,
        "name": entry_name,
        "filename": filename,
        "scrapedAt": scraped_at,
    }
    for i, e in enumerate(collection):
        if e.get("id") == entry_id:
            collection[i] = new_entry
            break
    else:
        collection.insert(0, new_entry)
    index["updatedAt"] = datetime.utcnow().isoformat() + "Z"


# ── 공개 API ──────────────────────────────────────────────────────────────────
def save_result(data: dict, data_type: str, identifier: str) -> Path:
    """결과를 로컬에 저장하고 index.json을 업데이트한다."""
    out_dir = RESULTS_DIR / data_type
    out_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    safe_id = re.sub(r'[<>:"/\\|?*]', "_", identifier)
    filepath = out_dir / f"{safe_id}_{timestamp}.json"
    filepath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    rel_path = f"results/{data_type}/{filepath.name}"
    scraped_at = data.get("scrapedAt", datetime.utcnow().isoformat() + "Z")
    entry_name = data.get("channelName") or data.get("title") or identifier

    index = _load_local_index()
    _upsert_index(index, data_type, identifier, entry_name, rel_path, scraped_at)
    (RESULTS_DIR / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"[저장] {rel_path}")
    return filepath


def _push_via_backend(backend_url: str, filepath: Path, data: dict | None,
                      data_type: str, identifier: str) -> bool:
    """백엔드 프록시를 통해 결과를 push한다 (GitHub 토큰 불필요)."""
    import requests as _rq

    scraped_by = (data or {}).get("scrapedBy", {})
    operator   = scraped_by.get("operator", "unknown")
    hostname   = scraped_by.get("hostname", "unknown")
    label      = f"{data_type} {identifier}" if data_type else filepath.name

    rel_path = f"results/{data_type}/{filepath.name}" if data_type else filepath.name
    content  = filepath.read_text("utf-8")

    # 결과 파일 push
    print(f"[Backend] push: {rel_path}")
    r1 = _rq.post(
        f"{backend_url}/api/scraper/results",
        json={"path": rel_path, "content": content,
              "message": f"scraper: {label} by {operator}@{hostname}"},
        timeout=30,
    )
    if not r1.ok:
        print(f"[Backend] 결과 push 실패: {r1.status_code}")
        return False

    # index.json push
    index = _load_local_index()
    r2 = _rq.post(
        f"{backend_url}/api/scraper/index",
        json={"index": index},
        timeout=30,
    )
    if not r2.ok:
        print(f"[Backend] index push 실패: {r2.status_code}")
        return False

    print("[Backend] push 완료 ✓")
    return True


def push_to_github(filepath: Path, data: dict | None = None,
                   data_type: str = "", identifier: str = "") -> bool:
    """결과 파일과 index.json을 push한다.

    BACKEND_URL 환경변수가 있으면 백엔드 프록시를 사용 (GitHub 토큰 불필요).
    없으면 GitHub Contents API 직접 호출 (GITHUB_TOKEN 필요).
    """
    import os as _os

    # 백엔드 프록시 우선
    backend_url = _os.environ.get("BACKEND_URL", "").rstrip("/")
    if backend_url:
        return _push_via_backend(backend_url, filepath, data, data_type, identifier)

    # 폴백: GitHub 직접 호출
    token, repo, branch = _get_creds()
    if not token or not repo:
        print("[GitHub] 토큰/레포/백엔드 미설정 — push 생략")
        return False

    scraped_by = (data or {}).get("scrapedBy", {})
    operator   = scraped_by.get("operator", "unknown")
    hostname   = scraped_by.get("hostname", "unknown")
    label      = f"{data_type} {identifier}" if data_type else filepath.name
    commit_msg = f"scraper: {label} by {operator}@{hostname}"

    rel_path = f"results/{data_type}/{filepath.name}" if data_type else filepath.name
    content  = filepath.read_text("utf-8")

    print(f"[GitHub] push: {rel_path}")
    ok1 = _gh_put(token, repo, branch, rel_path, content, commit_msg)

    index   = _load_local_index()
    idx_str = json.dumps(index, ensure_ascii=False, indent=2)
    ok2 = _gh_put(token, repo, branch, "results/index.json", idx_str,
                  f"index: update {label}")

    if ok1 and ok2:
        print("[GitHub] push 완료 ✓")
    return ok1 and ok2


def save_and_push(data: dict, data_type: str, identifier: str) -> Path:
    """save_result + push_to_github 한 번에 실행."""
    filepath = save_result(data, data_type, identifier)
    push_to_github(filepath, data, data_type, identifier)
    return filepath
