
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
 * 4) 광고 판별 1단계: paidPromotion 플래그 분석 (HTML/JSON 기반)
 */
export const detectAdPaidFlag = (videoUrl: string, html: string, responseBodies: string[] = []): any => {
  const videoIdMatch = videoUrl.match(/(?:v=|\/shorts\/|youtu\.be\/)([^"&?\/\s]{11})/);
  const videoId = videoIdMatch ? videoIdMatch[1] : "unknown";

  let paidPromotion: boolean | 'unknown' = 'unknown';
  const evidence: any[] = [];
  const found: any[] = [];

  // 탐색 타겟 문자열 결합
  const allData = [html, ...responseBodies].join('\n');
  
  // 정규식 기반 키 탐색 (isPaidPromotion, paidPromotion, paidProductPlacement 등)
  // 대소문자/언더스코어 허용
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

  return {
    video_id: videoId,
    paid_promotion: paidPromotion,
    confidence,
    evidence: evidence.slice(0, 3),
    raw_flags: { found: found.slice(0, 5) }
  };
};

/**
 * 5) 광고 판별 2단계: description 텍스트 NLP 필터
 */
export const detectAdNLP = (videoId: string, title: string, description: string, pinnedComment: string = "", channelName: string = ""): any => {
  const combinedText = `${description}\n---PINNED---\n${pinnedComment}`;
  
  // 전처리: URL, 이메일 마스킹 및 정규화
  const cleanedText = combinedText
    .replace(/https?:\/\/[^\s]+/g, '<URL>')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '<CONTACT>');
    
  const lowerText = (title + " " + cleanedText).toLowerCase().replace(/\s+/g, ' ');
  
  let score = 0;
  const matchedPhrases: any[] = [];

  const weights = {
    high: ["유료 광고", "유료광고", "광고 포함", "paid promotion", "includes paid promotion", "sponsored by", "ad:", "광고입니다"],
    mid: ["협찬", "스폰", "sponsor", "sponsorship", "제공받아", "지원받아", "파트너십", "원고료", "제작비"],
    low: ["affiliate", "제휴 링크", "수수료", "커미션", "gifted", "PR", "#ad", "#sponsored", "#협찬", "#광고"],
    negative: ["광고 아님", "내돈내산", "not sponsored", "no sponsorship"]
  };

  weights.high.forEach(p => { if (lowerText.includes(p.toLowerCase())) { score += 3; matchedPhrases.push({ phrase: p, weight: 'high', source: 'text' }); } });
  weights.mid.forEach(p => { if (lowerText.includes(p.toLowerCase())) { score += 2; matchedPhrases.push({ phrase: p, weight: 'mid', source: 'text' }); } });
  weights.low.forEach(p => { if (lowerText.includes(p.toLowerCase())) { score += 1; matchedPhrases.push({ phrase: p, weight: 'low', source: 'text' }); } });
  weights.negative.forEach(p => { if (lowerText.includes(p.toLowerCase())) { score -= 2; matchedPhrases.push({ phrase: p, weight: 'negative', source: 'text' }); } });

  let ad_disclosure: boolean | 'unknown' = 'unknown';
  if (score >= 3) ad_disclosure = true;
  else if (score === 2) ad_disclosure = 'unknown';
  else ad_disclosure = false;

  let ad_type: string = "unknown";
  if (ad_disclosure === true) {
    if (lowerText.includes("수수료") || lowerText.includes("affiliate")) ad_type = "affiliate";
    else if (lowerText.includes("제공받아")) ad_type = "gifted";
    else if (score >= 5) ad_type = "paid_promotion";
    else ad_type = "sponsorship";
  }

  const confidence = ad_disclosure === true ? 0.75 : (ad_disclosure === false ? 0.55 : 0.3);
  const reasoning = ad_disclosure === true 
    ? `텍스트 분석 결과 '${matchedPhrases[0]?.phrase}' 등 강한 광고 신호가 포착되었습니다.`
    : (ad_disclosure === false ? "광고를 암시하는 키워드가 발견되지 않았습니다." : "광고 여부가 불분명합니다.");

  return {
    video_id: videoId,
    ad_disclosure,
    ad_type,
    confidence,
    matched_phrases: matchedPhrases.slice(0, 5),
    reasoning,
    cleaned_text: cleanedText.substring(0, 500)
  };
};

/**
 * 6) 최종 광고 판정 결합 규칙
 */
export const combineAdResults = (paidFlag: any, nlp: any): AdDetectionResult => {
  let is_ad = false;
  let method: 'paid_flag' | 'nlp' | 'both' | 'none' = 'none';
  
  const isPaidTrue = paidFlag.paid_promotion === true;
  const isNlpTrue = nlp.ad_disclosure === true;

  if (isPaidTrue && isNlpTrue) {
    is_ad = true;
    method = 'both';
  } else if (isPaidTrue) {
    is_ad = true;
    method = 'paid_flag';
  } else if (isNlpTrue) {
    is_ad = true;
    method = 'nlp';
  }

  // 애매한 경우 오탐 방지 (4, 5번 규칙)
  if (!isPaidTrue && !isNlpTrue) {
    is_ad = false;
    method = 'none';
  }

  let finalConfidence = 0;
  if (is_ad) {
    finalConfidence = method === 'both' ? Math.max(paidFlag.confidence, nlp.confidence) : (isPaidTrue ? paidFlag.confidence : nlp.confidence);
  } else {
    finalConfidence = Math.min(0.6, (paidFlag.confidence + nlp.confidence) / 2);
  }

  const evidence: string[] = [];
  if (isPaidTrue) evidence.push("시스템 플래그 감지 (Paid Promotion)");
  if (isNlpTrue) evidence.push(`설명란 키워드 감지 (${nlp.matched_phrases[0]?.phrase})`);
  if (!is_ad) evidence.push("광고 신호 없음/불충분");

  return {
    is_ad,
    confidence: finalConfidence,
    method,
    evidence: evidence.slice(0, 2),
    score: (isPaidTrue ? 5 : 0) + (nlp.ad_disclosure === true ? 3 : 0),
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

export const fetchChannelStats = async (uploadsPlaylistId: string, targetShorts: number, targetLong: number, period: AnalysisPeriod, useDateFilter: boolean, useCountFilter: boolean, useShorts: boolean, useLongs: boolean) => {
  let shorts: VideoDetail[] = [], longs: VideoDetail[] = [], lives: VideoDetail[] = [], nextPageToken: string | undefined, safetyCounter = 0;
  const maxShorts = useShorts ? (useCountFilter ? targetShorts : Infinity) : 0, maxLongs = useLongs ? (useCountFilter ? targetLong : Infinity) : 0;
  let cutoffDate: Date | null = null;
  if (useDateFilter && period !== 'all') cutoffDate = new Date(Date.now() - (period === '7d' ? 7 : period === '30d' ? 30 : 90) * 24 * 60 * 60 * 1000);
  while ((useCountFilter ? (shorts.length < maxShorts || longs.length < maxLongs) : true) && safetyCounter < 100) {
    safetyCounter++;
    const playlistResponse = await axios.get(`${BASE_URL}/playlistItems`, { params: { part: 'contentDetails', playlistId: uploadsPlaylistId, maxResults: 50, pageToken: nextPageToken, key: API_KEY } });
    if (!playlistResponse.data.items?.length) break;
    nextPageToken = playlistResponse.data.nextPageToken;
    const videoResponse = await axios.get(`${BASE_URL}/videos`, { params: { part: 'snippet,contentDetails,statistics,liveStreamingDetails', id: playlistResponse.data.items.map((i:any)=>i.contentDetails.videoId).join(','), key: API_KEY } });
    for (const video of videoResponse.data.items) {
      if (cutoffDate && new Date(video.snippet.publishedAt) < cutoffDate) { nextPageToken = undefined; break; }
      const isShort = await isYouTubeShort(video.id, parseYtDurationSeconds(video.contentDetails.duration));
      const info = { id: video.id, title: video.snippet.title, thumbnail: video.snippet.thumbnails.high?.url || video.snippet.thumbnails.default?.url, publishedAt: video.snippet.publishedAt, viewCount: parseInt(video.statistics.viewCount || '0', 10), duration: video.contentDetails.duration, isShort, isLiveStream: !!video.liveStreamingDetails };
      if (info.isLiveStream) { if(lives.length<10) lives.push(info); }
      else if (isShort) { if(useShorts && shorts.length < maxShorts) shorts.push(info); }
      else { if(useLongs && longs.length < maxLongs) longs.push(info); }
    }
    if (!nextPageToken) break;
  }
  const calcAvg = (arr: VideoDetail[]) => arr.length ? Math.round(arr.reduce((s, v) => s + v.viewCount, 0) / arr.length) : 0;
  return { avgShortsViews: calcAvg(shorts), shortsCount: shorts.length, avgLongViews: calcAvg(longs), longCount: longs.length, avgTotalViews: calcAvg([...shorts, ...longs]), totalCount: shorts.length + longs.length, shortsList: shorts, longsList: longs, liveList: lives };
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

      // 1단계: Paid Flag (API에서는 HTML 크롤링이 불가하므로 unknown 처리하거나 status 파라미터 확인)
      // 실제 브라우저에서는 이 시점에 HTML이 없으므로 NLP 위주로 동작하게 됨
      const paidFlag = detectAdPaidFlag(`https://youtu.be/${video.id}`, ""); 
      
      // 2단계: NLP 분석
      const nlp = detectAdNLP(video.id, video.snippet.title, video.snippet.description || "");
      
      // 최종 결합
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
