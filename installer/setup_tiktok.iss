[Setup]
AppName=TubeMetric TikTok Scraper
AppVersion=1.0
AppPublisher=TubeMetric
AppPublisherURL=https://github.com/ysm9942/PARABLE-TUBEMETRIC
DefaultDirName={autopf}\TubeMetric TikTok Scraper
DefaultGroupName=TubeMetric TikTok Scraper
OutputBaseFilename=TubeMetric-TikTok-Agent-Setup-Windows
OutputDir=Output
Compression=lzma
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\tiktok-scraper.exe
PrivilegesRequired=lowest

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Files]
Source: "dist\tiktok-scraper.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\TubeMetric TikTok Scraper 시작";  Filename: "{app}\tiktok-scraper.exe"
Name: "{group}\TubeMetric TikTok Scraper 제거";  Filename: "{uninstallexe}"
; 시작프로그램: Windows 부팅 시 자동 실행
Name: "{userstartup}\TubeMetric TikTok Scraper"; Filename: "{app}\tiktok-scraper.exe"

[Run]
Filename: "{app}\tiktok-scraper.exe"; \
  Description: "TubeMetric TikTok Scraper를 지금 시작합니다 (권장)"; \
  Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "taskkill.exe"; Parameters: "/F /IM tiktok-scraper.exe"; Flags: runhidden

[Messages]
WelcomeLabel1=TubeMetric TikTok Scraper 설치에 오신 것을 환영합니다
WelcomeLabel2=이 프로그램은 TikTok 동영상 조회수를 PC의 Chrome으로 수집합니다.%n%nundetected_chromedriver 기반으로 bot 감지 우회 수집이 가능합니다.%n%n설치 후 Windows 시작 시 자동으로 실행됩니다.%n%n설치를 계속하려면 [다음]을 클릭하세요.
FinishedLabel=TubeMetric TikTok Scraper 설치가 완료되었습니다.%n%n이제 TubeMetric 사이트의 [TikTok 분석] 탭에서 로컬 에이전트 모드로 수집할 수 있습니다.
