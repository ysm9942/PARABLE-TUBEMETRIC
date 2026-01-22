
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

  // 브라우저에서 process.env 에러 방지를 위한 마운트 확인 (선택 사항)
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

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
    
    const initialResults: ChannelResult[] = ucCodes.map((code) => ({
      channelId: code,
      channelName: '검색 중...',
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
          }))
        ];

        if (detailData.length > 0) {
          const wsDetail = XLSX.utils.json_to_sheet(detailData);
          const safeName = r.channelName.replace(/[\\/*?:\[\]]/g, '').substring(0, 31) || r.channelId.substring(0, 31);
          XLSX.utils.book_append_sheet(wb, wsDetail, safeName);
        }
      });

      XLSX.writeFile(wb, `TubeMetric_Channel_Report_${timestamp}.xlsx`);
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
      XLSX.writeFile(wb, `TubeMetric_Video_Report_${timestamp}.xlsx`);
    }
  };

  const periodLabels: Record<AnalysisPeriod, string> = {
    '7d': '최근 7일',
    '30d': '최근 30일',
    'all': '전체 기간'
  };

  if (!isMounted) return null;

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white flex font-sans overflow-hidden relative selection:bg-red-500/30">
      {/* Modal: Channel Details */}
      {selectedChannel && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-[#161616] w-full max-w-5xl h-[90vh] rounded-[32px] border border-white/10 overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="p-6 md:p-8 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-red-600/10 to-transparent">
              <div className="flex items-center gap-5">
                <img src={selectedChannel.thumbnail} className="w-14 h-14 rounded-2xl border-2 border-red-600 shadow-lg object-cover" alt="" />
                <div>
                  <h3 className="text-xl md:text-2xl font-black text-white flex items-center gap-2">
                    {selectedChannel.channelName}
                    <a href={`https://youtube.com/channel/${selectedChannel.channelId}`} target="_blank" className="text-zinc-500 hover:text-white transition-colors"><ExternalLink size={18} /></a>
                  </h3>
                  <div className="flex items-center gap-3 mt-1">
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">분석 내역 • {periodLabels[period]}</p>
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
                <p className="text-zinc-500 text-sm font-medium">분석할 채널의 UC 코드를 엔터로 구분하여 대량 입력하세요.</p>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-stretch">
                <div className="flex flex-col space-y-4 h-full">
                  <div className="flex items-center justify-between px-2">
                    <label className="text-[11px] font-black text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2">
                      <List size={14} className="text-red-600" /> 유튜브 채널 UC 코드 목록
                    </label>
                    <button onClick={() => setChannelInput('')} className="flex items-center gap-2 text-[10px] font-black text-zinc-600 hover:text-red-500 transition-colors uppercase">
                      <Trash2 size={12} /> 초기화
                    </button>
                  </div>
                  <div className="flex-1 min-h-[400px] bg-[#161616] p-1 border border-white/10 rounded-[32px] shadow-2xl relative group overflow-hidden">
                    <textarea
                      value={channelInput}
                      onChange={(e) => setChannelInput(e.target.value)}
                      placeholder="UC-xxxxxxxxxxxx&#10;UC-yyyyyyyyyyyy"
                      className="w-full h-full p-8 bg-transparent text-sm font-mono leading-relaxed text-zinc-200 placeholder:text-zinc-700 focus:outline-none resize-none relative z-10"
                    />
                  </div>
                </div>

                <div className="flex flex-col space-y-4 h-full">
                   <div className="px-2">
                    <label className="text-[11px] font-black text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2">
                      <Settings2 size={14} className="text-red-600" /> 분석 설정
                    </label>
                  </div>
                  <div className="flex-1 bg-[#161616] p-8 md:p-10 rounded-[32px] border border-white/10 shadow-2xl flex flex-col justify-between">
                    <div className="space-y-10">
                      <div className="space-y-4">
                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                          <Calendar size={14} className="text-red-600" /> 분석 기간
                        </label>
                        <div className="grid grid-cols-3 gap-3 p-1.5 bg-black/40 rounded-2xl border border-white/5">
                          {(['all', '30d', '7d'] as AnalysisPeriod[]).map((p) => (
                            <button key={p} onClick={() => setPeriod(p)} className={`py-3 text-[11px] font-black rounded-xl transition-all ${period === p ? 'bg-white text-black' : 'text-zinc-500 hover:text-zinc-300'}`}>
                              {periodLabels[p]}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-6">
                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                          <Radio size={14} className="text-red-600" /> 수집 목표 (최신순)
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                          <div className="space-y-4">
                            <span className="text-[10px] font-bold text-zinc-600 uppercase">쇼츠 목표: {targetShorts}개</span>
                            <input type="range" min="1" max="100" value={Number(targetShorts)} onChange={(e) => setTargetShorts(Number(e.target.value))} className="w-full h-1.5 bg-white/5 rounded-full appearance-none accent-red-600" />
                          </div>
                          <div className="space-y-4">
                            <span className="text-[10px] font-bold text-zinc-600 uppercase">롱폼 목표: {targetLong}개</span>
                            <input type="range" min="1" max="50" value={Number(targetLong)} onChange={(e) => setTargetLong(Number(e.target.value))} className="w-full h-1.5 bg-white/5 rounded-full appearance-none accent-white" />
                          </div>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={handleChannelStart}
                      disabled={isProcessing || !channelInput.trim()}
                      className="w-full bg-white hover:bg-red-600 hover:text-white disabled:bg-zinc-800 disabled:text-zinc-600 text-black py-6 rounded-[24px] font-black text-base flex items-center justify-center gap-3 transition-all"
                    >
                      {isProcessing ? <Loader2 className="animate-spin" /> : <Play fill="currentColor" size={18} />}
                      분석 시작
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab === 'video-config' ? (
            <div className="max-w-3xl mx-auto space-y-10">
              <h2 className="text-3xl font-black italic">영상 개별 분석</h2>
              <div className="bg-[#161616] p-8 rounded-[40px] border border-white/10 space-y-8">
                <textarea value={videoInput} onChange={(e) => setVideoInput(e.target.value)} placeholder="URL을 입력하세요..." className="w-full h-64 p-8 bg-black/40 border border-white/5 rounded-3xl text-sm outline-none resize-none" />
                <button onClick={handleVideoStart} disabled={isProcessing || !videoInput.trim()} className="w-full bg-white text-black py-6 rounded-3xl font-black text-lg flex items-center justify-center gap-3">
                  {isProcessing ? <Loader2 className="animate-spin" /> : <MonitorPlay size={24} />}
                  데이터 수집
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-10">
              <div className="flex justify-between items-end">
                <h2 className="text-3xl font-black italic uppercase">인사이트 <span className="text-red-600">리포트</span></h2>
                <button onClick={handleDownloadExcel} className="bg-white text-black px-8 py-4 rounded-2xl font-black flex items-center gap-2 text-sm">
                  <FileSpreadsheet size={18} /> 엑셀 다운로드
                </button>
              </div>

              <div className="bg-[#161616] rounded-[32px] border border-white/5 overflow-hidden shadow-2xl">
                <table className="w-full text-left">
                  <thead className="bg-white/5 text-zinc-500 text-[10px] uppercase font-black">
                    <tr>
                      <th className="px-8 py-5">분석 대상</th>
                      <th className="px-8 py-5 text-center">구독자</th>
                      <th className="px-8 py-5 text-right">쇼츠 평균</th>
                      <th className="px-8 py-5 text-right">롱폼 평균</th>
                      <th className="px-8 py-5 text-center">상세</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {channelResults.length === 0 ? (
                      <tr><td colSpan={5} className="py-20 text-center text-zinc-700">분석된 데이터가 없습니다.</td></tr>
                    ) : (
                      channelResults.map((r, i) => (
                        <tr key={i} className="hover:bg-white/[0.02]">
                          <td className="px-8 py-6 flex items-center gap-4">
                            {r.thumbnail ? <img src={r.thumbnail} className="w-10 h-10 rounded-lg object-cover" /> : <div className="w-10 h-10 bg-zinc-800 rounded-lg" />}
                            <div>
                              <div className="font-black text-white">{r.channelName}</div>
                              <div className="text-[9px] text-zinc-600">{r.channelId}</div>
                            </div>
                          </td>
                          <td className="px-8 py-6 text-center text-zinc-400 font-bold">{r.status === 'completed' ? formatNumber(r.subscriberCount) : '...'}</td>
                          <td className="px-8 py-6 text-right font-black">{r.avgShortsViews.toLocaleString()}</td>
                          <td className="px-8 py-6 text-right font-black">{r.avgLongViews.toLocaleString()}</td>
                          <td className="px-8 py-6 text-center">
                            <button disabled={r.status !== 'completed'} onClick={() => setSelectedChannel(r)} className="p-2 bg-white/5 rounded-lg">
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
        </div>
      </main>
    </div>
  );
};

export default App;
