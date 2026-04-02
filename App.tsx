
import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Download,
  Trash2,
  List,
  Youtube,
  Loader2,
  LayoutDashboard,
  ExternalLink,
  Calendar,
  TrendingUp,
  Video,
  MonitorPlay,
  X,
  Eye,
  FileSpreadsheet,
  Users,
  Radio,
  Settings2,
  ChevronRight,
  BarChart3,
  Lock,
  CheckCircle2,
  Circle,
  ToggleLeft,
  ToggleRight,
  MessageSquare,
  ThumbsUp,
  Activity,
  Megaphone,
  CalendarDays,
  AlertCircle,
  ShieldCheck,
  HelpCircle,
  Info,
  Plus,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  Instagram,
  Tv2,
  Camera,
  History,
  Music,
  Package2,
  Terminal,
  Shield,
  Wifi,
  WifiOff,
  Filter,
  RefreshCw,
  BookUser,
  Pencil,
  Save,
  Clipboard,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { getChannelInfo, fetchChannelStats, fetchVideosByIds, AnalysisPeriod, analyzeAdVideos } from './services/youtubeService';
import { ChannelResult, VideoResult, VideoDetail, CommentInfo, AdAnalysisResult, InstagramUserResult, Creator } from './types';
import { submitScrapeRequest, checkQueueStatus, getAllChannelResults, submitInstagramRequest, checkInstagramQueueStatus, getAllInstagramResults } from './services/githubResultsService';
import { isBackendAvailable, scrapeChannel as backendScrapeChannel, scrapeVideos as backendScrapeVideos, detectAds as backendDetectAds, fetchTikTokVideos as backendFetchTikTok, fetchTikTokVideosLocal, TikTokUserResult, fetchLiveStreams, fetchSoftcStreams, fetchInstagramReelsLocal, LiveCreatorResult } from './services/backendApiService';
import { checkLocalAgent, waitForLocalAgent, checkSoftcAgent, waitForSoftcAgent, checkInstagramAgent, waitForInstagramAgent, checkInstagramAgentTikTokSupport, detectOS, ALL_INSTALLER_URLS, INSTALLER_URLS, LOCAL_AGENT_URL, SOFTC_AGENT_URL, INSTAGRAM_AGENT_URL, SOFTC_INSTALLER_URLS, INSTAGRAM_INSTALLER_URLS } from './services/localAgentService';
import { addSystemLog, subscribeSystemLogs, SystemLogEntry, isConfigured as isFirebaseConfigured, saveCreator as fbSaveCreator, deleteCreatorById as fbDeleteCreator, subscribeCreators } from './services/firebaseService';

type TabType = 'channel-config' | 'video-config' | 'ad-config' | 'dashboard' | 'live-config' | 'instagram-config' | 'tiktok-config' | 'install' | 'system-log' | 'creator';
type ResultTab = 'table' | 'chart' | 'raw';

const App: React.FC = () => {
  const [isAuthorized, setIsAuthorized] = useState<boolean>(
    () => localStorage.getItem('tubemetric-auth') === '1',
  );
  const [pinInput, setPinInput] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabType>('channel-config');

  // 로컬 에이전트 상태 (port 8001)
  const [localAgentRunning, setLocalAgentRunning] = useState<boolean>(false);
  const [showInstallModal, setShowInstallModal] = useState<boolean>(false);
  const [waitingForAgent, setWaitingForAgent] = useState<boolean>(false);

  // SoftC 로컬 에이전트 상태 (port 8002)
  const [softcLocalRunning, setSoftcLocalRunning] = useState<boolean>(false);
  const [showSoftcInstallModal, setShowSoftcInstallModal] = useState<boolean>(false);
  const [waitingForSoftcAgent, setWaitingForSoftcAgent] = useState<boolean>(false);
  const [showSoftcGuide, setShowSoftcGuide] = useState<boolean>(false);

  // Instagram 로컬 에이전트 상태 (port 8003)
  const [igLocalRunning, setIgLocalRunning] = useState<boolean>(false);
  const [showInstagramInstallModal, setShowInstagramInstallModal] = useState<boolean>(false);
  const [waitingForInstagramAgent, setWaitingForInstagramAgent] = useState<boolean>(false);

  // TikTok 설치 모달 (같은 에이전트지만 별도 모달)
  const [showTikTokInstallModal, setShowTikTokInstallModal] = useState<boolean>(false);
  const [waitingForTikTokInstall, setWaitingForTikTokInstall] = useState<boolean>(false);

  // TikTok: 같은 에이전트(8003)지만 v1.1+ 필요
  const [tkAgentReady, setTkAgentReady] = useState<boolean>(false);
  const [tkHeadless, setTkHeadless] = useState<boolean>(false); // TikTok은 headless OFF가 기본 (봇 감지 우회)

  // ── 플랫폼 URL → softc 형식 변환 ────────────────────────────────────────────
  const parseLiveUrl = (raw: string): string => {
    const v = raw.trim().replace(/^@/, '');
    const chzzk = v.match(/chzzk\.naver\.com\/([a-zA-Z0-9]+)/);
    if (chzzk) return `chzzk:${chzzk[1]}`;
    const soop = v.match(/sooplive\.com\/station\/([^/?#\s]+)/);
    if (soop) return `soop:${soop[1]}`;
    const afreeca = v.match(/afreecatv\.com\/([^/?#\s]+)/);
    if (afreeca) return `soop:${afreeca[1]}`;
    return v;
  };

  // ── Creator 상태 ─────────────────────────────────────────────────────────────
  const [creators, setCreators] = useState<Creator[]>(() => {
    try { return JSON.parse(localStorage.getItem('tubemetric-creators') ?? '[]'); } catch { return []; }
  });
  const [creatorForm, setCreatorForm] = useState<Partial<Creator> | null>(null);
  // 폼 내 배열 필드용 draft
  const [creatorYtDraft,   setCreatorYtDraft]   = useState('');
  const [creatorLiveDraft, setCreatorLiveDraft] = useState('');

  // Firebase 실시간 구독
  useEffect(() => {
    const unsub = subscribeCreators(setCreators);
    return unsub;
  }, []);

  const openCreatorForm = (c?: Creator) => {
    setCreatorForm(c ? { ...c } : { youtubeChannelIds: [], liveMetricsIds: [] });
    setCreatorYtDraft('');
    setCreatorLiveDraft('');
  };

  const deleteCreator = (id: string) => {
    if (confirm('삭제할까요?')) {
      fbDeleteCreator(id);
      setCreators(prev => prev.filter(c => c.id !== id));
    }
  };

  // Instagram/TikTok URL or @handle → plain username
  const parseIgUsername = (raw: string): string => {
    const s = raw.trim();
    const m = s.match(/instagram\.com\/([^/?#\s@]+)/);
    if (m) return m[1].replace(/\/$/, '');
    return s.replace(/^@/, '').split('/')[0].trim();
  };
  const parseTkUsername = (raw: string): string => {
    const s = raw.trim();
    const m = s.match(/tiktok\.com\/@([^/?#\s]+)/);
    if (m) return m[1].replace(/\/$/, '');
    return s.replace(/^@/, '').split('/')[0].trim();
  };

  const upsertCreator = async (c: Partial<Creator>) => {
    const trimmed: Creator = {
      id:  c.id ?? crypto.randomUUID(),
      name: (c.name ?? '').trim(),
      youtubeChannelIds: (c.youtubeChannelIds ?? []).map(s => s.trim()).filter(Boolean),
      liveMetricsIds:    (c.liveMetricsIds    ?? []).map(s => parseLiveUrl(s)).filter(Boolean),
      instagramUsername: c.instagramUsername ? parseIgUsername(c.instagramUsername) || undefined : undefined,
      tiktokUsername:    c.tiktokUsername    ? parseTkUsername(c.tiktokUsername)    || undefined : undefined,
      memo:              (c.memo ?? '').trim() || undefined,
      thumbnailUrl:      c.thumbnailUrl || undefined,
    };
    if (!trimmed.name) return;
    // YouTube 첫 번째 채널 썸네일 자동 수집 (API 키 없으면 스킵)
    if (trimmed.youtubeChannelIds.length > 0 && !trimmed.thumbnailUrl) {
      try {
        const info = await getChannelInfo(trimmed.youtubeChannelIds[0]);
        if (info?.thumbnail) trimmed.thumbnailUrl = info.thumbnail;
      } catch { /* API 키 없거나 실패 시 무시 */ }
    }
    // Firebase write 성공 여부와 무관하게 로컬 state 즉시 갱신
    setCreators(prev => {
      const idx = prev.findIndex(x => x.id === trimmed.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = trimmed; return next; }
      return [...prev, trimmed];
    });
    fbSaveCreator(trimmed);
    setCreatorForm(null);
  };

  // ── System Log 상태 ──────────────────────────────────────────────────────────
  const [sysLogAuthed] = useState<boolean>(true);
  const [sysLogs, setSysLogs] = useState<SystemLogEntry[]>([]);
  const [sysLogFilter, setSysLogFilter] = useState<'all' | 'connection' | 'analysis' | 'error' | 'system'>('all');
  const sysLogUnsubRef = useRef<(() => void) | null>(null);

  // ── 전역 에러 캐치 ───────────────────────────────────────────────────────────
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      addSystemLog('error', 'error', `[전역 오류] ${e.message}`, {
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
      });
    };
    const onUnhandled = (e: PromiseRejectionEvent) => {
      const msg = e.reason?.message ?? String(e.reason);
      addSystemLog('error', 'error', `[미처리 Promise 오류] ${msg}`, {
        reason: String(e.reason),
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandled);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandled);
    };
  }, []);

  // 앱 시작 시 로컬 에이전트 감지
  useEffect(() => {
    const agents: string[] = [];
    Promise.all([
      checkLocalAgent().then(ok => { setLocalAgentRunning(ok); if (ok) agents.push('tubemetric-agent:8001'); }),
      checkSoftcAgent().then(ok => { setSoftcLocalRunning(ok); if (ok) agents.push('softc-scraper:8002'); }),
      checkInstagramAgent().then(ok => { setIgLocalRunning(ok); if (ok) agents.push('instagram-scraper:8003'); }),
      checkInstagramAgentTikTokSupport().then(ok => setTkAgentReady(ok)),
    ]).then(() => {
      if (agents.length > 0) {
        addSystemLog('info', 'connection', `로컬 에이전트 접속: ${agents.join(', ')}`, {
          agents,
          os: navigator.platform,
        });
      } else {
        addSystemLog('info', 'connection', '로컬 에이전트 없음 (오프라인 모드)', { os: navigator.platform });
      }
    });
  }, []);
  const [dashboardSubTab, setDashboardSubTab] = useState<'channel' | 'video' | 'ad' | 'scraper'>('channel');
  
  // Explanation Help
  const [showHelp, setShowHelp] = useState<boolean>(false);

  // Consolidated Analysis Period
  const [useDateFilter, setUseDateFilter] = useState<boolean>(false);
  const [period, setPeriod] = useState<AnalysisPeriod>('all');

  // Individual Collection Targets
  const [useShorts, setUseShorts] = useState<boolean>(true);
  const [targetShorts, setTargetShorts] = useState<number | string>(30);

  const [useLongs, setUseLongs] = useState<boolean>(false);
  const [targetLong, setTargetLong] = useState<number | string>(10);

  // Consolidated Count Filter
  const [useGlobalCountFilter, setUseGlobalCountFilter] = useState<boolean>(true);
  
  // Channel Analysis States
  const [channelInput, setChannelInput] = useState<string>('');
  const [channelResults, setChannelResults] = useState<ChannelResult[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<ChannelResult | null>(null);
  
  // Ad Analysis States
  const [adChannelInput, setAdChannelInput] = useState<string>('');
  const [adStartDate, setAdStartDate] = useState<string>(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const [adEndDate, setAdEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [adResults, setAdResults] = useState<AdAnalysisResult[]>([]);
  const [selectedAdResult, setSelectedAdResult] = useState<AdAnalysisResult | null>(null);

  // Individual Video States
  const [videoInput, setVideoInput] = useState<string>('');
  const [videoResults, setVideoResults] = useState<VideoResult[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<VideoResult | null>(null);

  // 로컬 스크래퍼 Queue 상태
  const [scraperHandles, setScraperHandles] = useState<string>('');
  const [scraperJobId, setScraperJobId]     = useState<string | null>(null);
  const [scraperJobStatus, setScraperJobStatus] = useState<'idle' | 'submitting' | 'pending' | 'done' | 'error'>('idle');
  const [scraperResults, setScraperResults] = useState<ChannelResult[]>([]);
  const [scraperResultsLoading, setScraperResultsLoading] = useState(false);

  // Instagram Queue 상태
  const [igDraft, setIgDraft] = useState<string>('');
  const [igInput, setIgInput] = useState<string>('');
  const [igAmount, setIgAmount] = useState<number>(10);
  const [igHeadless, setIgHeadless] = useState<boolean>(true);
  const [igJobId, setIgJobId] = useState<string | null>(null);
  const [igJobStatus, setIgJobStatus] = useState<'idle' | 'submitting' | 'pending' | 'done' | 'error'>('idle');
  const [igResults, setIgResults] = useState<InstagramUserResult[]>([]);
  const [igResultsLoading, setIgResultsLoading] = useState(false);
  const [selectedIgUser, setSelectedIgUser] = useState<InstagramUserResult | null>(null);

  // TikTok 상태
  const [tkDraft, setTkDraft] = useState<string>('');
  const [tkInput, setTkInput] = useState<string>('');
  const [tkAmount, setTkAmount] = useState<number>(10);
  const [tkJobStatus, setTkJobStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [tkResults, setTkResults] = useState<TikTokUserResult[]>([]);
  const [tkResultsLoading, setTkResultsLoading] = useState(false);
  const [selectedTkUser, setSelectedTkUser] = useState<TikTokUserResult | null>(null);

  // 라이브 지표 상태
  const [liveMode] = useState<'local'>('local');
  const [liveDraft, setLiveDraft] = useState<string>('');
  const [liveInput, setLiveInput] = useState<string>('');
  const [livePlatform, setLivePlatform] = useState<'chzzk' | 'soop'>('chzzk');
  const [liveStartDate, setLiveStartDate] = useState<string>(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const [liveEndDate, setLiveEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [liveJobStatus, setLiveJobStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [liveErrorMsg, setLiveErrorMsg] = useState<string>('');
  const [liveResults, setLiveResults] = useState<LiveCreatorResult[]>([]);
  const [selectedLiveCreator, setSelectedLiveCreator] = useState<LiveCreatorResult | null>(null);

  // 스크래퍼 날짜 필터
  const [scraperUseDateFilter, setScraperUseDateFilter] = useState<boolean>(false);
  const [scraperStartDate, setScraperStartDate] = useState<string>(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const [scraperEndDate, setScraperEndDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Ad date filter
  const [adUseDateFilter, setAdUseDateFilter] = useState<boolean>(false);
  const [adPeriod, setAdPeriod] = useState<AnalysisPeriod>('all');

  // ── UI-only states ────────────────────────────────────────────────────────
  const [channelDraft, setChannelDraft] = useState<string>('');
  const [videoDraft, setVideoDraft] = useState<string>('');
  const [adDraft, setAdDraft] = useState<string>('');
  const [showChannelResults, setShowChannelResults] = useState<boolean>(false);
  const [channelResultTab, setChannelResultTab] = useState<ResultTab>('table');
  const [showVideoResults, setShowVideoResults] = useState<boolean>(false);
  const [videoResultTab, setVideoResultTab] = useState<ResultTab>('table');
  const [showAdResults, setShowAdResults] = useState<boolean>(false);
  const [adResultTab, setAdResultTab] = useState<ResultTab>('table');

  // ── Derived ──────────────────────────────────────────────────────────────
  const channelList = channelInput.split('\n').map(s => s.trim()).filter(Boolean);
  const videoList = videoInput.split('\n').map(s => s.trim()).filter(Boolean);
  const adList = adChannelInput.split('\n').map(s => s.trim()).filter(Boolean);
  const igList = igInput.split('\n').map(s => s.trim()).filter(Boolean);

  const channelTotal = channelResults.length;
  const channelDone = channelResults.filter(r => r.status === 'completed' || r.status === 'error').length;
  const channelProgress = channelTotal > 0 ? Math.round((channelDone / channelTotal) * 100) : 0;
  const channelCurrentItem = channelResults.find(r => r.status === 'processing');

  const videoTotal = videoResults.length;
  const videoDone = videoResults.filter(v => v.status !== 'processing').length;
  const videoProgress = videoTotal > 0 ? Math.round((videoDone / videoTotal) * 100) : 0;

  const adTotal = adResults.length;
  const adDone = adResults.filter(r => r.status === 'completed' || r.status === 'error').length;
  const adProgress = adTotal > 0 ? Math.round((adDone / adTotal) * 100) : 0;
  const adCurrentItem = adResults.find(r => r.status === 'processing');

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput === '5350') {
      setIsAuthorized(true);
      localStorage.setItem('tubemetric-auth', '1');
    } else {
      alert('PIN 번호가 일치하지 않습니다.');
      setPinInput('');
    }
  };

  const formatNumber = (num: number | string) => {
    const n = typeof num === 'string' ? parseInt(num, 10) : num;
    if (isNaN(n)) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
  };

  const extractVideoId = (input: string): string => {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = input.match(regex);
    return match ? match[1] : input.trim();
  };

  const parseNumberInput = (value: number | string, defaultValue = 1): number => {
    if (typeof value === 'number') return value;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  };

  const getDateRange = (p: AnalysisPeriod): [string, string] => {
    const end = new Date();
    let start = new Date();
    if (p === '7d') start.setDate(end.getDate() - 7);
    else if (p === '30d') start.setDate(end.getDate() - 30);
    else if (p === '90d') start.setDate(end.getDate() - 90);
    else if (p === 'all') start = new Date('2005-01-01');
    return [start.toISOString().split('T')[0], end.toISOString().split('T')[0]];
  };

  // ── List input helpers ───────────────────────────────────────────────────
  const addChannelItem = () => {
    const v = channelDraft.trim();
    if (!v) return;
    setChannelInput(prev => prev ? prev + '\n' + v : v);
    setChannelDraft('');
  };
  const removeChannelItem = (idx: number) => setChannelInput(channelList.filter((_, i) => i !== idx).join('\n'));
  const clearChannelList = () => setChannelInput('');

  const addVideoItem = () => {
    const v = videoDraft.trim();
    if (!v) return;
    setVideoInput(prev => prev ? prev + '\n' + v : v);
    setVideoDraft('');
  };
  const removeVideoItem = (idx: number) => setVideoInput(videoList.filter((_, i) => i !== idx).join('\n'));

  const addAdItem = () => {
    const v = adDraft.trim();
    if (!v) return;
    setAdChannelInput(prev => prev ? prev + '\n' + v : v);
    setAdDraft('');
  };
  const removeAdItem = (idx: number) => setAdChannelInput(adList.filter((_, i) => i !== idx).join('\n'));
  const clearAdList = () => setAdChannelInput('');

  const handleChannelStart = async () => {
    const inputs = channelInput
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (inputs.length === 0) {
      alert('분석할 채널 URL 또는 UC 코드를 입력해주세요.');
      return;
    }

    // 개수 필터가 켜져 있을 때만 유형 선택을 확인
    if (useGlobalCountFilter && !useShorts && !useLongs) {
      alert('분석할 영상 유형(쇼츠 또는 롱폼)을 최소 하나 이상 선택해주세요.');
      return;
    }

    const shortsVal = parseNumberInput(targetShorts);
    const longsVal = parseNumberInput(targetLong);

    setIsProcessing(true);
    setShowChannelResults(true);
    setChannelResultTab('table');
    setDashboardSubTab('channel');

    const initialResults: ChannelResult[] = inputs.map((input) => ({
      channelId: input,
      channelName: '데이터 수집 중...',
      thumbnail: '',
      subscriberCount: '0',
      avgShortsViews: 0,
      shortsCountFound: 0,
      avgLongViews: 0,
      longCountFound: 0,
      avgTotalViews: 0,
      totalCountFound: 0,
      shortsList: [],
      longsList: [],
      liveList: [],
      status: 'pending',
    }));
    
    setChannelResults(initialResults);

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      setChannelResults(prev => { const next = [...prev]; next[i] = { ...next[i], status: 'processing' }; return next; });
      try {
        const info = await getChannelInfo(input);
        const stats = await fetchChannelStats(
          info.uploadsPlaylistId,
          {
            target: shortsVal,
            period: period,
            useDateFilter: useDateFilter,
            useCountFilter: useGlobalCountFilter,
            // 개수 필터가 꺼지면(DISABLED) 숏폼/롱폼 가리지 않고 전체 분석을 위해 강제 true
            enabled: useGlobalCountFilter ? useShorts : true
          },
          {
            target: longsVal,
            period: period,
            useDateFilter: useDateFilter,
            useCountFilter: useGlobalCountFilter,
            // 개수 필터가 꺼지면(DISABLED) 숏폼/롱폼 가리지 않고 전체 분석을 위해 강제 true
            enabled: useGlobalCountFilter ? useLongs : true
          }
        );
        setChannelResults(prev => {
          const next = [...prev];
          next[i] = {
            ...next[i],
            channelId: info.id,
            channelName: info.title,
            thumbnail: info.thumbnail,
            subscriberCount: info.subscriberCount,
            avgShortsViews: stats.avgShortsViews,
            shortsCountFound: stats.shortsCount,
            avgLongViews: stats.avgLongViews,
            longCountFound: stats.longCount,
            avgTotalViews: stats.avgTotalViews,
            totalCountFound: stats.totalCount,
            shortsList: stats.shortsList,
            longsList: stats.longsList,
            liveList: stats.liveList,
            status: 'completed'
          };
          return next;
        });
      } catch (err: any) {
        const msg = err.message || '데이터를 가져오지 못했습니다.';
        console.error('Channel analysis error:', err);
        addSystemLog('error', 'error', `채널 분석 오류: ${msg}`, { channelId: inputs[i] });
        setChannelResults(prev => { const next = [...prev]; next[i] = { ...next[i], status: 'error', error: msg }; return next; });
      }
    }
    setIsProcessing(false);
  };

  // ── 로컬 스크래퍼 Queue 핸들러 ──────────────────────────────────────────────

  const setScraperDatesByPeriod = (p: AnalysisPeriod) => {
    const [start, end] = getDateRange(p);
    setScraperStartDate(start);
    setScraperEndDate(end);
  };

  const handleScraperRequest = async () => {
    const handles = scraperHandles.split('\n').map(h => h.trim()).filter(Boolean);
    if (!handles.length) {
      alert('스크래핑할 채널 핸들을 입력하세요. 예: @채널핸들');
      return;
    }
    setScraperJobStatus('submitting');

    // 백엔드 API 우선 사용 (yt-dlp 기반, 브라우저 불필요)
    if (isBackendAvailable()) {
      try {
        const results: ChannelResult[] = [];
        for (const handle of handles) {
          const result = await backendScrapeChannel(handle, {
            shortsTarget: Number(targetShorts) || 30,
            longsTarget: Number(targetLong) || 10,
            useDateFilter: scraperUseDateFilter,
            period: period,
          });
          results.push(result as ChannelResult);
        }
        setScraperResults(results);
        setScraperJobStatus('done');
        setActiveTab('dashboard');
        setDashboardSubTab('scraper');
        return;
      } catch (e: any) {
        console.error('Backend API 오류, GitHub 큐로 폴백:', e.message);
        addSystemLog('warn', 'error', `스크래퍼 Backend API 오류 (큐 폴백): ${e.message}`);
      }
    }

    // 폴백: GitHub 큐 방식 (로컬 서버 필요)
    const opts: { headless: boolean; scrolls: number; start?: string; end?: string } = { headless: true, scrolls: 10 };
    if (scraperUseDateFilter) {
      opts.start = scraperStartDate;
      opts.end   = scraperEndDate;
    }
    const result = await submitScrapeRequest(handles, 'channel', opts);
    if (!result) {
      setScraperJobStatus('error');
      return;
    }
    setScraperJobId(result.requestId);
    setScraperJobStatus('pending');
  };

  const loadScraperResults = async () => {
    setScraperResultsLoading(true);
    const results = await getAllChannelResults();
    setScraperResults((results as ChannelResult[]).filter(Boolean));
    setScraperResultsLoading(false);
  };

  // 큐 파일 폴링: pending → done 감지
  useEffect(() => {
    if (!scraperJobId) return;
    let isActive = true;
    const interval = setInterval(async () => {
      if (!isActive) return;
      const status = await checkQueueStatus(scraperJobId);
      if (status === 'done' && isActive) {
        setScraperJobStatus('done');
        await loadScraperResults();
        setActiveTab('dashboard');
        setDashboardSubTab('scraper');
      } else if (status === 'error' && isActive) {
        setScraperJobStatus('error');
      }
    }, 10000);
    return () => { isActive = false; clearInterval(interval); };
  }, [scraperJobId]);

  // 스크래퍼 대시보드 탭 진입 시 결과 로드
  useEffect(() => {
    if (activeTab === 'dashboard' && dashboardSubTab === 'scraper' && scraperResults.length === 0) {
      loadScraperResults();
    }
  }, [activeTab, dashboardSubTab, scraperResults.length]);

  // ── Instagram 핸들러 ────────────────────────────────────────────────────────
  const addIgItem = () => {
    let v = igDraft.trim();
    // Instagram URL에서 username 추출 (예: https://www.instagram.com/haebom_m)
    const urlMatch = v.match(/instagram\.com\/([^/?#\s]+)/);
    if (urlMatch) v = urlMatch[1];
    v = v.replace(/^@/, '').replace(/\/$/, '');
    if (!v) return;
    setIgInput(prev => prev ? prev + '\n' + v : v);
    setIgDraft('');
  };
  const removeIgItem = (idx: number) => setIgInput(igList.filter((_, i) => i !== idx).join('\n'));
  const clearIgList = () => setIgInput('');

  const handleIgRequest = async () => {
    if (!igList.length) {
      alert('수집할 Instagram 계정을 입력하세요.');
      return;
    }

    // ── 로컬 에이전트(port 8003) 직접 호출 — softc_server.py와 동일한 패턴 ──
    if (igLocalRunning) {
      setIgJobStatus('submitting');
      try {
        const results = await fetchInstagramReelsLocal(igList, igAmount, INSTAGRAM_AGENT_URL, igHeadless);
        setIgResults(results);
        setIgJobStatus('done');
        addSystemLog('info', 'analysis', `Instagram 수집 완료: ${results.length}명`);
      } catch (e: any) {
        console.error('Instagram 로컬 에이전트 오류:', e);
        addSystemLog('error', 'error', `Instagram 수집 오류: ${e?.message ?? String(e)}`);
        setIgJobStatus('error');
      }
      return;
    }

    // ── 폴백: GitHub 큐 방식 ─────────────────────────────────────────────
    setIgJobStatus('submitting');
    const result = await submitInstagramRequest(igList, igAmount);
    if (!result) {
      setIgJobStatus('error');
      return;
    }
    setIgJobId(result.requestId);
    setIgJobStatus('pending');
  };

  const loadIgResults = async () => {
    setIgResultsLoading(true);
    const results = await getAllInstagramResults();
    setIgResults(results);
    setIgResultsLoading(false);
  };

  // Instagram 큐 폴링
  useEffect(() => {
    if (!igJobId) return;
    let isActive = true;
    const interval = setInterval(async () => {
      if (!isActive) return;
      const status = await checkInstagramQueueStatus(igJobId);
      if (status === 'done' && isActive) {
        setIgJobStatus('done');
        await loadIgResults();
      } else if (status === 'error' && isActive) {
        setIgJobStatus('error');
      }
    }, 10000);
    return () => { isActive = false; clearInterval(interval); };
  }, [igJobId]);

  // ── TikTok 핸들러 ────────────────────────────────────────────────────────
  const tkList = tkInput.split('\n').map(s => s.trim()).filter(Boolean);
  const addTkItem = () => {
    let v = tkDraft.trim();
    // TikTok URL 전체 입력 지원: https://www.tiktok.com/@haebom_ → haebom_
    const urlMatch = v.match(/tiktok\.com\/@?([^/?#\s]+)/);
    if (urlMatch) v = urlMatch[1];
    v = v.replace(/^@/, '');
    if (!v) return;
    setTkInput(prev => prev ? prev + '\n' + v : v);
    setTkDraft('');
  };
  const removeTkItem = (idx: number) => setTkInput(tkList.filter((_, i) => i !== idx).join('\n'));
  const clearTkList = () => setTkInput('');

  const handleTkRequest = async () => {
    if (!tkList.length) {
      alert('수집할 TikTok 계정을 입력하세요.');
      return;
    }

    if (!tkAgentReady) {
      alert(igLocalRunning
        ? '에이전트 업데이트가 필요합니다. 로컬 에이전트를 최신 버전으로 재설치하세요.'
        : 'TikTok 수집은 로컬 에이전트가 필요합니다. 에이전트를 설치하세요.');
      return;
    }

    setTkJobStatus('submitting');
    try {
      const results = await fetchTikTokVideosLocal(tkList, tkAmount, INSTAGRAM_AGENT_URL, tkHeadless);
      setTkResults(results);
      setTkJobStatus('done');
      addSystemLog('info', 'analysis', `TikTok 수집 완료: ${results.length}명`);
    } catch (e: any) {
      console.error('TikTok 로컬 에이전트 오류:', e.message);
      addSystemLog('error', 'error', `TikTok 수집 오류: ${e?.message ?? String(e)}`);
      setTkJobStatus('error');
    }
  };

  // ── 라이브 지표 핸들러 ────────────────────────────────────────────────────
  const liveList = liveInput.split('\n').map(s => s.trim()).filter(Boolean);

  const addLiveItem = () => {
    const v = parseLiveUrl(liveDraft);
    if (!v) return;
    setLiveInput(prev => prev ? prev + '\n' + v : v);
    setLiveDraft('');
  };
  const removeLiveItem = (idx: number) => setLiveInput(liveList.filter((_, i) => i !== idx).join('\n'));
  const clearLiveList = () => setLiveInput('');

  const handleLiveRequest = async () => {
    if (!liveList.length) {
      alert('수집할 크리에이터 ID를 입력하세요.');
      return;
    }
    if (!isBackendAvailable()) {
      alert('라이브 지표 수집은 클라우드 백엔드가 필요합니다.');
      return;
    }
    setLiveJobStatus('submitting');
    setLiveErrorMsg('');
    try {
      const creators = liveList.map(id => {
        if (id.includes(':')) {
          const [plat, cid] = id.split(':', 2);
          return { platform: plat.trim().toLowerCase(), creatorId: cid.trim() };
        }
        return { platform: livePlatform, creatorId: id };
      });

      let results: LiveCreatorResult[];

      // 우선순위: SoftC(8002) > tubemetric-agent(8001) > 에러
      if (softcLocalRunning) {
        // SoftC: headless=False · undetected_chromedriver (bot 감지 우회 최강)
        results = await fetchSoftcStreams(creators, liveStartDate, liveEndDate, [], SOFTC_AGENT_URL);
      } else if (localAgentRunning) {
        // tubemetric-agent: Playwright + 설치된 Chrome (all-in-one 인스톨러 포함)
        results = await fetchLiveStreams(creators, liveStartDate, liveEndDate, [], LOCAL_AGENT_URL);
      } else {
        setLiveErrorMsg('로컬 에이전트가 실행 중이지 않습니다. 로컬 에이전트 설치 탭에서 설치 후 다시 시도하세요.');
        setLiveJobStatus('error');
        return;
      }

      setLiveResults(results);
      addSystemLog('info', 'analysis', `라이브 지표 수집 완료: ${results.length}명`, {
        total: results.length,
        agent: softcLocalRunning ? 'softc:8002' : 'tubemetric-agent:8001',
      });
      setLiveResults(results);
      const errors = results.filter((r: any) => r.status === 'error');
      if (errors.length > 0 && errors.length === results.length) {
        const msg = errors.map((r: any) => `${r.creatorId}: ${r.error}`).join('; ');
        addSystemLog('error', 'error', `라이브 지표 전체 실패: ${msg}`);
        setLiveErrorMsg(msg);
        setLiveJobStatus('error');
      } else {
        setLiveJobStatus('done');
      }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || String(e);
      console.error('라이브 지표 오류:', msg);
      addSystemLog('error', 'error', `라이브 지표 수집 오류: ${msg}`);
      setLiveErrorMsg(msg);
      setLiveJobStatus('error');
    }
  };

  const handleAdStart = async () => {
    const inputs = adChannelInput.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    if (inputs.length === 0) {
      alert('분석할 채널을 입력해주세요.');
      return;
    }

    setIsProcessing(true);
    setShowAdResults(true);
    setAdResultTab('table');
    setDashboardSubTab('ad');

    const [computedStart, computedEnd] = adUseDateFilter ? getDateRange(adPeriod) : ['2005-01-01', new Date().toISOString().split('T')[0]];

    setAdResults(inputs.map(input => ({
      channelId: input, channelName: '광고 판별 중...', thumbnail: '', adVideos: [],
      totalAdCount: 0, totalVideoCount: 0, adRatio: 0,
      totalViews: 0, avgViews: 0, avgAdViews: 0, avgLikes: 0, avgComments: 0, status: 'pending'
    })));

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      setAdResults(prev => { const next = [...prev]; next[i] = { ...next[i], status: 'processing' }; return next; });
      try {
        const info = await getChannelInfo(input);
        const ads = await analyzeAdVideos(info.uploadsPlaylistId, new Date(computedStart), new Date(computedEnd));
        const { totalViews, totalLikes, totalComments } = ads.reduce(
          (acc, v) => ({ totalViews: acc.totalViews + v.viewCount, totalLikes: acc.totalLikes + v.likeCount, totalComments: acc.totalComments + v.commentCount }),
          { totalViews: 0, totalLikes: 0, totalComments: 0 }
        );
        const totalVideoCount = parseInt(info.videoCount ?? '0', 10) || ads.length;
        const adRatio = totalVideoCount > 0 ? Math.round((ads.length / totalVideoCount) * 1000) / 10 : 0;
        const avgAdViews = ads.length ? Math.round(totalViews / ads.length) : 0;
        setAdResults(prev => {
          const next = [...prev];
          next[i] = {
            ...next[i], channelId: info.id, channelName: info.title, thumbnail: info.thumbnail, adVideos: ads,
            totalAdCount: ads.length, totalVideoCount, adRatio, totalViews, avgAdViews,
            avgViews: avgAdViews,
            avgLikes: ads.length ? Math.round(totalLikes / ads.length) : 0,
            avgComments: ads.length ? Math.round(totalComments / ads.length) : 0,
            status: 'completed'
          };
          return next;
        });
      } catch (err: any) {
        addSystemLog('error', 'error', `광고 분석 오류: ${err.message}`, { channelId: inputs[i] });
        setAdResults(prev => { const next = [...prev]; next[i] = { ...next[i], status: 'error', error: err.message }; return next; });
      }
    }
    setIsProcessing(false);
  };

  const handleVideoStart = async () => {
    const lines = videoInput.split('\n').filter(l => l.trim().length > 0);
    const videoIds: string[] = Array.from(new Set<string>(lines.map(extractVideoId))).filter(id => id.length === 11);

    if (videoIds.length === 0) {
      alert('분석할 올바른 형식의 영상 ID 또는 URL을 입력해주세요.');
      return;
    }

    setIsProcessing(true);
    setShowVideoResults(true);
    setVideoResultTab('table');
    setDashboardSubTab('video');
    setVideoResults(videoIds.map(id => ({
      videoId: id, title: '로딩 중...', channelTitle: '', thumbnail: '', viewCount: 0, likeCount: 0, commentCount: 0, topComments: [], duration: '', isShort: false, status: 'processing'
    })));

    try {
      const chunkSize = 10;
      for (let i = 0; i < videoIds.length; i += chunkSize) {
        const chunk = videoIds.slice(i, i + chunkSize);
        const fetched = await fetchVideosByIds(chunk);
        
        const fetchedMap = new Map(fetched.map(f => [f.videoId, f]));
        setVideoResults(prev => prev.map(p => {
          const match = fetchedMap.get(p.videoId);
          return match ?? (p.status === 'processing' ? { ...p, status: 'error', error: '정보 없음' } : p);
        }));
      }
    } catch (err: any) {
      console.error('Video analysis error:', err);
      addSystemLog('error', 'error', `영상 분석 오류: ${err.message}`);
      alert(`영상 분석 중 오류: ${err.message}`);
    }
    setIsProcessing(false);
  };

  const handleDownloadExcel = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const wb = XLSX.utils.book_new();

    if (dashboardSubTab === 'channel') {
      const summaryData = channelResults.map((r) => ({
        '채널 링크': `https://www.youtube.com/channel/${r.channelId}`,
        '채널명': r.channelName,
        '채널 ID': r.channelId,
        '구독자 수': parseInt(r.subscriberCount, 10),
        '통합 평균 조회수': r.avgTotalViews,
        '쇼츠 평균 조회수': r.avgShortsViews,
        '쇼츠 분석 개수': r.shortsCountFound,
        '롱폼 평균 조회수': r.avgLongViews,
        '롱폼 분석 개수': r.longCountFound,
        '상태': r.status === 'completed' ? '완료' : r.status === 'error' ? `오류: ${r.error}` : '대기',
      }));
      const wsSummary = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, wsSummary, '채널 요약');

      channelResults.forEach((r) => {
        if (r.status === 'completed') {
          const videoData = [...r.shortsList, ...r.longsList].map(v => ({
            '영상 링크': v.isShort ? `https://youtube.com/shorts/${v.id}` : `https://youtu.be/${v.id}`,
            '영상 제목': v.title,
            '영상 ID': v.id,
            '유형': v.isShort ? '쇼츠' : '롱폼',
            '조회수': v.viewCount,
            '게시일': new Date(v.publishedAt).toLocaleDateString()
          }));

          if (videoData.length > 0) {
            const wsChannel = XLSX.utils.json_to_sheet(videoData);
            let sheetName = r.channelName.replace(/[\\/*?:[\]]/g, '').substring(0, 31);
            if (wb.SheetNames.includes(sheetName)) {
              sheetName = (r.channelName.substring(0, 20) + '_' + r.channelId.substring(0, 5)).replace(/[\\/*?:[\]]/g, '');
            }
            XLSX.utils.book_append_sheet(wb, wsChannel, sheetName || r.channelId);
          }
        }
      });

      XLSX.writeFile(wb, `TubeMetric_Report_${timestamp}.xlsx`);
    } else {
      const data = videoResults.map((r) => ({
        '영상 링크': r.isShort ? `https://youtube.com/shorts/${r.videoId}` : `https://youtube.com/watch?v=${r.videoId}`,
        '영상 제목': r.title,
        '채널명': r.channelTitle,
        '유형': r.isShort ? '쇼츠' : '롱폼',
        '조회수': r.viewCount,
        '좋아요수': r.likeCount,
        '댓글수': r.commentCount,
        '영상 ID': r.videoId
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, '영상 데이터');

      const channelCommentsMap: Record<string, any[]> = {};
      videoResults.forEach(v => {
        if (v.status === 'completed' && v.topComments.length > 0) {
          if (!channelCommentsMap[v.channelTitle]) {
            channelCommentsMap[v.channelTitle] = [];
          }
          v.topComments.forEach(c => {
            channelCommentsMap[v.channelTitle].push({
              '영상 제목': v.title,
              '영상 ID': v.videoId,
              '댓글 작성자': c.author,
              '댓글 내용': c.text,
              '댓글 좋아요': c.likeCount,
              '작성일': new Date(c.publishedAt).toLocaleDateString()
            });
          });
        }
      });

      Object.entries(channelCommentsMap).forEach(([channelName, comments]) => {
        const wsComments = XLSX.utils.json_to_sheet(comments);
        let sheetName = channelName.replace(/[\\/*?:[\]]/g, '').substring(0, 31);
        let counter = 1;
        let finalSheetName = sheetName;
        while (wb.SheetNames.includes(finalSheetName)) {
          finalSheetName = `${sheetName.substring(0, 25)}_${counter++}`;
        }
        XLSX.utils.book_append_sheet(wb, wsComments, finalSheetName);
      });

      XLSX.writeFile(wb, `TubeMetric_Video_${timestamp}.xlsx`);
    }
  };

  const periodLabels: Record<AnalysisPeriod, string> = {
    '7d': '7일',
    '30d': '30일',
    '90d': '90일',
    'all': '전체'
  };

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-[#f2f3f8] text-[#0f0f23] flex items-center justify-center p-6 selection:bg-violet-500/30">
        <div className="w-full max-w-md space-y-10 animate-in fade-in duration-500">
          <div className="text-center space-y-5">
            <div className="inline-flex items-center justify-center bg-violet-600 p-4 rounded-xl shadow-md mb-4">
              <Lock className="text-white w-8 h-8" strokeWidth={2} />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold text-[#0f0f23]">
                Parable TubeMetric
              </h1>
              <p className="text-[#5a5a7a] text-sm">Enter your PIN to continue</p>
            </div>
          </div>

          <form onSubmit={handlePinSubmit} className="space-y-4">
            <div className="relative">
              <input
                type="password"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="PIN Code"
                autoFocus
                className="w-full bg-white border border-[#e0e1ef] rounded-xl py-4 px-6 text-center text-2xl font-medium tracking-[0.4em] text-[#1a1a2e] focus:outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 transition-all placeholder:text-[#a8a8c0] placeholder:tracking-normal placeholder:text-base"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-violet-600 hover:bg-violet-500 text-white py-4 rounded-lg font-medium text-base transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              Authorize <ChevronRight size={18} />
            </button>
          </form>

          <p className="text-center text-xs text-[#1a1a2e]">Authorized access only</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-[#f2f3f8] text-[#1a1a2e] flex font-sans overflow-hidden selection:bg-violet-100">

      {/* Modal: Creator 추가/편집 */}
      {creatorForm !== null && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-2xl border border-[#e4e5f0] shadow-xl overflow-hidden flex flex-col">
            <div className="p-5 border-b border-[#e0e1ef] flex items-center justify-between shrink-0">
              <h3 className="text-base font-bold text-[#0f0f23]">
                {creatorForm.id ? '크리에이터 편집' : '새 크리에이터 추가'}
              </h3>
              <button onClick={() => setCreatorForm(null)} className="p-2 hover:bg-[#f0f0f8] rounded-lg transition-colors text-[#5a5a7a]"><X size={16} /></button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4 max-h-[70vh]">
              {/* 이름 */}
              <div>
                <label className="block text-[11px] font-semibold text-[#5a5a7a] mb-1.5 flex items-center gap-1.5"><Users size={11} /> 크리에이터명 *</label>
                <input
                  value={creatorForm.name ?? ''}
                  onChange={e => setCreatorForm(p => ({ ...p!, name: e.target.value }))}
                  placeholder="예: 해봄"
                  className="w-full bg-[#f8f8fd] border border-[#e0e1ef] rounded-lg px-3 py-2 text-[13px] text-[#1a1a2e] placeholder:text-[#b0b0c8] focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200 transition-colors"
                />
              </div>

              {/* YouTube 채널 (여러 개) */}
              <div>
                <label className="block text-[11px] font-semibold text-[#5a5a7a] mb-1.5 flex items-center gap-1.5"><Youtube size={11} /> YouTube 채널 <span className="text-[#b0b0c8] font-normal">(여러 개 가능)</span></label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(creatorForm.youtubeChannelIds ?? []).map((v, i) => (
                    <span key={i} className="flex items-center gap-1 bg-violet-50 border border-violet-200 text-violet-700 text-[11px] px-2 py-0.5 rounded-full font-mono">
                      {v}
                      <button type="button" onClick={() => setCreatorForm(p => ({ ...p!, youtubeChannelIds: (p!.youtubeChannelIds ?? []).filter((_, j) => j !== i) }))} className="hover:text-red-500 transition-colors"><X size={10} /></button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={creatorYtDraft}
                    onChange={e => setCreatorYtDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && creatorYtDraft.trim()) { setCreatorForm(p => ({ ...p!, youtubeChannelIds: [...(p!.youtubeChannelIds ?? []), creatorYtDraft.trim()] })); setCreatorYtDraft(''); e.preventDefault(); }}}
                    placeholder="UC코드 또는 채널 URL 입력 후 Enter"
                    className="flex-1 bg-[#f8f8fd] border border-[#e0e1ef] rounded-lg px-3 py-2 text-[13px] text-[#1a1a2e] placeholder:text-[#b0b0c8] focus:outline-none focus:border-violet-400 transition-colors font-mono"
                  />
                  <button type="button" onClick={() => { if (creatorYtDraft.trim()) { setCreatorForm(p => ({ ...p!, youtubeChannelIds: [...(p!.youtubeChannelIds ?? []), creatorYtDraft.trim()] })); setCreatorYtDraft(''); }}} className="px-3 py-2 bg-violet-100 hover:bg-violet-200 text-violet-700 rounded-lg text-xs font-medium transition-all"><Plus size={13} /></button>
                </div>
              </div>

              {/* 라이브 지표 ID (여러 개) */}
              <div>
                <label className="block text-[11px] font-semibold text-[#5a5a7a] mb-1.5 flex items-center gap-1.5"><Tv2 size={11} /> 라이브 지표 ID <span className="text-[#b0b0c8] font-normal">(여러 개 가능)</span></label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(creatorForm.liveMetricsIds ?? []).map((v, i) => (
                    <span key={i} className="flex items-center gap-1 bg-orange-50 border border-orange-200 text-orange-700 text-[11px] px-2 py-0.5 rounded-full font-mono">
                      {v}
                      <button type="button" onClick={() => setCreatorForm(p => ({ ...p!, liveMetricsIds: (p!.liveMetricsIds ?? []).filter((_, j) => j !== i) }))} className="hover:text-red-500 transition-colors"><X size={10} /></button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={creatorLiveDraft}
                    onChange={e => setCreatorLiveDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && creatorLiveDraft.trim()) { setCreatorForm(p => ({ ...p!, liveMetricsIds: [...(p!.liveMetricsIds ?? []), creatorLiveDraft.trim()] })); setCreatorLiveDraft(''); e.preventDefault(); }}}
                    placeholder="CHZZK·SOOP URL 또는 chzzk:ID 입력 후 Enter"
                    className="flex-1 bg-[#f8f8fd] border border-[#e0e1ef] rounded-lg px-3 py-2 text-[13px] text-[#1a1a2e] placeholder:text-[#b0b0c8] focus:outline-none focus:border-orange-400 transition-colors font-mono"
                  />
                  <button type="button" onClick={() => { if (creatorLiveDraft.trim()) { setCreatorForm(p => ({ ...p!, liveMetricsIds: [...(p!.liveMetricsIds ?? []), creatorLiveDraft.trim()] })); setCreatorLiveDraft(''); }}} className="px-3 py-2 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg text-xs font-medium transition-all"><Plus size={13} /></button>
                </div>
              </div>

              {/* Instagram / TikTok / 메모 */}
              <div className="grid grid-cols-2 gap-3">
                {([
                  { key: 'instagramUsername', label: 'Instagram', placeholder: 'URL 또는 @username', icon: Instagram },
                  { key: 'tiktokUsername',    label: 'TikTok',    placeholder: 'URL 또는 @username', icon: Music },
                ] as { key: keyof Creator; label: string; placeholder: string; icon: React.ElementType }[]).map(({ key, label, placeholder, icon: Icon }) => (
                  <div key={key}>
                    <label className="block text-[11px] font-semibold text-[#5a5a7a] mb-1.5 flex items-center gap-1.5"><Icon size={11} /> {label}</label>
                    <input
                      value={(creatorForm[key] as string) ?? ''}
                      onChange={e => setCreatorForm(p => ({ ...p!, [key]: e.target.value }))}
                      placeholder={placeholder}
                      className="w-full bg-[#f8f8fd] border border-[#e0e1ef] rounded-lg px-3 py-2 text-[13px] text-[#1a1a2e] placeholder:text-[#b0b0c8] focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200 transition-colors"
                    />
                  </div>
                ))}
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold text-[#5a5a7a] mb-1.5 flex items-center gap-1.5"><MessageSquare size={11} /> 메모</label>
                  <input
                    value={creatorForm.memo ?? ''}
                    onChange={e => setCreatorForm(p => ({ ...p!, memo: e.target.value }))}
                    placeholder="추가 메모 (선택)"
                    className="w-full bg-[#f8f8fd] border border-[#e0e1ef] rounded-lg px-3 py-2 text-[13px] text-[#1a1a2e] placeholder:text-[#b0b0c8] focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200 transition-colors"
                  />
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-[#e0e1ef] flex items-center gap-2">
              <button
                onClick={() => upsertCreator(creatorForm)}
                disabled={!(creatorForm.name ?? '').trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-all active:scale-95"
              >
                <Save size={13} /> 저장
              </button>
              <button
                onClick={() => setCreatorForm(null)}
                className="px-4 py-2 bg-[#f0f0f8] hover:bg-[#e8e8f4] text-[#5a5a7a] rounded-lg text-sm font-medium transition-all"
              >
                취소
              </button>
              <div className="ml-auto flex items-center gap-1.5 text-[11px] text-[#a0a0b8]">
                {isFirebaseConfigured() ? <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" /> Firebase에 저장됩니다</> : <><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" /> 로컬에 저장됩니다</>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Instagram User Details */}
      {selectedIgUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-4xl max-h-[85vh] rounded-2xl border border-[#e4e5f0] shadow-sm overflow-hidden flex flex-col shadow-md">
            <div className="p-5 border-b border-[#e0e1ef] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center shrink-0">
                  <span className="text-white text-sm font-bold">{selectedIgUser.username[0]?.toUpperCase()}</span>
                </div>
                <div>
                  <div className="text-base font-semibold text-[#0f0f23]">@{selectedIgUser.username}</div>
                  <div className="text-[13px] text-[#5a5a7a] mt-1 flex items-center gap-3">
                    <span>릴스 {selectedIgUser.reelCount}개</span>
                    <span>평균 조회수 <span className="text-pink-600 font-medium">{selectedIgUser.avgViews.toLocaleString()}</span></span>
                    <span>평균 좋아요 <span className="text-violet-600 font-medium">{selectedIgUser.avgLikes.toLocaleString()}</span></span>
                    <span>평균 댓글 <span className="text-[#5a5a7a] font-medium">{selectedIgUser.avgComments.toLocaleString()}</span></span>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedIgUser(null)} className="p-2 hover:bg-[#f0f0f8] rounded-lg transition-colors text-[#5a5a7a] hover:text-[#1a1a2e]"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#f4f5fb] text-[#5a5a7a] text-[11px] sticky top-0 z-10">
                  <tr>
                    <th className="px-5 py-3.5 font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Reel</th>
                    <th className="px-5 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Views</th>
                    <th className="px-5 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Likes</th>
                    <th className="px-5 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Comments</th>
                    <th className="px-5 py-3 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Date</th>
                    <th className="px-5 py-3 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ececf5]">
                  {selectedIgUser.reels.map((reel, i) => (
                    <tr key={reel.media_pk || i} className="hover:bg-[#f5f5fc] transition-colors">
                      <td className="px-5 py-3">
                        <span className="text-xs text-[#1a1a2e] line-clamp-2 max-w-[300px]">{reel.caption_text || '—'}</span>
                      </td>
                      <td className="px-5 py-3 text-right text-sm font-semibold text-pink-600 tabular-nums">{reel.view_count.toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-right text-[13px] text-violet-600 tabular-nums">{reel.like_count.toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-right text-[13px] text-[#1a1a2e] tabular-nums">{reel.comment_count.toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-center text-[13px] text-[#1a1a2e] font-mono">{reel.taken_at ? new Date(reel.taken_at).toLocaleDateString('ko-KR') : '—'}</td>
                      <td className="px-5 py-3 text-center">
                        {reel.url ? (
                          <a href={reel.url} target="_blank" className="p-1.5 bg-[#f0f0f8] hover:bg-pink-600 hover:text-white text-[#1a1a2e] rounded-lg transition-all inline-flex"><ExternalLink size={13} /></a>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Live Creator Details */}
      {selectedLiveCreator && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-4xl max-h-[85vh] rounded-2xl border border-[#e4e5f0] shadow-sm overflow-hidden flex flex-col shadow-md">
            <div className="p-5 border-b border-[#e0e1ef] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${selectedLiveCreator.platform === 'CHZZK' ? 'bg-blue-500/20' : 'bg-purple-500/20'}`}>
                  <Tv2 size={18} className={selectedLiveCreator.platform === 'CHZZK' ? 'text-blue-400' : 'text-purple-400'} />
                </div>
                <div>
                  <div className="text-base font-semibold text-[#0f0f23]">{selectedLiveCreator.creatorId}</div>
                  <div className="text-[13px] text-[#5a5a7a] mt-1 flex items-center gap-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${selectedLiveCreator.platform === 'CHZZK' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'}`}>{selectedLiveCreator.platform}</span>
                    <span>방송 {selectedLiveCreator.streamCount}회</span>
                    <span>평균 <span className="text-orange-600 font-medium">{selectedLiveCreator.avgViewers.toLocaleString()}</span>명</span>
                    <span>최고 <span className="text-red-600 font-medium">{selectedLiveCreator.peakViewers.toLocaleString()}</span>명</span>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedLiveCreator(null)} className="p-2 hover:bg-[#f0f0f8] rounded-lg transition-colors text-[#5a5a7a] hover:text-[#1a1a2e]"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#f4f5fb] text-[#5a5a7a] text-[11px] sticky top-0 z-10">
                  <tr>
                    <th className="px-5 py-3.5 font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">방송 제목</th>
                    <th className="px-5 py-3 text-center font-medium">카테고리</th>
                    <th className="px-5 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">평균 시청자</th>
                    <th className="px-5 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">최고 시청자</th>
                    <th className="px-5 py-3 text-center font-medium">방송시간</th>
                    <th className="px-5 py-3 text-center font-medium">날짜</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ececf5]">
                  {selectedLiveCreator.streams.map((s, i) => (
                    <tr key={i} className="hover:bg-[#f5f5fc] transition-colors">
                      <td className="px-5 py-3.5 text-[13px] text-[#1a1a2e] max-w-[260px] truncate">{s.title || '(제목 없음)'}</td>
                      <td className="px-5 py-3 text-center">
                        <span className="text-[10px] bg-[#f0f0f8] px-2 py-0.5 rounded text-[#5a5a7a] border border-[#e0e1ef]">{s.category || '—'}</span>
                      </td>
                      <td className="px-5 py-3 text-right text-sm font-semibold text-orange-600 tabular-nums">{s.avgViewers.toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-right text-[13px] text-red-600 tabular-nums font-medium">{s.peakViewers.toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-center text-[13px] text-[#5a5a7a]">{s.durationMin ? `${Math.floor(s.durationMin / 60)}h ${s.durationMin % 60}m` : '—'}</td>
                      <td className="px-5 py-3.5 text-center text-[13px] text-[#5a5a7a] font-mono">{s.date || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: TikTok User Details */}
      {selectedTkUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-4xl max-h-[85vh] rounded-2xl border border-[#e4e5f0] shadow-sm overflow-hidden flex flex-col shadow-md">
            <div className="p-5 border-b border-[#e0e1ef] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-pink-500 flex items-center justify-center shrink-0">
                  <span className="text-white text-sm font-bold">{selectedTkUser.username[0]?.toUpperCase()}</span>
                </div>
                <div>
                  <div className="text-base font-semibold text-[#0f0f23]">@{selectedTkUser.username}</div>
                  <div className="text-[13px] text-[#5a5a7a] mt-1 flex items-center gap-3">
                    <span>영상 {selectedTkUser.videoCount}개</span>
                    <span>평균 조회수 <span className="text-cyan-700 font-medium">{selectedTkUser.avgViews.toLocaleString()}</span></span>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedTkUser(null)} className="p-2 hover:bg-[#f0f0f8] rounded-lg transition-colors text-[#5a5a7a] hover:text-[#1a1a2e]"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#f4f5fb] text-[#5a5a7a] text-[11px] sticky top-0 z-10">
                  <tr>
                    <th className="px-5 py-3.5 font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Video</th>
                    <th className="px-5 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Views</th>
                    <th className="px-5 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Likes</th>
                    <th className="px-5 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Comments</th>
                    <th className="px-5 py-3 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Date</th>
                    <th className="px-5 py-3 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ececf5]">
                  {selectedTkUser.videos.map((v, i) => (
                    <tr key={v.id || i} className="hover:bg-[#f5f5fc] transition-colors">
                      <td className="px-5 py-3">
                        <span className="text-xs text-[#1a1a2e] line-clamp-2 max-w-[300px]">{v.title || '(제목 없음)'}</span>
                      </td>
                      <td className="px-5 py-3 text-right text-sm font-semibold text-cyan-700 tabular-nums">{v.viewCount.toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-right text-[13px] text-pink-600 tabular-nums">{v.likeCount.toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-right text-[13px] text-[#1a1a2e] tabular-nums">{v.commentCount.toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-center text-[13px] text-[#1a1a2e] font-mono">{v.uploadDate ? `${v.uploadDate.slice(0,4)}-${v.uploadDate.slice(4,6)}-${v.uploadDate.slice(6,8)}` : '—'}</td>
                      <td className="px-5 py-3 text-center">
                        {v.url ? (
                          <a href={v.url} target="_blank" className="p-1.5 bg-[#f0f0f8] hover:bg-cyan-600 hover:text-white text-[#1a1a2e] rounded-lg transition-all inline-flex"><ExternalLink size={13} /></a>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Channel Details */}
      {selectedChannel && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-6xl h-[85vh] rounded-2xl border border-[#e4e5f0] shadow-sm overflow-hidden flex flex-col shadow-md animate-in fade-in duration-200">
            <div className="p-6 border-b border-[#e0e1ef] flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <img src={selectedChannel.thumbnail} className="w-12 h-12 rounded-xl border border-[#dddee8] shadow-sm object-cover" alt="" />
                  <div className="absolute -bottom-1 -right-1 bg-violet-600 p-1 rounded-lg border-2 border-[#1a1b23]">
                    <Youtube size={10} className="text-white" />
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-[#0f0f23] flex items-center gap-2">
                    {selectedChannel.channelName}
                    <a href={`https://youtube.com/channel/${selectedChannel.channelId}`} target="_blank" className="text-[#5a5a7a] hover:text-violet-600 transition-all"><ExternalLink size={16} /></a>
                  </h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1 text-xs font-medium text-violet-600 bg-violet-500/10 px-2.5 py-0.5 rounded-full">
                      <Users size={11} /> {formatNumber(selectedChannel.subscriberCount)} Subscribers
                    </span>
                    <p className="text-xs text-[#5a5a7a]">Analytics Results</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button onClick={() => setSelectedChannel(null)} className="p-2 bg-[#f0f0f8] hover:bg-[#eaeaf4] text-[#1a1a2e] hover:text-[#0f0f23] rounded-lg transition-all">
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-10">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                <div className="space-y-6">
                  <div className="flex items-center justify-between border-b border-[#e0e1ef] pb-3">
                    <h4 className="text-sm font-semibold text-[#0f0f23] flex items-center gap-2">
                      <div className="w-1.5 h-5 bg-violet-500 rounded-full"></div>
                      Shorts <span className="text-[#5a5a7a] font-normal">({selectedChannel.shortsList.length})</span>
                    </h4>
                    <div className="text-right">
                      <div className="text-xs text-[#5a5a7a] mb-0.5">Avg Views</div>
                      <div className="text-base font-semibold text-violet-600">{selectedChannel.avgShortsViews.toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {selectedChannel.shortsList.map((v) => (
                      <div key={v.id} className="bg-[#f0f0f8] p-3 rounded-xl border border-[#e4e5f0] shadow-sm flex items-center gap-4 hover:bg-[#f0f0fa] hover:border-violet-400 transition-all group">
                        <img src={v.thumbnail} className="w-12 h-12 rounded-lg object-cover" alt="" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[#1a1a2e] truncate leading-snug group-hover:text-violet-600">{v.title}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-violet-600 font-medium">{v.viewCount.toLocaleString()} views</span>
                            <span className="text-xs text-[#1a1a2e]">{new Date(v.publishedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <a href={`https://youtube.com/shorts/${v.id}`} target="_blank" className="p-2 bg-[#f0f0f8] text-[#1a1a2e] hover:text-white hover:bg-violet-600 rounded-lg transition-all">
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center justify-between border-b border-[#e0e1ef] pb-3">
                    <h4 className="text-sm font-semibold text-[#0f0f23] flex items-center gap-2">
                      <div className="w-1.5 h-5 bg-[#3a3a58] rounded-full"></div>
                      Longform <span className="text-[#5a5a7a] font-normal">({selectedChannel.longsList.length})</span>
                    </h4>
                    <div className="text-right">
                      <div className="text-xs text-[#5a5a7a] mb-0.5">Avg Views</div>
                      <div className="text-base font-semibold text-[#1a1a2e]">{selectedChannel.avgLongViews.toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {selectedChannel.longsList.map((v) => (
                      <div key={v.id} className="bg-[#f0f0f8] p-3 rounded-xl border border-[#e4e5f0] shadow-sm flex items-center gap-4 hover:bg-[#f0f0fa] hover:border-white/20 transition-all group">
                        <img src={v.thumbnail} className="w-20 h-12 rounded-lg object-cover" alt="" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[#1a1a2e] truncate leading-snug">{v.title}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-[#1a1a2e] font-medium">{v.viewCount.toLocaleString()} views</span>
                            <span className="text-xs text-[#1a1a2e]">{new Date(v.publishedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <a href={`https://youtube.com/watch?v=${v.id}`} target="_blank" className="p-2 bg-[#f0f0f8] text-[#1a1a2e] hover:bg-[#eeeffe] hover:text-violet-700 rounded-lg transition-all">
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Ad Analysis Details */}
      {selectedAdResult && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-6xl h-[85vh] rounded-2xl border border-[#e4e5f0] shadow-sm overflow-hidden flex flex-col shadow-md animate-in fade-in duration-200">
            <div className="p-6 border-b border-[#e0e1ef] flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <img src={selectedAdResult.thumbnail} className="w-12 h-12 rounded-xl border border-[#dddee8] shadow-sm object-cover" alt="" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-[#0f0f23] flex items-center gap-2">
                    {selectedAdResult.channelName} (광고 분석 결과)
                  </h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1 text-xs font-medium text-violet-600 bg-violet-500/10 px-2.5 py-0.5 rounded-full">
                      <Megaphone size={11} /> {selectedAdResult.totalAdCount} Detected Ads
                    </span>
                    <p className="text-xs text-[#5a5a7a]">Ad Detection Details</p>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedAdResult(null)} className="p-2 bg-[#f0f0f8] hover:bg-[#eaeaf4] text-[#1a1a2e] hover:text-[#0f0f23] rounded-lg transition-all">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-5">
              {selectedAdResult.adVideos.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[#1a1a2e] text-sm">분석된 광고 영상이 없습니다.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {selectedAdResult.adVideos.map((v) => (
                    <div key={v.id} className="bg-[#f0f0f8] p-5 rounded-xl border border-[#e4e5f0] shadow-sm hover:border-violet-400 transition-all group">
                      <div className="flex gap-4">
                        <img src={v.thumbnail} className={`shrink-0 rounded-lg object-cover ${v.isShort ? 'w-20 h-32' : 'w-28 h-18'}`} alt="" />
                        <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                          <div>
                            <div className="text-sm font-medium text-[#0f0f23] line-clamp-2 leading-snug group-hover:text-violet-600 transition-colors">{v.title}</div>
                            <div className="flex items-center gap-3 mt-2">
                              <span className="text-xs text-[#1a1a2e] flex items-center gap-1"><Eye size={11}/> {v.viewCount.toLocaleString()}</span>
                              <span className="text-xs text-[#5a5a7a] flex items-center gap-1"><ThumbsUp size={11}/> {v.likeCount.toLocaleString()}</span>
                            </div>
                          </div>

                          <div className="mt-3 pt-3 border-t border-[#e0e1ef] space-y-1.5">
                             <div className="text-xs text-[#1a1a2e]">Detection Evidence</div>
                             <div className="flex flex-wrap gap-1.5">
                               {v.detection.evidence.map((ev, idx) => (
                                 <span key={idx} className="text-xs bg-violet-600/10 text-violet-600 px-2 py-0.5 rounded-md flex items-center gap-1">
                                   <ShieldCheck size={10} /> {ev}
                                 </span>
                               ))}
                             </div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 flex items-center justify-between">
                         <div className="text-xs text-[#1a1a2e]">Published: {new Date(v.publishedAt).toLocaleDateString()}</div>
                         <a href={v.isShort ? `https://youtube.com/shorts/${v.id}` : `https://youtu.be/${v.id}`} target="_blank" className="bg-[#f0f0f8] hover:bg-violet-600 text-[#1a1a2e] hover:text-white p-2 rounded-lg transition-all">
                           <ExternalLink size={16} />
                         </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className="w-[220px] bg-white border-r border-[#e4e5f0] flex flex-col shrink-0 hidden xl:flex h-full overflow-hidden">

        {/* ── 로고 ─────────────────────────────────────────────────── */}
        <div className="px-5 py-4 border-b border-[#e4e5f0] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shrink-0 shadow-md shadow-violet-200">
              <Youtube className="text-white w-4 h-4" />
            </div>
            <div>
              <div className="text-[14px] font-bold text-[#0f0f23] tracking-tight leading-none">TubeMetric</div>
              <div className="text-[10px] text-[#9090b0] leading-none mt-0.5">by Parable</div>
            </div>
          </div>
        </div>

        {/* ── 네비게이션 ───────────────────────────────────────────── */}
        <nav className="flex-1 px-2.5 py-3 space-y-4 overflow-y-auto">

          {/* ① 설치 — 최상단 */}
          <div>
            <p className="px-2 mb-1 text-[9px] font-bold text-[#b0b0c8] tracking-[0.14em] uppercase">설치</p>
            <div className="space-y-0.5">
              {(() => {
                const isActive = activeTab === 'install';
                return (
                  <button
                    onClick={() => setActiveTab('install')}
                    className={`w-full flex items-center gap-2.5 py-[9px] rounded-lg text-[13px] font-medium transition-all group relative ${
                      isActive ? 'nav-active' : 'px-2.5 text-[#4a4a6a] hover:text-[#1a1a2e] hover:bg-[#f5f5fc]'
                    }`}
                  >
                    <Package2 size={15} className={isActive ? 'text-violet-600' : 'text-[#a0a0b8] group-hover:text-violet-500'} />
                    <span className="flex-1 text-left">로컬 에이전트 설치</span>
                    {(!localAgentRunning || !igLocalRunning) && (
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                    )}
                  </button>
                );
              })()}
            </div>
          </div>

          {/* ② 분석 */}
          <div>
            <p className="px-2 mb-1 text-[9px] font-bold text-[#b0b0c8] tracking-[0.14em] uppercase">Analysis</p>
            <div className="space-y-0.5">
              {([
                { id: 'channel-config',   label: '채널 통합 분석',   Icon: TrendingUp,  soon: false },
                { id: 'video-config',     label: '단일 영상 분석',   Icon: Video,       soon: false },
                { id: 'live-config',      label: '라이브 지표 분석', Icon: Tv2,         soon: false },
                { id: 'instagram-config', label: 'Instagram 분석',  Icon: Instagram,   soon: false },
                { id: 'tiktok-config',    label: 'TikTok 분석',     Icon: Music,       soon: false },
              ] as { id: TabType; label: string; Icon: React.ElementType; soon: boolean }[]).map(({ id, label, Icon, soon }) => {
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => !soon && setActiveTab(id)}
                    className={`w-full flex items-center gap-2.5 py-[9px] rounded-lg text-[13px] font-medium transition-all group relative ${
                      isActive
                        ? 'nav-active'
                        : soon
                          ? 'px-2.5 text-[#c8c8d8] cursor-default'
                          : 'px-2.5 text-[#4a4a6a] hover:text-[#1a1a2e] hover:bg-[#f5f5fc]'
                    }`}
                  >
                    <Icon size={15} className={isActive ? 'text-violet-600' : 'text-[#a0a0b8] group-hover:text-violet-500'} />
                    <span className="flex-1 text-left truncate">{label}</span>
                    {soon && (
                      <span className="text-[9px] bg-[#f0f0f8] text-[#b0b0c8] px-1.5 py-0.5 rounded font-medium">Soon</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ③ 데이터 */}
          <div>
            <p className="px-2 mb-1 text-[9px] font-bold text-[#b0b0c8] tracking-[0.14em] uppercase">Data</p>
            <div className="space-y-0.5">
              {(() => {
                const isActive = activeTab === 'creator';
                return (
                  <button
                    onClick={() => setActiveTab('creator')}
                    className={`w-full flex items-center gap-2.5 py-[9px] rounded-lg text-[13px] font-medium transition-all group relative ${
                      isActive ? 'nav-active' : 'px-2.5 text-[#4a4a6a] hover:text-[#1a1a2e] hover:bg-[#f5f5fc]'
                    }`}
                  >
                    <BookUser size={15} className={isActive ? 'text-violet-600' : 'text-[#a0a0b8] group-hover:text-violet-500'} />
                    <span className="flex-1 text-left">Creator</span>
                    {creators.length > 0 && (
                      <span className="text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full font-bold">{creators.length}</span>
                    )}
                  </button>
                );
              })()}
              {(() => {
                const isActive = activeTab === 'system-log';
                return (
                  <button
                    onClick={() => setActiveTab('system-log')}
                    className={`w-full flex items-center gap-2.5 py-[9px] rounded-lg text-[13px] font-medium transition-all group relative ${
                      isActive ? 'nav-active' : 'px-2.5 text-[#4a4a6a] hover:text-[#1a1a2e] hover:bg-[#f5f5fc]'
                    }`}
                  >
                    <Terminal size={15} className={isActive ? 'text-violet-600' : 'text-[#a0a0b8] group-hover:text-violet-500'} />
                    <span className="flex-1 text-left">System Log</span>
                    <Lock size={11} className="text-[#b0b0c8]" />
                  </button>
                );
              })()}
            </div>
          </div>

        </nav>

        {/* ── 하단 상태 ────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-t border-[#e4e5f0] shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full dot-live shrink-0" />
            <span className="text-[11px] text-[#8888a8]">Connected</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full min-h-0 overflow-y-auto bg-[#f2f3f8]">
        <div className="p-5 xl:p-7 w-full min-h-full max-w-none">

          {/* ── 공용 컴포넌트: Progress Bar ─────────────────────────────── */}
          {/* inline below each tab */}

          {activeTab === 'channel-config' ? (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[22px] font-bold text-[#0f0f23] tracking-tight">채널 통합 분석</h2>
                  <p className="text-[13px] text-[#5a5a7a] mt-1">YouTube 채널 평균 조회수 및 영상 데이터 수집</p>
                </div>
                <button
                  onClick={() => setShowHelp(!showHelp)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${showHelp ? 'bg-violet-50 text-violet-700 border border-violet-400' : 'bg-[#f0f0f8] text-[#5a5a7a] hover:text-[#5a5a7a]'}`}
                >
                  <Info size={13} /> 가이드
                </button>
              </div>

              {showHelp && (
                <div className="bg-white border border-violet-300 rounded-xl p-5 animate-in fade-in duration-200">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <h4 className="font-medium text-violet-600 text-xs flex items-center gap-1.5"><CalendarDays size={12} /> 분석 기간</h4>
                      <p className="text-[#5a5a7a] text-xs leading-relaxed">수집할 영상의 게시 기간을 필터링합니다. 전체 선택 시 기간 제한 없이 수집합니다.</p>
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-medium text-violet-600 text-xs flex items-center gap-1.5"><Activity size={12} /> 수집 개수</h4>
                      <p className="text-[#5a5a7a] text-xs leading-relaxed">채널당 수집할 최대 영상 수를 지정합니다. 쇼츠/롱폼 각각 설정 가능합니다.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Input + Options grid */}
              <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
                {/* Left: List Input */}
                <div className="xl:col-span-3">
                  <div className="bg-white rounded-xl border border-[#e4e5f0] shadow-sm p-5 space-y-4 h-full">
                    <div className="flex items-center justify-between">
                      <label className="text-[12px] font-semibold text-[#3a3a5a] flex items-center gap-1.5">
                        <List size={13} className="text-violet-600" /> Channel List
                        {channelList.length > 0 && <span className="bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded text-[10px]">{channelList.length}</span>}
                      </label>
                      {channelList.length > 0 && (
                        <button onClick={clearChannelList} className="text-xs text-[#1a1a2e] hover:text-red-600 transition-colors flex items-center gap-1">
                          <Trash2 size={11} /> 전체 삭제
                        </button>
                      )}
                    </div>
                    {/* Add field */}
                    <div className="flex gap-2">
                      <CreatorAutocomplete
                        value={channelDraft}
                        onChange={setChannelDraft}
                        onCommit={addChannelItem}
                        onAddMultiple={vals => { vals.forEach(v => { setChannelInput(prev => prev ? prev + '\n' + v : v); }); setChannelDraft(''); }}
                        creators={creators}
                        field="youtube"
                        placeholder="UC코드 · 채널 URL · 크리에이터명 입력"
                        className="w-full bg-[#f0f0f8] border border-[#d4d5e2] rounded-lg px-3 py-2 text-[13px] text-[#1a1a2e] font-mono placeholder:text-[#a8a8c0] focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
                      />
                      <button
                        onClick={addChannelItem}
                        className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs rounded-lg transition-all active:scale-95"
                      >
                        <Plus size={13} /> 추가
                      </button>
                    </div>
                    {/* List */}
                    <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                      {channelList.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-[#1a1a2e] space-y-2">
                          <List size={28} strokeWidth={1} />
                          <p className="text-xs">채널을 추가하세요</p>
                        </div>
                      ) : channelList.map((ch, i) => (
                        <div key={i} className="flex items-center gap-2 bg-[#f2f2f8] hover:bg-[#eeeef8] border border-[#e0e1ef] rounded-lg px-3 py-2 group transition-colors">
                          <div className="w-1.5 h-1.5 bg-[#eeeffe] rounded-full shrink-0" />
                          <span className="flex-1 text-xs font-mono text-[#5a5a7a] truncate">{ch}</span>
                          <button onClick={() => removeChannelItem(i)} className="opacity-0 group-hover:opacity-100 text-[#1a1a2e] hover:text-red-600 transition-all">
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                    {channelList.length > 0 && (
                      <p className="text-[10px] text-[#1a1a2e]">{channelList.length}개 채널 · Enter 또는 추가 버튼으로 입력</p>
                    )}
                  </div>
                </div>

                {/* Right: Options */}
                  <div className="xl:col-span-2 flex flex-col space-y-4">
                    {/* SECTION 1: 분석 기간 설정 (통합) */}
                    <div className="bg-white p-5 rounded-xl border border-[#e4e5f0] shadow-sm space-y-5">
                        <h3 className="text-sm font-medium text-[#0f0f23] flex items-center gap-2 pb-2 border-b border-[#e0e1ef]">
                          <Calendar size={15} className="text-violet-600" /> 분석 기간 설정
                        </h3>

                        <div className="space-y-4">
                           <div className="flex justify-between items-center">
                              <label className="text-xs text-[#1a1a2e] flex items-center gap-1.5">
                                <CalendarDays size={13} className="text-violet-600" /> 전체 영상 기준 기간
                              </label>
                              <button
                                onClick={() => setUseDateFilter(!useDateFilter)}
                                className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-all ${useDateFilter ? 'bg-violet-600 text-white' : 'bg-[#f0f0f8] text-[#5a5a7a]'}`}
                              >
                                {useDateFilter ? 'Enabled' : 'Disabled'}
                              </button>
                           </div>
                           <div className={`grid grid-cols-4 gap-1.5 transition-opacity ${!useDateFilter ? 'opacity-30' : ''}`}>
                             {(['all', '90d', '30d', '7d'] as AnalysisPeriod[]).map(p => (
                               <button
                                 key={p}
                                 disabled={!useDateFilter}
                                 onClick={() => setPeriod(p)}
                                 className={`py-2 text-xs font-medium rounded-lg transition-all ${period === p ? 'bg-white text-black' : 'bg-[#f0f0f8] text-[#1a1a2e] hover:bg-[#eaeaf4] hover:text-[#1a1a2e]'}`}
                               >
                                 {periodLabels[p]}
                               </button>
                             ))}
                           </div>
                           <p className="text-xs text-[#1a1a2e] text-center">설정한 기간 내의 영상만 수집 대상에 포함됩니다.</p>
                        </div>
                    </div>

                    {/* SECTION 2: 영상 수집 개수 필터 (통합 ENABLED/DISABLED) */}
                    <div className="bg-white p-5 rounded-xl border border-[#e4e5f0] shadow-sm space-y-5">
                        <div className="flex justify-between items-center pb-2 border-b border-[#e0e1ef]">
                          <h3 className="text-sm font-medium text-[#0f0f23] flex items-center gap-2">
                            <Activity size={15} className="text-violet-600" /> 영상 수집 개수 필터
                          </h3>
                          <button
                            onClick={() => setUseGlobalCountFilter(!useGlobalCountFilter)}
                            className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-all ${useGlobalCountFilter ? 'bg-violet-600 text-white' : 'bg-[#f0f0f8] text-emerald-500'}`}
                          >
                            {useGlobalCountFilter ? 'Enabled' : 'Disabled'}
                          </button>
                        </div>

                        {/* Shorts Count Filter */}
                        <div className="space-y-3">
                           <div className="flex justify-between items-center">
                              <label className="text-xs text-[#1a1a2e] flex items-center gap-1.5">
                                <Radio size={13} className="text-violet-600" /> Shorts Target
                              </label>
                              <div className="flex items-center gap-3">
                                <button
                                  disabled={!useGlobalCountFilter}
                                  onClick={() => setUseShorts(!useShorts)}
                                  className={`${(useShorts && useGlobalCountFilter) ? 'text-violet-600' : 'text-[#1a1a2e]'} transition-opacity ${!useGlobalCountFilter ? 'opacity-30' : ''}`}
                                >
                                  {(useShorts && useGlobalCountFilter) ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                                </button>
                              </div>
                           </div>
                           <div className={`space-y-2 transition-opacity ${(!useShorts || !useGlobalCountFilter) ? 'opacity-30' : ''}`}>
                              <div className="flex justify-between text-xs">
                                <span className="text-[#5a5a7a]">Max Target</span>
                                <span className="text-violet-600 font-medium">{useGlobalCountFilter ? `${targetShorts}개` : '전체 수집'}</span>
                              </div>
                              <input
                               type="range"
                               min="1"
                               max="100"
                               disabled={!useShorts || !useGlobalCountFilter}
                               value={Number(targetShorts)}
                               onChange={(e) => setTargetShorts(Number(e.target.value))}
                               className="w-full appearance-none bg-[#eeeef6] h-1.5 rounded-full accent-violet-500"
                              />
                           </div>
                        </div>

                        {/* Longform Count Filter */}
                        <div className="space-y-3">
                           <div className="flex justify-between items-center">
                              <label className="text-xs text-[#1a1a2e] flex items-center gap-1.5">
                                <MonitorPlay size={13} className="text-[#1a1a2e]" /> Longform Target
                              </label>
                              <div className="flex items-center gap-3">
                                <button
                                  disabled={!useGlobalCountFilter}
                                  onClick={() => setUseLongs(!useLongs)}
                                  className={`${(useLongs && useGlobalCountFilter) ? 'text-violet-600' : 'text-[#1a1a2e]'} transition-opacity ${!useGlobalCountFilter ? 'opacity-30' : ''}`}
                                >
                                  {(useLongs && useGlobalCountFilter) ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                                </button>
                              </div>
                           </div>
                           <div className={`space-y-2 transition-opacity ${(!useLongs || !useGlobalCountFilter) ? 'opacity-30' : ''}`}>
                              <div className="flex justify-between text-xs">
                                <span className="text-[#5a5a7a]">Max Target</span>
                                <span className="text-[#5a5a7a] font-medium">{useGlobalCountFilter ? `${targetLong}개` : '전체 수집'}</span>
                              </div>
                              <input
                               type="range"
                               min="1"
                               max="50"
                               disabled={!useLongs || !useGlobalCountFilter}
                               value={Number(targetLong)}
                               onChange={(e) => setTargetLong(Number(e.target.value))}
                               className="w-full appearance-none bg-[#eeeef6] h-1.5 rounded-full accent-zinc-400"
                              />
                           </div>
                        </div>
                    </div>

                    <div className="mt-auto">
                      <button
                        onClick={handleChannelStart}
                        disabled={isProcessing}
                        className="w-full bg-violet-600 hover:bg-violet-500 text-white py-3.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2.5 transition-all active:scale-95 disabled:opacity-50"
                      >
                        {isProcessing ? <Loader2 className="animate-spin" size={16} /> : <Play fill="currentColor" size={14} />}
                        {isProcessing ? '분석 중...' : '분석 시작'}
                      </button>
                    </div>
                  </div>
               </div>

              {/* Progress */}
              {isProcessing && channelResults.length > 0 && (
                <div className="bg-white rounded-xl border border-[#e4e5f0] shadow-sm p-5 space-y-3 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-[#0f0f23]">
                      <Loader2 size={14} className="animate-spin text-violet-600" /> 분석 진행 중
                    </div>
                    <span className="text-xs text-[#5a5a7a] tabular-nums">{channelDone} / {channelTotal} 완료 · {channelProgress}%</span>
                  </div>
                  <div className="w-full bg-white/8 rounded-full h-1 overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full transition-all duration-700" style={{ width: `${channelProgress}%` }} />
                  </div>
                  <div className="space-y-1 max-h-20 overflow-y-auto">
                    {channelResults.filter(r => r.status !== 'pending').slice(-4).map((r, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-[#1a1a2e]">
                        {r.status === 'completed' ? <CheckCircle2 size={11} className="text-emerald-500 shrink-0" /> : r.status === 'error' ? <AlertCircle size={11} className="text-red-500 shrink-0" /> : <Loader2 size={11} className="animate-spin text-violet-600 shrink-0" />}
                        <span className="truncate">{r.channelName !== '데이터 수집 중...' ? r.channelName : r.channelId}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Results Panel */}
              {channelResults.length > 0 && (
                <div className="bg-white rounded-xl border border-[#e4e5f0] shadow-sm overflow-hidden">
                  <button onClick={() => setShowChannelResults(p => !p)} className="w-full flex items-center justify-between px-6 py-4 hover:bg-[#f5f5fc] transition-colors">
                    <div className="flex items-center gap-2.5">
                      {showChannelResults ? <ChevronDown size={15} className="text-[#5a5a7a]" /> : <ChevronRight size={15} className="text-[#5a5a7a]" />}
                      <span className="text-sm font-medium text-[#0f0f23]">분석 결과</span>
                      <span className="text-xs text-[#1a1a2e]">{channelResults.filter(r => r.status === 'completed').length}개 완료{channelResults.filter(r => r.status === 'error').length > 0 ? ` · ${channelResults.filter(r => r.status === 'error').length}개 오류` : ''}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isProcessing ? <Loader2 size={12} className="animate-spin text-violet-600" /> : channelResults.some(r => r.status === 'completed') ? <CheckCircle2 size={12} className="text-emerald-500" /> : null}
                    </div>
                  </button>
                  {showChannelResults && (
                    <div className="border-t border-[#e0e1ef]">
                      <div className="flex items-center justify-between px-6 py-3 border-b border-[#e0e1ef] bg-[#f2f3f8]/50">
                        <div className="flex gap-1">
                          {(['table','chart','raw'] as ResultTab[]).map(t => (
                            <button key={t} onClick={() => setChannelResultTab(t)} className={`px-3 py-1 rounded text-xs font-medium transition-all ${channelResultTab === t ? 'bg-violet-600 text-white' : 'text-[#5a5a7a] hover:text-[#5a5a7a] hover:bg-[#f0f0fa]'}`}>
                              {t === 'table' ? 'TABLE' : t === 'chart' ? 'CHART' : 'RAW DATA'}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={handleDownloadExcel} className="flex items-center gap-1 px-2.5 py-1 bg-[#f0f0f8] hover:bg-[#eaeaf4] text-[#1a1a2e] hover:text-[#0f0f23] rounded text-xs transition-all"><FileSpreadsheet size={11} /> Excel</button>
                          <button onClick={() => { const hdr = '채널명\t채널ID\t구독자수\t숏츠평균\t롱폼평균'; const rows = channelResults.map(r => [r.channelName, r.channelId, r.subscriberCount, r.avgShortsViews, r.avgLongViews].join('\t')); navigator.clipboard.writeText([hdr, ...rows].join('\n')); }} className="flex items-center gap-1 px-2.5 py-1 bg-[#f0f0f8] hover:bg-[#eaeaf4] text-[#1a1a2e] hover:text-[#0f0f23] rounded text-xs transition-all"><Clipboard size={11} /> 복사</button>
                        </div>
                      </div>
                      {channelResultTab === 'table' && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead className="bg-[#f4f5fb] text-[#5a5a7a] text-[11px]">
                              <tr>
                                <th className="px-6 py-3.5 font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Channel</th>
                                <th className="px-6 py-3.5 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Subscribers</th>
                                <th className="px-6 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Shorts Avg</th>
                                <th className="px-6 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Longform Avg</th>
                                <th className="px-6 py-3.5 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Detail</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#ececf5]">
                              {channelResults.map(r => (
                                <tr key={r.channelId} className="hover:bg-[#f5f5fc] transition-colors group">
                                  <td className="px-6 py-3.5 flex items-center gap-3">
                                    {r.thumbnail ? <img src={r.thumbnail} className="w-8 h-8 rounded-lg object-cover border border-[#e0e1ef] shrink-0" /> : <div className="w-8 h-8 bg-[#f0f1f8] rounded-lg flex items-center justify-center shrink-0"><Loader2 className="animate-spin text-[#1a1a2e]" size={13} /></div>}
                                    <div className="min-w-0">
                                      <div className="text-[12px] font-semibold text-[#3a3a5a] group-hover:text-violet-600 transition-colors flex items-center gap-1.5 truncate max-w-[220px]">
                                        {r.channelName}
                                        {r.status === 'error' && <span className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded shrink-0">Error</span>}
                                        {r.status === 'processing' && <Loader2 size={10} className="animate-spin text-violet-600 shrink-0" />}
                                        {r.status === 'pending' && <span className="text-[10px] text-[#1a1a2e] shrink-0">대기</span>}
                                      </div>
                                      <div className="text-[10px] text-[#1a1a2e] font-mono mt-0.5 truncate max-w-[200px]">{r.status === 'error' ? r.error : r.channelId}</div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-3.5 text-center"><span className="bg-[#f0f0f8] px-2.5 py-1 rounded text-[#1a1a2e] text-xs border border-[#e0e1ef]">{r.status === 'completed' ? formatNumber(r.subscriberCount) : '—'}</span></td>
                                  <td className="px-6 py-3.5 text-right"><div className="text-sm font-semibold text-violet-600">{r.avgShortsViews > 0 ? r.avgShortsViews.toLocaleString() : '—'}</div><div className="text-[10px] text-[#1a1a2e] mt-0.5">{r.shortsCountFound > 0 ? `${r.shortsCountFound} Shorts` : ''}</div></td>
                                  <td className="px-6 py-3.5 text-right"><div className="text-sm font-semibold text-[#1a1a2e]">{r.avgLongViews > 0 ? r.avgLongViews.toLocaleString() : '—'}</div><div className="text-[10px] text-[#1a1a2e] mt-0.5">{r.longCountFound > 0 ? `${r.longCountFound} Videos` : ''}</div></td>
                                  <td className="px-6 py-3.5 text-center"><button disabled={r.status !== 'completed'} onClick={() => setSelectedChannel(r)} className="p-1.5 bg-[#f0f0f8] hover:bg-violet-600 hover:text-white text-[#1a1a2e] rounded-lg transition-all disabled:opacity-20 active:scale-90"><Eye size={14} /></button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {channelResultTab === 'chart' && (
                        <div className="p-6 space-y-6">
                          {(() => {
                            const done = channelResults.filter(r => r.status === 'completed');
                            if (!done.length) return <p className="text-xs text-[#1a1a2e] text-center py-8">완료된 채널이 없습니다.</p>;
                            const maxShorts = Math.max(...done.map(r => r.avgShortsViews), 1);
                            const maxLong = Math.max(...done.map(r => r.avgLongViews), 1);
                            return (
                              <>
                                <div>
                                  <p className="text-[12px] font-semibold text-[#3a3a5a] mb-3 flex items-center gap-1.5"><Radio size={12} className="text-violet-600" /> Shorts 평균 조회수</p>
                                  <div className="space-y-2">
                                    {done.map(r => (
                                      <div key={r.channelId} className="flex items-center gap-3">
                                        <span className="text-xs text-[#5a5a7a] w-28 truncate shrink-0">{r.channelName}</span>
                                        <div className="flex-1 bg-[#f0f0f8] rounded-full h-1.5 overflow-hidden">
                                          <div className="h-full bg-violet-500 rounded-full transition-all duration-500" style={{ width: `${(r.avgShortsViews / maxShorts) * 100}%` }} />
                                        </div>
                                        <span className="text-xs text-[#1a1a2e] w-20 text-right shrink-0 tabular-nums">{r.avgShortsViews.toLocaleString()}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <p className="text-[12px] font-semibold text-[#3a3a5a] mb-3 flex items-center gap-1.5"><MonitorPlay size={12} className="text-[#1a1a2e]" /> Longform 평균 조회수</p>
                                  <div className="space-y-2">
                                    {done.map(r => (
                                      <div key={r.channelId} className="flex items-center gap-3">
                                        <span className="text-xs text-[#5a5a7a] w-28 truncate shrink-0">{r.channelName}</span>
                                        <div className="flex-1 bg-[#f0f0f8] rounded-full h-1.5 overflow-hidden">
                                          <div className="h-full bg-[#5a5a80] rounded-full transition-all duration-500" style={{ width: `${(r.avgLongViews / maxLong) * 100}%` }} />
                                        </div>
                                        <span className="text-xs text-[#1a1a2e] w-20 text-right shrink-0 tabular-nums">{r.avgLongViews.toLocaleString()}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      )}
                      {channelResultTab === 'raw' && (
                        <pre className="p-6 text-[11px] text-[#5a5a7a] overflow-auto max-h-96 font-mono leading-relaxed">{JSON.stringify(channelResults.map(r => ({ channelId: r.channelId, channelName: r.channelName, subscriberCount: r.subscriberCount, avgShortsViews: r.avgShortsViews, avgLongViews: r.avgLongViews, status: r.status })), null, 2)}</pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

          ) : activeTab === 'video-config' ? (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Header */}
              <div>
                <h2 className="text-[22px] font-bold text-[#0f0f23] tracking-tight">단일 영상 분석</h2>
                <p className="text-[13px] text-[#5a5a7a] mt-1">YouTube 영상 URL 또는 ID로 조회수·댓글 분석</p>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
                {/* Left: list input */}
                <div className="xl:col-span-3 bg-white rounded-xl border border-[#e4e5f0] shadow-sm p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-[12px] font-semibold text-[#3a3a5a] flex items-center gap-1.5">
                      <Video size={13} className="text-violet-600" /> Video List
                      {videoList.length > 0 && <span className="bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded text-[10px]">{videoList.length}</span>}
                    </label>
                    {videoList.length > 0 && (
                      <button onClick={() => setVideoInput('')} className="text-xs text-[#1a1a2e] hover:text-red-600 transition-colors flex items-center gap-1"><Trash2 size={11} /> 전체 삭제</button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={videoDraft}
                      onChange={e => setVideoDraft(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addVideoItem()}
                      placeholder="영상 URL 또는 ID 입력 후 Enter"
                      className="flex-1 bg-[#f0f0f8] border border-[#d4d5e2] rounded-lg px-3 py-2 text-[13px] text-[#1a1a2e] font-mono placeholder:text-[#a8a8c0] focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
                    />
                    <button onClick={addVideoItem} className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs rounded-lg transition-all active:scale-95"><Plus size={13} /> 추가</button>
                  </div>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {videoList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-[#1a1a2e] space-y-2"><Video size={26} strokeWidth={1} /><p className="text-xs">영상을 추가하세요</p></div>
                    ) : videoList.map((v, i) => (
                      <div key={i} className="flex items-center gap-2 bg-[#f2f2f8] hover:bg-[#eeeef8] border border-[#e0e1ef] rounded-lg px-3 py-2 group transition-colors">
                        <div className="w-1.5 h-1.5 bg-[#eeeffe] rounded-full shrink-0" />
                        <span className="flex-1 text-xs font-mono text-[#5a5a7a] truncate">{v}</span>
                        <button onClick={() => removeVideoItem(i)} className="opacity-0 group-hover:opacity-100 text-[#1a1a2e] hover:text-red-600 transition-all"><X size={13} /></button>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Right: Run */}
                <div className="xl:col-span-2 flex flex-col gap-4">
                  <div className="bg-white rounded-xl border border-[#e4e5f0] shadow-sm p-5 space-y-3 flex-1">
                    <h3 className="text-[12px] font-semibold text-[#3a3a5a]">수집 설정</h3>
                    <p className="text-xs text-[#1a1a2e] leading-relaxed">URL 또는 11자리 영상 ID를 입력하세요. 중복은 자동으로 제거됩니다.</p>
                    <div className="bg-[#f2f2f8] rounded-lg p-3 space-y-1">
                      <p className="text-[10px] text-[#1a1a2e]">지원 형식</p>
                      <p className="text-[10px] text-[#1a1a2e] font-mono">youtube.com/watch?v=xxx</p>
                      <p className="text-[10px] text-[#1a1a2e] font-mono">youtu.be/xxx</p>
                      <p className="text-[10px] text-[#1a1a2e] font-mono">youtube.com/shorts/xxx</p>
                    </div>
                  </div>
                  <button onClick={handleVideoStart} disabled={isProcessing} className="w-full bg-violet-600 hover:bg-violet-500 text-white py-3.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2.5 transition-all active:scale-95 disabled:opacity-50">
                    {isProcessing ? <Loader2 className="animate-spin" size={16} /> : <MonitorPlay size={16} />}
                    {isProcessing ? '수집 중...' : '수집 시작'}
                  </button>
                </div>
              </div>

              {/* Progress */}
              {isProcessing && videoResults.length > 0 && (
                <div className="bg-white rounded-xl border border-[#e4e5f0] shadow-sm p-5 space-y-3 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-[#0f0f23]"><Loader2 size={14} className="animate-spin text-violet-600" /> 수집 진행 중</div>
                    <span className="text-xs text-[#5a5a7a] tabular-nums">{videoDone} / {videoTotal} 완료 · {videoProgress}%</span>
                  </div>
                  <div className="w-full bg-white/8 rounded-full h-1 overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full transition-all duration-700" style={{ width: `${videoProgress}%` }} />
                  </div>
                </div>
              )}

              {/* Results Panel */}
              {videoResults.length > 0 && (
                <div className="bg-white rounded-xl border border-[#e4e5f0] shadow-sm overflow-hidden">
                  <button onClick={() => setShowVideoResults(p => !p)} className="w-full flex items-center justify-between px-6 py-4 hover:bg-[#f5f5fc] transition-colors">
                    <div className="flex items-center gap-2.5">
                      {showVideoResults ? <ChevronDown size={15} className="text-[#5a5a7a]" /> : <ChevronRight size={15} className="text-[#5a5a7a]" />}
                      <span className="text-sm font-medium text-[#0f0f23]">수집 결과</span>
                      <span className="text-xs text-[#1a1a2e]">{videoResults.filter(v => v.status === 'completed').length}개 완료</span>
                    </div>
                    {!isProcessing && videoResults.some(v => v.status === 'completed') && <CheckCircle2 size={12} className="text-emerald-500" />}
                  </button>
                  {showVideoResults && (
                    <div className="border-t border-[#e0e1ef]">
                      <div className="flex items-center justify-between px-6 py-3 border-b border-[#e0e1ef] bg-[#f2f3f8]/50">
                        <div className="flex gap-1">
                          {(['table','chart','raw'] as ResultTab[]).map(t => (
                            <button key={t} onClick={() => setVideoResultTab(t)} className={`px-3 py-1 rounded text-xs font-medium transition-all ${videoResultTab === t ? 'bg-violet-600 text-white' : 'text-[#5a5a7a] hover:text-[#5a5a7a] hover:bg-[#f0f0fa]'}`}>
                              {t === 'table' ? 'TABLE' : t === 'chart' ? 'CHART' : 'RAW DATA'}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={handleDownloadExcel} className="flex items-center gap-1 px-2.5 py-1 bg-[#f0f0f8] hover:bg-[#eaeaf4] text-[#1a1a2e] hover:text-[#0f0f23] rounded text-xs transition-all"><FileSpreadsheet size={11} /> Excel</button>
                          <button onClick={() => { const hdr = '제목\t채널\t조회수\t좋아요\t댓글'; const rows = videoResults.map(r => [r.title, r.channelTitle, r.viewCount, r.likeCount, r.commentCount].join('\t')); navigator.clipboard.writeText([hdr, ...rows].join('\n')); }} className="flex items-center gap-1 px-2.5 py-1 bg-[#f0f0f8] hover:bg-[#eaeaf4] text-[#1a1a2e] hover:text-[#0f0f23] rounded text-xs transition-all"><Clipboard size={11} /> 복사</button>
                        </div>
                      </div>
                      {videoResultTab === 'table' && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead className="bg-[#f4f5fb] text-[#5a5a7a] text-[11px]">
                              <tr>
                                <th className="px-6 py-3.5 font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Video</th>
                                <th className="px-6 py-3.5 font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Channel</th>
                                <th className="px-6 py-3.5 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Likes / Comments</th>
                                <th className="px-6 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Views</th>
                                <th className="px-6 py-3.5 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Detail</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#ececf5]">
                              {videoResults.map(v => (
                                <tr key={v.videoId} className="hover:bg-[#f5f5fc] transition-colors group">
                                  <td className="px-6 py-3.5 flex items-center gap-3">
                                    {v.thumbnail ? <img src={v.thumbnail} className={`rounded-lg object-cover border border-[#e0e1ef] shrink-0 ${v.isShort ? 'w-7 h-10' : 'w-14 h-9'}`} /> : <div className="w-8 h-8 bg-[#f0f1f8] rounded-lg flex items-center justify-center shrink-0"><Loader2 className="animate-spin text-[#1a1a2e]" size={13} /></div>}
                                    <div className="min-w-0">
                                      <div className="text-[12px] font-semibold text-[#3a3a5a] group-hover:text-violet-600 transition-colors truncate max-w-[280px]">{v.title}</div>
                                      <div className="text-[10px] text-[#1a1a2e] font-mono mt-0.5">{v.status === 'error' ? v.error : v.videoId}</div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 text-[13px] text-[#1a1a2e]">{v.channelTitle || '—'}</td>
                                  <td className="px-6 py-3.5 text-center">
                                    <div className="text-xs text-violet-600 flex items-center justify-center gap-1"><ThumbsUp size={10} /> {v.likeCount.toLocaleString()}</div>
                                    <div className="text-[10px] text-[#1a1a2e] flex items-center justify-center gap-1 mt-0.5"><MessageSquare size={10} /> {v.commentCount.toLocaleString()}</div>
                                  </td>
                                  <td className="px-6 py-3.5 text-right text-sm font-semibold text-[#1a1a2e] tabular-nums">{v.viewCount.toLocaleString()}</td>
                                  <td className="px-6 py-3.5 text-center flex items-center justify-center gap-1.5">
                                    <button disabled={v.status !== 'completed'} onClick={() => setSelectedVideo(v)} className="p-1.5 bg-[#f0f0f8] hover:bg-[#eaeaf4] text-[#1a1a2e] rounded-lg transition-all disabled:opacity-20 active:scale-90"><Eye size={13} /></button>
                                    <a href={v.isShort ? `https://youtube.com/shorts/${v.videoId}` : `https://youtube.com/watch?v=${v.videoId}`} target="_blank" className="p-1.5 bg-[#f0f0f8] hover:bg-violet-600 text-[#1a1a2e] hover:text-white rounded-lg transition-all"><ExternalLink size={13} /></a>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {videoResultTab === 'chart' && (
                        <div className="p-6">
                          {(() => {
                            const done = videoResults.filter(v => v.status === 'completed');
                            if (!done.length) return <p className="text-xs text-[#1a1a2e] text-center py-8">완료된 영상이 없습니다.</p>;
                            const maxViews = Math.max(...done.map(v => v.viewCount), 1);
                            return (
                              <div>
                                <p className="text-[12px] font-semibold text-[#3a3a5a] mb-3 flex items-center gap-1.5"><Eye size={12} className="text-violet-600" /> 조회수 분포</p>
                                <div className="space-y-2">
                                  {done.slice(0, 20).map(v => (
                                    <div key={v.videoId} className="flex items-center gap-3">
                                      <span className="text-xs text-[#1a1a2e] w-36 truncate shrink-0">{v.title}</span>
                                      <div className="flex-1 bg-[#f0f0f8] rounded-full h-1.5 overflow-hidden">
                                        <div className="h-full bg-violet-500 rounded-full transition-all duration-500" style={{ width: `${(v.viewCount / maxViews) * 100}%` }} />
                                      </div>
                                      <span className="text-xs text-[#1a1a2e] w-20 text-right tabular-nums shrink-0">{v.viewCount.toLocaleString()}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      {videoResultTab === 'raw' && (
                        <pre className="p-6 text-[11px] text-[#5a5a7a] overflow-auto max-h-96 font-mono leading-relaxed">{JSON.stringify(videoResults.map(v => ({ videoId: v.videoId, title: v.title, viewCount: v.viewCount, likeCount: v.likeCount, commentCount: v.commentCount, status: v.status })), null, 2)}</pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : false ? (
            /* ── 광고 분석 탭 (제거됨) ─────────────────────────────────────────── */
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Header */}
              <div>
                <h2 className="text-[22px] font-bold text-[#0f0f23] tracking-tight">채널 광고 분석</h2>
                <p className="text-[13px] text-[#5a5a7a] mt-1">채널별 광고 영상 수 및 광고 비율 분석</p>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
                {/* Left: list input */}
                <div className="xl:col-span-3 bg-white rounded-xl border border-[#e4e5f0] shadow-sm p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-[12px] font-semibold text-[#3a3a5a] flex items-center gap-1.5">
                      <List size={13} className="text-violet-600" /> Channel List
                      {adList.length > 0 && <span className="bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded text-[10px]">{adList.length}</span>}
                    </label>
                    {adList.length > 0 && (
                      <button onClick={clearAdList} className="text-xs text-[#1a1a2e] hover:text-red-600 transition-colors flex items-center gap-1"><Trash2 size={11} /> 전체 삭제</button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={adDraft}
                      onChange={e => setAdDraft(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addAdItem()}
                      placeholder="UC코드 또는 채널 URL 입력 후 Enter"
                      className="flex-1 bg-[#f0f0f8] border border-[#d4d5e2] rounded-lg px-3 py-2 text-[13px] text-[#1a1a2e] font-mono placeholder:text-[#a8a8c0] focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
                    />
                    <button onClick={addAdItem} className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs rounded-lg transition-all active:scale-95"><Plus size={13} /> 추가</button>
                  </div>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {adList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-[#1a1a2e] space-y-2"><List size={26} strokeWidth={1} /><p className="text-xs">채널을 추가하세요</p></div>
                    ) : adList.map((ch, i) => (
                      <div key={i} className="flex items-center gap-2 bg-[#f2f2f8] hover:bg-[#eeeef8] border border-[#e0e1ef] rounded-lg px-3 py-2 group transition-colors">
                        <div className="w-1.5 h-1.5 bg-[#eeeffe] rounded-full shrink-0" />
                        <span className="flex-1 text-xs font-mono text-[#5a5a7a] truncate">{ch}</span>
                        <button onClick={() => removeAdItem(i)} className="opacity-0 group-hover:opacity-100 text-[#1a1a2e] hover:text-red-600 transition-all"><X size={13} /></button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: options + run */}
                <div className="xl:col-span-2 flex flex-col gap-4">
                  {/* Date filter */}
                  <div className="bg-white rounded-xl border border-[#e4e5f0] shadow-sm p-5 space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-[#e0e1ef]">
                      <h3 className="text-xs font-medium text-[#0f0f23] flex items-center gap-1.5"><Calendar size={13} className="text-violet-600" /> 분석 기간</h3>
                      <button
                        onClick={() => setAdUseDateFilter(!adUseDateFilter)}
                        className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-all ${adUseDateFilter ? 'bg-violet-600 text-white' : 'bg-[#f0f0f8] text-[#5a5a7a]'}`}
                      >
                        {adUseDateFilter ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                    <div className={`grid grid-cols-4 gap-1.5 transition-opacity ${!adUseDateFilter ? 'opacity-30 pointer-events-none' : ''}`}>
                      {(['all', '90d', '30d', '7d'] as AnalysisPeriod[]).map(p => (
                        <button key={p} onClick={() => setAdPeriod(p)} className={`py-2 text-xs font-medium rounded-lg transition-all ${adPeriod === p ? 'bg-white text-black' : 'bg-[#f0f0f8] text-[#1a1a2e] hover:bg-[#eaeaf4] hover:text-[#1a1a2e]'}`}>
                          {periodLabels[p]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-auto">
                    <button
                      onClick={handleAdStart}
                      disabled={isProcessing}
                      className="w-full bg-violet-600 hover:bg-violet-500 text-white py-3.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2.5 transition-all active:scale-95 disabled:opacity-50"
                    >
                      {isProcessing ? <Loader2 className="animate-spin" size={16} /> : <Play fill="currentColor" size={14} />}
                      {isProcessing ? '분석 중...' : '광고 분석 시작'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Progress */}
              {isProcessing && adResults.length > 0 && (
                <div className="bg-white rounded-xl border border-[#e4e5f0] shadow-sm p-5 space-y-3 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-[#0f0f23]"><Loader2 size={14} className="animate-spin text-violet-600" /> 분석 진행 중</div>
                    <span className="text-xs text-[#5a5a7a] tabular-nums">{adDone} / {adTotal} 완료 · {adProgress}%</span>
                  </div>
                  <div className="w-full bg-white/8 rounded-full h-1 overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full transition-all duration-700" style={{ width: `${adProgress}%` }} />
                  </div>
                </div>
              )}

              {/* Results Panel */}
              {adResults.length > 0 && (
                <div className="bg-white rounded-xl border border-[#e4e5f0] shadow-sm overflow-hidden">
                  <button onClick={() => setShowAdResults(p => !p)} className="w-full flex items-center justify-between px-6 py-4 hover:bg-[#f5f5fc] transition-colors">
                    <div className="flex items-center gap-2.5">
                      {showAdResults ? <ChevronDown size={15} className="text-[#5a5a7a]" /> : <ChevronRight size={15} className="text-[#5a5a7a]" />}
                      <span className="text-sm font-medium text-[#0f0f23]">광고 분석 결과</span>
                      <span className="text-xs text-[#1a1a2e]">{adResults.filter(r => r.status === 'completed').length}개 완료</span>
                    </div>
                    {!isProcessing && adResults.some(r => r.status === 'completed') && <CheckCircle2 size={12} className="text-emerald-500" />}
                  </button>
                  {showAdResults && (
                    <div className="border-t border-[#e0e1ef]">
                      <div className="flex items-center justify-between px-6 py-3 border-b border-[#e0e1ef] bg-[#f2f3f8]/50">
                        <div className="flex gap-1">
                          {(['table','chart','raw'] as ResultTab[]).map(t => (
                            <button key={t} onClick={() => setAdResultTab(t)} className={`px-3 py-1 rounded text-xs font-medium transition-all ${adResultTab === t ? 'bg-violet-600 text-white' : 'text-[#5a5a7a] hover:text-[#5a5a7a] hover:bg-[#f0f0fa]'}`}>
                              {t === 'table' ? 'TABLE' : t === 'chart' ? 'CHART' : 'RAW DATA'}
                            </button>
                          ))}
                        </div>
                        <button onClick={handleDownloadExcel} className="flex items-center gap-1 px-2.5 py-1 bg-[#f0f0f8] hover:bg-[#eaeaf4] text-[#1a1a2e] hover:text-[#0f0f23] rounded text-xs transition-all"><FileSpreadsheet size={11} /> Excel</button>
                      </div>
                      {adResultTab === 'table' && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead className="bg-[#f4f5fb] text-[#5a5a7a] text-[11px]">
                              <tr>
                                <th className="px-6 py-3.5 font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Channel</th>
                                <th className="px-6 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Total Videos</th>
                                <th className="px-6 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Ad Videos</th>
                                <th className="px-6 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Ad Ratio</th>
                                <th className="px-6 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Avg Ad Views</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#ececf5]">
                              {adResults.map(r => (
                                <tr key={r.channelId} className="hover:bg-[#f5f5fc] transition-colors group">
                                  <td className="px-6 py-3.5 flex items-center gap-3">
                                    {r.thumbnail ? <img src={r.thumbnail} className="w-8 h-8 rounded-lg object-cover border border-[#e0e1ef] shrink-0" /> : <div className="w-8 h-8 bg-[#f0f1f8] rounded-lg flex items-center justify-center shrink-0"><Loader2 className="animate-spin text-[#1a1a2e]" size={13} /></div>}
                                    <div className="min-w-0">
                                      <div className="text-[12px] font-semibold text-[#3a3a5a] truncate max-w-[200px] group-hover:text-violet-600 transition-colors">{r.channelName}</div>
                                      <div className="text-[10px] text-[#1a1a2e] font-mono mt-0.5 truncate max-w-[180px]">{r.status === 'error' ? <span className="text-red-600">{r.error}</span> : r.channelId}</div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 text-right text-[13px] text-[#1a1a2e] tabular-nums">{r.status === 'completed' ? r.totalVideoCount.toLocaleString() : '—'}</td>
                                  <td className="px-6 py-4 text-right text-[13px] text-violet-600 tabular-nums font-medium">{r.status === 'completed' ? r.totalAdCount.toLocaleString() : '—'}</td>
                                  <td className="px-6 py-3.5 text-right">
                                    {r.status === 'completed' ? (
                                      <span className={`text-xs font-semibold ${r.adRatio >= 50 ? 'text-red-600' : r.adRatio >= 20 ? 'text-yellow-400' : 'text-emerald-600'}`}>
                                        {r.adRatio.toFixed(1)}%
                                      </span>
                                    ) : '—'}
                                  </td>
                                  <td className="px-6 py-4 text-right text-[13px] text-[#5a5a7a] tabular-nums">{r.status === 'completed' && r.avgAdViews > 0 ? r.avgAdViews.toLocaleString() : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {adResultTab === 'chart' && (
                        <div className="p-6 space-y-6">
                          {(() => {
                            const done = adResults.filter(r => r.status === 'completed');
                            if (!done.length) return <p className="text-xs text-[#1a1a2e] text-center py-8">완료된 채널이 없습니다.</p>;
                            const maxAd = Math.max(...done.map(r => r.totalAdCount), 1);
                            return (
                              <>
                                <div>
                                  <p className="text-[12px] font-semibold text-[#3a3a5a] mb-3">광고 영상 수</p>
                                  <div className="space-y-2">
                                    {done.map(r => (
                                      <div key={r.channelId} className="flex items-center gap-3">
                                        <span className="text-xs text-[#5a5a7a] w-28 truncate shrink-0">{r.channelName}</span>
                                        <div className="flex-1 bg-[#f0f0f8] rounded-full h-1.5 overflow-hidden">
                                          <div className="h-full bg-violet-500 rounded-full transition-all duration-500" style={{ width: `${(r.totalAdCount / maxAd) * 100}%` }} />
                                        </div>
                                        <span className="text-xs text-[#1a1a2e] w-16 text-right shrink-0 tabular-nums">{r.totalAdCount}</span>
                                        <span className={`text-xs w-14 text-right shrink-0 font-medium ${r.adRatio >= 50 ? 'text-red-600' : r.adRatio >= 20 ? 'text-yellow-400' : 'text-emerald-600'}`}>{r.adRatio.toFixed(1)}%</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      )}
                      {adResultTab === 'raw' && (
                        <pre className="p-6 text-[11px] text-[#5a5a7a] overflow-auto max-h-96 font-mono leading-relaxed">{JSON.stringify(adResults.map(r => ({ channelId: r.channelId, channelName: r.channelName, totalVideoCount: r.totalVideoCount, totalAdCount: r.totalAdCount, adRatio: r.adRatio, avgAdViews: r.avgAdViews, status: r.status })), null, 2)}</pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

          ) : activeTab === 'live-config' ? (
            /* ── 라이브 지표 분석 탭 (CHZZK/SOOP · softc) ──────────────────── */
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[22px] font-bold text-[#0f0f23] tracking-tight">라이브 지표 분석</h2>
                  <p className="text-[13px] text-[#5a5a7a] mt-1">CHZZK / SOOP 방송 시청자 지표 수집 · viewership.softc.one</p>
                </div>
                {liveMode === 'backend' && (localAgentRunning ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                    <span className="text-xs text-emerald-600 font-medium">로컬 에이전트 연결됨</span>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowInstallModal(true)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-orange-50 border border-orange-500/30 rounded-lg hover:bg-orange-500/20 transition-colors"
                  >
                    <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />
                    <span className="text-xs text-orange-600 font-medium">로컬 에이전트 설치 필요</span>
                  </button>
                ))}
              </div>

              {/* 로컬 에이전트 배너 */}
              {softcLocalRunning ? (
                /* SoftC 연결됨 — 최우선 */
                <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                  <span className="text-xs text-emerald-600 font-medium">SoftC 에이전트 연결됨 (port 8002) · headless=False 수집 모드</span>
                </div>
              ) : localAgentRunning ? (
                /* tubemetric-agent 연결됨 — all-in-one 설치로 충분 */
                <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                    <span className="text-xs text-emerald-600 font-medium">라이브 에이전트 연결됨 (port 8001) · Playwright 수집 모드</span>
                  </div>
                  <button
                    onClick={() => setShowSoftcInstallModal(true)}
                    className="shrink-0 px-2.5 py-1 bg-[#f0f0f8] hover:bg-orange-50 text-[#8888a8] hover:text-orange-600 text-[11px] rounded-lg transition-colors border border-[#e0e1ef]"
                  >
                    SoftC 업그레이드 (선택)
                  </button>
                </div>
              ) : (
                /* 에이전트 없음 — 설치 필요 */
                <div className="bg-orange-500/5 border border-orange-200 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircle size={16} className="text-orange-600 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-orange-600">로컬 에이전트가 필요합니다</p>
                    <p className="text-xs text-[#5a5a7a] mt-1">
                      로컬 에이전트 설치 탭에서 전체 패키지를 설치하면 바로 수집 가능합니다.
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveTab('install')}
                    className="shrink-0 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    설치 탭으로 이동
                  </button>
                </div>
              )}

              {/* SoftC 에이전트 설치 모달 */}
              {showSoftcInstallModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                  <div className="bg-white border border-[#d4d5e2] rounded-2xl p-7 w-full max-w-md mx-4 shadow-2xl">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="text-base font-semibold text-[#0f0f23] flex items-center gap-2">
                        <ShieldCheck size={18} className="text-orange-600" />
                        TubeMetric SoftC Scraper 설치
                      </h3>
                      <button onClick={() => { setShowSoftcInstallModal(false); setWaitingForSoftcAgent(false); }} className="text-[#8888a8] hover:text-[#1a1a2e]">
                        <X size={18} />
                      </button>
                    </div>
                    <div className="space-y-4 text-xs text-[#5a5a7a]">
                      <p>라이브 지표를 PC의 Chrome으로 직접 수집하는 에이전트입니다.</p>
                      <div className="bg-[#f0f0f8] rounded-lg p-3 space-y-1.5">
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-600" /> headless=False · 실제 Chrome 창 실행</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-600" /> undetected_chromedriver — bot 감지 우회</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-600" /> Windows 시작 시 자동 실행</p>
                        <p className="flex items-center gap-2"><Info size={13} className="text-[#8888a8]" /> PC에 Chrome이 설치되어 있어야 합니다</p>
                      </div>
                    </div>
                    <div className="mt-6 space-y-2">
                      {(detectOS() === 'windows' || detectOS() === 'other') && (
                        <a
                          href={SOFTC_INSTALLER_URLS.windows}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            setWaitingForSoftcAgent(true);
                            const stop = waitForSoftcAgent(() => {
                              setSoftcLocalRunning(true);
                              setShowSoftcInstallModal(false);
                              setWaitingForSoftcAgent(false);
                            });
                            setTimeout(stop, 180000);
                          }}
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          <Download size={15} />
                          Windows용 설치파일 다운로드 (.exe)
                        </a>
                      )}
                      {(detectOS() === 'macos' || detectOS() === 'other') && (
                        <a
                          href={SOFTC_INSTALLER_URLS.macos}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            setWaitingForSoftcAgent(true);
                            const stop = waitForSoftcAgent(() => {
                              setSoftcLocalRunning(true);
                              setShowSoftcInstallModal(false);
                              setWaitingForSoftcAgent(false);
                            });
                            setTimeout(stop, 180000);
                          }}
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-[#eeeffe] hover:bg-violet-100 text-violet-700 text-sm font-medium rounded-lg transition-colors"
                        >
                          <Download size={15} />
                          macOS용 설치파일 다운로드 (.pkg)
                        </a>
                      )}
                    </div>
                    {waitingForSoftcAgent && (
                      <div className="mt-4 flex items-center gap-2 text-xs text-[#8888a8]">
                        <Loader2 size={13} className="animate-spin" />
                        설치 후 에이전트 연결 대기 중... (자동으로 감지됩니다)
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 설치 모달 */}
              {showInstallModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                  <div className="bg-white border border-[#d4d5e2] rounded-2xl p-7 w-full max-w-md mx-4 shadow-2xl">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="text-base font-semibold text-[#0f0f23] flex items-center gap-2">
                        <ShieldCheck size={18} className="text-orange-600" />
                        TubeMetric Local Agent 설치
                      </h3>
                      <button onClick={() => { setShowInstallModal(false); setWaitingForAgent(false); }} className="text-[#8888a8] hover:text-[#1a1a2e]">
                        <X size={18} />
                      </button>
                    </div>

                    <div className="space-y-4 text-xs text-[#5a5a7a]">
                      <p>라이브 지표 · Instagram · TikTok 분석에 필요한 모든 에이전트를 한 번에 설치합니다.</p>
                      <div className="bg-[#f0f0f8] rounded-lg p-3 space-y-1.5">
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-600" /> Python 런타임 및 모든 패키지 내장</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-600" /> 라이브 지표(8001) + Instagram·TikTok(8003) 동시 설치</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-600" /> Windows 시작 시 자동 실행</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-600" /> 본인 IP/VPN으로 수집 (차단 우회)</p>
                      </div>
                    </div>

                    <div className="mt-6 space-y-2">
                      {/* OS별 다운로드 버튼 */}
                      {(detectOS() === 'windows' || detectOS() === 'other') && (
                        <a
                          href={ALL_INSTALLER_URLS.windows}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            setWaitingForAgent(true);
                            const stop = waitForLocalAgent(() => {
                              setLocalAgentRunning(true);
                              setShowInstallModal(false);
                              setWaitingForAgent(false);
                            });
                            // 3분 후 자동 중단
                            setTimeout(stop, 180000);
                          }}
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          <Download size={15} />
                          Windows용 설치파일 다운로드 (.exe)
                        </a>
                      )}
                      {(detectOS() === 'macos' || detectOS() === 'other') && (
                        <a
                          href={ALL_INSTALLER_URLS.macos}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            setWaitingForAgent(true);
                            const stop = waitForLocalAgent(() => {
                              setLocalAgentRunning(true);
                              setShowInstallModal(false);
                              setWaitingForAgent(false);
                            });
                            setTimeout(stop, 180000);
                          }}
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-[#eeeffe] hover:bg-violet-100 text-violet-700 text-sm font-medium rounded-lg transition-colors"
                        >
                          <Download size={15} />
                          macOS용 설치파일 다운로드 (.pkg)
                        </a>
                      )}
                    </div>

                    {waitingForAgent && (
                      <div className="mt-4 flex items-center gap-2 text-xs text-[#8888a8]">
                        <Loader2 size={13} className="animate-spin" />
                        설치 후 에이전트 연결 대기 중... (자동으로 감지됩니다)
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 가이드 토글 */}
              <div className="bg-white border border-[#e0e1ef] rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowSoftcGuide(v => !v)}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[#eeeef8] transition-colors"
                >
                  <p className="text-[12px] font-semibold text-[#3a3a5a] flex items-center gap-2">
                    <Info size={13} className="text-orange-600" />
                    로컬 에이전트 사용 가이드
                  </p>
                  <span className={`text-[#8888a8] transition-transform ${showSoftcGuide ? 'rotate-180' : ''}`}>▾</span>
                </button>

                {showSoftcGuide && (
                  <div className="px-5 pb-5 space-y-3 border-t border-[#e0e1ef]">
                    <div className="space-y-2 text-xs text-[#1a1a2e] pt-3">
                      <p className="font-medium text-[#0f0f23]">로컬 에이전트 (TubeMetric SoftC Scraper)</p>
                      <p>① 위 [설치하기]에서 OS에 맞는 파일을 다운받아 설치합니다.</p>
                      <p>② 설치 완료 후 자동 실행되며 포트 <code className="bg-white/8 px-1.5 py-0.5 rounded">8002</code>에서 서버가 시작됩니다.</p>
                      <p>③ 연결됨 표시가 나타나면 크리에이터 ID를 입력하고 수집을 시작합니다.</p>
                      <div className="bg-[#f0f0f8] rounded-lg p-3 space-y-1.5 mt-2">
                        <p className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-600 shrink-0" /> headless=False — 실제 Chrome 창이 열려 수집합니다</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-600 shrink-0" /> undetected_chromedriver — bot 탐지 우회</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-600 shrink-0" /> 페이지네이션 자동 처리 · 100행 기준 강제 다음 페이지</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-600 shrink-0" /> 실패 시 자동 재시도 (최대 2회)</p>
                        <p className="flex items-center gap-2"><Info size={12} className="text-[#8888a8] shrink-0" /> PC에 Google Chrome이 설치되어 있어야 합니다</p>
                        <p className="flex items-center gap-2"><Info size={12} className="text-[#8888a8] shrink-0" /> Windows 시작 시 자동 실행, macOS LaunchAgent 등록</p>
                      </div>
                      <p className="text-[#8888a8]">크리에이터 ID 형식: <code className="bg-white/8 px-1 rounded">chzzk:채널ID</code> 또는 <code className="bg-white/8 px-1 rounded">soop:아이디</code></p>
                    </div>
                  </div>
                )}
              </div>

              {/* 작동 방식 (가이드 내부로 이동 — 하위 호환용 빈 div 유지) */}
              <div className="bg-white border border-[#e0e1ef] rounded-xl p-5 space-y-3" style={{display:'none'}}>
                <p className="text-[12px] font-semibold text-[#3a3a5a] flex items-center gap-2"><Tv2 size={13} className="text-orange-500" /> 작동 방식</p>
                <div className="space-y-1.5 text-xs text-[#1a1a2e]">
                  <p>① 아래에서 플랫폼(CHZZK/SOOP)과 크리에이터 ID를 입력합니다.</p>
                  <p>② 로컬 에이전트가 <strong>Chrome</strong>으로 <code className="bg-white/8 px-1.5 py-0.5 rounded">viewership.softc.one</code>에서 데이터를 수집합니다.</p>
                  <p>③ 평균 시청자 수, 최고 시청자 수, 방송 시간 등의 지표가 표시됩니다.</p>
                </div>
                <div className="border-t border-[#e0e1ef] pt-3 text-[10px] text-[#5a5a7a]">
                  입력 형식: <code className="bg-white/8 px-1 rounded">크리에이터ID</code> 또는 <code className="bg-white/8 px-1 rounded">chzzk:ID</code> / <code className="bg-white/8 px-1 rounded">soop:ID</code>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
                {/* Left: creator input */}
                <div className="xl:col-span-3 bg-white rounded-xl border border-[#e4e5f0] shadow-sm p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-[12px] font-semibold text-[#3a3a5a] flex items-center gap-1.5">
                      <Tv2 size={13} className="text-orange-500" /> Creator List
                      {liveList.length > 0 && <span className="bg-orange-500/20 text-orange-600 px-1.5 py-0.5 rounded text-[10px]">{liveList.length}</span>}
                    </label>
                    {liveList.length > 0 && (
                      <button onClick={clearLiveList} className="text-xs text-[#5a5a7a] hover:text-red-600 transition-colors flex items-center gap-1"><Trash2 size={11} /> 전체 삭제</button>
                    )}
                  </div>


                  <div className="flex gap-2">
                    <CreatorAutocomplete
                      value={liveDraft}
                      onChange={setLiveDraft}
                      onCommit={addLiveItem}
                      onAddMultiple={vals => { vals.forEach(v => { setLiveInput(prev => prev ? prev + '\n' + v : v); }); setLiveDraft(''); }}
                      creators={creators}
                      field="live"
                      placeholder="CHZZK·SOOP URL 또는 크리에이터명 입력"
                      className="w-full bg-[#f0f0f8] border border-[#d4d5e2] rounded-lg px-3 py-2 text-[13px] text-[#1a1a2e] font-mono placeholder:text-[#a8a8c0] focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20"
                    />
                    <button onClick={addLiveItem} className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg transition-all active:scale-95"><Plus size={13} /> 추가</button>
                  </div>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {liveList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-[#5a5a7a] space-y-2"><Tv2 size={26} strokeWidth={1} /><p className="text-xs">크리에이터를 추가하세요</p></div>
                    ) : liveList.map((u, i) => (
                      <div key={i} className="flex items-center gap-2 bg-[#f2f2f8] hover:bg-[#eeeef8] border border-[#e0e1ef] rounded-lg px-3 py-2 group transition-colors">
                        <span className={`text-xs shrink-0 px-1.5 py-0.5 rounded ${u.includes('soop') ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>
                          {u.includes('soop:') ? 'SOOP' : u.includes('chzzk:') ? 'CHZZK' : livePlatform.toUpperCase()}
                        </span>
                        <span className="flex-1 text-xs font-mono text-[#1a1a2e] truncate">{u.includes(':') ? u.split(':')[1] : u}</span>
                        <button onClick={() => removeLiveItem(i)} className="opacity-0 group-hover:opacity-100 text-[#5a5a7a] hover:text-red-600 transition-all"><X size={13} /></button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: date range + run */}
                <div className="xl:col-span-2 flex flex-col gap-4">
                  {/* 날짜 범위 */}
                  <div className="bg-white rounded-xl border border-[#e4e5f0] shadow-sm p-5 space-y-4">
                    <h3 className="text-xs font-medium text-[#0f0f23] flex items-center gap-1.5"><CalendarDays size={13} className="text-orange-500" /> 수집 기간</h3>
                    <div className="space-y-3">
                      <div className="group relative bg-[#f0f0f8] border border-[#e0e1ef] hover:border-orange-500/30 rounded-xl p-3 transition-all">
                        <label className="absolute -top-2 left-3 bg-white px-1.5 text-xs text-[#5a5a7a] group-hover:text-orange-600">Start</label>
                        <div className="flex items-center gap-2">
                          <Calendar size={13} className="text-orange-500 shrink-0" />
                          <input
                            type="date"
                            value={liveStartDate}
                            onChange={e => setLiveStartDate(e.target.value)}
                            className="w-full bg-transparent border-none text-[#1a1a2e] text-sm focus:ring-0 cursor-pointer outline-none [color-scheme:light]"
                          />
                        </div>
                      </div>
                      <div className="group relative bg-[#f0f0f8] border border-[#e0e1ef] hover:border-orange-500/30 rounded-xl p-3 transition-all">
                        <label className="absolute -top-2 left-3 bg-white px-1.5 text-xs text-[#5a5a7a] group-hover:text-orange-600">End</label>
                        <div className="flex items-center gap-2">
                          <Calendar size={13} className="text-orange-500 shrink-0" />
                          <input
                            type="date"
                            value={liveEndDate}
                            onChange={e => setLiveEndDate(e.target.value)}
                            className="w-full bg-transparent border-none text-[#1a1a2e] text-sm focus:ring-0 cursor-pointer outline-none [color-scheme:light]"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Status */}
                  {liveJobStatus !== 'idle' && (
                    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-medium ${
                      liveJobStatus === 'submitting' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                      liveJobStatus === 'done'       ? 'bg-emerald-50 text-emerald-700 border border-emerald-500/20' :
                                                       'bg-red-50 text-red-700 border border-red-500/20'
                    }`}>
                      {liveJobStatus === 'submitting' && <Loader2 size={13} className="animate-spin shrink-0" />}
                      {liveJobStatus === 'done'  && <CheckCircle2 size={13} className="shrink-0" />}
                      {liveJobStatus === 'error' && <AlertCircle size={13} className="shrink-0" />}
                      <span>{{
                        submitting: softcLocalRunning ? 'softc.one에서 수집 중... (headless=False Chrome)' : 'softc.one에서 수집 중... (Playwright)',
                        done:       '완료! 아래에서 결과를 확인하세요.',
                        error:      liveErrorMsg ? `오류: ${liveErrorMsg}` : '백엔드 연결 실패 또는 수집 오류',
                        idle:       '',
                      }[liveJobStatus]}</span>
                    </div>
                  )}

                  <div className="mt-auto">
                    <button
                      onClick={handleLiveRequest}
                      disabled={liveJobStatus === 'submitting' || (!softcLocalRunning && !localAgentRunning)}
                      className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white py-3.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2.5 transition-all active:scale-95"
                    >
                      {liveJobStatus === 'submitting'
                        ? <Loader2 className="animate-spin" size={16} />
                        : <Tv2 size={16} />}
                      {liveJobStatus === 'submitting' ? '수집 중...' : '방송 지표 수집'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Results */}
              {liveResults.length > 0 && (
                <div className="bg-white rounded-xl border border-[#e4e5f0] shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-[#e0e1ef]">
                    <div className="flex items-center gap-2.5">
                      <Tv2 size={14} className="text-orange-500" />
                      <span className="text-sm font-medium text-[#0f0f23]">수집 결과</span>
                      <span className="text-xs text-[#5a5a7a]">{liveResults.length}개 크리에이터</span>
                    </div>
                    <button onClick={() => { const hdr = '크리에이터\t플랫폼\t방송수\t평균시청자\t최고시청자\t총방송시간(h)'; const rows = liveResults.map(r => [r.creatorId, r.platform, r.streamCount, r.avgViewers, r.peakViewers, (r.totalDurationMin/60).toFixed(1)].join('\t')); navigator.clipboard.writeText([hdr, ...rows].join('\n')); }} className="flex items-center gap-1 px-2.5 py-1 bg-[#f0f0f8] hover:bg-[#eaeaf4] text-[#1a1a2e] hover:text-[#0f0f23] rounded text-xs transition-all"><Clipboard size={11} /> 복사</button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-[#f4f5fb] text-[#5a5a7a] text-[11px]">
                        <tr>
                          <th className="px-6 py-3.5 font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Creator</th>
                          <th className="px-6 py-3.5 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Platform</th>
                          <th className="px-6 py-3.5 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">방송 수</th>
                          <th className="px-6 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">평균 시청자</th>
                          <th className="px-6 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">최고 시청자</th>
                          <th className="px-6 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">총 방송시간</th>
                          <th className="px-6 py-3.5 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Detail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#ececf5]">
                        {liveResults.map(r => (
                          <tr key={`${r.platform}-${r.creatorId}`} className="hover:bg-[#f5f5fc] transition-colors group">
                            <td className="px-6 py-3.5">
                              <div className="flex items-center gap-2.5">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${r.platform === 'CHZZK' ? 'bg-blue-500/20' : 'bg-purple-500/20'}`}>
                                  <Tv2 size={14} className={r.platform === 'CHZZK' ? 'text-blue-400' : 'text-purple-400'} />
                                </div>
                                <div>
                                  <div className="text-xs font-medium text-[#1a1a2e] group-hover:text-orange-600 transition-colors">{r.creatorId}</div>
                                  {r.error && <div className="text-[10px] text-red-600 mt-0.5">{r.error}</div>}
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              <span className={`text-[10px] px-2 py-0.5 rounded ${r.platform === 'CHZZK' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'}`}>
                                {r.platform}
                              </span>
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              <span className="bg-[#f0f0f8] px-2.5 py-1 rounded text-[#1a1a2e] text-xs border border-[#e0e1ef]">{r.streamCount}</span>
                            </td>
                            <td className="px-6 py-3.5 text-right text-sm font-semibold text-orange-600 tabular-nums">{r.avgViewers.toLocaleString()}</td>
                            <td className="px-6 py-4 text-right text-[13px] text-red-600 tabular-nums font-medium">{r.peakViewers.toLocaleString()}</td>
                            <td className="px-6 py-4 text-right text-[13px] text-[#1a1a2e] tabular-nums">{Math.round(r.totalDurationMin / 60)}시간 {r.totalDurationMin % 60}분</td>
                            <td className="px-6 py-3.5 text-center">
                              <button
                                onClick={() => setSelectedLiveCreator(r)}
                                disabled={!r.streamCount}
                                className="p-1.5 bg-[#f0f0f8] hover:bg-orange-600 hover:text-white text-[#1a1a2e] rounded-lg transition-all disabled:opacity-20 active:scale-90"
                              >
                                <Eye size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

          ) : activeTab === 'instagram-config' ? (
            /* ── Instagram 릴스 분석 탭 ──────────────────────────────────────── */
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[22px] font-bold text-[#0f0f23] tracking-tight">Instagram 릴스 분석</h2>
                  <p className="text-[13px] text-[#5a5a7a] mt-1">로컬 서버를 통해 릴스 조회수·좋아요·댓글 수집</p>
                </div>
                {igLocalRunning ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                    <span className="text-xs text-emerald-600 font-medium">로컬 에이전트 연결됨 (port 8003)</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" />
                    <span className="text-xs text-amber-400 font-medium">로컬 에이전트 필요</span>
                  </div>
                )}
              </div>

              {/* Instagram 에이전트 설치 배너 */}
              {!igLocalRunning && (
                <div className="bg-orange-500/5 border border-orange-200 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircle size={16} className="text-orange-600 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-orange-300">Instagram 로컬 에이전트가 필요합니다</p>
                    <p className="text-xs text-[#5a5a7a] mt-1">
                      PC에 에이전트를 설치하면 Chrome으로 직접 수집합니다. GitHub 토큰 없이 즉시 사용 가능합니다.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowInstagramInstallModal(true)}
                    className="shrink-0 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    설치하기
                  </button>
                </div>
              )}
              {igLocalRunning && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                  <span className="text-xs text-emerald-600 font-medium">로컬 에이전트 연결됨 (port 8003)</span>
                </div>
              )}

              {/* Instagram 에이전트 설치 모달 */}
              {showInstagramInstallModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                  <div className="bg-white border border-[#d4d5e2] rounded-2xl p-7 w-full max-w-md mx-4 shadow-2xl">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="text-base font-semibold text-[#0f0f23] flex items-center gap-2">
                        <ShieldCheck size={18} className="text-orange-600" />
                        TubeMetric Instagram Scraper 설치
                      </h3>
                      <button onClick={() => { setShowInstagramInstallModal(false); setWaitingForInstagramAgent(false); }} className="text-[#8888a8] hover:text-[#1a1a2e]">
                        <X size={18} />
                      </button>
                    </div>
                    <div className="space-y-4 text-xs text-[#5a5a7a]">
                      <p>라이브 지표 · Instagram · TikTok 분석에 필요한 모든 에이전트를 한 번에 설치합니다.</p>
                      <div className="bg-[#f0f0f8] rounded-lg p-3 space-y-1.5">
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-600" /> Python 런타임 및 모든 패키지 내장</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-600" /> 라이브 지표(8001) + Instagram·TikTok(8003) 동시 설치</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-600" /> Windows 시작 시 자동 실행</p>
                        <p className="flex items-center gap-2"><Info size={13} className="text-[#8888a8]" /> PC에 Chrome이 설치되어 있어야 합니다</p>
                      </div>
                    </div>
                    <div className="mt-6 space-y-2">
                      {(detectOS() === 'windows' || detectOS() === 'other') && (
                        <a
                          href={ALL_INSTALLER_URLS.windows}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            setWaitingForInstagramAgent(true);
                            const stop = waitForInstagramAgent(() => {
                              setIgLocalRunning(true);
                              setShowInstagramInstallModal(false);
                              setWaitingForInstagramAgent(false);
                            });
                            setTimeout(stop, 180000);
                          }}
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          <Download size={15} />
                          Windows용 설치파일 다운로드 (.exe)
                        </a>
                      )}
                      {(detectOS() === 'macos' || detectOS() === 'other') && (
                        <a
                          href={ALL_INSTALLER_URLS.macos}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            setWaitingForInstagramAgent(true);
                            const stop = waitForInstagramAgent(() => {
                              setIgLocalRunning(true);
                              setShowInstagramInstallModal(false);
                              setWaitingForInstagramAgent(false);
                            });
                            setTimeout(stop, 180000);
                          }}
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-[#eeeffe] hover:bg-violet-100 text-violet-700 text-sm font-medium rounded-lg transition-colors"
                        >
                          <Download size={15} />
                          macOS용 설치파일 다운로드 (.pkg)
                        </a>
                      )}
                    </div>
                    {waitingForInstagramAgent && (
                      <div className="mt-4 flex items-center gap-2 text-xs text-[#8888a8]">
                        <Loader2 size={13} className="animate-spin" />
                        설치 후 에이전트 연결 대기 중... (자동으로 감지됩니다)
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 작동 방식 안내 */}
              <div className="bg-white border border-[#e0e1ef] rounded-xl p-5 space-y-3">
                <p className="text-xs font-medium text-[#5a5a7a] flex items-center gap-2"><Activity size={13} className="text-violet-600" /> 작동 방식</p>
                {igLocalRunning ? (
                  <div className="space-y-1.5 text-xs text-[#5a5a7a]">
                    <p>① 아래에서 계정을 입력하고 <strong className="text-[#5a5a7a]">릴스 수집</strong>을 클릭합니다.</p>
                    <p>② 로컬 PC의 <code className="bg-white/8 px-1.5 py-0.5 rounded">instagram_server.py</code>(port 8003)가 Chrome으로 릴스 탭 직접 크롤링.</p>
                    <p>③ 완료 시 결과가 바로 아래 패널에 표시됩니다.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5 text-xs text-[#5a5a7a]">
                    <p>① 아래에서 계정을 입력하고 <strong className="text-[#5a5a7a]">수집 요청</strong>을 클릭합니다.</p>
                    <p>② GitHub <code className="bg-white/8 px-1.5 py-0.5 rounded">results/queue/</code>에 요청 파일이 생성됩니다.</p>
                    <p>③ 로컬 PC의 <code className="bg-white/8 px-1.5 py-0.5 rounded">local_server.py</code>가 감지 → Chrome으로 릴스 탭 직접 크롤링.</p>
                    <p>④ 완료 후 GitHub에 결과 push → 아래 결과 패널에 자동 반영.</p>
                  </div>
                )}
                <div className="border-t border-[#e0e1ef] pt-3 text-xs space-y-1">
                  {igLocalRunning ? (
                    <p className="text-emerald-600">로컬 에이전트 연결됨 — GitHub 토큰 없이 즉시 수집 가능합니다.</p>
                  ) : (
                    <p className="text-[#5a5a7a]">로컬 PC에서 실제 Chrome을 실행하므로 봇 감지 없이 공개 계정을 수집합니다.</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
                {/* Left: list input */}
                <div className="xl:col-span-3 bg-white rounded-xl border border-[#e4e5f0] shadow-sm p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-[12px] font-semibold text-[#3a3a5a] flex items-center gap-1.5">
                      <Instagram size={13} className="text-pink-500" /> Account List
                      {igList.length > 0 && <span className="bg-pink-500/20 text-pink-600 px-1.5 py-0.5 rounded text-[10px]">{igList.length}</span>}
                    </label>
                    {igList.length > 0 && (
                      <button onClick={clearIgList} className="text-xs text-[#1a1a2e] hover:text-red-600 transition-colors flex items-center gap-1"><Trash2 size={11} /> 전체 삭제</button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <CreatorAutocomplete
                      value={igDraft}
                      onChange={setIgDraft}
                      onCommit={addIgItem}
                      creators={creators}
                      field="instagram"
                      placeholder="@username · 크리에이터명 입력 후 Enter"
                      className="w-full bg-[#f0f0f8] border border-[#d4d5e2] rounded-lg px-3 py-2 text-[13px] text-[#1a1a2e] font-mono placeholder:text-[#a8a8c0] focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/20"
                    />
                    <button onClick={addIgItem} className="flex items-center gap-1.5 px-3 py-2 bg-pink-600 hover:bg-pink-500 text-white text-xs rounded-lg transition-all active:scale-95"><Plus size={13} /> 추가</button>
                  </div>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {igList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-[#1a1a2e] space-y-2"><Instagram size={26} strokeWidth={1} /><p className="text-xs">계정을 추가하세요</p></div>
                    ) : igList.map((u, i) => (
                      <div key={i} className="flex items-center gap-2 bg-[#f2f2f8] hover:bg-[#eeeef8] border border-[#e0e1ef] rounded-lg px-3 py-2 group transition-colors">
                        <span className="text-pink-600 text-xs shrink-0">@</span>
                        <span className="flex-1 text-xs font-mono text-[#5a5a7a] truncate">{u}</span>
                        <button onClick={() => removeIgItem(i)} className="opacity-0 group-hover:opacity-100 text-[#1a1a2e] hover:text-red-600 transition-all"><X size={13} /></button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: options + run */}
                <div className="xl:col-span-2 flex flex-col gap-4">
                  {/* Amount slider */}
                  <div className="bg-white rounded-xl border border-[#e4e5f0] shadow-sm p-5 space-y-4">
                    <h3 className="text-xs font-medium text-[#0f0f23] flex items-center gap-1.5"><Activity size={13} className="text-pink-500" /> 수집 개수 설정</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between text-xs">
                        <span className="text-[#5a5a7a]">계정당 릴스 수</span>
                        <span className="text-pink-600 font-medium">{igAmount}개</span>
                      </div>
                      <input
                        type="range" min={5} max={50} step={5}
                        value={igAmount}
                        onChange={e => setIgAmount(Number(e.target.value))}
                        className="w-full appearance-none bg-[#eeeef6] h-1.5 rounded-full accent-pink-500"
                      />
                      <div className="flex justify-between text-[10px] text-[#1a1a2e]">
                        <span>5개</span><span>50개</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-[#1a1a2e]">최신 릴스부터 수집합니다. 많을수록 시간이 오래 걸립니다.</p>
                    <div className="border-t border-[#e0e1ef] pt-3 space-y-2">
                      <p className="text-xs text-[#5a5a7a]">Headless 모드</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setIgHeadless(true)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${igHeadless ? 'bg-pink-600 text-white' : 'bg-[#f0f0f8] text-[#8888a8] hover:bg-[#eaeaf4]'}`}
                        >ON</button>
                        <button
                          onClick={() => setIgHeadless(false)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${!igHeadless ? 'bg-[#eeeffe] text-violet-700' : 'bg-[#f0f0f8] text-[#8888a8] hover:bg-[#eaeaf4]'}`}
                        >OFF</button>
                      </div>
                      <p className="text-[10px] text-[#1a1a2e]">OFF 시 브라우저 창이 열림 (좋아요·댓글 수집 불안정 시 사용)</p>
                    </div>
                  </div>

                  {/* Status */}
                  {igJobStatus !== 'idle' && (
                    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-medium ${
                      igJobStatus === 'pending'    ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
                      igJobStatus === 'submitting' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                      igJobStatus === 'done'       ? 'bg-emerald-50 text-emerald-700 border border-emerald-500/20' :
                                                     'bg-red-50 text-red-700 border border-red-500/20'
                    }`}>
                      {(igJobStatus === 'submitting' || igJobStatus === 'pending') && <Loader2 size={13} className="animate-spin shrink-0" />}
                      {igJobStatus === 'done'  && <CheckCircle2 size={13} className="shrink-0" />}
                      {igJobStatus === 'error' && <AlertCircle size={13} className="shrink-0" />}
                      <span>{{
                        submitting: igLocalRunning ? '수집 중...' : '요청 전송 중...',
                        pending:    '로컬 서버 처리 중... (10초마다 확인)',
                        done:       '완료! 아래에서 결과를 확인하세요.',
                        error:      igLocalRunning ? '수집 실패 — instagram_server.py 실행 여부 확인' : '요청 실패 — 백엔드 연결 또는 local_server.py 실행 여부 확인',
                        idle:       '',
                      }[igJobStatus]}</span>
                    </div>
                  )}

                  <div className="mt-auto">
                    <button
                      onClick={handleIgRequest}
                      disabled={igJobStatus === 'submitting' || igJobStatus === 'pending'}
                      className="w-full bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white py-3.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2.5 transition-all active:scale-95"
                    >
                      {(igJobStatus === 'submitting' || igJobStatus === 'pending')
                        ? <Loader2 className="animate-spin" size={16} />
                        : <Instagram size={16} />}
                      {igJobStatus === 'pending' ? '로컬 서버 처리 대기 중...' : igLocalRunning ? '릴스 수집' : '수집 요청 전송'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Results */}
              {(igResults.length > 0 || igResultsLoading) && (
                <div className="bg-white rounded-xl border border-[#e4e5f0] shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-[#e0e1ef]">
                    <div className="flex items-center gap-2.5">
                      <Instagram size={14} className="text-pink-500" />
                      <span className="text-sm font-medium text-[#0f0f23]">수집 결과</span>
                      <span className="text-xs text-[#1a1a2e]">{igResults.length}개 계정</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => { const hdr = '계정\t릴스수\t평균조회수\t평균좋아요\t평균댓글\t수집일'; const rows = igResults.map(r => [r.username, r.reelCount, r.avgViews, r.avgLikes, r.avgComments, r.scrapedAt ? new Date(r.scrapedAt).toLocaleDateString('ko-KR') : ''].join('\t')); navigator.clipboard.writeText([hdr, ...rows].join('\n')); }} className="flex items-center gap-1 px-2.5 py-1.5 bg-[#f0f0f8] hover:bg-[#eaeaf4] rounded-lg text-xs text-[#1a1a2e] hover:text-[#0f0f23] transition-all"><Clipboard size={11} /> 복사</button>
                      <button onClick={loadIgResults} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f0f0f8] hover:bg-[#eaeaf4] rounded-lg text-xs text-[#1a1a2e] hover:text-[#0f0f23] transition-all">
                        {igResultsLoading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} 새로고침
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-[#f4f5fb] text-[#5a5a7a] text-[11px]">
                        <tr>
                          <th className="px-6 py-3.5 font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Account</th>
                          <th className="px-6 py-3.5 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Reels</th>
                          <th className="px-6 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Avg Views</th>
                          <th className="px-6 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Avg Likes</th>
                          <th className="px-6 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Avg Comments</th>
                          <th className="px-6 py-3.5 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Scraped At</th>
                          <th className="px-6 py-3.5 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Detail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#ececf5]">
                        {igResultsLoading ? (
                          <tr><td colSpan={7} className="py-16 text-center"><Loader2 className="animate-spin mx-auto text-[#1a1a2e]" size={22} /></td></tr>
                        ) : igResults.map(r => (
                          <tr key={r.username} className="hover:bg-[#f5f5fc] transition-colors group">
                            <td className="px-6 py-3.5">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center shrink-0">
                                  <span className="text-white text-xs font-bold">{r.username[0]?.toUpperCase()}</span>
                                </div>
                                <div>
                                  <div className="text-[12px] font-semibold text-[#3a3a5a] group-hover:text-pink-600 transition-colors">@{r.username}</div>
                                  {r.error && <div className="text-[10px] text-red-600 mt-0.5">{r.error}</div>}
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              <span className="bg-[#f0f0f8] px-2.5 py-1 rounded text-[#1a1a2e] text-xs border border-[#e0e1ef]">{r.reelCount}</span>
                            </td>
                            <td className="px-6 py-3.5 text-right text-sm font-semibold text-pink-600 tabular-nums">{r.avgComments.toLocaleString()}</td>
                            <td className="px-6 py-4 text-right text-[13px] text-violet-600 tabular-nums">{r.avgLikes.toLocaleString()}</td>
                            <td className="px-6 py-3.5 text-right text-sm font-semibold text-[#1a1a2e] tabular-nums">{r.avgViews.toLocaleString()}</td>
                            <td className="px-6 py-4 text-center text-[13px] text-[#1a1a2e] font-mono">
                              {new Date(r.scrapedAt).toLocaleDateString('ko-KR')}
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              <button
                                onClick={() => setSelectedIgUser(r)}
                                disabled={!r.reelCount}
                                className="p-1.5 bg-[#f0f0f8] hover:bg-pink-600 hover:text-white text-[#1a1a2e] rounded-lg transition-all disabled:opacity-20 active:scale-90"
                              >
                                <Eye size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </div>

          ) : activeTab === 'tiktok-config' ? (
            /* ── TikTok 영상 분석 탭 ──────────────────────────────────────── */
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[22px] font-bold text-[#0f0f23] tracking-tight">TikTok 영상 분석</h2>
                  <p className="text-[13px] text-[#5a5a7a] mt-1">클라우드 백엔드(yt-dlp)를 통해 조회수·좋아요·댓글 수집</p>
                </div>
                {isBackendAvailable() ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                    <span className="text-xs text-emerald-600 font-medium">클라우드 연결</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <span className="w-1.5 h-1.5 bg-red-400 rounded-full" />
                    <span className="text-xs text-red-600 font-medium">백엔드 필요</span>
                  </div>
                )}
              </div>

              {/* 에이전트 상태 배너 */}
              {!igLocalRunning && (
                <div className="bg-cyan-500/5 border border-cyan-200 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircle size={16} className="text-cyan-700 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-cyan-300">TikTok 로컬 에이전트가 필요합니다</p>
                    <p className="text-xs text-[#5a5a7a] mt-1">
                      PC에 에이전트를 설치하면 Chrome으로 직접 수집합니다. 고정됨 영상 제외 평균 조회수 계산.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowTikTokInstallModal(true)}
                    className="shrink-0 px-3 py-1.5 bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    설치하기
                  </button>
                </div>
              )}
              {igLocalRunning && !tkAgentReady && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircle size={16} className="text-amber-400 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-amber-300">에이전트 업데이트가 필요합니다</p>
                    <p className="text-xs text-[#5a5a7a] mt-1">
                      현재 설치된 에이전트가 TikTok 수집을 지원하지 않습니다. 최신 버전으로 재설치하세요.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowTikTokInstallModal(true)}
                    className="shrink-0 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    업데이트
                  </button>
                </div>
              )}

              {/* TikTok 설치 모달 */}
              {showTikTokInstallModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                  <div className="bg-white border border-[#d4d5e2] rounded-2xl p-7 w-full max-w-md mx-4 shadow-2xl">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="text-base font-semibold text-[#0f0f23] flex items-center gap-2">
                        <ShieldCheck size={18} className="text-cyan-700" />
                        TubeMetric TikTok 에이전트 설치
                      </h3>
                      <button onClick={() => { setShowTikTokInstallModal(false); setWaitingForTikTokInstall(false); }} className="text-[#8888a8] hover:text-[#1a1a2e]">
                        <X size={18} />
                      </button>
                    </div>
                    <div className="space-y-4 text-xs text-[#5a5a7a]">
                      <p>라이브 지표 · Instagram · TikTok 분석에 필요한 모든 에이전트를 한 번에 설치합니다.</p>
                      <div className="bg-[#f0f0f8] rounded-lg p-3 space-y-1.5">
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-600" /> Python 런타임 및 모든 패키지 내장</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-600" /> 라이브 지표(8001) + Instagram·TikTok(8003) 동시 설치</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-600" /> yt-dlp 쿠키 방식 — bot 감지 우회</p>
                        <p className="flex items-center gap-2"><Info size={13} className="text-[#8888a8]" /> PC에 Chrome이 설치되어 있어야 합니다</p>
                      </div>
                    </div>
                    <div className="mt-6 space-y-2">
                      {(detectOS() === 'windows' || detectOS() === 'other') && (
                        <a
                          href={ALL_INSTALLER_URLS.windows}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            setWaitingForTikTokInstall(true);
                            const stop = waitForInstagramAgent(() => {
                              setIgLocalRunning(true);
                              checkInstagramAgentTikTokSupport().then(ok => setTkAgentReady(ok));
                              setShowTikTokInstallModal(false);
                              setWaitingForTikTokInstall(false);
                            });
                            setTimeout(stop, 180000);
                          }}
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          <Download size={15} />
                          Windows용 설치파일 다운로드 (.exe)
                        </a>
                      )}
                      {(detectOS() === 'macos' || detectOS() === 'other') && (
                        <a
                          href={ALL_INSTALLER_URLS.macos}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            setWaitingForTikTokInstall(true);
                            const stop = waitForInstagramAgent(() => {
                              setIgLocalRunning(true);
                              checkInstagramAgentTikTokSupport().then(ok => setTkAgentReady(ok));
                              setShowTikTokInstallModal(false);
                              setWaitingForTikTokInstall(false);
                            });
                            setTimeout(stop, 180000);
                          }}
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-[#eeeffe] hover:bg-violet-100 text-violet-700 text-sm font-medium rounded-lg transition-colors"
                        >
                          <Download size={15} />
                          macOS용 설치파일 다운로드 (.pkg)
                        </a>
                      )}
                    </div>
                    {waitingForTikTokInstall && (
                      <div className="mt-4 flex items-center gap-2 text-xs text-[#8888a8]">
                        <Loader2 size={13} className="animate-spin" />
                        설치 후 에이전트 연결 대기 중... (자동으로 감지됩니다)
                      </div>
                    )}
                  </div>
                </div>
              )}
              {tkAgentReady && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                  <span className="text-xs text-emerald-600 font-medium">TikTok 에이전트 연결됨</span>
                </div>
              )}

              {/* 작동 방식 */}
              <div className="bg-white border border-[#e0e1ef] rounded-xl p-5 space-y-3">
                <p className="text-xs font-medium text-[#5a5a7a] flex items-center gap-2"><Activity size={13} className="text-cyan-500" /> 작동 방식</p>
                {tkAgentReady ? (
                  <div className="space-y-1.5 text-xs text-[#5a5a7a]">
                    <p>① 아래에서 TikTok 계정을 입력하고 <strong className="text-[#5a5a7a]">수집 시작</strong>을 클릭합니다.</p>
                    <p>② 로컬 에이전트가 Chrome으로 TikTok 프로필을 직접 크롤링합니다.</p>
                    <p>③ 고정됨(Pinned) 영상은 제외하고 평균 조회수를 계산합니다.</p>
                    <p>④ 완료 시 결과가 바로 아래 패널에 표시됩니다.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5 text-xs text-[#5a5a7a]">
                    <p>① 위 배너에서 TikTok 로컬 에이전트를 설치합니다.</p>
                    <p>② 에이전트 실행 후 TikTok 계정을 입력하고 수집을 시작합니다.</p>
                    <p>③ Chrome으로 직접 크롤링하므로 bot 감지를 우회합니다.</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
                {/* Left: list input */}
                <div className="xl:col-span-3 bg-white rounded-xl border border-[#e4e5f0] shadow-sm p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-[12px] font-semibold text-[#3a3a5a] flex items-center gap-1.5">
                      <Music size={13} className="text-cyan-500" /> Account List
                      {tkList.length > 0 && <span className="bg-cyan-500/20 text-cyan-700 px-1.5 py-0.5 rounded text-[10px]">{tkList.length}</span>}
                    </label>
                    {tkList.length > 0 && (
                      <button onClick={clearTkList} className="text-xs text-[#1a1a2e] hover:text-red-600 transition-colors flex items-center gap-1"><Trash2 size={11} /> 전체 삭제</button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <CreatorAutocomplete
                      value={tkDraft}
                      onChange={setTkDraft}
                      onCommit={addTkItem}
                      creators={creators}
                      field="tiktok"
                      placeholder="@username · 크리에이터명 입력 후 Enter"
                      className="w-full bg-[#f0f0f8] border border-[#d4d5e2] rounded-lg px-3 py-2 text-[13px] text-[#1a1a2e] font-mono placeholder:text-[#a8a8c0] focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20"
                    />
                    <button onClick={addTkItem} className="flex items-center gap-1.5 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs rounded-lg transition-all active:scale-95"><Plus size={13} /> 추가</button>
                  </div>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {tkList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-[#1a1a2e] space-y-2"><Music size={26} strokeWidth={1} /><p className="text-xs">계정을 추가하세요</p></div>
                    ) : tkList.map((u, i) => (
                      <div key={i} className="flex items-center gap-2 bg-[#f2f2f8] hover:bg-[#eeeef8] border border-[#e0e1ef] rounded-lg px-3 py-2 group transition-colors">
                        <span className="text-cyan-600 text-xs shrink-0">@</span>
                        <span className="flex-1 text-xs font-mono text-[#5a5a7a] truncate">{u}</span>
                        <button onClick={() => removeTkItem(i)} className="opacity-0 group-hover:opacity-100 text-[#1a1a2e] hover:text-red-600 transition-all"><X size={13} /></button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: options + run */}
                <div className="xl:col-span-2 flex flex-col gap-4">
                  <div className="bg-white rounded-xl border border-[#e4e5f0] shadow-sm p-5 space-y-4">
                    <h3 className="text-xs font-medium text-[#0f0f23] flex items-center gap-1.5"><Activity size={13} className="text-cyan-500" /> 수집 개수 설정</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between text-xs">
                        <span className="text-[#5a5a7a]">계정당 영상 수</span>
                        <span className="text-cyan-700 font-medium">{tkAmount}개</span>
                      </div>
                      <input
                        type="range" min={5} max={50} step={5}
                        value={tkAmount}
                        onChange={e => setTkAmount(Number(e.target.value))}
                        className="w-full appearance-none bg-[#eeeef6] h-1.5 rounded-full accent-cyan-500"
                      />
                      <div className="flex justify-between text-[10px] text-[#1a1a2e]">
                        <span>5개</span><span>50개</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-[#1a1a2e]">최신 영상부터 수집합니다. 많을수록 시간이 오래 걸립니다.</p>

                    {/* Headless toggle */}
                    {tkAgentReady && (
                      <div className="border-t border-[#e0e1ef] pt-3 space-y-2">
                        <p className="text-xs text-[#5a5a7a]">Headless 모드</p>
                        <div className="flex gap-2">
                          <button onClick={() => setTkHeadless(true)}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${tkHeadless ? 'bg-cyan-600 text-white' : 'bg-[#f0f0f8] text-[#8888a8] hover:bg-[#eaeaf4]'}`}>ON</button>
                          <button onClick={() => setTkHeadless(false)}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${!tkHeadless ? 'bg-[#eeeffe] text-violet-700' : 'bg-[#f0f0f8] text-[#8888a8] hover:bg-[#eaeaf4]'}`}>OFF</button>
                        </div>
                        <p className="text-[10px] text-[#1a1a2e]">OFF 시 브라우저 창이 열림 (수집 불안정 시 사용)</p>
                      </div>
                    )}
                  </div>

                  {/* Status */}
                  {tkJobStatus !== 'idle' && (
                    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-medium ${
                      tkJobStatus === 'submitting' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                      tkJobStatus === 'done'       ? 'bg-emerald-50 text-emerald-700 border border-emerald-500/20' :
                                                     'bg-red-50 text-red-700 border border-red-500/20'
                    }`}>
                      {tkJobStatus === 'submitting' && <Loader2 size={13} className="animate-spin shrink-0" />}
                      {tkJobStatus === 'done'  && <CheckCircle2 size={13} className="shrink-0" />}
                      {tkJobStatus === 'error' && <AlertCircle size={13} className="shrink-0" />}
                      <span>{{
                        submitting: '로컬 에이전트로 수집 중...',
                        done:       '완료! 아래에서 결과를 확인하세요.',
                        error:      '수집 실패 — 에이전트 오류 발생. 재시도하거나 Headless OFF로 전환해보세요.',
                        idle:       '',
                      }[tkJobStatus]}</span>
                    </div>
                  )}

                  <div className="mt-auto">
                    <button
                      onClick={handleTkRequest}
                      disabled={tkJobStatus === 'submitting' || !tkAgentReady}
                      className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white py-3.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2.5 transition-all active:scale-95"
                    >
                      {tkJobStatus === 'submitting'
                        ? <Loader2 className="animate-spin" size={16} />
                        : <Music size={16} />}
                      {tkJobStatus === 'submitting' ? '수집 중...' : tkAgentReady ? '수집 시작' : igLocalRunning ? '업데이트 필요' : '에이전트 필요'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Results */}
              {(tkResults.length > 0 || tkResultsLoading) && (
                <div className="bg-white rounded-xl border border-[#e4e5f0] shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-[#e0e1ef]">
                    <div className="flex items-center gap-2.5">
                      <Music size={14} className="text-cyan-500" />
                      <span className="text-sm font-medium text-[#0f0f23]">수집 결과</span>
                      <span className="text-xs text-[#1a1a2e]">{tkResults.length}개 계정</span>
                    </div>
                    <button onClick={() => { const hdr = '계정\t영상수\t평균조회수\t수집일'; const rows = tkResults.map(r => [r.username, r.videoCount, r.avgViews, r.scrapedAt ? new Date(r.scrapedAt).toLocaleDateString('ko-KR') : ''].join('\t')); navigator.clipboard.writeText([hdr, ...rows].join('\n')); }} className="flex items-center gap-1 px-2.5 py-1 bg-[#f0f0f8] hover:bg-[#eaeaf4] text-[#1a1a2e] hover:text-[#0f0f23] rounded text-xs transition-all"><Clipboard size={11} /> 복사</button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-[#f4f5fb] text-[#5a5a7a] text-[11px]">
                        <tr>
                          <th className="px-6 py-3.5 font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Account</th>
                          <th className="px-6 py-3.5 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Videos</th>
                          <th className="px-6 py-3.5 text-right font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Avg Views</th>
                          <th className="px-6 py-3.5 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Status</th>
                          <th className="px-6 py-3.5 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Scraped At</th>
                          <th className="px-6 py-3.5 text-center font-semibold text-[11px] uppercase tracking-[0.05em] text-[#8888a8]">Detail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#ececf5]">
                        {tkResultsLoading ? (
                          <tr><td colSpan={6} className="py-16 text-center"><Loader2 className="animate-spin mx-auto text-[#1a1a2e]" size={22} /></td></tr>
                        ) : tkResults.map(r => (
                          <tr key={r.username} className="hover:bg-[#f5f5fc] transition-colors group">
                            <td className="px-6 py-3.5">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-pink-500 flex items-center justify-center shrink-0">
                                  <span className="text-white text-xs font-bold">{r.username[0]?.toUpperCase()}</span>
                                </div>
                                <div>
                                  <div className="text-[12px] font-semibold text-[#3a3a5a] group-hover:text-cyan-700 transition-colors">@{r.username}</div>
                                  {r.error && <div className="text-[10px] text-red-600 mt-0.5">{r.error}</div>}
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              <span className="bg-[#f0f0f8] px-2.5 py-1 rounded text-[#1a1a2e] text-xs border border-[#e0e1ef]">{r.videoCount}</span>
                            </td>
                            <td className="px-6 py-3.5 text-right text-sm font-semibold text-cyan-700 tabular-nums">{r.avgViews.toLocaleString()}</td>
                            <td className="px-6 py-3.5 text-center">
                              <span className={`text-[10px] px-2 py-0.5 rounded ${r.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                                {r.status === 'completed' ? '완료' : '오류'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center text-[13px] text-[#1a1a2e] font-mono">
                              {new Date(r.scrapedAt).toLocaleDateString('ko-KR')}
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              <button
                                onClick={() => setSelectedTkUser(r)}
                                disabled={!r.videoCount}
                                className="p-1.5 bg-[#f0f0f8] hover:bg-cyan-600 hover:text-white text-[#1a1a2e] rounded-lg transition-all disabled:opacity-20 active:scale-90"
                              >
                                <Eye size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

          ) : activeTab === 'creator' ? (
            /* ══════════════════════════════════════════════════════════
               Creator 탭
               ══════════════════════════════════════════════════════════ */
            <div className="animate-in fade-in duration-300 w-full space-y-6">
              {/* 헤더 */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[22px] font-bold text-[#0f0f23] tracking-tight flex items-center gap-2">
                    <BookUser size={20} className="text-violet-600" /> Creator
                  </h2>
                  <p className="text-[13px] text-[#5a5a7a] mt-1">크리에이터 정보를 저장하면 분석 탭에서 자동완성으로 불러올 수 있어요</p>
                </div>
                <button
                  onClick={() => openCreatorForm()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-all active:scale-95"
                >
                  <Plus size={14} /> 크리에이터 추가
                </button>
              </div>

              {/* 크리에이터 카드 그리드 */}
              {creators.length === 0 ? (
                <div className="bg-white border border-[#e4e5f0] rounded-2xl py-20 flex flex-col items-center gap-3">
                  <BookUser size={36} className="text-[#c0c0d4]" strokeWidth={1.2} />
                  <p className="text-[14px] text-[#8888a8]">저장된 크리에이터가 없습니다</p>
                  <button
                    onClick={() => openCreatorForm()}
                    className="mt-1 flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-all active:scale-95"
                  >
                    <Plus size={14} /> 지금 추가하기
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3">
                  {creators.map(c => (
                    <div key={c.id} className="group relative bg-white border border-[#e4e5f0] rounded-xl p-3 flex flex-col items-center gap-2 hover:border-violet-300 hover:shadow-sm transition-all">
                      {/* 썸네일 */}
                      {c.thumbnailUrl ? (
                        <img src={c.thumbnailUrl} className="w-12 h-12 rounded-full object-cover border border-[#e4e5f0]" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-400 to-violet-600 flex items-center justify-center shrink-0">
                          <span className="text-white text-xl font-bold leading-none">{(c.name[0] ?? '?').toUpperCase()}</span>
                        </div>
                      )}
                      {/* 이름 */}
                      <span className="text-[11px] font-semibold text-[#1a1a2e] text-center line-clamp-2 leading-tight w-full">{c.name}</span>
                      {/* 편집·삭제 버튼 (hover 시 노출) */}
                      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
                        <button
                          onClick={() => openCreatorForm(c)}
                          className="p-1 rounded bg-white/90 shadow-sm hover:bg-violet-100 text-[#8888a8] hover:text-violet-700 transition-colors"
                          title="편집"
                        >
                          <Pencil size={10} />
                        </button>
                        <button
                          onClick={() => { if (confirm(`"${c.name}" 크리에이터를 삭제할까요?`)) deleteCreator(c.id); }}
                          className="p-1 rounded bg-white/90 shadow-sm hover:bg-red-50 text-[#8888a8] hover:text-red-500 transition-colors"
                          title="삭제"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 안내 배너 */}
              {creators.length > 0 && (
                <div className="bg-violet-50 border border-violet-200 rounded-xl px-5 py-3.5 flex items-start gap-3">
                  <Info size={15} className="text-violet-500 shrink-0 mt-0.5" />
                  <p className="text-[12px] text-violet-700 leading-relaxed">
                    분석 탭의 입력창에 크리에이터 이름(예: <strong>해봄</strong>)을 입력하면 자동완성 목록이 나타납니다. 선택 시 해당 탭에 맞는 ID가 자동으로 입력됩니다.
                  </p>
                </div>
              )}
            </div>




          ) : activeTab === 'system-log' ? (
            /* ══════════════════════════════════════════════════════════
               System Log 탭 (PIN 보호)
               ══════════════════════════════════════════════════════════ */
            <div className="animate-in fade-in duration-300 w-full min-h-[70vh]">
              <SystemLogViewer
                logs={sysLogs}
                filter={sysLogFilter}
                onFilterChange={setSysLogFilter}
                onLogout={() => {}}
                subscribeRef={sysLogUnsubRef}
                onLogsUpdate={setSysLogs}
              />
            </div>

          ) : activeTab === 'install' ? (
            /* ══════════════════════════════════════════════════════════
               로컬 에이전트 통합 설치 탭
               ══════════════════════════════════════════════════════════ */
            <div className="animate-in fade-in duration-300 w-full space-y-6">
              {/* 헤더 */}
              <div>
                <h2 className="text-[22px] font-bold text-[#0f0f23] tracking-tight">로컬 에이전트 설치</h2>
                <p className="text-sm text-[#8888a8] mt-1">라이브 지표 · Instagram · TikTok 분석에 필요한 모든 에이전트를 한 번에 설치합니다</p>
              </div>

              {/* 2-column grid on wide screens */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

                {/* 통합 설치 카드 — 넓게 */}
                <div className="xl:col-span-2 bg-gradient-to-br from-violet-600/10 to-blue-600/10 border border-violet-300 rounded-2xl p-7">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-11 h-11 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                      <Package2 size={22} className="text-violet-600" />
                    </div>
                    <div>
                      <div className="text-base font-bold text-[#0f0f23]">TubeMetric 전체 에이전트</div>
                      <div className="text-xs text-[#8888a8] mt-0.5">Python · 모든 패키지 내장 — 별도 설치 불필요</div>
                    </div>
                    <span className="ml-auto text-[10px] bg-violet-600/20 text-violet-700 px-2.5 py-1 rounded-full border border-violet-300 font-semibold shrink-0">권장</span>
                  </div>

                  {/* 포함 항목 */}
                  <div className="grid grid-cols-3 gap-3 mb-6">
                    {[
                      { icon: Tv2,       color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200', label: '라이브 지표 분석', port: '8001' },
                      { icon: Instagram, color: 'text-pink-600',   bg: 'bg-pink-50 border-pink-200',     label: 'Instagram 분석', port: '8003' },
                      { icon: Music,     color: 'text-cyan-700',   bg: 'bg-cyan-50 border-cyan-200',     label: 'TikTok 분석',    port: '8003' },
                    ].map(({ icon: Icon, color, bg, label, port }) => (
                      <div key={label} className={`flex items-center gap-3 p-4 rounded-xl border ${bg}`}>
                        <Icon size={18} className={color} />
                        <div>
                          <div className="text-[13px] font-semibold text-[#3a3a5a]">{label}</div>
                          <div className="text-[11px] text-[#aaaac0] mt-0.5">port {port}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 특징 */}
                  <div className="grid grid-cols-2 gap-2 mb-7 text-xs text-[#5a5a7a]">
                    {[
                      'Python 런타임 내장 — pip 불필요',
                      'Windows 시작 시 자동 실행',
                      'Chrome 버전 자동 감지 (146, 147, ...)',
                      'bot 감지 우회 (yt-dlp 쿠키 방식)',
                    ].map(t => (
                      <p key={t} className="flex items-center gap-2">
                        <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                        {t}
                      </p>
                    ))}
                  </div>

                  {/* 다운로드 버튼 */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    {(detectOS() === 'windows' || detectOS() === 'other') && (
                      <a
                        href={ALL_INSTALLER_URLS.windows}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          setWaitingForAgent(true);
                          const stop = waitForLocalAgent(() => {
                            setLocalAgentRunning(true);
                            setWaitingForAgent(false);
                            checkInstagramAgentTikTokSupport().then(ok => { setIgLocalRunning(ok); setTkAgentReady(ok); });
                          });
                          setTimeout(stop, 300000);
                        }}
                        className="flex items-center justify-center gap-2 flex-1 py-3.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm shadow-violet-200"
                      >
                        <Download size={16} /> Windows (.exe) 다운로드
                      </a>
                    )}
                    {(detectOS() === 'macos' || detectOS() === 'other') && (
                      <a
                        href={ALL_INSTALLER_URLS.macos}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          setWaitingForAgent(true);
                          const stop = waitForLocalAgent(() => {
                            setLocalAgentRunning(true);
                            setWaitingForAgent(false);
                            checkInstagramAgentTikTokSupport().then(ok => { setIgLocalRunning(ok); setTkAgentReady(ok); });
                          });
                          setTimeout(stop, 300000);
                        }}
                        className="flex items-center justify-center gap-2 flex-1 py-3.5 bg-[#eeeffe] hover:bg-violet-100 text-violet-700 text-sm font-semibold rounded-xl transition-colors"
                      >
                        <Download size={16} /> macOS (.pkg) 다운로드
                      </a>
                    )}
                  </div>

                  {waitingForAgent && (
                    <div className="mt-4 flex items-center gap-2 text-xs text-[#8888a8]">
                      <Loader2 size={12} className="animate-spin text-violet-600" />
                      설치 완료 후 에이전트 자동 감지 대기 중...
                    </div>
                  )}
                </div>

                {/* 오른쪽: 연결 상태 + 설치 안내 */}
                <div className="flex flex-col gap-4">
                  {/* 연결 상태 */}
                  <div className="bg-white border border-[#e0e1ef] rounded-xl p-5 space-y-3">
                    <p className="text-sm font-semibold text-[#0f0f23]">에이전트 연결 상태</p>
                    {[
                      { label: '라이브 지표 에이전트', port: '8001', ok: localAgentRunning },
                      { label: 'Instagram · TikTok 에이전트', port: '8003', ok: igLocalRunning },
                    ].map(({ label, port, ok }) => (
                      <div key={port} className="flex items-center justify-between py-2 border-b border-[#f0f0f8] last:border-0">
                        <div className="flex items-center gap-2.5 text-xs text-[#5a5a7a]">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${ok ? 'bg-emerald-400 animate-pulse' : 'bg-[#d0d0e8]'}`} />
                          <span>{label}</span>
                          <span className="text-[#c0c0d8] font-mono">:{port}</span>
                        </div>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${ok ? 'text-emerald-700 bg-emerald-50' : 'text-[#9090b0] bg-[#f0f0f8]'}`}>
                          {ok ? '연결됨' : '미연결'}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* 설치 방법 */}
                  <div className="bg-white border border-[#e0e1ef] rounded-xl p-5 flex-1">
                    <p className="text-sm font-semibold text-[#0f0f23] mb-4">설치 방법</p>
                    <ol className="space-y-3 text-xs text-[#5a5a7a]">
                      {[
                        '위 다운로드 버튼으로 파일을 받습니다',
                        <>다운로드된 파일을 실행하고 <strong className="text-[#1a1a2e]">다음</strong>을 클릭합니다</>,
                        '설치가 완료되면 두 에이전트가 자동으로 시작됩니다',
                        <>이 페이지에서 연결 상태가 <span className="text-emerald-600 font-medium">연결됨</span>으로 바뀌면 수집 가능합니다</>,
                      ].map((step, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i+1}</span>
                          <span className="leading-relaxed">{step}</span>
                        </li>
                      ))}
                    </ol>
                    <p className="text-[11px] text-[#aaaac0] mt-5 pt-3 border-t border-[#f0f0f8]">※ PC에 Chrome이 설치되어 있어야 합니다</p>
                  </div>
                </div>
              </div>
            </div>

          ) : (
            <div className="space-y-5 animate-in fade-in duration-300">
              {/* 헤더 */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-[22px] font-bold text-[#0f0f23] tracking-tight">데이터 대시보드</h2>
                  <p className="text-[13px] text-[#5a5a7a] mt-1">수집된 데이터를 한눈에 확인하고 엑셀로 내보내세요</p>
                </div>
                <button
                  onClick={handleDownloadExcel}
                  className="inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-all active:scale-95 self-start sm:self-auto"
                >
                  <FileSpreadsheet size={15} /> 엑셀로 내보내기
                </button>
              </div>

              {/* 서브탭 */}
              <div className="flex gap-1 bg-[#f2f2f8] p-1 rounded-xl w-fit">
                {([
                  { id: 'channel', label: '채널 분석', icon: TrendingUp },
                  { id: 'video', label: '영상 분석', icon: Video },
                  { id: 'scraper', label: '스크래퍼 결과', icon: Activity },
                ] as const).map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => { setDashboardSubTab(tab.id); if (tab.id === 'scraper') loadScraperResults(); }}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                      dashboardSubTab === tab.id ? 'bg-[#eeeef6] text-violet-700' : 'text-[#5a5a7a] hover:text-[#5a5a7a]'
                    }`}
                  >
                    <tab.icon size={13} /> {tab.label}
                    {tab.id === 'scraper' && scraperJobStatus === 'pending' && (
                      <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse ml-0.5" />
                    )}
                  </button>
                ))}
              </div>

              {/* KPI 카드 - 채널 */}
              {dashboardSubTab === 'channel' && (() => {
                const done = channelResults.filter(r => r.status === 'completed');
                const avgS = done.length > 0 ? Math.round(done.reduce((s,r)=>s+r.avgShortsViews,0)/done.length) : 0;
                const avgL = done.length > 0 ? Math.round(done.reduce((s,r)=>s+r.avgLongViews,0)/done.length) : 0;
                const totalVids = done.reduce((s,r)=>s+r.shortsCountFound+r.longCountFound,0);
                return (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      { label: '완료 채널', value: done.length, sub: `전체 ${channelResults.length}개`, icon: Users, color: 'text-violet-600' },
                      { label: 'Shorts 평균 조회', value: avgS > 0 ? avgS.toLocaleString() : '—', sub: '완료 채널 기준', icon: Radio, color: 'text-violet-600' },
                      { label: 'Longform 평균 조회', value: avgL > 0 ? avgL.toLocaleString() : '—', sub: '완료 채널 기준', icon: MonitorPlay, color: 'text-[#1a1a2e]' },
                      { label: '총 수집 영상', value: totalVids.toLocaleString(), sub: '쇼츠 + 롱폼 합계', icon: Video, color: 'text-[#1a1a2e]' },
                    ].map((kpi, i) => (
                      <div key={i} className="bg-white border border-[#e0e1ef] rounded-xl p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#5a5a7a]">{kpi.label}</span>
                          <kpi.icon size={14} className={kpi.color} />
                        </div>
                        <div className={`text-2xl font-semibold ${kpi.color}`}>{kpi.value}</div>
                        <div className="text-xs text-[#1a1a2e]">{kpi.sub}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* KPI 카드 - 영상 */}
              {dashboardSubTab === 'video' && (() => {
                const done = videoResults.filter(v => v.status === 'completed');
                const avgViews = done.length > 0 ? Math.round(done.reduce((s,v)=>s+v.viewCount,0)/done.length) : 0;
                const totalLikes = done.reduce((s,v)=>s+v.likeCount,0);
                const shortsCount = videoResults.filter(v=>v.isShort).length;
                return (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      { label: '분석 영상', value: done.length, sub: `전체 ${videoResults.length}개`, icon: Video, color: 'text-violet-600' },
                      { label: '평균 조회수', value: avgViews > 0 ? avgViews.toLocaleString() : '—', sub: '완료 영상 기준', icon: Eye, color: 'text-violet-600' },
                      { label: '총 좋아요', value: totalLikes.toLocaleString(), sub: '수집 영상 합계', icon: ThumbsUp, color: 'text-[#1a1a2e]' },
                      { label: 'Shorts 비율', value: videoResults.length > 0 ? `${Math.round(shortsCount/videoResults.length*100)}%` : '—', sub: `쇼츠 ${shortsCount} / 롱폼 ${videoResults.filter(v=>!v.isShort).length}`, icon: Radio, color: 'text-[#1a1a2e]' },
                    ].map((kpi, i) => (
                      <div key={i} className="bg-white border border-[#e0e1ef] rounded-xl p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#5a5a7a]">{kpi.label}</span>
                          <kpi.icon size={14} className={kpi.color} />
                        </div>
                        <div className={`text-2xl font-semibold ${kpi.color}`}>{kpi.value}</div>
                        <div className="text-xs text-[#1a1a2e]">{kpi.sub}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* KPI 카드 - 스크래퍼 */}
              {dashboardSubTab === 'scraper' && (() => {
                const avgS = scraperResults.length > 0 ? Math.round(scraperResults.reduce((s,r)=>s+r.avgShortsViews,0)/scraperResults.length) : 0;
                const avgL = scraperResults.length > 0 ? Math.round(scraperResults.reduce((s,r)=>s+r.avgLongViews,0)/scraperResults.length) : 0;
                const lastDate = scraperResults.length > 0 && (scraperResults[0] as any).scrapedAt
                  ? new Date((scraperResults[0] as any).scrapedAt).toLocaleDateString('ko-KR') : '—';
                return (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      { label: '수집 채널', value: scraperResults.length, sub: '스크래퍼 결과', icon: Activity, color: 'text-violet-600' },
                      { label: 'Shorts 평균 조회', value: avgS > 0 ? avgS.toLocaleString() : '—', sub: '전체 채널 평균', icon: Radio, color: 'text-violet-600' },
                      { label: 'Longform 평균 조회', value: avgL > 0 ? avgL.toLocaleString() : '—', sub: '전체 채널 평균', icon: MonitorPlay, color: 'text-[#1a1a2e]' },
                      { label: '최근 수집일', value: lastDate, sub: '가장 최근 기준', icon: CalendarDays, color: 'text-[#1a1a2e]' },
                    ].map((kpi, i) => (
                      <div key={i} className="bg-white border border-[#e0e1ef] rounded-xl p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#5a5a7a]">{kpi.label}</span>
                          <kpi.icon size={14} className={kpi.color} />
                        </div>
                        <div className={`text-2xl font-semibold ${kpi.color}`}>{kpi.value}</div>
                        <div className="text-xs text-[#1a1a2e]">{kpi.sub}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* ── 스크래퍼 결과 (GitHub Raw) ─────────────────────────────── */}
              {dashboardSubTab === 'scraper' && (
                <div className="bg-white rounded-xl border border-[#e4e5f0] shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-[#e0e1ef] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity size={15} className="text-violet-600" />
                      <span className="font-medium text-[#0f0f23] text-sm">로컬 스크래퍼 결과</span>
                      <span className="text-xs text-[#1a1a2e]">from GitHub Raw</span>
                    </div>
                    <button
                      onClick={loadScraperResults}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f0f0f8] hover:bg-[#eaeaf4] rounded-lg text-[12px] font-semibold text-[#3a3a5a] hover:text-[#1a1a2e] transition-all"
                    >
                      {scraperResultsLoading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      새로고침
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-[#f4f5fb] text-[#5a5a7a] text-[11px]">
                        <tr>
                          <th className="px-6 py-4 font-medium">Channel</th>
                          <th className="px-6 py-4 text-center font-medium">Subscribers</th>
                          <th className="px-6 py-4 text-right font-medium">Shorts Avg</th>
                          <th className="px-6 py-4 text-right font-medium">Longform Avg</th>
                          <th className="px-6 py-4 text-center font-medium">Scraped At</th>
                          <th className="px-6 py-4 text-center font-medium">Detail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#ececf5]">
                        {scraperResultsLoading ? (
                          <tr><td colSpan={6} className="py-16 text-center"><Loader2 className="animate-spin mx-auto text-[#1a1a2e]" size={24} /></td></tr>
                        ) : scraperResults.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-24 text-center">
                              <div className="flex flex-col items-center gap-3 text-[#1a1a2e]">
                                <Activity size={36} strokeWidth={1} />
                                <p className="text-sm font-medium">아직 스크래퍼 결과가 없습니다.</p>
                                <p className="text-xs">로컬 스크래퍼 탭에서 채널을 요청하세요.</p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          scraperResults.map((r) => (
                            <tr key={r.channelId} className="hover:bg-[#f5f5fc] transition-colors group">
                              <td className="px-6 py-4 flex items-center gap-4">
                                {r.thumbnail ? (
                                  <img src={r.thumbnail} className="w-10 h-10 rounded-lg object-cover border border-[#e0e1ef]" />
                                ) : (
                                  <div className="w-10 h-10 bg-[#f0f1f8] rounded-lg flex items-center justify-center"><Activity className="text-[#1a1a2e]" size={16} /></div>
                                )}
                                <div>
                                  <div className="font-medium text-[#1a1a2e] text-sm group-hover:text-violet-600 transition-colors">{r.channelName}</div>
                                  <div className="text-xs text-[#1a1a2e] font-mono mt-0.5">{r.channelId}</div>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <span className="bg-[#f0f0f8] px-3 py-1 rounded-lg text-[#1a1a2e] text-xs border border-[#e0e1ef]">{formatNumber(r.subscriberCount)}</span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <div className="text-base font-semibold text-violet-600">{r.avgShortsViews.toLocaleString()}</div>
                                <div className="text-[13px] text-[#5a5a7a] mt-1">{r.shortsCountFound} Shorts</div>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <div className="text-base font-semibold text-[#1a1a2e]">{r.avgLongViews.toLocaleString()}</div>
                                <div className="text-[13px] text-[#5a5a7a] mt-1">{r.longCountFound} Videos</div>
                              </td>
                              <td className="px-6 py-4 text-center text-xs text-[#5a5a7a] font-mono">
                                {(r as any).scrapedAt ? new Date((r as any).scrapedAt).toLocaleDateString('ko-KR') : '—'}
                              </td>
                              <td className="px-6 py-4 text-center">
                                <button
                                  onClick={() => setSelectedChannel(r)}
                                  className="p-2 bg-[#f0f0f8] hover:bg-violet-600 hover:text-white text-[#1a1a2e] rounded-lg transition-all active:scale-90"
                                >
                                  <Eye size={16} />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {dashboardSubTab !== 'scraper' && (
              <div className="bg-white rounded-xl border border-[#e4e5f0] shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    {dashboardSubTab === 'channel' ? (
                      <>
                        <thead className="bg-[#f4f5fb] text-[#5a5a7a] text-[11px]">
                          <tr>
                            <th className="px-6 py-4 font-medium">Channel Information</th>
                            <th className="px-6 py-4 text-center font-medium">Subscribers</th>
                            <th className="px-6 py-4 text-right font-medium">Shorts Avg</th>
                            <th className="px-6 py-4 text-right font-medium">Longform Avg</th>
                            <th className="px-6 py-4 text-center font-medium">Detail</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#ececf5]">
                          {channelResults.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-24 text-center">
                                <div className="flex flex-col items-center gap-3 text-[#1a1a2e]">
                                  <LayoutDashboard size={36} strokeWidth={1} />
                                  <p className="text-sm font-medium">No channel data analyzed yet.</p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            channelResults.map((r) => (
                              <tr key={r.channelId} className="hover:bg-[#f5f5fc] transition-colors group">
                                <td className="px-6 py-4 flex items-center gap-4">
                                  <div className="relative">
                                    {r.thumbnail ? (
                                      <img src={r.thumbnail} className="w-10 h-10 rounded-lg object-cover border border-[#e0e1ef]" />
                                    ) : (
                                      <div className="w-10 h-10 bg-[#f0f1f8] rounded-lg flex items-center justify-center">
                                        <Loader2 className="animate-spin text-[#1a1a2e]" size={16} />
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    <div className="font-medium text-[#1a1a2e] text-sm group-hover:text-violet-600 transition-colors flex items-center gap-2">
                                      {r.channelName}
                                      {r.status === 'error' && (
                                        <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded border border-red-500/20">Error</span>
                                      )}
                                    </div>
                                    <div className="text-xs text-[#1a1a2e] font-mono mt-0.5 max-w-[200px] truncate">{r.status === 'error' ? r.error : r.channelId}</div>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <span className="bg-[#f0f0f8] px-3 py-1 rounded-lg text-[#1a1a2e] text-xs border border-[#e0e1ef]">
                                    {r.status === 'completed' ? formatNumber(r.subscriberCount) : '...'}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <div className="text-base font-semibold text-violet-600">{r.avgShortsViews.toLocaleString()}</div>
                                  <div className="text-[13px] text-[#5a5a7a] mt-1">{r.shortsCountFound} Shorts</div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <div className="text-base font-semibold text-[#1a1a2e]">{r.avgLongViews.toLocaleString()}</div>
                                  <div className="text-[13px] text-[#5a5a7a] mt-1">{r.longCountFound} Videos</div>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <button
                                    disabled={r.status !== 'completed'}
                                    onClick={() => setSelectedChannel(r)}
                                    className="p-2 bg-[#f0f0f8] hover:bg-violet-600 hover:text-white text-[#1a1a2e] rounded-lg transition-all disabled:opacity-20 active:scale-90"
                                  >
                                    <Eye size={16} />
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </>
                    ) : (
                      <>
                        <thead className="bg-[#f4f5fb] text-[#5a5a7a] text-[11px]">
                          <tr>
                            <th className="px-6 py-4 font-medium">Video Details</th>
                            <th className="px-6 py-4 font-medium">Channel</th>
                            <th className="px-6 py-4 text-center font-medium">Stats (Likes/Comments)</th>
                            <th className="px-6 py-4 text-right font-medium">View Count</th>
                            <th className="px-6 py-4 text-center font-medium">Detail</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#ececf5]">
                          {videoResults.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-24 text-center">
                                <div className="flex flex-col items-center gap-3 text-[#1a1a2e]">
                                  <MonitorPlay size={36} strokeWidth={1} />
                                  <p className="text-sm font-medium">No video data analyzed yet.</p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            videoResults.map((v) => (
                              <tr key={v.videoId} className="hover:bg-[#f5f5fc] transition-colors group">
                                <td className="px-6 py-4 flex items-center gap-4">
                                  <div className="relative shrink-0">
                                    {v.thumbnail ? (
                                      <img src={v.thumbnail} className={`rounded-lg object-cover border border-[#e0e1ef] ${v.isShort ? 'w-8 h-12' : 'w-16 h-10'}`} />
                                    ) : (
                                      <div className="w-10 h-10 bg-[#f0f1f8] rounded-lg flex items-center justify-center">
                                        <Loader2 className="animate-spin text-[#1a1a2e]" size={16} />
                                      </div>
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-medium text-[#1a1a2e] text-sm group-hover:text-violet-600 transition-colors truncate max-w-[300px]">{v.title}</div>
                                    <div className="text-xs text-[#1a1a2e] font-mono mt-0.5">{v.status === 'error' ? v.error : v.videoId}</div>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="text-sm text-[#1a1a2e]">{v.channelTitle || '...'}</div>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-xs text-violet-600 flex items-center gap-1">
                                      <ThumbsUp size={11} /> {v.likeCount.toLocaleString()}
                                    </span>
                                    <span className="text-xs text-[#1a1a2e] flex items-center gap-1">
                                      <MessageSquare size={11} /> {v.commentCount.toLocaleString()}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <div className="text-base font-semibold text-[#1a1a2e]">{v.viewCount.toLocaleString()}</div>
                                </td>
                                <td className="px-6 py-4 text-center flex items-center justify-center gap-2">
                                  <button
                                    disabled={v.status !== 'completed'}
                                    onClick={() => setSelectedVideo(v)}
                                    className="p-2 bg-[#f0f0f8] hover:bg-[#eaeaf4] hover:text-[#1a1a2e] text-[#1a1a2e] rounded-lg transition-all disabled:opacity-20 active:scale-90"
                                  >
                                    <Eye size={16} />
                                  </button>
                                  <a
                                    href={v.isShort ? `https://youtube.com/shorts/${v.videoId}` : `https://youtube.com/watch?v=${v.videoId}`}
                                    target="_blank"
                                    className="inline-block p-2 bg-[#f0f0f8] hover:bg-violet-600 hover:text-white text-[#1a1a2e] rounded-lg transition-all active:scale-90"
                                  >
                                    <ExternalLink size={15} />
                                  </a>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </>
                    )}
                  </table>
                </div>
              </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

// ── CreatorAutocomplete 컴포넌트 ─────────────────────────────────────────────
type ACField = 'youtube' | 'live' | 'instagram' | 'tiktok';

interface CreatorAutocompleteProps {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  /** 여러 값을 한 번에 추가할 때 호출 (youtube/live의 경우) */
  onAddMultiple?: (values: string[]) => void;
  creators: Creator[];
  field: ACField;
  placeholder?: string;
  className?: string;
}

function getFieldValues(c: Creator, field: ACField): string[] {
  switch (field) {
    case 'youtube':   return c.youtubeChannelIds ?? [];
    case 'live':      return c.liveMetricsIds ?? [];
    case 'instagram': return c.instagramUsername ? [c.instagramUsername] : [];
    case 'tiktok':    return c.tiktokUsername ? [c.tiktokUsername] : [];
  }
}

const CreatorAutocomplete: React.FC<CreatorAutocompleteProps> = ({
  value, onChange, onCommit, onAddMultiple, creators, field, placeholder, className,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const suggestions = value.trim().length > 0
    ? creators.filter(c => {
        const q = value.toLowerCase();
        return c.name.toLowerCase().includes(q) ||
          getFieldValues(c, field).some(v => v.toLowerCase().includes(q));
      })
    : [];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pick = (c: Creator) => {
    const vals = getFieldValues(c, field);
    if (vals.length === 0) { onChange(c.name); setOpen(false); return; }
    if (vals.length === 1) {
      onChange(vals[0]);
      setOpen(false);
    } else if (onAddMultiple) {
      // 여러 개: draft 비우고 전부 추가
      onAddMultiple(vals);
      onChange('');
      setOpen(false);
    } else {
      onChange(vals[0]);
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative flex-1">
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Enter') { setOpen(false); onCommit(); }
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={placeholder}
        className={className}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-[#e0e1ef] rounded-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto">
          {suggestions.map(c => {
            const vals = getFieldValues(c, field);
            return (
              <button
                key={c.id}
                type="button"
                onMouseDown={e => { e.preventDefault(); pick(c); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-violet-50 text-left transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center shrink-0">
                  <span className="text-white text-[10px] font-bold">{c.name[0]?.toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-[#0f0f23]">{c.name}</div>
                  {vals.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {vals.map((v, i) => <span key={i} className="text-[10px] text-[#8888a8] font-mono bg-[#f4f4f8] px-1 rounded truncate max-w-[160px]">{v}</span>)}
                    </div>
                  )}
                </div>
                {vals.length > 1 && (
                  <span className="text-[10px] text-violet-500 shrink-0 font-medium">{vals.length}개 추가</span>
                )}
                {vals.length === 0 && (
                  <span className="text-[10px] text-[#c0c0d4] shrink-0">ID 없음</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── SystemLogViewer 컴포넌트 ──────────────────────────────────────────────────
interface SystemLogViewerProps {
  logs: SystemLogEntry[];
  filter: 'all' | 'connection' | 'analysis' | 'error' | 'system';
  onFilterChange: (f: 'all' | 'connection' | 'analysis' | 'error' | 'system') => void;
  onLogout: () => void;
  subscribeRef: React.MutableRefObject<(() => void) | null>;
  onLogsUpdate: (logs: SystemLogEntry[]) => void;
}

const LEVEL_STYLE: Record<string, string> = {
  info:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  warn:  'bg-yellow-50 text-yellow-700 border-yellow-200',
  error: 'bg-red-50 text-red-700 border-red-200',
};

const CAT_STYLE: Record<string, string> = {
  connection: 'bg-blue-50 text-blue-700 border-blue-200',
  analysis:   'bg-violet-50 text-violet-700 border-violet-200',
  error:      'bg-red-50 text-red-700 border-red-200',
  system:     'bg-[#f0f0f8] text-[#5a5a7a] border-[#e0e1ef]',
};

const CAT_LABEL: Record<string, string> = {
  connection: '연결',
  analysis:   '분석',
  error:      '오류',
  system:     '시스템',
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s/60)}분 전`;
  if (s < 86400) return `${Math.floor(s/3600)}시간 전`;
  return `${Math.floor(s/86400)}일 전`;
}

const SystemLogViewer: React.FC<SystemLogViewerProps> = ({
  logs, filter, onFilterChange, onLogout, subscribeRef, onLogsUpdate,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeSystemLogs(onLogsUpdate);
    subscribeRef.current = unsub;
    return () => { unsub(); subscribeRef.current = null; };
  }, []);

  const filtered = filter === 'all' ? logs : logs.filter(l => l.category === filter);

  const FILTERS: Array<{ id: typeof filter; label: string }> = [
    { id: 'all',        label: '전체' },
    { id: 'connection', label: '연결' },
    { id: 'analysis',   label: '분석' },
    { id: 'error',      label: '오류' },
    { id: 'system',     label: '시스템' },
  ];

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold text-[#0f0f23] tracking-tight flex items-center gap-2">
            <Terminal size={20} className="text-violet-600" /> System Log
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-[13px] text-[#5a5a7a]">에이전트 접속 기록 · 분석 이벤트 · 오류 추적</p>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${isFirebaseConfigured() ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'}`}>
              {isFirebaseConfigured() ? '● Firebase 연결됨' : '● 로컬 저장'}
            </span>
          </div>
        </div>
      </div>

      {/* 필터 */}
      <div className="flex gap-1 bg-[#f2f2f8] p-1 rounded-xl w-fit">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => onFilterChange(f.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === f.id ? 'bg-white text-violet-700 shadow-sm' : 'text-[#5a5a7a] hover:text-[#1a1a2e]'
            }`}
          >
            {f.label}
            {f.id !== 'all' && (
              <span className="ml-1 text-[9px] opacity-60">
                {logs.filter(l => l.category === f.id).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 로그 목록 */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="bg-white border border-[#e4e5f0] rounded-xl py-16 text-center">
            <Terminal size={28} className="mx-auto text-[#c0c0d4] mb-3" />
            <p className="text-[13px] text-[#8888a8]">기록된 로그가 없습니다.</p>
          </div>
        ) : (
          filtered.map((log, idx) => {
            const key = log.id ?? `${log.timestamp}-${idx}`;
            const isOpen = expandedId === key;
            return (
              <div
                key={key}
                className={`bg-white border rounded-xl overflow-hidden transition-all ${
                  log.level === 'error' ? 'border-red-200' : 'border-[#e4e5f0]'
                }`}
              >
                <button
                  className="w-full px-5 py-3.5 flex items-start gap-3 text-left hover:bg-[#f8f8fd] transition-colors"
                  onClick={() => setExpandedId(isOpen ? null : key)}
                >
                  {/* level dot */}
                  <span className={`mt-0.5 shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-bold ${LEVEL_STYLE[log.level] ?? LEVEL_STYLE.info}`}>
                    {log.level.toUpperCase()}
                  </span>
                  {/* category */}
                  <span className={`mt-0.5 shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium ${CAT_STYLE[log.category] ?? CAT_STYLE.system}`}>
                    {CAT_LABEL[log.category] ?? log.category}
                  </span>
                  {/* message */}
                  <span className="flex-1 text-[13px] text-[#1a1a2e] font-medium leading-snug">{log.message}</span>
                  {/* time */}
                  <span className="shrink-0 text-[11px] text-[#a0a0b8] font-mono" title={log.timestamp}>
                    {relTime(log.timestamp)}
                  </span>
                  <ChevronDown size={13} className={`shrink-0 text-[#a0a0b8] transition-transform mt-0.5 ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="px-5 pb-4 pt-0 border-t border-[#f0f0f8] text-[12px] text-[#5a5a7a] space-y-1.5">
                    <div className="font-mono text-[11px] text-[#a0a0b8]">
                      {new Date(log.timestamp).toLocaleString('ko-KR')}
                    </div>
                    {log.clientOS && (
                      <div>
                        <span className="text-[#a0a0b8]">OS: </span>
                        <span className="font-medium text-[#3a3a5a]">{log.clientOS}</span>
                        {log.userAgent && (
                          <span className="text-[#c0c0d4] ml-2 truncate max-w-xs inline-block align-middle">{log.userAgent.slice(0, 80)}</span>
                        )}
                      </div>
                    )}
                    {log.details && Object.keys(log.details).length > 0 && (
                      <pre className="bg-[#f4f5fb] rounded-lg px-3 py-2 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-all text-[#3a3a5a]">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default App;
