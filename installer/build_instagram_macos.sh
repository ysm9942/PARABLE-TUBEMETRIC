#!/bin/bash
# macOS .pkg 빌드 스크립트 — TubeMetric Instagram Scraper
set -e

APP_NAME="TubeMetric Instagram Scraper"
BUNDLE_ID="com.tubemetric.instagram-scraper"
VERSION="1.0"
DIST_DIR="dist"

echo "=== TubeMetric Instagram Scraper macOS PKG 빌드 ==="

# 1. PyInstaller 빌드
echo "[1/4] PyInstaller 빌드..."
pyinstaller instagram_scraper.spec --clean

# 2. .app 번들
echo "[2/4] .app 번들 생성..."
APP_DIR="${DIST_DIR}/${APP_NAME}.app"
mkdir -p "${APP_DIR}/Contents/MacOS"
mkdir -p "${APP_DIR}/Contents/Resources"

cp "${DIST_DIR}/instagram-scraper" "${APP_DIR}/Contents/MacOS/instagram-scraper"
chmod +x "${APP_DIR}/Contents/MacOS/instagram-scraper"

cat > "${APP_DIR}/Contents/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>instagram-scraper</string>
  <key>CFBundleIdentifier</key>
  <string>${BUNDLE_ID}</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
EOF

# LaunchAgent (로그인 시 자동 실행)
LAUNCH_AGENT_DIR="${DIST_DIR}/pkg_root/Library/LaunchAgents"
mkdir -p "${LAUNCH_AGENT_DIR}"

cat > "${LAUNCH_AGENT_DIR}/${BUNDLE_ID}.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${BUNDLE_ID}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Applications/TubeMetric Instagram Scraper.app/Contents/MacOS/instagram-scraper</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>/tmp/tubemetric-instagram.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/tubemetric-instagram-err.log</string>
</dict>
</plist>
EOF

APPS_DIR="${DIST_DIR}/pkg_root/Applications"
mkdir -p "${APPS_DIR}"
cp -r "${APP_DIR}" "${APPS_DIR}/"

# 3. PKG 패키징
echo "[3/4] PKG 패키징..."
pkgbuild \
  --root "${DIST_DIR}/pkg_root" \
  --identifier "${BUNDLE_ID}" \
  --version "${VERSION}" \
  --install-location "/" \
  "${DIST_DIR}/TubeMetric-Instagram-Agent-Setup-macOS.pkg"

echo "[4/4] 완료!"
echo "생성된 파일: ${DIST_DIR}/TubeMetric-Instagram-Agent-Setup-macOS.pkg"
