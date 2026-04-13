/**
 * Backend API 클라이언트 — FastAPI 백엔드와 통신
 *
 * EXE의 undetected_chromedriver 기반 스크래핑을 대체하는 백엔드 API를 호출한다.
 * 백엔드는 yt-dlp + instagrapi를 사용하므로 브라우저가 필요 없다.
 *
 * 사용법:
 *   1. Vercel 환경변수에 BACKEND_URL 설정 (예: https://tubemetric-api.onrender.com)
 *   2. 백엔드가 없으면 기존 YouTube Data API 직접 호출로 폴백
 */
import axios from 'axios';
import type { ChannelResult, VideoResult, AdAnalysisResult, InstagramUserResult } from '../types';

const BACKEND_URL = (process.env.BACKEND_URL || '').replace(/\/$/, '');

// ── 공통 폴링 설정 ──────────────────────────────────────────────────────────
/** 폴링 중 단일 HTTP 호출 타임아웃 (네트워크 행 방지) */
const POLL_HTTP_TIMEOUT_MS = 15_000;
/** 폴링 전체 최대 대기 시간 (좀비 잡 방지) */
const POLL_MAX_DURATION_MS = 30 * 60 * 1000;  // 30분
/** 폴링 주기 */
const POLL_INTERVAL_MS = 3_000;

/**
 * 취소/타임아웃을 지원하는 지연 함수.
 * isCancelled()가 true를 반환하면 즉시 reject.
 */
async function cancellableSleep(ms: number, isCancelled?: () => boolean): Promise<void> {
  const step = 200;
  let waited = 0;
  while (waited < ms) {
    if (isCancelled?.()) throw new Error('cancelled');
    const chunk = Math.min(step, ms - waited);
    await new Promise(r => setTimeout(r, chunk));
    waited += chunk;
  }
}

/**
 * 백엔드 사용 가능 여부 확인
 */
export const isBackendAvailable = (): boolean => !!BACKEND_URL;

/**
 * 백엔드 헬스체크
 */
export const checkHealth = async (): Promise<boolean> => {
  if (!BACKEND_URL) return false;
  try {
    const res = await axios.get(`${BACKEND_URL}/api/health`, { timeout: 5000 });
    return res.data?.status === 'ok';
  } catch {
    return false;
  }
};

// ── YouTube 채널 분석 (yt-dlp 기반) ────────────────────────────────────────

interface ChannelScrapeOptions {
  shortsTarget?: number;
  longsTarget?: number;
  useDateFilter?: boolean;
  period?: string;
}

export const scrapeChannel = async (
  handle: string,
  options: ChannelScrapeOptions = {}
): Promise<ChannelResult> => {
  if (!BACKEND_URL) throw new Error('백엔드 URL이 설정되지 않았습니다.');
  const res = await axios.post(`${BACKEND_URL}/api/youtube/channel`, {
    handle,
    shorts_target: options.shortsTarget ?? 30,
    longs_target: options.longsTarget ?? 10,
    use_date_filter: options.useDateFilter ?? false,
    period: options.period ?? 'all',
  });
  return res.data;
};

// ── YouTube 영상 분석 (yt-dlp 기반) ────────────────────────────────────────

export const scrapeVideos = async (videoIds: string[]): Promise<VideoResult[]> => {
  if (!BACKEND_URL) throw new Error('백엔드 URL이 설정되지 않았습니다.');
  const res = await axios.post(`${BACKEND_URL}/api/youtube/videos`, {
    video_ids: videoIds,
  });
  return res.data;
};

// ── 광고 감지 (yt-dlp 메타데이터 + NLP) ──────────────────────────────────

export const detectAds = async (
  handle: string,
  startDate: string,
  endDate: string
): Promise<any> => {
  if (!BACKEND_URL) throw new Error('백엔드 URL이 설정되지 않았습니다.');
  const res = await axios.post(`${BACKEND_URL}/api/youtube/ad-detect`, {
    handle,
    start_date: startDate,
    end_date: endDate,
  });
  return res.data;
};

export const detectAdSingle = async (videoId: string): Promise<any> => {
  if (!BACKEND_URL) throw new Error('백엔드 URL이 설정되지 않았습니다.');
  const res = await axios.get(`${BACKEND_URL}/api/youtube/ad-detect/${videoId}`);
  return res.data;
};

// ── Instagram 릴스 (IG_SESSION_ID 필요 / 미설정 시 503 → 로컬 큐 폴백) ────

export const fetchInstagramReels = async (
  usernames: string[],
  amount: number = 10
): Promise<InstagramUserResult[]> => {
  if (!BACKEND_URL) throw new Error('백엔드 URL이 설정되지 않았습니다.');
  const res = await axios.post(`${BACKEND_URL}/api/instagram/reels`, {
    usernames,
    amount,
  });
  return res.data;
};

// ── Instagram 릴스 — 로컬 에이전트(port 8003) 직접 호출 ───────────────────
// softc_server.py와 동일한 패턴: start → 폴링 → 결과 반환

export const fetchInstagramReelsLocal = async (
  usernames: string[],
  amount: number = 10,
  localBaseUrl: string = 'http://localhost:8003',
  headless: boolean = true,
  isCancelled?: () => boolean,
): Promise<InstagramUserResult[]> => {
  const base = localBaseUrl.replace(/\/$/, '');

  await axios.post(`${base}/api/crawl/start`, { usernames, amount, headless }, { timeout: POLL_HTTP_TIMEOUT_MS });

  const startedAt = Date.now();
  while (true) {
    // 취소 요청 체크 → 서버에도 stop 전파 후 예외
    if (isCancelled?.()) {
      try { await axios.post(`${base}/api/crawl/stop`, {}, { timeout: 5000 }); } catch { /* noop */ }
      throw new Error('cancelled');
    }
    // 전체 타임아웃
    if (Date.now() - startedAt > POLL_MAX_DURATION_MS) {
      throw new Error('polling timeout (30분 초과)');
    }

    await cancellableSleep(POLL_INTERVAL_MS, isCancelled);

    try {
      const res = await axios.get(`${base}/api/crawl/status`, { timeout: POLL_HTTP_TIMEOUT_MS });
      const data = res.data;
      if (data.status === 'done' || data.status === 'error') {
        if (data.status === 'error') throw new Error(data.error || '스크래핑 오류');
        return data.results as InstagramUserResult[];
      }
    } catch (e: any) {
      if (e?.message === 'cancelled') throw e;
      // 네트워크 일시 오류는 다음 폴링에서 재시도
      console.warn('[Instagram] status 조회 실패(재시도):', e?.message ?? e);
    }
  }
};

// ── TikTok 영상 (yt-dlp 기반) ───────────────────────────────────────────

export interface TikTokUserResult {
  username: string;
  videoCount: number;
  videos: Array<{
    id: string;
    title: string;
    url: string;
    viewCount: number;
    likeCount: number;
    commentCount: number;
    duration: number;
    uploadDate: string;
    thumbnail: string;
  }>;
  avgViews: number;
  status: string;
  error?: string;
  scrapedAt: string;
}

export const fetchTikTokVideos = async (
  usernames: string[],
  limit: number = 30
): Promise<TikTokUserResult[]> => {
  if (!BACKEND_URL) throw new Error('백엔드 URL이 설정되지 않았습니다.');
  const res = await axios.post(`${BACKEND_URL}/api/tiktok/videos`, {
    usernames,
    limit,
  });
  return res.data;
};

export const fetchTikTokVideosLocal = async (
  usernames: string[],
  amount: number = 20,
  localBaseUrl: string = 'http://localhost:8003',
  headless: boolean = true,
  isCancelled?: () => boolean,
): Promise<TikTokUserResult[]> => {
  const base = localBaseUrl.replace(/\/$/, '');

  await axios.post(`${base}/api/tiktok/start`, { usernames, amount, headless }, { timeout: POLL_HTTP_TIMEOUT_MS });

  const startedAt = Date.now();
  while (true) {
    if (isCancelled?.()) {
      try { await axios.post(`${base}/api/tiktok/stop`, {}, { timeout: 5000 }); } catch { /* noop */ }
      throw new Error('cancelled');
    }
    if (Date.now() - startedAt > POLL_MAX_DURATION_MS) {
      throw new Error('polling timeout (30분 초과)');
    }

    await cancellableSleep(POLL_INTERVAL_MS, isCancelled);

    try {
      const res = await axios.get(`${base}/api/tiktok/status`, { timeout: POLL_HTTP_TIMEOUT_MS });
      const data = res.data;
      if (data.status === 'done' || data.status === 'error') {
        if (data.status === 'error') throw new Error(data.error || '스크래핑 오류');
        return data.results as TikTokUserResult[];
      }
    } catch (e: any) {
      if (e?.message === 'cancelled') throw e;
      console.warn('[TikTok] status 조회 실패(재시도):', e?.message ?? e);
    }
  }
};

// ── 라이브 지표 (CHZZK/SOOP · softc.one 기반) ──────────────────────────

export interface LiveStreamRecord {
  creator: string;
  platform: string;
  title: string;
  category: string;
  peakViewers: number;
  avgViewers: number;
  date: string;
  durationMin: number;
}

export interface LiveCreatorResult {
  creatorId: string;
  platform: string;
  streamCount: number;
  streams: LiveStreamRecord[];
  avgViewers: number;
  peakViewers: number;
  totalDurationMin: number;
  status: string;
  error?: string;
  scrapedAt: string;
}

export const fetchLiveStreams = async (
  creators: Array<{ platform: string; creatorId: string }>,
  startDate: string,
  endDate: string,
  categories: string[] = [],
  overrideBaseUrl?: string   // 로컬 에이전트 사용 시 주입
): Promise<LiveCreatorResult[]> => {
  const base = (overrideBaseUrl || BACKEND_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('백엔드 URL이 설정되지 않았습니다.');
  const res = await axios.post(`${base}/api/live/streams`, {
    creators,
    startDate,
    endDate,
    categories,
  }, { timeout: 300000 });  // Playwright 렌더링 대기 (최대 5분)
  return res.data;
};

// ── softc 스크래퍼 ────────────────────────────────────────────────────────
// localBaseUrl 지정 시: 로컬 에이전트 (port 8002) → /api/crawl/*
// 미지정 시:           클라우드 Render → /api/softc/crawl/*

export const fetchSoftcStreams = async (
  creators: Array<{ platform: string; creatorId: string }>,
  startDate: string,
  endDate: string,
  categories: string[] = [],
  localBaseUrl?: string,   // SOFTC_AGENT_URL (http://localhost:8002) 또는 undefined
  isCancelled?: () => boolean,
): Promise<LiveCreatorResult[]> => {
  const isLocal = !!localBaseUrl;
  const base    = (localBaseUrl || BACKEND_URL).replace(/\/$/, '');
  if (!base) throw new Error('백엔드 URL이 설정되지 않았습니다.');

  const startPath  = isLocal ? '/api/crawl/start'  : '/api/softc/crawl/start';
  const statusPath = isLocal ? '/api/crawl/status' : '/api/softc/crawl/status';
  const stopPath   = isLocal ? '/api/crawl/stop'   : '/api/softc/crawl/stop';

  // 잡 시작
  await axios.post(`${base}${startPath}`, {
    creators: creators.map(c => `${c.platform}:${c.creatorId}`),
    start_date: startDate,
    end_date: endDate,
    categories,
  }, { timeout: POLL_HTTP_TIMEOUT_MS });

  // 완료될 때까지 폴링
  const startedAt = Date.now();
  while (true) {
    if (isCancelled?.()) {
      try { await axios.post(`${base}${stopPath}`, {}, { timeout: 5000 }); } catch { /* noop */ }
      throw new Error('cancelled');
    }
    if (Date.now() - startedAt > POLL_MAX_DURATION_MS) {
      throw new Error('polling timeout (30분 초과)');
    }

    await cancellableSleep(POLL_INTERVAL_MS, isCancelled);

    let data: any;
    try {
      const res = await axios.get(`${base}${statusPath}`, { timeout: POLL_HTTP_TIMEOUT_MS });
      data = res.data;
    } catch (e: any) {
      if (e?.message === 'cancelled') throw e;
      console.warn('[SoftC] status 조회 실패(재시도):', e?.message ?? e);
      continue;
    }

    if (data.status === 'done' || data.status === 'error') {
      if (data.status === 'error') throw new Error(data.error || '스크래핑 오류');

      // 크리에이터별로 집계
      const byCreator: Record<string, any[]> = {};
      for (const row of data.results as any[]) {
        const key = `${row.platform}:${row.creator}`;
        (byCreator[key] ??= []).push(row);
      }

      return Object.entries(byCreator).map(([key, rows]) => {
        const [platform, creatorId] = key.split(':', 2);
        const streams: LiveStreamRecord[] = rows.map(r => ({
          creator:     r.creator,
          platform:    r.platform,
          title:       r.title,
          category:    r.category,
          peakViewers: r.peak_viewers,
          avgViewers:  r.avg_viewers,
          date:        r.date,
          durationMin: r.duration_min,
        }));
        const avgViewers     = streams.length ? Math.round(streams.reduce((s, r) => s + r.avgViewers, 0) / streams.length) : 0;
        const peakViewers    = streams.length ? Math.max(...streams.map(r => r.peakViewers)) : 0;
        const totalDurationMin = streams.reduce((s, r) => s + r.durationMin, 0);
        return {
          creatorId,
          platform,
          streamCount: streams.length,
          streams,
          avgViewers,
          peakViewers,
          totalDurationMin,
          status:    'ok',
          scrapedAt: new Date().toISOString(),
        } satisfies LiveCreatorResult;
      });
    }
  }
};
