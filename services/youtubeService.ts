
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
 * [CRITICAL] 유튜브 공식 API에서 누락된 '유료 프로모션' 정보를 찾기 위해
 * 1. 영상 페이지 HTML의 특정 클래스(ytp-paid-content-overlay-text) 존재 여부 검사
 * 2. ytInitialPlayerResponse 및 ytInitialData 객체 추출 및 병합 분석을 수행합니다.
 */
const fetchDetailedPlayerResponse = async (videoId: string): Promise<any | null> => {
  try {
    const response = await axios.get(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: 7000
    });

    const html = response.data;
    
    // (1) HTML 문자열 직접 분석: 사용자가 확인한 특정 클래스 및 텍스트 패턴 탐지
    const hasHtmlAdLabel = html.includes('ytp-paid-content-overlay-text') || 
                           html.includes('유료 광고 포함') || 
                           html.includes('유료광고포함') ||
                           html.includes('"isPaidPromotion":true');

    // (2) ytInitialPlayerResponse 추출
    const playerRegex = /var ytInitialPlayerResponse\s*=\s*({.+?});/s;
    const playerMatch = html.match(playerRegex);
    
    // (3) ytInitialData 추출 (Fallback 데이터)
    const dataRegex = /var ytInitialData\s*=\s*({.+?});/s;
    const dataMatch = html.match(dataRegex);
    
    let combinedData: any = { 
      __html_ad_detected: hasHtmlAdLabel 
    };
    
    if (playerMatch && playerMatch[1]) {
      try { 
        const parsed = JSON.parse(playerMatch[1]);
        Object.assign(combinedData, parsed);
      } catch (e) {}
    }
    
    if (dataMatch && dataMatch[1]) {
      try { 
        const parsed = JSON.parse(dataMatch[1]);
        // 중복되지 않는 깊은 경로의 데이터를 보완하기 위해 병합
        if (parsed.contents) combinedData.__initial_data_contents = parsed.contents;
        if (parsed.overlay) combinedData.__initial_data_overlay = parsed.overlay;
      } catch (e) {}
    }
    
    return combinedData;
  } catch (error) {
    console.debug(`[Ad Detection] High-level fetch failed for ${videoId}.`, error);
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
 * [Layer A] Paid Promotion 메타데이터 재귀 탐색
 * HTML 직접 검출 결과와 JSON 렌더러 정보를 결합합니다.
 */
export const detectAdPaidFlag = (videoData: any): any => {
  let paidPromotionDetected = videoData?.__html_ad_detected || false;
  const directHits: any[] = [];
  const labelTextHits: any[] = [];

  // HTML 소스에서 이미 발견된 경우
  if (videoData?.__html_ad_detected) {
    directHits.push({ 
      path: 'raw_html', 
      key: 'ytp-paid-content-overlay-text', 
      value: 'detected', 
      type: 'html_source_match',
      note: 'HTML 소스코드에서 유료 광고 오버레이 요소 포착'
    });
  }

  const targetKeyTokens = ['ispaidpromotion', 'paidpromotion', 'paidproductplacement', 'productplacement', 'paidcontentoverlay'];
  const strongPhrases = [
    "유료 광고 포함", "유료광고 포함", "유료 프로모션", "광고 포함", 
    "includes paid promotion", "paid promotion", "제작 지원", "제작지원"
  ];

  const recursiveScan = (obj: any, path: string = 'root') => {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach((item, i) => recursiveScan(item, `${path}[${i}]`));
      return;
    }

    for (const key in obj) {
      const val = obj[key];
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, '');

      // 1. 시스템 플래그 탐지
      if (targetKeyTokens.some(token => normalizedKey.includes(token))) {
        if (val === true || val === 1 || val === 'true') {
          paidPromotionDetected = true;
          directHits.push({ 
            path, key, value: val, 
            type: 'system_flag',
            note: '영상 내부 시스템 설정값 확인'
          });
        }
      }

      // 2. 렌더링 텍스트 탐지
      if (typeof val === 'string') {
        const lowerVal = val.toLowerCase();
        if (strongPhrases.some(phrase => lowerVal.includes(phrase))) {
          paidPromotionDetected = true;
          labelTextHits.push({ 
            path, key, value: val.substring(0, 50), 
            type: 'label_text',
            note: '플레이어 렌더러 내 고지 문구 포착'
          });
        }
      }

      // 3. 특정 렌더러 구조 확인
      if (normalizedKey.includes('paidcontentoverlayrenderer')) {
        paidPromotionDetected = true;
        directHits.push({ path, key, type: 'renderer_hit', note: '유료 광고 고지 전용 렌더러 존재' });
      }

      if (val && typeof val === 'object') {
        recursiveScan(val, `${path}.${key}`);
      }
    }
  };

  recursiveScan(videoData);

  let confidence = 0.2;
  if (directHits.length > 0) confidence = 0.99;
  else if (labelTextHits.length > 0) confidence = 0.96;

  return {
    paid_promotion: paidPromotionDetected,
    confidence,
    directHits,
    labelTextHits,
    evidence: [...directHits, ...labelTextHits].map(h => ({
      source: "YouTubeInternal",
      path: h.path,
      key: h.key,
      value: String(h.value),
      note: h.note
    }))
  };
};

/**
 * [Layer B] NLP 텍스트 분석
 */
export const detectAdNLP = (videoId: string, title: string, description: string, tags: string[] = []): any => {
  const combinedText = `${title}\n${description}\n${tags.join(' ')}`.toLowerCase().replace(/\s+/g, ' ');
  
  let score = 0;
  const matchedPhrases: any[] = [];
  let negativeOverride = false;

  const weights = {
    high: ["유료 광고", "유료광고", "광고 포함", "paid promotion", "includes paid promotion", "sponsored by", "광고입니다", "제작지원", "유료광고포함", "본 영상은 광고를 포함"],
    mid: ["협찬", "스폰", "sponsor", "sponsorship", "제공받아", "지원받아", "파트너십", "원고료", "제작비", "공동구매"],
    low: ["affiliate", "제휴 링크", "수수료", "커미션", "gifted", "#ad", "#sponsored", "#협찬", "#광고"],
    negative: ["광고 아님", "내돈내산", "광고가 아닙니다", "not sponsored", "no paid promotion", "유료 광고 아닙니다"]
  };

  weights.high.forEach(p => { if (combinedText.includes(p.toLowerCase())) { score += 3; matchedPhrases.push({ phrase: p, weight: 'high', source: 'text' }); } });
  weights.mid.forEach(p => { if (combinedText.includes(p.toLowerCase())) { score += 2; matchedPhrases.push({ phrase: p, weight: 'mid', source: 'text' }); } });
  weights.low.forEach(p => { if (combinedText.includes(p.toLowerCase())) { score += 1; matchedPhrases.push({ phrase: p, weight: 'low', source: 'text' }); } });
  
  const negativeHits = weights.negative.filter(p => combinedText.includes(p.toLowerCase()));
  if (negativeHits.length > 0 && score < 5) {
    negativeOverride = true;
    score = -5;
  }

  let ad_disclosure: boolean | 'unknown' = 'unknown';
  if (score >= 3) ad_disclosure = true;
  else if (score >= 1) ad_disclosure = 'unknown';
  else ad_disclosure = false;

  return {
    video_id: videoId,
    ad_disclosure,
    score,
    confidence: ad_disclosure === true ? 0.85 : 0.5,
    matched_phrases: matchedPhrases,
    negativeOverride,
    reasoning: negativeOverride ? "부정문 감지" : (ad_disclosure === true ? "광고 키워드 감지" : "신호 부족")
  };
};

/**
 * 최종 결합
 */
export const combineAdResults = (paidFlag: any, nlp: any): AdDetectionResult => {
  let is_ad = false;
  let method: 'paid_flag' | 'nlp' | 'both' | 'none' = 'none';
  
  const hasDirectSignal = paidFlag.paid_promotion === true;
  const isNlpPositive = nlp.ad_disclosure === true;

  if (hasDirectSignal && isNlpPositive) {
    is_ad = true;
    method = 'both';
  } else if (hasDirectSignal) {
    is_ad = true;
    method = 'paid_flag';
  } else if (isNlpPositive) {
    is_ad = true;
    method = 'nlp';
  }

  let finalConfidence = 0.3;
  if (method === 'both') finalConfidence = 0.995;
  else if (method === 'paid_flag') finalConfidence = paidFlag.confidence;
  else if (method === 'nlp') finalConfidence = nlp.confidence;

  const evidenceSummary: string[] = [];
  if (paidFlag.directHits.length > 0) evidenceSummary.push(paidFlag.directHits[0].note);
  if (paidFlag.labelTextHits.length > 0) evidenceSummary.push("플레이어 '유료 광고' 라벨 확인");
  if (isNlpPositive) evidenceSummary.push(`설명란 광고 키워드 확인`);
  if (nlp.negativeOverride) evidenceSummary.push("내돈내산 고지 확인");

  return {
    is_ad,
    confidence: finalConfidence,
    method,
    evidence: evidenceSummary.slice(0, 3),
    score: (hasDirectSignal ? 5 : 0) + (isNlpPositive ? Math.max(0, nlp.score) : 0),
    paid_flag: paidFlag,
    nlp: nlp
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

      // [핵심 보완] 공식 API를 넘어 실제 영상 watch 페이지의 HTML 소스를 직접 파싱하여 상세 분석을 수행합니다.
      const detailedData = await fetchDetailedPlayerResponse(video.id);
      
      // Layer A: 플래그 탐지 (HTML 소스 분석 결과 포함)
      const paidFlag = detectAdPaidFlag(detailedData || video); 
      // Layer B: NLP 분석 (설명란, 태그)
      const nlp = detectAdNLP(video.id, video.snippet.title, video.snippet.description || "", video.snippet.tags || []);
      // Combine
      const combined = combineAdResults(paidFlag, nlp);

      if (combined.is_ad) {
        adVideos.push({
          id: video.id, title: video.snippet.title, thumbnail: video.snippet.thumbnails.high?.url || video.snippet.thumbnails.default?.url,
          publishedAt: video.snippet.publishedAt, viewCount: parseInt(video.statistics.viewCount || '0', 10),
          likeCount: parseInt(video.statistics.likeCount || '0', 10), commentCount: parseInt(video.statistics.commentCount || '0', 10),
          duration: video.contentDetails.duration, isShort: await isYouTubeShort(video.id, parseYtDurationSeconds(video.contentDetails.duration)),
          detection: combined
        });
      }
    }
    if (!nextPageToken) break;
  }
  return adVideos;
};
