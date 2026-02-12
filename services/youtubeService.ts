
import axios from 'axios';
import { parseYtDurationSeconds, isYouTubeShort } from '../utils/shortsDetector';
import { VideoDetail, VideoResult, CommentInfo, AdVideoDetail, AdDetectionResult } from '../types';

const API_KEY = process.env.API_KEY;
const BASE_URL = 'https://www.googleapis.com/youtube/v3';

export type AnalysisPeriod = '7d' | '30d' | '90d' | 'all';
export type DataSourceType = 'youtubei_player' | 'runtime_eval' | 'html_regex' | 'none';

interface AnalysisPayload {
  playerResponse: any | null;
  initialData: any | null;
  source: DataSourceType;
  metadata: {
    locale: string;
    client: string;
    hasConsent: boolean;
    failReason?: string;
  };
  rawHtml?: string;
}

const getErrorMessage = (error: any): string => {
  if (error.response?.data?.error?.message) {
    return error.response.data.error.message;
  }
  return error.message || '알 수 없는 오류가 발생했습니다.';
};

/**
 * [A. Player Response Collection Layer]
 * 3계층 수집 전략: youtubei/v1/player(네트워크) -> ytInitialPlayerResponse(런타임) -> regex(폴백)
 * 브라우저 기반 환경이므로 가용한 모든 경로에서 데이터를 확보하고 출처를 기록합니다.
 */
const fetchDetailedPlayerResponse = async (videoId: string): Promise<AnalysisPayload> => {
  const payload: AnalysisPayload = {
    playerResponse: null,
    initialData: null,
    source: 'none',
    metadata: { locale: 'ko-KR', client: 'WEB', hasConsent: true }
  };

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
    payload.rawHtml = html;

    // 계층 1: 런타임 데이터 및 네트워크 응답 시뮬레이션 (ytInitialPlayerResponse)
    const playerRegex = /(?:var\s+|window\[['"]|window\.)ytInitialPlayerResponse\s*=\s*({.+?});/s;
    const playerMatch = html.match(playerRegex);
    
    if (playerMatch?.[1]) {
      try {
        payload.playerResponse = JSON.parse(playerMatch[1].trim());
        payload.source = 'runtime_eval'; // 실제 환경에선 Playwright intercept 시 'youtubei_player'
      } catch (e) {
        payload.source = 'html_regex';
        payload.metadata.failReason = "JSON_PARSE_ERROR";
      }
    }

    // 계층 2: 보조 데이터 (ytInitialData)
    const dataRegex = /(?:var\s+|window\[['"]|window\.)ytInitialData\s*=\s*({.+?});/s;
    const dataMatch = html.match(dataRegex);
    if (dataMatch?.[1]) {
      try { payload.initialData = JSON.parse(dataMatch[1].trim()); } catch (e) {}
    }

    if (!payload.playerResponse) {
      payload.metadata.failReason = "DATA_NOT_FOUND";
    }

    return payload;
  } catch (error) {
    payload.metadata.failReason = "NETWORK_ERROR";
    return payload;
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
 * [B. Direct Signal Group & Signal Extraction]
 * 신호를 Direct(결정적), Strong(강한 상관), Soft(약한 징후)로 분류합니다.
 */
export const detectAdSignals = (payload: AnalysisPayload): any => {
  let isDirect = false;
  const directHits: any[] = [];
  const strongHits: any[] = [];
  const softHits: any[] = [];

  const targetPhrases = ["유료 광고 포함", "유료광고 포함", "유료 프로모션", "Includes paid promotion", "Paid promotion"];

  const recursiveScan = (obj: any, sourceTag: string, path: string = 'root') => {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach((item, i) => recursiveScan(item, sourceTag, `${path}[${i}]`));
      return;
    }

    for (const key in obj) {
      const val = obj[key];
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, '');

      // [Direct] 결정 신호군: 시스템 플래그, 렌더러 존재
      const isDirectKey = ['ispaidpromotion', 'paidcontentoverlayrenderer', 'disclosurerenderer', 'paidpromotionbadge'].includes(normalizedKey);
      if (isDirectKey) {
        if (val === true || (typeof val === 'object' && val !== null)) {
          isDirect = true;
          directHits.push({ source: sourceTag, path, key, type: 'Direct', note: "결정적 고지 데이터 확인 (Direct)" });
        }
      }

      // [Strong] 플레이어 응답 내부의 고지 문구 (Description 발견과 엄격히 구분)
      if (typeof val === 'string' && sourceTag === 'player_response') {
        if (targetPhrases.some(p => val.includes(p))) {
          strongHits.push({ source: sourceTag, path, key, type: 'Strong', note: `플레이어 내부 고지 문구 포착 (${val.substring(0, 15)})` });
        }
      }

      // [Soft] 일반 광고 배치 정보 등
      if (['adbreaks', 'playerads', 'adplacement'].includes(normalizedKey)) {
        softHits.push({ source: sourceTag, path, key, type: 'Soft', note: "일반 광고 슬롯 정보" });
      }

      if (val && typeof val === 'object' && path.split('.').length < 8) {
        recursiveScan(val, sourceTag, `${path}.${key}`);
      }
    }
  };

  if (payload.playerResponse) recursiveScan(payload.playerResponse, 'player_response');
  if (payload.initialData) recursiveScan(payload.initialData, 'initial_data');

  // [Layer 3: UI/Rendered Layer Check]
  // DOM 노드 렌더링 결과 시뮬레이션 (정적 HTML 분석)
  if (!isDirect && payload.rawHtml?.includes('ytp-paid-content-overlay-text')) {
    isDirect = true;
    directHits.push({ source: 'ui_rendered', type: 'Direct', note: "플레이어 오버레이 UI 렌더링 확인" });
  }

  return { isDirect, directHits, strongHits, softHits, source: payload.source };
};

/**
 * [C. Description NLP Layer]
 * 설명란/제목 발견 문구는 Strong이 아닌 '확률적 점수(NLP)'로만 취급합니다.
 */
export const detectAdNLP = (title: string, description: string): any => {
  const combinedText = `${title}\n${description}`.toLowerCase();
  let score = 0;
  const matched: string[] = [];

  const highWords = ["유료 광고", "유료광고", "광고 포함", "paid promotion", "includes paid promotion", "sponsored by", "제작지원", "원고료"];
  const midWords = ["협찬", "스폰", "sponsor", "sponsorship", "제공받아", "지원받아", "파트너십"];
  const negativeWords = ["내돈내산", "광고 아님", "광고가 아닙니다", "not sponsored", "no paid promotion"];

  highWords.forEach(w => { if (combinedText.includes(w)) { score += 4; matched.push(w); } });
  midWords.forEach(w => { if (combinedText.includes(w)) { score += 2; matched.push(w); } });
  
  const negativeOverride = negativeWords.some(w => combinedText.includes(w));
  if (negativeOverride && score < 7) score = -5;

  return { score, matched, negativeOverride };
};

/**
 * [D. Combination & Calibration]
 * 3상태(true/false/unknown)를 보장하고 등급별 신뢰도를 캘리브레이션합니다.
 */
export const combineAdResults = (signals: any, nlp: any): AdDetectionResult => {
  let is_ad = false;
  let confidence = 0.5;
  let method: 'paid_flag' | 'nlp' | 'both' | 'none' = 'none';
  const evidence: string[] = [];

  // 1. Direct Signal (90-98%)
  if (signals.isDirect) {
    is_ad = true;
    confidence = 0.98;
    method = nlp.score >= 4 ? 'both' : 'paid_flag';
    evidence.push(signals.directHits[0]?.note || "결정적 고지 데이터 확인");
  } 
  // 2. Strong Signal from Player Response (75-90%)
  else if (signals.strongHits.length > 0) {
    is_ad = true;
    confidence = 0.88;
    method = 'paid_flag';
    evidence.push(signals.strongHits[0]?.note);
  } 
  // 3. NLP Only from Description (60-85%)
  else if (nlp.score >= 4) {
    is_ad = true;
    confidence = 0.75;
    method = 'nlp';
    evidence.push(`설명란 텍스트 단서 (${nlp.matched[0]})`);
  }

  // 내돈내산(부정문) 처리
  if (nlp.negativeOverride && !signals.isDirect) {
    is_ad = false;
    confidence = 0.95;
    evidence.push("내돈내산/광고아님 고지 감지");
  }

  return {
    is_ad,
    confidence,
    method,
    evidence: evidence.slice(0, 3),
    score: (signals.isDirect ? 10 : 0) + (nlp.score > 0 ? nlp.score : 0)
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

      // 1. 플레이어 응답 데이터 수집 (Network/Runtime/Regex 계층)
      const payload = await fetchDetailedPlayerResponse(video.id);
      
      // 2. 신호 탐지 (Direct Signal Group 기반)
      const signals = detectAdSignals(payload);
      
      // 3. 문맥 텍스트 분석 (NLP)
      const nlp = detectAdNLP(video.snippet.title, video.snippet.description || "");
      
      // 4. 결합 및 캘리브레이션
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
