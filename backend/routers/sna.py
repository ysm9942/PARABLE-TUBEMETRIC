"""
SNA(사회연결망 분석) 라우터 — 관계 강도(z) 기반 팬덤 네트워크 분석

'관계도'(채팅 참여자 overlap)와 동일한 softc.one 데이터를 기반으로 한다.
관계도는 중심 채널의 ego network(중심 + 상위 이웃 + 쌍별 지표: 관계 강도 z,
Lift, 이 채널 중 %, 상대 채널 중 %)를 그대로 보여주고, SNA 분석은 그 관계도
데이터를 '분석 계층'으로 확장한다: 관계도의 중심+이웃을 노드 집합으로 삼고,
각 이웃의 관계도까지 스노우볼로 모아 이웃 간 엣지를 채운 뒤 무방향 가중
네트워크로 중심성/커뮤니티/역할을 계산한다(부분 네트워크). 프론트에서 이미
수집한 관계도(seedGraph)를 넘기면 시드 재크롤 없이 그 데이터를 그대로 쓴다.
관측되지 않은 엣지는 0으로 확정하지 않는다.

분석(networkx):
  - 가중 연결 중심성(weighted degree, weight=z)
  - 매개 중심성(betweenness, weight=distance=1/z)
  - 고유벡터 중심성(eigenvector, weight=z · 수렴 실패 시 null)
  - 커뮤니티 탐지(Louvain, weight=z, seed 고정)
  - 외부 팬덤 연결 비율, 역할 분류
  - 레이아웃 좌표(spring_layout, 극단값 제한 위해 log(1+z) 가중)

엔드포인트:
  POST /api/sna/build   — 관계도(seedGraph) 또는 시드 기준 네트워크 구성 + 분석
"""
import asyncio
import logging
import math
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

# live.py의 overlap 크롤러/파서 재사용
from routers.live import (  # noqa: E402
    _fetch_with_playwright,
    _parse_overlap_html,
    _build_overlap_url,
    _default_period_start,
)

PLAT_NORM = {"naverchzzk": "chzzk", "afreeca": "soop"}

# 커뮤니티 색상(채도 과하지 않게) — 프론트와 동일 팔레트
COMMUNITY_COLORS = [
    "#6277C3", "#67A6A0", "#C88B76", "#A18AC6", "#D0B16A",
    "#7297B9", "#B58B9F", "#93A66C", "#C47F7F", "#6FA8B8",
]


class SNARequest(BaseModel):
    platform: str = "soop"          # 시드 플랫폼 (soop|chzzk)
    seed: str = ""                  # 시드 크리에이터 ID 또는 softc URL
    period: str = "month"           # week|month — 관계도와 동일 기간
    periodStart: str = ""           # YYYY-MM-DD (기간 시작일); 비면 기본값
    neighbors: int = 12             # 스노우볼 이웃 수 (K)
    resolution: float = 1.0         # Louvain 해상도
    concurrency: int = 3            # Playwright 동시 실행 상한
    # 프론트에서 이미 수집한 '관계도'(fetchOverlapGraph 결과)를 그대로 넘기면
    # 시드 재크롤 없이 그 중심+이웃+지표를 노드 집합/시드 엣지로 사용한다.
    seedGraph: Optional[dict[str, Any]] = None


async def _crawl_overlap(platform: str, cid: str, period: str, period_start: str, sem: asyncio.Semaphore):
    """단일 크리에이터 overlap 크롤링 → (center, neighbors[])."""
    url = _build_overlap_url(platform, cid, period, period_start)
    async with sem:
        try:
            html, _ = await _fetch_with_playwright(
                url, wait_selector="a[href*='/overlap']", capture_all_json=False,
            )
        except Exception as e:
            logger.warning("[SNA] 크롤 실패 %s/%s: %s", platform, cid, e)
            return None, []
    graph = _parse_overlap_html(html, cid, platform)
    nodes = graph.get("nodes") or []
    center = next((n for n in nodes if n.get("isCenter")), None)
    neighbors = [n for n in nodes if not n.get("isCenter")]
    return center, neighbors


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


@router.post("/build")
async def build_sna(req: SNARequest):
    platform = (req.platform or "soop").strip().lower()
    seed = (req.seed or "").strip()
    period = (req.period or "month").strip().lower()
    if period not in ("week", "month"):
        period = "month"

    # ── 관계도(seedGraph)가 함께 오면 그 중심/이웃/기간을 그대로 사용 ──
    sg = req.seedGraph if isinstance(req.seedGraph, dict) else None
    sg_nodes = (sg or {}).get("nodes") or []
    sg_center = next((n for n in sg_nodes if n.get("isCenter")), None) if sg_nodes else None
    use_graph = bool(sg_center or (sg_nodes and len(sg_nodes) >= 2))
    if use_graph:
        # 중심 채널: isCenter 노드 우선, 없으면 seedGraph.creatorId
        seed = (sg_center or {}).get("id") or (sg.get("creatorId") or "").strip() or seed
        platform = (
            (sg_center or {}).get("platform")
            or sg.get("platform") or platform
        ).strip().lower()
        if sg.get("period") in ("week", "month"):
            period = sg["period"]

    # softc URL 통째 입력 지원
    if not use_graph and ("softc.one" in seed or seed.startswith("http")):
        import re
        m = re.search(r"/channel/([^/]+)/([^/?#\s]+)", seed)
        if m:
            platform = PLAT_NORM.get(m.group(1), m.group(1))
            seed = m.group(2)
    elif not use_graph and ":" in seed:
        p, c = seed.split(":", 1)
        platform, seed = p.strip().lower(), c.strip()

    period_start = (
        (sg.get("periodStart") if use_graph else "")
        or (req.periodStart or "").strip()
        or _default_period_start(period)
    )
    K = max(2, min(int(req.neighbors or 12), 40))
    resolution = float(req.resolution or 1.0)

    base = {
        "status": "error", "seed": seed, "platform": platform.upper(),
        "period": period, "periodStart": period_start, "partial": True,
        "basedOn": "관계도" if use_graph else "시드 스노우볼",
        "stats": {"nodes": 0, "edges": 0, "communities": 0, "density": 0.0},
        "communities": [], "nodes": [], "edges": [],
        "scrapedAt": datetime.utcnow().isoformat() + "Z",
    }
    if not seed:
        base["error"] = "시드 크리에이터(또는 관계도)가 필요합니다."
        return base

    try:
        import networkx as nx
    except ImportError:
        base["error"] = "networkx 미설치 — 백엔드에 networkx를 추가하세요."
        return base

    sem = asyncio.Semaphore(max(1, min(int(req.concurrency or 3), 6)))

    # ── 1) 시드 이웃 확보 → 상위 K 선정 ──
    if use_graph:
        # 관계도 데이터를 그대로 사용 (시드 재크롤 없음)
        logger.info("[SNA] 관계도 기반: %s/%s (%s %s) · 이웃 %d",
                    platform, seed, period, period_start,
                    len([n for n in sg_nodes if not n.get("isCenter")]))
        seed_center = sg_center
        seed_neighbors = [n for n in sg_nodes if not n.get("isCenter") and n.get("id")]
    else:
        logger.info("[SNA] 시드 크롤: %s/%s (%s %s)", platform, seed, period, period_start)
        seed_center, seed_neighbors = await _crawl_overlap(platform, seed, period, period_start, sem)
    if not seed_neighbors:
        base["error"] = "관계도 데이터를 가져오지 못했습니다. 채널 ID/기간을 확인하세요."
        return base

    seed_neighbors.sort(key=lambda n: _num(n.get("strength")) or 0, reverse=True)
    top = seed_neighbors[:K]

    # 노드 메타(이름/이미지/플랫폼) 수집
    meta: dict[str, dict] = {}
    meta[seed] = {
        "id": seed, "platform": platform,
        "name": (seed_center or {}).get("label") or seed,
        "profileImage": (seed_center or {}).get("image") or "",
    }
    node_ids = [seed]
    for n in top:
        nid = n.get("id")
        if not nid or nid in meta:
            continue
        meta[nid] = {
            "id": nid, "platform": n.get("platform") or platform,
            "name": n.get("label") or nid, "profileImage": n.get("image") or "",
        }
        node_ids.append(nid)

    node_set = set(node_ids)

    # 관측된 방향별 기록: obs[(src,dst)] = {z, lift, srcPct(이 채널 중), dstPct(상대 채널 중)}
    obs: dict[tuple, dict] = {}

    def _record(src, page_neighbors):
        for nb in page_neighbors:
            dst = nb.get("id")
            if dst not in node_set or dst == src:
                continue
            z = _num(nb.get("strength"))
            if z is None or z <= 0:
                continue
            obs[(src, dst)] = {
                "z": z,
                "lift": _num(nb.get("lift")),
                "srcPct": _num(nb.get("thisPct")),   # src(이 채널) 측 중복 %
                "dstPct": _num(nb.get("otherPct")),  # dst(상대 채널) 측 중복 %
            }

    _record(seed, seed_neighbors)

    # ── 2) 이웃들 스노우볼 크롤 (이웃 간 엣지 발견용) ──
    async def _crawl_one(cid):
        p = meta[cid]["platform"]
        _, nbs = await _crawl_overlap(p, cid, period, period_start, sem)
        return cid, nbs

    tasks = [_crawl_one(cid) for cid in node_ids if cid != seed]
    for cid, nbs in await asyncio.gather(*tasks):
        if nbs:
            _record(cid, nbs)
        # 이미지/이름 보강(이웃 페이지의 center에서 더 정확할 수 있으나 생략)

    # ── 3) 무방향 가중 그래프 구성 (관측 엣지만) ──
    G = nx.Graph()
    for nid in node_ids:
        G.add_node(nid)

    pairs = set()
    for (s, d) in obs.keys():
        pairs.add(tuple(sorted((s, d))))

    edges_out = []
    for (a, b) in pairs:
        f = obs.get((a, b))
        r = obs.get((b, a))
        zs = [x["z"] for x in (f, r) if x and x["z"] is not None]
        if not zs:
            continue
        z = sum(zs) / len(zs)
        lifts = [x["lift"] for x in (f, r) if x and x["lift"] is not None]
        lift = (sum(lifts) / len(lifts)) if lifts else None
        # a측/b측 중복 %: f는 a→b (srcPct=a, dstPct=b), r은 b→a (srcPct=b, dstPct=a)
        a_pcts = [v for v in [(f or {}).get("srcPct"), (r or {}).get("dstPct")] if v is not None]
        b_pcts = [v for v in [(f or {}).get("dstPct"), (r or {}).get("srcPct")] if v is not None]
        a_pct = (sum(a_pcts) / len(a_pcts)) if a_pcts else None
        b_pct = (sum(b_pcts) / len(b_pcts)) if b_pcts else None
        vw = math.log(1.0 + z)
        G.add_edge(a, b, weight=z, vw=vw, distance=1.0 / max(z, 1e-9))
        edges_out.append({
            "source": a, "target": b,
            "relationshipZ": round(z, 2),
            "lift": round(lift, 2) if lift is not None else None,
            "sourceOverlapPct": round(a_pct, 1) if a_pct is not None else None,
            "targetOverlapPct": round(b_pct, 1) if b_pct is not None else None,
            "analysisWeight": round(z, 2),
            "visualWeight": round(vw, 4),
            "distance": round(1.0 / max(z, 1e-9), 6),
        })

    n_nodes, n_edges = G.number_of_nodes(), G.number_of_edges()
    if n_edges == 0:
        base["error"] = "관측된 관계 엣지가 없습니다."
        return base

    # ── 4) SNA 지표 ──
    weighted_degree = dict(G.degree(weight="weight"))
    degree = dict(G.degree())
    try:
        betweenness = nx.betweenness_centrality(G, weight="distance", normalized=True)
    except Exception as e:
        logger.warning("[SNA] betweenness 실패: %s", e)
        betweenness = {n: 0.0 for n in G.nodes()}

    eigenvector = None
    eig_ok = True
    try:
        eigenvector = nx.eigenvector_centrality(G, weight="weight", max_iter=1000, tol=1e-6)
    except Exception as e:
        eig_ok = False
        logger.warning("[SNA] eigenvector 수렴 실패: %s", e)

    # 커뮤니티 (Louvain, 재현 가능)
    try:
        comm_sets = nx.community.louvain_communities(
            G, weight="weight", resolution=resolution, seed=42,
        )
    except Exception as e:
        logger.warning("[SNA] louvain 실패, 연결성분 사용: %s", e)
        comm_sets = list(nx.connected_components(G))
    # 크기 내림차순 → 커뮤니티 번호 안정화
    comm_sets = sorted(comm_sets, key=lambda s: len(s), reverse=True)
    comm_of: dict[str, int] = {}
    for idx, s in enumerate(comm_sets):
        for nid in s:
            comm_of[nid] = idx

    # 외부 팬덤 연결 비율
    cross_ratio: dict[str, float] = {}
    internal_share: dict[str, float] = {}
    for nid in G.nodes():
        tot = 0.0
        ext = 0.0
        for nb in G.neighbors(nid):
            z = G[nid][nb]["weight"]
            tot += z
            if comm_of.get(nb) != comm_of.get(nid):
                ext += z
        cross_ratio[nid] = (ext / tot * 100.0) if tot > 0 else 0.0
        internal_share[nid] = ((tot - ext) / tot) if tot > 0 else 0.0

    # 레이아웃 (log 가중 spring, 재현 가능) → 0..1000
    try:
        pos = nx.spring_layout(G, weight="vw", seed=42, iterations=200)
    except Exception:
        pos = nx.circular_layout(G)
    xs = [p[0] for p in pos.values()] or [0]
    ys = [p[1] for p in pos.values()] or [0]
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    sx = (maxx - minx) or 1.0
    sy = (maxy - miny) or 1.0

    # 백분위(역할 분류용)
    def _pct_rank(d: dict) -> dict:
        items = sorted(d.items(), key=lambda kv: kv[1])
        m = len(items)
        out = {}
        for i, (k, _) in enumerate(items):
            out[k] = (i / (m - 1)) if m > 1 else 1.0
        return out

    wd_pct = _pct_rank(weighted_degree)
    bt_pct = _pct_rank(betweenness)

    def _role(nid):
        wdp, btp = wd_pct.get(nid, 0), bt_pct.get(nid, 0)
        cr, insh, deg = cross_ratio.get(nid, 0), internal_share.get(nid, 0), degree.get(nid, 0)
        roles = []
        if btp >= 0.8 and cr >= 50:
            roles.append("팬덤 브리지형")
        if wdp >= 0.8:
            roles.append("팬덤 허브형")
        if insh >= 0.6 and wdp >= 0.5:
            roles.append("커뮤니티 핵심형")
        if deg <= 1 or wdp <= 0.2:
            roles.append("독립 팬덤형")
        if not roles:
            roles.append("커뮤니티 핵심형")
        return roles[0], (roles[1] if len(roles) > 1 else None)

    nodes_out = []
    for nid in G.nodes():
        m = meta.get(nid, {"id": nid, "platform": platform, "name": nid, "profileImage": ""})
        deg = degree.get(nid, 0)
        wd = weighted_degree.get(nid, 0.0)
        role, role2 = _role(nid)
        p = pos.get(nid, (0, 0))
        nodes_out.append({
            "id": nid,
            "name": m["name"],
            "platform": m["platform"],
            "profileImage": m["profileImage"],
            "communityId": comm_of.get(nid, 0),
            "degree": deg,
            "weightedDegree": round(wd, 2),
            "averageTieStrength": round(wd / deg, 2) if deg else 0.0,
            "betweenness": round(betweenness.get(nid, 0.0), 4),
            "eigenvectorCentrality": (round(eigenvector[nid], 4) if (eig_ok and eigenvector) else None),
            "crossCommunityRatio": round(cross_ratio.get(nid, 0.0), 1),
            "role": role,
            "roleSecondary": role2,
            "isSeed": nid == seed,
            "x": round((p[0] - minx) / sx * 1000.0, 2),
            "y": round((p[1] - miny) / sy * 1000.0, 2),
        })

    # 커뮤니티 요약
    communities_out = []
    for idx, s in enumerate(comm_sets):
        members = [n for n in s if n in G]
        if not members:
            continue
        # 내부 평균 z / 밀도
        sub = G.subgraph(members)
        intra_z = [sub[u][v]["weight"] for u, v in sub.edges()]
        internal_avg = (sum(intra_z) / len(intra_z)) if intra_z else 0.0
        # 핵심 = 커뮤니티 내 weighted_degree 최대
        core = max(members, key=lambda n: weighted_degree.get(n, 0)) if members else None
        # 외부 연결
        ext_links = 0
        ext_z = 0.0
        for u in members:
            for v in G.neighbors(u):
                if comm_of.get(v) != idx:
                    ext_links += 1
                    ext_z += G[u][v]["weight"]
        communities_out.append({
            "id": idx,
            "name": f"커뮤니티 {idx + 1:02d}",
            "color": COMMUNITY_COLORS[idx % len(COMMUNITY_COLORS)],
            "size": len(members),
            "coreId": core,
            "coreName": meta.get(core, {}).get("name", core) if core else None,
            "internalAvgZ": round(internal_avg, 2),
            "density": round(nx.density(sub), 3) if len(members) > 1 else 0.0,
            "externalLinks": ext_links // 2,   # 무방향 중복 보정은 근사
            "externalZ": round(ext_z, 2),
        })

    base.update({
        "status": "completed",
        "partial": True,   # 스노우볼 = 항상 부분 관측
        "eigenvectorOk": eig_ok,
        "stats": {
            "nodes": n_nodes,
            "edges": n_edges,
            "communities": len(communities_out),
            "density": round(nx.density(G), 4),
        },
        "communities": communities_out,
        "nodes": nodes_out,
        "edges": edges_out,
    })
    logger.info("[SNA] 완료: 노드 %d · 엣지 %d · 커뮤니티 %d", n_nodes, n_edges, len(communities_out))
    return base
