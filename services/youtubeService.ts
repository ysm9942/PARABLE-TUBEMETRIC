
import axios from 'axios';
import { parseYtDurationSeconds, isYouTubeShort } from '../utils/shortsDetector';
import { VideoDetail, VideoResult } from '../types';

// 제공된 API Key 직접 할당 (브라우저 환경에서 process.env 에러 방지)
const API_KEY = 'AIzaSyDyg1ThpwHJIL2lHJW9bixqiDawMBUK2uo';
const BASE_URL = 'https://www.googleapis.com/youtube/v3';

export type AnalysisPeriod = '7d' | '30d' | 'all';

export const getChannelInfo = async (channelId: string) => {
  if (!API_KEY) throw new Error('YouTube API Key가 설정되지 않았습니다.');
  
  const response = await axios.get(`${BASE_URL}/channels`, {
    params: {
      part: 'snippet,contentDetails,statistics',
      id: channelId,
      key: API_KEY,
    },
  });

  if (!response.data.items || response.data.items.length === 0) {
    throw new Error(`채널을 찾을 수 없습니다: ${channelId}`);
  }

  const channel = response.data.items[0];
  return {
    title: channel.snippet.title,
    thumbnail: channel.snippet.thumbnails.high?.url || channel.snippet.thumbnails.default.url,
    subscriberCount: channel.statistics.subscriberCount,
    uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
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
    
    results.push({
      videoId: item.id,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.default.url,
      viewCount: parseInt(item.statistics.viewCount || '0', 10),
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
  period: AnalysisPeriod
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

  const now = new Date();
  let cutoffDate: Date | null = null;
  if (period === '7d') {
    cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === '30d') {
    cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  let reachedDateLimit = false;

  // 최대 15페이지(약 750개 영상)까지 탐색하여 목표 수량을 채웁니다.
  while (
    !reachedDateLimit &&
    (shorts.length < targetShorts || longs.length < targetLong) && 
    safetyCounter < 15
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
      
      // 라이브 여부 확인
      const isLiveStream = !!video.liveStreamingDetails;
      const concurrentViewers = video.liveStreamingDetails?.concurrentViewers 
        ? parseInt(video.liveStreamingDetails.concurrentViewers, 10) 
        : undefined;

      const videoInfo: VideoDetail = {
        id: video.id,
        title: video.snippet.title,
        thumbnail: video.snippet.thumbnails.high?.url || video.snippet.thumbnails.medium?.url || video.snippet.thumbnails.default?.url,
        publishedAt: video.snippet.publishedAt,
        viewCount: views,
        duration: durationStr,
        isShort: isShort,
        isLiveStream,
        concurrentViewers
      };

      if (isLiveStream) {
        lives.push(videoInfo);
      }

      if (isShort) {
        if (shorts.length < targetShorts) shorts.push(videoInfo);
      } else {
        if (longs.length < targetLong) longs.push(videoInfo);
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
    liveList: lives.slice(0, 10),
  };
};
