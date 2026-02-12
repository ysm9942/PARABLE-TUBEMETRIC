
export interface CommentInfo {
  author: string;
  text: string;
  likeCount: number;
  publishedAt: string;
}

export type SignalType = 'Direct' | 'Strong' | 'Soft';
export type DataSourceType = 'youtubei_player' | 'runtime_eval' | 'html_regex' | 'ui_rendered' | 'nlp_text';

// Define TabType for main application navigation tabs
export type TabType = 'channel-config' | 'video-config' | 'ad-config' | 'dashboard';

export interface DetectionSignal {
  type: SignalType;
  source: DataSourceType;
  path: string;
  key: string;
  note: string;
  confidence: number;
}

export interface AdDetectionResult {
  is_ad: boolean;
  confidence: number;
  method: 'paid_flag' | 'nlp' | 'both' | 'none';
  evidence: string[]; 
  score: number;
  signals: DetectionSignal[]; // 모든 수집된 신호의 상세 내역
  analysisSource: DataSourceType; // 주된 분석 출처
}

export interface AdVideoDetail extends VideoDetail {
  detection: AdDetectionResult;
  likeCount: number;
  commentCount: number;
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
  avgTotalViews: number;
  totalCountFound: number;
  shortsList: VideoDetail[];
  longsList: VideoDetail[];
  liveList: VideoDetail[];
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
}

export interface AdAnalysisResult {
  channelId: string;
  channelName: string;
  thumbnail: string;
  adVideos: AdVideoDetail[];
  totalAdCount: number;
  totalViews: number;
  avgViews: number;
  avgLikes: number;
  avgComments: number;
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
  concurrentViewers?: number;
}
