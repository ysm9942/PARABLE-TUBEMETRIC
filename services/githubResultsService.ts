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
