
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
 * 광고 판별 1단계: paidPromotion 플래그 분석 (0-100 점수 기반)
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
        evidence.push({ source: "System", path: "ytInitialPlayerResponse", key, value: valStr, note: "Paid promotion flag detected" });
      } else if (!isTrue && paidPromotion === 'unknown') {
        paidPromotion = false;
      }
    }
  }

  // Paid Flag가 true면 최소 90점 이상의 신뢰도를 가짐
  const confidenceScore = paidPromotion === true ? 95 : (paidPromotion === false ? 0 : 10);

  return {
    video_id: videoId,
    paid_promotion: paidPromotion,
    confidence_score: confidenceScore,
    evidence: evidence.slice(0, 3),
    raw_flags: { found: found.slice(0, 5) }
  };
};

/**
 * 광고 판별 2단계: description 텍스트 NLP 필터 (False Positive 방어 및 동적 가중치)
 */
export const detectAdNLP = (videoId: string, title: string, description: string, pinnedComment: string = "", channelName: string = ""): any => {
  const combinedText = `${title}\n${description}\n---PINNED---\n${pinnedComment}`;
  const lowerText = combinedText.toLowerCase().replace(/\s+/g, ' ');
  
  // 1. 채널 성향 파악 (Threshold 동적화)
  const isReviewChannel = /리뷰|review|테크|tech|언박싱|unboxing|추천/i.test(channelName + description);
  const isGamingChannel = /게임|game|플레이|play|공략/i.test(channelName + description);
  
  // 기본 가중치 설정
  let score = 0;
  const matchedPhrases: any[] = [];

  const weights = {
    critical: ["유료 광고", "유료광고", "광고 포함", "paid promotion", "includes paid promotion", "sponsored by", "광고입니다"],
    strong: ["협찬", "스폰", "sponsor", "sponsorship", "제공받아", "지원받아", "파트너십"],
    moderate: ["원고료", "제작비", "affiliate", "제휴 링크", "수수료", "커미션", "gifted", "PR", "#ad", "#sponsored", "#협찬", "#광고"],
    negative: ["광고 아님", "내돈내산", "not sponsored", "no sponsorship", "직접 구매", "제 돈으로"]
  };

  // 2. False Positive 방어: 부정/조건문 맥락 분석
  // "광고 문의", "광고 제안", "광고 메일" 등은 광고 영상이 아니라는 강력한 신호일 수 있음
  const inquiryRegex = /광고\s*(문의|메일|협업|제안|비즈니스|email|contact|inquiry)/gi;
  const falsePositivePhrases = lowerText.match(inquiryRegex) || [];
  
  // 3. NLP 스코어링 (동적 가중치 적용)
  weights.critical.forEach(p => {
    if (lowerText.includes(p.toLowerCase())) {
      score += 50;
      matchedPhrases.push({ phrase: p, weight: 'critical' });
    }
  });

  weights.strong.forEach(p => {
    if (lowerText.includes(p.toLowerCase())) {
      // 리뷰 채널에서는 '제공받아'가 일상적이므로 가중치를 약간 낮추거나 특정 조합을 확인
      let weight = isReviewChannel ? 25 : 35;
      score += weight;
      matchedPhrases.push({ phrase: p, weight: 'strong' });
    }
  });

  weights.moderate.forEach(p => {
    if (lowerText.includes(p.toLowerCase())) {
      score += 15;
      matchedPhrases.push({ phrase: p, weight: 'moderate' });
    }
  });

  // 4. 감점 요인 적용 (부정 문구 및 False Positive)
  weights.negative.forEach(p => {
    if (lowerText.includes(p.toLowerCase())) {
      score -= 40;
      matchedPhrases.push({ phrase: p, weight: 'negative' });
    }
  });

  if (falsePositivePhrases.length > 0) {
    score -= (20 * falsePositivePhrases.length); // 광고 문의 문구당 감점
  }

  // 5. 점수 정규화 (0-100)
  const finalScore = Math.min(100, Math.max(0, score));
  
  let ad_disclosure: boolean | 'unknown' = 'unknown';
  if (finalScore >= 70) ad_disclosure = true;
  else if (finalScore >= 30) ad_disclosure = 'unknown';
  else ad_disclosure = false;

  const reasoning = ad_disclosure === true 
    ? `분석 결과 '${matchedPhrases[0]?.phrase}' 등 명확한 광고 고지 패턴이 확인되었습니다.`
    : (ad_disclosure === false ? "광고 고지 또는 협찬을 암시하는 맥락이 발견되지 않았습니다." : "광고 여부를 판단하기에 신호가 부족합니다.");

  return {
    video_id: videoId,
    ad_disclosure,
    confidence_score: finalScore,
    matched_phrases: matchedPhrases.slice(0, 5),
    reasoning,
    channel_context: { isReviewChannel, isGamingChannel }
  };
};

/**
 * 최종 광고 판정 및 통합 점수 산출
 */
export const combineAdResults = (paidFlag: any, nlp: any): AdDetectionResult => {
  // Paid Flag가 켜져있으면 무조건 광고로 간주 (가장 강력한 신호)
  const is_ad = paidFlag.paid_promotion === true || nlp.ad_disclosure === true;
  
  let finalScore = 0;
  if (paidFlag.paid_promotion === true) {
    // Paid Flag가 있으면 최소 90점, NLP가 보강하면 더 높아짐
    finalScore = Math.max(90, Math.min(100, paidFlag.confidence_score + (nlp.confidence_score * 0.1)));
  } else {
    // NLP에만 의존할 경우 NLP 점수 그대로 사용
    finalScore = nlp.confidence_score;
  }

  const evidence: string[] = [];
  if (paidFlag.paid_promotion === true) evidence.push("YouTube 공식 유료 광고 고지 감지");
  if (nlp.confidence_score >= 50) evidence.push(`설명란 광고 키워드 감지 (${nlp.matched_phrases[0]?.phrase})`);
  else if (nlp.confidence_score >= 30) evidence.push("광고 의심 정황 포착 (설명란)");
  
  if (!is_ad) evidence.push("명확한 광고 고지 없음");

  return {
    is_ad,
    confidence: finalScore / 100, // 기존 UI 호환용 (0-1)
    method: (paidFlag.paid_promotion === true && nlp.ad_disclosure === true) ? 'both' : (paidFlag.paid_promotion === true ? 'paid_flag' : 'nlp'),
    evidence: evidence.slice(0, 2),
    score: finalScore, // 0-100 점수
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
  // 채널 정보를 미리 가져와 성향 파악에 활용
  let channelName = "Unknown Channel";
  try {
    const playlistInfo = await axios.get(`${BASE_URL}/playlists`, { params: { part: 'snippet', id: uploadsPlaylistId, key: API_KEY } });
    if (playlistInfo.data.items?.length) channelName = playlistInfo.data.items[0].snippet.channelTitle;
  } catch (e) {}

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

      const paidFlag = detectAdPaidFlag(`https://youtu.be/${video.id}`, ""); 
      const nlp = detectAdNLP(video.id, video.snippet.title, video.snippet.description || "", "", channelName);
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
