
import axios from 'axios';
import { parseYtDurationSeconds, isYouTubeShort } from '../utils/shortsDetector';
import { VideoDetail, VideoResult, CommentInfo, AdVideoDetail, AdDetectionResult } from '../types';

const API_KEY = process.env.API_KEY;
const BASE_URL = 'https://www.googleapis.com/youtube/v3';

export type AnalysisPeriod = '7d' | '30d' | '90d' | 'all';

const getErrorMessage = (error: any): string => {
  if (error.response?.data?.error?.message) {
    return error.response.data.error.message;
  }
  return error.message || '알 수 없는 오류가 발생했습니다.';
};

/**
 * [Layer 1 & 2: Network & Data Level]
 * 브라우저 자동화(Playwright)의 네트워크 가로채기 원리를 시뮬레이션하여 
 * HTML 소스 내에 직렬화된 'player' 및 'next' 응답 JSON을 강제 추출합니다.
 */
const fetchDetailedPlayerResponse = async (videoId: string): Promise<any | null> => {
  try {
    const response = await axios.get(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache'
      },
      timeout: 10000
    });

    const html = response.data;
    const results: any = { __raw_html: html };

    // 패턴 1: ytInitialPlayerResponse (가장 결정적 데이터 - player 응답 캡처 대용)
    const playerRegex = /(?:var\s+|window\[['"]|window\.)ytInitialPlayerResponse\s*=\s*({.+?});/s;
    const playerMatch = html.match(playerRegex);
    if (playerMatch?.[1]) {
      try { results.playerResponse = JSON.parse(playerMatch[1].trim()); } catch (e) {}
    }

    // 패턴 2: ytInitialData (UI 렌더링 트리 및 메타데이터 - next 응답 캡처 대용)
    const dataRegex = /(?:var\s+|window\[['"]|window\.)ytInitialData\s*=\s*({.+?});/s;
    const dataMatch = html.match(dataRegex);
    if (dataMatch?.[1]) {
      try { results.initialData = JSON.parse(dataMatch[1].trim()); } catch (e) {}
    }

    return results;
  } catch (error) {
    console.debug(`[Fetch] Analysis payload extraction failed for ${videoId}`, error);
    return null;
  }
};

const fetchTopComments = async (videoId: string): Promise<CommentInfo[]> => {
  if (!API_KEY || !videoId) return [];
  try {
    const response = await axios.get(`${BASE_URL}/commentThreads`, {
      params: { part: 'snippet', videoId, maxResults: 6, order: 'relevance', key: API_KEY },
    });
    return response.data.items.map((item: any) => ({
      author: item.snippet.topLevelComment.snippet.authorDisplayName,
      text: item.snippet.topLevelComment.snippet.textDisplay,
      likeCount: item.snippet.topLevelComment.snippet.likeCount,
      publishedAt: item.snippet.topLevelComment.snippet.publishedAt,
    }));
  } catch (e) { return []; }
};

/**
 * [Advanced Detection Logic]
 * 신호를 3등급(Direct, Strong, Soft)으로 분류하여 판정합니다.
 */
export const detectAdSignals = (payload: any): any => {
  let hasDirect = false;
  const directHits: any[] = [];
  const strongHits: any[] = [];
  const softHits: any[] = [];

  const targetPhrases = ["유료 광고 포함", "유료광고 포함", "유료 프로모션", "Includes paid promotion", "Paid promotion"];

  const recursiveScan = (obj: any, source: string, path: string = 'root') => {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach((item, i) => recursiveScan(item, source, `${path}[${i}]`));
      return;
    }

    for (const key in obj) {
      const val = obj[key];
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, '');

      // [Direct] 확정 신호: 플레이어 오버레이 렌더러 또는 시스템 플래그
      if (normalizedKey === 'paidcontentoverlayrenderer' || normalizedKey === 'ispaidpromotion') {
        if (val === true || typeof val === 'object') {
          hasDirect = true;
          directHits.push({ source, path, key, type: 'Direct', note: "플레이어 '유료 광고 고지' 시스템 신호 확인" });
        }
      }

      // [Strong] 강한 상관 신호: 텍스트 노드 내의 고지 문구
      if (typeof val === 'string') {
        if (targetPhrases.some(p => val.includes(p))) {
          strongHits.push({ source, path, key, type: 'Strong', note: `데이터 내부 고지 문구 포착 (${val.substring(0, 15)}...)` });
        }
      }

      // [Soft] 약한 신호: 일반 광고 배치 정보 (참고용)
      if (normalizedKey === 'adbreaks' || normalizedKey === 'playerads') {
        softHits.push({ source, path, key, type: 'Soft', note: "일반 광고 배치 정보 감지" });
      }

      if (val && typeof val === 'object' && path.split('.').length < 10) {
        recursiveScan(val, source, `${path}.${key}`);
      }
    }
  };

  if (payload?.playerResponse) recursiveScan(payload.playerResponse, 'player_response');
  if (payload?.initialData) recursiveScan(payload.initialData, 'initial_data');

  // [Layer 3: UI/Static Level Fallback]
  if (!hasDirect && payload?.__raw_html?.includes('ytp-paid-content-overlay-text')) {
    hasDirect = true;
    directHits.push({ source: 'static_html', type: 'Direct', note: "정적 HTML 내 유료 광고 오버레이 클래스 감지" });
  }

  return { hasDirect, directHits, strongHits, softHits };
};

/**
 * [Layer B: NLP Textual Analysis]
 * 설명란 및 제목을 통한 확률론적 분석
 */
export const detectAdNLP = (title: string, description: string): any => {
  const combinedText = `${title}\n${description}`.toLowerCase();
  let score = 0;
  const matched: any[] = [];

  const weights = {
    high: ["유료 광고", "유료광고", "광고 포함", "paid promotion", "includes paid promotion", "sponsored by", "제작지원", "원고료"],
    mid: ["협찬", "스폰", "sponsor", "sponsorship", "제공받아", "지원받아", "파트너십"],
    negative: ["내돈내산", "광고 아님", "광고가 아닙니다", "not sponsored"]
  };

  weights.high.forEach(p => { if (combinedText.includes(p)) { score += 4; matched.push(p); } });
  weights.mid.forEach(p => { if (combinedText.includes(p)) { score += 2; matched.push(p); } });
  
  let negativeOverride = weights.negative.some(p => combinedText.includes(p));
  if (negativeOverride && score < 6) score = -5;

  return { score, matched, negativeOverride };
};

/**
 * [Final Combination & Calibration]
 * 수집된 모든 레이어의 신호를 결합하여 최종 신뢰도와 판정 결과를 산출합니다.
 */
export const combineAdResults = (signals: any, nlp: any): AdDetectionResult => {
  let is_ad = false;
  let confidence = 0.3;
  let method: 'paid_flag' | 'nlp' | 'both' | 'none' = 'none';
  const evidence: string[] = [];

  if (signals.hasDirect) {
    is_ad = true;
    confidence = 0.98; // Direct Calibration
    method = nlp.score >= 4 ? 'both' : 'paid_flag';
    evidence.push(signals.directHits[0]?.note || "시스템 고지 데이터 확인");
  } else if (signals.strongHits.length > 0) {
    is_ad = true;
    confidence = 0.85; // Strong Calibration
    method = 'paid_flag';
    evidence.push(signals.strongHits[0]?.note);
  } else if (nlp.score >= 4) {
    is_ad = true;
    confidence = 0.75; // NLP Calibration
    method = 'nlp';
    evidence.push(`설명란 광고 키워드 확인 (${nlp.matched[0]})`);
  }

  if (nlp.negativeOverride && !signals.hasDirect) {
    is_ad = false;
    confidence = 0.9;
    evidence.push("내돈내산(광고 아님) 고지 감지");
  }

  return {
    is_ad,
    confidence,
    method,
    evidence: evidence.slice(0, 3),
    score: (signals.hasDirect ? 10 : 0) + (nlp.score > 0 ? nlp.score : 0)
  };
};

export const getChannelInfo = async (input: string) => {
  if (!API_KEY) throw new Error('YouTube API Key가 설정되지 않았습니다.');
  let cleanInput = input.trim();
  if (cleanInput.includes('youtube.com/') || cleanInput.includes('youtu.be/')) {
    try {
      const url = new URL(cleanInput.startsWith('http') ? cleanInput : `https://${cleanInput}`);
      cleanInput = url.pathname + url.search;
    } catch (e) {}
  }
  let params: any = { part: 'snippet,contentDetails,statistics', key: API_KEY };
  const idMatch = cleanInput.match(/UC[a-zA-Z0-9_-]{22}/);
  const handleMatch = cleanInput.match(/@([^/?\s]+)/);
  if (idMatch) params.id = idMatch[0];
  else if (handleMatch) params.forHandle = `@${handleMatch[1]}`;
  else {
    try {
      const searchResponse = await axios.get(`${BASE_URL}/search`, { params: { part: 'snippet', q: input.trim(), type: 'channel', maxResults: 1, key: API_KEY } });
      if (!searchResponse.data.items?.length) throw new Error(`채널을 찾을 수 없습니다: ${input}`);
      params.id = searchResponse.data.items[0].id.channelId;
    } catch (err) { throw new Error(`검색 중 오류 발생: ${getErrorMessage(err)}`); }
  }
  try {
    const response = await axios.get(`${BASE_URL}/channels`, { params });
    if (!response.data.items?.length) throw new Error('채널 정보를 찾을 수 없습니다.');
    const channel = response.data.items[0];
    return {
      id: channel.id,
      title: channel.snippet.title,
      thumbnail: channel.snippet.thumbnails.high?.url || channel.snippet.thumbnails.default.url,
      subscriberCount: channel.statistics.subscriberCount,
      uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
    };
  } catch (err) { throw new Error(`채널 조회 실패: ${getErrorMessage(err)}`); }
};

export const fetchVideosByIds = async (videoIds: string[]): Promise<VideoResult[]> => {
  const validIds = videoIds.filter(id => id?.length === 11);
  if (!validIds.length) return [];
  try {
    const response = await axios.get(`${BASE_URL}/videos`, { params: { part: 'snippet,contentDetails,statistics', id: validIds.join(','), key: API_KEY } });
    const results: VideoResult[] = [];
    for (const item of response.data.items) {
      const durationSec = parseYtDurationSeconds(item.contentDetails.duration);
      const isShort = await isYouTubeShort(item.id, durationSec);
      results.push({
        videoId: item.id,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.default.url,
        viewCount: parseInt(item.statistics.viewCount || '0', 10),
        likeCount: parseInt(item.statistics.likeCount || '0', 10),
        commentCount: parseInt(item.statistics.commentCount || '0', 10),
        topComments: await fetchTopComments(item.id),
        duration: item.contentDetails.duration,
        isShort,
        status: 'completed'
      });
    }
    return results;
  } catch (err) { throw new Error(`영상 정보 조회 실패: ${getErrorMessage(err)}`); }
};

interface FetchStatsConfig {
  target: number;
  period: AnalysisPeriod;
  useDateFilter: boolean;
  useCountFilter: boolean;
  enabled: boolean;
}

export const fetchChannelStats = async (
  uploadsPlaylistId: string, 
  shortsCfg: FetchStatsConfig,
  longsCfg: FetchStatsConfig
) => {
  let shorts: VideoDetail[] = [], longs: VideoDetail[] = [], lives: VideoDetail[] = [], nextPageToken: string | undefined, safetyCounter = 0;
  
  const getCutoff = (cfg: FetchStatsConfig) => {
    if (!cfg.useDateFilter || cfg.period === 'all') return null;
    const days = cfg.period === '7d' ? 7 : cfg.period === '30d' ? 30 : 90;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  };

  const shortsCutoff = getCutoff(shortsCfg);
  const longsCutoff = getCutoff(longsCfg);

  while (safetyCounter < 100) {
    safetyCounter++;
    const playlistResponse = await axios.get(`${BASE_URL}/playlistItems`, { params: { part: 'contentDetails', playlistId: uploadsPlaylistId, maxResults: 50, pageToken: nextPageToken, key: API_KEY } });
    if (!playlistResponse.data.items?.length) break;
    nextPageToken = playlistResponse.data.nextPageToken;

    const videoResponse = await axios.get(`${BASE_URL}/videos`, { params: { part: 'snippet,contentDetails,statistics,liveStreamingDetails', id: playlistResponse.data.items.map((i:any)=>i.contentDetails.videoId).join(','), key: API_KEY } });
    
    for (const video of videoResponse.data.items) {
      const publishedAt = new Date(video.snippet.publishedAt);
      const isShort = await isYouTubeShort(video.id, parseYtDurationSeconds(video.contentDetails.duration));
      const info: VideoDetail = { 
        id: video.id, 
        title: video.snippet.title, 
        thumbnail: video.snippet.thumbnails.high?.url || video.snippet.thumbnails.default?.url, 
        publishedAt: video.snippet.publishedAt, 
        viewCount: parseInt(video.statistics.viewCount || '0', 10), 
        duration: video.contentDetails.duration, 
        isShort, 
        isLiveStream: !!video.liveStreamingDetails 
      };

      if (info.isLiveStream) {
        if (lives.length < 10) lives.push(info);
      } else if (isShort) {
        if (shortsCfg.enabled && (!shortsCfg.useCountFilter || shorts.length < shortsCfg.target)) {
          if (!shortsCfg.useDateFilter || (shortsCutoff && publishedAt >= shortsCutoff)) {
            shorts.push(info);
          }
        }
      } else {
        if (longsCfg.enabled && (!longsCfg.useCountFilter || longs.length < longsCfg.target)) {
          if (!longsCfg.useDateFilter || (longsCutoff && publishedAt >= longsCutoff)) {
            longs.push(info);
          }
        }
      }
    }

    if (!nextPageToken) break;
  }

  const calcAvg = (arr: VideoDetail[]) => arr.length ? Math.round(arr.reduce((s, v) => s + v.viewCount, 0) / arr.length) : 0;
  return { 
    avgShortsViews: calcAvg(shorts), 
    shortsCount: shorts.length, 
    avgLongViews: calcAvg(longs), 
    longCount: longs.length, 
    avgTotalViews: calcAvg([...shorts, ...longs]), 
    totalCount: shorts.length + longs.length, 
    shortsList: shorts, 
    longsList: longs, 
    liveList: lives 
  };
};

export const analyzeAdVideos = async (uploadsPlaylistId: string, startDate: Date, endDate: Date): Promise<AdVideoDetail[]> => {
  let adVideos: AdVideoDetail[] = [], nextPageToken: string | undefined, safetyCounter = 0;
  while (safetyCounter < 100) {
    safetyCounter++;
    const playlistResponse = await axios.get(`${BASE_URL}/playlistItems`, { params: { part: 'contentDetails', playlistId: uploadsPlaylistId, maxResults: 50, pageToken: nextPageToken, key: API_KEY } });
    if (!playlistResponse.data.items?.length) break;
    nextPageToken = playlistResponse.data.nextPageToken;
    const videoResponse = await axios.get(`${BASE_URL}/videos`, { params: { part: 'snippet,contentDetails,statistics', id: playlistResponse.data.items.map((i:any)=>i.contentDetails.videoId).join(','), key: API_KEY } });
    for (const video of videoResponse.data.items) {
      const pub = new Date(video.snippet.publishedAt);
      if (pub < startDate) { nextPageToken = undefined; break; }
      if (pub > endDate) continue;

      // 1. 영상 소스 데이터 수집 (Layer 1, 2)
      const payload = await fetchDetailedPlayerResponse(video.id);
      
      // 2. 신호 탐지 (Direct/Strong/Soft)
      const signals = detectAdSignals(payload);
      
      // 3. 텍스트 분석 (Layer 3)
      const nlp = detectAdNLP(video.snippet.title, video.snippet.description || "");
      
      // 4. 강건한 결합 및 판정
      const detection = combineAdResults(signals, nlp);

      if (detection.is_ad) {
        adVideos.push({
          id: video.id, title: video.snippet.title, thumbnail: video.snippet.thumbnails.high?.url || video.snippet.thumbnails.default?.url,
          publishedAt: video.snippet.publishedAt, viewCount: parseInt(video.statistics.viewCount || '0', 10),
          likeCount: parseInt(video.statistics.likeCount || '0', 10), commentCount: parseInt(video.statistics.commentCount || '0', 10),
          duration: video.contentDetails.duration, isShort: await isYouTubeShort(video.id, parseYtDurationSeconds(video.contentDetails.duration)),
          detection: detection
        });
      }
    }
    if (!nextPageToken) break;
  }
  return adVideos;
};
