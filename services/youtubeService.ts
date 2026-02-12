
import axios from 'axios';
import { parseYtDurationSeconds, isYouTubeShort } from '../utils/shortsDetector';
import { VideoDetail, VideoResult, CommentInfo, AdVideoDetail, AdDetectionResult, AnalysisPeriod } from '../types';

const API_KEY = process.env.API_KEY;
const BASE_URL = 'https://www.googleapis.com/youtube/v3';

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
 * 텍스트에서 URL 리스트 추출 (정규화 포함)
 */
const extractLinks = (text: string): string[] => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);
  return matches ? matches.map(url => url.split(/[?#]/)[0].replace(/\/$/, '')) : [];
};

/**
 * 광고 판별 1단계: paidPromotion 플래그 분석
 */
export const detectAdPaidFlag = (videoUrl: string, html: string, responseBodies: string[] = []): any => {
  const videoIdMatch = videoUrl.match(/(?:v=|\/shorts\/|youtu\.be\/)([^"&?\/\s]{11})/);
  const videoId = videoIdMatch ? videoIdMatch[1] : "unknown";

  let paidPromotion: boolean | 'unknown' = 'unknown';
  const evidence: any[] = [];
  const found: any[] = [];

  const allData = [html, ...responseBodies].join('\n');
  const adKeys = ['paidPromotion', 'isPaidPromotion', 'paidProductPlacement', 'productPlacement'];
  
  for (const key of adKeys) {
    const regex = new RegExp(`"${key}"\\s*:\\s*(true|false|1|0|"true"|"false")`, 'gi');
    let match;
    while ((match = regex.exec(allData)) !== null) {
      const valStr = match[1].toLowerCase().replace(/"/g, '');
      const isTrue = valStr === 'true' || valStr === '1';
      found.push({ path: "JSON_SCAN", key, value: valStr });
      if (isTrue && paidPromotion !== true) {
        paidPromotion = true;
        evidence.push({ source: "Crawl", path: "ytInitialPlayerResponse", key, value: valStr, note: "Paid promotion flag detected" });
      } else if (!isTrue && paidPromotion === 'unknown') {
        paidPromotion = false;
      }
    }
  }

  const confidence = paidPromotion === true ? 0.8 : (paidPromotion === false ? 0.6 : 0.2);
  return { video_id: videoId, paid_promotion: paidPromotion, confidence, evidence: evidence.slice(0, 3), raw_flags: { found: found.slice(0, 5) } };
};

/**
 * 광고 판별 2단계: 텍스트 키워드 및 링크 일치 분석
 * 사용자 요청: 제목 '광고', 설명란 '광고'/'다운로드', 설명란-댓글1번 동일 링크 공유
 */
export const detectAdNLP = (videoId: string, title: string, description: string, topComments: CommentInfo[]): any => {
  const firstComment = topComments.length > 0 ? topComments[0].text : "";
  const lowerTitle = title.toLowerCase();
  const lowerDesc = (description || "").toLowerCase();
  
  let score = 0;
  const matchedPhrases: any[] = [];
  const evidence: string[] = [];

  // 1. 제목 키워드: '광고'
  if (lowerTitle.includes("광고")) {
    score += 5;
    matchedPhrases.push({ phrase: "제목에 '광고' 포함", weight: 'high', source: 'title' });
  }

  // 2. 설명란 키워드: '광고', '다운로드'
  if (lowerDesc.includes("광고")) {
    score += 3;
    matchedPhrases.push({ phrase: "설명란에 '광고' 포함", weight: 'mid', source: 'description' });
  }
  if (lowerDesc.includes("다운로드")) {
    score += 3;
    matchedPhrases.push({ phrase: "설명란에 '다운로드' 포함", weight: 'mid', source: 'description' });
  }

  // 3. 링크 매칭 분석: 설명란 vs 첫 번째 댓글
  const descLinks = extractLinks(description || "");
  const commentLinks = extractLinks(firstComment);
  
  const commonExclusions = ['youtube.com', 'youtu.be', 'instagram.com', 'facebook.com', 'twitter.com', 'linktr.ee'];
  
  const hasLinkMatch = descLinks.some(dLink => 
    commentLinks.some(cLink => {
      const isCommon = commonExclusions.some(ex => dLink.includes(ex));
      return dLink === cLink && !isCommon;
    })
  );

  if (hasLinkMatch) {
    score += 10;
    evidence.push("설명란과 첫 번째 댓글의 홍보 링크 일치");
    matchedPhrases.push({ phrase: "설명란-댓글 동일 링크 공유", weight: 'high', source: 'link_match' });
  }

  let ad_disclosure: boolean | 'unknown' = 'unknown';
  if (score >= 5) ad_disclosure = true;
  else if (score >= 2) ad_disclosure = 'unknown';
  else ad_disclosure = false;

  const confidence = ad_disclosure === true ? 0.95 : (ad_disclosure === false ? 0.6 : 0.3);
  
  return {
    video_id: videoId,
    ad_disclosure,
    confidence,
    matched_phrases: matchedPhrases,
    evidence: evidence,
    reasoning: ad_disclosure === true ? "사용자 정의 광고 탐지 규칙에 의해 광고로 판별되었습니다." : "광고 신호가 발견되지 않았습니다."
  };
};

export const combineAdResults = (paidFlag: any, nlp: any): AdDetectionResult => {
  let is_ad = false;
  let method: 'paid_flag' | 'nlp' | 'both' | 'none' = 'none';
  const isPaidTrue = paidFlag.paid_promotion === true;
  const isNlpTrue = nlp.ad_disclosure === true;

  if (isPaidTrue || isNlpTrue) {
    is_ad = true;
    method = isPaidTrue && isNlpTrue ? 'both' : (isPaidTrue ? 'paid_flag' : 'nlp');
  }

  const evidence: string[] = [...nlp.evidence];
  if (isPaidTrue) evidence.push("시스템 유료 광고 플래그 확인");
  nlp.matched_phrases.forEach((p: any) => {
    if (p.source === 'title') evidence.push("제목 내 '광고' 키워드");
    if (p.source === 'description' && p.phrase.includes('다운로드')) evidence.push("설명란 내 '다운로드' 키워드");
  });

  return {
    is_ad,
    confidence: is_ad ? Math.max(paidFlag.confidence, nlp.confidence) : 0.5,
    method,
    evidence: Array.from(new Set(evidence)).slice(0, 3),
    score: (isPaidTrue ? 5 : 0) + (nlp.ad_disclosure === true ? 5 : 0),
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
    if (!cfg.useDateFilter) return null;
    const days = cfg.period === '7d' ? 7 : cfg.period === '30d' ? 30 : 90;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  };

  const shortsCutoff = getCutoff(shortsCfg);
  const longsCutoff = getCutoff(longsCfg);

  while (safetyCounter < 500) {
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

      const comments = await fetchTopComments(video.id);
      const paidFlag = detectAdPaidFlag(`https://youtu.be/${video.id}`, ""); 
      const nlp = detectAdNLP(video.id, video.snippet.title, video.snippet.description || "", comments);
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
