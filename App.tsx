
import React, { useState } from 'react';
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
  History,
  TrendingUp,
  Info,
  Video,
  MonitorPlay,
  X,
  Eye,
  FileSpreadsheet,
  Users,
  Radio,
  Settings2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { getChannelInfo, fetchChannelStats, fetchVideosByIds, AnalysisPeriod } from './services/youtubeService';
import { ChannelResult, VideoResult, VideoDetail } from './types';

type TabType = 'channel-config' | 'video-config' | 'dashboard';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('channel-config');
  const [dashboardSubTab, setDashboardSubTab] = useState<'channel' | 'video'>('channel');
  
  // Channel Analysis States
  const [channelInput, setChannelInput] = useState<string>('');
  const [targetShorts, setTargetShorts] = useState<number | string>(30);
  const [targetLong, setTargetLong] = useState<number | string>(10);
  const [period, setPeriod] = useState<AnalysisPeriod>('all');
  const [channelResults, setChannelResults] = useState<ChannelResult[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<ChannelResult | null>(null);
  
  // Individual Video States
  const [videoInput, setVideoInput] = useState<string>('');
  const [videoResults, setVideoResults] = useState<VideoResult[]>([]);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const formatNumber = (num: number | string) => {
    const n = typeof num === 'string' ? parseInt(num, 10) : num;
    if (isNaN(n)) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
  };

  const extractVideoId = (input: string) => {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = input.match(regex);
    return match ? match[1] : input.trim();
  };

  const handleChannelStart = async () => {
    const ucCodes = channelInput
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (ucCodes.length === 0) {
      alert('분석할 UC 코드를 입력해주세요.');
      return;
    }

    const shortsVal = typeof targetShorts === 'string' ? parseInt(targetShorts, 10) || 1 : targetShorts;
    const longsVal = typeof targetLong === 'string' ? parseInt(targetLong, 10) || 1 : targetLong;

    setIsProcessing(true);
    setActiveTab('dashboard');
    setDashboardSubTab('channel');
    setChannelResults(
      ucCodes.map((code) => ({
        channelId: code,
        channelName: '데이터 확인 중...',
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
      }))
    );

    for (let i = 0; i < ucCodes.length; i++) {
      const code = ucCodes[i];
      setChannelResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'processing' } : r));
      try {
        const info = await getChannelInfo(code);
        const stats = await fetchChannelStats(info.uploadsPlaylistId, shortsVal, longsVal, period);
        setChannelResults(prev => prev.map((r, idx) => idx === i ? { 
          ...r, 
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
      videoId: id, title: '데이터 로드 중...', channelTitle: '', thumbnail: '', viewCount: 0, duration: '', isShort: false, status: 'processing'
    })));

    try {
      const chunkSize = 40;
      for (let i = 0; i < videoIds.length; i += chunkSize) {
        const chunk = videoIds.slice(i, i + chunkSize);
        const fetched = await fetchVideosByIds(chunk);
        
        setVideoResults(prev => prev.map(p => {
          const match = fetched.find(f => f.videoId === p.videoId);
          return match ? match : (p.status === 'processing' ? { ...p, status: 'error', error: '영상을 찾을 수 없음' } : p);
        }));
      }
    } catch (err: any) {
      alert('영상 정보를 가져오는 중 오류가 발생했습니다.');
    }
    setIsProcessing(false);
  };

  const handleDownloadExcel = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    
    if (dashboardSubTab === 'channel') {
      const wb = XLSX.utils.book_new();

      // 1. Summary Sheet
      const summaryData = channelResults.map((r) => ({
        '채널 ID': r.channelId,
        '채널명': r.channelName,
        '구독자 수': parseInt(r.subscriberCount, 10),
        '분석 기간': periodLabels[period],
        '쇼츠 평균 조회수': r.avgShortsViews,
        '쇼츠 수집수': r.shortsCountFound,
        '롱폼 평균 조회수': r.avgLongViews,
        '롱폼 수집수': r.longCountFound,
        '상태': r.status === 'completed' ? '완료' : r.status === 'error' ? `오류(${r.error})` : '대기',
      }));
      const wsSummary = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, wsSummary, '종합 요약');

      // 2. Individual Channel Detail Sheets
      channelResults.filter(r => r.status === 'completed').forEach(r => {
        const detailData = [
          ...r.shortsList.map(v => ({
            '유형': '쇼츠',
            '영상 제목': v.title,
            '조회수': v.viewCount,
            '업로드일': new Date(v.publishedAt).toLocaleDateString(),
            'URL': `https://youtube.com/shorts/${v.id}`
          })),
          ...r.longsList.map(v => ({
            '유형': '롱폼',
            '영상 제목': v.title,
            '조회수': v.viewCount,
            '업로드일': new Date(v.publishedAt).toLocaleDateString(),
            'URL': `https://youtube.com/watch?v=${v.id}`
          })),
          ...r.liveList.map(v => ({
            '유형': '라이브 스트림',
            '영상 제목': v.title,
            '조회수': v.viewCount,
            '업로드일': new Date(v.publishedAt).toLocaleDateString(),
            'URL': `https://youtube.com/watch?v=${v.id}`
          }))
        ];

        if (detailData.length > 0) {
          const wsDetail = XLSX.utils.json_to_sheet(detailData);
          const safeName = r.channelName.replace(/[\\/*?:\[\]]/g, '').substring(0, 31) || r.channelId.substring(0, 31);
          XLSX.utils.book_append_sheet(wb, wsDetail, safeName);
        }
      });

      XLSX.writeFile(wb, `Parable_Channel_Report_${timestamp}.xlsx`);
    } else {
      const data = videoResults.map((r) => ({
        '영상 ID': r.videoId,
        '영상 제목': r.title,
        '채널명': r.channelTitle,
        '유형': r.isShort ? '쇼츠' : '롱폼',
        '조회수': r.viewCount,
        '상태': r.status === 'completed' ? '완료' : '오류',
        'URL': `https://youtu.be/${r.videoId}`
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '영상 리포트');
      XLSX.writeFile(wb, `Parable_Video_Report_${timestamp}.xlsx`);
    }
  };

  const periodLabels: Record<AnalysisPeriod, string> = {
    '7d': '최근 7일',
    '30d': '최근 30일',
    'all': '전체 기간'
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white flex font-sans overflow-hidden relative selection:bg-red-500/30">
      {/* Modal: Channel Details */}
      {selectedChannel && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-[#161616] w-full max-w-5xl h-[90vh] rounded-[32px] border border-white/10 overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="p-6 md:p-8 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-red-600/10 to-transparent">
              <div className="flex items-center gap-5">
                <img src={selectedChannel.thumbnail} className="w-14 h-14 rounded-2xl border-2 border-red-600 shadow-lg" alt="" />
                <div>
                  <h3 className="text-xl md:text-2xl font-black text-white flex items-center gap-2">
                    {selectedChannel.channelName}
                    <a href={`https://youtube.com/channel/${selectedChannel.channelId}`} target="_blank" className="text-zinc-500 hover:text-white transition-colors"><ExternalLink size={18} /></a>
                  </h3>
                  <div className="flex items-center gap-3 mt-1">
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">상세 수집 내역 • {periodLabels[period]}</p>
                    <span className="flex items-center gap-1 text-[10px] font-black text-red-500 border border-red-500/20 px-2 py-0.5 rounded-full">
                      <Users size={10} /> {formatNumber(selectedChannel.subscriberCount)} 구독자
                    </span>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedChannel(null)} className="p-2.5 bg-white/5 hover:bg-red-600 text-white rounded-xl transition-all">
                <X size={20} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-12">
              {/* Live Streams Section */}
              {selectedChannel.liveList.length > 0 && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between px-1">
                    <h4 className="text-sm font-black text-white flex items-center gap-2 uppercase tracking-tighter">
                      <Radio size={16} className="text-red-600 animate-pulse" />
                      최근 라이브 스트림 ({selectedChannel.liveList.length})
                    </h4>
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">공개 데이터 기준</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedChannel.liveList.map((v) => (
                      <div key={v.id} className="bg-red-600/5 p-4 rounded-2xl border border-red-600/10 flex items-center gap-4 hover:border-red-600/30 transition-all group">
                        <div className="relative shrink-0">
                          <img src={v.thumbnail} className="w-20 h-12 rounded-lg object-cover" alt="" />
                          <div className="absolute top-1 right-1 bg-red-600 text-[8px] font-black px-1 rounded">LIVE</div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-bold text-white truncate group-hover:text-red-400 transition-colors">{v.title}</div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-[9px] text-zinc-400 font-bold uppercase">{new Date(v.publishedAt).toLocaleDateString()}</span>
                            <span className="text-[9px] text-red-500 font-black uppercase">조회수: {v.viewCount.toLocaleString()}</span>
                            {v.concurrentViewers && (
                              <span className="text-[9px] text-emerald-500 font-black uppercase flex items-center gap-1">
                                <Users size={10} /> {v.concurrentViewers.toLocaleString()} 명 시청 중
                              </span>
                            )}
                          </div>
                        </div>
                        <a href={`https://youtube.com/watch?v=${v.id}`} target="_blank" className="p-2 text-zinc-600 hover:text-white transition-colors">
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                {/* Shorts List */}
                <div className="space-y-6">
                  <div className="flex items-center justify-between px-1">
                    <h4 className="text-sm font-black text-white flex items-center gap-2 uppercase tracking-tighter">
                      <div className="w-1.5 h-4 bg-red-600 rounded-full"></div>
                      쇼츠 ({selectedChannel.shortsList.length})
                    </h4>
                    <span className="text-[11px] font-bold text-red-500">평균 {selectedChannel.avgShortsViews.toLocaleString()}회</span>
                  </div>
                  <div className="space-y-2.5">
                    {selectedChannel.shortsList.map((v) => (
                      <div key={v.id} className="bg-white/5 p-3.5 rounded-2xl border border-white/5 flex items-center gap-4 hover:border-red-600/50 transition-all group">
                        <img src={v.thumbnail} className="w-12 h-12 rounded-lg object-cover" alt="" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-bold text-white truncate leading-snug group-hover:text-red-400 transition-colors">{v.title}</div>
                          <div className="text-[10px] text-zinc-500 font-bold mt-1 uppercase tracking-tighter">
                            {new Date(v.publishedAt).toLocaleDateString()} • {v.viewCount.toLocaleString()} 조회
                          </div>
                        </div>
                        <a href={`https://youtube.com/shorts/${v.id}`} target="_blank" className="p-2 text-zinc-600 hover:text-white transition-colors">
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    ))}
                    {selectedChannel.shortsList.length === 0 && (
                      <div className="py-12 text-center text-zinc-700 text-xs font-bold border border-dashed border-white/5 rounded-2xl">데이터가 없습니다.</div>
                    )}
                  </div>
                </div>

                {/* Longform List */}
                <div className="space-y-6">
                  <div className="flex items-center justify-between px-1">
                    <h4 className="text-sm font-black text-white flex items-center gap-2 uppercase tracking-tighter">
                      <div className="w-1.5 h-4 bg-white rounded-full"></div>
                      롱폼 ({selectedChannel.longsList.length})
                    </h4>
                    <span className="text-[11px] font-bold text-zinc-400">평균 {selectedChannel.avgLongViews.toLocaleString()}회</span>
                  </div>
                  <div className="space-y-2.5">
                    {selectedChannel.longsList.map((v) => (
                      <div key={v.id} className="bg-white/5 p-3.5 rounded-2xl border border-white/5 flex items-center gap-4 hover:border-white/30 transition-all group">
                        <img src={v.thumbnail} className="w-16 h-10 rounded-lg object-cover" alt="" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-bold text-white truncate leading-snug">{v.title}</div>
                          <div className="text-[10px] text-zinc-500 font-bold mt-1 uppercase tracking-tighter">
                            {new Date(v.publishedAt).toLocaleDateString()} • {v.viewCount.toLocaleString()} 조회
                          </div>
                        </div>
                        <a href={`https://youtube.com/watch?v=${v.id}`} target="_blank" className="p-2 text-zinc-600 hover:text-white transition-colors">
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    ))}
                    {selectedChannel.longsList.length === 0 && (
                      <div className="py-12 text-center text-zinc-700 text-xs font-bold border border-dashed border-white/5 rounded-2xl">데이터가 없습니다.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className="w-72 bg-[#121212] border-r border-white/5 flex flex-col shrink-0 hidden lg:flex">
        <div className="p-8">
          <div className="flex items-center gap-3 mb-10">
            <div className="bg-red-600 p-2 rounded-xl shadow-lg shadow-red-600/20">
              <Youtube className="text-white w-6 h-6" />
            </div>
            <h1 className="text-lg font-black tracking-tighter italic uppercase">
              Parable<br />
              <span className="text-red-600">TubeMetric</span>
            </h1>
          </div>

          <nav className="space-y-2">
            {[
              { id: 'channel-config', label: '채널 통합 분석', icon: TrendingUp },
              { id: 'video-config', label: '영상 개별 분석', icon: Video },
              { id: 'dashboard', label: '대시보드', icon: LayoutDashboard },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as TabType)}
                className={`w-full flex items-center gap-3.5 px-5 py-4 rounded-2xl text-[13px] font-bold transition-all duration-300 ${
                  activeTab === item.id 
                    ? 'bg-red-600 text-white shadow-xl shadow-red-600/20' 
                    : 'text-zinc-500 hover:bg-white/5 hover:text-white'
                }`}
              >
                <item.icon size={18} />
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-auto p-6">
          <div className="bg-white/5 p-5 rounded-2xl border border-white/5">
            <div className="flex items-center gap-2 text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2">
              <Info size={12} className="text-red-600" />
              데이터 분석 안내
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed font-medium">
              공개 API 특성상 과거 라이브의 피크 시청자 수집에는 제한이 있을 수 있으나, 아카이브 영상의 성과와 현재 실시간 데이터는 정상적으로 분석됩니다.
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-y-auto bg-[#0f0f0f]">
        <div className="p-6 md:p-12 max-w-7xl w-full mx-auto">
          {activeTab === 'channel-config' ? (
            <div className="space-y-12 animate-in fade-in slide-in-from-bottom-6 duration-700">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <TrendingUp className="text-red-600" size={24} />
                  <h2 className="text-3xl md:text-4xl font-black tracking-tight uppercase italic">채널 ID 입력</h2>
                </div>
                <p className="text-zinc-500 text-sm font-medium">분석할 채널의 UC 코드를 대량으로 입력하고 한 번에 조회하세요.</p>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-stretch">
                {/* Left Panel: UC Code Input */}
                <div className="flex flex-col space-y-4 h-full">
                  <div className="flex items-center justify-between px-2">
                    <label className="text-[11px] font-black text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2">
                      <List size={14} className="text-red-600" /> 유튜브 채널 UC 코드 목록
                    </label>
                    <button
                      onClick={() => setChannelInput('')}
                      className="flex items-center gap-2 text-[10px] font-black text-zinc-600 hover:text-red-500 transition-colors uppercase"
                    >
                      <Trash2 size={12} /> 입력창 비우기
                    </button>
                  </div>
                  <div className="flex-1 min-h-[450px] bg-[#161616] p-1 border border-white/10 rounded-[32px] shadow-2xl relative group overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-focus-within:opacity-30 transition-opacity">
                      <Youtube size={120} />
                    </div>
                    <textarea
                      value={channelInput}
                      onChange={(e) => setChannelInput(e.target.value)}
                      placeholder="UC-xxxxxxxxxxxx&#10;UC-yyyyyyyyyyyy&#10;UC-zzzzzzzzzzzz"
                      className="w-full h-full p-8 bg-transparent text-sm font-mono leading-relaxed text-zinc-200 placeholder:text-zinc-700 focus:outline-none resize-none relative z-10"
                    />
                  </div>
                </div>

                {/* Right Panel: Settings & Start */}
                <div className="flex flex-col space-y-4 h-full">
                   <div className="px-2">
                    <label className="text-[11px] font-black text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2">
                      <Settings2 size={14} className="text-red-600" /> 상세 분석 설정
                    </label>
                  </div>
                  <div className="flex-1 bg-[#161616] p-8 md:p-10 rounded-[32px] border border-white/10 shadow-2xl flex flex-col justify-between space-y-10">
                    <div className="space-y-10">
                      {/* Period Filter */}
                      <div className="space-y-4">
                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                          <Calendar size={14} className="text-red-600" /> 분석 대상 기간
                        </label>
                        <div className="grid grid-cols-3 gap-3 p-1.5 bg-black/40 rounded-2xl border border-white/5">
                          {(['all', '30d', '7d'] as AnalysisPeriod[]).map((p) => (
                            <button
                              key={p}
                              onClick={() => setPeriod(p)}
                              className={`py-3 text-[11px] font-black rounded-xl transition-all ${
                                period === p 
                                  ? 'bg-white text-black shadow-lg shadow-white/10 scale-[1.02]' 
                                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                              }`}
                            >
                              {periodLabels[p]}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Collection Targets */}
                      <div className="space-y-6">
                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                          <Radio size={14} className="text-red-600" /> 데이터 수집 목표량
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                          <div className="space-y-4">
                            <div className="flex justify-between items-center px-1">
                              <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-tighter">쇼츠 (최대 500)</span>
                              <input 
                                type="number" 
                                value={targetShorts}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === '') {
                                    setTargetShorts('');
                                  } else {
                                    setTargetShorts(Math.min(500, Math.max(1, Number(val))));
                                  }
                                }}
                                onBlur={() => {
                                  if (targetShorts === '' || targetShorts === 0) setTargetShorts(1);
                                }}
                                className="w-16 p-1 bg-black/40 border border-white/10 rounded text-right text-[12px] font-black text-red-600 focus:border-red-600 outline-none transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                            </div>
                            <input 
                              type="range" min="1" max="100"
                              value={Number(targetShorts) || 1}
                              onChange={(e) => setTargetShorts(Number(e.target.value))}
                              className="w-full h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer accent-red-600"
                            />
                          </div>
                          <div className="space-y-4">
                            <div className="flex justify-between items-center px-1">
                              <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-tighter">롱폼 (최대 200)</span>
                              <input 
                                type="number" 
                                value={targetLong}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === '') {
                                    setTargetLong('');
                                  } else {
                                    setTargetLong(Math.min(200, Math.max(1, Number(val))));
                                  }
                                }}
                                onBlur={() => {
                                  if (targetLong === '' || targetLong === 0) setTargetLong(1);
                                }}
                                className="w-16 p-1 bg-black/40 border border-white/10 rounded text-right text-[12px] font-black text-white focus:border-white outline-none transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                            </div>
                            <input 
                              type="range" min="1" max="50"
                              value={Number(targetLong) || 1}
                              onChange={(e) => setTargetLong(Number(e.target.value))}
                              className="w-full h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer accent-white"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Start Button */}
                    <button
                      onClick={handleChannelStart}
                      disabled={isProcessing || !channelInput.trim()}
                      className="w-full bg-white hover:bg-red-600 hover:text-white disabled:bg-zinc-800 disabled:text-zinc-600 text-black py-6 rounded-[24px] font-black text-base flex items-center justify-center gap-3 transition-all transform active:scale-[0.98] shadow-2xl shadow-white/5 group"
                    >
                      {isProcessing ? (
                        <Loader2 className="animate-spin" size={24} />
                      ) : (
                        <Play fill="currentColor" size={18} className="group-hover:translate-x-1 transition-transform" />
                      )}
                      {isProcessing ? '데이터 수집 분석 중...' : '통합 성과 분석 시작'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab === 'video-config' ? (
            <div className="max-w-3xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
              <div className="space-y-2">
                <h2 className="text-3xl md:text-4xl font-black tracking-tight uppercase italic">개별 영상 분석</h2>
                <p className="text-zinc-500 text-sm font-medium">조회하고자 하는 영상의 URL을 입력하여 세부 성과를 일괄 확인합니다.</p>
              </div>

              <div className="bg-[#161616] p-8 md:p-10 rounded-[40px] border border-white/10 space-y-8 shadow-2xl">
                <textarea
                  value={videoInput}
                  onChange={(e) => setVideoInput(e.target.value)}
                  placeholder="https://youtube.com/watch?v=...&#10;https://youtu.be/..."
                  className="w-full h-80 p-8 bg-black/40 border border-white/5 rounded-3xl text-sm font-mono leading-relaxed text-zinc-200 placeholder:text-zinc-700 focus:border-red-600/50 outline-none resize-none transition-all"
                />

                <button
                  onClick={handleVideoStart}
                  disabled={isProcessing || !videoInput.trim()}
                  className="w-full bg-white hover:bg-red-600 hover:text-white disabled:bg-zinc-800 disabled:text-zinc-600 text-black py-6 rounded-3xl font-black text-lg flex items-center justify-center gap-3 transition-all transform active:scale-[0.98] shadow-xl"
                >
                  {isProcessing ? <Loader2 className="animate-spin" /> : <MonitorPlay size={24} />}
                  영상 데이터 일괄 수집
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-10 animate-in fade-in slide-in-from-right-6 duration-700">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-5">
                  <h2 className="text-3xl md:text-5xl font-black tracking-tighter italic uppercase leading-none">
                    인사이트 <span className="text-red-600">리포트</span>
                  </h2>
                  <div className="flex bg-[#161616] p-1 rounded-xl border border-white/5 w-fit">
                    <button 
                      onClick={() => setDashboardSubTab('channel')}
                      className={`px-6 py-2 rounded-lg text-[11px] font-black transition-all ${dashboardSubTab === 'channel' ? 'bg-red-600 text-white shadow-lg shadow-red-600/20' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                      채널 성과 분석
                    </button>
                    <button 
                      onClick={() => setDashboardSubTab('video')}
                      className={`px-6 py-2 rounded-lg text-[11px] font-black transition-all ${dashboardSubTab === 'video' ? 'bg-red-600 text-white shadow-lg shadow-red-600/20' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                      영상 개별 리포트
                    </button>
                  </div>
                </div>
                <button
                  onClick={handleDownloadExcel}
                  className="flex items-center justify-center gap-3 bg-white hover:bg-zinc-200 disabled:opacity-20 text-black px-8 py-4 rounded-2xl font-black transition-all shadow-xl active:scale-95 text-sm"
                >
                  <FileSpreadsheet size={18} />
                  상세 엑셀 리포트 다운로드
                </button>
              </div>

              <div className="bg-[#161616] rounded-[32px] border border-white/5 overflow-hidden shadow-2xl">
                <div className="overflow-x-auto">
                  {dashboardSubTab === 'channel' ? (
                    <table className="w-full text-left border-collapse min-w-[900px]">
                      <thead className="bg-white/5 text-zinc-500 text-[10px] uppercase tracking-[0.2em] font-black border-b border-white/5">
                        <tr>
                          <th className="px-8 py-5">분석 채널</th>
                          <th className="px-8 py-5 text-center">구독자 수</th>
                          <th className="px-8 py-5 text-right">쇼츠 평균</th>
                          <th className="px-8 py-5 text-right">롱폼 평균</th>
                          <th className="px-8 py-5 text-center">작업</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {channelResults.length === 0 ? (
                          <tr><td colSpan={5} className="px-8 py-40 text-center text-zinc-700 font-bold text-sm tracking-tight italic">수집된 데이터가 없습니다. 분석을 먼저 시작해주세요.</td></tr>
                        ) : (
                          channelResults.map((r, i) => (
                            <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                              <td className="px-8 py-6">
                                <div className="flex items-center gap-5">
                                  {r.thumbnail ? (
                                    <img src={r.thumbnail} className="w-12 h-12 rounded-xl border border-white/5" />
                                  ) : (
                                    <div className="w-12 h-12 bg-zinc-800 rounded-xl flex items-center justify-center"><Youtube size={20} className="text-zinc-600" /></div>
                                  )}
                                  <div className="min-w-0">
                                    <div className="font-black text-[15px] text-white truncate group-hover:text-red-500 transition-colors leading-tight">{r.channelName}</div>
                                    <div className="text-[9px] text-zinc-600 mt-0.5 font-mono tracking-tighter truncate uppercase">{r.channelId}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-8 py-6 text-center">
                                <div className="flex items-center justify-center gap-2">
                                  <span className={`text-[12px] font-black ${r.status === 'completed' ? 'text-zinc-200' : 'text-zinc-600'}`}>
                                    {r.status === 'completed' ? formatNumber(r.subscriberCount) : '확인 중...'}
                                  </span>
                                  {r.status === 'completed' && <Users size={12} className="text-red-600" />}
                                </div>
                              </td>
                              <td className="px-8 py-6 text-right">
                                <div className="font-black text-lg text-zinc-100">{r.avgShortsViews.toLocaleString()}</div>
                                <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-tighter">{r.shortsCountFound}개 표본 기반</div>
                              </td>
                              <td className="px-8 py-6 text-right">
                                <div className="font-black text-lg text-zinc-100">{r.avgLongViews.toLocaleString()}</div>
                                <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-tighter">{r.longCountFound}개 표본 기반</div>
                              </td>
                              <td className="px-8 py-6 text-center">
                                <button 
                                  disabled={r.status !== 'completed'}
                                  onClick={() => setSelectedChannel(r)}
                                  className="p-3 bg-white/5 hover:bg-red-600 text-zinc-500 hover:text-white rounded-xl transition-all disabled:opacity-5 group-hover:scale-110 active:scale-95"
                                >
                                  <Eye size={18} />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <table className="w-full text-left border-collapse min-w-[800px]">
                      <thead className="bg-white/5 text-zinc-500 text-[10px] uppercase tracking-[0.2em] font-black border-b border-white/5">
                        <tr>
                          <th className="px-8 py-5">영상 정보</th>
                          <th className="px-8 py-5">유형</th>
                          <th className="px-8 py-5 text-right">조회수</th>
                          <th className="px-8 py-5 text-center">이동</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {videoResults.length === 0 ? (
                          <tr><td colSpan={4} className="px-8 py-40 text-center text-zinc-700 font-bold text-sm tracking-tight italic">데이터 로드가 필요합니다.</td></tr>
                        ) : (
                          videoResults.map((v, i) => (
                            <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                              <td className="px-8 py-6">
                                <div className="flex items-center gap-5">
                                  {v.thumbnail ? <img src={v.thumbnail} className="w-20 h-12 object-cover rounded-lg shadow-lg" /> : <div className="w-20 h-12 bg-zinc-800 rounded-lg" />}
                                  <div className="max-w-md">
                                    <div className="font-bold text-[14px] text-white truncate leading-tight">{v.title}</div>
                                    <div className="text-[10px] text-zinc-600 mt-1 font-bold uppercase tracking-tight">{v.channelTitle}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-8 py-6">
                                <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase ${
                                  v.isShort ? 'bg-red-600/20 text-red-500 border border-red-600/10' : 'bg-white/10 text-zinc-400 border border-white/5'
                                }`}>
                                  {v.isShort ? '쇼츠' : '롱폼'}
                                </span>
                              </td>
                              <td className="px-8 py-6 text-right font-black text-lg">{v.viewCount.toLocaleString()}</td>
                              <td className="px-8 py-6 text-center">
                                <a href={`https://youtu.be/${v.videoId}`} target="_blank" className="p-3 bg-white/5 text-zinc-600 hover:text-white rounded-xl inline-flex transition-colors">
                                  <ExternalLink size={16} />
                                </a>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="mt-auto py-8 px-12 bg-[#0a0a0a] border-t border-white/5 text-zinc-800 text-[9px] font-black tracking-[0.4em] uppercase flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <Radio size={12} className="text-red-600" />
            Parable TubeMetric Suite v2.0
          </div>
          <div className="flex gap-10">
            <span className="hover:text-zinc-400 cursor-pointer transition-colors">운영 정책</span>
            <span className="hover:text-zinc-400 cursor-pointer transition-colors">이용 약관</span>
          </div>
        </footer>
      </main>
    </div>
  );
};

export default App;
