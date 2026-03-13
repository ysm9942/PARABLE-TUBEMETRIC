/**
 * GitHub Raw URL에서 스크래퍼 결과 JSON을 가져오는 서비스.
 *
 * 데이터 흐름:
 *   로컬 Python 스크래퍼 → results/ 폴더 (index.json 포함) → git push
 *   → raw.githubusercontent.com → Vercel React 앱
 *
 * Vercel 환경변수:
 *   GITHUB_REPO   : "owner/repo-name"  (예: ysm9942/PARABLE-TUBEMETRIC)
 *   GITHUB_BRANCH : "main" or "master" (기본값: main)
 */

const REPO = process.env.GITHUB_REPO ?? '';
const BRANCH = process.env.GITHUB_BRANCH ?? 'main';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

// ──────────────────────────────────────────────
// 내부 헬퍼
// ──────────────────────────────────────────────

async function fetchJSON<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${RAW_BASE}/${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────
// 인덱스 (스크래퍼가 유지하는 목록 파일)
// ──────────────────────────────────────────────

export interface ResultIndex {
  updatedAt: string;
  channels: IndexEntry[];
  videos: IndexEntry[];
  ads: IndexEntry[];
  instagram: IndexEntry[];
}

export interface IndexEntry {
  id: string;           // channelId 또는 videoId
  name?: string;
  filename: string;     // "results/channels/UCxxx_20240101.json"
  scrapedAt: string;
}

export const fetchIndex = (): Promise<ResultIndex | null> =>
  fetchJSON<ResultIndex>('results/index.json');

// ──────────────────────────────────────────────
// 채널 결과
// ──────────────────────────────────────────────

export const getChannelResult = async (channelId: string) => {
  const index = await fetchIndex();
  const entry = index?.channels.find(c => c.id === channelId);
  if (!entry) return null;
  return fetchJSON(entry.filename);
};

export const getAllChannelResults = async () => {
  const index = await fetchIndex();
  if (!index?.channels.length) return [];
  const results = await Promise.all(index.channels.map(e => fetchJSON(e.filename)));
  return results.filter(Boolean);
};

// ──────────────────────────────────────────────
// 영상 결과
// ──────────────────────────────────────────────

export const getVideoResult = async (videoId: string) => {
  const index = await fetchIndex();
  const entry = index?.videos.find(v => v.id === videoId);
  if (!entry) return null;
  return fetchJSON(entry.filename);
};

export const getAllVideoResults = async () => {
  const index = await fetchIndex();
  if (!index?.videos.length) return [];
  const results = await Promise.all(index.videos.map(e => fetchJSON(e.filename)));
  return results.filter(Boolean);
};

// ──────────────────────────────────────────────
// 광고 결과
// ──────────────────────────────────────────────

export const getAdResult = async (channelId: string) => {
  const index = await fetchIndex();
  const entry = index?.ads.find(a => a.id === channelId);
  if (!entry) return null;
  return fetchJSON(entry.filename);
};

export const getAllAdResults = async () => {
  const index = await fetchIndex();
  if (!index?.ads.length) return [];
  const results = await Promise.all(index.ads.map(e => fetchJSON(e.filename)));
  return results.filter(Boolean);
};

// ──────────────────────────────────────────────
// 로컬 스크래퍼 Queue (Vercel → GitHub → 로컬)
// ──────────────────────────────────────────────

const WRITE_TOKEN = process.env.GITHUB_TOKEN ?? '';
const GH_API = `https://api.github.com/repos/${REPO}`;

/**
 * Vercel 사이트에서 로컬 스크래퍼에 작업을 요청합니다.
 * results/queue/{requestId}.json 파일을 GitHub에 생성합니다.
 * 로컬 local_server.py 가 이 파일을 감지하고 스크래퍼를 실행합니다.
 */
export const submitScrapeRequest = async (
  handles: string[],
  type: 'channel' | 'video' = 'channel',
  options: { scrolls?: number; headless?: boolean; start?: string; end?: string } = {}
): Promise<{ requestId: string } | null> => {
  if (!WRITE_TOKEN || !REPO) return null;

  const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const path = `results/queue/${requestId}.json`;
  const payload = {
    requestId,
    type,
    handles,
    options: { headless: true, scrolls: 10, ...options },
    requestedAt: new Date().toISOString(),
  };

  // base64 인코딩 (GitHub API content 필드 요건)
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));

  const res = await fetch(`${GH_API}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${WRITE_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({
      message: `scraper: queue ${requestId}`,
      content: encoded,
      branch: BRANCH,
    }),
  });

  return res.ok ? { requestId } : null;
};

/**
 * 큐 파일이 아직 존재하면 'pending', 삭제됐으면 'done' 반환.
 * 로컬 서버가 처리 완료 후 파일을 삭제하므로 파일 유무로 상태를 판단합니다.
 */
export const checkQueueStatus = async (
  requestId: string
): Promise<'pending' | 'done' | 'error'> => {
  if (!WRITE_TOKEN || !REPO) return 'error';
  try {
    const res = await fetch(
      `${GH_API}/contents/results/queue/${requestId}.json?ref=${BRANCH}`,
      {
        headers: {
          Authorization: `Bearer ${WRITE_TOKEN}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );
    if (res.status === 200) return 'pending';
    if (res.status === 404) return 'done';
    return 'error';
  } catch {
    return 'error';
  }
};

// ──────────────────────────────────────────────
// Instagram 스크래퍼
// ──────────────────────────────────────────────

import type { InstagramUserResult } from '../types';

/**
 * Instagram 릴스 수집 요청을 GitHub 큐에 등록합니다.
 * local_server.py가 type: 'instagram' 을 감지하고 instagram_scraper.py를 실행합니다.
 */
export const submitInstagramRequest = async (
  usernames: string[],
  amount: number = 10
): Promise<{ requestId: string } | null> => {
  if (!WRITE_TOKEN || !REPO) return null;

  const requestId = `ig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const path = `results/queue/${requestId}.json`;
  const payload = {
    requestId,
    type: 'instagram',
    handles: usernames.map(u => u.replace(/^@/, '')),
    options: { amount },
    requestedAt: new Date().toISOString(),
  };

  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));

  const res = await fetch(`${GH_API}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${WRITE_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({
      message: `instagram: queue ${requestId}`,
      content: encoded,
      branch: BRANCH,
    }),
  });

  return res.ok ? { requestId } : null;
};

/**
 * Instagram 큐 파일 상태 확인 (checkQueueStatus와 동일 로직, ig_ 접두어 구분용)
 */
export const checkInstagramQueueStatus = (requestId: string) =>
  checkQueueStatus(requestId);

/**
 * index.json의 instagram 섹션에서 모든 수집 결과를 가져옵니다.
 */
export const getAllInstagramResults = async (): Promise<InstagramUserResult[]> => {
  const index = await fetchIndex();
  if (!index?.instagram?.length) return [];
  const results = await Promise.all(
    index.instagram.map(e => fetchJSON<InstagramUserResult>(e.filename))
  );
  return results.filter((r): r is InstagramUserResult => r !== null);
};
