
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
  ToggleRight
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { getChannelInfo, fetchChannelStats, fetchVideosByIds, AnalysisPeriod } from './services/youtubeService';
import { ChannelResult, VideoResult, VideoDetail } from './types';

type TabType = 'channel-config' | 'video-config' | 'dashboard';

const App: React.FC = () => {
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [pinInput, setPinInput] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabType>('channel-config');
  const [dashboardSubTab, setDashboardSubTab] = useState<'channel' | 'video'>('channel');
  
  // Filters Control
  const [useDateFilter, setUseDateFilter] = useState<boolean>(true);
  const [useCountFilter, setUseCountFilter] = useState<boolean>(true);
  
  // Channel Analysis States
  const [channelInput, setChannelInput] = useState<string>('');
  const [targetShorts, setTargetShorts] = useState<number | string>(30);
  const [targetLong, setTargetLong] = useState<number | string>(10);
  const [period, setPeriod] = useState<AnalysisPeriod>('30d');
  const [channelResults, setChannelResults] = useState<ChannelResult[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<ChannelResult | null>(null);
  
  // Individual Video States
  const [videoInput, setVideoInput] = useState<string>('');
  const [videoResults, setVideoResults] = useState<VideoResult[]>([]);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => { 
    setIsMounted(true); 
  }, []);

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

  const extractVideoId = (input: string) => {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = input.match(regex);
    return match ? match[1] : input.trim();
  };

  const handleChannelStart = async () => {
    const inputs = channelInput
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (inputs.length === 0) {
      alert('분석할 채널 URL 또는 UC 코드를 입력해주세요.');
      return;
    }

    const shortsVal = typeof targetShorts === 'string' ? parseInt(targetShorts, 10) || 1 : targetShorts;
    const longsVal = typeof targetLong === 'string' ? parseInt(targetLong, 10) || 1 : targetLong;

    setIsProcessing(true);
    setActiveTab('dashboard');
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
      shortsList: [],
      longsList: [],
      liveList: [],
      status: 'pending',
    }));
    
    setChannelResults(initialResults);

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      setChannelResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'processing' } : r));
      try {
        const info = await getChannelInfo(input);
        const stats = await fetchChannelStats(info.uploadsPlaylistId, shortsVal, longsVal, period, useDateFilter, useCountFilter);
        setChannelResults(prev => prev.map((r, idx) => idx === i ? { 
          ...r, 
          channelId: info.id,
          channelName: info.title, 
          thumbnail: info.thumbnail,
          subscriberCount: info.subscriberCount,
          avgShortsViews: stats.avgShortsViews, 
          shortsCountFound: stats.shortsCount,
          avgLongViews: stats.avgLongViews,
          longCountFound: stats.longCount,
          shortsList: stats.shortsList,
          longsList: stats.longsList,
          liveList: stats.liveList,
          status: 'completed' 
        } : r));
      } catch (err: any) {
        console.error(err);
        setChannelResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', error: err.message || '오류 발생' } : r));
      }
    }
    setIsProcessing(false);
  };

  const handleVideoStart = async () => {
    const lines = videoInput.split('\n').filter(l => l.trim().length > 0);
    const videoIds = lines.map(extractVideoId);

    if (videoIds.length === 0) {
      alert('분석할 영상 ID 또는 URL을 입력해주세요.');
      return;
    }

    setIsProcessing(true);
    setActiveTab('dashboard');
    setDashboardSubTab('video');
    setVideoResults(videoIds.map(id => ({
      videoId: id, title: '로딩 중...', channelTitle: '', thumbnail: '', viewCount: 0, duration: '', isShort: false, status: 'processing'
    })));

    try {
      const chunkSize = 40;
      for (let i = 0; i < videoIds.length; i += chunkSize) {
        const chunk = videoIds.slice(i, i + chunkSize);
        const fetched = await fetchVideosByIds(chunk);
        
        setVideoResults(prev => prev.map(p => {
          const match = fetched.find(f => f.videoId === p.videoId);
          return match ? match : (p.status === 'processing' ? { ...p, status: 'error', error: '찾을 수 없음' } : p);
        }));
      }
    } catch (err: any) {
      console.error(err);
      alert('영상 정보를 가져오는 중 오류가 발생했습니다.');
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
        '쇼츠 평균 조회수': r.avgShortsViews,
        '쇼츠 분석 개수': r.shortsCountFound,
        '롱폼 평균 조회수': r.avgLongViews,
        '롱폼 분석 개수': r.longCountFound,
        '상태': r.status === 'completed' ? '완료' : r.status === 'error' ? '오류' : '대기',
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
        '영상 링크': `https://youtu.be/${r.videoId}`,
        '영상 제목': r.title,
        '채널명': r.channelTitle,
        '유형': r.isShort ? '쇼츠' : '롱폼',
        '조회수': r.viewCount,
        '영상 ID': r.videoId
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, '영상 데이터');
      XLSX.writeFile(wb, `TubeMetric_Video_${timestamp}.xlsx`);
    }
  };

  const periodLabels: Record<AnalysisPeriod, string> = {
    '7d': '7일',
    '30d': '30일',
    '90d': '90일',
    'all': '전체'
  };

  if (!isMounted) return null;

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 flex items-center justify-center p-6 selection:bg-red-500/30">
        <div className="w-full max-w-md space-y-12 animate-in fade-in zoom-in-95 duration-700">
          <div className="text-center space-y-6">
            <div className="inline-block bg-red-600 p-5 rounded-[2.5rem] shadow-2xl shadow-red-600/20 mb-4">
              <Lock className="text-white w-10 h-10" strokeWidth={2.5} />
            </div>
            <div className="space-y-2">
              <h1 className="text-4xl font-black tracking-tighter italic uppercase text-white">
                Parable<br />
                <span className="text-red-600">TubeMetric</span>
              </h1>
              <p className="text-zinc-500 text-sm font-bold tracking-widest uppercase">System Locked</p>
            </div>
          </div>

          <form onSubmit={handlePinSubmit} className="space-y-6">
            <div className="relative group">
              <input
                type="password"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="PIN CODE"
                autoFocus
                className="w-full bg-[#121212] border-2 border-white/5 rounded-[32px] py-6 px-10 text-center text-3xl font-black tracking-[0.5em] text-white focus:outline-none focus:border-red-600/50 focus:ring-4 focus:ring-red-600/10 transition-all placeholder:text-zinc-800 placeholder:tracking-normal placeholder:text-base"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-red-600 hover:bg-red-500 text-white py-6 rounded-[32px] font-black text-lg transition-all shadow-2xl shadow-red-600/20 active:scale-95 uppercase tracking-widest flex items-center justify-center gap-3"
            >
              Authorize System <ChevronRight size={20} />
            </button>
          </form>
          
          <p className="text-center text-[10px] text-zinc-700 font-bold uppercase tracking-[0.3em]">Authorized Access Only</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 flex font-sans overflow-hidden selection:bg-red-500/30">
      {/* Modal: Channel Details */}
      {selectedChannel && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="bg-[#121212] w-full max-w-6xl h-[85vh] rounded-[40px] border border-white/10 overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-500">
            <div className="p-8 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-red-600/5 to-transparent">
              <div className="flex items-center gap-6">
                <div className="relative">
                  <img src={selectedChannel.thumbnail} className="w-16 h-16 rounded-3xl border-2 border-red-600/30 shadow-2xl object-cover" alt="" />
                  <div className="absolute -bottom-1 -right-1 bg-red-600 p-1.5 rounded-xl border-2 border-[#121212]">
                    <Youtube size={12} className="text-white" />
                  </div>
                </div>
                <div>
                  <h3 className="text-2xl font-black text-white flex items-center gap-3">
                    {selectedChannel.channelName}
                    <a href={`https://youtube.com/channel/${selectedChannel.channelId}`} target="_blank" className="text-zinc-500 hover:text-red-500 transition-all"><ExternalLink size={20} /></a>
                  </h3>
                  <div className="flex items-center gap-4 mt-1.5">
                    <span className="flex items-center gap-1.5 text-[11px] font-black text-red-500 bg-red-500/10 px-3 py-1 rounded-full uppercase tracking-wider">
                      <Users size={12} /> {formatNumber(selectedChannel.subscriberCount)} Subscribers
                    </span>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">{periodLabels[period]} Analytics</p>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedChannel(null)} className="p-3 bg-white/5 hover:bg-red-600 text-white rounded-2xl transition-all group">
                <X size={24} className="group-hover:rotate-90 transition-transform duration-300" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-10 space-y-16">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                <div className="space-y-8">
                  <div className="flex items-center justify-between border-b border-white/5 pb-4">
                    <h4 className="text-base font-black text-white flex items-center gap-3 uppercase tracking-tighter">
                      <div className="w-2 h-6 bg-red-600 rounded-full animate-pulse"></div>
                      Shorts <span className="text-zinc-500 font-medium">({selectedChannel.shortsList.length})</span>
                    </h4>
                    <div className="text-right">
                      <div className="text-[10px] text-zinc-500 font-bold uppercase mb-1">Avg Views</div>
                      <div className="text-lg font-black text-red-500">{selectedChannel.avgShortsViews.toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    {selectedChannel.shortsList.map((v) => (
                      <div key={v.id} className="bg-white/5 p-4 rounded-3xl border border-white/5 flex items-center gap-5 hover:bg-white/[0.08] hover:border-red-600/30 transition-all group relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-1 h-full bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <img src={v.thumbnail} className="w-14 h-14 rounded-2xl object-cover shadow-lg" alt="" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] font-bold text-zinc-100 truncate leading-snug group-hover:text-white">{v.title}</div>
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-[11px] font-black text-red-500">{v.viewCount.toLocaleString()} views</span>
                            <span className="text-[10px] text-zinc-500 font-medium">{new Date(v.publishedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <a href={`https://youtube.com/shorts/${v.id}`} target="_blank" className="p-2.5 bg-white/5 text-zinc-400 hover:text-white hover:bg-red-600 rounded-xl transition-all">
                          <ExternalLink size={16} />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-8">
                  <div className="flex items-center justify-between border-b border-white/5 pb-4">
                    <h4 className="text-base font-black text-white flex items-center gap-3 uppercase tracking-tighter">
                      <div className="w-2 h-6 bg-zinc-400 rounded-full animate-pulse"></div>
                      Longform <span className="text-zinc-500 font-medium">({selectedChannel.longsList.length})</span>
                    </h4>
                    <div className="text-right">
                      <div className="text-[10px] text-zinc-500 font-bold uppercase mb-1">Avg Views</div>
                      <div className="text-lg font-black text-zinc-100">{selectedChannel.avgLongViews.toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    {selectedChannel.longsList.map((v) => (
                      <div key={v.id} className="bg-white/5 p-4 rounded-3xl border border-white/5 flex items-center gap-5 hover:bg-white/[0.08] hover:border-white/20 transition-all group relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-1 h-full bg-white opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <img src={v.thumbnail} className="w-20 h-12 rounded-xl object-cover shadow-lg" alt="" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] font-bold text-zinc-100 truncate leading-snug">{v.title}</div>
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-[11px] font-black text-zinc-400">{v.viewCount.toLocaleString()} views</span>
                            <span className="text-[10px] text-zinc-500 font-medium">{new Date(v.publishedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <a href={`https://youtube.com/watch?v=${v.id}`} target="_blank" className="p-2.5 bg-white/5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-xl transition-all">
                          <ExternalLink size={16} />
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

      {/* Sidebar Navigation */}
      <aside className="w-80 bg-[#0f0f0f] border-r border-white/5 flex flex-col shrink-0 hidden xl:flex">
        <div className="p-10">
          <div className="flex items-center gap-4 mb-16">
            <div className="bg-red-600 p-3 rounded-2xl shadow-2xl shadow-red-600/40">
              <Youtube className="text-white w-7 h-7" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight italic uppercase leading-tight">
                Parable<br />
                <span className="text-red-600">TubeMetric</span>
              </h1>
            </div>
          </div>

          <nav className="space-y-3">
            {[
              { id: 'channel-config', label: '채널 통합 분석', icon: TrendingUp },
              { id: 'video-config', label: '단일 영상 분석', icon: Video },
              { id: 'dashboard', label: '데이터 대시보드', icon: BarChart3 },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as TabType)}
                className={`w-full flex items-center justify-between px-6 py-5 rounded-[24px] text-[14px] font-black transition-all duration-500 group ${
                  activeTab === item.id 
                    ? 'bg-red-600 text-white shadow-2xl shadow-red-600/30' 
                    : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-4">
                  <item.icon size={20} className={activeTab === item.id ? 'text-white' : 'text-zinc-600 group-hover:text-red-500'} />
                  {item.label}
                </div>
                {activeTab === item.id && <ChevronRight size={16} className="animate-bounce-x" />}
              </button>
            ))}
          </nav>
        </div>
        
        <div className="mt-auto p-10 border-t border-white/5 bg-gradient-to-t from-red-600/5 to-transparent">
          <div className="bg-[#161616] p-5 rounded-3xl border border-white/5 space-y-3">
            <div className="flex items-center gap-2 text-[10px] font-black text-zinc-500 uppercase tracking-widest">
              <Settings2 size={12} className="text-red-600" /> API Status
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span className="text-[11px] font-bold text-emerald-500 uppercase">Vercel Connected</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-y-auto bg-[#0a0a0a]">
        <div className="p-8 md:pt-10 md:pb-16 md:px-16 max-w-7xl w-full mx-auto">
          {activeTab === 'channel-config' ? (
            <div className="space-y-10 animate-in fade-in slide-in-from-bottom-10 duration-1000">
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-2 bg-red-600 rounded-full"></div>
                  <h2 className="text-4xl md:text-5xl font-black tracking-tighter uppercase italic text-white">채널 통합 분석</h2>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-5 gap-10">
                <div className="xl:col-span-3 flex flex-col space-y-6">
                  <div className="flex items-center justify-between px-2">
                    <label className="text-[12px] font-black text-white uppercase tracking-[0.3em] flex items-center gap-3">
                      <List size={16} className="text-red-600" /> CHANNEL / URL / UC-CODE INPUT
                    </label>
                    <button onClick={() => setChannelInput('')} className="flex items-center gap-2 text-[11px] font-black text-white hover:text-red-500 transition-all uppercase">
                      <Trash2 size={14} /> Clear List
                    </button>
                  </div>
                  <div className="flex-1 min-h-[500px] bg-[#121212] p-1 border border-white/5 rounded-[40px] shadow-2xl relative group overflow-hidden focus-within:border-red-600/50 transition-all">
                    <textarea
                      value={channelInput}
                      onChange={(e) => setChannelInput(e.target.value)}
                      placeholder="https://www.youtube.com/@JU_RURU&#10;UC-xxxxxxxxxxxx&#10;엔터로 구분하여 여러 개를 입력하세요."
                      className="w-full h-full p-10 bg-transparent text-base font-mono leading-relaxed text-zinc-100 placeholder:text-zinc-800 focus:outline-none resize-none relative z-10"
                    />
                    <div className="absolute bottom-8 right-8 text-[11px] font-bold text-white bg-black/50 px-4 py-2 rounded-xl backdrop-blur-md">
                      Line Count: {channelInput.split('\n').filter(l => l.trim()).length}
                    </div>
                  </div>
                </div>

                <div className="xl:col-span-2 flex flex-col space-y-6">
                   <div className="px-2">
                    <label className="text-[12px] font-black text-white uppercase tracking-[0.3em] flex items-center gap-3">
                      <Settings2 size={16} className="text-red-600" /> ENGINE CONFIG
                    </label>
                  </div>
                  <div className="flex-1 bg-[#121212] p-8 rounded-[40px] border border-white/5 shadow-2xl flex flex-col justify-between space-y-8">
                    <div className="space-y-10">
                      {/* Analysis Period Filter */}
                      <div className="space-y-5">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-black text-white uppercase tracking-widest flex items-center gap-3">
                            <Calendar size={16} className="text-red-600" /> 분석 기간 필터
                          </label>
                          <button 
                            onClick={() => setUseDateFilter(!useDateFilter)} 
                            className={`flex items-center gap-2 transition-all ${useDateFilter ? 'text-red-600' : 'text-zinc-800'}`}
                          >
                             {useDateFilter ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                          </button>
                        </div>
                        <div className={`grid grid-cols-4 gap-2 p-1.5 bg-black/50 rounded-2xl border border-white/5 transition-all ${!useDateFilter ? 'opacity-20 grayscale pointer-events-none' : 'opacity-100'}`}>
                          {(['all', '90d', '30d', '7d'] as AnalysisPeriod[]).map((p) => (
                            <button 
                              key={p} 
                              onClick={() => setPeriod(p)} 
                              className={`py-2 text-[10px] font-black rounded-xl transition-all ${period === p ? 'bg-white text-black shadow-xl' : 'text-white hover:text-zinc-300'}`}
                            >
                              {periodLabels[p]}
                            </button>
                          ))}
                        </div>
                        <p className={`text-[10px] font-bold text-white px-2 italic ${!useDateFilter ? 'opacity-0' : 'opacity-100'}`}>
                          * {period === 'all' ? '채널 전체의 영상을 분석합니다.' : `${periodLabels[period]} 이내에 업로드된 영상만 분석합니다.`}
                        </p>
                      </div>

                      {/* Collection Target Filter */}
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-black text-white uppercase tracking-widest flex items-center gap-3">
                            <Radio size={16} className="text-red-600" /> 영상 개수 필터
                          </label>
                          <button 
                            onClick={() => setUseCountFilter(!useCountFilter)} 
                            className={`flex items-center gap-2 transition-all ${useCountFilter ? 'text-red-600' : 'text-zinc-800'}`}
                          >
                             {useCountFilter ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                          </button>
                        </div>
                        
                        <div className={`space-y-6 transition-all ${!useCountFilter ? 'opacity-20 grayscale pointer-events-none' : 'opacity-100'}`}>
                          <div className="space-y-3 bg-black/20 p-5 rounded-3xl border border-white/5">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-black text-white uppercase italic">Shorts Target</span>
                              <span className="text-xl font-black text-red-600">{targetShorts} <span className="text-[9px] text-white uppercase">Videos</span></span>
                            </div>
                            <input type="range" min="1" max="100" value={Number(targetShorts)} onChange={(e) => setTargetShorts(Number(e.target.value))} className="w-full h-1.5 bg-white/5 rounded-full appearance-none accent-red-600" />
                          </div>
                          
                          <div className="space-y-3 bg-black/20 p-5 rounded-3xl border border-white/5">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-black text-white uppercase italic">Longform Target</span>
                              <span className="text-xl font-black text-white">{targetLong} <span className="text-[9px] text-white uppercase">Videos</span></span>
                            </div>
                            <input type="range" min="1" max="50" value={Number(targetLong)} onChange={(e) => setTargetLong(Number(e.target.value))} className="w-full h-1.5 bg-white/5 rounded-full appearance-none accent-white" />
                          </div>
                        </div>
                        <p className={`text-[10px] font-bold text-white px-2 italic ${!useCountFilter ? 'opacity-0' : 'opacity-100'}`}>
                          * {useDateFilter ? `설정 기간 내의` : `업로드일 상관없이`} 최신 영상 {targetShorts}/{targetLong}개를 분석합니다.
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handleChannelStart}
                      disabled={isProcessing || !channelInput.trim()}
                      className="w-full bg-red-600 hover:bg-red-500 disabled:bg-zinc-900 disabled:text-zinc-700 text-white py-6 rounded-[28px] font-black text-lg flex items-center justify-center gap-4 transition-all shadow-2xl shadow-red-600/20 active:scale-95 group"
                    >
                      {isProcessing ? (
                        <Loader2 className="animate-spin" size={24} />
                      ) : (
                        <Play fill="currentColor" size={20} className="group-hover:scale-125 transition-transform" />
                      )}
                      분석 시작하기
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab === 'video-config' ? (
            <div className="max-w-4xl mx-auto space-y-12 animate-in fade-in slide-in-from-top-6 duration-700">
              <div className="text-center space-y-4">
                <h2 className="text-5xl font-black italic uppercase">단일 <span className="text-red-600">영상</span> 분석</h2>
                <p className="text-zinc-500 font-medium text-lg">개별 영상의 데이터를 실시간으로 크롤링하여 분석합니다.</p>
              </div>
              <div className="bg-[#121212] p-12 rounded-[48px] border border-white/5 shadow-2xl space-y-10">
                <textarea 
                  value={videoInput} 
                  onChange={(e) => setVideoInput(e.target.value)} 
                  placeholder="분석할 영상의 URL을 한 줄씩 입력하세요..." 
                  className="w-full h-80 p-10 bg-black/50 border border-white/5 rounded-[40px] text-lg font-mono outline-none resize-none focus:border-red-600/50 transition-all text-zinc-100" 
                />
                <button 
                  onClick={handleVideoStart} 
                  disabled={isProcessing || !videoInput.trim()} 
                  className="w-full bg-white text-black hover:bg-zinc-200 py-8 rounded-[32px] font-black text-xl flex items-center justify-center gap-4 transition-all shadow-2xl shadow-white/5 active:scale-95"
                >
                  {isProcessing ? <Loader2 className="animate-spin" size={24} /> : <MonitorPlay size={28} />}
                  영상 데이터 수집
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-12 animate-in fade-in duration-700">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
                <div className="space-y-2">
                  <h2 className="text-4xl font-black italic uppercase text-white">Data <span className="text-red-600">Report</span></h2>
                  <div className="flex items-center gap-4 mt-4">
                    <button 
                      onClick={() => setDashboardSubTab('channel')} 
                      className={`px-6 py-2 rounded-full text-[11px] font-black uppercase tracking-widest transition-all ${dashboardSubTab === 'channel' ? 'bg-red-600 text-white' : 'bg-white/5 text-zinc-500 hover:text-zinc-300'}`}
                    >
                      Channel Analysis
                    </button>
                    <button 
                      onClick={() => setDashboardSubTab('video')} 
                      className={`px-6 py-2 rounded-full text-[11px] font-black uppercase tracking-widest transition-all ${dashboardSubTab === 'video' ? 'bg-red-600 text-white' : 'bg-white/5 text-zinc-500 hover:text-zinc-300'}`}
                    >
                      Video Analysis
                    </button>
                  </div>
                </div>
                <button onClick={handleDownloadExcel} className="bg-white text-black hover:bg-zinc-200 px-10 py-5 rounded-[24px] font-black flex items-center gap-3 text-sm shadow-2xl shadow-white/10 transition-all active:scale-95">
                  <FileSpreadsheet size={20} /> Excel Export
                </button>
              </div>

              <div className="bg-[#121212] rounded-[40px] border border-white/5 overflow-hidden shadow-2xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    {dashboardSubTab === 'channel' ? (
                      <>
                        <thead className="bg-white/[0.03] text-zinc-500 text-[11px] uppercase font-black tracking-[0.2em]">
                          <tr>
                            <th className="px-10 py-8">Channel Information</th>
                            <th className="px-10 py-8 text-center">Subscribers</th>
                            <th className="px-10 py-8 text-right">Shorts Avg</th>
                            <th className="px-10 py-8 text-right">Longform Avg</th>
                            <th className="px-10 py-8 text-center">Detail</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {channelResults.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-40 text-center">
                                <div className="flex flex-col items-center gap-4 text-zinc-700">
                                  <LayoutDashboard size={48} strokeWidth={1} />
                                  <p className="text-lg font-bold">No channel data analyzed yet.</p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            channelResults.map((r, i) => (
                              <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                                <td className="px-10 py-8 flex items-center gap-6">
                                  <div className="relative">
                                    {r.thumbnail ? (
                                      <img src={r.thumbnail} className="w-14 h-14 rounded-2xl object-cover shadow-xl border border-white/10" />
                                    ) : (
                                      <div className="w-14 h-14 bg-zinc-900 rounded-2xl flex items-center justify-center">
                                        <Loader2 className="animate-spin text-zinc-700" size={20} />
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    <div className="font-black text-zinc-100 text-lg group-hover:text-red-500 transition-colors">{r.channelName}</div>
                                    <div className="text-[10px] text-zinc-600 font-mono mt-1">{r.channelId}</div>
                                  </div>
                                </td>
                                <td className="px-10 py-8 text-center">
                                  <span className="bg-zinc-900 px-4 py-2 rounded-xl text-zinc-400 font-black text-sm border border-white/5">
                                    {r.status === 'completed' ? formatNumber(r.subscriberCount) : '...'}
                                  </span>
                                </td>
                                <td className="px-10 py-8 text-right">
                                  <div className="text-xl font-black text-red-500">{r.avgShortsViews.toLocaleString()}</div>
                                  <div className="text-[10px] text-zinc-600 font-bold uppercase mt-1 italic">{r.shortsCountFound} Shorts</div>
                                </td>
                                <td className="px-10 py-8 text-right">
                                  <div className="text-xl font-black text-zinc-100">{r.avgLongViews.toLocaleString()}</div>
                                  <div className="text-[10px] text-zinc-600 font-bold uppercase mt-1 italic">{r.longCountFound} Videos</div>
                                </td>
                                <td className="px-10 py-8 text-center">
                                  <button 
                                    disabled={r.status !== 'completed'} 
                                    onClick={() => setSelectedChannel(r)} 
                                    className="p-4 bg-white/5 hover:bg-red-600 hover:text-white rounded-2xl transition-all disabled:opacity-20 active:scale-90"
                                  >
                                    <Eye size={20} />
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </>
                    ) : (
                      <>
                        <thead className="bg-white/[0.03] text-zinc-500 text-[11px] uppercase font-black tracking-[0.2em]">
                          <tr>
                            <th className="px-10 py-8">Video Details</th>
                            <th className="px-10 py-8">Channel</th>
                            <th className="px-10 py-8 text-center">Type</th>
                            <th className="px-10 py-8 text-right">View Count</th>
                            <th className="px-10 py-8 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {videoResults.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-40 text-center">
                                <div className="flex flex-col items-center gap-4 text-zinc-700">
                                  <MonitorPlay size={48} strokeWidth={1} />
                                  <p className="text-lg font-bold">No video data analyzed yet.</p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            videoResults.map((v, i) => (
                              <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                                <td className="px-10 py-8 flex items-center gap-6">
                                  <div className="relative shrink-0">
                                    {v.thumbnail ? (
                                      <img src={v.thumbnail} className={`rounded-xl object-cover shadow-xl border border-white/10 ${v.isShort ? 'w-10 h-14' : 'w-20 h-12'}`} />
                                    ) : (
                                      <div className="w-14 h-14 bg-zinc-900 rounded-2xl flex items-center justify-center">
                                        <Loader2 className="animate-spin text-zinc-700" size={20} />
                                      </div>
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-black text-zinc-100 text-[15px] group-hover:text-red-500 transition-colors truncate max-w-[300px]">{v.title}</div>
                                    <div className="text-[10px] text-zinc-600 font-mono mt-1">{v.videoId}</div>
                                  </div>
                                </td>
                                <td className="px-10 py-8">
                                  <div className="text-[14px] font-bold text-zinc-400">{v.channelTitle || '...'}</div>
                                </td>
                                <td className="px-10 py-8 text-center">
                                  <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider ${v.isShort ? 'bg-red-500/10 text-red-500' : 'bg-white/5 text-zinc-400'}`}>
                                    {v.isShort ? 'Shorts' : 'Longform'}
                                  </span>
                                </td>
                                <td className="px-10 py-8 text-right">
                                  <div className="text-xl font-black text-white">{v.viewCount.toLocaleString()}</div>
                                </td>
                                <td className="px-10 py-8 text-center">
                                  <a 
                                    href={v.isShort ? `https://youtube.com/shorts/${v.videoId}` : `https://youtube.com/watch?v=${v.videoId}`} 
                                    target="_blank" 
                                    className="inline-block p-4 bg-white/5 hover:bg-zinc-100 hover:text-black rounded-2xl transition-all active:scale-90"
                                  >
                                    <ExternalLink size={18} />
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
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
