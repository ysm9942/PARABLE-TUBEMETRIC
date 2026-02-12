
import React, { useState, useEffect } from 'react';
import { 
  Play, Download, Trash2, Youtube, Loader2, LayoutDashboard, ExternalLink, Calendar,
  Video, MonitorPlay, X, Eye, FileSpreadsheet, Users, Radio, Settings2,
  ChevronRight, Lock, CheckCircle2, Circle, ToggleLeft, ToggleRight,
  Megaphone, Zap, Binary, Database, Activity, Info, ShieldCheck, Cpu
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { getChannelInfo, fetchChannelStats, fetchVideosByIds, AnalysisPeriod, analyzeAdVideos } from './services/youtubeService';
import { ChannelResult, VideoResult, VideoDetail, AdAnalysisResult, DataSourceType, TabType } from './types';

const formatNumber = (num: number) => {
  if (num >= 100000000) return (num / 100000000).toFixed(1) + '억';
  if (num >= 10000) return (num / 10000).toFixed(1) + '만';
  return num.toLocaleString();
};

const App: React.FC = () => {
  // Authentication & Navigation
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [pinInput, setPinInput] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabType>('channel-config');
  const [dashboardSubTab, setDashboardSubTab] = useState<'channel' | 'video' | 'ad'>('channel');
  const [isMounted, setIsMounted] = useState(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Configuration States
  const [useDateFilter, setUseDateFilter] = useState<boolean>(false);
  const [period, setPeriod] = useState<AnalysisPeriod>('all');
  const [useShorts, setUseShorts] = useState<boolean>(true);
  const [targetShorts, setTargetShorts] = useState<number | string>(30);
  const [useLongs, setUseLongs] = useState<boolean>(false);
  const [targetLong, setTargetLong] = useState<number | string>(10);
  const [useGlobalCountFilter, setUseGlobalCountFilter] = useState<boolean>(true);

  // Results & Selection
  const [channelInput, setChannelInput] = useState<string>('');
  const [channelResults, setChannelResults] = useState<ChannelResult[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<ChannelResult | null>(null);

  const [adChannelInput, setAdChannelInput] = useState<string>('');
  const [adStartDate, setAdStartDate] = useState<string>(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const [adEndDate, setAdEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [adResults, setAdResults] = useState<AdAnalysisResult[]>([]);
  const [selectedAdResult, setSelectedAdResult] = useState<AdAnalysisResult | null>(null);

  const [videoInput, setVideoInput] = useState<string>('');
  const [videoResults, setVideoResults] = useState<VideoResult[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<VideoResult | null>(null);

  useEffect(() => { 
    setIsMounted(true); 
    const saved = localStorage.getItem('isAuthorized');
    if (saved === 'true') setIsAuthorized(true);
  }, []);

  const handlePinSubmit = () => {
    if (pinInput === '5350') { 
      setIsAuthorized(true);
      localStorage.setItem('isAuthorized', 'true');
    } else {
      alert('PIN 번호가 일치하지 않습니다.');
    }
  };

  const handleChannelStart = async () => {
    if (!channelInput.trim()) return;
    setIsProcessing(true);
    setActiveTab('dashboard');
    setDashboardSubTab('channel');
    
    const inputs = channelInput.split('\n').filter(i => i.trim());
    const results: ChannelResult[] = [];

    for (const input of inputs) {
      try {
        const info = await getChannelInfo(input);
        const stats = await fetchChannelStats(
          info.uploadsPlaylistId,
          { target: Number(targetShorts), period, useDateFilter, useCountFilter: useGlobalCountFilter, enabled: useShorts },
          { target: Number(targetLong), period, useDateFilter, useCountFilter: useGlobalCountFilter, enabled: useLongs }
        );
        results.push({
          channelId: info.id,
          channelName: info.title,
          thumbnail: info.thumbnail,
          subscriberCount: info.subscriberCount,
          ...stats,
          status: 'completed'
        });
      } catch (err) { console.error(err); }
    }
    setChannelResults(results);
    setIsProcessing(false);
  };

  const handleAdStart = async () => {
    if (!adChannelInput.trim()) return;
    setIsProcessing(true);
    setActiveTab('dashboard');
    setDashboardSubTab('ad');

    const inputs = adChannelInput.split('\n').filter(i => i.trim());
    const results: AdAnalysisResult[] = [];

    for (const input of inputs) {
      try {
        const info = await getChannelInfo(input);
        const ads = await analyzeAdVideos(info.uploadsPlaylistId, new Date(adStartDate), new Date(adEndDate));
        results.push({
          channelId: info.id,
          channelName: info.title,
          thumbnail: info.thumbnail,
          adVideos: ads,
          totalAdCount: ads.length,
          totalViews: ads.reduce((acc, v) => acc + v.viewCount, 0),
          avgViews: ads.length ? Math.round(ads.reduce((acc, v) => acc + v.viewCount, 0) / ads.length) : 0,
          avgLikes: ads.length ? Math.round(ads.reduce((acc, v) => acc + v.likeCount, 0) / ads.length) : 0,
          avgComments: ads.length ? Math.round(ads.reduce((acc, v) => acc + v.commentCount, 0) / ads.length) : 0,
          status: 'completed'
        });
      } catch (err) { console.error(err); }
    }
    setAdResults(results);
    setIsProcessing(false);
  };

  const handleVideoStart = async () => {
    if (!videoInput.trim()) return;
    setIsProcessing(true);
    setActiveTab('dashboard');
    setDashboardSubTab('video');
    const ids = videoInput.split(/[\n, ]+/).filter(id => id.length === 11);
    try {
      const results = await fetchVideosByIds(ids);
      setVideoResults(results);
    } catch (err) { console.error(err); }
    setIsProcessing(false);
  };

  const handleDownloadExcel = () => {
    const data = channelResults.map(c => ({
      '채널명': c.channelName,
      '구독자수': Number(c.subscriberCount),
      '쇼츠 평균 조회수': c.avgShortsViews,
      '쇼츠 분석 수': c.shortsCountFound,
      '롱폼 평균 조회수': c.avgLongViews,
      '롱폼 분석 수': c.longCountFound,
      '전체 평균': c.avgTotalViews
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "채널성과분석");
    XLSX.writeFile(wb, `TubeMetric_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const getSourceIcon = (src: DataSourceType) => {
    switch(src) {
      case 'youtubei_player': return <Cpu size={14} className="text-yellow-400" />;
      case 'runtime_eval': return <Binary size={14} className="text-blue-400" />;
      case 'ui_rendered': return <MonitorPlay size={14} className="text-emerald-400" />;
      default: return <Database size={14} className="text-zinc-500" />;
    }
  };

  const getSourceLabel = (src: DataSourceType) => {
    switch(src) {
      case 'youtubei_player': return 'Network Layer';
      case 'runtime_eval': return 'Runtime Logic';
      case 'ui_rendered': return 'UI Overlay';
      default: return 'NLP Analysis';
    }
  };

  if (!isMounted) return null;

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-[#121212] border border-white/10 rounded-[32px] p-10 shadow-2xl text-center space-y-8 animate-in fade-in zoom-in duration-500">
          <div className="w-20 h-20 bg-red-600 rounded-3xl flex items-center justify-center mx-auto shadow-2xl shadow-red-600/20">
            <Lock size={36} className="text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight italic">TUBE<span className="text-red-600">METRIC</span></h1>
            <p className="text-zinc-500 mt-2 font-medium">서비스 사용을 위해 PIN 번호를 입력하세요.</p>
          </div>
          <div className="space-y-4">
            <input 
              type="password" 
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePinSubmit()}
              className="w-full h-16 bg-[#1a1a1a] border border-white/5 rounded-2xl text-center text-2xl font-black text-white focus:outline-none focus:border-red-600 transition-all placeholder:text-zinc-700" 
              placeholder="••••" 
            />
            <button 
              onClick={handlePinSubmit}
              className="w-full h-16 bg-red-600 hover:bg-red-700 text-white font-black rounded-2xl transition-all shadow-xl shadow-red-600/20 active:scale-95 flex items-center justify-center gap-3"
            >
              인증 및 시작하기 <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 flex font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-72 bg-[#0f0f0f] border-r border-white/5 flex flex-col shrink-0 hidden lg:flex">
        <div className="p-8">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-600/20">
              <Youtube size={20} className="text-white" fill="white" />
            </div>
            <h1 className="text-lg font-black tracking-tighter italic">TUBE<span className="text-red-600">METRIC</span></h1>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1">
          <div className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] mb-4 ml-4">Analysis Setup</div>
          {[
            { id: 'channel-config', icon: <Users size={18} />, label: 'Channel Stats' },
            { id: 'video-config', icon: <MonitorPlay size={18} />, label: 'Single Video' },
            { id: 'ad-config', icon: <Megaphone size={18} />, label: 'Ad Intelligence' }
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as TabType)}
              className={`w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl font-bold transition-all group ${
                activeTab === item.id ? 'bg-red-600 text-white shadow-lg shadow-red-600/10' : 'text-zinc-500 hover:bg-white/5 hover:text-white'
              }`}
            >
              {item.icon}
              <span className="text-sm">{item.label}</span>
            </button>
          ))}

          <div className="h-px bg-white/5 my-6 mx-4"></div>
          <div className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] mb-4 ml-4">Monitoring</div>
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl font-bold transition-all group ${
              activeTab === 'dashboard' ? 'bg-zinc-100 text-black' : 'text-zinc-500 hover:bg-white/5 hover:text-white'
            }`}
          >
            <LayoutDashboard size={18} /> <span className="text-sm">Dashboard</span>
          </button>
        </nav>

        <div className="p-6">
          <div className="bg-[#161616] p-5 rounded-3xl border border-white/5 relative overflow-hidden group">
            <Activity className="text-red-500 mb-3" size={20} />
            <div className="text-[10px] font-bold text-zinc-500 uppercase">System Status</div>
            <div className="text-xs font-black text-white mt-1">API Connected</div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-y-auto bg-[#0a0a0a]">
        <header className="h-24 border-b border-white/5 px-8 flex items-center justify-between shrink-0 bg-[#0a0a0a]/80 backdrop-blur-xl sticky top-0 z-50">
          <div>
            <h2 className="text-xl font-black text-white">
              {activeTab === 'channel-config' && "Channel Analytics"}
              {activeTab === 'video-config' && "Single Video Insight"}
              {activeTab === 'ad-config' && "Ad Intelligence Engine"}
              {activeTab === 'dashboard' && "Performance Dashboard"}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
              <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Live Engine Active</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
             {isProcessing && <div className="flex items-center gap-3 px-5 py-2.5 bg-red-600/10 border border-red-600/20 rounded-full text-red-500 text-[10px] font-black animate-pulse"><Loader2 size={14} className="animate-spin" /> ANALYZING...</div>}
             <button onClick={() => { localStorage.removeItem('isAuthorized'); window.location.reload(); }} className="p-2.5 text-zinc-500 hover:text-red-500 transition-colors bg-white/5 rounded-xl"><Trash2 size={18}/></button>
          </div>
        </header>

        <div className="p-8 max-w-6xl mx-auto w-full">
          {activeTab === 'channel-config' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-7 space-y-4">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-2">UC-Codes Input</label>
                <textarea 
                  value={channelInput}
                  onChange={(e) => setChannelInput(e.target.value)}
                  placeholder="분석할 채널의 UC 코드를 한 줄씩 입력하세요..."
                  className="w-full h-80 bg-[#121212] border border-white/5 rounded-[32px] p-6 text-white text-sm focus:outline-none focus:border-red-600/50 transition-all font-mono leading-relaxed"
                />
              </div>
              <div className="lg:col-span-5 space-y-6">
                <div className="bg-[#0f0f0f] border border-white/5 rounded-[32px] p-8 space-y-6">
                  <div className="flex items-center gap-3 mb-2">
                    <Settings2 className="text-red-600" size={20} />
                    <h3 className="text-lg font-black">Filters</h3>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-5 bg-white/5 rounded-2xl border border-white/5">
                      <div className="flex items-center gap-3">
                        <Calendar className="text-zinc-500" size={18} />
                        <span className="text-xs font-bold">Date Limit</span>
                      </div>
                      <button onClick={() => setUseDateFilter(!useDateFilter)}>
                        {useDateFilter ? <ToggleRight className="text-red-600" size={36} /> : <ToggleLeft className="text-zinc-700" size={36} />}
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className={`p-5 rounded-2xl border ${useShorts ? 'bg-red-600/5 border-red-600/20' : 'bg-white/5 border-white/5'}`}>
                         <div className="flex justify-between items-center mb-3">
                            <Radio size={16} className={useShorts ? 'text-red-500' : 'text-zinc-600'} />
                            <button onClick={() => setUseShorts(!useShorts)}>{useShorts ? <CheckCircle2 size={18} className="text-red-600"/> : <Circle size={18} className="text-zinc-700"/>}</button>
                         </div>
                         <div className="text-[10px] font-black mb-2 uppercase text-zinc-500">Shorts Target</div>
                         <input type="number" value={targetShorts} onChange={(e) => setTargetShorts(e.target.value)} className="w-full bg-black/40 border-none rounded-lg p-2 text-xs font-black text-center" />
                      </div>
                      <div className={`p-5 rounded-2xl border ${useLongs ? 'bg-red-600/5 border-red-600/20' : 'bg-white/5 border-white/5'}`}>
                         <div className="flex justify-between items-center mb-3">
                            <Video size={16} className={useLongs ? 'text-red-500' : 'text-zinc-600'} />
                            <button onClick={() => setUseLongs(!useLongs)}>{useLongs ? <CheckCircle2 size={18} className="text-red-600"/> : <Circle size={18} className="text-zinc-700"/>}</button>
                         </div>
                         <div className="text-[10px] font-black mb-2 uppercase text-zinc-500">Long Target</div>
                         <input type="number" value={targetLong} onChange={(e) => setTargetLong(e.target.value)} className="w-full bg-black/40 border-none rounded-lg p-2 text-xs font-black text-center" />
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={handleChannelStart}
                    disabled={isProcessing}
                    className="w-full h-16 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-sm transition-all shadow-xl shadow-red-600/20 flex items-center justify-center gap-3 group"
                  >
                    {isProcessing ? <Loader2 size={20} className="animate-spin" /> : <Play size={18} fill="white" />}
                    분석 시작하기
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ad-config' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-7 space-y-4">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-2">Ad Target Channels</label>
                <textarea 
                  value={adChannelInput}
                  onChange={(e) => setAdChannelInput(e.target.value)}
                  placeholder="광고 영상을 탐지할 채널 목록..."
                  className="w-full h-80 bg-[#121212] border border-white/5 rounded-[32px] p-6 text-white text-sm focus:outline-none focus:border-red-600/50 transition-all font-mono leading-relaxed"
                />
              </div>
              <div className="lg:col-span-5 space-y-6">
                <div className="bg-[#0f0f0f] border border-white/5 rounded-[32px] p-8 space-y-6">
                  <div className="flex items-center gap-3 mb-2">
                    <ShieldCheck className="text-red-600" size={20} />
                    <h3 className="text-lg font-black">Ad Detection Setup</h3>
                  </div>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                       <div className="space-y-2">
                          <label className="text-[9px] font-black text-zinc-600 uppercase">Start Date</label>
                          <input type="date" value={adStartDate} onChange={(e) => setAdStartDate(e.target.value)} className="w-full bg-black border border-white/5 rounded-xl p-3 text-[11px] font-black text-white" />
                       </div>
                       <div className="space-y-2">
                          <label className="text-[9px] font-black text-zinc-600 uppercase">End Date</label>
                          <input type="date" value={adEndDate} onChange={(e) => setAdEndDate(e.target.value)} className="w-full bg-black border border-white/5 rounded-xl p-3 text-[11px] font-black text-white" />
                       </div>
                    </div>
                    <div className="p-5 bg-red-600/5 border border-red-600/10 rounded-2xl">
                       <div className="flex items-center gap-2 text-red-500 font-black text-[10px] uppercase mb-2"><Zap size={14}/> Intelligent Scanning</div>
                       <p className="text-[10px] text-zinc-500 leading-relaxed font-medium">단순 키워드를 넘어 유튜브 플레이어의 내부 런타임 데이터를 분석하여 '유료 광고 포함' 플래그를 실시간으로 탐지합니다.</p>
                    </div>
                  </div>
                  <button 
                    onClick={handleAdStart}
                    disabled={isProcessing}
                    className="w-full h-16 bg-white hover:bg-zinc-200 text-black rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-3"
                  >
                    {isProcessing ? <Loader2 size={20} className="animate-spin text-black" /> : <Megaphone size={18} />}
                    탐지 엔진 가동
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <div className="space-y-8">
               <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex gap-2 p-1 bg-[#121212] rounded-2xl border border-white/5">
                     {[
                       { id: 'channel', icon: <Users size={14}/>, label: 'Channels' },
                       { id: 'video', icon: <MonitorPlay size={14}/>, label: 'Videos' },
                       { id: 'ad', icon: <Megaphone size={14}/>, label: 'Ads' }
                     ].map(t => (
                       <button 
                        key={t.id} 
                        onClick={() => setDashboardSubTab(t.id as any)}
                        className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 transition-all ${dashboardSubTab === t.id ? 'bg-red-600 text-white shadow-lg shadow-red-600/10' : 'text-zinc-600 hover:text-white'}`}
                       >
                         {t.icon} {t.label}
                       </button>
                     ))}
                  </div>
                  {dashboardSubTab === 'channel' && channelResults.length > 0 && (
                    <button onClick={handleDownloadExcel} className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600/10 border border-emerald-600/20 text-emerald-500 rounded-xl text-[10px] font-black hover:bg-emerald-600 hover:text-white transition-all">
                      <FileSpreadsheet size={14}/> EXCEL DOWNLOAD
                    </button>
                  )}
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {dashboardSubTab === 'ad' && adResults.map((r, i) => (
                    <div key={i} onClick={() => setSelectedAdResult(r)} className="bg-[#121212] p-6 rounded-[32px] border border-white/5 hover:border-red-600/30 transition-all cursor-pointer group">
                       <div className="flex items-center gap-4 mb-4">
                          <img src={r.thumbnail} className="w-12 h-12 rounded-xl object-cover" alt="" />
                          <div className="min-w-0">
                             <div className="text-xs font-black text-white truncate">{r.channelName}</div>
                             <div className="text-[9px] font-black text-red-500 bg-red-500/10 px-2 py-0.5 rounded-lg inline-block mt-1">{r.totalAdCount} ADS FOUND</div>
                          </div>
                       </div>
                       <div className="space-y-2">
                          <div className="flex justify-between text-[10px]">
                             <span className="text-zinc-600 font-bold uppercase">Average Ad View</span>
                             <span className="text-white font-black">{formatNumber(r.avgViews)}</span>
                          </div>
                          <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                             <div className="h-full bg-red-600" style={{ width: '65%' }}></div>
                          </div>
                       </div>
                    </div>
                  ))}

                  {dashboardSubTab === 'channel' && channelResults.map((c, i) => (
                    <div key={i} onClick={() => setSelectedChannel(c)} className="bg-[#121212] p-6 rounded-[32px] border border-white/5 hover:border-red-600/30 transition-all cursor-pointer group">
                       <div className="flex items-center gap-5 mb-6">
                          <img src={c.thumbnail} className="w-14 h-14 rounded-2xl border border-white/10 object-cover" alt="" />
                          <div>
                             <h4 className="text-base font-black text-white group-hover:text-red-500 transition-colors">{c.channelName}</h4>
                             <div className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mt-0.5">{formatNumber(Number(c.subscriberCount))} Subs</div>
                          </div>
                       </div>
                       <div className="grid grid-cols-3 gap-3">
                          <div className="bg-black/40 p-4 rounded-2xl border border-white/5 text-center">
                             <div className="text-[8px] font-black text-zinc-600 uppercase mb-1">Shorts</div>
                             <div className="text-sm font-black text-red-500">{formatNumber(c.avgShortsViews)}</div>
                          </div>
                          <div className="bg-black/40 p-4 rounded-2xl border border-white/5 text-center">
                             <div className="text-[8px] font-black text-zinc-600 uppercase mb-1">Longs</div>
                             <div className="text-sm font-black text-zinc-300">{formatNumber(c.avgLongViews)}</div>
                          </div>
                          <div className="bg-black/40 p-4 rounded-2xl border border-white/5 text-center">
                             <div className="text-[8px] font-black text-zinc-600 uppercase mb-1">Found</div>
                             <div className="text-sm font-black text-zinc-500">{c.totalCountFound}</div>
                          </div>
                       </div>
                    </div>
                  ))}
               </div>
            </div>
          )}
        </div>

        {/* Intelligence Panel Modal */}
        {selectedAdResult && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/95 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-[#111111] w-full max-w-5xl h-[85vh] rounded-[40px] border border-white/10 overflow-hidden flex flex-col shadow-2xl">
              <div className="p-8 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-5">
                  <img src={selectedAdResult.thumbnail} className="w-14 h-14 rounded-2xl object-cover" alt="" />
                  <div>
                    <h3 className="text-xl font-black text-white">{selectedAdResult.channelName}</h3>
                    <div className="text-[10px] font-black text-red-500 uppercase tracking-widest mt-1">
                      <ShieldCheck size={12} className="inline mr-1" /> Intelligent Trace: Active
                    </div>
                  </div>
                </div>
                <button onClick={() => setSelectedAdResult(null)} className="p-3 bg-white/5 hover:bg-red-600 text-white rounded-2xl transition-all"><X size={20}/></button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8 bg-[#0d0d0d]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {selectedAdResult.adVideos.map((v) => (
                    <div key={v.id} className="bg-[#181818] p-6 rounded-[32px] border border-white/5 group hover:border-red-600/20 transition-all">
                      <div className="flex gap-6">
                        <div className="relative shrink-0">
                          <img src={v.thumbnail} className={`rounded-xl object-cover shadow-lg ${v.isShort ? 'w-20 h-32' : 'w-32 h-20'}`} alt="" />
                          <div className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[10px] font-black px-2 py-0.5 rounded-lg">{(v.detection.confidence * 100).toFixed(0)}%</div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-black text-white line-clamp-2 leading-tight group-hover:text-red-500 transition-colors">{v.title}</div>
                          <div className="flex items-center gap-3 mt-3">
                            <span className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-500 uppercase"><Eye size={12}/> {v.viewCount.toLocaleString()}</span>
                          </div>

                          {/* Intelligence Signals */}
                          <div className="mt-5 space-y-2">
                             <div className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1 ml-1">Detection Trace</div>
                             {v.detection.signals.slice(0, 3).map((sig, idx) => (
                               <div key={idx} className="flex items-center justify-between bg-black/40 px-3 py-2.5 rounded-xl border border-white/5">
                                 <div className="flex items-center gap-3 overflow-hidden">
                                   <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${sig.type === 'Direct' ? 'bg-red-600 animate-pulse' : 'bg-zinc-500'}`}></div>
                                   <div className="text-[10px] font-bold text-zinc-300 truncate">{sig.note}</div>
                                 </div>
                                 <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-lg border border-white/5">
                                   {getSourceIcon(sig.source)}
                                   <span className="text-[8px] font-black text-zinc-500 uppercase">{getSourceLabel(sig.source)}</span>
                                 </div>
                               </div>
                             ))}
                          </div>
                        </div>
                      </div>
                      <div className="mt-6 pt-5 border-t border-white/5 flex items-center justify-between">
                         <div className="text-[10px] font-black text-zinc-700 uppercase italic">Video Hash: {v.id}</div>
                         <a href={v.isShort ? `https://youtube.com/shorts/${v.id}` : `https://youtu.be/${v.id}`} target="_blank" rel="noopener noreferrer" className="p-3 bg-white/5 hover:bg-red-600 text-white rounded-xl transition-all">
                           <ExternalLink size={18} />
                         </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
