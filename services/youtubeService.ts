
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
 * 시스템 플래그 및 라벨 텍스트 재귀 탐색 로직 (Layer A 강화)
 */
export const detectAdPaidFlag = (videoData: any): any => {
  let paidPromotion: boolean | 'unknown' = 'unknown';
  const directHits: any[] = [];
  const labelHits: any[] = [];
  const softHits: any[] = [];

  const targetKeys = ['ispaidpromotion', 'paidpromotion', 'paidproductplacement', 'productplacement', 'sponsorship'];
  const strongPhrases = ["유료 광고 포함", "유료광고 포함", "유료 프로모션", "광고 포함", "includes paid promotion", "paid promotion"];
  const softKeys = ['adplacements', 'playerads', 'adbreak'];

  const recursiveScan = (obj: any, path: string = 'root') => {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach((item, i) => recursiveScan(item, `${path}[${i}]`));
      return;
    }

    for (const key in obj) {
      const val = obj[key];
      const lowerKey = key.toLowerCase().replace(/[_-]/g, '');

      // 1. Direct Signal: Boolean flags
      if (targetKeys.includes(lowerKey)) {
        if (val === true || val === 1 || val === 'true') {
          paidPromotion = true;
          directHits.push({ path, key, value: val, type: 'paid_flag_direct' });
        }
      }

      // 2. Strong Text Signal: Renderer label text
      if (typeof val === 'string') {
        const lowerVal = val.toLowerCase();
        if (strongPhrases.some(phrase => lowerVal.includes(phrase))) {
          paidPromotion = true;
          labelHits.push({ path, key, value: val, type: 'player_response_label_text' });
        }
      }

      // 3. Soft Signal: Ad-related structures
      if (softKeys.includes(lowerKey)) {
        softHits.push({ path, key, type: 'paid_flag_soft' });
      }

      // Deep scan
      if (typeof val === 'object') {
        recursiveScan(val, `${path}.${key}`);
      }
    }
  };

  recursiveScan(videoData);

  let confidence = 0.2;
  if (directHits.length > 0) confidence = 0.95;
  else if (labelHits.length > 0) confidence = 0.92;
  else if (softHits.length > 0) confidence = 0.4;

  return {
    paid_promotion: paidPromotion,
    confidence,
    directHits,
    labelHits,
    softHits,
    evidence: [...directHits, ...labelHits].slice(0, 3)
  };
};

/**
 * NLP 텍스트 필터 보완 (Layer B 강화)
 */
export const detectAdNLP = (videoId: string, title: string, description: string, pinnedComment: string = ""): any => {
  const combinedText = `${title}\n${description}\n${pinnedComment}`;
  const lowerText = combinedText.toLowerCase().replace(/\s+/g, ' ');
  
  let score = 0;
  const matchedPhrases: any[] = [];
  let negativeOverride = false;

  const weights = {
    high: ["유료 광고", "유료광고", "광고 포함", "paid promotion", "includes paid promotion", "sponsored by", "광고입니다"],
    mid: ["협찬", "스폰", "sponsor", "sponsorship", "제공받아", "지원받아", "파트너십", "원고료", "제작비"],
    low: ["affiliate", "제휴 링크", "수수료", "커미션", "gifted", "#ad", "#sponsored", "#협찬", "#광고"],
    negative: ["광고 아님", "내돈내산", "광고가 아닙니다", "not sponsored", "no paid promotion", "유료 광고 아닙니다"]
  };

  weights.high.forEach(p => { if (lowerText.includes(p.toLowerCase())) { score += 3; matchedPhrases.push({ phrase: p, weight: 'high' }); } });
  weights.mid.forEach(p => { if (lowerText.includes(p.toLowerCase())) { score += 2; matchedPhrases.push({ phrase: p, weight: 'mid' }); } });
  weights.low.forEach(p => { if (lowerText.includes(p.toLowerCase())) { score += 1; matchedPhrases.push({ phrase: p, weight: 'low' }); } });
  
  // 부정문 처리 강화
  const negativeHits = weights.negative.filter(p => lowerText.includes(p.toLowerCase()));
  if (negativeHits.length > 0) {
    // 실질 광고 신호(협찬/제공 등)가 없을 때만 override
    if (score < 4) {
      negativeOverride = true;
      score -= 5;
    }
  }

  let ad_disclosure: boolean | 'unknown' = 'unknown';
  if (score >= 3) ad_disclosure = true;
  else if (score >= 1) ad_disclosure = 'unknown';
  else ad_disclosure = false;

  const confidence = ad_disclosure === true ? Math.min(0.85, 0.6 + (score * 0.05)) : 0.5;

  return {
    video_id: videoId,
    ad_disclosure,
    score,
    confidence,
    matched_phrases: matchedPhrases,
    negativeOverride,
    reasoning: negativeOverride ? "부정문 패턴이 감지되어 광고 제외 처리되었습니다." : (ad_disclosure === true ? "강한 키워드 신호 포착" : "신호 미비")
  };
};

/**
 * 최종 결합 로직 보완
 */
export const combineAdResults = (paidFlag: any, nlp: any): AdDetectionResult => {
  let is_ad = false;
  let method: 'paid_flag' | 'nlp' | 'both' | 'none' = 'none';
  
  const hasDirectFlag = paidFlag.directHits.length > 0 || paidFlag.labelHits.length > 0;
  const isNlpTrue = nlp.ad_disclosure === true;

  if (hasDirectFlag && isNlpTrue) {
    is_ad = true;
    method = 'both';
  } else if (hasDirectFlag) {
    is_ad = true;
    method = 'paid_flag';
  } else if (isNlpTrue) {
    is_ad = true;
    method = 'nlp';
  }

  // 최종 신뢰도 산정 규칙
  let finalConfidence = 0;
  if (method === 'both') finalConfidence = 0.98;
  else if (method === 'paid_flag') finalConfidence = paidFlag.confidence;
  else if (method === 'nlp') finalConfidence = nlp.confidence;
  else finalConfidence = 0.3;

  const evidence: string[] = [];
  if (paidFlag.directHits.length > 0) evidence.push("시스템 '유료 프로모션' 플래그 감지");
  if (paidFlag.labelHits.length > 0) evidence.push("플레이어 '유료 광고 포함' 라벨 렌더링 데이터 확인");
  if (isNlpTrue) evidence.push(`설명란 광고 키워드 확인 (${nlp.matched_phrases[0]?.phrase})`);
  if (nlp.negativeOverride) evidence.push("광고 아님(내돈내산) 고지 확인");

  return {
    is_ad,
    confidence: finalConfidence,
    method,
    evidence: evidence.slice(0, 3),
    score: (hasDirectFlag ? 5 : 0) + (isNlpTrue ? 3 : 0),
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
    const shortsDone = !shortsCfg.enabled || (shortsCfg.useCountFilter && shorts.length >= shortsCfg.target);
    const longsDone = !longsCfg.enabled || (longsCfg.useCountFilter && longs.length >= longsCfg.target);
    if (shortsDone && longsDone) break;

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

    const shortsNeedMoreWithoutDate = shortsCfg.enabled && !shortsCfg.useDateFilter && (!shortsCfg.useCountFilter || shorts.length < shortsCfg.target);
    const longsNeedMoreWithoutDate = longsCfg.enabled && !longsCfg.useDateFilter && (!longsCfg.useCountFilter || longs.length < longsCfg.target);

    if (!shortsNeedMoreWithoutDate && !longsNeedMoreWithoutDate) {
        const oldestCutoff = new Date(Math.min(
          (shortsCfg.enabled && shortsCutoff) ? shortsCutoff.getTime() : Infinity,
          (longsCfg.enabled && longsCutoff) ? longsCutoff.getTime() : Infinity
        ));
        
        if (oldestCutoff.getTime() !== Infinity) {
          const lastVideoDate = new Date(videoResponse.data.items[videoResponse.data.items.length - 1].snippet.publishedAt);
          if (lastVideoDate < oldestCutoff) {
            nextPageToken = undefined;
            break;
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

      // 개선된 스캐너 적용: API 응답 객체 자체를 전달
      const paidFlag = detectAdPaidFlag(video); 
      const nlp = detectAdNLP(video.id, video.snippet.title, video.snippet.description || "");
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
