"""
PARABLE-TUBEMETRIC — Local Scraper Launcher

Vercel 대시보드와 동일한 UI/UX:
  - 검정 배경 + 레드 액센트
  - PIN 잠금 화면
  - 스크래핑 시작 시 CMD 스타일 콘솔 팝업 (완료 후 자동 닫힘)
  - 머신 정보(운영자/PC명) 자동 포함
"""
import sys
import threading
import socket
import getpass
import platform
from pathlib import Path
import tkinter as tk
from tkinter import scrolledtext, messagebox

# PyInstaller frozen path fix
if getattr(sys, 'frozen', False):
    SCRIPT_DIR = Path(sys.executable).parent
else:
    SCRIPT_DIR = Path(__file__).parent

TARGETS_FILE = SCRIPT_DIR / "targets.txt"

# ── 색상 팔레트 (Vercel 대시보드 스타일) ─────────────────────────────────────
BG      = "#0a0a0a"
BG2     = "#111111"
BG3     = "#1a1a1a"
BORDER  = "#222222"
FG      = "#f4f4f5"
FG_DIM  = "#71717a"
ACCENT  = "#dc2626"
ACCENT2 = "#ef4444"
GREEN   = "#22c55e"

PIN_CORRECT = "5350"

MACHINE_INFO = {
    "operator": getpass.getuser(),
    "hostname": socket.gethostname(),
    "os": f"{platform.system()} {platform.release()}",
}


# ── 인증 정보 로드 ─────────────────────────────────────────────────────────────
def _load_credentials() -> tuple[str, str]:
    """(token, repo) 로드. config.py → .env → 환경변수 순."""
    try:
        from config import get_github_token, GITHUB_REPO
        token = get_github_token()
        if token:
            return token, GITHUB_REPO
    except ImportError:
        pass
    import os
    try:
        from dotenv import load_dotenv
        env = SCRIPT_DIR / ".env"
        if env.exists():
            load_dotenv(env)
    except ImportError:
        pass
    return os.environ.get("GITHUB_TOKEN", ""), os.environ.get("GITHUB_REPO", "")


# ── ConsoleWindow (CMD 스타일 팝업) ───────────────────────────────────────────
class ConsoleWindow(tk.Toplevel):
    """스크래핑 시작 시 팝업, 완료 후 5초 뒤 자동 닫힘."""

    def __init__(self, master):
        super().__init__(master)
        self.title("PARABLE-TUBEMETRIC  |  스크래핑 실행 중")
        self.geometry("760x460")
        self.configure(bg="#0c0c0c")
        self.resizable(True, True)
        self._closed = False
        self.protocol("WM_DELETE_WINDOW", self._on_close)

        # 제목 바
        bar = tk.Frame(self, bg="#161616")
        bar.pack(fill="x")
        tk.Label(
            bar,
            text="  ■  PARABLE-TUBEMETRIC  —  스크래핑 실행 중",
            font=("Consolas", 9, "bold"),
            bg="#161616", fg="#555", pady=7, anchor="w",
        ).pack(fill="x", padx=4)

        # 로그 영역
        self.log = scrolledtext.ScrolledText(
            self, font=("Consolas", 10),
            bg="#0c0c0c", fg="#cccccc",
            insertbackground="white",
            relief="flat", padx=14, pady=10,
            state="disabled",
        )
        self.log.pack(fill="both", expand=True)
        self.log.tag_configure("ok",    foreground="#4ade80")
        self.log.tag_configure("err",   foreground="#f87171")
        self.log.tag_configure("info",  foreground="#60a5fa")
        self.log.tag_configure("done",  foreground="#4ade80", font=("Consolas", 10, "bold"))

    def append(self, text: str):
        def _do():
            self.log.configure(state="normal")
            tag = ""
            low = text.lower()
            if any(k in low for k in ["완료", "✓", "push 완료", "done"]):
                tag = "ok"
            elif any(k in low for k in ["오류", "error", "fail", "✗"]):
                tag = "err"
            elif text.startswith("["):
                tag = "info"
            self.log.insert("end", text, tag or "")
            self.log.see("end")
            self.log.configure(state="disabled")
        self.after(0, _do)

    def finish(self, success: bool = True):
        """완료 메시지 출력 후 5초 뒤 자동 닫기."""
        if success:
            msg = "\n✓  스크래핑 완료  —  5초 후 창이 닫힙니다.\n"
        else:
            msg = "\n✗  오류 발생  —  5초 후 창이 닫힙니다.\n"
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
    """Vercel 잠금 화면과 동일한 스타일."""

    def __init__(self, master, on_success):
        super().__init__(master, bg=BG)
        self.on_success = on_success
        self._build()

    def _build(self):
        center = tk.Frame(self, bg=BG)
        center.place(relx=0.5, rely=0.5, anchor="center")

        # 아이콘
        icon = tk.Frame(center, bg=ACCENT, width=78, height=78)
        icon.pack_propagate(False)
        icon.pack(pady=(0, 18))
        tk.Label(icon, text="🔒", font=("Arial", 30), bg=ACCENT, fg="white").pack(expand=True)

        # 제목
        tk.Label(center, text="PARABLE-", font=("Arial", 26, "bold"),
                 bg=BG, fg=FG).pack()
        tk.Label(center, text="TUBEMETRIC", font=("Arial", 26, "bold"),
                 bg=BG, fg=ACCENT).pack()
        tk.Label(center, text="SYSTEM  LOCKED", font=("Arial", 8, "bold"),
                 bg=BG, fg=FG_DIM, pady=6).pack()

        tk.Frame(center, height=16, bg=BG).pack()

        # 입력 필드
        border = tk.Frame(center, bg=BORDER, padx=1, pady=1)
        border.pack(fill="x", pady=(0, 10))
        self._pin = tk.StringVar()
        self._entry = tk.Entry(
            border, textvariable=self._pin,
            show="●", font=("Consolas", 24, "bold"),
            bg=BG3, fg=FG, insertbackground=ACCENT,
            relief="flat", justify="center", width=11,
        )
        self._entry.pack(ipady=14, ipadx=20)
        self._entry.bind("<Return>", lambda _: self._submit())
        self._entry.focus()

        # 버튼
        tk.Button(
            center, text="UNLOCK  →",
            command=self._submit,
            bg=ACCENT, fg="white", activebackground=ACCENT2,
            font=("Arial", 11, "bold"), relief="flat",
            cursor="hand2", pady=12,
        ).pack(fill="x")

        tk.Label(center, text="AUTHORIZED ACCESS ONLY",
                 font=("Arial", 7, "bold"), bg=BG, fg="#27272a",
                 pady=14).pack()

    def _submit(self):
        if self._pin.get() == PIN_CORRECT:
            self.on_success()
        else:
            self._entry.configure(bg="#2d0a0a")
            self.after(500, lambda: self._entry.configure(bg=BG3))
            self._pin.set("")


# ── 메인 앱 ──────────────────────────────────────────────────────────────────
class MainApp(tk.Frame):

    def __init__(self, master):
        super().__init__(master, bg=BG)
        self._inline_driver = None
        self._console_win: ConsoleWindow | None = None
        self._build_ui()
        self._load_targets()
        self._refresh_cred_status()

    # ── UI 빌드 ───────────────────────────────────────────────────────────────

    def _build_ui(self):
        # 사이드바
        sidebar = tk.Frame(self, bg=BG2, width=192)
        sidebar.pack(side="left", fill="y")
        sidebar.pack_propagate(False)

        # 로고
        logo = tk.Frame(sidebar, bg=BG2, pady=22)
        logo.pack(fill="x")
        tk.Label(logo, text="⬤", font=("Arial", 14), bg=BG2, fg=ACCENT).pack()
        tk.Label(logo, text="TubeMetric", font=("Arial", 12, "bold"),
                 bg=BG2, fg=FG).pack()
        tk.Label(logo, text=f"@{MACHINE_INFO['operator']}",
                 font=("Arial", 8), bg=BG2, fg=FG_DIM).pack()

        tk.Frame(sidebar, bg=BORDER, height=1).pack(fill="x")

        # 네비 버튼
        self._tab_btns: dict[str, tk.Button] = {}
        for key, icon, label in [
            ("scraper", "⚙", " 로컬 스크래퍼"),
        ]:
            btn = tk.Button(
                sidebar, text=f"  {icon}  {label}",
                command=lambda k=key: self._switch_tab(k),
                bg=BG2, fg=FG_DIM, activebackground=BG3,
                font=("Arial", 10), relief="flat",
                anchor="w", padx=14, pady=13, cursor="hand2",
            )
            btn.pack(fill="x")
            self._tab_btns[key] = btn

        # 머신 정보 (하단)
        mf = tk.Frame(sidebar, bg=BG2)
        mf.pack(side="bottom", fill="x", padx=14, pady=12)
        tk.Frame(mf, bg=BORDER, height=1).pack(fill="x", pady=(0, 8))
        tk.Label(mf, text=MACHINE_INFO["hostname"],
                 font=("Consolas", 8, "bold"), bg=BG2, fg=FG_DIM).pack(anchor="w")
        tk.Label(mf, text=MACHINE_INFO["os"].split()[0],
                 font=("Arial", 7), bg=BG2, fg="#3f3f46").pack(anchor="w")

        # 콘텐츠 영역
        self.content = tk.Frame(self, bg=BG)
        self.content.pack(side="left", fill="both", expand=True)

        self._pages: dict[str, tk.Frame] = {
            "scraper": self._build_scraper_page(),
        }
        self._switch_tab("scraper")

    def _switch_tab(self, key: str):
        for k, btn in self._tab_btns.items():
            active = k == key
            btn.configure(
                bg=BG3 if active else BG2,
                fg=FG if active else FG_DIM,
                font=("Arial", 10, "bold") if active else ("Arial", 10),
            )
        for k, page in self._pages.items():
            page.pack(fill="both", expand=True) if k == key else page.pack_forget()

    def _section_header(self, parent, title: str, subtitle: str = "") -> tk.Frame:
        f = tk.Frame(parent, bg=BG, pady=20, padx=28)
        f.pack(fill="x")
        tk.Label(f, text=title, font=("Arial", 17, "bold"),
                 bg=BG, fg=FG, anchor="w").pack(fill="x")
        if subtitle:
            tk.Label(f, text=subtitle, font=("Arial", 9),
                     bg=BG, fg=FG_DIM, anchor="w").pack(fill="x", pady=(2, 0))
        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x")
        return f

    def _build_scraper_page(self) -> tk.Frame:
        page = tk.Frame(self.content, bg=BG)
        self._section_header(
            page, "로컬 스크래퍼",
            "undetected-chromedriver  →  GitHub push  →  대시보드 반영"
        )

        wrap = tk.Frame(page, bg=BG, padx=28)
        wrap.pack(fill="both", expand=True)

        # 채널 목록 입력
        tk.Label(wrap, text="채널 목록  (한 줄에 하나, # 은 주석)",
                 font=("Arial", 9, "bold"), bg=BG, fg=FG,
                 anchor="w").pack(fill="x", pady=(18, 5))

        border = tk.Frame(wrap, bg=ACCENT, padx=1, pady=1)
        border.pack(fill="x")
        self.ch_txt = tk.Text(
            border, height=6, font=("Consolas", 10),
            bg=BG3, fg=FG, insertbackground=ACCENT,
            relief="flat", padx=10, pady=8,
        )
        self.ch_txt.pack(fill="both")

        # 옵션
        opt = tk.Frame(wrap, bg=BG, pady=10)
        opt.pack(fill="x")
        self.headless   = tk.BooleanVar(value=False)
        self.auto_push  = tk.BooleanVar(value=True)

        for var, label in [
            (self.headless,  "헤드리스  (Chrome 창 없이 백그라운드 실행)"),
            (self.auto_push, "완료 후 GitHub push"),
        ]:
            f = tk.Frame(opt, bg=BG)
            f.pack(side="left", padx=(0, 22))
            tk.Checkbutton(
                f, text=label, variable=var,
                fg=FG_DIM, bg=BG, activebackground=BG,
                selectcolor=BG3, font=("Arial", 9),
                activeforeground=FG,
            ).pack(side="left")

        # 버튼 행
        btn_row = tk.Frame(wrap, bg=BG, pady=4)
        btn_row.pack(fill="x")

        self.run_btn = tk.Button(
            btn_row, text="▶  스크래핑 시작",
            command=self._run,
            bg=ACCENT, fg="white", activebackground=ACCENT2,
            font=("Arial", 11, "bold"), relief="flat",
            padx=20, pady=10, cursor="hand2",
        )
        self.run_btn.pack(side="left")

        self.stop_btn = tk.Button(
            btn_row, text="■  중지",
            command=self._stop, state="disabled",
            bg=BG3, fg=FG_DIM, activebackground="#27272a",
            font=("Arial", 10), relief="flat",
            padx=14, pady=10, cursor="hand2",
        )
        self.stop_btn.pack(side="left", padx=8)

        tk.Button(
            btn_row, text="채널 목록 저장",
            command=self._save_targets,
            bg=BG3, fg=FG_DIM, activebackground="#27272a",
            font=("Arial", 9), relief="flat",
            padx=12, pady=10, cursor="hand2",
        ).pack(side="right")

        # 상태 표시줄
        status_bar = tk.Frame(wrap, bg=BG3, padx=14, pady=8)
        status_bar.pack(fill="x", pady=(10, 4))

        self._status = tk.StringVar(value="대기 중")
        tk.Label(status_bar, text="상태", font=("Arial", 8, "bold"),
                 bg=BG3, fg=FG_DIM).pack(side="left")
        tk.Label(status_bar, textvariable=self._status,
                 font=("Consolas", 9, "bold"), bg=BG3, fg=ACCENT).pack(side="left", padx=8)
        tk.Label(status_bar, text=f"PC: {MACHINE_INFO['hostname']}",
                 font=("Consolas", 8), bg=BG3, fg="#3f3f46").pack(side="right")

        # 자격증명 상태
        self._cred_var = tk.StringVar()
        tk.Label(wrap, textvariable=self._cred_var,
                 font=("Arial", 8), bg=BG, fg=FG_DIM, anchor="w").pack(fill="x", pady=(4, 0))

        return page

    # ── 헬퍼 ─────────────────────────────────────────────────────────────────

    def _refresh_cred_status(self):
        token, repo = _load_credentials()
        if token and repo:
            self._cred_var.set(f"✓  GitHub 인증 확인됨  —  {repo}")
        elif token:
            self._cred_var.set("⚠  GITHUB_REPO 설정이 없습니다")
        else:
            self._cred_var.set("✗  GitHub 토큰 없음  —  config.py 에 토큰을 설정하고 exe를 재빌드하세요")

    def _load_targets(self):
        if not TARGETS_FILE.exists():
            return
        lines = [
            ln.strip()
            for ln in TARGETS_FILE.read_text("utf-8").splitlines()
            if ln.strip() and not ln.strip().startswith("#")
        ]
        self.ch_txt.delete("1.0", "end")
        self.ch_txt.insert("1.0", "\n".join(lines))

    def _save_targets(self):
        content = self.ch_txt.get("1.0", "end").strip()
        TARGETS_FILE.write_text(
            "# 스크래핑할 채널 목록\n# 한 줄에 하나씩\n\n" + content + "\n",
            encoding="utf-8",
        )
        messagebox.showinfo("저장 완료", "채널 목록이 저장되었습니다.")

    def _get_channels(self) -> list[str]:
        return [
            ln.strip()
            for ln in self.ch_txt.get("1.0", "end").splitlines()
            if ln.strip() and not ln.strip().startswith("#")
        ]

    # ── 실행 / 중지 ──────────────────────────────────────────────────────────

    def _run(self):
        channels = self._get_channels()
        if not channels:
            messagebox.showwarning("채널 없음", "채널 핸들을 입력하세요.\n예: @채널핸들")
            return

        self.run_btn.configure(state="disabled")
        self.stop_btn.configure(state="normal", bg=ACCENT, fg="white")
        self._status.set("실행 중...")

        # 콘솔 팝업 오픈
        win = ConsoleWindow(self.winfo_toplevel())
        self._console_win = win
        win.append(f"[시작] 채널: {', '.join(channels)}\n")
        win.append(f"[머신] {MACHINE_INFO['hostname']} / {MACHINE_INFO['operator']}\n")
        win.append("─" * 62 + "\n\n")

        threading.Thread(
            target=self._scrape_inline,
            args=(channels, self.headless.get(), self.auto_push.get()),
            daemon=True,
        ).start()

    def _scrape_inline(self, channels: list[str], headless: bool, do_push: bool):
        """스크래퍼를 인-프로세스로 실행. print() 출력을 콘솔 팝업으로 연결."""
        import contextlib

        win = self._console_win

        class _Writer:
            def __init__(self, log_fn):
                self._log = log_fn
                self._buf = ""

            def write(self, text: str):
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
                            result["scrapedBy"] = MACHINE_INFO   # 머신 정보 포함
                            cid = result["channelId"]
                            if do_push:
                                save_and_push(result, "channels", cid)
                            else:
                                save_result(result, "channels", cid)
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


# ── App (PIN → Main) ──────────────────────────────────────────────────────────
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("PARABLE-TUBEMETRIC")
        self.geometry("900x580")
        self.minsize(720, 480)
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
