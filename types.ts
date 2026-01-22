
export interface CommentInfo {
  author: string;
  text: string;
  likeCount: number;
  publishedAt: string;
}

export interface ChannelResult {
  channelId: string;
  channelName: string;
  thumbnail: string;
  subscriberCount: string;
  avgShortsViews: number;
  shortsCountFound: number;
  avgLongViews: number;
  longCountFound: number;
  shortsList: VideoDetail[];
  longsList: VideoDetail[];
  liveList: VideoDetail[]; // 최근 라이브 스트림 목록
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
}

export interface VideoResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  topComments: CommentInfo[];
  duration: string;
  isShort: boolean;
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
}

export interface VideoDetail {
  id: string;
  title: string;
  thumbnail: string;
  publishedAt: string;
  viewCount: number;
  duration: string;
  isShort: boolean;
  isLiveStream?: boolean;
  concurrentViewers?: number; // 라이브 중일 때 현재 시청자 (Public API는 과거 Peak CCU를 제공하지 않으므로 라이브 상태일 때만 표시 가능)
}
