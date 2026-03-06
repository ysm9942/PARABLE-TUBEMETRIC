"""
PARABLE-TUBEMETRIC — 통합 GUI
Vercel 대시보드의 모든 기능을 로컬 exe에 구현:
  - 채널 통합 분석  (YouTube API)
  - 단일 영상 분석  (YouTube API)
  - 광고 영상 분석  (YouTube API + NLP)
  - 로컬 스크래퍼   (undetected-chromedriver → GitHub push)
  - 라이브 지표 분석 (CHZZK/SOOP · viewership.softc.one)
  - 데이터 대시보드 (결과 표시 + Excel 내보내기)
"""
import sys
import threading
import socket
import getpass
import platform
import json
import webbrowser
from datetime import datetime, timedelta
from pathlib import Path
import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox, filedialog

# ── PyInstaller frozen path ────────────────────────────────────────────────────
if getattr(sys, 'frozen', False):
    SCRIPT_DIR = Path(sys.executable).parent
else:
    SCRIPT_DIR = Path(__file__).parent

TARGETS_FILE = SCRIPT_DIR / "targets.txt"

# ── 색상 팔레트 ────────────────────────────────────────────────────────────────
BG      = "#0a0a0a"
BG2     = "#111111"
BG3     = "#1a1a1a"
BG4     = "#222222"
BORDER  = "#222222"
FG      = "#f4f4f5"
FG_DIM  = "#71717a"
FG_MUTE = "#3f3f46"
ACCENT  = "#dc2626"
ACCENT2 = "#ef4444"
GREEN   = "#22c55e"
BLUE    = "#60a5fa"
YELLOW  = "#facc15"

PIN_CORRECT = "5350"

MACHINE_INFO = {
    "operator": getpass.getuser(),
    "hostname": socket.gethostname(),
    "os": f"{platform.system()} {platform.release()}",
}


# ── 인증 정보 로드 (config.py 내장값 우선) ────────────────────────────────────
def _load_credentials():
    try:
        from config import get_github_token, GITHUB_REPO
        token = get_github_token()
        if token:
            return token, GITHUB_REPO
    except ImportError:
        pass
    import os
    return os.environ.get("GITHUB_TOKEN", ""), os.environ.get("GITHUB_REPO", "")


def _load_yt_api_key() -> str:
    try:
        from config import YOUTUBE_API_KEY
        if YOUTUBE_API_KEY:
            return YOUTUBE_API_KEY
    except (ImportError, AttributeError):
        pass
    import os
    return os.environ.get("YOUTUBE_API_KEY", "")


# ── 숫자 포맷 ─────────────────────────────────────────────────────────────────
def fmt_num(n) -> str:
    try:
        n = int(n)
    except (TypeError, ValueError):
        return "0"
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.1f}K"
    return f"{n:,}"


# ── ConsoleWindow ─────────────────────────────────────────────────────────────
class ConsoleWindow(tk.Toplevel):
    def __init__(self, master, title="실행 중"):
        super().__init__(master)
        self.title(f"PARABLE-TUBEMETRIC  |  {title}")
        self.geometry("800x500")
        self.configure(bg="#0c0c0c")
        self.resizable(True, True)
        self._closed = False
        self.protocol("WM_DELETE_WINDOW", self._on_close)

        bar = tk.Frame(self, bg="#161616")
        bar.pack(fill="x")
        tk.Label(bar, text=f"  ■  {title}", font=("Consolas", 9, "bold"),
                 bg="#161616", fg="#555", pady=7, anchor="w").pack(fill="x", padx=4)

        self.log = scrolledtext.ScrolledText(
            self, font=("Consolas", 10),
            bg="#0c0c0c", fg="#cccccc",
            insertbackground="white", relief="flat", padx=14, pady=10,
            state="disabled",
        )
        self.log.pack(fill="both", expand=True)
        self.log.tag_configure("ok",   foreground="#4ade80")
        self.log.tag_configure("err",  foreground="#f87171")
        self.log.tag_configure("info", foreground="#60a5fa")
        self.log.tag_configure("dim",  foreground="#555555")

    def append(self, text: str, tag: str = ""):
        def _do():
            self.log.configure(state="normal")
            if not tag:
                low = text.lower()
                if any(k in low for k in ["완료", "✓", "done", "push"]):
                    t = "ok"
                elif any(k in low for k in ["오류", "error", "fail", "✗"]):
                    t = "err"
                elif text.startswith("["):
                    t = "info"
                else:
                    t = "dim"
            else:
                t = tag
            self.log.insert("end", text, t)
            self.log.see("end")
            self.log.configure(state="disabled")
        self.after(0, _do)

    def finish(self, success: bool = True):
        msg = "\n✓  완료  —  5초 후 창이 닫힙니다.\n" if success else "\n✗  오류 발생  —  5초 후 창이 닫힙니다.\n"
        self.append(msg)
        if not self._closed:
            self.after(5000, self._safe_destroy)

    def _safe_destroy(self):
        if not self._closed:
            self.destroy()

    def _on_close(self):
        self._closed = True
        self.destroy()


# ── PIN 화면 ──────────────────────────────────────────────────────────────────
class PinScreen(tk.Frame):
    def __init__(self, master, on_success):
        super().__init__(master, bg=BG)
        self.on_success = on_success
        self._build()

    def _build(self):
        center = tk.Frame(self, bg=BG)
        center.place(relx=0.5, rely=0.5, anchor="center")

        icon = tk.Frame(center, bg=ACCENT, width=78, height=78)
        icon.pack_propagate(False)
        icon.pack(pady=(0, 18))
        tk.Label(icon, text="🔒", font=("Arial", 30), bg=ACCENT, fg="white").pack(expand=True)

        tk.Label(center, text="PARABLE-", font=("Arial", 26, "bold"), bg=BG, fg=FG).pack()
        tk.Label(center, text="TUBEMETRIC", font=("Arial", 26, "bold"), bg=BG, fg=ACCENT).pack()
        tk.Label(center, text="SYSTEM  LOCKED", font=("Arial", 8, "bold"),
                 bg=BG, fg=FG_DIM, pady=6).pack()
        tk.Frame(center, height=16, bg=BG).pack()

        border = tk.Frame(center, bg=BORDER, padx=1, pady=1)
        border.pack(fill="x", pady=(0, 10))
        self._pin = tk.StringVar()
        self._entry = tk.Entry(
            border, textvariable=self._pin, show="●",
            font=("Consolas", 24, "bold"), bg=BG3, fg=FG,
            insertbackground=ACCENT, relief="flat", justify="center", width=11,
        )
        self._entry.pack(ipady=14, ipadx=20)
        self._entry.bind("<Return>", lambda _: self._submit())
        self._entry.focus()

        tk.Button(center, text="UNLOCK  →", command=self._submit,
                  bg=ACCENT, fg="white", activebackground=ACCENT2,
                  font=("Arial", 11, "bold"), relief="flat",
                  cursor="hand2", pady=12).pack(fill="x")
        tk.Label(center, text="AUTHORIZED ACCESS ONLY",
                 font=("Arial", 7, "bold"), bg=BG, fg="#27272a", pady=14).pack()

    def _submit(self):
        if self._pin.get() == PIN_CORRECT:
            self.on_success()
        else:
            self._entry.configure(bg="#2d0a0a")
            self.after(500, lambda: self._entry.configure(bg=BG3))
            self._pin.set("")


# ── 공통 UI 헬퍼 ──────────────────────────────────────────────────────────────
def _section_header(parent, title: str, subtitle: str = ""):
    f = tk.Frame(parent, bg=BG, pady=18, padx=28)
    f.pack(fill="x")
    tk.Label(f, text=title, font=("Arial", 17, "bold"),
             bg=BG, fg=FG, anchor="w").pack(fill="x")
    if subtitle:
        tk.Label(f, text=subtitle, font=("Arial", 9),
                 bg=BG, fg=FG_DIM, anchor="w").pack(fill="x", pady=(2, 0))
    tk.Frame(parent, bg=BORDER, height=1).pack(fill="x")
    return f


def _btn(parent, text, command, bg=BG3, fg=FG_DIM, bold=False, **kw):
    font = ("Arial", 10, "bold") if bold else ("Arial", 10)
    return tk.Button(parent, text=text, command=command,
                     bg=bg, fg=fg, activebackground=BG4,
                     activeforeground=FG, font=font, relief="flat",
                     cursor="hand2", **kw)


def _label(parent, text, font_size=9, color=FG_DIM, **kw):
    return tk.Label(parent, text=text,
                    font=("Arial", font_size), bg=BG, fg=color, **kw)


def _card(parent, **kw):
    f = tk.Frame(parent, bg=BG3, **kw)
    return f


# ── Treeview 스타일 ────────────────────────────────────────────────────────────
def _apply_treeview_style():
    style = ttk.Style()
    style.theme_use("default")
    style.configure("Dark.Treeview",
        background=BG3, foreground=FG, fieldbackground=BG3,
        rowheight=28, font=("Consolas", 9),
        borderwidth=0, relief="flat",
    )
    style.configure("Dark.Treeview.Heading",
        background=BG2, foreground=FG_DIM,
        font=("Arial", 9, "bold"), relief="flat",
        borderwidth=0,
    )
    style.map("Dark.Treeview",
        background=[("selected", ACCENT)],
        foreground=[("selected", "white")],
    )
    style.map("Dark.Treeview.Heading",
        background=[("active", BG3)],
    )


# ── 채널 분석 탭 ──────────────────────────────────────────────────────────────
class ChannelTab(tk.Frame):
    def __init__(self, master, app):
        super().__init__(master, bg=BG)
        self.app = app
        self._build()

    def _build(self):
        _section_header(self, "채널 통합 분석",
                         "YouTube API → 쇼츠/롱폼 평균 조회수 · 영상 목록 수집")

        wrap = tk.Frame(self, bg=BG, padx=28)
        wrap.pack(fill="both", expand=True)

        # 채널 입력
        tk.Label(wrap, text="채널 목록  (한 줄에 하나 · @핸들, URL, UCxxx 모두 가능)",
                 font=("Arial", 9, "bold"), bg=BG, fg=FG, anchor="w").pack(fill="x", pady=(16, 4))
        border = tk.Frame(wrap, bg=ACCENT, padx=1, pady=1)
        border.pack(fill="x")
        self.ch_txt = tk.Text(border, height=5, font=("Consolas", 10),
                              bg=BG3, fg=FG, insertbackground=ACCENT,
                              relief="flat", padx=10, pady=8)
        self.ch_txt.pack(fill="both")

        # 옵션
        opt = tk.Frame(wrap, bg=BG, pady=10)
        opt.pack(fill="x")

        # 기간 필터
        tk.Label(opt, text="기간", font=("Arial", 9, "bold"),
                 bg=BG, fg=FG, anchor="w").grid(row=0, column=0, sticky="w", padx=(0, 8))
        self.period = tk.StringVar(value="all")
        for i, (val, lbl) in enumerate([("all","전체"),("90d","90일"),("30d","30일"),("7d","7일")]):
            rb = tk.Radiobutton(opt, text=lbl, variable=self.period, value=val,
                                bg=BG, fg=FG_DIM, activebackground=BG,
                                selectcolor=BG3, font=("Arial", 9),
                                activeforeground=FG)
            rb.grid(row=0, column=i+1, sticky="w", padx=4)

        self.use_date_filter = tk.BooleanVar(value=False)
        tk.Checkbutton(opt, text="날짜 필터 적용", variable=self.use_date_filter,
                       bg=BG, fg=FG_DIM, activebackground=BG, selectcolor=BG3,
                       font=("Arial", 9), activeforeground=FG
                       ).grid(row=0, column=6, sticky="w", padx=(20, 0))

        # 수집 개수
        tk.Label(opt, text="쇼츠", font=("Arial", 9, "bold"),
                 bg=BG, fg=FG, anchor="w").grid(row=1, column=0, sticky="w", padx=(0, 8), pady=(8,0))
        self.shorts_count = tk.StringVar(value="30")
        tk.Entry(opt, textvariable=self.shorts_count, width=6,
                 bg=BG3, fg=FG, insertbackground=ACCENT, relief="flat",
                 font=("Consolas", 10)).grid(row=1, column=1, sticky="w", pady=(8,0))

        tk.Label(opt, text="롱폼", font=("Arial", 9, "bold"),
                 bg=BG, fg=FG, anchor="w").grid(row=1, column=2, sticky="w", padx=(16,8), pady=(8,0))
        self.longs_count = tk.StringVar(value="10")
        tk.Entry(opt, textvariable=self.longs_count, width=6,
                 bg=BG3, fg=FG, insertbackground=ACCENT, relief="flat",
                 font=("Consolas", 10)).grid(row=1, column=3, sticky="w", pady=(8,0))

        self.use_count_filter = tk.BooleanVar(value=True)
        tk.Checkbutton(opt, text="개수 제한 사용", variable=self.use_count_filter,
                       bg=BG, fg=FG_DIM, activebackground=BG, selectcolor=BG3,
                       font=("Arial", 9), activeforeground=FG
                       ).grid(row=1, column=4, sticky="w", padx=(16, 0), pady=(8,0))

        self.use_shorts = tk.BooleanVar(value=True)
        tk.Checkbutton(opt, text="쇼츠 수집", variable=self.use_shorts,
                       bg=BG, fg=FG_DIM, activebackground=BG, selectcolor=BG3,
                       font=("Arial", 9), activeforeground=FG
                       ).grid(row=1, column=5, sticky="w", padx=(16, 0), pady=(8,0))

        self.use_longs = tk.BooleanVar(value=True)
        tk.Checkbutton(opt, text="롱폼 수집", variable=self.use_longs,
                       bg=BG, fg=FG_DIM, activebackground=BG, selectcolor=BG3,
                       font=("Arial", 9), activeforeground=FG
                       ).grid(row=1, column=6, sticky="w", padx=(16, 0), pady=(8,0))

        # 버튼
        btn_row = tk.Frame(wrap, bg=BG, pady=8)
        btn_row.pack(fill="x")
        self.run_btn = _btn(btn_row, "▶  분석 시작", self._run,
                            bg=ACCENT, fg="white", bold=True, padx=20, pady=10)
        self.run_btn.pack(side="left")

        self._status = tk.StringVar(value="대기 중")
        tk.Label(btn_row, textvariable=self._status, font=("Consolas", 9),
                 bg=BG, fg=FG_DIM).pack(side="left", padx=14)

        # API 키 상태
        self._api_status = tk.StringVar()
        tk.Label(wrap, textvariable=self._api_status,
                 font=("Arial", 8), bg=BG, fg=FG_DIM, anchor="w").pack(fill="x", pady=(4, 0))
        self._refresh_api_status()

    def _refresh_api_status(self):
        key = _load_yt_api_key()
        if key:
            self._api_status.set(f"✓  YouTube API Key 확인됨  ({key[:8]}...)")
        else:
            self._api_status.set("✗  YouTube API Key 없음  —  config.py 에 YOUTUBE_API_KEY 를 설정하고 재빌드하세요")

    def _run(self):
        channels = [
            ln.strip() for ln in self.ch_txt.get("1.0", "end").splitlines()
            if ln.strip() and not ln.strip().startswith("#")
        ]
        if not channels:
            messagebox.showwarning("입력 필요", "채널을 입력하세요.")
            return
        if not _load_yt_api_key():
            messagebox.showerror("API Key 없음", "YouTube API Key가 설정되지 않았습니다.")
            return

        self.run_btn.configure(state="disabled")
        self._status.set("분석 중...")

        shorts_cfg = {
            "enabled": self.use_shorts.get(),
            "target": int(self.shorts_count.get() or 30),
            "period": self.period.get(),
            "useDateFilter": self.use_date_filter.get(),
            "useCountFilter": self.use_count_filter.get(),
        }
        longs_cfg = {
            "enabled": self.use_longs.get(),
            "target": int(self.longs_count.get() or 10),
            "period": self.period.get(),
            "useDateFilter": self.use_date_filter.get(),
            "useCountFilter": self.use_count_filter.get(),
        }

        win = ConsoleWindow(self.winfo_toplevel(), "채널 통합 분석")
        win.append(f"[시작] 채널 {len(channels)}개 분석\n", "info")

        threading.Thread(
            target=self._analyze,
            args=(channels, shorts_cfg, longs_cfg, win),
            daemon=True,
        ).start()

    def _analyze(self, channels, shorts_cfg, longs_cfg, win):
        from youtube_api import get_channel_info, fetch_channel_stats
        results = []
        for ch in channels:
            win.append(f"\n[채널] {ch}\n", "info")
            try:
                info = get_channel_info(ch)
                win.append(f"  → {info['title']} (구독자 {fmt_num(info['subscriberCount'])})\n")
                stats = fetch_channel_stats(
                    info["uploadsPlaylistId"], shorts_cfg, longs_cfg,
                    progress_cb=lambda m: win.append(m + "\n"),
                )
                result = {**info, **stats, "status": "completed"}
                results.append(result)
                win.append(
                    f"  ✓ 쇼츠 {stats['shortsCount']}개 ({fmt_num(stats['avgShortsViews'])} avg) · "
                    f"롱폼 {stats['longCount']}개 ({fmt_num(stats['avgLongViews'])} avg)\n", "ok"
                )
            except Exception as e:
                win.append(f"  ✗ 오류: {e}\n", "err")
                results.append({"id": ch, "title": ch, "status": "error", "error": str(e)})

        self.app.channel_results = results
        win.finish(True)
        self.after(0, lambda: self.run_btn.configure(state="normal"))
        self.after(0, lambda: self._status.set(f"완료 ({len(results)}개)"))
        self.after(0, lambda: self.app.switch_tab("dashboard"))
        self.after(0, lambda: self.app.dashboard.show_channel())


# ── 영상 분석 탭 ──────────────────────────────────────────────────────────────
class VideoTab(tk.Frame):
    def __init__(self, master, app):
        super().__init__(master, bg=BG)
        self.app = app
        self._build()

    def _build(self):
        _section_header(self, "단일 영상 분석",
                         "YouTube URL / 영상 ID → 조회수 · 좋아요 · 댓글 수 수집")

        wrap = tk.Frame(self, bg=BG, padx=28)
        wrap.pack(fill="both", expand=True)

        tk.Label(wrap, text="영상 목록  (한 줄에 하나 · URL 또는 11자리 ID)",
                 font=("Arial", 9, "bold"), bg=BG, fg=FG, anchor="w").pack(fill="x", pady=(16, 4))
        border = tk.Frame(wrap, bg=ACCENT, padx=1, pady=1)
        border.pack(fill="x")
        self.vid_txt = tk.Text(border, height=8, font=("Consolas", 10),
                               bg=BG3, fg=FG, insertbackground=ACCENT,
                               relief="flat", padx=10, pady=8)
        self.vid_txt.pack(fill="both")

        btn_row = tk.Frame(wrap, bg=BG, pady=10)
        btn_row.pack(fill="x")
        self.run_btn = _btn(btn_row, "▶  분석 시작", self._run,
                            bg=ACCENT, fg="white", bold=True, padx=20, pady=10)
        self.run_btn.pack(side="left")

        self._status = tk.StringVar(value="대기 중")
        tk.Label(btn_row, textvariable=self._status, font=("Consolas", 9),
                 bg=BG, fg=FG_DIM).pack(side="left", padx=14)

    def _run(self):
        from youtube_api import extract_video_id
        lines = [
            ln.strip() for ln in self.vid_txt.get("1.0", "end").splitlines() if ln.strip()
        ]
        ids = list(dict.fromkeys(extract_video_id(l) for l in lines))
        ids = [i for i in ids if len(i) == 11]
        if not ids:
            messagebox.showwarning("입력 필요", "올바른 영상 URL 또는 ID를 입력하세요.")
            return
        if not _load_yt_api_key():
            messagebox.showerror("API Key 없음", "YouTube API Key가 설정되지 않았습니다.")
            return

        self.run_btn.configure(state="disabled")
        self._status.set("분석 중...")

        win = ConsoleWindow(self.winfo_toplevel(), "단일 영상 분석")
        win.append(f"[시작] 영상 {len(ids)}개 분석\n", "info")

        threading.Thread(target=self._analyze, args=(ids, win), daemon=True).start()

    def _analyze(self, ids, win):
        from youtube_api import fetch_videos_by_ids
        try:
            results = fetch_videos_by_ids(ids)
            win.append(f"\n✓ {len(results)}개 영상 수집 완료\n", "ok")
            for r in results:
                win.append(
                    f"  {r['title'][:50]}  |  "
                    f"조회수 {fmt_num(r['viewCount'])}  좋아요 {fmt_num(r['likeCount'])}  "
                    f"댓글 {fmt_num(r['commentCount'])}\n"
                )
        except Exception as e:
            win.append(f"\n✗ 오류: {e}\n", "err")
            results = []

        self.app.video_results = results
        win.finish(bool(results))
        self.after(0, lambda: self.run_btn.configure(state="normal"))
        self.after(0, lambda: self._status.set(f"완료 ({len(results)}개)"))
        self.after(0, lambda: self.app.switch_tab("dashboard"))
        self.after(0, lambda: self.app.dashboard.show_video())


# ── 광고 분석 탭 ──────────────────────────────────────────────────────────────
class AdTab(tk.Frame):
    def __init__(self, master, app):
        super().__init__(master, bg=BG)
        self.app = app
        self._build()

    def _build(self):
        _section_header(self, "광고 영상 분석",
                         "설명란 NLP 분석으로 협찬/광고 영상 자동 탐지")

        wrap = tk.Frame(self, bg=BG, padx=28)
        wrap.pack(fill="both", expand=True)

        tk.Label(wrap, text="채널 목록  (한 줄에 하나)",
                 font=("Arial", 9, "bold"), bg=BG, fg=FG, anchor="w").pack(fill="x", pady=(16, 4))
        border = tk.Frame(wrap, bg=ACCENT, padx=1, pady=1)
        border.pack(fill="x")
        self.ch_txt = tk.Text(border, height=4, font=("Consolas", 10),
                              bg=BG3, fg=FG, insertbackground=ACCENT,
                              relief="flat", padx=10, pady=8)
        self.ch_txt.pack(fill="both")

        # 날짜 범위
        date_row = tk.Frame(wrap, bg=BG, pady=10)
        date_row.pack(fill="x")

        tk.Label(date_row, text="시작일", font=("Arial", 9, "bold"),
                 bg=BG, fg=FG).pack(side="left")
        self.start_date = tk.StringVar(
            value=(datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d"))
        tk.Entry(date_row, textvariable=self.start_date, width=12,
                 bg=BG3, fg=FG, insertbackground=ACCENT, relief="flat",
                 font=("Consolas", 10)).pack(side="left", padx=(6, 16))

        tk.Label(date_row, text="종료일", font=("Arial", 9, "bold"),
                 bg=BG, fg=FG).pack(side="left")
        self.end_date = tk.StringVar(value=datetime.now().strftime("%Y-%m-%d"))
        tk.Entry(date_row, textvariable=self.end_date, width=12,
                 bg=BG3, fg=FG, insertbackground=ACCENT, relief="flat",
                 font=("Consolas", 10)).pack(side="left", padx=(6, 20))

        for lbl, days in [("7일", 7), ("30일", 30), ("90일", 90), ("전체", None)]:
            def _set(d=days):
                end = datetime.now()
                start = (end - timedelta(days=d)) if d else datetime(2005, 1, 1)
                self.start_date.set(start.strftime("%Y-%m-%d"))
                self.end_date.set(end.strftime("%Y-%m-%d"))
            _btn(date_row, lbl, _set, padx=10, pady=4).pack(side="left", padx=2)

        btn_row = tk.Frame(wrap, bg=BG, pady=4)
        btn_row.pack(fill="x")
        self.run_btn = _btn(btn_row, "▶  분석 시작", self._run,
                            bg=ACCENT, fg="white", bold=True, padx=20, pady=10)
        self.run_btn.pack(side="left")

        self._status = tk.StringVar(value="대기 중")
        tk.Label(btn_row, textvariable=self._status, font=("Consolas", 9),
                 bg=BG, fg=FG_DIM).pack(side="left", padx=14)

        tk.Label(wrap,
                 text="※ API 모드: NLP 텍스트 분석만 사용 (브라우저 없이 동작). "
                      "paidPromotion 플래그는 스크래퍼 모드에서만 감지됩니다.",
                 font=("Arial", 8), bg=BG, fg=FG_MUTE, anchor="w",
                 wraplength=700, justify="left").pack(fill="x", pady=(8, 0))

    def _run(self):
        channels = [
            ln.strip() for ln in self.ch_txt.get("1.0", "end").splitlines()
            if ln.strip() and not ln.strip().startswith("#")
        ]
        if not channels:
            messagebox.showwarning("입력 필요", "채널을 입력하세요.")
            return
        if not _load_yt_api_key():
            messagebox.showerror("API Key 없음", "YouTube API Key가 설정되지 않았습니다.")
            return

        try:
            start = datetime.strptime(self.start_date.get(), "%Y-%m-%d")
            end = datetime.strptime(self.end_date.get(), "%Y-%m-%d")
        except ValueError:
            messagebox.showerror("날짜 오류", "날짜 형식: YYYY-MM-DD")
            return

        self.run_btn.configure(state="disabled")
        self._status.set("분석 중...")

        win = ConsoleWindow(self.winfo_toplevel(), "광고 영상 분석")
        win.append(f"[시작] 채널 {len(channels)}개  기간: {self.start_date.get()} ~ {self.end_date.get()}\n", "info")

        threading.Thread(target=self._analyze, args=(channels, start, end, win), daemon=True).start()

    def _analyze(self, channels, start, end, win):
        from youtube_api import get_channel_info, analyze_ad_videos_api
        results = []
        for ch in channels:
            win.append(f"\n[채널] {ch}\n", "info")
            try:
                info = get_channel_info(ch)
                win.append(f"  → {info['title']}\n")
                ads = analyze_ad_videos_api(
                    info["uploadsPlaylistId"], start, end,
                    progress_cb=lambda m: win.append(m + "\n"),
                )
                total_views = sum(a["viewCount"] for a in ads)
                result = {
                    **info,
                    "adVideos": ads,
                    "totalAdCount": len(ads),
                    "totalViews": total_views,
                    "avgViews": round(total_views / len(ads)) if ads else 0,
                    "avgLikes": round(sum(a["likeCount"] for a in ads) / len(ads)) if ads else 0,
                    "avgComments": round(sum(a["commentCount"] for a in ads) / len(ads)) if ads else 0,
                    "status": "completed",
                }
                results.append(result)
                win.append(f"  ✓ 광고 {len(ads)}개 감지\n", "ok")
            except Exception as e:
                win.append(f"  ✗ 오류: {e}\n", "err")
                results.append({"id": ch, "title": ch, "status": "error", "error": str(e),
                                 "adVideos": [], "totalAdCount": 0})

        self.app.ad_results = results
        win.finish(True)
        self.after(0, lambda: self.run_btn.configure(state="normal"))
        self.after(0, lambda: self._status.set(f"완료 ({len(results)}개)"))
        self.after(0, lambda: self.app.switch_tab("dashboard"))
        self.after(0, lambda: self.app.dashboard.show_ad())


# ── 로컬 스크래퍼 탭 ──────────────────────────────────────────────────────────
class ScraperTab(tk.Frame):
    def __init__(self, master, app):
        super().__init__(master, bg=BG)
        self.app = app
        self._inline_driver = None
        self._console_win = None
        self._build()
        self._load_targets()
        self._refresh_cred_status()

    def _build(self):
        _section_header(self, "로컬 스크래퍼",
                         "undetected-chromedriver  →  채널 스크래핑  →  GitHub push")

        wrap = tk.Frame(self, bg=BG, padx=28)
        wrap.pack(fill="both", expand=True)

        tk.Label(wrap, text="채널 목록  (한 줄에 하나, # 은 주석)",
                 font=("Arial", 9, "bold"), bg=BG, fg=FG, anchor="w").pack(fill="x", pady=(16, 4))
        border = tk.Frame(wrap, bg=ACCENT, padx=1, pady=1)
        border.pack(fill="x")
        self.ch_txt = tk.Text(border, height=6, font=("Consolas", 10),
                              bg=BG3, fg=FG, insertbackground=ACCENT,
                              relief="flat", padx=10, pady=8)
        self.ch_txt.pack(fill="both")

        opt = tk.Frame(wrap, bg=BG, pady=10)
        opt.pack(fill="x")
        self.headless  = tk.BooleanVar(value=False)
        self.auto_push = tk.BooleanVar(value=True)
        for var, lbl in [
            (self.headless,  "헤드리스  (Chrome 창 없이 백그라운드)"),
            (self.auto_push, "자동 push  (GitHub push → Vercel 반영)"),
        ]:
            f = tk.Frame(opt, bg=BG)
            f.pack(side="left", padx=(0, 22))
            tk.Checkbutton(f, text=lbl, variable=var,
                           bg=BG, fg=FG_DIM, activebackground=BG,
                           selectcolor=BG3, font=("Arial", 9),
                           activeforeground=FG).pack(side="left")

        btn_row = tk.Frame(wrap, bg=BG, pady=4)
        btn_row.pack(fill="x")

        self.run_btn = _btn(btn_row, "▶  스크래핑 시작", self._run,
                            bg=ACCENT, fg="white", bold=True, padx=20, pady=10)
        self.run_btn.pack(side="left")

        self.stop_btn = _btn(btn_row, "■  중지", self._stop, padx=14, pady=10)
        self.stop_btn.configure(state="disabled")
        self.stop_btn.pack(side="left", padx=8)

        _btn(btn_row, "채널 목록 저장", self._save_targets,
             padx=12, pady=10).pack(side="right")

        status_bar = tk.Frame(wrap, bg=BG3, padx=14, pady=8)
        status_bar.pack(fill="x", pady=(10, 4))
        self._status = tk.StringVar(value="대기 중")
        tk.Label(status_bar, text="상태", font=("Arial", 8, "bold"),
                 bg=BG3, fg=FG_DIM).pack(side="left")
        tk.Label(status_bar, textvariable=self._status,
                 font=("Consolas", 9, "bold"), bg=BG3, fg=ACCENT).pack(side="left", padx=8)
        tk.Label(status_bar, text=f"PC: {MACHINE_INFO['hostname']}",
                 font=("Consolas", 8), bg=BG3, fg=FG_MUTE).pack(side="right")

        self._cred_var = tk.StringVar()
        tk.Label(wrap, textvariable=self._cred_var,
                 font=("Arial", 8), bg=BG, fg=FG_DIM, anchor="w").pack(fill="x", pady=(4, 0))

    def _refresh_cred_status(self):
        token, repo = _load_credentials()
        if token and repo:
            self._cred_var.set(f"✓  GitHub 인증 확인됨  —  {repo}")
        elif token:
            self._cred_var.set("⚠  GITHUB_REPO 설정 없음")
        else:
            self._cred_var.set("✗  GitHub 토큰 없음  —  config.py 설정 후 재빌드 필요")

    def _load_targets(self):
        if not TARGETS_FILE.exists():
            return
        lines = [
            ln.strip() for ln in TARGETS_FILE.read_text("utf-8").splitlines()
            if ln.strip() and not ln.strip().startswith("#")
        ]
        self.ch_txt.delete("1.0", "end")
        self.ch_txt.insert("1.0", "\n".join(lines))

    def _save_targets(self):
        content = self.ch_txt.get("1.0", "end").strip()
        TARGETS_FILE.write_text(
            "# 스크래핑할 채널 목록\n\n" + content + "\n", encoding="utf-8")
        messagebox.showinfo("저장 완료", "채널 목록이 저장되었습니다.")

    def _get_channels(self):
        return [
            ln.strip() for ln in self.ch_txt.get("1.0", "end").splitlines()
            if ln.strip() and not ln.strip().startswith("#")
        ]

    def _run(self):
        channels = self._get_channels()
        if not channels:
            messagebox.showwarning("채널 없음", "채널 핸들을 입력하세요.")
            return

        self.run_btn.configure(state="disabled")
        self.stop_btn.configure(state="normal", bg=ACCENT, fg="white")
        self._status.set("실행 중...")

        win = ConsoleWindow(self.winfo_toplevel(), "로컬 스크래퍼")
        self._console_win = win
        win.append(f"[시작] 채널: {', '.join(channels)}\n", "info")
        win.append(f"[머신] {MACHINE_INFO['hostname']} / {MACHINE_INFO['operator']}\n")
        win.append("─" * 62 + "\n\n")

        threading.Thread(
            target=self._scrape_inline,
            args=(channels, self.headless.get(), self.auto_push.get()),
            daemon=True,
        ).start()

    def _scrape_inline(self, channels, headless, do_push):
        import contextlib
        win = self._console_win

        class _Writer:
            def __init__(self, log_fn):
                self._log = log_fn
                self._buf = ""
            def write(self, text):
                self._buf += text
                while "\n" in self._buf:
                    line, self._buf = self._buf.split("\n", 1)
                    self._log(line + "\n")
            def flush(self):
                if self._buf:
                    self._log(self._buf)
                    self._buf = ""

        log = win.append if (win and not win._closed) else print
        writer = _Writer(log)
        success = False
        scraper_results = []
        try:
            with contextlib.redirect_stdout(writer), contextlib.redirect_stderr(writer):
                from browser import create_driver
                from channel_scraper import scrape_channel
                from uploader import save_result, save_and_push

                driver = create_driver(headless=headless)
                self._inline_driver = driver
                try:
                    for ch in channels:
                        try:
                            result = scrape_channel(driver, ch)
                            result["scrapedBy"] = MACHINE_INFO
                            cid = result["channelId"]
                            if do_push:
                                save_and_push(result, "channels", cid)
                            else:
                                save_result(result, "channels", cid)
                            scraper_results.append(result)
                        except Exception as e:
                            log(f"[오류] {ch}: {e}\n")
                finally:
                    try:
                        driver.quit()
                    except Exception:
                        pass
                    self._inline_driver = None
            success = True
            self.after(0, lambda: self._status.set("완료 ✓"))
        except Exception as e:
            log(f"\n[오류] {e}\n")
            self.after(0, lambda: self._status.set("오류 발생"))
        finally:
            if win and not win._closed:
                win.finish(success)
            self.after(0, self._done)

    def _stop(self):
        if self._inline_driver:
            try:
                self._inline_driver.quit()
            except Exception:
                pass
            self._inline_driver = None
        if self._console_win and not self._console_win._closed:
            self._console_win.append("\n[중지] 사용자가 중지했습니다.\n")
            self._console_win.after(1500, self._console_win._safe_destroy)
        self._done()

    def _done(self):
        self._inline_driver = None
        self._console_win = None
        self.run_btn.configure(state="normal")
        self.stop_btn.configure(state="disabled", bg=BG3, fg=FG_DIM)


# ── 라이브 지표 크롤러 (모듈 레벨) ───────────────────────────────────────────────

def _parse_viewer_num(s: str) -> int:
    """'1,234' 또는 '1234' 형식의 문자열을 정수로 변환"""
    import re as _re
    s = _re.sub(r"[^\d]", "", str(s))
    return int(s) if s else 0


def _crawl_creator(platform: str, creator_id: str,
                   start_dt, end_dt,
                   categories: list, stop_event,
                   progress_cb=None) -> list:
    """
    viewership.softc.one에서 크리에이터의 방송 지표를 수집.
    날짜 쿼리 파라미터 URL + CSS 셀렉터 기반 SPA 파싱.

    platform  : 'chzzk' 또는 'soop'
    creator_id: 크리에이터 채널 ID
    """
    import re as _re
    import time as _time
    import random as _rnd
    import subprocess as _sp
    from urllib.parse import quote as _q
    from datetime import timedelta as _td
    from bs4 import BeautifulSoup as _BS
    import undetected_chromedriver as _uc
    from selenium.webdriver.common.by import By as _By
    from selenium.webdriver.support.ui import WebDriverWait as _Wait
    from selenium.webdriver.support import expected_conditions as _EC
    from selenium.common.exceptions import (
        TimeoutException as _TE,
        StaleElementReferenceException as _SRE,
    )

    def _log(msg):
        if progress_cb:
            progress_cb(msg)

    # ── Chrome 버전 감지 (reg query 방식 — winreg보다 Windows에서 안정적) ─────
    def _get_chrome_ver():
        cmds = [
            r'reg query "HKEY_CURRENT_USER\Software\Google\Chrome\BLBeacon" /v version',
            r'reg query "HKEY_LOCAL_MACHINE\Software\Google\Chrome\BLBeacon" /v version',
            r'reg query "HKEY_LOCAL_MACHINE\Software\WOW6432Node\Google\Chrome\BLBeacon" /v version',
        ]
        for cmd in cmds:
            try:
                out = _sp.check_output(cmd, shell=True, text=True, encoding="utf-8", errors="ignore")
                m = _re.search(r"(\d+)\.\d+\.\d+\.\d+", out)
                if m:
                    return int(m.group(1))
            except Exception:
                continue
        return None

    # ── URL (KST → UTC -9h, 날짜 쿼리 파라미터 포함) ─────────────────────────
    BASE      = "https://viewership.softc.one"
    PLAT_PATH = {"chzzk": "naverchzzk", "soop": "afreeca"}.get(platform, platform)
    start_utc = (start_dt.replace(hour=0,  minute=0,  second=0,  microsecond=0)    - _td(hours=9)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    end_utc   = (end_dt.replace(  hour=14, minute=59, second=59, microsecond=999000) - _td(hours=9)).strftime("%Y-%m-%dT%H:%M:%S.999Z")
    url = f"{BASE}/channel/{PLAT_PATH}/{creator_id}/streams?startDateTime={_q(start_utc)}&endDateTime={_q(end_utc)}"

    # ── CSS 셀렉터 ────────────────────────────────────────────────────────────
    STREAM_SEL   = ("a[href*='/streams/'] > button.min-h-11.py-2.hidden.lg\\:flex"
                    ".gap-4.text-xs.items-center.font-medium.leading-none"
                    ".rounded-lg.px-6.transition-all")
    PAGE_BTN_SEL = "button.font-inter.text-xs.w-8.h-8"

    # ── 드라이버 (버전 감지 성공 시 version_main 전달, 실패 시 UC 자체 감지) ──
    _log("    드라이버 시작 중...\n")
    chrome_major = _get_chrome_ver()
    _log(f"    감지된 Chrome major: {chrome_major if chrome_major else '자동감지'}\n")
    opts = _uc.ChromeOptions()
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--start-maximized")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    try:
        if chrome_major:
            driver = _uc.Chrome(options=opts, version_main=chrome_major)
        else:
            driver = _uc.Chrome(options=opts)
        driver.implicitly_wait(3)
    except Exception as _e:
        import traceback as _tb
        _log(f"    [드라이버 오류] {_e}\n{_tb.format_exc()}\n")
        raise
    _log("    드라이버 준비 완료\n")

    # ── 페이지네이션 헬퍼 ─────────────────────────────────────────────────────
    def _num_page_btns():
        btns = driver.find_elements(_By.CSS_SELECTOR, PAGE_BTN_SEL)
        return [b for b in btns if (b.text or "").strip().isdigit()]

    def _click_page(target: str, timeout=5.0) -> bool:
        end_t = _time.time() + timeout
        while _time.time() < end_t:
            btns = _num_page_btns()
            btn  = next((b for b in btns if (b.text or "").strip() == target), None)
            if btn:
                try:
                    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
                    _time.sleep(0.2)
                    btn.click()
                    return True
                except (_SRE, Exception):
                    pass
            _time.sleep(0.2)
        return False

    def _wait_page_change(before_text: str, timeout=7.0) -> bool:
        end_t = _time.time() + timeout
        while _time.time() < end_t:
            try:
                elems = driver.find_elements(_By.CSS_SELECTOR, STREAM_SEL)
                after = (elems[0].text or "").strip() if elems else ""
                if after and after != before_text:
                    return True
            except Exception:
                pass
            _time.sleep(0.2)
        return False

    # ── 페이지 파싱 ───────────────────────────────────────────────────────────
    def _parse_page() -> list:
        soup = _BS(driver.page_source, "html.parser")
        rows = []
        for a in soup.select("a[href*='/streams/']"):
            btn = a.find("button")
            if not btn:
                continue
            cols = btn.find_all("div", recursive=False)
            if not cols:
                cols = btn.find_all("div")

            def _t(el):
                return el.get_text(strip=True) if el else ""

            def _n(el):
                s = _re.sub(r"[^\d]", "", _t(el))
                return int(s) if s else 0

            # 카테고리 / 제목
            col0 = cols[0] if cols else None
            divs = col0.find_all("div") if col0 else []
            cat_text   = _t(divs[0]) if len(divs) >= 1 else _t(col0)
            title_text = _t(divs[1]) if len(divs) >= 2 else ""

            # 기간 → 날짜 추출 (형식: "03.06 (금) 00:15 ~" — YYYY 없는 MM.DD)
            period   = _t(cols[1]) if len(cols) > 1 else ""
            date_m   = _re.search(r'(\d{1,2})\.(\d{2})', period)
            date_str = (f"{start_dt.year}-{int(date_m.group(1)):02d}-{int(date_m.group(2)):02d}"
                        if date_m else "")

            # 방송시간(h) → 분
            dur_text = _t(cols[2]) if len(cols) > 2 else ""
            dur_m    = _re.search(r'(\d+(?:\.\d+)?)', dur_text)
            dur_min  = int(float(dur_m.group(1)) * 60) if dur_m else 0

            peak = _n(cols[3]) if len(cols) > 3 else 0
            avg  = _n(cols[4]) if len(cols) > 4 else 0

            # 카테고리 필터
            if categories and cat_text and not any(c.lower() in cat_text.lower() for c in categories):
                continue

            rows.append({
                "creator":      creator_id,
                "platform":     platform.upper(),
                "title":        title_text,
                "category":     cat_text,
                "peak_viewers": peak,
                "avg_viewers":  avg,
                "date":         date_str,
                "duration_min": dur_min,
            })
        return rows

    # ── 메인 크롤링 루프 ──────────────────────────────────────────────────────
    results = []
    try:
        _log(f"    URL: {url}\n")
        driver.get(url)
        try:
            _Wait(driver, 15).until(
                _EC.presence_of_all_elements_located((_By.CSS_SELECTOR, STREAM_SEL))
            )
        except _TE:
            _log("    ⚠ 요소 대기 타임아웃 — 파싱 시도 계속\n")

        page = 1
        while not stop_event.is_set():
            _log(f"    {page}페이지 파싱 중...\n")
            rows = _parse_page()
            results.extend(rows)
            _log(f"    → {len(rows)}건\n")

            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            _time.sleep(0.5)

            next_page = str(page + 1)
            if not any((b.text or "").strip() == next_page for b in _num_page_btns()):
                break

            before = ""
            try:
                elems  = driver.find_elements(_By.CSS_SELECTOR, STREAM_SEL)
                before = (elems[0].text or "").strip() if elems else ""
            except Exception:
                pass

            if not _click_page(next_page):
                break

            _wait_page_change(before)
            page += 1
            _time.sleep(_rnd.uniform(2.0, 4.0))

    finally:
        try:
            driver.quit()
        except Exception:
            pass

    return results


# ── 라이브 지표 분석 탭 ────────────────────────────────────────────────────────
class LiveMetricsTab(tk.Frame):
    def __init__(self, master, app):
        super().__init__(master, bg=BG)
        self.app = app
        self._stop_event = threading.Event()
        self._thread = None
        self.live_results: list = []
        self._build()

    def _build(self):
        _section_header(self, "라이브 지표 분석",
                         "CHZZK / SOOP 방송 시청자 지표 수집  ·  viewership.softc.one")

        # ── 2단 레이아웃 ──────────────────────────────────────────────────────
        body = tk.Frame(self, bg=BG)
        body.pack(fill="both", expand=True)

        left = tk.Frame(body, bg=BG, padx=28)
        left.pack(side="left", fill="both", expand=True)

        right = tk.Frame(body, bg=BG, padx=14, pady=0, width=260)
        right.pack(side="right", fill="y")
        right.pack_propagate(False)

        # ── 크리에이터 ID 입력 ─────────────────────────────────────────────
        tk.Label(left, text="크리에이터 ID 목록  (한 줄에 하나)",
                 font=("Arial", 9, "bold"), bg=BG, fg=FG, anchor="w").pack(fill="x", pady=(16, 2))
        tk.Label(left,
                 text="형식:  chzzk:채널ID  /  soop:아이디  /  URL 전체 붙여넣기 가능",
                 font=("Arial", 8), bg=BG, fg=FG_DIM, anchor="w").pack(fill="x", pady=(0, 4))

        id_border = tk.Frame(left, bg=ACCENT, padx=1, pady=1)
        id_border.pack(fill="x")
        self.id_txt = tk.Text(id_border, height=6, font=("Consolas", 10),
                              bg=BG3, fg=FG, insertbackground=ACCENT,
                              relief="flat", padx=10, pady=8)
        self.id_txt.pack(fill="both")

        # ── 날짜 범위 ──────────────────────────────────────────────────────
        date_row = tk.Frame(left, bg=BG, pady=8)
        date_row.pack(fill="x")

        tk.Label(date_row, text="시작일", font=("Arial", 9, "bold"),
                 bg=BG, fg=FG).pack(side="left")
        self.start_date = tk.StringVar(
            value=(datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d"))
        tk.Entry(date_row, textvariable=self.start_date, width=12,
                 bg=BG3, fg=FG, insertbackground=ACCENT, relief="flat",
                 font=("Consolas", 10)).pack(side="left", padx=(6, 16))

        tk.Label(date_row, text="종료일", font=("Arial", 9, "bold"),
                 bg=BG, fg=FG).pack(side="left")
        self.end_date = tk.StringVar(value=datetime.now().strftime("%Y-%m-%d"))
        tk.Entry(date_row, textvariable=self.end_date, width=12,
                 bg=BG3, fg=FG, insertbackground=ACCENT, relief="flat",
                 font=("Consolas", 10)).pack(side="left", padx=(6, 20))

        for lbl, days in [("7일", 7), ("30일", 30), ("90일", 90), ("전체", None)]:
            def _set_period(d=days):
                end = datetime.now()
                start = (end - timedelta(days=d)) if d else datetime(2020, 1, 1)
                self.start_date.set(start.strftime("%Y-%m-%d"))
                self.end_date.set(end.strftime("%Y-%m-%d"))
            _btn(date_row, lbl, _set_period, padx=10, pady=4).pack(side="left", padx=2)

        # ── 플랫폼 선택 ───────────────────────────────────────────────────
        opt_row = tk.Frame(left, bg=BG, pady=2)
        opt_row.pack(fill="x")

        tk.Label(opt_row, text="기본 플랫폼", font=("Arial", 9, "bold"),
                 bg=BG, fg=FG).pack(side="left", padx=(0, 8))
        self.platform_var = tk.StringVar(value="chzzk")
        for val, lbl in [("chzzk", "CHZZK"), ("soop", "SOOP")]:
            tk.Radiobutton(opt_row, text=lbl, variable=self.platform_var, value=val,
                           bg=BG, fg=FG_DIM, activebackground=BG,
                           selectcolor=BG3, font=("Arial", 9),
                           activeforeground=FG).pack(side="left", padx=4)

        self.headless_var = tk.BooleanVar(value=False)  # 항상 창 띄움

        # ── 버튼 행 ───────────────────────────────────────────────────────
        btn_row = tk.Frame(left, bg=BG, pady=6)
        btn_row.pack(fill="x")

        self.run_btn = _btn(btn_row, "▶  수집 시작", self._run,
                            bg=ACCENT, fg="white", bold=True, padx=20, pady=10)
        self.run_btn.pack(side="left")

        self.stop_btn = _btn(btn_row, "■  중지", self._stop, padx=14, pady=10)
        self.stop_btn.configure(state="disabled")
        self.stop_btn.pack(side="left", padx=6)

        self.export_btn = _btn(btn_row, "⬇  Excel 내보내기", self._export,
                               padx=14, pady=10)
        self.export_btn.pack(side="left", padx=6)

        self._status_var = tk.StringVar(value="대기 중")
        tk.Label(btn_row, textvariable=self._status_var,
                 font=("Consolas", 9), bg=BG, fg=FG_DIM).pack(side="left", padx=14)

        # ── 결과 Treeview ─────────────────────────────────────────────────
        tk.Frame(left, bg=BORDER, height=1).pack(fill="x", pady=(4, 0))
        tk.Label(left, text="수집 결과",
                 font=("Arial", 9, "bold"), bg=BG, fg=FG, anchor="w").pack(fill="x", pady=(6, 4))

        tree_frame = tk.Frame(left, bg=BG)
        tree_frame.pack(fill="both", expand=True)

        cols = ("플랫폼", "방송 제목", "카테고리",
                "최고 시청자", "평균 시청자", "날짜", "방송시간(분)")
        widths = (55, 220, 110, 80, 80, 85, 70)
        self.result_tree = ttk.Treeview(tree_frame, columns=cols,
                                        show="headings", style="Dark.Treeview", height=10)
        for i, col in enumerate(cols):
            self.result_tree.heading(col, text=col)
            self.result_tree.column(col, width=widths[i], minwidth=40, anchor="w")

        vsb = ttk.Scrollbar(tree_frame, orient="vertical",   command=self.result_tree.yview)
        hsb = ttk.Scrollbar(tree_frame, orient="horizontal", command=self.result_tree.xview)
        self.result_tree.configure(yscrollcommand=vsb.set, xscrollcommand=hsb.set)
        self.result_tree.grid(row=0, column=0, sticky="nsew")
        vsb.grid(row=0, column=1, sticky="ns")
        hsb.grid(row=1, column=0, sticky="ew")
        tree_frame.grid_rowconfigure(0, weight=1)
        tree_frame.grid_columnconfigure(0, weight=1)

        # ── 우측: 카테고리 필터 + 로그 ────────────────────────────────────
        tk.Label(right, text="카테고리 필터",
                 font=("Arial", 9, "bold"), bg=BG, fg=FG, anchor="w").pack(fill="x", pady=(16, 2))
        tk.Label(right, text="(비워 두면 전체 수집)",
                 font=("Arial", 8), bg=BG, fg=FG_DIM, anchor="w").pack(fill="x", pady=(0, 4))

        cat_border = tk.Frame(right, bg=BORDER, padx=1, pady=1)
        cat_border.pack(fill="x")
        self.cat_txt = tk.Text(cat_border, height=5, font=("Consolas", 10),
                               bg=BG3, fg=FG, insertbackground=ACCENT,
                               relief="flat", padx=8, pady=6)
        self.cat_txt.pack(fill="both")

        tk.Label(right, text="실행 로그",
                 font=("Arial", 9, "bold"), bg=BG, fg=FG, anchor="w").pack(fill="x", pady=(14, 4))
        self.log_box = scrolledtext.ScrolledText(
            right, height=12, font=("Consolas", 9),
            bg="#0c0c0c", fg="#cccccc", insertbackground="white",
            relief="flat", padx=8, pady=6, state="disabled",
        )
        self.log_box.pack(fill="both", expand=True)
        self.log_box.tag_configure("ok",   foreground="#4ade80")
        self.log_box.tag_configure("err",  foreground="#f87171")
        self.log_box.tag_configure("info", foreground="#60a5fa")
        self.log_box.tag_configure("dim",  foreground="#555555")

        # 요약 통계 라벨
        self._summary_var = tk.StringVar(value="")
        tk.Label(right, textvariable=self._summary_var,
                 font=("Consolas", 8), bg=BG, fg=FG_DIM,
                 anchor="w", wraplength=240, justify="left").pack(fill="x", pady=(6, 0))

    # ── 로그 출력 ──────────────────────────────────────────────────────────
    def _log(self, msg: str, tag: str = ""):
        def _do():
            self.log_box.configure(state="normal")
            if not tag:
                low = msg.lower()
                if any(k in low for k in ["✓", "완료", "done"]):
                    t = "ok"
                elif any(k in low for k in ["✗", "오류", "error", "fail"]):
                    t = "err"
                elif msg.startswith("["):
                    t = "info"
                else:
                    t = "dim"
            else:
                t = tag
            self.log_box.insert("end", msg, t)
            self.log_box.see("end")
            self.log_box.configure(state="disabled")
        self.after(0, _do)

    # ── 입력 파싱 ──────────────────────────────────────────────────────────
    def _parse_ids(self) -> list:
        """
        textarea 내용을 (platform, creator_id) 튜플 리스트로 변환.
        지원 형식:
          chzzk:채널ID
          soop:아이디
          아이디          ← 기본 플랫폼 적용
        """
        default_plat = self.platform_var.get()
        lines = [
            ln.strip() for ln in self.id_txt.get("1.0", "end").splitlines()
            if ln.strip() and not ln.strip().startswith("#")
        ]
        result = []
        for line in lines:
            # viewership.softc.one URL 직접 붙여넣기 지원
            # 예: https://viewership.softc.one/channel/naverchzzk/ec857bee...
            if line.startswith("http"):
                import re as _re
                m = _re.search(r"softc\.one/channel/([^/]+)/([^/?#\s]+)", line)
                if m:
                    raw_plat, cid = m.group(1), m.group(2)
                    plat = "chzzk" if raw_plat == "naverchzzk" else raw_plat
                    if cid:
                        result.append((plat, cid))
                continue
            if ":" in line:
                plat, cid = line.split(":", 1)
                plat = plat.strip().lower()
                cid  = cid.strip().lstrip("@")
                if plat not in ("chzzk", "soop"):
                    plat = default_plat
            else:
                plat = default_plat
                cid  = line.lstrip("@").strip()
            if cid:
                result.append((plat, cid))
        return result

    # ── 수집 시작 ──────────────────────────────────────────────────────────
    def _run(self):
        creators = self._parse_ids()
        if not creators:
            messagebox.showwarning("입력 필요",
                                   "크리에이터 ID를 입력하세요.\n"
                                   "형식:  chzzk:채널ID  또는  soop:아이디")
            return

        try:
            start_dt = datetime.strptime(self.start_date.get(), "%Y-%m-%d")
            end_dt   = datetime.strptime(self.end_date.get(),   "%Y-%m-%d")
        except ValueError:
            messagebox.showerror("날짜 오류", "날짜 형식: YYYY-MM-DD")
            return

        if start_dt > end_dt:
            messagebox.showerror("날짜 오류", "시작일이 종료일보다 늦습니다.")
            return

        categories = [
            ln.strip() for ln in self.cat_txt.get("1.0", "end").splitlines()
            if ln.strip()
        ]

        # 초기화
        self.run_btn.configure(state="disabled")
        self.stop_btn.configure(state="normal", bg=ACCENT, fg="white")
        self._status_var.set("수집 중...")
        self._stop_event.clear()
        self.live_results = []
        self._summary_var.set("")

        for row in self.result_tree.get_children():
            self.result_tree.delete(row)

        self._log(
            f"[시작] 크리에이터 {len(creators)}명  "
            f"{self.start_date.get()} ~ {self.end_date.get()}\n",
            "info",
        )
        if categories:
            self._log(f"[필터] 카테고리: {', '.join(categories)}\n", "info")

        self._thread = threading.Thread(
            target=self._crawl_thread,
            args=(creators, start_dt, end_dt, categories),
            daemon=True,
        )
        self._thread.start()

    # ── 중지 ──────────────────────────────────────────────────────────────
    def _stop(self):
        self._stop_event.set()
        self._log("\n[중지] 중지 요청됨 — 현재 작업 완료 후 종료합니다.\n", "err")
        self._done()

    def _done(self):
        self.run_btn.configure(state="normal")
        self.stop_btn.configure(state="disabled", bg=BG3, fg=FG_DIM)

    # ── 크롤링 스레드 ──────────────────────────────────────────────────────
    def _crawl_thread(self, creators, start_dt, end_dt, categories):
        all_results = []
        total = len(creators)

        for idx, (platform, creator_id) in enumerate(creators, 1):
            if self._stop_event.is_set():
                break
            self._log(f"\n[{idx}/{total}]  {platform.upper()}:{creator_id}\n", "info")
            try:
                rows = _crawl_creator(
                    platform, creator_id, start_dt, end_dt,
                    categories, self._stop_event, progress_cb=self._log,
                )
                all_results.extend(rows)
                self._log(f"  ✓  {len(rows)}건 수집\n", "ok")

                for row in rows:
                    self.after(0, lambda r=row: self.result_tree.insert(
                        "", "end", values=(
                            r.get("platform",     ""),
                            r.get("title",        "")[:50],
                            r.get("category",     ""),
                            fmt_num(r.get("peak_viewers", 0)),
                            fmt_num(r.get("avg_viewers",  0)),
                            r.get("date",         ""),
                            r.get("duration_min", 0),
                        )
                    ))
            except Exception as exc:
                self._log(f"  ✗  오류: {exc}\n", "err")

        self.live_results = all_results
        count = len(all_results)

        # 요약
        if all_results:
            peak_avg = round(sum(r.get("peak_viewers", 0) for r in all_results) / count)
            avg_avg  = round(sum(r.get("avg_viewers",  0) for r in all_results) / count)
            cats     = [r.get("category", "") for r in all_results if r.get("category")]
            top_cat  = max(set(cats), key=cats.count) if cats else "-"
            summary  = (
                f"총 {count}건\n"
                f"평균 최고 시청자: {fmt_num(peak_avg)}\n"
                f"평균 시청자: {fmt_num(avg_avg)}\n"
                f"주요 카테고리: {top_cat}"
            )
            self.after(0, lambda: self._summary_var.set(summary))

        self._log(f"\n[완료]  총 {count}건 수집 완료\n", "ok")
        self.after(0, lambda: self._status_var.set(f"완료 ({count}건)"))
        self.after(0, self._done)

    # ── Excel 내보내기 ──────────────────────────────────────────────────────
    def _export(self):
        if not self.live_results:
            messagebox.showwarning("데이터 없음", "수집된 데이터가 없습니다.\n먼저 수집을 실행하세요.")
            return

        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = filedialog.asksaveasfilename(
            defaultextension=".xlsx",
            filetypes=[("Excel 파일", "*.xlsx")],
            initialfile=f"LiveMetrics_{ts}.xlsx",
        )
        if not path:
            return

        try:
            import openpyxl
            from openpyxl.styles import Font, PatternFill, Alignment
        except ImportError:
            messagebox.showerror("라이브러리 없음", "openpyxl 이 설치되어 있지 않습니다.\npip install openpyxl")
            return

        wb = openpyxl.Workbook()
        HDR_FILL = PatternFill("solid", fgColor="1A1A1A")
        HDR_FONT = Font(color="F4F4F5", bold=True)

        def _style_hdr(ws):
            for cell in ws[1]:
                cell.fill = HDR_FILL
                cell.font = HDR_FONT
                cell.alignment = Alignment(horizontal="center")

        # ── 방송 목록 시트 ────────────────────────────────────────────────
        ws = wb.active
        ws.title = "방송 목록"
        ws.append(["크리에이터", "플랫폼", "방송 제목", "카테고리",
                   "최고 시청자", "평균 시청자", "방송 날짜", "방송 시간(분)"])
        for r in self.live_results:
            ws.append([
                r.get("creator",      ""),
                r.get("platform",     ""),
                r.get("title",        ""),
                r.get("category",     ""),
                r.get("peak_viewers", 0),
                r.get("avg_viewers",  0),
                r.get("date",         ""),
                r.get("duration_min", 0),
            ])
        _style_hdr(ws)

        # ── 크리에이터 요약 시트 ──────────────────────────────────────────
        ws2 = wb.create_sheet("크리에이터 요약")
        ws2.append(["크리에이터", "플랫폼", "방송 수",
                    "총 최고 시청자", "평균 최고 시청자",
                    "평균 시청자", "주요 카테고리"])

        from collections import defaultdict
        creator_data: dict = defaultdict(list)
        for r in self.live_results:
            key = (r.get("creator", ""), r.get("platform", ""))
            creator_data[key].append(r)

        for (creator, platform), rows in sorted(creator_data.items()):
            peaks = [r.get("peak_viewers", 0) for r in rows]
            avgs  = [r.get("avg_viewers",  0) for r in rows]
            cats  = [r.get("category", "") for r in rows if r.get("category")]
            top_cat = max(set(cats), key=cats.count) if cats else ""
            ws2.append([
                creator,
                platform,
                len(rows),
                sum(peaks),
                round(sum(peaks) / len(peaks)) if peaks else 0,
                round(sum(avgs)  / len(avgs))  if avgs  else 0,
                top_cat,
            ])
        _style_hdr(ws2)

        # ── 카테고리 집계 시트 ────────────────────────────────────────────
        ws3 = wb.create_sheet("카테고리 집계")
        ws3.append(["카테고리", "방송 수", "평균 최고 시청자", "평균 시청자"])

        cat_data: dict = defaultdict(list)
        for r in self.live_results:
            cat = r.get("category", "기타") or "기타"
            cat_data[cat].append(r)

        for cat, rows in sorted(cat_data.items(), key=lambda x: -len(x[1])):
            peaks = [r.get("peak_viewers", 0) for r in rows]
            avgs  = [r.get("avg_viewers",  0) for r in rows]
            ws3.append([
                cat,
                len(rows),
                round(sum(peaks) / len(peaks)) if peaks else 0,
                round(sum(avgs)  / len(avgs))  if avgs  else 0,
            ])
        _style_hdr(ws3)

        wb.save(path)
        messagebox.showinfo("저장 완료", f"Excel 저장 완료\n{path}")


# ── 대시보드 탭 ───────────────────────────────────────────────────────────────
class DashboardTab(tk.Frame):
    def __init__(self, master, app):
        super().__init__(master, bg=BG)
        self.app = app
        self._current_sub = "channel"
        self._build()

    def _build(self):
        # 서브탭 헤더
        top = tk.Frame(self, bg=BG, padx=28, pady=14)
        top.pack(fill="x")
        tk.Label(top, text="데이터 대시보드", font=("Arial", 17, "bold"),
                 bg=BG, fg=FG, anchor="w").pack(side="left")

        self._excel_btn = _btn(top, "⬇  Excel 내보내기", self._export_excel,
                               padx=14, pady=7)
        self._excel_btn.pack(side="right")

        tk.Frame(self, bg=BORDER, height=1).pack(fill="x")

        # 서브탭 버튼
        sub_bar = tk.Frame(self, bg=BG2, padx=28, pady=0)
        sub_bar.pack(fill="x")
        self._sub_btns = {}
        for key, lbl in [("channel","채널 분석"), ("video","영상 분석"),
                         ("ad","광고 분석"), ("scraper","로컬 스크래퍼")]:
            btn = tk.Button(
                sub_bar, text=lbl,
                command=lambda k=key: self._switch_sub(k),
                font=("Arial", 9, "bold"), relief="flat", cursor="hand2",
                padx=16, pady=10,
            )
            btn.pack(side="left")
            self._sub_btns[key] = btn
        tk.Frame(self, bg=BORDER, height=1).pack(fill="x")

        # 컨텐츠 영역
        self._content = tk.Frame(self, bg=BG)
        self._content.pack(fill="both", expand=True)

        self._switch_sub("channel")

    def _switch_sub(self, key: str):
        self._current_sub = key
        for k, btn in self._sub_btns.items():
            if k == key:
                btn.configure(bg=ACCENT, fg="white")
            else:
                btn.configure(bg=BG2, fg=FG_DIM)
        for w in self._content.winfo_children():
            w.destroy()
        getattr(self, f"_build_{key}")()

    def show_channel(self):
        self._switch_sub("channel")

    def show_video(self):
        self._switch_sub("video")

    def show_ad(self):
        self._switch_sub("ad")

    # ── 채널 결과 ────────────────────────────────────────────────────────────
    def _build_channel(self):
        results = self.app.channel_results
        if not results:
            _label(self._content, "아직 채널 분석 결과가 없습니다.\n채널 통합 분석 탭에서 분석을 실행하세요.",
                   font_size=10, color=FG_DIM).pack(expand=True)
            return

        cols = ("채널명", "구독자", "쇼츠 avg", "쇼츠 수", "롱폼 avg", "롱폼 수", "상태")
        tree, _ = self._make_tree(cols, widths=(200,80,80,60,80,60,70))
        for r in results:
            tree.insert("", "end", values=(
                r.get("title", r.get("id","")),
                fmt_num(r.get("subscriberCount", 0)),
                fmt_num(r.get("avgShortsViews", 0)),
                r.get("shortsCount", 0),
                fmt_num(r.get("avgLongViews", 0)),
                r.get("longCount", 0),
                "완료" if r.get("status") == "completed" else f"오류: {r.get('error','')}",
            ), tags=(r.get("id",""),))

        def _on_select(e):
            sel = tree.selection()
            if not sel:
                return
            idx = tree.index(sel[0])
            if idx < len(results):
                self._show_channel_detail(results[idx])
        tree.bind("<<TreeviewSelect>>", _on_select)

    def _show_channel_detail(self, r):
        if r.get("status") != "completed":
            return
        win = tk.Toplevel(self.winfo_toplevel())
        win.title(f"{r.get('title','')}  —  채널 상세")
        win.geometry("900x620")
        win.configure(bg=BG)

        # 헤더
        hdr = tk.Frame(win, bg=BG2, padx=20, pady=14)
        hdr.pack(fill="x")
        tk.Label(hdr, text=r.get("title",""), font=("Arial", 14, "bold"),
                 bg=BG2, fg=FG).pack(side="left")
        tk.Label(hdr, text=f"구독자 {fmt_num(r.get('subscriberCount',0))}",
                 font=("Arial", 10), bg=BG2, fg=ACCENT).pack(side="left", padx=14)
        tk.Label(hdr, text=f"채널 ID: {r.get('id','')}",
                 font=("Consolas", 8), bg=BG2, fg=FG_DIM).pack(side="left")
        _btn(hdr, "YouTube에서 열기",
             lambda: webbrowser.open(f"https://youtube.com/channel/{r.get('id','')}"),
             padx=10, pady=6).pack(side="right")
        tk.Frame(win, bg=BORDER, height=1).pack(fill="x")

        nb = tk.Frame(win, bg=BG)
        nb.pack(fill="both", expand=True, padx=20, pady=10)

        # 쇼츠 / 롱폼 나란히
        left = tk.Frame(nb, bg=BG)
        left.pack(side="left", fill="both", expand=True, padx=(0,10))
        right = tk.Frame(nb, bg=BG)
        right.pack(side="left", fill="both", expand=True)

        def _video_section(parent, title, videos, avg, is_short):
            tk.Label(parent, text=f"{title}  ({len(videos)}개)  avg {fmt_num(avg)}",
                     font=("Arial", 10, "bold"), bg=BG, fg=FG).pack(anchor="w", pady=(0,6))
            tk.Frame(parent, bg=BORDER, height=1).pack(fill="x", pady=(0,6))
            cols = ("제목", "조회수", "게시일")
            tree, _ = self._make_tree(cols, widths=(220,70,80), parent=parent, height=12)
            for v in videos:
                pub = v.get("publishedAt","")[:10]
                tree.insert("", "end", values=(
                    v.get("title","")[:50],
                    fmt_num(v.get("viewCount",0)),
                    pub,
                ), tags=(v.get("id",""),))
            def _open(e):
                sel = tree.selection()
                if not sel:
                    return
                idx = tree.index(sel[0])
                if idx < len(videos):
                    vid = videos[idx]
                    url = (f"https://youtube.com/shorts/{vid['id']}"
                           if vid.get("isShort") else f"https://youtu.be/{vid['id']}")
                    webbrowser.open(url)
            tree.bind("<Double-Button-1>", _open)

        _video_section(left, "쇼츠", r.get("shortsList",[]),
                       r.get("avgShortsViews",0), True)
        _video_section(right, "롱폼", r.get("longsList",[]),
                       r.get("avgLongViews",0), False)

    # ── 영상 결과 ────────────────────────────────────────────────────────────
    def _build_video(self):
        results = self.app.video_results
        if not results:
            _label(self._content, "아직 영상 분석 결과가 없습니다.\n단일 영상 분석 탭에서 분석을 실행하세요.",
                   font_size=10, color=FG_DIM).pack(expand=True)
            return

        cols = ("영상 제목", "채널", "유형", "조회수", "좋아요", "댓글", "게시일")
        tree, _ = self._make_tree(cols, widths=(250,120,50,80,70,70,80))
        for r in results:
            tree.insert("", "end", values=(
                r.get("title","")[:60],
                r.get("channelTitle","")[:30],
                "쇼츠" if r.get("isShort") else "롱폼",
                fmt_num(r.get("viewCount",0)),
                fmt_num(r.get("likeCount",0)),
                fmt_num(r.get("commentCount",0)),
                r.get("publishedAt","")[:10],
            ), tags=(r.get("videoId",""),))

        def _open(e):
            sel = tree.selection()
            if not sel:
                return
            idx = tree.index(sel[0])
            if idx < len(results):
                v = results[idx]
                url = (f"https://youtube.com/shorts/{v['videoId']}"
                       if v.get("isShort") else f"https://youtube.com/watch?v={v['videoId']}")
                webbrowser.open(url)
        tree.bind("<Double-Button-1>", _open)

    # ── 광고 결과 ────────────────────────────────────────────────────────────
    def _build_ad(self):
        results = self.app.ad_results
        if not results:
            _label(self._content, "아직 광고 분석 결과가 없습니다.\n광고 영상 분석 탭에서 분석을 실행하세요.",
                   font_size=10, color=FG_DIM).pack(expand=True)
            return

        # 채널 요약 테이블
        cols = ("채널명", "광고 수", "총 조회수", "평균 조회수", "평균 좋아요", "상태")
        tree, _ = self._make_tree(cols, widths=(200,60,90,90,80,70), height=8)
        for r in results:
            tree.insert("", "end", values=(
                r.get("title", r.get("id","")),
                r.get("totalAdCount", 0),
                fmt_num(r.get("totalViews", 0)),
                fmt_num(r.get("avgViews", 0)),
                fmt_num(r.get("avgLikes", 0)),
                "완료" if r.get("status") == "completed" else f"오류",
            ), tags=(r.get("id",""),))

        def _on_select(e):
            sel = tree.selection()
            if not sel:
                return
            idx = tree.index(sel[0])
            if idx < len(results):
                self._show_ad_detail(results[idx])
        tree.bind("<<TreeviewSelect>>", _on_select)

    def _show_ad_detail(self, r):
        if not r.get("adVideos"):
            messagebox.showinfo("광고 없음", f"{r.get('title','')}에서 광고 영상이 감지되지 않았습니다.")
            return
        win = tk.Toplevel(self.winfo_toplevel())
        win.title(f"{r.get('title','')}  —  광고 영상 목록")
        win.geometry("860x540")
        win.configure(bg=BG)

        hdr = tk.Frame(win, bg=BG2, padx=20, pady=12)
        hdr.pack(fill="x")
        tk.Label(hdr, text=r.get("title",""), font=("Arial", 13, "bold"),
                 bg=BG2, fg=FG).pack(side="left")
        tk.Label(hdr, text=f"광고 {r.get('totalAdCount',0)}개 감지",
                 font=("Arial", 10), bg=BG2, fg=ACCENT).pack(side="left", padx=14)
        tk.Frame(win, bg=BORDER, height=1).pack(fill="x")

        cols = ("영상 제목", "유형", "조회수", "좋아요", "판별 근거", "신뢰도", "게시일")
        tree, _ = self._make_tree(cols, widths=(230,50,70,60,200,60,80), parent=win)
        for v in r.get("adVideos", []):
            det = v.get("detection", {})
            evidence = " / ".join(det.get("evidence", []))
            tree.insert("", "end", values=(
                v.get("title","")[:55],
                "쇼츠" if v.get("isShort") else "롱폼",
                fmt_num(v.get("viewCount",0)),
                fmt_num(v.get("likeCount",0)),
                evidence,
                f"{det.get('confidence',0)*100:.0f}%",
                v.get("publishedAt","")[:10],
            ))

        def _open(e):
            sel = tree.selection()
            if not sel:
                return
            ads = r.get("adVideos", [])
            idx = tree.index(sel[0])
            if idx < len(ads):
                v = ads[idx]
                url = (f"https://youtube.com/shorts/{v['id']}"
                       if v.get("isShort") else f"https://youtu.be/{v['id']}")
                webbrowser.open(url)
        tree.bind("<Double-Button-1>", _open)

    # ── 로컬 스크래퍼 결과 ───────────────────────────────────────────────────
    def _build_scraper(self):
        wrap = tk.Frame(self._content, bg=BG, padx=28, pady=14)
        wrap.pack(fill="both", expand=True)

        btn_row = tk.Frame(wrap, bg=BG, pady=6)
        btn_row.pack(fill="x")
        _btn(btn_row, "⟳  GitHub에서 결과 불러오기", self._load_scraper_results,
             padx=14, pady=8).pack(side="left")
        self._scraper_status = tk.StringVar(value="")
        tk.Label(btn_row, textvariable=self._scraper_status,
                 font=("Consolas", 9), bg=BG, fg=FG_DIM).pack(side="left", padx=10)

        cols = ("채널명", "채널 ID", "스크래핑 일시")
        self._scraper_tree, _ = self._make_tree(cols, widths=(200,180,140), parent=wrap)

    def _load_scraper_results(self):
        self._scraper_status.set("불러오는 중...")
        threading.Thread(target=self._fetch_scraper, daemon=True).start()

    def _fetch_scraper(self):
        try:
            import requests as req
            token, repo = _load_credentials()
            if not repo:
                raise ValueError("GITHUB_REPO 미설정")
            url = f"https://raw.githubusercontent.com/{repo}/main/results/index.json"
            r = req.get(url, timeout=15)
            r.raise_for_status()
            data = r.json()
            channels = data.get("channels", [])
            self.after(0, lambda: self._fill_scraper_tree(channels))
            self.after(0, lambda: self._scraper_status.set(f"총 {len(channels)}개"))
        except Exception as e:
            self.after(0, lambda: self._scraper_status.set(f"오류: {e}"))

    def _fill_scraper_tree(self, channels):
        for row in self._scraper_tree.get_children():
            self._scraper_tree.delete(row)
        for ch in channels:
            self._scraper_tree.insert("", "end", values=(
                ch.get("name", ""),
                ch.get("id", ""),
                ch.get("scrapedAt", "")[:19].replace("T", " "),
            ))

    # ── Treeview 생성 헬퍼 ───────────────────────────────────────────────────
    def _make_tree(self, cols, widths=None, parent=None, height=16):
        parent = parent or self._content
        frame = tk.Frame(parent, bg=BG)
        frame.pack(fill="both", expand=True, padx=20 if parent is self._content else 0,
                   pady=(10, 0))

        tree = ttk.Treeview(frame, columns=cols, show="headings",
                            style="Dark.Treeview", height=height)
        for i, col in enumerate(cols):
            w = widths[i] if widths and i < len(widths) else 100
            tree.heading(col, text=col)
            tree.column(col, width=w, minwidth=40, anchor="w")

        vsb = ttk.Scrollbar(frame, orient="vertical", command=tree.yview)
        hsb = ttk.Scrollbar(frame, orient="horizontal", command=tree.xview)
        tree.configure(yscrollcommand=vsb.set, xscrollcommand=hsb.set)

        tree.grid(row=0, column=0, sticky="nsew")
        vsb.grid(row=0, column=1, sticky="ns")
        hsb.grid(row=1, column=0, sticky="ew")
        frame.grid_rowconfigure(0, weight=1)
        frame.grid_columnconfigure(0, weight=1)

        return tree, frame

    # ── Excel 내보내기 ───────────────────────────────────────────────────────
    def _export_excel(self):
        sub = self._current_sub
        if sub == "channel" and not self.app.channel_results:
            messagebox.showwarning("데이터 없음", "채널 분석 결과가 없습니다.")
            return
        if sub == "video" and not self.app.video_results:
            messagebox.showwarning("데이터 없음", "영상 분석 결과가 없습니다.")
            return
        if sub == "ad" and not self.app.ad_results:
            messagebox.showwarning("데이터 없음", "광고 분석 결과가 없습니다.")
            return

        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        default_name = {
            "channel": f"TubeMetric_Channel_{ts}.xlsx",
            "video":   f"TubeMetric_Video_{ts}.xlsx",
            "ad":      f"TubeMetric_Ad_{ts}.xlsx",
            "scraper": f"TubeMetric_Scraper_{ts}.xlsx",
        }.get(sub, f"TubeMetric_{ts}.xlsx")

        path = filedialog.asksaveasfilename(
            defaultextension=".xlsx",
            filetypes=[("Excel 파일", "*.xlsx")],
            initialfile=default_name,
        )
        if not path:
            return

        try:
            import openpyxl
            from openpyxl.styles import Font, PatternFill, Alignment
        except ImportError:
            messagebox.showerror("라이브러리 없음", "openpyxl 이 설치되어 있지 않습니다.")
            return

        wb = openpyxl.Workbook()

        HDR_FILL = PatternFill("solid", fgColor="1A1A1A")
        HDR_FONT = Font(color="F4F4F5", bold=True)

        def _style_header(ws):
            for cell in ws[1]:
                cell.fill = HDR_FILL
                cell.font = HDR_FONT
                cell.alignment = Alignment(horizontal="center")

        if sub == "channel":
            ws = wb.active
            ws.title = "채널 요약"
            headers = ["채널 링크", "채널명", "채널 ID", "구독자 수",
                       "쇼츠 평균 조회수", "쇼츠 수", "롱폼 평균 조회수", "롱폼 수", "상태"]
            ws.append(headers)
            for r in self.app.channel_results:
                ws.append([
                    f"https://youtube.com/channel/{r.get('id','')}",
                    r.get("title",""),
                    r.get("id",""),
                    int(r.get("subscriberCount",0) or 0),
                    r.get("avgShortsViews",0),
                    r.get("shortsCount",0),
                    r.get("avgLongViews",0),
                    r.get("longCount",0),
                    "완료" if r.get("status") == "completed" else f"오류",
                ])
            _style_header(ws)

            for r in self.app.channel_results:
                if r.get("status") != "completed":
                    continue
                videos = r.get("shortsList",[]) + r.get("longsList",[])
                if not videos:
                    continue
                name = (r.get("title","")[:28]).replace("/","_")
                ws2 = wb.create_sheet(title=name or r.get("id","")[:28])
                ws2.append(["영상 링크","영상 제목","유형","조회수","게시일"])
                for v in videos:
                    url = (f"https://youtube.com/shorts/{v['id']}"
                           if v.get("isShort") else f"https://youtu.be/{v['id']}")
                    ws2.append([url, v.get("title",""), "쇼츠" if v.get("isShort") else "롱폼",
                                v.get("viewCount",0), v.get("publishedAt","")[:10]])
                _style_header(ws2)

        elif sub == "video":
            ws = wb.active
            ws.title = "영상 데이터"
            headers = ["영상 링크","영상 제목","채널명","유형","조회수","좋아요","댓글","게시일"]
            ws.append(headers)
            for r in self.app.video_results:
                url = (f"https://youtube.com/shorts/{r['videoId']}"
                       if r.get("isShort") else f"https://youtube.com/watch?v={r['videoId']}")
                ws.append([url, r.get("title",""), r.get("channelTitle",""),
                           "쇼츠" if r.get("isShort") else "롱폼",
                           r.get("viewCount",0), r.get("likeCount",0),
                           r.get("commentCount",0), r.get("publishedAt","")[:10]])
            _style_header(ws)

        elif sub == "ad":
            ws = wb.active
            ws.title = "광고 요약"
            headers = ["채널명","채널 ID","광고 수","총 조회수","평균 조회수","평균 좋아요","상태"]
            ws.append(headers)
            for r in self.app.ad_results:
                ws.append([
                    r.get("title",""), r.get("id",""),
                    r.get("totalAdCount",0), r.get("totalViews",0),
                    r.get("avgViews",0), r.get("avgLikes",0),
                    "완료" if r.get("status")=="completed" else "오류",
                ])
            _style_header(ws)

            for r in self.app.ad_results:
                if not r.get("adVideos"):
                    continue
                name = f"광고_{r.get('title','')[:24]}".replace("/","_")
                ws2 = wb.create_sheet(title=name[:28])
                ws2.append(["영상 링크","영상 제목","유형","조회수","좋아요","판별 근거","신뢰도","게시일"])
                for v in r["adVideos"]:
                    url = (f"https://youtube.com/shorts/{v['id']}"
                           if v.get("isShort") else f"https://youtu.be/{v['id']}")
                    det = v.get("detection",{})
                    ws2.append([
                        url, v.get("title",""),
                        "쇼츠" if v.get("isShort") else "롱폼",
                        v.get("viewCount",0), v.get("likeCount",0),
                        " / ".join(det.get("evidence",[])),
                        f"{det.get('confidence',0)*100:.0f}%",
                        v.get("publishedAt","")[:10],
                    ])
                _style_header(ws2)

        wb.save(path)
        messagebox.showinfo("저장 완료", f"Excel 파일이 저장되었습니다.\n{path}")


# ── 메인 앱 ──────────────────────────────────────────────────────────────────
class MainApp(tk.Frame):
    def __init__(self, master):
        super().__init__(master, bg=BG)
        self.channel_results = []
        self.video_results = []
        self.ad_results = []
        self._build_ui()

    def _build_ui(self):
        _apply_treeview_style()

        # 사이드바
        sidebar = tk.Frame(self, bg=BG2, width=200)
        sidebar.pack(side="left", fill="y")
        sidebar.pack_propagate(False)

        logo = tk.Frame(sidebar, bg=BG2, pady=22)
        logo.pack(fill="x")
        tk.Label(logo, text="⬤", font=("Arial", 14), bg=BG2, fg=ACCENT).pack()
        tk.Label(logo, text="TubeMetric", font=("Arial", 12, "bold"),
                 bg=BG2, fg=FG).pack()
        tk.Label(logo, text=f"@{MACHINE_INFO['operator']}",
                 font=("Arial", 8), bg=BG2, fg=FG_DIM).pack()

        tk.Frame(sidebar, bg=BORDER, height=1).pack(fill="x")

        self._tab_btns: dict[str, tk.Button] = {}
        for key, icon, label in [
            ("channel",  "📊", " 채널 통합 분석"),
            ("video",    "🎬", " 단일 영상 분석"),
            ("ad",       "📢", " 광고 영상 분석"),
            ("scraper",  "⚙",  " 로컬 스크래퍼"),
            ("live",     "📡", " 라이브 지표 분석"),
            ("dashboard","📋", " 데이터 대시보드"),
        ]:
            btn = tk.Button(
                sidebar, text=f"  {icon}{label}",
                command=lambda k=key: self.switch_tab(k),
                bg=BG2, fg=FG_DIM, activebackground=BG3,
                font=("Arial", 10), relief="flat",
                anchor="w", padx=14, pady=11, cursor="hand2",
            )
            btn.pack(fill="x")
            self._tab_btns[key] = btn

        mf = tk.Frame(sidebar, bg=BG2)
        mf.pack(side="bottom", fill="x", padx=14, pady=12)
        tk.Frame(mf, bg=BORDER, height=1).pack(fill="x", pady=(0, 8))
        tk.Label(mf, text=MACHINE_INFO["hostname"],
                 font=("Consolas", 8, "bold"), bg=BG2, fg=FG_DIM).pack(anchor="w")
        tk.Label(mf, text=MACHINE_INFO["os"].split()[0],
                 font=("Arial", 7), bg=BG2, fg=FG_MUTE).pack(anchor="w")

        # 컨텐츠
        self.content = tk.Frame(self, bg=BG)
        self.content.pack(side="left", fill="both", expand=True)

        self.dashboard = DashboardTab(self.content, self)

        self._pages = {
            "channel":   ChannelTab(self.content, self),
            "video":     VideoTab(self.content, self),
            "ad":        AdTab(self.content, self),
            "scraper":   ScraperTab(self.content, self),
            "live":      LiveMetricsTab(self.content, self),
            "dashboard": self.dashboard,
        }
        self.switch_tab("channel")

    def switch_tab(self, key: str):
        for k, btn in self._tab_btns.items():
            active = k == key
            btn.configure(
                bg=BG3 if active else BG2,
                fg=FG if active else FG_DIM,
                font=("Arial", 10, "bold") if active else ("Arial", 10),
            )
        for k, page in self._pages.items():
            if k == key:
                page.pack(fill="both", expand=True)
            else:
                page.pack_forget()


# ── App ───────────────────────────────────────────────────────────────────────
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("PARABLE-TUBEMETRIC  |  YouTube Analytics")
        self.geometry("1100x680")
        self.minsize(900, 560)
        self.configure(bg=BG)
        self._show_pin()

    def _show_pin(self):
        for w in self.winfo_children():
            w.destroy()
        PinScreen(self, on_success=self._show_main).pack(fill="both", expand=True)

    def _show_main(self):
        for w in self.winfo_children():
            w.destroy()
        MainApp(self).pack(fill="both", expand=True)


if __name__ == "__main__":
    App().mainloop()
