import axios from 'axios';
import { parseYtDurationSeconds, isYouTubeShort } from '../utils/shortsDetector';
import { VideoDetail, VideoResult, CommentInfo } from '../types';

// Vercel 환경 변수에서 API Key를 가져옵니다.
const API_KEY = process.env.API_KEY;
const BASE_URL = 'https://www.googleapis.com/youtube/v3';

export type AnalysisPeriod = '7d' | '30d' | '90d' | 'all';

/**
 * YouTube API 에러 메시지 추출
 */
const getErrorMessage = (error: any): string => {
  if (error.response?.data?.error?.message) {
    return error.response.data.error.message;
  }
  return error.message || '알 수 없는 오류가 발생했습니다.';
};

/**
 * 특정 영상의 좋아요가 가장 많이 달린 댓글 6개를 가져옵니다.
 */
const fetchTopComments = async (videoId: string): Promise<CommentInfo[]> => {
  if (!API_KEY || !videoId) return [];
  try {
    const response = await axios.get(`${BASE_URL}/commentThreads`, {
      params: {
        part: 'snippet',
        videoId: videoId,
        maxResults: 6,
        order: 'relevance',
        key: API_KEY,
      },
    });
    return response.data.items.map((item: any) => ({
      author: item.snippet.topLevelComment.snippet.authorDisplayName,
      text: item.snippet.topLevelComment.snippet.textDisplay,
      likeCount: item.snippet.topLevelComment.snippet.likeCount,
      publishedAt: item.snippet.topLevelComment.snippet.publishedAt,
    }));
  } catch (e) {
    // 댓글이 비활성화된 경우(403) 등은 빈 배열 반환
    return [];
  }
};

/**
 * 입력값에서 채널 ID 또는 핸들을 추출하여 채널 정보를 가져옵니다.
 */
export const getChannelInfo = async (input: string) => {
  if (!API_KEY) throw new Error('YouTube API Key가 설정되지 않았습니다.');
  
  // 입력값 정제: URL 형태인 경우 경로만 남기고 쿼리스트링 제거
  let cleanInput = input.trim();
  if (cleanInput.includes('youtube.com/') || cleanInput.includes('youtu.be/')) {
    try {
      const url = new URL(cleanInput.startsWith('http') ? cleanInput : `https://${cleanInput}`);
      cleanInput = url.pathname + url.search;
    } catch (e) {
      // URL 파싱 실패 시 원본 사용
    }
  }

  let params: any = {
    part: 'snippet,contentDetails,statistics',
    key: API_KEY,
  };

  // 1. UC로 시작하는 채널 ID 직접 추출
  const idMatch = cleanInput.match(/UC[a-zA-Z0-9_-]{22}/);
  // 2. @로 시작하는 핸들 추출
  const handleMatch = cleanInput.match(/@([^/?\s]+)/);

  if (idMatch) {
    params.id = idMatch[0];
  } else if (handleMatch) {
    // forHandle은 @를 포함해야 함
    params.forHandle = `@${handleMatch[1]}`;
  } else {
    // ID나 핸들을 찾지 못한 경우 검색 API 사용
    try {
      const searchResponse = await axios.get(`${BASE_URL}/search`, {
        params: {
          part: 'snippet',
          q: input.trim(),
          type: 'channel',
          maxResults: 1,
          key: API_KEY,
        }
      });
      
      if (!searchResponse.data.items || searchResponse.data.items.length === 0) {
        throw new Error(`채널을 찾을 수 없습니다: ${input}`);
      }
      params.id = searchResponse.data.items[0].id.channelId;
    } catch (err) {
      throw new Error(`검색 중 오류 발생: ${getErrorMessage(err)}`);
    }
  }

  try {
    const response = await axios.get(`${BASE_URL}/channels`, { params });
    if (!response.data.items || response.data.items.length === 0) {
      throw new Error('채널 정보를 찾을 수 없습니다. (ID/핸들 확인 필요)');
    }

    const channel = response.data.items[0];
    return {
      id: channel.id,
      title: channel.snippet.title,
      thumbnail: channel.snippet.thumbnails.high?.url || channel.snippet.thumbnails.default.url,
      subscriberCount: channel.statistics.subscriberCount,
      uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
    };
  } catch (err) {
    throw new Error(`채널 조회 실패: ${getErrorMessage(err)}`);
  }
};

export const fetchVideosByIds = async (videoIds: string[]): Promise<VideoResult[]> => {
  const validIds = videoIds.filter(id => id && id.length === 11);
  if (validIds.length === 0) return [];

  try {
    const response = await axios.get(`${BASE_URL}/videos`, {
      params: {
        part: 'snippet,contentDetails,statistics',
        id: validIds.join(','),
        key: API_KEY,
      },
    });

    const results: VideoResult[] = [];
    for (const item of response.data.items) {
      const durationSec = parseYtDurationSeconds(item.contentDetails.duration);
      const isShort = await isYouTubeShort(item.id, durationSec);
      const topComments = await fetchTopComments(item.id);
      
      results.push({
        videoId: item.id,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.default.url,
        viewCount: parseInt(item.statistics.viewCount || '0', 10),
        likeCount: parseInt(item.statistics.likeCount || '0', 10),
        commentCount: parseInt(item.statistics.commentCount || '0', 10),
        topComments,
        duration: item.contentDetails.duration,
        isShort,
        status: 'completed'
      });
    }
    return results;
  } catch (err) {
    throw new Error(`영상 정보 조회 실패: ${getErrorMessage(err)}`);
  }
};

export const fetchChannelStats = async (
  uploadsPlaylistId: string,
  targetShorts: number,
  targetLong: number,
  period: AnalysisPeriod,
  useDateFilter: boolean,
  useCountFilter: boolean,
  useShorts: boolean,
  useLongs: boolean
): Promise<{ 
  avgShortsViews: number; 
  shortsCount: number; 
  avgLongViews: number; 
  longCount: number;
  avgTotalViews: number;
  totalCount: number;
  shortsList: VideoDetail[];
  longsList: VideoDetail[];
  liveList: VideoDetail[];
}> => {
  if (!uploadsPlaylistId) throw new Error('업로드 플레이리스트 ID가 없습니다.');

  let shorts: VideoDetail[] = [];
  let longs: VideoDetail[] = [];
  let lives: VideoDetail[] = [];
  let nextPageToken: string | undefined = undefined;
  let safetyCounter = 0;

  const maxShorts = useShorts ? (useCountFilter ? targetShorts : Infinity) : 0;
  const maxLongs = useLongs ? (useCountFilter ? targetLong : Infinity) : 0;

  const now = new Date();
  let cutoffDate: Date | null = null;
  if (useDateFilter && period !== 'all') {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  let reachedDateLimit = false;

  while (
    !reachedDateLimit &&
    (useCountFilter ? (shorts.length < maxShorts || longs.length < maxLongs) : true) && 
    safetyCounter < 100 // 무한 루프 방지
  ) {
    safetyCounter++;
    
    try {
      const playlistResponse = await axios.get(`${BASE_URL}/playlistItems`, {
        params: {
          part: 'contentDetails',
          playlistId: uploadsPlaylistId,
          maxResults: 50,
          pageToken: nextPageToken,
          key: API_KEY,
        },
      });

      const items = playlistResponse.data.items;
      if (!items || items.length === 0) break;
      nextPageToken = playlistResponse.data.nextPageToken;

      const videoIds = items.map((i: any) => i.contentDetails.videoId).filter((id: string) => !!id);
      if (videoIds.length === 0) break;

      const videoResponse = await axios.get(`${BASE_URL}/videos`, {
        params: {
          part: 'snippet,contentDetails,statistics,liveStreamingDetails',
          id: videoIds.join(','),
          key: API_KEY,
        },
      });

      const videoDetails = videoResponse.data.items;

      for (const video of videoDetails) {
        const publishedAt = new Date(video.snippet.publishedAt);
        if (cutoffDate && publishedAt < cutoffDate) {
          reachedDateLimit = true;
          break;
        }

        const durationStr = video.contentDetails.duration;
        const durationSec = parseYtDurationSeconds(durationStr);
        const isShort = await isYouTubeShort(video.id, durationSec);
        const views = parseInt(video.statistics.viewCount || '0', 10);
        const isLiveStream = !!video.liveStreamingDetails;

        const videoInfo: VideoDetail = {
          id: video.id,
          title: video.snippet.title,
          thumbnail: video.snippet.thumbnails.high?.url || video.snippet.thumbnails.medium?.url || video.snippet.thumbnails.default?.url,
          publishedAt: video.snippet.publishedAt,
          viewCount: views,
          duration: durationStr,
          isShort: isShort,
          isLiveStream
        };

        if (isLiveStream) {
          if (lives.length < 10) lives.push(videoInfo);
        } else if (isShort) {
          if (useShorts && (useCountFilter ? shorts.length < maxShorts : true)) {
            shorts.push(videoInfo);
          }
        } else {
          if (useLongs && (useCountFilter ? longs.length < maxLongs : true)) {
            longs.push(videoInfo);
          }
        }
      }

      if (!nextPageToken) break;
    } catch (err) {
      throw new Error(`목록 수집 중 오류: ${getErrorMessage(err)}`);
    }
  }

  const calcAvg = (arr: VideoDetail[]) => arr.length === 0 ? 0 : Math.round(arr.reduce((s, v) => s + v.viewCount, 0) / arr.length);

  const totalVideos = [...shorts, ...longs];
  const avgTotalViews = calcAvg(totalVideos);

  return {
    avgShortsViews: calcAvg(shorts),
    shortsCount: shorts.length,
    avgLongViews: calcAvg(longs),
    longCount: longs.length,
    avgTotalViews: avgTotalViews,
    totalCount: totalVideos.length,
    shortsList: shorts,
    longsList: longs,
    liveList: lives,
  };
};
