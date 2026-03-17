# PARABLE-TUBEMETRIC 버전 기록

> 이 파일은 git push 시 자동으로 업데이트됩니다.

---

## 2026-03-17 — claude/review-implementation-G01bp
**CI 스크래퍼 핵심 버그 수정**
  - fix: run_scraper_ci.py — `opts` → `options` 키 수정 (프론트엔드 연동 복구)
  - fix: run_scraper_ci.py — RESULTS_DIR 경로 재설정으로 결과 누락 방지
  - fix: run_scraper_ci.py — TikTok `extract_flat: False`로 전체 메타데이터 수집
  - feat: local_server.py — TikTok 큐 타입 핸들러 추가
  - fix: scraper.yml — `mkdir -p results/` 및 `git rm` 에러 방지

## 2026-03-16 — main
**Instagram 스크래퍼 전환**
  - refactor: Instagram 분석을 undetected-chromedriver에서 instagrapi로 교체
  - update: build-exe.yml — EXE 빌드 워크플로우 수정
  - update: requirements.txt, PARABLE-TUBEMETRIC.spec

## 2026-03-13 — main
**초기 구조 및 launcher_gui.py 반복 개선**
  - update: launcher_gui.py — 다수 UI/기능 업데이트
  - update: requirements.txt
