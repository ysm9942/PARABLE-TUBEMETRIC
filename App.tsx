
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
  History
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { getChannelInfo, fetchChannelStats, fetchVideosByIds, AnalysisPeriod, analyzeAdVideos } from './services/youtubeService';
import { ChannelResult, VideoResult, VideoDetail, CommentInfo, AdAnalysisResult, InstagramUserResult } from './types';
import { submitScrapeRequest, checkQueueStatus, getAllChannelResults, submitInstagramRequest, checkInstagramQueueStatus, getAllInstagramResults } from './services/githubResultsService';

type TabType = 'channel-config' | 'video-config' | 'ad-config' | 'scraper-config' | 'dashboard' | 'live-config' | 'instagram-config';
type ResultTab = 'table' | 'chart' | 'raw';

const App: React.FC = () => {
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [pinInput, setPinInput] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabType>('channel-config');
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
    const v = igDraft.trim().replace(/^@/, '');
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
              <p className="text-zinc-500 text-sm">Enter your PIN to continue</p>
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
                className="w-full bg-[#1a1b23] border border-white/8 rounded-xl py-4 px-6 text-center text-2xl font-medium tracking-[0.4em] text-white focus:outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 transition-all placeholder:text-zinc-700 placeholder:tracking-normal placeholder:text-base"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-violet-600 hover:bg-violet-500 text-white py-4 rounded-lg font-medium text-base transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              Authorize <ChevronRight size={18} />
            </button>
          </form>

          <p className="text-center text-xs text-zinc-700">Authorized access only</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-zinc-100 flex overflow-hidden selection:bg-violet-500/30">
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
                    <a href={`https://youtube.com/channel/${selectedChannel.channelId}`} target="_blank" className="text-zinc-500 hover:text-violet-400 transition-all"><ExternalLink size={16} /></a>
                  </h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1 text-xs font-medium text-violet-400 bg-violet-500/10 px-2.5 py-0.5 rounded-full">
                      <Users size={11} /> {formatNumber(selectedChannel.subscriberCount)} Subscribers
                    </span>
                    <p className="text-xs text-zinc-500">Analytics Results</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button onClick={() => setSelectedChannel(null)} className="p-2 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white rounded-lg transition-all">
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
                      Shorts <span className="text-zinc-500 font-normal">({selectedChannel.shortsList.length})</span>
                    </h4>
                    <div className="text-right">
                      <div className="text-xs text-zinc-500 mb-0.5">Avg Views</div>
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
                            <span className="text-xs text-zinc-600">{new Date(v.publishedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <a href={`https://youtube.com/shorts/${v.id}`} target="_blank" className="p-2 bg-white/5 text-zinc-400 hover:text-white hover:bg-violet-600 rounded-lg transition-all">
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
                      Longform <span className="text-zinc-500 font-normal">({selectedChannel.longsList.length})</span>
                    </h4>
                    <div className="text-right">
                      <div className="text-xs text-zinc-500 mb-0.5">Avg Views</div>
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
                            <span className="text-xs text-zinc-400 font-medium">{v.viewCount.toLocaleString()} views</span>
                            <span className="text-xs text-zinc-600">{new Date(v.publishedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <a href={`https://youtube.com/watch?v=${v.id}`} target="_blank" className="p-2 bg-white/5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-lg transition-all">
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
                    <p className="text-xs text-zinc-500">Ad Detection Details</p>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedAdResult(null)} className="p-2 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white rounded-lg transition-all">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-5">
              {selectedAdResult.adVideos.length === 0 ? (
                <div className="h-full flex items-center justify-center text-zinc-600 text-sm">분석된 광고 영상이 없습니다.</div>
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
                              <span className="text-xs text-zinc-400 flex items-center gap-1"><Eye size={11}/> {v.viewCount.toLocaleString()}</span>
                              <span className="text-xs text-zinc-500 flex items-center gap-1"><ThumbsUp size={11}/> {v.likeCount.toLocaleString()}</span>
                            </div>
                          </div>

                          <div className="mt-3 pt-3 border-t border-white/8 space-y-1.5">
                             <div className="text-xs text-zinc-600">Detection Evidence</div>
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
                         <div className="text-xs text-zinc-600">Published: {new Date(v.publishedAt).toLocaleDateString()}</div>
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
              <div className="text-xs text-zinc-500 leading-tight">TubeMetric</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-5 pt-4">
          {/* ANALYSIS */}
          <div>
            <div className="px-2 mb-2 text-[10px] font-semibold text-zinc-600 tracking-widest uppercase">Analysis</div>
            <div className="space-y-0.5">
              {([
                { id: 'channel-config',   label: '채널 통합 분석',    Icon: TrendingUp,  soon: false },
                { id: 'video-config',     label: '단일 영상 분석',    Icon: Video,       soon: false },
                { id: 'ad-config',        label: '광고 영상 분석',    Icon: Megaphone,   soon: false },
                { id: 'scraper-config',   label: '로컬 스크래퍼',    Icon: Activity,    soon: false },
                { id: 'live-config',      label: '라이브 지표 분석',  Icon: Tv2,         soon: true  },
                { id: 'instagram-config', label: 'Instagram 분석',   Icon: Instagram,   soon: false },
              ] as { id: TabType; label: string; Icon: React.ElementType; soon: boolean }[]).map(({ id, label, Icon, soon }) => (
                <button
                  key={id}
                  onClick={() => !soon && setActiveTab(id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all group ${
                    activeTab === id
                      ? 'bg-violet-600/15 text-violet-300 border border-violet-500/20'
                      : soon
                        ? 'text-zinc-700 cursor-default'
                        : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
                  }`}
                >
                  <Icon size={14} className={activeTab === id ? 'text-violet-400' : soon ? 'text-zinc-700' : 'text-zinc-600 group-hover:text-zinc-400'} />
                  <span className="flex-1 text-left">{label}</span>
                  {soon && <span className="text-[9px] bg-zinc-800 text-zinc-600 px-1.5 py-0.5 rounded font-normal">Soon</span>}
                  {!soon && activeTab === id && <div className="w-1 h-1 bg-violet-400 rounded-full" />}
                </button>
              ))}
            </div>
          </div>

          {/* DATA */}
          <div>
            <div className="px-2 mb-2 text-[10px] font-semibold text-zinc-600 tracking-widest uppercase">Data</div>
            <div className="space-y-0.5">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all group ${
                  activeTab === 'dashboard'
                    ? 'bg-violet-600/15 text-violet-300 border border-violet-500/20'
                    : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
                }`}
              >
                <History size={14} className={activeTab === 'dashboard' ? 'text-violet-400' : 'text-zinc-600 group-hover:text-zinc-400'} />
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
            <div className="px-2 mb-2 text-[10px] font-semibold text-zinc-600 tracking-widest uppercase">Settings</div>
            <div className="space-y-0.5">
              {[
                { label: 'API 설정', Icon: Settings2 },
                { label: '내보내기 설정', Icon: FileSpreadsheet },
              ].map(({ label, Icon }) => (
                <div key={label} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-zinc-700 cursor-default">
                  <Icon size={14} className="text-zinc-800" />
                  <span>{label}</span>
                  <span className="ml-auto text-[9px] bg-zinc-800 text-zinc-700 px-1.5 py-0.5 rounded">Soon</span>
                </div>
              ))}
            </div>
          </div>
        </nav>

        <div className="p-4 border-t border-white/8">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shrink-0"></div>
            <span className="text-xs text-zinc-600">Vercel Connected</span>
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
                  <p className="text-xs text-zinc-600 mt-0.5">YouTube 채널 평균 조회수 및 영상 데이터 수집</p>
                </div>
                <button
                  onClick={() => setShowHelp(!showHelp)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${showHelp ? 'bg-violet-600/20 text-violet-400 border border-violet-500/30' : 'bg-white/5 text-zinc-500 hover:text-zinc-300'}`}
                >
                  <Info size={13} /> 가이드
                </button>
              </div>

              {showHelp && (
                <div className="bg-[#1a1b23] border border-violet-500/20 rounded-xl p-5 animate-in fade-in duration-200">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <h4 className="font-medium text-violet-400 text-xs flex items-center gap-1.5"><CalendarDays size={12} /> 분석 기간</h4>
                      <p className="text-zinc-500 text-xs leading-relaxed">수집할 영상의 게시 기간을 필터링합니다. 전체 선택 시 기간 제한 없이 수집합니다.</p>
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-medium text-violet-400 text-xs flex items-center gap-1.5"><Activity size={12} /> 수집 개수</h4>
                      <p className="text-zinc-500 text-xs leading-relaxed">채널당 수집할 최대 영상 수를 지정합니다. 쇼츠/롱폼 각각 설정 가능합니다.</p>
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
                      <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                        <List size={13} className="text-violet-500" /> Channel List
                        {channelList.length > 0 && <span className="bg-violet-600/20 text-violet-400 px-1.5 py-0.5 rounded text-[10px]">{channelList.length}</span>}
                      </label>
                      {channelList.length > 0 && (
                        <button onClick={clearChannelList} className="text-xs text-zinc-600 hover:text-red-400 transition-colors flex items-center gap-1">
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
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-zinc-700 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
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
                        <div className="flex flex-col items-center justify-center py-12 text-zinc-700 space-y-2">
                          <List size={28} strokeWidth={1} />
                          <p className="text-xs">채널을 추가하세요</p>
                        </div>
                      ) : channelList.map((ch, i) => (
                        <div key={i} className="flex items-center gap-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/8 rounded-lg px-3 py-2 group transition-colors">
                          <div className="w-1.5 h-1.5 bg-zinc-700 rounded-full shrink-0" />
                          <span className="flex-1 text-xs font-mono text-zinc-300 truncate">{ch}</span>
                          <button onClick={() => removeChannelItem(i)} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all">
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                    {channelList.length > 0 && (
                      <p className="text-[10px] text-zinc-700">{channelList.length}개 채널 · Enter 또는 추가 버튼으로 입력</p>
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
                              <label className="text-xs text-zinc-400 flex items-center gap-1.5">
                                <CalendarDays size={13} className="text-violet-400" /> 전체 영상 기준 기간
                              </label>
                              <button
                                onClick={() => setUseDateFilter(!useDateFilter)}
                                className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-all ${useDateFilter ? 'bg-violet-600 text-white' : 'bg-white/8 text-zinc-500'}`}
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
                                 className={`py-2 text-xs font-medium rounded-lg transition-all ${period === p ? 'bg-white text-black' : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'}`}
                               >
                                 {periodLabels[p]}
                               </button>
                             ))}
                           </div>
                           <p className="text-xs text-zinc-600 text-center">설정한 기간 내의 영상만 수집 대상에 포함됩니다.</p>
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
                              <label className="text-xs text-zinc-400 flex items-center gap-1.5">
                                <Radio size={13} className="text-violet-400" /> Shorts Target
                              </label>
                              <div className="flex items-center gap-3">
                                <button
                                  disabled={!useGlobalCountFilter}
                                  onClick={() => setUseShorts(!useShorts)}
                                  className={`${(useShorts && useGlobalCountFilter) ? 'text-violet-500' : 'text-zinc-700'} transition-opacity ${!useGlobalCountFilter ? 'opacity-30' : ''}`}
                                >
                                  {(useShorts && useGlobalCountFilter) ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                                </button>
                              </div>
                           </div>
                           <div className={`space-y-2 transition-opacity ${(!useShorts || !useGlobalCountFilter) ? 'opacity-30' : ''}`}>
                              <div className="flex justify-between text-xs">
                                <span className="text-zinc-500">Max Target</span>
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
                              <label className="text-xs text-zinc-400 flex items-center gap-1.5">
                                <MonitorPlay size={13} className="text-zinc-400" /> Longform Target
                              </label>
                              <div className="flex items-center gap-3">
                                <button
                                  disabled={!useGlobalCountFilter}
                                  onClick={() => setUseLongs(!useLongs)}
                                  className={`${(useLongs && useGlobalCountFilter) ? 'text-white' : 'text-zinc-700'} transition-opacity ${!useGlobalCountFilter ? 'opacity-30' : ''}`}
                                >
                                  {(useLongs && useGlobalCountFilter) ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                                </button>
                              </div>
                           </div>
                           <div className={`space-y-2 transition-opacity ${(!useLongs || !useGlobalCountFilter) ? 'opacity-30' : ''}`}>
                              <div className="flex justify-between text-xs">
                                <span className="text-zinc-500">Max Target</span>
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
                    <span className="text-xs text-zinc-500 tabular-nums">{channelDone} / {channelTotal} 완료 · {channelProgress}%</span>
                  </div>
                  <div className="w-full bg-white/8 rounded-full h-1 overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full transition-all duration-700" style={{ width: `${channelProgress}%` }} />
                  </div>
                  <div className="space-y-1 max-h-20 overflow-y-auto">
                    {channelResults.filter(r => r.status !== 'pending').slice(-4).map((r, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-zinc-600">
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
                      {showChannelResults ? <ChevronDown size={15} className="text-zinc-500" /> : <ChevronRight size={15} className="text-zinc-500" />}
                      <span className="text-sm font-medium text-white">분석 결과</span>
                      <span className="text-xs text-zinc-600">{channelResults.filter(r => r.status === 'completed').length}개 완료{channelResults.filter(r => r.status === 'error').length > 0 ? ` · ${channelResults.filter(r => r.status === 'error').length}개 오류` : ''}</span>
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
                            <button key={t} onClick={() => setChannelResultTab(t)} className={`px-3 py-1 rounded text-xs font-medium transition-all ${channelResultTab === t ? 'bg-violet-600 text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}>
                              {t === 'table' ? 'TABLE' : t === 'chart' ? 'CHART' : 'RAW DATA'}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={handleDownloadExcel} className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white rounded text-xs transition-all"><FileSpreadsheet size={11} /> Excel</button>
                          <button onClick={() => navigator.clipboard.writeText(channelResults.map(r => [r.channelName, r.channelId, r.subscriberCount, r.avgShortsViews, r.avgLongViews].join('\t')).join('\n'))} className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white rounded text-xs transition-all">Copy</button>
                        </div>
                      </div>
                      {channelResultTab === 'table' && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead className="bg-white/[0.02] text-zinc-500 text-xs">
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
                                    {r.thumbnail ? <img src={r.thumbnail} className="w-8 h-8 rounded-lg object-cover border border-white/8 shrink-0" /> : <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center shrink-0"><Loader2 className="animate-spin text-zinc-700" size={13} /></div>}
                                    <div className="min-w-0">
                                      <div className="text-xs font-medium text-zinc-200 group-hover:text-violet-400 transition-colors flex items-center gap-1.5 truncate max-w-[220px]">
                                        {r.channelName}
                                        {r.status === 'error' && <span className="text-[10px] bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded shrink-0">Error</span>}
                                        {r.status === 'processing' && <Loader2 size={10} className="animate-spin text-violet-400 shrink-0" />}
                                        {r.status === 'pending' && <span className="text-[10px] text-zinc-600 shrink-0">대기</span>}
                                      </div>
                                      <div className="text-[10px] text-zinc-700 font-mono mt-0.5 truncate max-w-[200px]">{r.status === 'error' ? r.error : r.channelId}</div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-3.5 text-center"><span className="bg-white/5 px-2.5 py-1 rounded text-zinc-400 text-xs border border-white/8">{r.status === 'completed' ? formatNumber(r.subscriberCount) : '—'}</span></td>
                                  <td className="px-6 py-3.5 text-right"><div className="text-sm font-semibold text-violet-400">{r.avgShortsViews > 0 ? r.avgShortsViews.toLocaleString() : '—'}</div><div className="text-[10px] text-zinc-700 mt-0.5">{r.shortsCountFound > 0 ? `${r.shortsCountFound} Shorts` : ''}</div></td>
                                  <td className="px-6 py-3.5 text-right"><div className="text-sm font-semibold text-zinc-200">{r.avgLongViews > 0 ? r.avgLongViews.toLocaleString() : '—'}</div><div className="text-[10px] text-zinc-700 mt-0.5">{r.longCountFound > 0 ? `${r.longCountFound} Videos` : ''}</div></td>
                                  <td className="px-6 py-3.5 text-center"><button disabled={r.status !== 'completed'} onClick={() => setSelectedChannel(r)} className="p-1.5 bg-white/5 hover:bg-violet-600 hover:text-white text-zinc-400 rounded-lg transition-all disabled:opacity-20 active:scale-90"><Eye size={14} /></button></td>
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
                            if (!done.length) return <p className="text-xs text-zinc-600 text-center py-8">완료된 채널이 없습니다.</p>;
                            const maxShorts = Math.max(...done.map(r => r.avgShortsViews), 1);
                            const maxLong = Math.max(...done.map(r => r.avgLongViews), 1);
                            return (
                              <>
                                <div>
                                  <p className="text-xs font-medium text-zinc-400 mb-3 flex items-center gap-1.5"><Radio size={12} className="text-violet-400" /> Shorts 평균 조회수</p>
                                  <div className="space-y-2">
                                    {done.map(r => (
                                      <div key={r.channelId} className="flex items-center gap-3">
                                        <span className="text-xs text-zinc-500 w-28 truncate shrink-0">{r.channelName}</span>
                                        <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                                          <div className="h-full bg-violet-500 rounded-full transition-all duration-500" style={{ width: `${(r.avgShortsViews / maxShorts) * 100}%` }} />
                                        </div>
                                        <span className="text-xs text-zinc-400 w-20 text-right shrink-0 tabular-nums">{r.avgShortsViews.toLocaleString()}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-zinc-400 mb-3 flex items-center gap-1.5"><MonitorPlay size={12} className="text-zinc-400" /> Longform 평균 조회수</p>
                                  <div className="space-y-2">
                                    {done.map(r => (
                                      <div key={r.channelId} className="flex items-center gap-3">
                                        <span className="text-xs text-zinc-500 w-28 truncate shrink-0">{r.channelName}</span>
                                        <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                                          <div className="h-full bg-zinc-400 rounded-full transition-all duration-500" style={{ width: `${(r.avgLongViews / maxLong) * 100}%` }} />
                                        </div>
                                        <span className="text-xs text-zinc-400 w-20 text-right shrink-0 tabular-nums">{r.avgLongViews.toLocaleString()}</span>
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
                        <pre className="p-6 text-[11px] text-zinc-500 overflow-auto max-h-96 font-mono leading-relaxed">{JSON.stringify(channelResults.map(r => ({ channelId: r.channelId, channelName: r.channelName, subscriberCount: r.subscriberCount, avgShortsViews: r.avgShortsViews, avgLongViews: r.avgLongViews, status: r.status })), null, 2)}</pre>
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
                <p className="text-xs text-zinc-600 mt-0.5">YouTube 영상 URL 또는 ID로 조회수·댓글 분석</p>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
                {/* Left: list input */}
                <div className="xl:col-span-3 bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                      <Video size={13} className="text-violet-500" /> Video List
                      {videoList.length > 0 && <span className="bg-violet-600/20 text-violet-400 px-1.5 py-0.5 rounded text-[10px]">{videoList.length}</span>}
                    </label>
                    {videoList.length > 0 && (
                      <button onClick={() => setVideoInput('')} className="text-xs text-zinc-600 hover:text-red-400 transition-colors flex items-center gap-1"><Trash2 size={11} /> 전체 삭제</button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={videoDraft}
                      onChange={e => setVideoDraft(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addVideoItem()}
                      placeholder="영상 URL 또는 ID 입력 후 Enter"
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-zinc-700 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
                    />
                    <button onClick={addVideoItem} className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs rounded-lg transition-all active:scale-95"><Plus size={13} /> 추가</button>
                  </div>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {videoList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-zinc-700 space-y-2"><Video size={26} strokeWidth={1} /><p className="text-xs">영상을 추가하세요</p></div>
                    ) : videoList.map((v, i) => (
                      <div key={i} className="flex items-center gap-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/8 rounded-lg px-3 py-2 group transition-colors">
                        <div className="w-1.5 h-1.5 bg-zinc-700 rounded-full shrink-0" />
                        <span className="flex-1 text-xs font-mono text-zinc-300 truncate">{v}</span>
                        <button onClick={() => removeVideoItem(i)} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"><X size={13} /></button>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Right: Run */}
                <div className="xl:col-span-2 flex flex-col gap-4">
                  <div className="bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-3 flex-1">
                    <h3 className="text-xs font-medium text-zinc-400">수집 설정</h3>
                    <p className="text-xs text-zinc-600 leading-relaxed">URL 또는 11자리 영상 ID를 입력하세요. 중복은 자동으로 제거됩니다.</p>
                    <div className="bg-white/[0.02] rounded-lg p-3 space-y-1">
                      <p className="text-[10px] text-zinc-600">지원 형식</p>
                      <p className="text-[10px] text-zinc-700 font-mono">youtube.com/watch?v=xxx</p>
                      <p className="text-[10px] text-zinc-700 font-mono">youtu.be/xxx</p>
                      <p className="text-[10px] text-zinc-700 font-mono">youtube.com/shorts/xxx</p>
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
                    <span className="text-xs text-zinc-500 tabular-nums">{videoDone} / {videoTotal} 완료 · {videoProgress}%</span>
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
                      {showVideoResults ? <ChevronDown size={15} className="text-zinc-500" /> : <ChevronRight size={15} className="text-zinc-500" />}
                      <span className="text-sm font-medium text-white">수집 결과</span>
                      <span className="text-xs text-zinc-600">{videoResults.filter(v => v.status === 'completed').length}개 완료</span>
                    </div>
                    {!isProcessing && videoResults.some(v => v.status === 'completed') && <CheckCircle2 size={12} className="text-emerald-500" />}
                  </button>
                  {showVideoResults && (
                    <div className="border-t border-white/8">
                      <div className="flex items-center justify-between px-6 py-3 border-b border-white/8 bg-[#0f1117]/50">
                        <div className="flex gap-1">
                          {(['table','chart','raw'] as ResultTab[]).map(t => (
                            <button key={t} onClick={() => setVideoResultTab(t)} className={`px-3 py-1 rounded text-xs font-medium transition-all ${videoResultTab === t ? 'bg-violet-600 text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}>
                              {t === 'table' ? 'TABLE' : t === 'chart' ? 'CHART' : 'RAW DATA'}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={handleDownloadExcel} className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white rounded text-xs transition-all"><FileSpreadsheet size={11} /> Excel</button>
                        </div>
                      </div>
                      {videoResultTab === 'table' && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead className="bg-white/[0.02] text-zinc-500 text-xs">
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
                                    {v.thumbnail ? <img src={v.thumbnail} className={`rounded-lg object-cover border border-white/8 shrink-0 ${v.isShort ? 'w-7 h-10' : 'w-14 h-9'}`} /> : <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center shrink-0"><Loader2 className="animate-spin text-zinc-700" size={13} /></div>}
                                    <div className="min-w-0">
                                      <div className="text-xs font-medium text-zinc-200 group-hover:text-violet-400 transition-colors truncate max-w-[280px]">{v.title}</div>
                                      <div className="text-[10px] text-zinc-700 font-mono mt-0.5">{v.status === 'error' ? v.error : v.videoId}</div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-3.5 text-xs text-zinc-400">{v.channelTitle || '—'}</td>
                                  <td className="px-6 py-3.5 text-center">
                                    <div className="text-xs text-violet-400 flex items-center justify-center gap-1"><ThumbsUp size={10} /> {v.likeCount.toLocaleString()}</div>
                                    <div className="text-[10px] text-zinc-600 flex items-center justify-center gap-1 mt-0.5"><MessageSquare size={10} /> {v.commentCount.toLocaleString()}</div>
                                  </td>
                                  <td className="px-6 py-3.5 text-right text-sm font-semibold text-white tabular-nums">{v.viewCount.toLocaleString()}</td>
                                  <td className="px-6 py-3.5 text-center flex items-center justify-center gap-1.5">
                                    <button disabled={v.status !== 'completed'} onClick={() => setSelectedVideo(v)} className="p-1.5 bg-white/5 hover:bg-white/12 text-zinc-400 hover:text-white rounded-lg transition-all disabled:opacity-20 active:scale-90"><Eye size={13} /></button>
                                    <a href={v.isShort ? `https://youtube.com/shorts/${v.videoId}` : `https://youtube.com/watch?v=${v.videoId}`} target="_blank" className="p-1.5 bg-white/5 hover:bg-violet-600 text-zinc-400 hover:text-white rounded-lg transition-all"><ExternalLink size={13} /></a>
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
                            if (!done.length) return <p className="text-xs text-zinc-600 text-center py-8">완료된 영상이 없습니다.</p>;
                            const maxViews = Math.max(...done.map(v => v.viewCount), 1);
                            return (
                              <div>
                                <p className="text-xs font-medium text-zinc-400 mb-3 flex items-center gap-1.5"><Eye size={12} className="text-violet-400" /> 조회수 분포</p>
                                <div className="space-y-2">
                                  {done.slice(0, 20).map(v => (
                                    <div key={v.videoId} className="flex items-center gap-3">
                                      <span className="text-xs text-zinc-600 w-36 truncate shrink-0">{v.title}</span>
                                      <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                                        <div className="h-full bg-violet-500 rounded-full transition-all duration-500" style={{ width: `${(v.viewCount / maxViews) * 100}%` }} />
                                      </div>
                                      <span className="text-xs text-zinc-400 w-20 text-right tabular-nums shrink-0">{v.viewCount.toLocaleString()}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      {videoResultTab === 'raw' && (
                        <pre className="p-6 text-[11px] text-zinc-500 overflow-auto max-h-96 font-mono leading-relaxed">{JSON.stringify(videoResults.map(v => ({ videoId: v.videoId, title: v.title, viewCount: v.viewCount, likeCount: v.likeCount, commentCount: v.commentCount, status: v.status })), null, 2)}</pre>
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
                <p className="text-xs text-zinc-600 mt-0.5">채널별 광고 영상 수 및 광고 비율 분석</p>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
                {/* Left: list input */}
                <div className="xl:col-span-3 bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                      <List size={13} className="text-violet-500" /> Channel List
                      {adList.length > 0 && <span className="bg-violet-600/20 text-violet-400 px-1.5 py-0.5 rounded text-[10px]">{adList.length}</span>}
                    </label>
                    {adList.length > 0 && (
                      <button onClick={clearAdList} className="text-xs text-zinc-600 hover:text-red-400 transition-colors flex items-center gap-1"><Trash2 size={11} /> 전체 삭제</button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={adDraft}
                      onChange={e => setAdDraft(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addAdItem()}
                      placeholder="UC코드 또는 채널 URL 입력 후 Enter"
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-zinc-700 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
                    />
                    <button onClick={addAdItem} className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs rounded-lg transition-all active:scale-95"><Plus size={13} /> 추가</button>
                  </div>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {adList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-zinc-700 space-y-2"><List size={26} strokeWidth={1} /><p className="text-xs">채널을 추가하세요</p></div>
                    ) : adList.map((ch, i) => (
                      <div key={i} className="flex items-center gap-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/8 rounded-lg px-3 py-2 group transition-colors">
                        <div className="w-1.5 h-1.5 bg-zinc-700 rounded-full shrink-0" />
                        <span className="flex-1 text-xs font-mono text-zinc-300 truncate">{ch}</span>
                        <button onClick={() => removeAdItem(i)} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"><X size={13} /></button>
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
                        className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-all ${adUseDateFilter ? 'bg-violet-600 text-white' : 'bg-white/8 text-zinc-500'}`}
                      >
                        {adUseDateFilter ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                    <div className={`grid grid-cols-4 gap-1.5 transition-opacity ${!adUseDateFilter ? 'opacity-30 pointer-events-none' : ''}`}>
                      {(['all', '90d', '30d', '7d'] as AnalysisPeriod[]).map(p => (
                        <button key={p} onClick={() => setAdPeriod(p)} className={`py-2 text-xs font-medium rounded-lg transition-all ${adPeriod === p ? 'bg-white text-black' : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'}`}>
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
                    <span className="text-xs text-zinc-500 tabular-nums">{adDone} / {adTotal} 완료 · {adProgress}%</span>
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
                      {showAdResults ? <ChevronDown size={15} className="text-zinc-500" /> : <ChevronRight size={15} className="text-zinc-500" />}
                      <span className="text-sm font-medium text-white">광고 분석 결과</span>
                      <span className="text-xs text-zinc-600">{adResults.filter(r => r.status === 'completed').length}개 완료</span>
                    </div>
                    {!isProcessing && adResults.some(r => r.status === 'completed') && <CheckCircle2 size={12} className="text-emerald-500" />}
                  </button>
                  {showAdResults && (
                    <div className="border-t border-white/8">
                      <div className="flex items-center justify-between px-6 py-3 border-b border-white/8 bg-[#0f1117]/50">
                        <div className="flex gap-1">
                          {(['table','chart','raw'] as ResultTab[]).map(t => (
                            <button key={t} onClick={() => setAdResultTab(t)} className={`px-3 py-1 rounded text-xs font-medium transition-all ${adResultTab === t ? 'bg-violet-600 text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}>
                              {t === 'table' ? 'TABLE' : t === 'chart' ? 'CHART' : 'RAW DATA'}
                            </button>
                          ))}
                        </div>
                        <button onClick={handleDownloadExcel} className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white rounded text-xs transition-all"><FileSpreadsheet size={11} /> Excel</button>
                      </div>
                      {adResultTab === 'table' && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead className="bg-white/[0.02] text-zinc-500 text-xs">
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
                                    {r.thumbnail ? <img src={r.thumbnail} className="w-8 h-8 rounded-lg object-cover border border-white/8 shrink-0" /> : <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center shrink-0"><Loader2 className="animate-spin text-zinc-700" size={13} /></div>}
                                    <div className="min-w-0">
                                      <div className="text-xs font-medium text-zinc-200 truncate max-w-[200px] group-hover:text-violet-400 transition-colors">{r.channelName}</div>
                                      <div className="text-[10px] text-zinc-700 font-mono mt-0.5 truncate max-w-[180px]">{r.status === 'error' ? <span className="text-red-400">{r.error}</span> : r.channelId}</div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-3.5 text-right text-xs text-zinc-400 tabular-nums">{r.status === 'completed' ? r.totalVideoCount.toLocaleString() : '—'}</td>
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
                            if (!done.length) return <p className="text-xs text-zinc-600 text-center py-8">완료된 채널이 없습니다.</p>;
                            const maxAd = Math.max(...done.map(r => r.totalAdCount), 1);
                            return (
                              <>
                                <div>
                                  <p className="text-xs font-medium text-zinc-400 mb-3">광고 영상 수</p>
                                  <div className="space-y-2">
                                    {done.map(r => (
                                      <div key={r.channelId} className="flex items-center gap-3">
                                        <span className="text-xs text-zinc-500 w-28 truncate shrink-0">{r.channelName}</span>
                                        <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                                          <div className="h-full bg-violet-500 rounded-full transition-all duration-500" style={{ width: `${(r.totalAdCount / maxAd) * 100}%` }} />
                                        </div>
                                        <span className="text-xs text-zinc-400 w-16 text-right shrink-0 tabular-nums">{r.totalAdCount}</span>
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
                        <pre className="p-6 text-[11px] text-zinc-500 overflow-auto max-h-96 font-mono leading-relaxed">{JSON.stringify(adResults.map(r => ({ channelId: r.channelId, channelName: r.channelName, totalVideoCount: r.totalVideoCount, totalAdCount: r.totalAdCount, adRatio: r.adRatio, avgAdViews: r.avgAdViews, status: r.status })), null, 2)}</pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

          ) : activeTab === 'scraper-config' ? (
            /* ── 로컬 스크래퍼 탭 ─────────────────────────────────────────────── */
            <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
              <h2 className="text-2xl font-semibold text-white">로컬 스크래퍼</h2>

              {/* 설명 */}
              <div className="bg-[#1a1b23] border border-white/8 rounded-xl p-5 space-y-3 text-sm text-zinc-400 leading-relaxed">
                <p className="flex items-center gap-2 font-medium text-zinc-200 text-sm">
                  <Activity size={15} className="text-violet-500" /> 작동 방식
                </p>
                <div className="space-y-1.5 text-xs text-zinc-400">
                  <p>① 아래에서 채널 핸들을 입력하고 <strong className="text-zinc-200">요청 전송</strong>을 클릭합니다.</p>
                  <p>② GitHub <code className="bg-white/8 px-1.5 py-0.5 rounded text-xs">results/queue/</code>에 요청 파일이 생성됩니다.</p>
                  <p>③ 로컬 PC에서 실행 중인 <code className="bg-white/8 px-1.5 py-0.5 rounded text-xs">local_server.py</code>가 이를 감지하고 <code className="bg-white/8 px-1.5 py-0.5 rounded text-xs">undetected_chromedriver</code>로 스크래핑합니다.</p>
                  <p>④ 완료 후 GitHub에 결과를 push → 이 사이트 대시보드에 자동 반영됩니다.</p>
                </div>
                <div className="border-t border-white/8 pt-3 text-xs text-zinc-600">
                  로컬 서버 실행: <code className="bg-white/8 px-1.5 py-0.5 rounded text-zinc-400">launcher_gui.py</code> → 서버 모드 켜기 &nbsp;|&nbsp; 또는 <code className="bg-white/8 px-1.5 py-0.5 rounded text-zinc-400">python scraper/local_server.py</code>
                </div>
              </div>

              {/* 채널 입력 */}
              <div className="bg-[#1a1b23] rounded-xl border border-white/8 p-5 space-y-4">
                <label className="text-xs font-medium text-zinc-400 flex items-center gap-2">
                  <List size={13} className="text-violet-500" /> 채널 목록 (한 줄에 하나, @ 핸들 또는 URL)
                </label>
                <textarea
                  value={scraperHandles}
                  onChange={e => setScraperHandles(e.target.value)}
                  className="w-full h-44 p-4 bg-white/5 border border-white/8 rounded-xl text-white font-mono text-sm focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 resize-none"
                  placeholder={"@채널핸들1\n@채널핸들2\nhttps://youtube.com/@handle"}
                />

                {/* 날짜 범위 설정 */}
                <div className="space-y-4 border-t border-white/8 pt-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-zinc-400 flex items-center gap-1.5">
                      <CalendarDays size={13} className="text-violet-400" /> 수집 기간 설정
                    </label>
                    <button
                      onClick={() => setScraperUseDateFilter(!scraperUseDateFilter)}
                      className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-all ${scraperUseDateFilter ? 'bg-violet-600 text-white' : 'bg-white/8 text-zinc-500'}`}
                    >
                      {scraperUseDateFilter ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>

                  <div className={`space-y-3 transition-opacity ${!scraperUseDateFilter ? 'opacity-30 pointer-events-none' : ''}`}>
                    {/* 프리셋 버튼 */}
                    <div className="grid grid-cols-4 gap-1.5">
                      {(['all', '90d', '30d', '7d'] as AnalysisPeriod[]).map(p => (
                        <button
                          key={p}
                          onClick={() => setScraperDatesByPeriod(p)}
                          className="py-2 text-xs font-medium rounded-lg bg-white/5 text-zinc-400 hover:bg-violet-600 hover:text-white transition-all active:scale-95"
                        >
                          {periodLabels[p]}
                        </button>
                      ))}
                    </div>

                    {/* 직접 날짜 입력 */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="group relative bg-white/5 border border-white/8 hover:border-violet-500/30 rounded-xl p-3 transition-all">
                        <label className="absolute -top-2 left-3 bg-[#1a1b23] px-1.5 text-xs text-zinc-500 group-hover:text-violet-400">Start</label>
                        <div className="flex items-center gap-2">
                          <Calendar size={13} className="text-violet-500 shrink-0" />
                          <input
                            type="date"
                            value={scraperStartDate}
                            onChange={e => setScraperStartDate(e.target.value)}
                            className="w-full bg-transparent border-none text-white text-sm focus:ring-0 cursor-pointer outline-none [color-scheme:dark]"
                          />
                        </div>
                      </div>
                      <div className="group relative bg-white/5 border border-white/8 hover:border-violet-500/30 rounded-xl p-3 transition-all">
                        <label className="absolute -top-2 left-3 bg-[#1a1b23] px-1.5 text-xs text-zinc-500 group-hover:text-violet-400">End</label>
                        <div className="flex items-center gap-2">
                          <Calendar size={13} className="text-violet-500 shrink-0" />
                          <input
                            type="date"
                            value={scraperEndDate}
                            onChange={e => setScraperEndDate(e.target.value)}
                            className="w-full bg-transparent border-none text-white text-sm focus:ring-0 cursor-pointer outline-none [color-scheme:dark]"
                          />
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-zinc-600 text-center">설정한 기간 내 게시된 영상만 수집됩니다.</p>
                  </div>
                </div>

                {/* 상태 표시 */}
                {scraperJobStatus !== 'idle' && (
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-medium ${
                    scraperJobStatus === 'pending'    ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
                    scraperJobStatus === 'submitting' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                    scraperJobStatus === 'done'       ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                                       'bg-violet-500/10 text-violet-400 border border-violet-500/20'
                  }`}>
                    {scraperJobStatus === 'submitting' && <Loader2 size={14} className="animate-spin" />}
                    {scraperJobStatus === 'pending'    && <Loader2 size={14} className="animate-spin" />}
                    {scraperJobStatus === 'done'       && <CheckCircle2 size={14} />}
                    {scraperJobStatus === 'error'      && <AlertCircle size={14} />}
                    {{
                      submitting: '요청을 GitHub에 전송 중...',
                      pending:    `로컬 서버가 처리 중입니다... (10초마다 확인) — Job ID: ${scraperJobId?.slice(0,12)}`,
                      done:       '완료! 대시보드에서 결과를 확인하세요.',
                      error:      'GITHUB_TOKEN이 설정되지 않았거나 오류가 발생했습니다.',
                      idle:       '',
                    }[scraperJobStatus]}
                  </div>
                )}

                <button
                  onClick={handleScraperRequest}
                  disabled={scraperJobStatus === 'submitting' || scraperJobStatus === 'pending'}
                  className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white py-3 rounded-lg font-medium text-base flex items-center justify-center gap-3 transition-all active:scale-95"
                >
                  {(scraperJobStatus === 'submitting' || scraperJobStatus === 'pending')
                    ? <Loader2 className="animate-spin" size={18} />
                    : <Activity size={18} />
                  }
                  {scraperJobStatus === 'pending' ? '로컬 서버 처리 대기 중...' : '로컬 스크래퍼에 요청 전송'}
                </button>
              </div>

              {/* 빠른 대시보드 이동 */}
              <button
                onClick={() => { setActiveTab('dashboard'); setDashboardSubTab('scraper'); loadScraperResults(); }}
                className="w-full bg-white/5 hover:bg-white/8 text-zinc-400 hover:text-zinc-200 py-3 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-all"
              >
                <BarChart3 size={16} /> 스크래퍼 결과 대시보드 보기
              </button>
            </div>
          ) : (
            <div className="space-y-5 animate-in fade-in duration-300">
              {/* 헤더 */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-white">데이터 대시보드</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">수집된 데이터를 한눈에 확인하고 엑셀로 내보내세요</p>
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
                      dashboardSubTab === tab.id ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'
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
                          <span className="text-xs text-zinc-500">{kpi.label}</span>
                          <kpi.icon size={14} className={kpi.color} />
                        </div>
                        <div className={`text-2xl font-semibold ${kpi.color}`}>{kpi.value}</div>
                        <div className="text-xs text-zinc-600">{kpi.sub}</div>
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
                          <span className="text-xs text-zinc-500">{kpi.label}</span>
                          <kpi.icon size={14} className={kpi.color} />
                        </div>
                        <div className={`text-2xl font-semibold ${kpi.color}`}>{kpi.value}</div>
                        <div className="text-xs text-zinc-600">{kpi.sub}</div>
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
                          <span className="text-xs text-zinc-500">{kpi.label}</span>
                          <kpi.icon size={14} className={kpi.color} />
                        </div>
                        <div className={`text-2xl font-semibold ${kpi.color}`}>{kpi.value}</div>
                        <div className="text-xs text-zinc-600">{kpi.sub}</div>
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
                      <span className="text-xs text-zinc-600">from GitHub Raw</span>
                    </div>
                    <button
                      onClick={loadScraperResults}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-medium text-zinc-400 hover:text-white transition-all"
                    >
                      {scraperResultsLoading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      새로고침
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-white/[0.02] text-zinc-500 text-xs">
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
                          <tr><td colSpan={6} className="py-16 text-center"><Loader2 className="animate-spin mx-auto text-zinc-600" size={24} /></td></tr>
                        ) : scraperResults.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-24 text-center">
                              <div className="flex flex-col items-center gap-3 text-zinc-700">
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
                                  <div className="w-10 h-10 bg-zinc-900 rounded-lg flex items-center justify-center"><Activity className="text-zinc-700" size={16} /></div>
                                )}
                                <div>
                                  <div className="font-medium text-zinc-100 text-sm group-hover:text-violet-400 transition-colors">{r.channelName}</div>
                                  <div className="text-xs text-zinc-600 font-mono mt-0.5">{r.channelId}</div>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <span className="bg-white/5 px-3 py-1 rounded-lg text-zinc-400 text-xs border border-white/8">{formatNumber(r.subscriberCount)}</span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <div className="text-base font-semibold text-violet-400">{r.avgShortsViews.toLocaleString()}</div>
                                <div className="text-xs text-zinc-600 mt-0.5">{r.shortsCountFound} Shorts</div>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <div className="text-base font-semibold text-zinc-200">{r.avgLongViews.toLocaleString()}</div>
                                <div className="text-xs text-zinc-600 mt-0.5">{r.longCountFound} Videos</div>
                              </td>
                              <td className="px-6 py-4 text-center text-xs text-zinc-500 font-mono">
                                {(r as any).scrapedAt ? new Date((r as any).scrapedAt).toLocaleDateString('ko-KR') : '—'}
                              </td>
                              <td className="px-6 py-4 text-center">
                                <button
                                  onClick={() => setSelectedChannel(r)}
                                  className="p-2 bg-white/5 hover:bg-violet-600 hover:text-white text-zinc-400 rounded-lg transition-all active:scale-90"
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
                        <thead className="bg-white/[0.02] text-zinc-500 text-xs">
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
                                <div className="flex flex-col items-center gap-3 text-zinc-700">
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
                                        <Loader2 className="animate-spin text-zinc-700" size={16} />
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
                                    <div className="text-xs text-zinc-600 font-mono mt-0.5 max-w-[200px] truncate">{r.status === 'error' ? r.error : r.channelId}</div>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <span className="bg-white/5 px-3 py-1 rounded-lg text-zinc-400 text-xs border border-white/8">
                                    {r.status === 'completed' ? formatNumber(r.subscriberCount) : '...'}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <div className="text-base font-semibold text-violet-400">{r.avgShortsViews.toLocaleString()}</div>
                                  <div className="text-xs text-zinc-600 mt-0.5">{r.shortsCountFound} Shorts</div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <div className="text-base font-semibold text-zinc-200">{r.avgLongViews.toLocaleString()}</div>
                                  <div className="text-xs text-zinc-600 mt-0.5">{r.longCountFound} Videos</div>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <button
                                    disabled={r.status !== 'completed'}
                                    onClick={() => setSelectedChannel(r)}
                                    className="p-2 bg-white/5 hover:bg-violet-600 hover:text-white text-zinc-400 rounded-lg transition-all disabled:opacity-20 active:scale-90"
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
                        <thead className="bg-white/[0.02] text-zinc-500 text-xs">
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
                                <div className="flex flex-col items-center gap-3 text-zinc-700">
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
                                        <Loader2 className="animate-spin text-zinc-700" size={16} />
                                      </div>
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-medium text-zinc-100 text-sm group-hover:text-violet-400 transition-colors truncate max-w-[300px]">{v.title}</div>
                                    <div className="text-xs text-zinc-600 font-mono mt-0.5">{v.status === 'error' ? v.error : v.videoId}</div>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="text-sm text-zinc-400">{v.channelTitle || '...'}</div>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-xs text-violet-400 flex items-center gap-1">
                                      <ThumbsUp size={11} /> {v.likeCount.toLocaleString()}
                                    </span>
                                    <span className="text-xs text-zinc-400 flex items-center gap-1">
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
                                    className="p-2 bg-white/5 hover:bg-white/12 hover:text-white text-zinc-400 rounded-lg transition-all disabled:opacity-20 active:scale-90"
                                  >
                                    <Eye size={16} />
                                  </button>
                                  <a
                                    href={v.isShort ? `https://youtube.com/shorts/${v.videoId}` : `https://youtube.com/watch?v=${v.videoId}`}
                                    target="_blank"
                                    className="inline-block p-2 bg-white/5 hover:bg-violet-600 hover:text-white text-zinc-400 rounded-lg transition-all active:scale-90"
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
