
import axios from 'axios';
import { parseYtDurationSeconds, isYouTubeShort } from '../utils/shortsDetector';
import { VideoDetail, VideoResult, CommentInfo } from '../types';

// Vercel 환경 변수에서 API Key를 가져옵니다.
const API_KEY = process.env.API_KEY;
const BASE_URL = 'https://www.googleapis.com/youtube/v3';

export type AnalysisPeriod = '7d' | '30d' | '90d' | 'all';

/**
 * 특정 영상의 좋아요가 가장 많이 달린 댓글 6개를 가져옵니다.
 */
const fetchTopComments = async (videoId: string): Promise<CommentInfo[]> => {
  if (!API_KEY) return [];
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
    // 댓글이 비활성화된 경우 등이 있을 수 있음
    return [];
  }
};

/**
 * UC-Code 또는 @핸들이 포함된 URL로부터 채널 정보를 가져옵니다.
 */
export const getChannelInfo = async (input: string) => {
  if (!API_KEY) throw new Error('YouTube API Key가 설정되지 않았습니다. Vercel 환경 변수(API_KEY)를 확인해주세요.');
  
  const cleanInput = input.trim();
  let params: any = {
    part: 'snippet,contentDetails,statistics',
    key: API_KEY,
  };

  // 핸들 추출 (@handle)
  const handleMatch = cleanInput.match(/@([^/?\s]+)/);
  
  if (handleMatch) {
    params.forHandle = `@${handleMatch[1]}`;
  } else if (cleanInput.startsWith('UC')) {
    params.id = cleanInput;
  } else {
    const searchResponse = await axios.get(`${BASE_URL}/search`, {
      params: {
        part: 'snippet',
        q: cleanInput,
        type: 'channel',
        maxResults: 1,
        key: API_KEY,
      }
    });
    
    if (!searchResponse.data.items || searchResponse.data.items.length === 0) {
      throw new Error(`채널을 찾을 수 없습니다: ${cleanInput}`);
    }
    params.id = searchResponse.data.items[0].id.channelId;
  }

  const response = await axios.get(`${BASE_URL}/channels`, { params });

  if (!response.data.items || response.data.items.length === 0) {
    throw new Error(`채널 정보를 가져올 수 없습니다: ${cleanInput}`);
  }

  const channel = response.data.items[0];
  return {
    id: channel.id,
    title: channel.snippet.title,
    thumbnail: channel.snippet.thumbnails.high?.url || channel.snippet.thumbnails.default.url,
    subscriberCount: channel.statistics.subscriberCount,
    uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
    customUrl: channel.snippet.customUrl || `@${handleMatch ? handleMatch[1] : ''}`,
  };
};

export const fetchVideosByIds = async (videoIds: string[]): Promise<VideoResult[]> => {
  if (videoIds.length === 0) return [];

  const response = await axios.get(`${BASE_URL}/videos`, {
    params: {
      part: 'snippet,contentDetails,statistics',
      id: videoIds.join(','),
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
  shortsList: VideoDetail[];
  longsList: VideoDetail[];
  liveList: VideoDetail[];
}> => {
  let shorts: VideoDetail[] = [];
  let longs: VideoDetail[] = [];
  let lives: VideoDetail[] = [];
  let nextPageToken: string | undefined = undefined;
  let safetyCounter = 0;

  // 필터 설정에 따른 목표 개수 확정
  // 해당 카테고리를 사용하지 않으면 0, 사용하면 개수 필터 여부에 따라 설정
  const maxShorts = useShorts ? (useCountFilter ? targetShorts : 500) : 0;
  const maxLongs = useLongs ? (useCountFilter ? targetLong : 500) : 0;

  const now = new Date();
  let cutoffDate: Date | null = null;
  if (useDateFilter && period !== 'all') {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  let reachedDateLimit = false;

  // 루프 조건: 
  // 1. 날짜 제한에 걸리지 않았어야 함 (기간 필터 사용 시)
  // 2. 목표 개수를 다 채우지 못했어야 함
  while (
    !reachedDateLimit &&
    (shorts.length < maxShorts || longs.length < maxLongs) && 
    safetyCounter < 100 
  ) {
    safetyCounter++;
    
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

    const videoIds = items.map((i: any) => i.contentDetails.videoId);

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
        if (useShorts && shorts.length < maxShorts) shorts.push(videoInfo);
      } else {
        if (useLongs && longs.length < maxLongs) longs.push(videoInfo);
      }
    }

    if (!nextPageToken) break;
  }

  const calcAvg = (arr: VideoDetail[]) => arr.length === 0 ? 0 : Math.round(arr.reduce((s, v) => s + v.viewCount, 0) / arr.length);

  return {
    avgShortsViews: calcAvg(shorts),
    shortsCount: shorts.length,
    avgLongViews: calcAvg(longs),
    longCount: longs.length,
    shortsList: shorts,
    longsList: longs,
    liveList: lives,
  };
};
