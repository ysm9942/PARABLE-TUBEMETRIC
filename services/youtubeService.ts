
import { parseYtDurationSeconds, isYouTubeShort } from '../utils/shortsDetector';
import { VideoDetail, VideoResult } from '../types';

const API_KEY = 'AIzaSyDyg1ThpwHJIL2lHJW9bixqiDawMBUK2uo';
const BASE_URL = 'https://www.googleapis.com/youtube/v3';

export type AnalysisPeriod = '7d' | '30d' | 'all';

async function fetchWithKey(url: string, params: Record<string, any>) {
  const query = new URLSearchParams({ ...params, key: API_KEY }).toString();
  const response = await fetch(`${url}?${query}`);
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'API request failed');
  }
  return response.json();
}

export const getChannelInfo = async (channelId: string) => {
  const data = await fetchWithKey(`${BASE_URL}/channels`, {
    part: 'snippet,contentDetails,statistics',
    id: channelId,
  });

  if (!data.items || data.items.length === 0) {
    throw new Error(`Channel not found: ${channelId}`);
  }

  const channel = data.items[0];
  return {
    title: channel.snippet.title,
    thumbnail: channel.snippet.thumbnails.high?.url || channel.snippet.thumbnails.default.url,
    subscriberCount: channel.statistics.subscriberCount,
    uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
  };
};

export const fetchChannelStats = async (
  uploadsPlaylistId: string,
  targetShorts: number,
  targetLong: number,
  period: AnalysisPeriod,
  onProgress?: (scanned: number, found: number) => void
): Promise<{ 
  avgShortsViews: number; 
  shortsCount: number; 
  avgLongViews: number; 
  longCount: number;
  shortsList: VideoDetail[];
  longsList: VideoDetail[];
}> => {
  let shorts: VideoDetail[] = [];
  let longs: VideoDetail[] = [];
  let nextPageToken: string | undefined = undefined;
  let safetyCounter = 0;
  let totalScanned = 0;

  const now = new Date();
  let cutoffDate: Date | null = null;
  if (period === '7d') cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  else if (period === '30d') cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  while (
    (shorts.length < targetShorts || longs.length < targetLong) && 
    safetyCounter < 20 // Scans up to 1000 videos per channel
  ) {
    safetyCounter++;
    
    const playlistData = await fetchWithKey(`${BASE_URL}/playlistItems`, {
      part: 'contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: 50,
      pageToken: nextPageToken,
    });

    const items = playlistData.items;
    if (!items || items.length === 0) break;
    nextPageToken = playlistData.nextPageToken;

    const videoIds = items.map((i: any) => i.contentDetails.videoId);
    const videoData = await fetchWithKey(`${BASE_URL}/videos`, {
      part: 'snippet,contentDetails,statistics',
      id: videoIds.join(','),
    });

    for (const video of videoData.items) {
      totalScanned++;
      const publishedAt = new Date(video.snippet.publishedAt);
      if (cutoffDate && publishedAt < cutoffDate) continue;

      const durationSec = parseYtDurationSeconds(video.contentDetails.duration);
      const isShort = await isYouTubeShort(video.id, durationSec);
      const views = parseInt(video.statistics.viewCount || '0', 10);
      
      const videoInfo: VideoDetail = {
        id: video.id,
        title: video.snippet.title,
        thumbnail: video.snippet.thumbnails.medium?.url || video.snippet.thumbnails.default?.url,
        publishedAt: video.snippet.publishedAt,
        viewCount: views,
        duration: video.contentDetails.duration,
        isShort: isShort
      };

      if (isShort && shorts.length < targetShorts) shorts.push(videoInfo);
      else if (!isShort && longs.length < targetLong) longs.push(videoInfo);
    }

    if (onProgress) onProgress(totalScanned, shorts.length);
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
  };
};

export const fetchVideosByIds = async (videoIds: string[]): Promise<VideoResult[]> => {
  if (videoIds.length === 0) return [];
  const videoData = await fetchWithKey(`${BASE_URL}/videos`, {
    part: 'snippet,contentDetails,statistics',
    id: videoIds.join(','),
  });

  return videoData.items.map((item: any) => ({
    videoId: item.id,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    thumbnail: item.snippet.thumbnails.medium?.url,
    viewCount: parseInt(item.statistics.viewCount || '0', 10),
    duration: item.contentDetails.duration,
    isShort: parseYtDurationSeconds(item.contentDetails.duration)! <= 180,
    status: 'completed'
  }));
};
