
import React, { useState, useEffect } from 'react';
import { 
  Play, Download, Trash2, List, Youtube, Loader2, 
  LayoutDashboard, ExternalLink, Calendar, TrendingUp, 
  Video, X, Eye, FileSpreadsheet, Users, Settings2, CheckCircle2, AlertCircle
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { getChannelInfo, fetchChannelStats, fetchVideosByIds, AnalysisPeriod } from './services/youtubeService';
import { ChannelResult, VideoResult } from './types';

type TabType = 'channel-config' | 'video-config' | 'dashboard';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('channel-config');
  const [channelInput, setChannelInput] = useState<string>('');
  const [targetShorts, setTargetShorts] = useState<number>(30);
  const [targetLong, setTargetLong] = useState<number>(10);
  const [period, setPeriod] = useState<AnalysisPeriod>('all');
  const [channelResults, setChannelResults] = useState<ChannelResult[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<ChannelResult | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progressLog, setProgressLog] = useState<string[]>([]);

  useEffect(() => {
    // Basic init or cleanup
  }, []);

  const addLog = (msg: string) => setProgressLog(prev => [msg, ...prev].slice(0, 50));

  const extractChannelId = (input: string) => {
    const match = input.match(/UC[\w-]{22}/);
    return match ? match[0] : input.trim();
  };

  const handleChannelStart = async () => {
    const ucCodes = channelInput.split('\n').map(extractChannelId).filter(s => s.length > 0);
    if (ucCodes.length === 0) return alert('Enter at least one UC code.');

    setIsProcessing(true);
    setProgressLog(['Starting analysis...']);
    setActiveTab('dashboard');
    
    const initialResults: ChannelResult[] = ucCodes.map(code => ({
      channelId: code, channelName: 'Searching...', thumbnail: '', subscriberCount: '0',
      avgShortsViews: 0, shortsCountFound: 0, avgLongViews: 0, longCountFound: 0,
      shortsList: [], longsList: [], liveList: [], status: 'pending',
    }));
    setChannelResults(initialResults);

    for (let i = 0; i < ucCodes.length; i++) {
      const code = ucCodes[i];
      setChannelResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'processing' } : r));
      addLog(`Analyzing channel: ${code}`);

      try {
        const info = await getChannelInfo(code);
        addLog(`Found channel: ${info.title}. Fetching videos...`);
        const stats = await fetchChannelStats(info.uploadsPlaylistId, targetShorts, targetLong, period, (scanned, found) => {
          addLog(`  Scanning: ${scanned} items checked... Found ${found} shorts.`);
        });

        setChannelResults(prev => prev.map((r, idx) => idx === i ? { 
          ...r, channelName: info.title, thumbnail: info.thumbnail, subscriberCount: info.subscriberCount,
          avgShortsViews: stats.avgShortsViews, shortsCountFound: stats.shortsCount,
          avgLongViews: stats.avgLongViews, longCountFound: stats.longCount,
          shortsList: stats.shortsList, longsList: stats.longsList, status: 'completed' 
        } : r));
        addLog(`Successfully processed ${info.title}.`);
      } catch (err: any) {
        addLog(`Error on ${code}: ${err.message}`);
        setChannelResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', error: err.message } : r));
      }
    }
    setIsProcessing(false);
    addLog('All tasks completed.');
  };

  const handleDownloadExcel = () => {
    const wb = XLSX.utils.book_new();
    const summary = channelResults.map(r => ({
      'Channel Name': r.channelName,
      'Channel ID': r.channelId,
      'Subscribers': parseInt(r.subscriberCount, 10),
      'Avg Shorts Views': r.avgShortsViews,
      'Shorts Count': r.shortsCountFound,
      'Avg Long Views': r.avgLongViews,
      'Longs Count': r.longCountFound,
      'Status': r.status
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');

    channelResults.filter(r => r.status === 'completed').forEach(r => {
      const details = [...r.shortsList, ...r.longsList].map(v => ({
        'Type': v.isShort ? 'Short' : 'Long',
        'Title': v.title,
        'Views': v.viewCount,
        'Date': new Date(v.publishedAt).toLocaleDateString(),
        'Link': v.isShort ? `https://youtube.com/shorts/${v.id}` : `https://youtube.com/watch?v=${v.id}`
      }));
      const safeName = r.channelName.replace(/[\\/*?:\[\]]/g, '').substring(0, 31);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(details), safeName);
    });

    XLSX.writeFile(wb, `TubeMetric_Report_${new Date().getTime()}.xlsx`);
  };

  const formatNum = (n: string | number) => Number(n).toLocaleString();

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white flex font-sans overflow-hidden">
      {/* Detail Modal */}
      {selectedChannel && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#161616] w-full max-w-4xl h-[80vh] rounded-[32px] border border-white/10 flex flex-col overflow-hidden">
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <img src={selectedChannel.thumbnail} className="w-12 h-12 rounded-xl object-cover" />
                <h3 className="text-xl font-black">{selectedChannel.channelName}</h3>
              </div>
              <button onClick={() => setSelectedChannel(null)} className="p-2 bg-white/5 rounded-full hover:bg-red-600 transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 gap-8">
              <div>
                <h4 className="text-red-500 font-black mb-4 flex items-center gap-2"><TrendingUp size={16}/> Shorts ({selectedChannel.shortsList.length})</h4>
                <div className="space-y-3">
                  {selectedChannel.shortsList.map(v => (
                    <div key={v.id} className="bg-white/5 p-3 rounded-xl border border-white/5 text-[12px]">
                      <div className="font-bold truncate">{v.title}</div>
                      <div className="text-zinc-500 mt-1">{formatNum(v.viewCount)} views</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-white font-black mb-4 flex items-center gap-2"><Video size={16}/> Longform ({selectedChannel.longsList.length})</h4>
                <div className="space-y-3">
                  {selectedChannel.longsList.map(v => (
                    <div key={v.id} className="bg-white/5 p-3 rounded-xl border border-white/5 text-[12px]">
                      <div className="font-bold truncate">{v.title}</div>
                      <div className="text-zinc-500 mt-1">{formatNum(v.viewCount)} views</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-64 bg-[#121212] border-r border-white/5 p-8 flex flex-col gap-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-red-600 p-2 rounded-lg"><Youtube size={20} /></div>
          <h1 className="text-lg font-black italic">TubeMetric</h1>
        </div>
        <nav className="flex flex-col gap-2">
          <button onClick={() => setActiveTab('channel-config')} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeTab === 'channel-config' ? 'bg-red-600' : 'text-zinc-500 hover:text-white'}`}><TrendingUp size={18}/> Channels</button>
          <button onClick={() => setActiveTab('dashboard')} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeTab === 'dashboard' ? 'bg-red-600' : 'text-zinc-500 hover:text-white'}`}><LayoutDashboard size={18}/> Dashboard</button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-12 overflow-y-auto">
        {activeTab === 'channel-config' ? (
          <div className="max-w-4xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-4">
            <div className="space-y-2">
              <h2 className="text-4xl font-black italic">ANALYZE CHANNELS</h2>
              <p className="text-zinc-500 font-medium">Bulk analyze YouTube channels by entering their UC codes.</p>
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-4">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2"><List size={14}/> UC Codes (Line Separated)</label>
                <textarea 
                  value={channelInput} onChange={e => setChannelInput(e.target.value)}
                  placeholder="UC-xxxxxxxxxxxx&#10;UC-yyyyyyyyyyyy"
                  className="w-full h-80 bg-[#161616] border border-white/10 rounded-3xl p-6 text-sm font-mono focus:ring-2 ring-red-600 outline-none"
                />
              </div>
              <div className="space-y-8 flex flex-col justify-between">
                <div className="bg-[#161616] p-8 rounded-3xl border border-white/10 space-y-6">
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Analysis Target</label>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-black/30 p-4 rounded-xl">
                        <div className="text-[10px] text-zinc-500 font-black mb-2">SHORTS: {targetShorts}</div>
                        <input type="range" min="1" max="50" value={targetShorts} onChange={e => setTargetShorts(Number(e.target.value))} className="w-full accent-red-600" />
                      </div>
                      <div className="bg-black/30 p-4 rounded-xl">
                        <div className="text-[10px] text-zinc-500 font-black mb-2">LONGS: {targetLong}</div>
                        <input type="range" min="1" max="50" value={targetLong} onChange={e => setTargetLong(Number(e.target.value))} className="w-full accent-white" />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Period</label>
                    <div className="flex gap-2">
                      {['all', '30d', '7d'].map(p => (
                        <button key={p} onClick={() => setPeriod(p as AnalysisPeriod)} className={`flex-1 py-2 text-[10px] font-black rounded-lg ${period === p ? 'bg-white text-black' : 'bg-white/5 text-zinc-500'}`}>{p.toUpperCase()}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <button 
                  onClick={handleChannelStart} disabled={isProcessing || !channelInput.trim()}
                  className="w-full py-6 bg-white text-black rounded-3xl font-black text-lg hover:bg-red-600 hover:text-white transition-all disabled:opacity-50"
                >
                  {isProcessing ? <Loader2 className="animate-spin mx-auto"/> : 'START ANALYSIS'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-10 animate-in fade-in duration-500">
            <div className="flex justify-between items-end">
              <div>
                <h2 className="text-3xl font-black italic uppercase">Results Dashboard</h2>
                <p className="text-zinc-500 text-sm">Real-time stats from {channelResults.length} channels</p>
              </div>
              <div className="flex gap-4">
                <button onClick={handleDownloadExcel} className="bg-white text-black px-6 py-3 rounded-xl font-black flex items-center gap-2 text-sm hover:bg-zinc-200">
                  <FileSpreadsheet size={16}/> Export Excel
                </button>
                <button onClick={() => { setChannelResults([]); setProgressLog([]); }} className="bg-white/5 hover:bg-red-600 px-6 py-3 rounded-xl font-black flex items-center gap-2 text-sm transition-colors">
                  <Trash2 size={16}/> Clear All
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-8">
              <div className="col-span-2 bg-[#161616] rounded-3xl border border-white/5 overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-white/5 text-[10px] font-black text-zinc-500 uppercase tracking-tighter">
                    <tr>
                      <th className="px-8 py-5">Channel</th>
                      <th className="px-8 py-5 text-center">Subs</th>
                      <th className="px-8 py-5 text-right">Avg Shorts</th>
                      <th className="px-8 py-5 text-right">Avg Longs</th>
                      <th className="px-8 py-5 text-center">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {channelResults.map((r, i) => (
                      <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-8 py-4 flex items-center gap-4">
                          <div className="relative">
                            {r.thumbnail ? <img src={r.thumbnail} className="w-10 h-10 rounded-lg object-cover" /> : <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center"><Youtube size={14}/></div>}
                            {r.status === 'processing' && <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-600 rounded-full animate-ping" />}
                          </div>
                          <div>
                            <div className="font-black text-sm">{r.channelName}</div>
                            <div className="text-[10px] text-zinc-600 font-mono">{r.channelId}</div>
                          </div>
                        </td>
                        <td className="px-8 py-4 text-center text-zinc-400 font-bold text-xs">{r.status === 'completed' ? formatNum(r.subscriberCount) : '--'}</td>
                        <td className="px-8 py-4 text-right font-black text-red-500">{formatNum(r.avgShortsViews)}</td>
                        <td className="px-8 py-4 text-right font-black">{formatNum(r.avgLongViews)}</td>
                        <td className="px-8 py-4 text-center">
                          {r.status === 'completed' ? (
                            <button onClick={() => setSelectedChannel(r)} className="p-2 bg-white/5 rounded-lg hover:bg-red-600 transition-all"><Eye size={14}/></button>
                          ) : r.status === 'error' ? (
                            <AlertCircle className="text-red-500 mx-auto" size={16} title={r.error} />
                          ) : (
                            <Loader2 className="animate-spin text-zinc-700 mx-auto" size={16} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-[#121212] rounded-3xl border border-white/5 p-6 space-y-4">
                <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-red-600 rounded-full animate-pulse" /> Live Progress Log
                </h3>
                <div className="h-[400px] overflow-y-auto space-y-2 text-[11px] font-mono text-zinc-500 pr-2 custom-scroll">
                  {progressLog.map((log, i) => (
                    <div key={i} className={`p-2 rounded-lg ${i === 0 ? 'bg-white/5 text-zinc-300' : 'opacity-60'}`}>
                      <span className="text-red-600 mr-2">></span> {log}
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
