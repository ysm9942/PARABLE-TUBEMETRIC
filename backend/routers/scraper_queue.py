"""
로컬 스크래퍼 ↔ GitHub 큐 프록시

프론트엔드와 로컬 local_server.py 모두 이 API만 호출합니다.
GitHub 토큰은 이 백엔드(Vercel/Render)에만 존재합니다.

엔드포인트:
  POST /api/scraper/queue/submit       — 작업 등록 (프론트엔드 → 백엔드)
  GET  /api/scraper/queue/{id}/status  — 작업 상태 확인 (프론트엔드 → 백엔드)
  GET  /api/scraper/queue              — 대기 중인 작업 목록 (local_server.py)
  POST /api/scraper/queue/{name}/done  — 작업 완료 (local_server.py)
  POST /api/scraper/results            — 결과 파일 push (local_server.py)
  POST /api/scraper/index              — index.json push (local_server.py)
"""

import base64
import json
import os
import random
import string
import time

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

# ── 환경변수 ──────────────────────────────────────────────────────────────────
_TOKEN  = os.environ.get("GITHUB_TOKEN", "")
_REPO   = os.environ.get("GITHUB_REPO",  "ysm9942/PARABLE-TUBEMETRIC")
_BRANCH = os.environ.get("GITHUB_BRANCH", "main")

_GH_API = f"https://api.github.com/repos/{_REPO}"
_GH_HDR = {
    "Authorization": f"Bearer {_TOKEN}",
    "Accept":        "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


# ── GitHub 헬퍼 ───────────────────────────────────────────────────────────────

async def _gh_get(path: str, params: dict | None = None) -> httpx.Response:
    async with httpx.AsyncClient(timeout=15) as c:
        return await c.get(f"{_GH_API}/{path}", headers=_GH_HDR, params=params or {})


async def _gh_put(path: str, body: dict) -> httpx.Response:
    async with httpx.AsyncClient(timeout=30) as c:
        return await c.put(f"{_GH_API}/{path}", headers=_GH_HDR, json=body)


async def _gh_delete(path: str, body: dict) -> httpx.Response:
    async with httpx.AsyncClient(timeout=15) as c:
        return await c.request("DELETE", f"{_GH_API}/{path}", headers=_GH_HDR, json=body)


# ── 0. 큐 작업 등록 (프론트엔드 → 백엔드 → GitHub) ───────────────────────────

def _new_request_id(prefix: str = "job") -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return f"{prefix}_{int(time.time() * 1000)}_{suffix}"


class SubmitRequest(BaseModel):
    type: str          # 'instagram' | 'channel' | 'video' | 'tiktok'
    handles: list[str]
    options: dict = {}


@router.post("/queue/submit")
async def submit_queue(req: SubmitRequest):
    """작업을 GitHub 큐에 등록합니다. 프론트엔드가 GITHUB_TOKEN 없이 호출 가능."""
    if not _TOKEN:
        raise HTTPException(status_code=503, detail="백엔드에 GITHUB_TOKEN 미설정")

    request_id = _new_request_id(req.type)
    path = f"results/queue/{request_id}.json"
    payload = {
        "requestId": request_id,
        "type": req.type,
        "handles": req.handles,
        "options": req.options,
        "requestedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    encoded = base64.b64encode(
        json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    ).decode()

    r = await _gh_put(
        f"contents/{path}",
        {"message": f"queue: {req.type} {request_id}", "content": encoded, "branch": _BRANCH},
    )
    if r.status_code not in (200, 201):
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return {"requestId": request_id}


@router.get("/queue/{request_id}/status")
async def queue_status(request_id: str):
    """큐 파일 존재 여부로 처리 상태를 반환합니다."""
    r = await _gh_get(
        f"contents/results/queue/{request_id}.json", {"ref": _BRANCH}
    )
    if r.status_code == 200:
        return {"status": "pending"}
    if r.status_code == 404:
        return {"status": "done"}
    return {"status": "error"}


# ── 1. 큐 목록 조회 ───────────────────────────────────────────────────────────

@router.get("/queue")
async def list_queue():
    """results/queue/ 의 미처리 작업 목록을 반환합니다."""
    r = await _gh_get("contents/results/queue", {"ref": _BRANCH})
    if not r.is_success:
        return []

    items = [
        f for f in r.json()
        if isinstance(f, dict)
        and f.get("name", "").endswith(".json")
        and f.get("name") != ".gitkeep"
    ]

    # 각 파일의 실제 내용도 함께 반환 (download_url 포함)
    return items


# ── 2. 작업 완료 (큐 파일 삭제) ───────────────────────────────────────────────

class DoneRequest(BaseModel):
    sha: str

@router.post("/queue/{filename}/done")
async def mark_done(filename: str, req: DoneRequest):
    """처리 완료된 큐 파일을 삭제합니다."""
    r = await _gh_delete(
        f"contents/results/queue/{filename}",
        {
            "message": f"scraper: done {filename}",
            "sha": req.sha,
            "branch": _BRANCH,
        },
    )
    if r.status_code not in (200, 204):
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return {"ok": True}


# ── 3. 결과 push ─────────────────────────────────────────────────────────────

class PushRequest(BaseModel):
    path: str        # "results/instagram/xxx.json"
    content: str     # JSON 문자열 (raw)
    message: str     # 커밋 메시지

@router.post("/results")
async def push_result(req: PushRequest):
    """결과 파일을 GitHub에 push합니다."""
    if not _TOKEN:
        raise HTTPException(status_code=503, detail="GITHUB_TOKEN 미설정")

    encoded = base64.b64encode(req.content.encode("utf-8")).decode()

    # 기존 파일 SHA 조회 (업데이트 시 필요)
    r_get = await _gh_get(f"contents/{req.path}", {"ref": _BRANCH})
    sha = r_get.json().get("sha") if r_get.is_success else None

    body: dict = {"message": req.message, "content": encoded, "branch": _BRANCH}
    if sha:
        body["sha"] = sha

    r = await _gh_put(f"contents/{req.path}", body)
    if r.status_code not in (200, 201):
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return {"ok": True}


# ── 4. index.json push ────────────────────────────────────────────────────────

class IndexRequest(BaseModel):
    index: dict   # 전체 index.json 내용

@router.post("/index")
async def push_index(req: IndexRequest):
    """results/index.json 을 업데이트합니다."""
    if not _TOKEN:
        raise HTTPException(status_code=503, detail="GITHUB_TOKEN 미설정")

    content = json.dumps(req.index, ensure_ascii=False, indent=2)
    encoded = base64.b64encode(content.encode("utf-8")).decode()

    r_get = await _gh_get("contents/results/index.json", {"ref": _BRANCH})
    sha = r_get.json().get("sha") if r_get.is_success else None

    body: dict = {"message": "index: update", "content": encoded, "branch": _BRANCH}
    if sha:
        body["sha"] = sha

    r = await _gh_put("contents/results/index.json", body)
    if r.status_code not in (200, 201):
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return {"ok": True}
