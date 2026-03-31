#!/bin/bash
# macOS 통합 PKG 빌드 스크립트
# 라이브 지표(8001) + SoftC(8002) + Instagram·TikTok(8003) 에이전트를 하나의 .pkg로 패키징
set -e

BUNDLE_ID_LIVE="com.tubemetric.local-agent"
BUNDLE_ID_SOFTC="com.tubemetric.softc-scraper"
BUNDLE_ID_IG="com.tubemetric.instagram-scraper"
VERSION="1.2"
DIST_DIR="dist"
PKG_ROOT="${DIST_DIR}/pkg_root_all"

echo "=== TubeMetric All Agents macOS PKG 빌드 ==="

# ── 1. PyInstaller 빌드 (세 스펙 순서대로) ────────────────────────────────
echo "[1/5] PyInstaller: tubemetric-agent 빌드..."
pyinstaller tubemetric.spec --clean

echo "[1/5] PyInstaller: softc-scraper 빌드..."
pyinstaller softc_scraper.spec --clean

echo "[1/5] PyInstaller: instagram-scraper 빌드..."
pyinstaller instagram_scraper.spec --clean

# ── 2. PKG 루트 디렉터리 초기화 ─────────────────────────────────────────
echo "[2/5] PKG 루트 디렉터리 초기화..."
rm -rf "${PKG_ROOT}"
mkdir -p "${PKG_ROOT}/Applications"
mkdir -p "${PKG_ROOT}/Library/LaunchAgents"

# ── 3. .app 번들 생성 함수 ───────────────────────────────────────────────
make_app() {
  local EXE_NAME="$1"
  local APP_DISPLAY="$2"
  local BUNDLE_ID="$3"
  local LOG_SUFFIX="$4"

  local APP_DIR="${DIST_DIR}/${APP_DISPLAY}.app"
  mkdir -p "${APP_DIR}/Contents/MacOS"
  mkdir -p "${APP_DIR}/Contents/Resources"

  cp "${DIST_DIR}/${EXE_NAME}" "${APP_DIR}/Contents/MacOS/${EXE_NAME}"
  chmod +x "${APP_DIR}/Contents/MacOS/${EXE_NAME}"

  cat > "${APP_DIR}/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${EXE_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>${BUNDLE_ID}</string>
  <key>CFBundleName</key>
  <string>${APP_DISPLAY}</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
PLIST

  # LaunchAgent: 로그인 시 자동 실행
  cat > "${PKG_ROOT}/Library/LaunchAgents/${BUNDLE_ID}.plist" << LAGENT
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${BUNDLE_ID}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Applications/${APP_DISPLAY}.app/Contents/MacOS/${EXE_NAME}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>/tmp/tubemetric-${LOG_SUFFIX}.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/tubemetric-${LOG_SUFFIX}-err.log</string>
</dict>
</plist>
LAGENT

  cp -r "${APP_DIR}" "${PKG_ROOT}/Applications/"
  echo "  ✅ ${APP_DISPLAY}.app 생성 완료"
}

# ── 4. 각 에이전트 .app 생성 ─────────────────────────────────────────────
echo "[3/5] .app 번들 생성..."
make_app "tubemetric-agent"  "TubeMetric Live Agent"             "${BUNDLE_ID_LIVE}"  "live"
make_app "softc-scraper"     "TubeMetric SoftC Agent"            "${BUNDLE_ID_SOFTC}" "softc"
make_app "instagram-scraper" "TubeMetric Instagram TikTok Agent" "${BUNDLE_ID_IG}"    "instagram"

# ── 5. 통합 PKG 빌드 ─────────────────────────────────────────────────────
echo "[4/5] 통합 PKG 패키징..."
pkgbuild \
  --root "${PKG_ROOT}" \
  --identifier "com.tubemetric.all-agents" \
  --version "${VERSION}" \
  --install-location "/" \
  "${DIST_DIR}/TubeMetric-All-Agents-Setup-macOS.pkg"

echo "[5/5] 완료!"
echo "생성된 파일: ${DIST_DIR}/TubeMetric-All-Agents-Setup-macOS.pkg"
