
export interface Creator {
  id: string;
  name: string;
  youtubeChannelIds: string[];   // UC... 코드 또는 채널 URL (여러 개 가능)
  liveMetricsIds: string[];      // chzzk:ID / soop:ID / 순수 ID (여러 개 가능)
  instagramUsername?: string;   // @ 없는 username
  tiktokUsername?: string;      // @ 없는 username
  memo?: string;
  affiliation?: '패러블' | '외부';  // 소속
  thumbnailUrl?: string;        // YouTube 첫 번째 채널 썸네일 (자동 수집)
}

export interface CommentInfo {
  author: string;
  text: string;
  likeCount: number;
  publishedAt: string;
}

export interface AdDetectionResult {
  is_ad: boolean;
  confidence: number;
  method: 'paid_flag' | 'nlp' | 'both' | 'none';
  evidence: string[]; // 최종 사용자에게 보여줄 간단한 요약 리스트
  score: number;
  // 상세 분석 데이터 (내부 로직용 및 확장용)
  paid_flag?: {
    paid_promotion: boolean | 'unknown';
    confidence: number;
    evidence: Array<{ source: string; path: string; key: string; value: string; note: string }>;
  };
  nlp?: {
    ad_disclosure: boolean | 'unknown';
    ad_type: 'paid_promotion' | 'sponsorship' | 'affiliate' | 'gifted' | 'self_promo' | 'unknown';
    confidence: number;
    matched_phrases: Array<{ phrase: string; weight: 'high' | 'mid' | 'low'; source: string }>;
    reasoning: string;
  };
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
  totalVideoCount: number;
  adRatio: number;
  totalViews: number;
  avgViews: number;
  avgAdViews: number;
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

// ── Instagram ─────────────────────────────────────────────────────────────────

export interface InstagramReel {
  username: string;
  media_pk: string;
  code: string | null;
  caption_text: string;
  taken_at: string;
  like_count: number;
  comment_count: number;
  view_count: number;
  thumbnail_url: string;
  url: string | null;
}

export interface InstagramUserResult {
  username: string;
  reelCount: number;
  avgViews: number;
  avgLikes: number;
  avgComments: number;
  scrapedAt: string;
  reels: InstagramReel[];
  error?: string;
}

export interface ReferenceVideo {
  videoId: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  thumbnail: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  duration: string;
  isShort: boolean;
  matchedIn: ('title' | 'description')[];  // 키워드가 매칭된 위치
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
