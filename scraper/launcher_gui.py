"""
PARABLE-TUBEMETRIC GUI 런처
더블클릭 → 자동 패키지 설치 → 채널 스크래핑 → GitHub push → Vercel 자동 반영
"""
import sys
import subprocess
import threading
from pathlib import Path
import tkinter as tk
from tkinter import scrolledtext, messagebox

SCRIPT_DIR = Path(__file__).parent
ROOT = SCRIPT_DIR.parent
TARGETS_FILE      = SCRIPT_DIR / "targets.txt"
REQUIREMENTS_FILE = SCRIPT_DIR / "requirements.txt"
LOCAL_SERVER      = SCRIPT_DIR / "local_server.py"


# ── 패키지 확인/설치 ──────────────────────────────────────────────────────────

def _python() -> str:
    return sys.executable


def _pkgs_ok() -> bool:
    try:
        import undetected_chromedriver  # noqa
        import selenium               # noqa
        import requests               # noqa
        return True
    except ImportError:
        return False


def _install_pkgs(log_fn) -> bool:
    log_fn("[설치] 필요한 패키지를 설치합니다... (최초 1회, 1~3분 소요)\n")
    proc = subprocess.run(
        [_python(), "-m", "pip", "install", "--upgrade", "pip", "-q"],
        capture_output=True, text=True,
    )
    proc = subprocess.run(
        [_python(), "-m", "pip", "install", "-r", str(REQUIREMENTS_FILE)],
        capture_output=True, text=True, cwd=str(SCRIPT_DIR),
    )
    if proc.returncode == 0:
        log_fn("[설치] 완료! 모든 패키지가 준비되었습니다.\n\n")
        return True
    log_fn(f"[오류] 설치 실패:\n{proc.stderr}\n")
    return False


# ── GUI ───────────────────────────────────────────────────────────────────────

BG       = "#0f0f1a"
BG2      = "#1a1a2e"
BG3      = "#1e1e30"
FG       = "#d4d4d4"
FG_DIM   = "#888aaa"
ACCENT   = "#7c83fd"
GREEN    = "#4CAF50"
RED      = "#e53935"
DARK     = "#37474f"


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("PARABLE-TUBEMETRIC  |  YouTube 채널 스크래퍼")
        self.geometry("740x700")
        self.minsize(600, 560)
        self.configure(bg=BG)
        self._proc        = None   # 스크래퍼 프로세스
        self._server_proc = None   # 로컬 서버 프로세스
        self._build_ui()
        self._load_targets()
        # 백그라운드에서 패키지 확인
        threading.Thread(target=self._check_pkgs, daemon=True).start()

    # ── UI 빌드 ───────────────────────────────────────────────────────────────

    def _build_ui(self):
        # 헤더
        hdr = tk.Frame(self, bg=BG2, pady=14)
        hdr.pack(fill="x")
        tk.Label(hdr, text="PARABLE-TUBEMETRIC",
                 font=("Arial", 15, "bold"), fg=ACCENT, bg=BG2).pack()
        tk.Label(hdr,
                 text="YouTube 채널 스크래퍼  →  GitHub push  →  Vercel 자동 반영",
                 font=("Arial", 9), fg=FG_DIM, bg=BG2).pack()

        # 채널 입력
        ch_wrap = tk.Frame(self, bg=BG)
        ch_wrap.pack(fill="x", padx=12, pady=(10, 0))
        tk.Label(ch_wrap, text="채널 목록  (한 줄에 하나, # 은 주석)",
                 fg=FG_DIM, bg=BG, anchor="w").pack(fill="x")
        ch_border = tk.Frame(ch_wrap, bg=ACCENT, bd=1)
        ch_border.pack(fill="x", pady=(3, 0))
        self.ch_txt = tk.Text(
            ch_border, height=5, font=("Consolas", 10),
            bg=BG3, fg=FG, insertbackground="white",
            relief="flat", padx=8, pady=6,
        )
        self.ch_txt.pack(fill="both")

        # 옵션
        opt = tk.Frame(self, bg=BG)
        opt.pack(fill="x", padx=12, pady=8)
        self.headless = tk.BooleanVar(value=False)
        self.push     = tk.BooleanVar(value=True)
        for var, label, tip in [
            (self.headless, "헤드리스 모드", "Chrome 창 없이 백그라운드 실행"),
            (self.push,     "자동 push",     "GitHub push → Vercel 자동 반영"),
        ]:
            f = tk.Frame(opt, bg=BG)
            f.pack(side="left", padx=(0, 18))
            tk.Checkbutton(
                f, text=label, variable=var,
                fg=FG, bg=BG, activebackground=BG, activeforeground="white",
                selectcolor=BG3, font=("Arial", 9),
            ).pack(side="left")
            tk.Label(f, text=f"({tip})", font=("Arial", 8),
                     fg=FG_DIM, bg=BG).pack(side="left")

        # 버튼 행
        btn_row = tk.Frame(self, bg=BG)
        btn_row.pack(fill="x", padx=12, pady=(0, 8))

        self.run_btn = tk.Button(
            btn_row, text="▶  스크래핑 시작",
            command=self._run,
            bg=GREEN, fg="white", activebackground="#45a049",
            font=("Arial", 10, "bold"), relief="flat",
            padx=16, pady=7, cursor="hand2",
        )
        self.run_btn.pack(side="left")

        self.stop_btn = tk.Button(
            btn_row, text="■  중지",
            command=self._stop, state="disabled",
            bg=RED, fg="white", activebackground="#c62828",
            font=("Arial", 10), relief="flat",
            padx=12, pady=7, cursor="hand2",
        )
        self.stop_btn.pack(side="left", padx=6)

        tk.Button(
            btn_row, text="채널 목록 저장",
            command=self._save_targets,
            bg=DARK, fg="white", relief="flat",
            padx=10, pady=7, cursor="hand2",
        ).pack(side="right")

        # ── 서버 모드 구분선 ──────────────────────────────────────────────────
        sep = tk.Frame(self, bg="#2a2a3e", height=1)
        sep.pack(fill="x", padx=12, pady=(6, 0))

        srv_row = tk.Frame(self, bg=BG)
        srv_row.pack(fill="x", padx=12, pady=6)

        tk.Label(
            srv_row,
            text="서버 모드  (Vercel 사이트에서 요청 수신 → 자동 스크래핑)",
            font=("Arial", 9), fg=FG_DIM, bg=BG,
        ).pack(side="left")

        self.server_status = tk.StringVar(value="")
        tk.Label(srv_row, textvariable=self.server_status,
                 font=("Arial", 9, "bold"), fg="#4CAF50", bg=BG).pack(side="left", padx=6)

        srv_btn_row = tk.Frame(self, bg=BG)
        srv_btn_row.pack(fill="x", padx=12, pady=(0, 4))

        self.start_srv_btn = tk.Button(
            srv_btn_row, text="▶  서버 시작",
            command=self._start_server,
            bg="#1565C0", fg="white", activebackground="#0d47a1",
            font=("Arial", 9, "bold"), relief="flat",
            padx=12, pady=5, cursor="hand2",
        )
        self.start_srv_btn.pack(side="left")

        self.stop_srv_btn = tk.Button(
            srv_btn_row, text="■  서버 중지",
            command=self._stop_server, state="disabled",
            bg="#37474f", fg="white", activebackground="#263238",
            font=("Arial", 9), relief="flat",
            padx=10, pady=5, cursor="hand2",
        )
        self.stop_srv_btn.pack(side="left", padx=5)

        tk.Label(
            srv_btn_row,
            text="※ GITHUB_TOKEN / GITHUB_REPO 환경변수 필요",
            font=("Arial", 8), fg="#555577", bg=BG,
        ).pack(side="left", padx=8)

        # 로그 영역
        tk.Label(self, text="실행 로그", fg=FG_DIM, bg=BG, anchor="w",
                 padx=12).pack(fill="x")
        self.log = scrolledtext.ScrolledText(
            self, font=("Consolas", 9),
            bg="#121212", fg=FG, insertbackground="white",
            relief="flat", padx=8, pady=6, state="disabled",
        )
        self.log.pack(fill="both", expand=True, padx=12, pady=(2, 0))

        # 상태바
        self.status = tk.StringVar(value="초기화 중...")
        tk.Label(
            self, textvariable=self.status,
            relief="flat", anchor="w", padx=10, pady=5,
            bg=BG2, fg=FG_DIM,
        ).pack(fill="x", side="bottom")

    # ── 헬퍼 ─────────────────────────────────────────────────────────────────

    def _log(self, text: str):
        def _do():
            self.log.configure(state="normal")
            self.log.insert("end", text)
            self.log.see("end")
            self.log.configure(state="disabled")
        self.after(0, _do)

    def _set_status(self, text: str):
        self.after(0, lambda: self.status.set(text))

    # ── 패키지 자동 설치 ──────────────────────────────────────────────────────

    def _check_pkgs(self):
        self._set_status("패키지 확인 중...")
        if not _pkgs_ok():
            ok = _install_pkgs(self._log)
            if ok:
                self._set_status("준비 완료  ✓  (패키지 자동 설치 완료)")
            else:
                self._set_status("패키지 설치 실패 — 로그를 확인하세요")
                self.after(0, lambda: messagebox.showerror(
                    "설치 오류",
                    "패키지 설치에 실패했습니다.\n\n"
                    "인터넷 연결을 확인하거나\n"
                    "CMD에서 다음 명령을 실행하세요:\n\n"
                    f"  pip install -r scraper\\requirements.txt",
                ))
        else:
            self._set_status("준비 완료")
            self._log("[준비] 모든 패키지가 설치되어 있습니다.\n")

    # ── targets.txt ──────────────────────────────────────────────────────────

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
            messagebox.showwarning("채널 없음",
                                   "채널 핸들을 입력하세요.\n예: @채널핸들")
            return

        cmd = [_python(), str(SCRIPT_DIR / "main.py")]
        if self.headless.get():
            cmd.append("--headless")
        if self.push.get():
            cmd.append("--push")
        cmd += ["channel"] + channels

        self.run_btn.configure(state="disabled")
        self.stop_btn.configure(state="normal")
        self._set_status("실행 중...")
        self._log("\n" + "─" * 52 + "\n")
        self._log(f"[시작] 대상 채널: {', '.join(channels)}\n")
        if self.push.get():
            self._log("[설정] GitHub push 활성화 → 완료 후 Vercel 자동 반영\n")
        self._log("─" * 52 + "\n\n")

        def _worker():
            try:
                self._proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    cwd=str(SCRIPT_DIR),
                    bufsize=1,
                    encoding="utf-8",
                    errors="replace",
                )
                for line in self._proc.stdout:
                    self._log(line)
                rc = self._proc.wait()
                self._log(f"\n[완료] 종료 코드: {rc}\n")
                if rc == 0:
                    msg = "스크래핑 완료!"
                    if self.push.get():
                        msg += "  GitHub push 완료 → Vercel에서 결과 확인 가능"
                    self._set_status(msg)
                else:
                    self._set_status("오류 발생 — 로그를 확인하세요")
            except Exception as e:
                self._log(f"\n[오류] {e}\n")
                self._set_status("오류 발생")
            finally:
                self.after(0, self._done)

        threading.Thread(target=_worker, daemon=True).start()

    def _stop(self):
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
            self._log("\n[중지] 사용자가 중지했습니다.\n")
        self._done()

    def _done(self):
        self._proc = None
        self.run_btn.configure(state="normal")
        self.stop_btn.configure(state="disabled")

    # ── 서버 모드 ─────────────────────────────────────────────────────────────

    def _start_server(self):
        import os
        token = os.environ.get("GITHUB_TOKEN", "")
        repo  = os.environ.get("GITHUB_REPO", "")
        if not token or not repo:
            messagebox.showwarning(
                "환경 변수 없음",
                "서버 모드에 필요한 환경 변수가 없습니다.\n\n"
                "CMD에서 다음과 같이 설정 후 재실행하세요:\n\n"
                "  set GITHUB_TOKEN=ghp_...\n"
                "  set GITHUB_REPO=owner/repo-name\n\n"
                "또는 launcher_gui.py 와 같은 폴더에\n"
                ".env 파일을 만들어 값을 적어도 됩니다.",
            )
            return

        self._server_proc = subprocess.Popen(
            [_python(), str(LOCAL_SERVER)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=str(SCRIPT_DIR),
            encoding="utf-8",
            errors="replace",
            env=os.environ.copy(),
        )
        self.start_srv_btn.configure(state="disabled")
        self.stop_srv_btn.configure(state="normal")
        self.server_status.set("● 실행 중")
        self._log("\n" + "─" * 52 + "\n")
        self._log("[서버] 로컬 서버 시작됨 — Vercel 요청을 기다립니다.\n")
        self._log("─" * 52 + "\n\n")
        threading.Thread(target=self._poll_server, daemon=True).start()

    def _poll_server(self):
        if self._server_proc is None:
            return
        for line in self._server_proc.stdout:
            self._log(line)
        # 프로세스 종료됨
        self.after(0, self._server_done)

    def _stop_server(self):
        if self._server_proc and self._server_proc.poll() is None:
            self._server_proc.terminate()
            self._log("\n[서버] 중지됨.\n")
        self._server_done()

    def _server_done(self):
        self._server_proc = None
        self.start_srv_btn.configure(state="normal")
        self.stop_srv_btn.configure(state="disabled")
        self.server_status.set("")


# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app = App()
    app.mainloop()
