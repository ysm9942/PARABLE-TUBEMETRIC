
import axios from 'axios';
import { GoogleGenAI } from "@google/genai";
import { parseYtDurationSeconds, isYouTubeShort } from '../utils/shortsDetector';
// AdEvidence 임포트 제거 (types.ts에 정의되어 있지 않음)
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
  description?: string;
  title?: string;
  topComments?: CommentInfo[];
}

const getErrorMessage = (error: any): string => {
  if (error.response?.data?.error?.message) {
    return error.response.data.error.message;
  }
  return error.message || '알 수 없는 오류가 발생했습니다.';
};

/**
 * AI 기반 광고 판별 함수 (Gemini 3 Flash 활용)
 * 사용자 요청: 제목/설명란 '광고', '다운로드' 키워드 및 설명란-댓글 링크 일치 여부 확인
 */
export const detectAdWithAI = async (videoUrl: string, payload: AnalysisPayload): Promise<AdDetectionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const playerRegex = /(?:var\s+|window\[['"]|window\.)ytInitialPlayerResponse\s*=\s*({.+?});/s;
  const playerMatch = payload.rawHtml?.match(playerRegex);
  
  const commentsText = payload.topComments?.map(c => `[Author: ${c.author}] ${c.text}`).join('\n') || "No comments fetched";

  const extractionTarget = `
    URL: ${videoUrl}
    TITLE: ${payload.title}
    DESCRIPTION: ${payload.description}
    FIRST_COMMENTS:
    ${commentsText}
    
    [TECHNICAL_DATA_EXISTS]
    ytInitialPlayerResponse: ${!!playerMatch}
  `;

  const systemPrompt = `유튜브 광고 영상 분석 전문가로서, 다음 데이터를 분석하여 유료 광고 포함 여부를 판별하라.

판별 핵심 규칙:
1) 키워드 신호: 
   - 제목에 '광고'가 포함되어 있는가?
   - 설명란에 '광고', '다운로드', '협찬', '제작지원' 등의 단어가 포함되어 있는가?
2) 댓글 및 링크 분석:
   - 고정 댓글(또는 첫 번째 댓글)에서 제품이나 서비스를 홍보하는 링크가 있는가?
   - **가장 중요**: 설명란에 기재된 링크와 댓글에 기재된 링크가 동일한 홍보용 링크(예: bit.ly, 쇼핑몰 링크 등)인 경우 강력한 광고 신호로 간주한다.
3) 기술적 신호:
   - ytInitialPlayerResponse 내부의 paidPromotionRenderer, paidContentOverlayRenderer 등의 존재 여부.

판별 절차:
- 위 3가지 신호를 종합하여 paid_promotion 여부를 결정한다.
- 링크 일치나 시스템 렌더러 발견 시 confidence를 0.9 이상으로 설정한다.
- 단순 키워드만 발견 시 confidence를 0.7~0.8로 설정한다.

출력(JSON만):
{
  "paid_promotion": "true" | "false" | "unknown",
  "confidence": 0.0~1.0,
  "evidence": [
    {
      "source": "title" | "description" | "comments" | "technical",
      "signal": "keyword_match" | "link_match" | "system_renderer" | "other",
      "path_hint": "근거 위치 요약",
      "excerpt": "발견 근거 (예: 설명란과 댓글의 링크가 https://... 로 일치함)"
    }
  ],
  "debug": {
    "found_initial_player_response": boolean,
    "link_matching_detected": boolean,
    "notes": "분석 요약"
  }
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: extractionTarget,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json"
      }
    });

    const result = JSON.parse(response.text || '{}');
    
    // AI 응답 결과를 AdDetectionResult 인터페이스에 맞게 명시적으로 매핑
    const evidence: string[] = Array.isArray(result.evidence) 
      ? result.evidence.map((ev: any) => `${ev.source || 'Signal'}: ${ev.excerpt || ev.signal || '신호 감지됨'}`)
      : [];

    return {
      is_ad: result.paid_promotion === "true",
      confidence: result.confidence || 0,
      method: "AI_GEMINI_ANALYSIS",
      evidence: evidence,
      score: (result.confidence || 0) * 100
    };
  } catch (error) {
    console.error("AI Ad Detection Error:", error);
    return {
      is_ad: false,
      confidence: 0,
      method: "none",
      evidence: ["AI 분석 중 오류 발생"],
      score: 0
    };
  }
};

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
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    payload.rawHtml = response.data;
    payload.source = 'runtime_eval';
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

export const fetchChannelStats = async (
  uploadsPlaylistId: string, 
  shortsCfg: any,
  longsCfg: any
) => {
  let shorts: VideoDetail[] = [], longs: VideoDetail[] = [], lives: VideoDetail[] = [], nextPageToken: string | undefined, safetyCounter = 0;
  
  const getCutoff = (cfg: any) => {
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

    const videoIds = playlistResponse.data.items.map((i:any)=>i.contentDetails.videoId).join(',');
    const videoResponse = await axios.get(`${BASE_URL}/videos`, { params: { part: 'snippet,contentDetails,statistics,liveStreamingDetails', id: videoIds, key: API_KEY } });
    
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

      // 1. 영상 기본 데이터 수집 (설명란, 제목, 댓글)
      const comments = await fetchTopComments(video.id);
      const payload = await fetchDetailedPlayerResponse(video.id);
      payload.description = video.snippet.description;
      payload.title = video.snippet.title;
      payload.topComments = comments;
      
      // 2. AI 기반 광고 판별 (사용자 요청 로직 반영)
      const detection = await detectAdWithAI(`https://www.youtube.com/watch?v=${video.id}`, payload);

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
