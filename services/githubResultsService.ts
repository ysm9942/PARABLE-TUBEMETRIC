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
// 로컬 스크래퍼 Queue — 백엔드 프록시 방식
// GITHUB_TOKEN 불필요. 백엔드 URL만 있으면 됩니다.
// ──────────────────────────────────────────────

const BACKEND_URL = (process.env.BACKEND_URL ?? '').replace(/\/$/, '');

async function _backendPost(path: string, body: unknown): Promise<Response> {
  return fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * 백엔드를 통해 작업을 큐에 등록합니다. (GITHUB_TOKEN 불필요)
 */
export const submitScrapeRequest = async (
  handles: string[],
  type: 'channel' | 'video' = 'channel',
  options: { scrolls?: number; headless?: boolean; start?: string; end?: string } = {}
): Promise<{ requestId: string } | null> => {
  if (!BACKEND_URL) return null;
  try {
    const res = await _backendPost('/api/scraper/queue/submit', {
      type,
      handles,
      options: { headless: true, scrolls: 10, ...options },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

/**
 * 백엔드를 통해 큐 작업 상태를 확인합니다.
 */
export const checkQueueStatus = async (
  requestId: string
): Promise<'pending' | 'done' | 'error'> => {
  if (!BACKEND_URL) return 'error';
  try {
    const res = await fetch(`${BACKEND_URL}/api/scraper/queue/${requestId}/status`);
    if (!res.ok) return 'error';
    const data = await res.json();
    return data.status as 'pending' | 'done' | 'error';
  } catch {
    return 'error';
  }
};

// ──────────────────────────────────────────────
// Instagram 스크래퍼
// ──────────────────────────────────────────────

import type { InstagramUserResult } from '../types';

/**
 * Instagram 릴스 수집 요청을 백엔드를 통해 큐에 등록합니다. (GITHUB_TOKEN 불필요)
 */
export const submitInstagramRequest = async (
  usernames: string[],
  amount: number = 10
): Promise<{ requestId: string } | null> => {
  if (!BACKEND_URL) return null;
  try {
    const res = await _backendPost('/api/scraper/queue/submit', {
      type: 'instagram',
      handles: usernames.map(u => u.replace(/^@/, '')),
      options: { amount },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

/**
 * Instagram 큐 파일 상태 확인
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
