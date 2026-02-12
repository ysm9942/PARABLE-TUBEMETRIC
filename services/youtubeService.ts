
import axios from 'axios';
import { parseYtDurationSeconds, isYouTubeShort } from '../utils/shortsDetector';
import { VideoDetail, VideoResult, CommentInfo, AdVideoDetail, AdDetectionResult, DetectionSignal, DataSourceType } from '../types';

const API_KEY = process.env.API_KEY;
const BASE_URL = 'https://www.googleapis.com/youtube/v3';

export type AnalysisPeriod = '7d' | '30d' | '90d' | 'all';

interface AnalysisPayload {
  playerResponse: any | null;
  initialData: any | null;
  source: DataSourceType;
  rawHtml?: string;
  metadata: {
    locale: string;
    client: string;
    failReason?: string;
  };
}

/**
 * [A. Collector Layer] 
 * 유튜브 영상 페이지의 HTML에서 런타임 실행 데이터를 추출합니다.
 */
const fetchDetailedAnalysisData = async (videoId: string): Promise<AnalysisPayload> => {
  const payload: AnalysisPayload = {
    playerResponse: null,
    initialData: null,
    source: 'html_regex',
    metadata: { locale: 'ko-KR', client: 'WEB' }
  };

  try {
    // 실제 운영 시 CORS 이슈가 있을 수 있으나, 현재 환경의 axios 설정을 따름
    const response = await axios.get(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: 10000
    });

    const html = response.data;
    payload.rawHtml = html;

    // 1. Runtime Data Layer (ytInitialPlayerResponse) - 유료 광고 플래그의 핵심 출처
    const playerRegex = /(?:var\s+|window\[['"]|window\.)ytInitialPlayerResponse\s*=\s*({.+?});/s;
    const playerMatch = html.match(playerRegex);
    if (playerMatch?.[1]) {
      try {
        payload.playerResponse = JSON.parse(playerMatch[1].trim());
        payload.source = 'runtime_eval'; 
      } catch (e) { payload.metadata.failReason = "JSON_PARSE_ERROR"; }
    }

    // 2. Auxiliary Data (ytInitialData) - 추가 UI 렌더링 정보
    const dataRegex = /(?:var\s+|window\[['"]|window\.)ytInitialData\s*=\s*({.+?});/s;
    const dataMatch = html.match(dataRegex);
    if (dataMatch?.[1]) {
      try { payload.initialData = JSON.parse(dataMatch[1].trim()); } catch (e) {}
    }

    return payload;
  } catch (error) {
    payload.metadata.failReason = "NETWORK_FAIL";
    return payload;
  }
};

/**
 * [B. Signal Extraction Layer]
 * 수집된 데이터 뭉치에서 '유료 광고'와 관련된 결정적 신호를 뽑아냅/니다.
 */
export const extractSignals = (payload: AnalysisPayload): DetectionSignal[] => {
  const signals: DetectionSignal[] = [];
  // 유튜브 시스템이 사용하는 내부 문구들
  const targetPhrases = [
    "유료 광고 포함", "유료광고 포함", "유료 프로모션", 
    "Includes paid promotion", "Paid promotion",
    "제작 지원", "제작지원", "협찬사"
  ];

  const scan = (obj: any, source: DataSourceType, path: string = 'root') => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => scan(item, source, `${path}[${i}]`));
      return;
    }

    for (const key in obj) {
      const val = obj[key];
      const normKey = key.toLowerCase().replace(/[_-]/g, '');

      // [Direct Signals] 유튜브 시스템이 명시적으로 "이거 광고임"이라고 마킹한 경우
      const directKeys = ['ispaidpromotion', 'paidcontentoverlayrenderer', 'disclosurerenderer', 'paidpromotionbadge'];
      if (directKeys.includes(normKey)) {
        if (val === true || (typeof val === 'object' && val !== null)) {
          signals.push({
            type: 'Direct',
            source,
            path,
            key,
            note: "유튜브 시스템 공식 유료광고 플래그 확인",
            confidence: 0.99
          });
        }
      }

      // [Strong Signals] 시스템 응답 데이터 내부에 고지 문구가 포함된 경우
      if (typeof val === 'string' && (source === 'runtime_eval' || source === 'youtubei_player')) {
        if (targetPhrases.some(p => val.includes(p))) {
          signals.push({
            type: 'Strong',
            source,
            path,
            key,
            note: `시스템 내부 고지 문구 발견: "${val.substring(0, 15)}..."`,
            confidence: 0.92
          });
        }
      }

      // 재귀 탐색 (너무 깊지 않게)
      if (val && typeof val === 'object' && path.split('.').length < 10) {
        scan(val, source, `${path}.${key}`);
      }
    }
  };

  if (payload.playerResponse) scan(payload.playerResponse, payload.source);
  if (payload.initialData) scan(payload.initialData, 'youtubei_player');

  // [UI Layer Fallback] HTML 소스 내에 특정 CSS 클래스가 존재하는지 확인
  if (payload.rawHtml?.includes('ytp-paid-content-overlay-text')) {
    signals.push({
      type: 'Direct',
      source: 'ui_rendered',
      path: 'DOM',
      key: 'class',
      note: "플레이어 상단 '유료 광고 포함' 오버레이 렌더링 감지",
      confidence: 0.95
    });
  }

  return signals;
};

/**
 * [C. Decision Layer]
 * 추출된 신호들을 종합하여 최종 판정을 내립니다.
 */
export const combineAnalysis = (signals: DetectionSignal[], title: string, description: string): AdDetectionResult => {
  const adPhrases = ["유료 광고", "유료광고", "광고 포함", "협찬", "sponsored", "paid promotion", "제작지원", "원고료", "지원받아"];
  const negativePhrases = ["내돈내산", "광고 아님", "광고가 아닙니다", "직접 구매"];
  
  const combinedText = `${title}\n${description}`.toLowerCase();
  const nlpMatched = adPhrases.filter(p => combinedText.includes(p.toLowerCase()));
  const hasNegative = negativePhrases.some(p => combinedText.includes(p.toLowerCase()));

  const directSignal = signals.find(s => s.type === 'Direct');
  const strongSignal = signals.find(s => s.type === 'Strong');

  let is_ad = false;
  let confidence = 0.5;
  let method: AdDetectionResult['method'] = 'none';
  const evidence: string[] = [];

  if (directSignal) {
    is_ad = true;
    confidence = directSignal.confidence;
    method = nlpMatched.length > 0 ? 'both' : 'paid_flag';
    evidence.push(directSignal.note);
  } else if (strongSignal) {
    is_ad = true;
    confidence = strongSignal.confidence;
    method = 'paid_flag';
    evidence.push(strongSignal.note);
  } else if (nlpMatched.length > 0) {
    is_ad = true;
    confidence = 0.8;
    method = 'nlp';
    evidence.push(`텍스트 분석: 광고 키워드 "${nlpMatched[0]}" 발견`);
  }

  // 예외 처리: 내돈내산 문구가 명확하고 시스템 플래그가 없는 경우
  if (hasNegative && !directSignal) {
    is_ad = false;
    confidence = 0.95;
    evidence.push("내돈내산 확인 (시스템 광고 플래그 없음)");
  }

  return {
    is_ad,
    confidence,
    method,
    evidence: evidence.slice(0, 2),
    score: (directSignal ? 10 : 0) + (nlpMatched.length * 2),
    signals,
    analysisSource: directSignal?.source || strongSignal?.source || 'nlp_text'
  };
};

// --- YouTube Data API v3 기본 함수들 ---

const fetchTopComments = async (videoId: string): Promise<CommentInfo[]> => {
  if (!API_KEY || !videoId) return [];
  try {
    const response = await axios.get(`${BASE_URL}/commentThreads`, {
      params: { part: 'snippet', videoId, maxResults: 5, order: 'relevance', key: API_KEY },
    });
    return response.data.items.map((item: any) => ({
      author: item.snippet.topLevelComment.snippet.authorDisplayName,
      text: item.snippet.topLevelComment.snippet.textDisplay,
      likeCount: item.snippet.topLevelComment.snippet.likeCount,
      publishedAt: item.snippet.topLevelComment.snippet.publishedAt,
    }));
  } catch (e) { return []; }
};

export const getChannelInfo = async (input: string) => {
  if (!API_KEY) throw new Error('API Key Missing');
  let cleanInput = input.trim();
  let params: any = { part: 'snippet,contentDetails,statistics', key: API_KEY };
  
  const idMatch = cleanInput.match(/UC[a-zA-Z0-9_-]{22}/);
  const handleMatch = cleanInput.match(/@([^/?\s]+)/);
  
  if (idMatch) params.id = idMatch[0];
  else if (handleMatch) params.forHandle = `@${handleMatch[1]}`;
  else {
    const search = await axios.get(`${BASE_URL}/search`, { params: { part: 'snippet', q: cleanInput, type: 'channel', maxResults: 1, key: API_KEY } });
    if (!search.data.items?.length) throw new Error(`Channel not found`);
    params.id = search.data.items[0].id.channelId;
  }
  
  const response = await axios.get(`${BASE_URL}/channels`, { params });
  const channel = response.data.items[0];
  return {
    id: channel.id,
    title: channel.snippet.title,
    thumbnail: channel.snippet.thumbnails.high?.url || channel.snippet.thumbnails.default.url,
    subscriberCount: channel.statistics.subscriberCount,
    uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
  };
};

export const fetchVideosByIds = async (videoIds: string[]): Promise<VideoResult[]> => {
  const response = await axios.get(`${BASE_URL}/videos`, { params: { part: 'snippet,contentDetails,statistics', id: videoIds.join(','), key: API_KEY } });
  const results: VideoResult[] = [];
  for (const item of response.data.items) {
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
      isShort: parseYtDurationSeconds(item.contentDetails.duration)! <= 180,
      status: 'completed'
    });
  }
  return results;
};

export const fetchChannelStats = async (uploadsPlaylistId: string, shortsCfg: any, longsCfg: any) => {
  let shorts: VideoDetail[] = [], longs: VideoDetail[] = [], nextPageToken: string | undefined;
  
  while (shorts.length < (shortsCfg.target || 30) || longs.length < (longsCfg.target || 10)) {
    const res = await axios.get(`${BASE_URL}/playlistItems`, { params: { part: 'contentDetails', playlistId: uploadsPlaylistId, maxResults: 50, pageToken: nextPageToken, key: API_KEY } });
    const ids = res.data.items.map((i:any)=>i.contentDetails.videoId);
    const vRes = await axios.get(`${BASE_URL}/videos`, { params: { part: 'snippet,contentDetails,statistics', id: ids.join(','), key: API_KEY } });
    
    for (const v of vRes.data.items) {
      const isShort = parseYtDurationSeconds(v.contentDetails.duration)! <= 180;
      const info: VideoDetail = { 
        id: v.id, 
        title: v.snippet.title, 
        thumbnail: v.snippet.thumbnails.high?.url, 
        publishedAt: v.snippet.publishedAt, 
        viewCount: parseInt(v.statistics.viewCount || '0', 10), 
        duration: v.contentDetails.duration, 
        isShort 
      };
      
      if (isShort && shorts.length < shortsCfg.target && shortsCfg.enabled) shorts.push(info);
      else if (!isShort && longs.length < longsCfg.target && longsCfg.enabled) longs.push(info);
    }
    
    nextPageToken = res.data.nextPageToken;
    if (!nextPageToken) break;
  }

  const calcAvg = (arr: VideoDetail[]) => arr.length ? Math.round(arr.reduce((s, v) => s + v.viewCount, 0) / arr.length) : 0;
  
  return { 
    avgShortsViews: calcAvg(shorts), 
    shortsCountFound: shorts.length, 
    avgLongViews: calcAvg(longs), 
    longCountFound: longs.length, 
    avgTotalViews: calcAvg([...shorts, ...longs]), 
    totalCountFound: shorts.length + longs.length, 
    shortsList: shorts, 
    longsList: longs, 
    liveList: [] 
  };
};

export const analyzeAdVideos = async (uploadsPlaylistId: string, startDate: Date, endDate: Date): Promise<AdVideoDetail[]> => {
  let adVideos: AdVideoDetail[] = [], nextPageToken: string | undefined;
  
  while (true) {
    const res = await axios.get(`${BASE_URL}/playlistItems`, { params: { part: 'contentDetails', playlistId: uploadsPlaylistId, maxResults: 50, pageToken: nextPageToken, key: API_KEY } });
    const videoIds = res.data.items.map((i:any)=>i.contentDetails.videoId);
    const vRes = await axios.get(`${BASE_URL}/videos`, { params: { part: 'snippet,contentDetails,statistics', id: videoIds.join(','), key: API_KEY } });
    
    let shouldStop = false;
    for (const v of vRes.data.items) {
      const pub = new Date(v.snippet.publishedAt);
      if (pub < startDate) { shouldStop = true; break; }
      if (pub > endDate) continue;

      // 동적 분석 시작
      const payload = await fetchDetailedAnalysisData(v.id);
      const signals = extractSignals(payload);
      const detection = combineAnalysis(signals, v.snippet.title, v.snippet.description || "");

      if (detection.is_ad) {
        adVideos.push({
          id: v.id, 
          title: v.snippet.title, 
          thumbnail: v.snippet.thumbnails.high?.url, 
          publishedAt: v.snippet.publishedAt, 
          viewCount: parseInt(v.statistics.viewCount || '0', 10),
          likeCount: parseInt(v.statistics.likeCount || '0', 10), 
          commentCount: parseInt(v.statistics.commentCount || '0', 10),
          duration: v.contentDetails.duration, 
          isShort: parseYtDurationSeconds(v.contentDetails.duration)! <= 180,
          detection
        });
      }
    }
    
    if (shouldStop) break;
    nextPageToken = res.data.nextPageToken;
    if (!nextPageToken) break;
  }
  return adVideos;
};
