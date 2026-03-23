
import React, { useState, useEffect } from 'react';
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
  Music
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { getChannelInfo, fetchChannelStats, fetchVideosByIds, AnalysisPeriod, analyzeAdVideos } from './services/youtubeService';
import { ChannelResult, VideoResult, VideoDetail, CommentInfo, AdAnalysisResult, InstagramUserResult } from './types';
import { submitScrapeRequest, checkQueueStatus, getAllChannelResults, submitInstagramRequest, checkInstagramQueueStatus, getAllInstagramResults } from './services/githubResultsService';
import { isBackendAvailable, scrapeChannel as backendScrapeChannel, scrapeVideos as backendScrapeVideos, detectAds as backendDetectAds, fetchInstagramReels as backendFetchReels, fetchTikTokVideos as backendFetchTikTok, TikTokUserResult, fetchLiveStreams, fetchSoftcStreams, LiveCreatorResult } from './services/backendApiService';
import { checkLocalAgent, waitForLocalAgent, checkSoftcAgent, waitForSoftcAgent, detectOS, INSTALLER_URLS, LOCAL_AGENT_URL, SOFTC_AGENT_URL, SOFTC_INSTALLER_URLS } from './services/localAgentService';

type TabType = 'channel-config' | 'video-config' | 'ad-config' | 'dashboard' | 'live-config' | 'instagram-config' | 'tiktok-config';
type ResultTab = 'table' | 'chart' | 'raw';

const App: React.FC = () => {
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
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

  // 앱 시작 시 로컬 에이전트 감지
  useEffect(() => {
    checkLocalAgent().then(ok => setLocalAgentRunning(ok));
    checkSoftcAgent().then(ok => setSoftcLocalRunning(ok));
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
  const [igJobId, setIgJobId] = useState<string | null>(null);
  const [igJobStatus, setIgJobStatus] = useState<'idle' | 'submitting' | 'pending' | 'done' | 'error'>('idle');
  const [igResults, setIgResults] = useState<InstagramUserResult[]>([]);
  const [igResultsLoading, setIgResultsLoading] = useState(false);
  const [selectedIgUser, setSelectedIgUser] = useState<InstagramUserResult | null>(null);

  // TikTok 상태
  const [tkDraft, setTkDraft] = useState<string>('');
  const [tkInput, setTkInput] = useState<string>('');
  const [tkAmount, setTkAmount] = useState<number>(30);
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
        console.error('Channel analysis error:', err);
        setChannelResults(prev => { const next = [...prev]; next[i] = { ...next[i], status: 'error', error: err.message || '데이터를 가져오지 못했습니다.' }; return next; });
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
    setIgJobStatus('submitting');

    // 백엔드 API 우선 사용 (instagrapi 기반, 직접 호출)
    if (isBackendAvailable()) {
      try {
        const results = await backendFetchReels(igList, igAmount);
        setIgResults(results);
        setIgJobStatus('done');
        return;
      } catch (e: any) {
        console.error('Backend API 오류, GitHub 큐로 폴백:', e.message);
      }
    }

    // 폴백: GitHub 큐 방식 (로컬 서버 필요)
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
    const v = tkDraft.trim().replace(/^@/, '');
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
    if (!isBackendAvailable()) {
      alert('TikTok 수집은 클라우드 백엔드가 필요합니다. BACKEND_URL을 설정해주세요.');
      return;
    }
    setTkJobStatus('submitting');
    try {
      const results = await backendFetchTikTok(tkList, tkAmount);
      setTkResults(results);
      setTkJobStatus('done');
    } catch (e: any) {
      console.error('TikTok API 오류:', e.message);
      setTkJobStatus('error');
    }
  };

  // ── 라이브 지표 핸들러 ────────────────────────────────────────────────────
  const liveList = liveInput.split('\n').map(s => s.trim()).filter(Boolean);
  const addLiveItem = () => {
    const v = liveDraft.trim().replace(/^@/, '');
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

      // 로컬 에이전트 (headless=False · undetected_chromedriver · port 8002)
      if (!softcLocalRunning) {
        setLiveErrorMsg('로컬 에이전트가 실행 중이지 않습니다. 설치 후 다시 시도하세요.');
        setLiveJobStatus('error');
        return;
      }
      results = await fetchSoftcStreams(creators, liveStartDate, liveEndDate, [], SOFTC_AGENT_URL);

      setLiveResults(results);
      const errors = results.filter((r: any) => r.status === 'error');
      if (errors.length > 0 && errors.length === results.length) {
        setLiveErrorMsg(errors.map((r: any) => `${r.creatorId}: ${r.error}`).join('; '));
        setLiveJobStatus('error');
      } else {
        setLiveJobStatus('done');
      }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || String(e);
      console.error('라이브 지표 오류:', msg);
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
      <div className="min-h-screen bg-[#0f1117] text-zinc-100 flex items-center justify-center p-6 selection:bg-violet-500/30">
        <div className="w-full max-w-md space-y-10 animate-in fade-in duration-500">
          <div className="text-center space-y-5">
            <div className="inline-flex items-center justify-center bg-violet-600 p-4 rounded-xl shadow-md mb-4">
              <Lock className="text-white w-8 h-8" strokeWidth={2} />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold text-white">
                Parable TubeMetric
              </h1>
              <p className="text-zinc-300 text-sm">Enter your PIN to continue</p>
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
                className="w-full bg-[#1a1b23] border border-white/8 rounded-xl py-4 px-6 text-center text-2xl font-medium tracking-[0.4em] text-white focus:outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 transition-all placeholder:text-zinc-200 placeholder:tracking-normal placeholder:text-base"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-violet-600 hover:bg-violet-500 text-white py-4 rounded-lg font-medium text-base transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              Authorize <ChevronRight size={18} />
            </button>
          </form>

          <p className="text-center text-xs text-zinc-200">Authorized access only</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-zinc-100 flex font-sans overflow-hidden selection:bg-violet-500/30">

      {/* Modal: Instagram User Details */}
      {selectedIgUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#1a1b23] w-full max-w-4xl max-h-[85vh] rounded-2xl border border-white/8 overflow-hidden flex flex-col shadow-md">
            <div className="p-5 border-b border-white/8 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center shrink-0">
                  <span className="text-white text-sm font-bold">{selectedIgUser.username[0]?.toUpperCase()}</span>
                </div>
                <div>
                  <div className="text-base font-semibold text-white">@{selectedIgUser.username}</div>
                  <div className="text-xs text-zinc-300 mt-0.5 flex items-center gap-3">
                    <span>릴스 {selectedIgUser.reelCount}개</span>
                    <span>평균 조회수 <span className="text-pink-400 font-medium">{selectedIgUser.avgViews.toLocaleString()}</span></span>
                    <span>평균 좋아요 <span className="text-violet-400 font-medium">{selectedIgUser.avgLikes.toLocaleString()}</span></span>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedIgUser(null)} className="p-2 hover:bg-white/8 rounded-lg transition-colors text-zinc-300 hover:text-white"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-left border-collapse">
                <thead className="bg-white/[0.02] text-zinc-300 text-xs sticky top-0">
                  <tr>
                    <th className="px-5 py-3 font-medium">Reel</th>
                    <th className="px-5 py-3 text-right font-medium">Views</th>
                    <th className="px-5 py-3 text-right font-medium">Likes</th>
                    <th className="px-5 py-3 text-right font-medium">Comments</th>
                    <th className="px-5 py-3 text-center font-medium">Duration</th>
                    <th className="px-5 py-3 text-center font-medium">Date</th>
                    <th className="px-5 py-3 text-center font-medium">Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {selectedIgUser.reels.map((reel, i) => (
                    <tr key={reel.media_pk || i} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-5 py-3 flex items-center gap-3">
                        {reel.thumbnail_url ? (
                          <img src={reel.thumbnail_url} className="w-9 h-14 object-cover rounded-lg border border-white/8 shrink-0" />
                        ) : (
                          <div className="w-9 h-14 bg-zinc-900 rounded-lg flex items-center justify-center shrink-0"><Instagram size={14} className="text-zinc-200" /></div>
                        )}
                        <span className="text-xs text-zinc-200 line-clamp-2 max-w-[260px]">{reel.caption_text || '(캡션 없음)'}</span>
                      </td>
                      <td className="px-5 py-3 text-right text-sm font-semibold text-pink-400 tabular-nums">{reel.view_count.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right text-xs text-violet-400 tabular-nums">{reel.like_count.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right text-xs text-zinc-200 tabular-nums">{reel.comment_count.toLocaleString()}</td>
                      <td className="px-5 py-3 text-center text-xs text-zinc-300">{reel.video_duration ? `${Math.round(reel.video_duration)}s` : '—'}</td>
                      <td className="px-5 py-3 text-center text-xs text-zinc-200 font-mono">{new Date(reel.taken_at).toLocaleDateString('ko-KR')}</td>
                      <td className="px-5 py-3 text-center">
                        {reel.url ? (
                          <a href={reel.url} target="_blank" className="p-1.5 bg-white/5 hover:bg-pink-600 hover:text-white text-zinc-200 rounded-lg transition-all inline-flex"><ExternalLink size={13} /></a>
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
          <div className="bg-[#1a1b23] w-full max-w-4xl max-h-[85vh] rounded-2xl border border-white/8 overflow-hidden flex flex-col shadow-md">
            <div className="p-5 border-b border-white/8 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${selectedLiveCreator.platform === 'CHZZK' ? 'bg-blue-500/20' : 'bg-purple-500/20'}`}>
                  <Tv2 size={18} className={selectedLiveCreator.platform === 'CHZZK' ? 'text-blue-400' : 'text-purple-400'} />
                </div>
                <div>
                  <div className="text-base font-semibold text-white">{selectedLiveCreator.creatorId}</div>
                  <div className="text-xs text-zinc-300 mt-0.5 flex items-center gap-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${selectedLiveCreator.platform === 'CHZZK' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'}`}>{selectedLiveCreator.platform}</span>
                    <span>방송 {selectedLiveCreator.streamCount}회</span>
                    <span>평균 <span className="text-orange-400 font-medium">{selectedLiveCreator.avgViewers.toLocaleString()}</span>명</span>
                    <span>최고 <span className="text-red-400 font-medium">{selectedLiveCreator.peakViewers.toLocaleString()}</span>명</span>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedLiveCreator(null)} className="p-2 hover:bg-white/8 rounded-lg transition-colors text-zinc-300 hover:text-white"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-left border-collapse">
                <thead className="bg-white/[0.02] text-zinc-300 text-xs sticky top-0">
                  <tr>
                    <th className="px-5 py-3 font-medium">방송 제목</th>
                    <th className="px-5 py-3 text-center font-medium">카테고리</th>
                    <th className="px-5 py-3 text-right font-medium">평균 시청자</th>
                    <th className="px-5 py-3 text-right font-medium">최고 시청자</th>
                    <th className="px-5 py-3 text-center font-medium">방송시간</th>
                    <th className="px-5 py-3 text-center font-medium">날짜</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {selectedLiveCreator.streams.map((s, i) => (
                    <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-5 py-3 text-xs text-zinc-200 max-w-[260px] truncate">{s.title || '(제목 없음)'}</td>
                      <td className="px-5 py-3 text-center">
                        <span className="text-[10px] bg-white/5 px-2 py-0.5 rounded text-zinc-300 border border-white/8">{s.category || '—'}</span>
                      </td>
                      <td className="px-5 py-3 text-right text-sm font-semibold text-orange-400 tabular-nums">{s.avgViewers.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right text-xs text-red-400 tabular-nums font-medium">{s.peakViewers.toLocaleString()}</td>
                      <td className="px-5 py-3 text-center text-xs text-zinc-300">{s.durationMin ? `${Math.floor(s.durationMin / 60)}h ${s.durationMin % 60}m` : '—'}</td>
                      <td className="px-5 py-3 text-center text-xs text-zinc-300 font-mono">{s.date || '—'}</td>
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
          <div className="bg-[#1a1b23] w-full max-w-4xl max-h-[85vh] rounded-2xl border border-white/8 overflow-hidden flex flex-col shadow-md">
            <div className="p-5 border-b border-white/8 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-pink-500 flex items-center justify-center shrink-0">
                  <span className="text-white text-sm font-bold">{selectedTkUser.username[0]?.toUpperCase()}</span>
                </div>
                <div>
                  <div className="text-base font-semibold text-white">@{selectedTkUser.username}</div>
                  <div className="text-xs text-zinc-300 mt-0.5 flex items-center gap-3">
                    <span>영상 {selectedTkUser.videoCount}개</span>
                    <span>평균 조회수 <span className="text-cyan-400 font-medium">{selectedTkUser.avgViews.toLocaleString()}</span></span>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedTkUser(null)} className="p-2 hover:bg-white/8 rounded-lg transition-colors text-zinc-300 hover:text-white"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-left border-collapse">
                <thead className="bg-white/[0.02] text-zinc-300 text-xs sticky top-0">
                  <tr>
                    <th className="px-5 py-3 font-medium">Video</th>
                    <th className="px-5 py-3 text-right font-medium">Views</th>
                    <th className="px-5 py-3 text-right font-medium">Likes</th>
                    <th className="px-5 py-3 text-right font-medium">Comments</th>
                    <th className="px-5 py-3 text-center font-medium">Duration</th>
                    <th className="px-5 py-3 text-center font-medium">Date</th>
                    <th className="px-5 py-3 text-center font-medium">Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {selectedTkUser.videos.map((v, i) => (
                    <tr key={v.id || i} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-5 py-3 flex items-center gap-3">
                        {v.thumbnail ? (
                          <img src={v.thumbnail} className="w-9 h-14 object-cover rounded-lg border border-white/8 shrink-0" />
                        ) : (
                          <div className="w-9 h-14 bg-zinc-900 rounded-lg flex items-center justify-center shrink-0"><Music size={14} className="text-zinc-200" /></div>
                        )}
                        <span className="text-xs text-zinc-200 line-clamp-2 max-w-[260px]">{v.title || '(제목 없음)'}</span>
                      </td>
                      <td className="px-5 py-3 text-right text-sm font-semibold text-cyan-400 tabular-nums">{v.viewCount.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right text-xs text-pink-400 tabular-nums">{v.likeCount.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right text-xs text-zinc-200 tabular-nums">{v.commentCount.toLocaleString()}</td>
                      <td className="px-5 py-3 text-center text-xs text-zinc-300">{v.duration ? `${v.duration}s` : '—'}</td>
                      <td className="px-5 py-3 text-center text-xs text-zinc-200 font-mono">{v.uploadDate ? `${v.uploadDate.slice(0,4)}-${v.uploadDate.slice(4,6)}-${v.uploadDate.slice(6,8)}` : '—'}</td>
                      <td className="px-5 py-3 text-center">
                        {v.url ? (
                          <a href={v.url} target="_blank" className="p-1.5 bg-white/5 hover:bg-cyan-600 hover:text-white text-zinc-200 rounded-lg transition-all inline-flex"><ExternalLink size={13} /></a>
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
          <div className="bg-[#1a1b23] w-full max-w-6xl h-[85vh] rounded-2xl border border-white/8 overflow-hidden flex flex-col shadow-md animate-in fade-in duration-200">
            <div className="p-6 border-b border-white/8 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <img src={selectedChannel.thumbnail} className="w-12 h-12 rounded-xl border border-white/10 object-cover" alt="" />
                  <div className="absolute -bottom-1 -right-1 bg-violet-600 p-1 rounded-lg border-2 border-[#1a1b23]">
                    <Youtube size={10} className="text-white" />
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    {selectedChannel.channelName}
                    <a href={`https://youtube.com/channel/${selectedChannel.channelId}`} target="_blank" className="text-zinc-300 hover:text-violet-400 transition-all"><ExternalLink size={16} /></a>
                  </h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1 text-xs font-medium text-violet-400 bg-violet-500/10 px-2.5 py-0.5 rounded-full">
                      <Users size={11} /> {formatNumber(selectedChannel.subscriberCount)} Subscribers
                    </span>
                    <p className="text-xs text-zinc-300">Analytics Results</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button onClick={() => setSelectedChannel(null)} className="p-2 bg-white/5 hover:bg-white/10 text-zinc-200 hover:text-white rounded-lg transition-all">
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-10">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                <div className="space-y-6">
                  <div className="flex items-center justify-between border-b border-white/8 pb-3">
                    <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                      <div className="w-1.5 h-5 bg-violet-500 rounded-full"></div>
                      Shorts <span className="text-zinc-300 font-normal">({selectedChannel.shortsList.length})</span>
                    </h4>
                    <div className="text-right">
                      <div className="text-xs text-zinc-300 mb-0.5">Avg Views</div>
                      <div className="text-base font-semibold text-violet-400">{selectedChannel.avgShortsViews.toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {selectedChannel.shortsList.map((v) => (
                      <div key={v.id} className="bg-white/5 p-3 rounded-xl border border-white/8 flex items-center gap-4 hover:bg-white/[0.08] hover:border-violet-500/30 transition-all group">
                        <img src={v.thumbnail} className="w-12 h-12 rounded-lg object-cover" alt="" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-zinc-200 truncate leading-snug group-hover:text-white">{v.title}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-violet-400 font-medium">{v.viewCount.toLocaleString()} views</span>
                            <span className="text-xs text-zinc-200">{new Date(v.publishedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <a href={`https://youtube.com/shorts/${v.id}`} target="_blank" className="p-2 bg-white/5 text-zinc-200 hover:text-white hover:bg-violet-600 rounded-lg transition-all">
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center justify-between border-b border-white/8 pb-3">
                    <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                      <div className="w-1.5 h-5 bg-zinc-500 rounded-full"></div>
                      Longform <span className="text-zinc-300 font-normal">({selectedChannel.longsList.length})</span>
                    </h4>
                    <div className="text-right">
                      <div className="text-xs text-zinc-300 mb-0.5">Avg Views</div>
                      <div className="text-base font-semibold text-zinc-200">{selectedChannel.avgLongViews.toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {selectedChannel.longsList.map((v) => (
                      <div key={v.id} className="bg-white/5 p-3 rounded-xl border border-white/8 flex items-center gap-4 hover:bg-white/[0.08] hover:border-white/20 transition-all group">
                        <img src={v.thumbnail} className="w-20 h-12 rounded-lg object-cover" alt="" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-zinc-200 truncate leading-snug">{v.title}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-zinc-200 font-medium">{v.viewCount.toLocaleString()} views</span>
                            <span className="text-xs text-zinc-200">{new Date(v.publishedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <a href={`https://youtube.com/watch?v=${v.id}`} target="_blank" className="p-2 bg-white/5 text-zinc-200 hover:text-white hover:bg-zinc-700 rounded-lg transition-all">
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
          <div className="bg-[#1a1b23] w-full max-w-6xl h-[85vh] rounded-2xl border border-white/8 overflow-hidden flex flex-col shadow-md animate-in fade-in duration-200">
            <div className="p-6 border-b border-white/8 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <img src={selectedAdResult.thumbnail} className="w-12 h-12 rounded-xl border border-white/10 object-cover" alt="" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    {selectedAdResult.channelName} (광고 분석 결과)
                  </h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1 text-xs font-medium text-violet-400 bg-violet-500/10 px-2.5 py-0.5 rounded-full">
                      <Megaphone size={11} /> {selectedAdResult.totalAdCount} Detected Ads
                    </span>
                    <p className="text-xs text-zinc-300">Ad Detection Details</p>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedAdResult(null)} className="p-2 bg-white/5 hover:bg-white/10 text-zinc-200 hover:text-white rounded-lg transition-all">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-5">
              {selectedAdResult.adVideos.length === 0 ? (
                <div className="h-full flex items-center justify-center text-zinc-200 text-sm">분석된 광고 영상이 없습니다.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {selectedAdResult.adVideos.map((v) => (
                    <div key={v.id} className="bg-white/5 p-5 rounded-xl border border-white/8 hover:border-violet-500/30 transition-all group">
                      <div className="flex gap-4">
                        <img src={v.thumbnail} className={`shrink-0 rounded-lg object-cover ${v.isShort ? 'w-20 h-32' : 'w-28 h-18'}`} alt="" />
                        <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                          <div>
                            <div className="text-sm font-medium text-white line-clamp-2 leading-snug group-hover:text-violet-400 transition-colors">{v.title}</div>
                            <div className="flex items-center gap-3 mt-2">
                              <span className="text-xs text-zinc-200 flex items-center gap-1"><Eye size={11}/> {v.viewCount.toLocaleString()}</span>
                              <span className="text-xs text-zinc-300 flex items-center gap-1"><ThumbsUp size={11}/> {v.likeCount.toLocaleString()}</span>
                            </div>
                          </div>

                          <div className="mt-3 pt-3 border-t border-white/8 space-y-1.5">
                             <div className="text-xs text-zinc-200">Detection Evidence</div>
                             <div className="flex flex-wrap gap-1.5">
                               {v.detection.evidence.map((ev, idx) => (
                                 <span key={idx} className="text-xs bg-violet-600/10 text-violet-400 px-2 py-0.5 rounded-md flex items-center gap-1">
                                   <ShieldCheck size={10} /> {ev}
                                 </span>
                               ))}
                             </div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 flex items-center justify-between">
                         <div className="text-xs text-zinc-200">Published: {new Date(v.publishedAt).toLocaleDateString()}</div>
                         <a href={v.isShort ? `https://youtube.com/shorts/${v.id}` : `https://youtu.be/${v.id}`} target="_blank" className="bg-white/8 hover:bg-violet-600 text-white p-2 rounded-lg transition-all">
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
      <aside className="w-60 bg-[#16171f] border-r border-white/8 flex flex-col shrink-0 hidden xl:flex h-screen overflow-y-auto">
        {/* Logo */}
        <div className="p-5 border-b border-white/8">
          <div className="flex items-center gap-3">
            <div className="bg-violet-600 p-2 rounded-lg shrink-0">
              <Youtube className="text-white w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-white leading-tight">Parable</div>
              <div className="text-xs text-zinc-300 leading-tight">TubeMetric</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-5 pt-4">
          {/* ANALYSIS */}
          <div>
            <div className="px-2 mb-2 text-[10px] font-semibold text-zinc-200 tracking-widest uppercase">Analysis</div>
            <div className="space-y-0.5">
              {([
                { id: 'channel-config',   label: '채널 통합 분석',    Icon: TrendingUp,  soon: false },
                { id: 'video-config',     label: '단일 영상 분석',    Icon: Video,       soon: false },
                { id: 'ad-config',        label: '광고 영상 분석',    Icon: Megaphone,   soon: false },
                { id: 'live-config',      label: '라이브 지표 분석',  Icon: Tv2,         soon: false },
                { id: 'instagram-config', label: 'Instagram 분석',   Icon: Instagram,   soon: false },
                { id: 'tiktok-config',    label: 'TikTok 분석',      Icon: Music,       soon: false },
              ] as { id: TabType; label: string; Icon: React.ElementType; soon: boolean }[]).map(({ id, label, Icon, soon }) => (
                <button
                  key={id}
                  onClick={() => !soon && setActiveTab(id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all group ${
                    activeTab === id
                      ? 'bg-violet-600/15 text-violet-300 border border-violet-500/20'
                      : soon
                        ? 'text-zinc-200 cursor-default'
                        : 'text-zinc-300 hover:bg-white/5 hover:text-zinc-300'
                  }`}
                >
                  <Icon size={14} className={activeTab === id ? 'text-violet-400' : soon ? 'text-zinc-200' : 'text-zinc-200 group-hover:text-zinc-200'} />
                  <span className="flex-1 text-left">{label}</span>
                  {soon && <span className="text-[9px] bg-zinc-800 text-zinc-200 px-1.5 py-0.5 rounded font-normal">Soon</span>}
                  {!soon && activeTab === id && <div className="w-1 h-1 bg-violet-400 rounded-full" />}
                </button>
              ))}
            </div>
          </div>

          {/* DATA */}
          <div>
            <div className="px-2 mb-2 text-[10px] font-semibold text-zinc-200 tracking-widest uppercase">Data</div>
            <div className="space-y-0.5">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all group ${
                  activeTab === 'dashboard'
                    ? 'bg-violet-600/15 text-violet-300 border border-violet-500/20'
                    : 'text-zinc-300 hover:bg-white/5 hover:text-zinc-300'
                }`}
              >
                <History size={14} className={activeTab === 'dashboard' ? 'text-violet-400' : 'text-zinc-200 group-hover:text-zinc-200'} />
                <span className="flex-1 text-left">Analysis History</span>
                {(channelResults.length > 0 || videoResults.length > 0 || adResults.length > 0) && (
                  <span className="text-[9px] bg-violet-600/20 text-violet-400 px-1.5 py-0.5 rounded font-normal">
                    {[channelResults.length > 0, videoResults.length > 0, adResults.length > 0, scraperResults.length > 0].filter(Boolean).length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* SETTINGS */}
          <div>
            <div className="px-2 mb-2 text-[10px] font-semibold text-zinc-200 tracking-widest uppercase">Settings</div>
            <div className="space-y-0.5">
              {[
                { label: 'API 설정', Icon: Settings2 },
                { label: '내보내기 설정', Icon: FileSpreadsheet },
              ].map(({ label, Icon }) => (
                <div key={label} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-zinc-200 cursor-default">
                  <Icon size={14} className="text-zinc-800" />
                  <span>{label}</span>
                  <span className="ml-auto text-[9px] bg-zinc-800 text-zinc-200 px-1.5 py-0.5 rounded">Soon</span>
                </div>
              ))}
            </div>
          </div>
        </nav>

        <div className="p-4 border-t border-white/8">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shrink-0"></div>
            <span className="text-xs text-zinc-200">Vercel Connected</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-y-auto bg-[#0f1117]">
        <div className="p-6 md:px-10 md:py-8 max-w-7xl w-full mx-auto">

          {/* ── 공용 컴포넌트: Progress Bar ─────────────────────────────── */}
          {/* inline below each tab */}

          {activeTab === 'channel-config' ? (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white">채널 통합 분석</h2>
                  <p className="text-xs text-zinc-200 mt-0.5">YouTube 채널 평균 조회수 및 영상 데이터 수집</p>
                </div>
                <button
                  onClick={() => setShowHelp(!showHelp)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${showHelp ? 'bg-violet-600/20 text-violet-400 border border-violet-500/30' : 'bg-white/5 text-zinc-300 hover:text-zinc-300'}`}
                >
                  <Info size={13} /> 가이드
                </button>
              </div>

              {showHelp && (
                <div className="bg-[#1a1b23] border border-violet-500/20 rounded-xl p-5 animate-in fade-in duration-200">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <h4 className="font-medium text-violet-400 text-xs flex items-center gap-1.5"><CalendarDays size={12} /> 분석 기간</h4>
                      <p className="text-zinc-300 text-xs leading-relaxed">수집할 영상의 게시 기간을 필터링합니다. 전체 선택 시 기간 제한 없이 수집합니다.</p>
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-medium text-violet-400 text-xs flex items-center gap-1.5"><Activity size={12} /> 수집 개수</h4>
                      <p className="text-zinc-300 text-xs leading-relaxed">채널당 수집할 최대 영상 수를 지정합니다. 쇼츠/롱폼 각각 설정 가능합니다.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Input + Options grid */}
              <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
                {/* Left: List Input */}
                <div className="xl:col-span-3">
                  <div className="bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-4 h-full">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                        <List size={13} className="text-violet-500" /> Channel List
                        {channelList.length > 0 && <span className="bg-violet-600/20 text-violet-400 px-1.5 py-0.5 rounded text-[10px]">{channelList.length}</span>}
                      </label>
                      {channelList.length > 0 && (
                        <button onClick={clearChannelList} className="text-xs text-zinc-200 hover:text-red-400 transition-colors flex items-center gap-1">
                          <Trash2 size={11} /> 전체 삭제
                        </button>
                      )}
                    </div>
                    {/* Add field */}
                    <div className="flex gap-2">
                      <input
                        value={channelDraft}
                        onChange={e => setChannelDraft(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addChannelItem()}
                        placeholder="UC코드 또는 채널 URL 입력 후 Enter"
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-zinc-200 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
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
                        <div className="flex flex-col items-center justify-center py-12 text-zinc-200 space-y-2">
                          <List size={28} strokeWidth={1} />
                          <p className="text-xs">채널을 추가하세요</p>
                        </div>
                      ) : channelList.map((ch, i) => (
                        <div key={i} className="flex items-center gap-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/8 rounded-lg px-3 py-2 group transition-colors">
                          <div className="w-1.5 h-1.5 bg-zinc-700 rounded-full shrink-0" />
                          <span className="flex-1 text-xs font-mono text-zinc-300 truncate">{ch}</span>
                          <button onClick={() => removeChannelItem(i)} className="opacity-0 group-hover:opacity-100 text-zinc-200 hover:text-red-400 transition-all">
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                    {channelList.length > 0 && (
                      <p className="text-[10px] text-zinc-200">{channelList.length}개 채널 · Enter 또는 추가 버튼으로 입력</p>
                    )}
                  </div>
                </div>

                {/* Right: Options */}
                  <div className="xl:col-span-2 flex flex-col space-y-4">
                    {/* SECTION 1: 분석 기간 설정 (통합) */}
                    <div className="bg-[#1a1b23] p-5 rounded-xl border border-white/8 space-y-5">
                        <h3 className="text-sm font-medium text-white flex items-center gap-2 pb-2 border-b border-white/8">
                          <Calendar size={15} className="text-violet-500" /> 분석 기간 설정
                        </h3>

                        <div className="space-y-4">
                           <div className="flex justify-between items-center">
                              <label className="text-xs text-zinc-200 flex items-center gap-1.5">
                                <CalendarDays size={13} className="text-violet-400" /> 전체 영상 기준 기간
                              </label>
                              <button
                                onClick={() => setUseDateFilter(!useDateFilter)}
                                className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-all ${useDateFilter ? 'bg-violet-600 text-white' : 'bg-white/8 text-zinc-300'}`}
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
                                 className={`py-2 text-xs font-medium rounded-lg transition-all ${period === p ? 'bg-white text-black' : 'bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white'}`}
                               >
                                 {periodLabels[p]}
                               </button>
                             ))}
                           </div>
                           <p className="text-xs text-zinc-200 text-center">설정한 기간 내의 영상만 수집 대상에 포함됩니다.</p>
                        </div>
                    </div>

                    {/* SECTION 2: 영상 수집 개수 필터 (통합 ENABLED/DISABLED) */}
                    <div className="bg-[#1a1b23] p-5 rounded-xl border border-white/8 space-y-5">
                        <div className="flex justify-between items-center pb-2 border-b border-white/8">
                          <h3 className="text-sm font-medium text-white flex items-center gap-2">
                            <Activity size={15} className="text-violet-500" /> 영상 수집 개수 필터
                          </h3>
                          <button
                            onClick={() => setUseGlobalCountFilter(!useGlobalCountFilter)}
                            className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-all ${useGlobalCountFilter ? 'bg-violet-600 text-white' : 'bg-white/8 text-emerald-500'}`}
                          >
                            {useGlobalCountFilter ? 'Enabled' : 'Disabled'}
                          </button>
                        </div>

                        {/* Shorts Count Filter */}
                        <div className="space-y-3">
                           <div className="flex justify-between items-center">
                              <label className="text-xs text-zinc-200 flex items-center gap-1.5">
                                <Radio size={13} className="text-violet-400" /> Shorts Target
                              </label>
                              <div className="flex items-center gap-3">
                                <button
                                  disabled={!useGlobalCountFilter}
                                  onClick={() => setUseShorts(!useShorts)}
                                  className={`${(useShorts && useGlobalCountFilter) ? 'text-violet-500' : 'text-zinc-200'} transition-opacity ${!useGlobalCountFilter ? 'opacity-30' : ''}`}
                                >
                                  {(useShorts && useGlobalCountFilter) ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                                </button>
                              </div>
                           </div>
                           <div className={`space-y-2 transition-opacity ${(!useShorts || !useGlobalCountFilter) ? 'opacity-30' : ''}`}>
                              <div className="flex justify-between text-xs">
                                <span className="text-zinc-300">Max Target</span>
                                <span className="text-violet-400 font-medium">{useGlobalCountFilter ? `${targetShorts}개` : '전체 수집'}</span>
                              </div>
                              <input
                               type="range"
                               min="1"
                               max="100"
                               disabled={!useShorts || !useGlobalCountFilter}
                               value={Number(targetShorts)}
                               onChange={(e) => setTargetShorts(Number(e.target.value))}
                               className="w-full appearance-none bg-white/10 h-1.5 rounded-full accent-violet-500"
                              />
                           </div>
                        </div>

                        {/* Longform Count Filter */}
                        <div className="space-y-3">
                           <div className="flex justify-between items-center">
                              <label className="text-xs text-zinc-200 flex items-center gap-1.5">
                                <MonitorPlay size={13} className="text-zinc-200" /> Longform Target
                              </label>
                              <div className="flex items-center gap-3">
                                <button
                                  disabled={!useGlobalCountFilter}
                                  onClick={() => setUseLongs(!useLongs)}
                                  className={`${(useLongs && useGlobalCountFilter) ? 'text-white' : 'text-zinc-200'} transition-opacity ${!useGlobalCountFilter ? 'opacity-30' : ''}`}
                                >
                                  {(useLongs && useGlobalCountFilter) ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                                </button>
                              </div>
                           </div>
                           <div className={`space-y-2 transition-opacity ${(!useLongs || !useGlobalCountFilter) ? 'opacity-30' : ''}`}>
                              <div className="flex justify-between text-xs">
                                <span className="text-zinc-300">Max Target</span>
                                <span className="text-zinc-300 font-medium">{useGlobalCountFilter ? `${targetLong}개` : '전체 수집'}</span>
                              </div>
                              <input
                               type="range"
                               min="1"
                               max="50"
                               disabled={!useLongs || !useGlobalCountFilter}
                               value={Number(targetLong)}
                               onChange={(e) => setTargetLong(Number(e.target.value))}
                               className="w-full appearance-none bg-white/10 h-1.5 rounded-full accent-zinc-400"
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
                <div className="bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-3 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-white">
                      <Loader2 size={14} className="animate-spin text-violet-400" /> 분석 진행 중
                    </div>
                    <span className="text-xs text-zinc-300 tabular-nums">{channelDone} / {channelTotal} 완료 · {channelProgress}%</span>
                  </div>
                  <div className="w-full bg-white/8 rounded-full h-1 overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full transition-all duration-700" style={{ width: `${channelProgress}%` }} />
                  </div>
                  <div className="space-y-1 max-h-20 overflow-y-auto">
                    {channelResults.filter(r => r.status !== 'pending').slice(-4).map((r, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-zinc-200">
                        {r.status === 'completed' ? <CheckCircle2 size={11} className="text-emerald-500 shrink-0" /> : r.status === 'error' ? <AlertCircle size={11} className="text-red-500 shrink-0" /> : <Loader2 size={11} className="animate-spin text-violet-400 shrink-0" />}
                        <span className="truncate">{r.channelName !== '데이터 수집 중...' ? r.channelName : r.channelId}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Results Panel */}
              {channelResults.length > 0 && (
                <div className="bg-[#1a1b23] rounded-xl border border-white/8 overflow-hidden">
                  <button onClick={() => setShowChannelResults(p => !p)} className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center gap-2.5">
                      {showChannelResults ? <ChevronDown size={15} className="text-zinc-300" /> : <ChevronRight size={15} className="text-zinc-300" />}
                      <span className="text-sm font-medium text-white">분석 결과</span>
                      <span className="text-xs text-zinc-200">{channelResults.filter(r => r.status === 'completed').length}개 완료{channelResults.filter(r => r.status === 'error').length > 0 ? ` · ${channelResults.filter(r => r.status === 'error').length}개 오류` : ''}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isProcessing ? <Loader2 size={12} className="animate-spin text-violet-400" /> : channelResults.some(r => r.status === 'completed') ? <CheckCircle2 size={12} className="text-emerald-500" /> : null}
                    </div>
                  </button>
                  {showChannelResults && (
                    <div className="border-t border-white/8">
                      <div className="flex items-center justify-between px-6 py-3 border-b border-white/8 bg-[#0f1117]/50">
                        <div className="flex gap-1">
                          {(['table','chart','raw'] as ResultTab[]).map(t => (
                            <button key={t} onClick={() => setChannelResultTab(t)} className={`px-3 py-1 rounded text-xs font-medium transition-all ${channelResultTab === t ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:text-zinc-300 hover:bg-white/5'}`}>
                              {t === 'table' ? 'TABLE' : t === 'chart' ? 'CHART' : 'RAW DATA'}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={handleDownloadExcel} className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 text-zinc-200 hover:text-white rounded text-xs transition-all"><FileSpreadsheet size={11} /> Excel</button>
                          <button onClick={() => navigator.clipboard.writeText(channelResults.map(r => [r.channelName, r.channelId, r.subscriberCount, r.avgShortsViews, r.avgLongViews].join('\t')).join('\n'))} className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-zinc-200 hover:text-white rounded text-xs transition-all">Copy</button>
                        </div>
                      </div>
                      {channelResultTab === 'table' && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead className="bg-white/[0.02] text-zinc-300 text-xs">
                              <tr>
                                <th className="px-6 py-3 font-medium">Channel</th>
                                <th className="px-6 py-3 text-center font-medium">Subscribers</th>
                                <th className="px-6 py-3 text-right font-medium">Shorts Avg</th>
                                <th className="px-6 py-3 text-right font-medium">Longform Avg</th>
                                <th className="px-6 py-3 text-center font-medium">Detail</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                              {channelResults.map(r => (
                                <tr key={r.channelId} className="hover:bg-white/[0.02] transition-colors group">
                                  <td className="px-6 py-3.5 flex items-center gap-3">
                                    {r.thumbnail ? <img src={r.thumbnail} className="w-8 h-8 rounded-lg object-cover border border-white/8 shrink-0" /> : <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center shrink-0"><Loader2 className="animate-spin text-zinc-200" size={13} /></div>}
                                    <div className="min-w-0">
                                      <div className="text-xs font-medium text-zinc-200 group-hover:text-violet-400 transition-colors flex items-center gap-1.5 truncate max-w-[220px]">
                                        {r.channelName}
                                        {r.status === 'error' && <span className="text-[10px] bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded shrink-0">Error</span>}
                                        {r.status === 'processing' && <Loader2 size={10} className="animate-spin text-violet-400 shrink-0" />}
                                        {r.status === 'pending' && <span className="text-[10px] text-zinc-200 shrink-0">대기</span>}
                                      </div>
                                      <div className="text-[10px] text-zinc-200 font-mono mt-0.5 truncate max-w-[200px]">{r.status === 'error' ? r.error : r.channelId}</div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-3.5 text-center"><span className="bg-white/5 px-2.5 py-1 rounded text-zinc-200 text-xs border border-white/8">{r.status === 'completed' ? formatNumber(r.subscriberCount) : '—'}</span></td>
                                  <td className="px-6 py-3.5 text-right"><div className="text-sm font-semibold text-violet-400">{r.avgShortsViews > 0 ? r.avgShortsViews.toLocaleString() : '—'}</div><div className="text-[10px] text-zinc-200 mt-0.5">{r.shortsCountFound > 0 ? `${r.shortsCountFound} Shorts` : ''}</div></td>
                                  <td className="px-6 py-3.5 text-right"><div className="text-sm font-semibold text-zinc-200">{r.avgLongViews > 0 ? r.avgLongViews.toLocaleString() : '—'}</div><div className="text-[10px] text-zinc-200 mt-0.5">{r.longCountFound > 0 ? `${r.longCountFound} Videos` : ''}</div></td>
                                  <td className="px-6 py-3.5 text-center"><button disabled={r.status !== 'completed'} onClick={() => setSelectedChannel(r)} className="p-1.5 bg-white/5 hover:bg-violet-600 hover:text-white text-zinc-200 rounded-lg transition-all disabled:opacity-20 active:scale-90"><Eye size={14} /></button></td>
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
                            if (!done.length) return <p className="text-xs text-zinc-200 text-center py-8">완료된 채널이 없습니다.</p>;
                            const maxShorts = Math.max(...done.map(r => r.avgShortsViews), 1);
                            const maxLong = Math.max(...done.map(r => r.avgLongViews), 1);
                            return (
                              <>
                                <div>
                                  <p className="text-xs font-medium text-zinc-200 mb-3 flex items-center gap-1.5"><Radio size={12} className="text-violet-400" /> Shorts 평균 조회수</p>
                                  <div className="space-y-2">
                                    {done.map(r => (
                                      <div key={r.channelId} className="flex items-center gap-3">
                                        <span className="text-xs text-zinc-300 w-28 truncate shrink-0">{r.channelName}</span>
                                        <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                                          <div className="h-full bg-violet-500 rounded-full transition-all duration-500" style={{ width: `${(r.avgShortsViews / maxShorts) * 100}%` }} />
                                        </div>
                                        <span className="text-xs text-zinc-200 w-20 text-right shrink-0 tabular-nums">{r.avgShortsViews.toLocaleString()}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-zinc-200 mb-3 flex items-center gap-1.5"><MonitorPlay size={12} className="text-zinc-200" /> Longform 평균 조회수</p>
                                  <div className="space-y-2">
                                    {done.map(r => (
                                      <div key={r.channelId} className="flex items-center gap-3">
                                        <span className="text-xs text-zinc-300 w-28 truncate shrink-0">{r.channelName}</span>
                                        <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                                          <div className="h-full bg-zinc-400 rounded-full transition-all duration-500" style={{ width: `${(r.avgLongViews / maxLong) * 100}%` }} />
                                        </div>
                                        <span className="text-xs text-zinc-200 w-20 text-right shrink-0 tabular-nums">{r.avgLongViews.toLocaleString()}</span>
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
                        <pre className="p-6 text-[11px] text-zinc-300 overflow-auto max-h-96 font-mono leading-relaxed">{JSON.stringify(channelResults.map(r => ({ channelId: r.channelId, channelName: r.channelName, subscriberCount: r.subscriberCount, avgShortsViews: r.avgShortsViews, avgLongViews: r.avgLongViews, status: r.status })), null, 2)}</pre>
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
                <h2 className="text-xl font-semibold text-white">단일 영상 분석</h2>
                <p className="text-xs text-zinc-200 mt-0.5">YouTube 영상 URL 또는 ID로 조회수·댓글 분석</p>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
                {/* Left: list input */}
                <div className="xl:col-span-3 bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                      <Video size={13} className="text-violet-500" /> Video List
                      {videoList.length > 0 && <span className="bg-violet-600/20 text-violet-400 px-1.5 py-0.5 rounded text-[10px]">{videoList.length}</span>}
                    </label>
                    {videoList.length > 0 && (
                      <button onClick={() => setVideoInput('')} className="text-xs text-zinc-200 hover:text-red-400 transition-colors flex items-center gap-1"><Trash2 size={11} /> 전체 삭제</button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={videoDraft}
                      onChange={e => setVideoDraft(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addVideoItem()}
                      placeholder="영상 URL 또는 ID 입력 후 Enter"
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-zinc-200 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
                    />
                    <button onClick={addVideoItem} className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs rounded-lg transition-all active:scale-95"><Plus size={13} /> 추가</button>
                  </div>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {videoList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-zinc-200 space-y-2"><Video size={26} strokeWidth={1} /><p className="text-xs">영상을 추가하세요</p></div>
                    ) : videoList.map((v, i) => (
                      <div key={i} className="flex items-center gap-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/8 rounded-lg px-3 py-2 group transition-colors">
                        <div className="w-1.5 h-1.5 bg-zinc-700 rounded-full shrink-0" />
                        <span className="flex-1 text-xs font-mono text-zinc-300 truncate">{v}</span>
                        <button onClick={() => removeVideoItem(i)} className="opacity-0 group-hover:opacity-100 text-zinc-200 hover:text-red-400 transition-all"><X size={13} /></button>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Right: Run */}
                <div className="xl:col-span-2 flex flex-col gap-4">
                  <div className="bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-3 flex-1">
                    <h3 className="text-xs font-medium text-zinc-200">수집 설정</h3>
                    <p className="text-xs text-zinc-200 leading-relaxed">URL 또는 11자리 영상 ID를 입력하세요. 중복은 자동으로 제거됩니다.</p>
                    <div className="bg-white/[0.02] rounded-lg p-3 space-y-1">
                      <p className="text-[10px] text-zinc-200">지원 형식</p>
                      <p className="text-[10px] text-zinc-200 font-mono">youtube.com/watch?v=xxx</p>
                      <p className="text-[10px] text-zinc-200 font-mono">youtu.be/xxx</p>
                      <p className="text-[10px] text-zinc-200 font-mono">youtube.com/shorts/xxx</p>
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
                <div className="bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-3 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-white"><Loader2 size={14} className="animate-spin text-violet-400" /> 수집 진행 중</div>
                    <span className="text-xs text-zinc-300 tabular-nums">{videoDone} / {videoTotal} 완료 · {videoProgress}%</span>
                  </div>
                  <div className="w-full bg-white/8 rounded-full h-1 overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full transition-all duration-700" style={{ width: `${videoProgress}%` }} />
                  </div>
                </div>
              )}

              {/* Results Panel */}
              {videoResults.length > 0 && (
                <div className="bg-[#1a1b23] rounded-xl border border-white/8 overflow-hidden">
                  <button onClick={() => setShowVideoResults(p => !p)} className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center gap-2.5">
                      {showVideoResults ? <ChevronDown size={15} className="text-zinc-300" /> : <ChevronRight size={15} className="text-zinc-300" />}
                      <span className="text-sm font-medium text-white">수집 결과</span>
                      <span className="text-xs text-zinc-200">{videoResults.filter(v => v.status === 'completed').length}개 완료</span>
                    </div>
                    {!isProcessing && videoResults.some(v => v.status === 'completed') && <CheckCircle2 size={12} className="text-emerald-500" />}
                  </button>
                  {showVideoResults && (
                    <div className="border-t border-white/8">
                      <div className="flex items-center justify-between px-6 py-3 border-b border-white/8 bg-[#0f1117]/50">
                        <div className="flex gap-1">
                          {(['table','chart','raw'] as ResultTab[]).map(t => (
                            <button key={t} onClick={() => setVideoResultTab(t)} className={`px-3 py-1 rounded text-xs font-medium transition-all ${videoResultTab === t ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:text-zinc-300 hover:bg-white/5'}`}>
                              {t === 'table' ? 'TABLE' : t === 'chart' ? 'CHART' : 'RAW DATA'}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={handleDownloadExcel} className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 text-zinc-200 hover:text-white rounded text-xs transition-all"><FileSpreadsheet size={11} /> Excel</button>
                        </div>
                      </div>
                      {videoResultTab === 'table' && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead className="bg-white/[0.02] text-zinc-300 text-xs">
                              <tr>
                                <th className="px-6 py-3 font-medium">Video</th>
                                <th className="px-6 py-3 font-medium">Channel</th>
                                <th className="px-6 py-3 text-center font-medium">Likes / Comments</th>
                                <th className="px-6 py-3 text-right font-medium">Views</th>
                                <th className="px-6 py-3 text-center font-medium">Detail</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                              {videoResults.map(v => (
                                <tr key={v.videoId} className="hover:bg-white/[0.02] transition-colors group">
                                  <td className="px-6 py-3.5 flex items-center gap-3">
                                    {v.thumbnail ? <img src={v.thumbnail} className={`rounded-lg object-cover border border-white/8 shrink-0 ${v.isShort ? 'w-7 h-10' : 'w-14 h-9'}`} /> : <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center shrink-0"><Loader2 className="animate-spin text-zinc-200" size={13} /></div>}
                                    <div className="min-w-0">
                                      <div className="text-xs font-medium text-zinc-200 group-hover:text-violet-400 transition-colors truncate max-w-[280px]">{v.title}</div>
                                      <div className="text-[10px] text-zinc-200 font-mono mt-0.5">{v.status === 'error' ? v.error : v.videoId}</div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-3.5 text-xs text-zinc-200">{v.channelTitle || '—'}</td>
                                  <td className="px-6 py-3.5 text-center">
                                    <div className="text-xs text-violet-400 flex items-center justify-center gap-1"><ThumbsUp size={10} /> {v.likeCount.toLocaleString()}</div>
                                    <div className="text-[10px] text-zinc-200 flex items-center justify-center gap-1 mt-0.5"><MessageSquare size={10} /> {v.commentCount.toLocaleString()}</div>
                                  </td>
                                  <td className="px-6 py-3.5 text-right text-sm font-semibold text-white tabular-nums">{v.viewCount.toLocaleString()}</td>
                                  <td className="px-6 py-3.5 text-center flex items-center justify-center gap-1.5">
                                    <button disabled={v.status !== 'completed'} onClick={() => setSelectedVideo(v)} className="p-1.5 bg-white/5 hover:bg-white/12 text-zinc-200 hover:text-white rounded-lg transition-all disabled:opacity-20 active:scale-90"><Eye size={13} /></button>
                                    <a href={v.isShort ? `https://youtube.com/shorts/${v.videoId}` : `https://youtube.com/watch?v=${v.videoId}`} target="_blank" className="p-1.5 bg-white/5 hover:bg-violet-600 text-zinc-200 hover:text-white rounded-lg transition-all"><ExternalLink size={13} /></a>
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
                            if (!done.length) return <p className="text-xs text-zinc-200 text-center py-8">완료된 영상이 없습니다.</p>;
                            const maxViews = Math.max(...done.map(v => v.viewCount), 1);
                            return (
                              <div>
                                <p className="text-xs font-medium text-zinc-200 mb-3 flex items-center gap-1.5"><Eye size={12} className="text-violet-400" /> 조회수 분포</p>
                                <div className="space-y-2">
                                  {done.slice(0, 20).map(v => (
                                    <div key={v.videoId} className="flex items-center gap-3">
                                      <span className="text-xs text-zinc-200 w-36 truncate shrink-0">{v.title}</span>
                                      <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                                        <div className="h-full bg-violet-500 rounded-full transition-all duration-500" style={{ width: `${(v.viewCount / maxViews) * 100}%` }} />
                                      </div>
                                      <span className="text-xs text-zinc-200 w-20 text-right tabular-nums shrink-0">{v.viewCount.toLocaleString()}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      {videoResultTab === 'raw' && (
                        <pre className="p-6 text-[11px] text-zinc-300 overflow-auto max-h-96 font-mono leading-relaxed">{JSON.stringify(videoResults.map(v => ({ videoId: v.videoId, title: v.title, viewCount: v.viewCount, likeCount: v.likeCount, commentCount: v.commentCount, status: v.status })), null, 2)}</pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : activeTab === 'ad-config' ? (
            /* ── 광고 분석 탭 ─────────────────────────────────────────────────── */
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Header */}
              <div>
                <h2 className="text-xl font-semibold text-white">채널 광고 분석</h2>
                <p className="text-xs text-zinc-200 mt-0.5">채널별 광고 영상 수 및 광고 비율 분석</p>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
                {/* Left: list input */}
                <div className="xl:col-span-3 bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                      <List size={13} className="text-violet-500" /> Channel List
                      {adList.length > 0 && <span className="bg-violet-600/20 text-violet-400 px-1.5 py-0.5 rounded text-[10px]">{adList.length}</span>}
                    </label>
                    {adList.length > 0 && (
                      <button onClick={clearAdList} className="text-xs text-zinc-200 hover:text-red-400 transition-colors flex items-center gap-1"><Trash2 size={11} /> 전체 삭제</button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={adDraft}
                      onChange={e => setAdDraft(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addAdItem()}
                      placeholder="UC코드 또는 채널 URL 입력 후 Enter"
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-zinc-200 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
                    />
                    <button onClick={addAdItem} className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs rounded-lg transition-all active:scale-95"><Plus size={13} /> 추가</button>
                  </div>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {adList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-zinc-200 space-y-2"><List size={26} strokeWidth={1} /><p className="text-xs">채널을 추가하세요</p></div>
                    ) : adList.map((ch, i) => (
                      <div key={i} className="flex items-center gap-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/8 rounded-lg px-3 py-2 group transition-colors">
                        <div className="w-1.5 h-1.5 bg-zinc-700 rounded-full shrink-0" />
                        <span className="flex-1 text-xs font-mono text-zinc-300 truncate">{ch}</span>
                        <button onClick={() => removeAdItem(i)} className="opacity-0 group-hover:opacity-100 text-zinc-200 hover:text-red-400 transition-all"><X size={13} /></button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: options + run */}
                <div className="xl:col-span-2 flex flex-col gap-4">
                  {/* Date filter */}
                  <div className="bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-white/8">
                      <h3 className="text-xs font-medium text-white flex items-center gap-1.5"><Calendar size={13} className="text-violet-500" /> 분석 기간</h3>
                      <button
                        onClick={() => setAdUseDateFilter(!adUseDateFilter)}
                        className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-all ${adUseDateFilter ? 'bg-violet-600 text-white' : 'bg-white/8 text-zinc-300'}`}
                      >
                        {adUseDateFilter ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                    <div className={`grid grid-cols-4 gap-1.5 transition-opacity ${!adUseDateFilter ? 'opacity-30 pointer-events-none' : ''}`}>
                      {(['all', '90d', '30d', '7d'] as AnalysisPeriod[]).map(p => (
                        <button key={p} onClick={() => setAdPeriod(p)} className={`py-2 text-xs font-medium rounded-lg transition-all ${adPeriod === p ? 'bg-white text-black' : 'bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white'}`}>
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
                <div className="bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-3 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-white"><Loader2 size={14} className="animate-spin text-violet-400" /> 분석 진행 중</div>
                    <span className="text-xs text-zinc-300 tabular-nums">{adDone} / {adTotal} 완료 · {adProgress}%</span>
                  </div>
                  <div className="w-full bg-white/8 rounded-full h-1 overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full transition-all duration-700" style={{ width: `${adProgress}%` }} />
                  </div>
                </div>
              )}

              {/* Results Panel */}
              {adResults.length > 0 && (
                <div className="bg-[#1a1b23] rounded-xl border border-white/8 overflow-hidden">
                  <button onClick={() => setShowAdResults(p => !p)} className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center gap-2.5">
                      {showAdResults ? <ChevronDown size={15} className="text-zinc-300" /> : <ChevronRight size={15} className="text-zinc-300" />}
                      <span className="text-sm font-medium text-white">광고 분석 결과</span>
                      <span className="text-xs text-zinc-200">{adResults.filter(r => r.status === 'completed').length}개 완료</span>
                    </div>
                    {!isProcessing && adResults.some(r => r.status === 'completed') && <CheckCircle2 size={12} className="text-emerald-500" />}
                  </button>
                  {showAdResults && (
                    <div className="border-t border-white/8">
                      <div className="flex items-center justify-between px-6 py-3 border-b border-white/8 bg-[#0f1117]/50">
                        <div className="flex gap-1">
                          {(['table','chart','raw'] as ResultTab[]).map(t => (
                            <button key={t} onClick={() => setAdResultTab(t)} className={`px-3 py-1 rounded text-xs font-medium transition-all ${adResultTab === t ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:text-zinc-300 hover:bg-white/5'}`}>
                              {t === 'table' ? 'TABLE' : t === 'chart' ? 'CHART' : 'RAW DATA'}
                            </button>
                          ))}
                        </div>
                        <button onClick={handleDownloadExcel} className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 text-zinc-200 hover:text-white rounded text-xs transition-all"><FileSpreadsheet size={11} /> Excel</button>
                      </div>
                      {adResultTab === 'table' && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead className="bg-white/[0.02] text-zinc-300 text-xs">
                              <tr>
                                <th className="px-6 py-3 font-medium">Channel</th>
                                <th className="px-6 py-3 text-right font-medium">Total Videos</th>
                                <th className="px-6 py-3 text-right font-medium">Ad Videos</th>
                                <th className="px-6 py-3 text-right font-medium">Ad Ratio</th>
                                <th className="px-6 py-3 text-right font-medium">Avg Ad Views</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                              {adResults.map(r => (
                                <tr key={r.channelId} className="hover:bg-white/[0.02] transition-colors group">
                                  <td className="px-6 py-3.5 flex items-center gap-3">
                                    {r.thumbnail ? <img src={r.thumbnail} className="w-8 h-8 rounded-lg object-cover border border-white/8 shrink-0" /> : <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center shrink-0"><Loader2 className="animate-spin text-zinc-200" size={13} /></div>}
                                    <div className="min-w-0">
                                      <div className="text-xs font-medium text-zinc-200 truncate max-w-[200px] group-hover:text-violet-400 transition-colors">{r.channelName}</div>
                                      <div className="text-[10px] text-zinc-200 font-mono mt-0.5 truncate max-w-[180px]">{r.status === 'error' ? <span className="text-red-400">{r.error}</span> : r.channelId}</div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-3.5 text-right text-xs text-zinc-200 tabular-nums">{r.status === 'completed' ? r.totalVideoCount.toLocaleString() : '—'}</td>
                                  <td className="px-6 py-3.5 text-right text-xs text-violet-400 tabular-nums font-medium">{r.status === 'completed' ? r.totalAdCount.toLocaleString() : '—'}</td>
                                  <td className="px-6 py-3.5 text-right">
                                    {r.status === 'completed' ? (
                                      <span className={`text-xs font-semibold ${r.adRatio >= 50 ? 'text-red-400' : r.adRatio >= 20 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                                        {r.adRatio.toFixed(1)}%
                                      </span>
                                    ) : '—'}
                                  </td>
                                  <td className="px-6 py-3.5 text-right text-xs text-zinc-300 tabular-nums">{r.status === 'completed' && r.avgAdViews > 0 ? r.avgAdViews.toLocaleString() : '—'}</td>
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
                            if (!done.length) return <p className="text-xs text-zinc-200 text-center py-8">완료된 채널이 없습니다.</p>;
                            const maxAd = Math.max(...done.map(r => r.totalAdCount), 1);
                            return (
                              <>
                                <div>
                                  <p className="text-xs font-medium text-zinc-200 mb-3">광고 영상 수</p>
                                  <div className="space-y-2">
                                    {done.map(r => (
                                      <div key={r.channelId} className="flex items-center gap-3">
                                        <span className="text-xs text-zinc-300 w-28 truncate shrink-0">{r.channelName}</span>
                                        <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                                          <div className="h-full bg-violet-500 rounded-full transition-all duration-500" style={{ width: `${(r.totalAdCount / maxAd) * 100}%` }} />
                                        </div>
                                        <span className="text-xs text-zinc-200 w-16 text-right shrink-0 tabular-nums">{r.totalAdCount}</span>
                                        <span className={`text-xs w-14 text-right shrink-0 font-medium ${r.adRatio >= 50 ? 'text-red-400' : r.adRatio >= 20 ? 'text-yellow-400' : 'text-emerald-400'}`}>{r.adRatio.toFixed(1)}%</span>
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
                        <pre className="p-6 text-[11px] text-zinc-300 overflow-auto max-h-96 font-mono leading-relaxed">{JSON.stringify(adResults.map(r => ({ channelId: r.channelId, channelName: r.channelName, totalVideoCount: r.totalVideoCount, totalAdCount: r.totalAdCount, adRatio: r.adRatio, avgAdViews: r.avgAdViews, status: r.status })), null, 2)}</pre>
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
                  <h2 className="text-xl font-semibold text-white">라이브 지표 분석</h2>
                  <p className="text-xs text-zinc-200 mt-0.5">CHZZK / SOOP 방송 시청자 지표 수집 · viewership.softc.one</p>
                </div>
                {liveMode === 'backend' && (localAgentRunning ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                    <span className="text-xs text-emerald-400 font-medium">로컬 에이전트 연결됨</span>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowInstallModal(true)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/10 border border-orange-500/30 rounded-lg hover:bg-orange-500/20 transition-colors"
                  >
                    <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />
                    <span className="text-xs text-orange-400 font-medium">로컬 에이전트 설치 필요</span>
                  </button>
                ))}
              </div>

              {/* 로컬 에이전트 배너 */}
              {!softcLocalRunning && (
                <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircle size={16} className="text-orange-400 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-orange-300">SoftC 로컬 에이전트가 필요합니다</p>
                    <p className="text-xs text-zinc-300 mt-1">
                      PC에 에이전트를 설치하면 headless=False Chrome으로 직접 수집합니다. bot 감지 우회에 효과적입니다.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowSoftcInstallModal(true)}
                    className="shrink-0 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    설치하기
                  </button>
                </div>
              )}
              {softcLocalRunning && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                  <span className="text-xs text-emerald-400 font-medium">로컬 에이전트 연결됨 (port 8002)</span>
                </div>
              )}

              {/* SoftC 에이전트 설치 모달 */}
              {showSoftcInstallModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                  <div className="bg-[#1a1b23] border border-white/10 rounded-2xl p-7 w-full max-w-md mx-4 shadow-2xl">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="text-base font-semibold text-white flex items-center gap-2">
                        <ShieldCheck size={18} className="text-orange-400" />
                        TubeMetric SoftC Scraper 설치
                      </h3>
                      <button onClick={() => { setShowSoftcInstallModal(false); setWaitingForSoftcAgent(false); }} className="text-zinc-400 hover:text-white">
                        <X size={18} />
                      </button>
                    </div>
                    <div className="space-y-4 text-xs text-zinc-300">
                      <p>라이브 지표를 PC의 Chrome으로 직접 수집하는 에이전트입니다.</p>
                      <div className="bg-white/4 rounded-lg p-3 space-y-1.5">
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-400" /> headless=False · 실제 Chrome 창 실행</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-400" /> undetected_chromedriver — bot 감지 우회</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-400" /> Windows 시작 시 자동 실행</p>
                        <p className="flex items-center gap-2"><Info size={13} className="text-zinc-400" /> PC에 Chrome이 설치되어 있어야 합니다</p>
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
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-zinc-600 hover:bg-zinc-500 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          <Download size={15} />
                          macOS용 설치파일 다운로드 (.pkg)
                        </a>
                      )}
                    </div>
                    {waitingForSoftcAgent && (
                      <div className="mt-4 flex items-center gap-2 text-xs text-zinc-400">
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
                  <div className="bg-[#1a1b23] border border-white/10 rounded-2xl p-7 w-full max-w-md mx-4 shadow-2xl">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="text-base font-semibold text-white flex items-center gap-2">
                        <ShieldCheck size={18} className="text-orange-400" />
                        TubeMetric Local Agent 설치
                      </h3>
                      <button onClick={() => { setShowInstallModal(false); setWaitingForAgent(false); }} className="text-zinc-400 hover:text-white">
                        <X size={18} />
                      </button>
                    </div>

                    <div className="space-y-4 text-xs text-zinc-300">
                      <p>라이브 지표 수집을 위해 PC에 소형 프로그램을 설치합니다.</p>
                      <div className="bg-white/4 rounded-lg p-3 space-y-1.5">
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-400" /> Python 런타임 포함 — 별도 설치 불필요</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-400" /> Windows 시작 시 자동 실행</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-400" /> 본인 IP/VPN으로 수집 (차단 우회)</p>
                        <p className="flex items-center gap-2"><Info size={13} className="text-zinc-400" /> 첫 실행 시 Chromium 자동 다운로드 (~150MB)</p>
                      </div>
                    </div>

                    <div className="mt-6 space-y-2">
                      {/* OS별 다운로드 버튼 */}
                      {(detectOS() === 'windows' || detectOS() === 'other') && (
                        <a
                          href={INSTALLER_URLS.windows}
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
                          href={INSTALLER_URLS.macos}
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
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-zinc-600 hover:bg-zinc-500 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          <Download size={15} />
                          macOS용 설치파일 다운로드 (.pkg)
                        </a>
                      )}
                    </div>

                    {waitingForAgent && (
                      <div className="mt-4 flex items-center gap-2 text-xs text-zinc-400">
                        <Loader2 size={13} className="animate-spin" />
                        설치 후 에이전트 연결 대기 중... (자동으로 감지됩니다)
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 가이드 토글 */}
              <div className="bg-[#1a1b23] border border-white/8 rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowSoftcGuide(v => !v)}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.03] transition-colors"
                >
                  <p className="text-xs font-medium text-zinc-200 flex items-center gap-2">
                    <Info size={13} className="text-orange-400" />
                    로컬 에이전트 사용 가이드
                  </p>
                  <span className={`text-zinc-400 transition-transform ${showSoftcGuide ? 'rotate-180' : ''}`}>▾</span>
                </button>

                {showSoftcGuide && (
                  <div className="px-5 pb-5 space-y-3 border-t border-white/8">
                    <div className="space-y-2 text-xs text-zinc-200 pt-3">
                      <p className="font-medium text-zinc-100">로컬 에이전트 (TubeMetric SoftC Scraper)</p>
                      <p>① 위 [설치하기]에서 OS에 맞는 파일을 다운받아 설치합니다.</p>
                      <p>② 설치 완료 후 자동 실행되며 포트 <code className="bg-white/8 px-1.5 py-0.5 rounded">8002</code>에서 서버가 시작됩니다.</p>
                      <p>③ 연결됨 표시가 나타나면 크리에이터 ID를 입력하고 수집을 시작합니다.</p>
                      <div className="bg-white/4 rounded-lg p-3 space-y-1.5 mt-2">
                        <p className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-400 shrink-0" /> headless=False — 실제 Chrome 창이 열려 수집합니다</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-400 shrink-0" /> undetected_chromedriver — bot 탐지 우회</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-400 shrink-0" /> 페이지네이션 자동 처리 · 100행 기준 강제 다음 페이지</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-400 shrink-0" /> 실패 시 자동 재시도 (최대 2회)</p>
                        <p className="flex items-center gap-2"><Info size={12} className="text-zinc-400 shrink-0" /> PC에 Google Chrome이 설치되어 있어야 합니다</p>
                        <p className="flex items-center gap-2"><Info size={12} className="text-zinc-400 shrink-0" /> Windows 시작 시 자동 실행, macOS LaunchAgent 등록</p>
                      </div>
                      <p className="text-zinc-400">크리에이터 ID 형식: <code className="bg-white/8 px-1 rounded">chzzk:채널ID</code> 또는 <code className="bg-white/8 px-1 rounded">soop:아이디</code></p>
                    </div>
                  </div>
                )}
              </div>

              {/* 작동 방식 (가이드 내부로 이동 — 하위 호환용 빈 div 유지) */}
              <div className="bg-[#1a1b23] border border-white/8 rounded-xl p-5 space-y-3" style={{display:'none'}}>
                <p className="text-xs font-medium text-zinc-200 flex items-center gap-2"><Tv2 size={13} className="text-orange-500" /> 작동 방식</p>
                <div className="space-y-1.5 text-xs text-zinc-200">
                  <p>① 아래에서 플랫폼(CHZZK/SOOP)과 크리에이터 ID를 입력합니다.</p>
                  <p>② 로컬 에이전트가 <strong>Chrome</strong>으로 <code className="bg-white/8 px-1.5 py-0.5 rounded">viewership.softc.one</code>에서 데이터를 수집합니다.</p>
                  <p>③ 평균 시청자 수, 최고 시청자 수, 방송 시간 등의 지표가 표시됩니다.</p>
                </div>
                <div className="border-t border-white/8 pt-3 text-[10px] text-zinc-300">
                  입력 형식: <code className="bg-white/8 px-1 rounded">크리에이터ID</code> 또는 <code className="bg-white/8 px-1 rounded">chzzk:ID</code> / <code className="bg-white/8 px-1 rounded">soop:ID</code>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
                {/* Left: creator input */}
                <div className="xl:col-span-3 bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                      <Tv2 size={13} className="text-orange-500" /> Creator List
                      {liveList.length > 0 && <span className="bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded text-[10px]">{liveList.length}</span>}
                    </label>
                    {liveList.length > 0 && (
                      <button onClick={clearLiveList} className="text-xs text-zinc-300 hover:text-red-400 transition-colors flex items-center gap-1"><Trash2 size={11} /> 전체 삭제</button>
                    )}
                  </div>

                  {/* 플랫폼 선택 */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setLivePlatform('chzzk')}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${livePlatform === 'chzzk' ? 'bg-blue-600 text-white' : 'bg-white/5 text-zinc-300 hover:bg-white/10'}`}
                    >CHZZK</button>
                    <button
                      onClick={() => setLivePlatform('soop')}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${livePlatform === 'soop' ? 'bg-purple-600 text-white' : 'bg-white/5 text-zinc-300 hover:bg-white/10'}`}
                    >SOOP (아프리카TV)</button>
                  </div>

                  <div className="flex gap-2">
                    <input
                      value={liveDraft}
                      onChange={e => setLiveDraft(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addLiveItem()}
                      placeholder="크리에이터 채널 ID 입력 후 Enter (또는 chzzk:ID)"
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-zinc-200 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20"
                    />
                    <button onClick={addLiveItem} className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg transition-all active:scale-95"><Plus size={13} /> 추가</button>
                  </div>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {liveList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-zinc-300 space-y-2"><Tv2 size={26} strokeWidth={1} /><p className="text-xs">크리에이터를 추가하세요</p></div>
                    ) : liveList.map((u, i) => (
                      <div key={i} className="flex items-center gap-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/8 rounded-lg px-3 py-2 group transition-colors">
                        <span className={`text-xs shrink-0 px-1.5 py-0.5 rounded ${u.includes('soop') ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>
                          {u.includes('soop:') ? 'SOOP' : u.includes('chzzk:') ? 'CHZZK' : livePlatform.toUpperCase()}
                        </span>
                        <span className="flex-1 text-xs font-mono text-zinc-200 truncate">{u.includes(':') ? u.split(':')[1] : u}</span>
                        <button onClick={() => removeLiveItem(i)} className="opacity-0 group-hover:opacity-100 text-zinc-300 hover:text-red-400 transition-all"><X size={13} /></button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: date range + run */}
                <div className="xl:col-span-2 flex flex-col gap-4">
                  {/* 날짜 범위 */}
                  <div className="bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-4">
                    <h3 className="text-xs font-medium text-white flex items-center gap-1.5"><CalendarDays size={13} className="text-orange-500" /> 수집 기간</h3>
                    <div className="space-y-3">
                      <div className="group relative bg-white/5 border border-white/8 hover:border-orange-500/30 rounded-xl p-3 transition-all">
                        <label className="absolute -top-2 left-3 bg-[#1a1b23] px-1.5 text-xs text-zinc-300 group-hover:text-orange-400">Start</label>
                        <div className="flex items-center gap-2">
                          <Calendar size={13} className="text-orange-500 shrink-0" />
                          <input
                            type="date"
                            value={liveStartDate}
                            onChange={e => setLiveStartDate(e.target.value)}
                            className="w-full bg-transparent border-none text-white text-sm focus:ring-0 cursor-pointer outline-none [color-scheme:dark]"
                          />
                        </div>
                      </div>
                      <div className="group relative bg-white/5 border border-white/8 hover:border-orange-500/30 rounded-xl p-3 transition-all">
                        <label className="absolute -top-2 left-3 bg-[#1a1b23] px-1.5 text-xs text-zinc-300 group-hover:text-orange-400">End</label>
                        <div className="flex items-center gap-2">
                          <Calendar size={13} className="text-orange-500 shrink-0" />
                          <input
                            type="date"
                            value={liveEndDate}
                            onChange={e => setLiveEndDate(e.target.value)}
                            className="w-full bg-transparent border-none text-white text-sm focus:ring-0 cursor-pointer outline-none [color-scheme:dark]"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Status */}
                  {liveJobStatus !== 'idle' && (
                    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-medium ${
                      liveJobStatus === 'submitting' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                      liveJobStatus === 'done'       ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                                       'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}>
                      {liveJobStatus === 'submitting' && <Loader2 size={13} className="animate-spin shrink-0" />}
                      {liveJobStatus === 'done'  && <CheckCircle2 size={13} className="shrink-0" />}
                      {liveJobStatus === 'error' && <AlertCircle size={13} className="shrink-0" />}
                      <span>{{
                        submitting: 'softc.one에서 수집 중... (로컬 Chrome · headless=False)',
                        done:       '완료! 아래에서 결과를 확인하세요.',
                        error:      liveErrorMsg ? `오류: ${liveErrorMsg}` : '백엔드 연결 실패 또는 수집 오류',
                        idle:       '',
                      }[liveJobStatus]}</span>
                    </div>
                  )}

                  <div className="mt-auto">
                    <button
                      onClick={handleLiveRequest}
                      disabled={liveJobStatus === 'submitting' || !softcLocalRunning}
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
                <div className="bg-[#1a1b23] rounded-xl border border-white/8 overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
                    <div className="flex items-center gap-2.5">
                      <Tv2 size={14} className="text-orange-500" />
                      <span className="text-sm font-medium text-white">수집 결과</span>
                      <span className="text-xs text-zinc-300">{liveResults.length}개 크리에이터</span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-white/[0.02] text-zinc-300 text-xs">
                        <tr>
                          <th className="px-6 py-3 font-medium">Creator</th>
                          <th className="px-6 py-3 text-center font-medium">Platform</th>
                          <th className="px-6 py-3 text-center font-medium">방송 수</th>
                          <th className="px-6 py-3 text-right font-medium">평균 시청자</th>
                          <th className="px-6 py-3 text-right font-medium">최고 시청자</th>
                          <th className="px-6 py-3 text-right font-medium">총 방송시간</th>
                          <th className="px-6 py-3 text-center font-medium">Status</th>
                          <th className="px-6 py-3 text-center font-medium">Detail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {liveResults.map(r => (
                          <tr key={`${r.platform}-${r.creatorId}`} className="hover:bg-white/[0.02] transition-colors group">
                            <td className="px-6 py-3.5">
                              <div className="flex items-center gap-2.5">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${r.platform === 'CHZZK' ? 'bg-blue-500/20' : 'bg-purple-500/20'}`}>
                                  <Tv2 size={14} className={r.platform === 'CHZZK' ? 'text-blue-400' : 'text-purple-400'} />
                                </div>
                                <div>
                                  <div className="text-xs font-medium text-zinc-100 group-hover:text-orange-400 transition-colors">{r.creatorId}</div>
                                  {r.error && <div className="text-[10px] text-red-400 mt-0.5">{r.error}</div>}
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              <span className={`text-[10px] px-2 py-0.5 rounded ${r.platform === 'CHZZK' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'}`}>
                                {r.platform}
                              </span>
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              <span className="bg-white/5 px-2.5 py-1 rounded text-zinc-200 text-xs border border-white/8">{r.streamCount}</span>
                            </td>
                            <td className="px-6 py-3.5 text-right text-sm font-semibold text-orange-400 tabular-nums">{r.avgViewers.toLocaleString()}</td>
                            <td className="px-6 py-3.5 text-right text-xs text-red-400 tabular-nums font-medium">{r.peakViewers.toLocaleString()}</td>
                            <td className="px-6 py-3.5 text-right text-xs text-zinc-200 tabular-nums">{Math.round(r.totalDurationMin / 60)}시간 {r.totalDurationMin % 60}분</td>
                            <td className="px-6 py-3.5 text-center">
                              <span className={`text-[10px] px-2 py-0.5 rounded ${r.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                {r.status === 'completed' ? '완료' : '오류'}
                              </span>
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              <button
                                onClick={() => setSelectedLiveCreator(r)}
                                disabled={!r.streamCount}
                                className="p-1.5 bg-white/5 hover:bg-orange-600 hover:text-white text-zinc-200 rounded-lg transition-all disabled:opacity-20 active:scale-90"
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
                  <h2 className="text-xl font-semibold text-white">Instagram 릴스 분석</h2>
                  <p className="text-xs text-zinc-200 mt-0.5">{isBackendAvailable() ? '클라우드 백엔드를 통해' : '로컬 서버를 통해'} 릴스 조회수·좋아요·댓글 수집</p>
                </div>
                {isBackendAvailable() ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                    <span className="text-xs text-emerald-400 font-medium">클라우드 연결</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" />
                    <span className="text-xs text-amber-400 font-medium">로컬 서버 필요</span>
                  </div>
                )}
              </div>

              {/* 작동 방식 안내 */}
              <div className="bg-[#1a1b23] border border-white/8 rounded-xl p-5 space-y-3">
                <p className="text-xs font-medium text-zinc-300 flex items-center gap-2"><Activity size={13} className="text-violet-500" /> 작동 방식</p>
                {isBackendAvailable() ? (
                  <div className="space-y-1.5 text-xs text-zinc-300">
                    <p>① 아래에서 계정을 입력하고 <strong className="text-zinc-300">수집 요청</strong>을 클릭합니다.</p>
                    <p>② 클라우드 백엔드가 <code className="bg-white/8 px-1.5 py-0.5 rounded">instaloader</code>로 릴스 데이터를 직접 수집합니다.</p>
                    <p>③ 결과가 즉시 아래 패널에 표시됩니다.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5 text-xs text-zinc-300">
                    <p>① 아래에서 계정을 입력하고 <strong className="text-zinc-300">수집 요청</strong>을 클릭합니다.</p>
                    <p>② GitHub <code className="bg-white/8 px-1.5 py-0.5 rounded">results/queue/</code>에 요청 파일이 생성됩니다.</p>
                    <p>③ 로컬 PC의 <code className="bg-white/8 px-1.5 py-0.5 rounded">local_server.py</code>가 감지 → <code className="bg-white/8 px-1.5 py-0.5 rounded">instagram_scraper.py</code> 실행.</p>
                    <p>④ 완료 후 GitHub에 결과 push → 아래 결과 패널에 자동 반영.</p>
                  </div>
                )}
                <div className="border-t border-white/8 pt-3 text-xs text-zinc-200">
                  {isBackendAvailable()
                    ? '공개 계정은 로그인 없이 수집됩니다. 비공개 계정은 지원하지 않습니다.'
                    : '공개 계정은 로그인 없이 수집됩니다. 비공개 계정은 지원하지 않습니다.'
                  }
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
                {/* Left: list input */}
                <div className="xl:col-span-3 bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                      <Instagram size={13} className="text-pink-500" /> Account List
                      {igList.length > 0 && <span className="bg-pink-500/20 text-pink-400 px-1.5 py-0.5 rounded text-[10px]">{igList.length}</span>}
                    </label>
                    {igList.length > 0 && (
                      <button onClick={clearIgList} className="text-xs text-zinc-200 hover:text-red-400 transition-colors flex items-center gap-1"><Trash2 size={11} /> 전체 삭제</button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={igDraft}
                      onChange={e => setIgDraft(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addIgItem()}
                      placeholder="@username 또는 username 입력 후 Enter"
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-zinc-200 focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/20"
                    />
                    <button onClick={addIgItem} className="flex items-center gap-1.5 px-3 py-2 bg-pink-600 hover:bg-pink-500 text-white text-xs rounded-lg transition-all active:scale-95"><Plus size={13} /> 추가</button>
                  </div>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {igList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-zinc-200 space-y-2"><Instagram size={26} strokeWidth={1} /><p className="text-xs">계정을 추가하세요</p></div>
                    ) : igList.map((u, i) => (
                      <div key={i} className="flex items-center gap-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/8 rounded-lg px-3 py-2 group transition-colors">
                        <span className="text-pink-600 text-xs shrink-0">@</span>
                        <span className="flex-1 text-xs font-mono text-zinc-300 truncate">{u}</span>
                        <button onClick={() => removeIgItem(i)} className="opacity-0 group-hover:opacity-100 text-zinc-200 hover:text-red-400 transition-all"><X size={13} /></button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: options + run */}
                <div className="xl:col-span-2 flex flex-col gap-4">
                  {/* Amount slider */}
                  <div className="bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-4">
                    <h3 className="text-xs font-medium text-white flex items-center gap-1.5"><Activity size={13} className="text-pink-500" /> 수집 개수 설정</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-300">계정당 릴스 수</span>
                        <span className="text-pink-400 font-medium">{igAmount}개</span>
                      </div>
                      <input
                        type="range" min={5} max={50} step={5}
                        value={igAmount}
                        onChange={e => setIgAmount(Number(e.target.value))}
                        className="w-full appearance-none bg-white/10 h-1.5 rounded-full accent-pink-500"
                      />
                      <div className="flex justify-between text-[10px] text-zinc-200">
                        <span>5개</span><span>50개</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-zinc-200">최신 릴스부터 수집합니다. 많을수록 시간이 오래 걸립니다.</p>
                  </div>

                  {/* Status */}
                  {igJobStatus !== 'idle' && (
                    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-medium ${
                      igJobStatus === 'pending'    ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
                      igJobStatus === 'submitting' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                      igJobStatus === 'done'       ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                                     'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}>
                      {(igJobStatus === 'submitting' || igJobStatus === 'pending') && <Loader2 size={13} className="animate-spin shrink-0" />}
                      {igJobStatus === 'done'  && <CheckCircle2 size={13} className="shrink-0" />}
                      {igJobStatus === 'error' && <AlertCircle size={13} className="shrink-0" />}
                      <span>{{
                        submitting: 'GitHub에 요청 전송 중...',
                        pending:    `로컬 서버 처리 중... (10초마다 확인)`,
                        done:       '완료! 아래에서 결과를 확인하세요.',
                        error:      'GITHUB_TOKEN 미설정 또는 오류 발생',
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
                      {igJobStatus === 'pending' ? '로컬 서버 처리 대기 중...' : '수집 요청 전송'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Results */}
              {(igResults.length > 0 || igResultsLoading) && (
                <div className="bg-[#1a1b23] rounded-xl border border-white/8 overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
                    <div className="flex items-center gap-2.5">
                      <Instagram size={14} className="text-pink-500" />
                      <span className="text-sm font-medium text-white">수집 결과</span>
                      <span className="text-xs text-zinc-200">{igResults.length}개 계정</span>
                    </div>
                    <button onClick={loadIgResults} className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-zinc-200 hover:text-white transition-all">
                      {igResultsLoading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} 새로고침
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-white/[0.02] text-zinc-300 text-xs">
                        <tr>
                          <th className="px-6 py-3 font-medium">Account</th>
                          <th className="px-6 py-3 text-center font-medium">Reels</th>
                          <th className="px-6 py-3 text-right font-medium">Avg Views</th>
                          <th className="px-6 py-3 text-right font-medium">Avg Likes</th>
                          <th className="px-6 py-3 text-right font-medium">Avg Comments</th>
                          <th className="px-6 py-3 text-center font-medium">Scraped At</th>
                          <th className="px-6 py-3 text-center font-medium">Detail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {igResultsLoading ? (
                          <tr><td colSpan={7} className="py-16 text-center"><Loader2 className="animate-spin mx-auto text-zinc-200" size={22} /></td></tr>
                        ) : igResults.map(r => (
                          <tr key={r.username} className="hover:bg-white/[0.02] transition-colors group">
                            <td className="px-6 py-3.5">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center shrink-0">
                                  <span className="text-white text-xs font-bold">{r.username[0]?.toUpperCase()}</span>
                                </div>
                                <div>
                                  <div className="text-xs font-medium text-zinc-200 group-hover:text-pink-400 transition-colors">@{r.username}</div>
                                  {r.error && <div className="text-[10px] text-red-400 mt-0.5">{r.error}</div>}
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              <span className="bg-white/5 px-2.5 py-1 rounded text-zinc-200 text-xs border border-white/8">{r.reelCount}</span>
                            </td>
                            <td className="px-6 py-3.5 text-right text-sm font-semibold text-pink-400 tabular-nums">{r.avgViews.toLocaleString()}</td>
                            <td className="px-6 py-3.5 text-right text-xs text-violet-400 tabular-nums">{r.avgLikes.toLocaleString()}</td>
                            <td className="px-6 py-3.5 text-right text-xs text-zinc-200 tabular-nums">{r.avgComments.toLocaleString()}</td>
                            <td className="px-6 py-3.5 text-center text-xs text-zinc-200 font-mono">
                              {new Date(r.scrapedAt).toLocaleDateString('ko-KR')}
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              <button
                                onClick={() => setSelectedIgUser(r)}
                                disabled={!r.reelCount}
                                className="p-1.5 bg-white/5 hover:bg-pink-600 hover:text-white text-zinc-200 rounded-lg transition-all disabled:opacity-20 active:scale-90"
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

              {igResults.length === 0 && !igResultsLoading && igJobStatus === 'idle' && (
                <button onClick={loadIgResults} className="w-full bg-white/5 hover:bg-white/8 text-zinc-200 hover:text-zinc-200 py-3 rounded-lg text-sm flex items-center justify-center gap-2 transition-all">
                  <Instagram size={15} /> 이전 수집 결과 불러오기
                </button>
              )}
            </div>

          ) : activeTab === 'tiktok-config' ? (
            /* ── TikTok 영상 분석 탭 ──────────────────────────────────────── */
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white">TikTok 영상 분석</h2>
                  <p className="text-xs text-zinc-200 mt-0.5">클라우드 백엔드(yt-dlp)를 통해 조회수·좋아요·댓글 수집</p>
                </div>
                {isBackendAvailable() ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                    <span className="text-xs text-emerald-400 font-medium">클라우드 연결</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <span className="w-1.5 h-1.5 bg-red-400 rounded-full" />
                    <span className="text-xs text-red-400 font-medium">백엔드 필요</span>
                  </div>
                )}
              </div>

              {/* 작동 방식 */}
              <div className="bg-[#1a1b23] border border-white/8 rounded-xl p-5 space-y-3">
                <p className="text-xs font-medium text-zinc-300 flex items-center gap-2"><Activity size={13} className="text-cyan-500" /> 작동 방식</p>
                <div className="space-y-1.5 text-xs text-zinc-300">
                  <p>① 아래에서 TikTok 계정을 입력하고 <strong className="text-zinc-300">수집 요청</strong>을 클릭합니다.</p>
                  <p>② 클라우드 백엔드가 <code className="bg-white/8 px-1.5 py-0.5 rounded">yt-dlp</code>로 영상 데이터를 수집합니다.</p>
                  <p>③ 결과가 즉시 아래 패널에 표시됩니다.</p>
                </div>
                <div className="border-t border-white/8 pt-3 text-[10px] text-zinc-200">
                  BACKEND_URL 환경변수가 설정되어 있어야 합니다. TikTok은 클라우드 백엔드에서만 동작합니다.
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
                {/* Left: list input */}
                <div className="xl:col-span-3 bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                      <Music size={13} className="text-cyan-500" /> Account List
                      {tkList.length > 0 && <span className="bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded text-[10px]">{tkList.length}</span>}
                    </label>
                    {tkList.length > 0 && (
                      <button onClick={clearTkList} className="text-xs text-zinc-200 hover:text-red-400 transition-colors flex items-center gap-1"><Trash2 size={11} /> 전체 삭제</button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={tkDraft}
                      onChange={e => setTkDraft(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addTkItem()}
                      placeholder="@username 또는 username 입력 후 Enter"
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-zinc-200 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20"
                    />
                    <button onClick={addTkItem} className="flex items-center gap-1.5 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs rounded-lg transition-all active:scale-95"><Plus size={13} /> 추가</button>
                  </div>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {tkList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-zinc-200 space-y-2"><Music size={26} strokeWidth={1} /><p className="text-xs">계정을 추가하세요</p></div>
                    ) : tkList.map((u, i) => (
                      <div key={i} className="flex items-center gap-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/8 rounded-lg px-3 py-2 group transition-colors">
                        <span className="text-cyan-600 text-xs shrink-0">@</span>
                        <span className="flex-1 text-xs font-mono text-zinc-300 truncate">{u}</span>
                        <button onClick={() => removeTkItem(i)} className="opacity-0 group-hover:opacity-100 text-zinc-200 hover:text-red-400 transition-all"><X size={13} /></button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: options + run */}
                <div className="xl:col-span-2 flex flex-col gap-4">
                  <div className="bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-4">
                    <h3 className="text-xs font-medium text-white flex items-center gap-1.5"><Activity size={13} className="text-cyan-500" /> 수집 개수 설정</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-300">계정당 영상 수</span>
                        <span className="text-cyan-400 font-medium">{tkAmount}개</span>
                      </div>
                      <input
                        type="range" min={5} max={50} step={5}
                        value={tkAmount}
                        onChange={e => setTkAmount(Number(e.target.value))}
                        className="w-full appearance-none bg-white/10 h-1.5 rounded-full accent-cyan-500"
                      />
                      <div className="flex justify-between text-[10px] text-zinc-200">
                        <span>5개</span><span>50개</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-zinc-200">최신 영상부터 수집합니다. 많을수록 시간이 오래 걸립니다.</p>
                  </div>

                  {/* Status */}
                  {tkJobStatus !== 'idle' && (
                    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-medium ${
                      tkJobStatus === 'submitting' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                      tkJobStatus === 'done'       ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                                     'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}>
                      {tkJobStatus === 'submitting' && <Loader2 size={13} className="animate-spin shrink-0" />}
                      {tkJobStatus === 'done'  && <CheckCircle2 size={13} className="shrink-0" />}
                      {tkJobStatus === 'error' && <AlertCircle size={13} className="shrink-0" />}
                      <span>{{
                        submitting: '백엔드에서 수집 중...',
                        done:       '완료! 아래에서 결과를 확인하세요.',
                        error:      '백엔드 연결 실패 또는 오류 발생',
                        idle:       '',
                      }[tkJobStatus]}</span>
                    </div>
                  )}

                  <div className="mt-auto">
                    <button
                      onClick={handleTkRequest}
                      disabled={tkJobStatus === 'submitting' || !isBackendAvailable()}
                      className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white py-3.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2.5 transition-all active:scale-95"
                    >
                      {tkJobStatus === 'submitting'
                        ? <Loader2 className="animate-spin" size={16} />
                        : <Music size={16} />}
                      {tkJobStatus === 'submitting' ? '수집 중...' : '수집 요청'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Results */}
              {(tkResults.length > 0 || tkResultsLoading) && (
                <div className="bg-[#1a1b23] rounded-xl border border-white/8 overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
                    <div className="flex items-center gap-2.5">
                      <Music size={14} className="text-cyan-500" />
                      <span className="text-sm font-medium text-white">수집 결과</span>
                      <span className="text-xs text-zinc-200">{tkResults.length}개 계정</span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-white/[0.02] text-zinc-300 text-xs">
                        <tr>
                          <th className="px-6 py-3 font-medium">Account</th>
                          <th className="px-6 py-3 text-center font-medium">Videos</th>
                          <th className="px-6 py-3 text-right font-medium">Avg Views</th>
                          <th className="px-6 py-3 text-center font-medium">Status</th>
                          <th className="px-6 py-3 text-center font-medium">Scraped At</th>
                          <th className="px-6 py-3 text-center font-medium">Detail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {tkResultsLoading ? (
                          <tr><td colSpan={6} className="py-16 text-center"><Loader2 className="animate-spin mx-auto text-zinc-200" size={22} /></td></tr>
                        ) : tkResults.map(r => (
                          <tr key={r.username} className="hover:bg-white/[0.02] transition-colors group">
                            <td className="px-6 py-3.5">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-pink-500 flex items-center justify-center shrink-0">
                                  <span className="text-white text-xs font-bold">{r.username[0]?.toUpperCase()}</span>
                                </div>
                                <div>
                                  <div className="text-xs font-medium text-zinc-200 group-hover:text-cyan-400 transition-colors">@{r.username}</div>
                                  {r.error && <div className="text-[10px] text-red-400 mt-0.5">{r.error}</div>}
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              <span className="bg-white/5 px-2.5 py-1 rounded text-zinc-200 text-xs border border-white/8">{r.videoCount}</span>
                            </td>
                            <td className="px-6 py-3.5 text-right text-sm font-semibold text-cyan-400 tabular-nums">{r.avgViews.toLocaleString()}</td>
                            <td className="px-6 py-3.5 text-center">
                              <span className={`text-[10px] px-2 py-0.5 rounded ${r.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                {r.status === 'completed' ? '완료' : '오류'}
                              </span>
                            </td>
                            <td className="px-6 py-3.5 text-center text-xs text-zinc-200 font-mono">
                              {new Date(r.scrapedAt).toLocaleDateString('ko-KR')}
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              <button
                                onClick={() => setSelectedTkUser(r)}
                                disabled={!r.videoCount}
                                className="p-1.5 bg-white/5 hover:bg-cyan-600 hover:text-white text-zinc-200 rounded-lg transition-all disabled:opacity-20 active:scale-90"
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

          ) : (
            <div className="space-y-5 animate-in fade-in duration-300">
              {/* 헤더 */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-white">데이터 대시보드</h2>
                  <p className="text-xs text-zinc-300 mt-0.5">수집된 데이터를 한눈에 확인하고 엑셀로 내보내세요</p>
                </div>
                <button
                  onClick={handleDownloadExcel}
                  className="inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-all active:scale-95 self-start sm:self-auto"
                >
                  <FileSpreadsheet size={15} /> 엑셀로 내보내기
                </button>
              </div>

              {/* 서브탭 */}
              <div className="flex gap-1 bg-white/[0.04] p-1 rounded-xl w-fit">
                {([
                  { id: 'channel', label: '채널 분석', icon: TrendingUp },
                  { id: 'video', label: '영상 분석', icon: Video },
                  { id: 'scraper', label: '스크래퍼 결과', icon: Activity },
                ] as const).map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => { setDashboardSubTab(tab.id); if (tab.id === 'scraper') loadScraperResults(); }}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                      dashboardSubTab === tab.id ? 'bg-white/10 text-white' : 'text-zinc-300 hover:text-zinc-300'
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
                      { label: '완료 채널', value: done.length, sub: `전체 ${channelResults.length}개`, icon: Users, color: 'text-violet-400' },
                      { label: 'Shorts 평균 조회', value: avgS > 0 ? avgS.toLocaleString() : '—', sub: '완료 채널 기준', icon: Radio, color: 'text-violet-400' },
                      { label: 'Longform 평균 조회', value: avgL > 0 ? avgL.toLocaleString() : '—', sub: '완료 채널 기준', icon: MonitorPlay, color: 'text-zinc-200' },
                      { label: '총 수집 영상', value: totalVids.toLocaleString(), sub: '쇼츠 + 롱폼 합계', icon: Video, color: 'text-zinc-200' },
                    ].map((kpi, i) => (
                      <div key={i} className="bg-[#1a1b23] border border-white/8 rounded-xl p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-zinc-300">{kpi.label}</span>
                          <kpi.icon size={14} className={kpi.color} />
                        </div>
                        <div className={`text-2xl font-semibold ${kpi.color}`}>{kpi.value}</div>
                        <div className="text-xs text-zinc-200">{kpi.sub}</div>
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
                      { label: '분석 영상', value: done.length, sub: `전체 ${videoResults.length}개`, icon: Video, color: 'text-violet-400' },
                      { label: '평균 조회수', value: avgViews > 0 ? avgViews.toLocaleString() : '—', sub: '완료 영상 기준', icon: Eye, color: 'text-violet-400' },
                      { label: '총 좋아요', value: totalLikes.toLocaleString(), sub: '수집 영상 합계', icon: ThumbsUp, color: 'text-zinc-200' },
                      { label: 'Shorts 비율', value: videoResults.length > 0 ? `${Math.round(shortsCount/videoResults.length*100)}%` : '—', sub: `쇼츠 ${shortsCount} / 롱폼 ${videoResults.filter(v=>!v.isShort).length}`, icon: Radio, color: 'text-zinc-200' },
                    ].map((kpi, i) => (
                      <div key={i} className="bg-[#1a1b23] border border-white/8 rounded-xl p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-zinc-300">{kpi.label}</span>
                          <kpi.icon size={14} className={kpi.color} />
                        </div>
                        <div className={`text-2xl font-semibold ${kpi.color}`}>{kpi.value}</div>
                        <div className="text-xs text-zinc-200">{kpi.sub}</div>
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
                      { label: '수집 채널', value: scraperResults.length, sub: '스크래퍼 결과', icon: Activity, color: 'text-violet-400' },
                      { label: 'Shorts 평균 조회', value: avgS > 0 ? avgS.toLocaleString() : '—', sub: '전체 채널 평균', icon: Radio, color: 'text-violet-400' },
                      { label: 'Longform 평균 조회', value: avgL > 0 ? avgL.toLocaleString() : '—', sub: '전체 채널 평균', icon: MonitorPlay, color: 'text-zinc-200' },
                      { label: '최근 수집일', value: lastDate, sub: '가장 최근 기준', icon: CalendarDays, color: 'text-zinc-200' },
                    ].map((kpi, i) => (
                      <div key={i} className="bg-[#1a1b23] border border-white/8 rounded-xl p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-zinc-300">{kpi.label}</span>
                          <kpi.icon size={14} className={kpi.color} />
                        </div>
                        <div className={`text-2xl font-semibold ${kpi.color}`}>{kpi.value}</div>
                        <div className="text-xs text-zinc-200">{kpi.sub}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* ── 스크래퍼 결과 (GitHub Raw) ─────────────────────────────── */}
              {dashboardSubTab === 'scraper' && (
                <div className="bg-[#1a1b23] rounded-xl border border-white/8 overflow-hidden">
                  <div className="px-6 py-4 border-b border-white/8 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity size={15} className="text-violet-500" />
                      <span className="font-medium text-white text-sm">로컬 스크래퍼 결과</span>
                      <span className="text-xs text-zinc-200">from GitHub Raw</span>
                    </div>
                    <button
                      onClick={loadScraperResults}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-medium text-zinc-200 hover:text-white transition-all"
                    >
                      {scraperResultsLoading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      새로고침
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-white/[0.02] text-zinc-300 text-xs">
                        <tr>
                          <th className="px-6 py-4 font-medium">Channel</th>
                          <th className="px-6 py-4 text-center font-medium">Subscribers</th>
                          <th className="px-6 py-4 text-right font-medium">Shorts Avg</th>
                          <th className="px-6 py-4 text-right font-medium">Longform Avg</th>
                          <th className="px-6 py-4 text-center font-medium">Scraped At</th>
                          <th className="px-6 py-4 text-center font-medium">Detail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {scraperResultsLoading ? (
                          <tr><td colSpan={6} className="py-16 text-center"><Loader2 className="animate-spin mx-auto text-zinc-200" size={24} /></td></tr>
                        ) : scraperResults.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-24 text-center">
                              <div className="flex flex-col items-center gap-3 text-zinc-200">
                                <Activity size={36} strokeWidth={1} />
                                <p className="text-sm font-medium">아직 스크래퍼 결과가 없습니다.</p>
                                <p className="text-xs">로컬 스크래퍼 탭에서 채널을 요청하세요.</p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          scraperResults.map((r) => (
                            <tr key={r.channelId} className="hover:bg-white/[0.02] transition-colors group">
                              <td className="px-6 py-4 flex items-center gap-4">
                                {r.thumbnail ? (
                                  <img src={r.thumbnail} className="w-10 h-10 rounded-lg object-cover border border-white/8" />
                                ) : (
                                  <div className="w-10 h-10 bg-zinc-900 rounded-lg flex items-center justify-center"><Activity className="text-zinc-200" size={16} /></div>
                                )}
                                <div>
                                  <div className="font-medium text-zinc-100 text-sm group-hover:text-violet-400 transition-colors">{r.channelName}</div>
                                  <div className="text-xs text-zinc-200 font-mono mt-0.5">{r.channelId}</div>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <span className="bg-white/5 px-3 py-1 rounded-lg text-zinc-200 text-xs border border-white/8">{formatNumber(r.subscriberCount)}</span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <div className="text-base font-semibold text-violet-400">{r.avgShortsViews.toLocaleString()}</div>
                                <div className="text-xs text-zinc-200 mt-0.5">{r.shortsCountFound} Shorts</div>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <div className="text-base font-semibold text-zinc-200">{r.avgLongViews.toLocaleString()}</div>
                                <div className="text-xs text-zinc-200 mt-0.5">{r.longCountFound} Videos</div>
                              </td>
                              <td className="px-6 py-4 text-center text-xs text-zinc-300 font-mono">
                                {(r as any).scrapedAt ? new Date((r as any).scrapedAt).toLocaleDateString('ko-KR') : '—'}
                              </td>
                              <td className="px-6 py-4 text-center">
                                <button
                                  onClick={() => setSelectedChannel(r)}
                                  className="p-2 bg-white/5 hover:bg-violet-600 hover:text-white text-zinc-200 rounded-lg transition-all active:scale-90"
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
              <div className="bg-[#1a1b23] rounded-xl border border-white/8 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    {dashboardSubTab === 'channel' ? (
                      <>
                        <thead className="bg-white/[0.02] text-zinc-300 text-xs">
                          <tr>
                            <th className="px-6 py-4 font-medium">Channel Information</th>
                            <th className="px-6 py-4 text-center font-medium">Subscribers</th>
                            <th className="px-6 py-4 text-right font-medium">Shorts Avg</th>
                            <th className="px-6 py-4 text-right font-medium">Longform Avg</th>
                            <th className="px-6 py-4 text-center font-medium">Detail</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {channelResults.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-24 text-center">
                                <div className="flex flex-col items-center gap-3 text-zinc-200">
                                  <LayoutDashboard size={36} strokeWidth={1} />
                                  <p className="text-sm font-medium">No channel data analyzed yet.</p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            channelResults.map((r) => (
                              <tr key={r.channelId} className="hover:bg-white/[0.02] transition-colors group">
                                <td className="px-6 py-4 flex items-center gap-4">
                                  <div className="relative">
                                    {r.thumbnail ? (
                                      <img src={r.thumbnail} className="w-10 h-10 rounded-lg object-cover border border-white/8" />
                                    ) : (
                                      <div className="w-10 h-10 bg-zinc-900 rounded-lg flex items-center justify-center">
                                        <Loader2 className="animate-spin text-zinc-200" size={16} />
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    <div className="font-medium text-zinc-100 text-sm group-hover:text-violet-400 transition-colors flex items-center gap-2">
                                      {r.channelName}
                                      {r.status === 'error' && (
                                        <span className="text-xs bg-red-500/15 text-red-400 px-2 py-0.5 rounded border border-red-500/20">Error</span>
                                      )}
                                    </div>
                                    <div className="text-xs text-zinc-200 font-mono mt-0.5 max-w-[200px] truncate">{r.status === 'error' ? r.error : r.channelId}</div>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <span className="bg-white/5 px-3 py-1 rounded-lg text-zinc-200 text-xs border border-white/8">
                                    {r.status === 'completed' ? formatNumber(r.subscriberCount) : '...'}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <div className="text-base font-semibold text-violet-400">{r.avgShortsViews.toLocaleString()}</div>
                                  <div className="text-xs text-zinc-200 mt-0.5">{r.shortsCountFound} Shorts</div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <div className="text-base font-semibold text-zinc-200">{r.avgLongViews.toLocaleString()}</div>
                                  <div className="text-xs text-zinc-200 mt-0.5">{r.longCountFound} Videos</div>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <button
                                    disabled={r.status !== 'completed'}
                                    onClick={() => setSelectedChannel(r)}
                                    className="p-2 bg-white/5 hover:bg-violet-600 hover:text-white text-zinc-200 rounded-lg transition-all disabled:opacity-20 active:scale-90"
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
                        <thead className="bg-white/[0.02] text-zinc-300 text-xs">
                          <tr>
                            <th className="px-6 py-4 font-medium">Video Details</th>
                            <th className="px-6 py-4 font-medium">Channel</th>
                            <th className="px-6 py-4 text-center font-medium">Stats (Likes/Comments)</th>
                            <th className="px-6 py-4 text-right font-medium">View Count</th>
                            <th className="px-6 py-4 text-center font-medium">Detail</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {videoResults.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-24 text-center">
                                <div className="flex flex-col items-center gap-3 text-zinc-200">
                                  <MonitorPlay size={36} strokeWidth={1} />
                                  <p className="text-sm font-medium">No video data analyzed yet.</p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            videoResults.map((v) => (
                              <tr key={v.videoId} className="hover:bg-white/[0.02] transition-colors group">
                                <td className="px-6 py-4 flex items-center gap-4">
                                  <div className="relative shrink-0">
                                    {v.thumbnail ? (
                                      <img src={v.thumbnail} className={`rounded-lg object-cover border border-white/8 ${v.isShort ? 'w-8 h-12' : 'w-16 h-10'}`} />
                                    ) : (
                                      <div className="w-10 h-10 bg-zinc-900 rounded-lg flex items-center justify-center">
                                        <Loader2 className="animate-spin text-zinc-200" size={16} />
                                      </div>
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-medium text-zinc-100 text-sm group-hover:text-violet-400 transition-colors truncate max-w-[300px]">{v.title}</div>
                                    <div className="text-xs text-zinc-200 font-mono mt-0.5">{v.status === 'error' ? v.error : v.videoId}</div>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="text-sm text-zinc-200">{v.channelTitle || '...'}</div>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-xs text-violet-400 flex items-center gap-1">
                                      <ThumbsUp size={11} /> {v.likeCount.toLocaleString()}
                                    </span>
                                    <span className="text-xs text-zinc-200 flex items-center gap-1">
                                      <MessageSquare size={11} /> {v.commentCount.toLocaleString()}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <div className="text-base font-semibold text-white">{v.viewCount.toLocaleString()}</div>
                                </td>
                                <td className="px-6 py-4 text-center flex items-center justify-center gap-2">
                                  <button
                                    disabled={v.status !== 'completed'}
                                    onClick={() => setSelectedVideo(v)}
                                    className="p-2 bg-white/5 hover:bg-white/12 hover:text-white text-zinc-200 rounded-lg transition-all disabled:opacity-20 active:scale-90"
                                  >
                                    <Eye size={16} />
                                  </button>
                                  <a
                                    href={v.isShort ? `https://youtube.com/shorts/${v.videoId}` : `https://youtube.com/watch?v=${v.videoId}`}
                                    target="_blank"
                                    className="inline-block p-2 bg-white/5 hover:bg-violet-600 hover:text-white text-zinc-200 rounded-lg transition-all active:scale-90"
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

export default App;
