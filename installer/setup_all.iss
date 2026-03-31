[Setup]
AppName=TubeMetric 에이전트 (전체)
AppVersion=1.1
AppPublisher=TubeMetric
AppPublisherURL=https://github.com/ysm9942/PARABLE-TUBEMETRIC
DefaultDirName={autopf}\TubeMetric
DefaultGroupName=TubeMetric
OutputBaseFilename=TubeMetric-All-Agents-Setup-Windows
OutputDir=Output
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Files]
; 라이브 지표 분석 에이전트 (포트 8001, Playwright)
Source: "dist\tubemetric-agent.exe";  DestDir: "{app}"; Flags: ignoreversion
; SoftC 라이브 에이전트 (포트 8002, headless=False Chrome, bot 감지 우회)
Source: "dist\softc-scraper.exe";     DestDir: "{app}"; Flags: ignoreversion
; Instagram + TikTok 분석 에이전트 (포트 8003)
Source: "dist\instagram-scraper.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; 시작 메뉴
Name: "{group}\TubeMetric 라이브 에이전트";           Filename: "{app}\tubemetric-agent.exe"
Name: "{group}\TubeMetric SoftC 에이전트";            Filename: "{app}\softc-scraper.exe"
Name: "{group}\TubeMetric Instagram·TikTok 에이전트"; Filename: "{app}\instagram-scraper.exe"
Name: "{group}\TubeMetric 에이전트 제거";             Filename: "{uninstallexe}"
; Windows 시작 시 자동 실행
Name: "{userstartup}\TubeMetric Live Agent";           Filename: "{app}\tubemetric-agent.exe"
Name: "{userstartup}\TubeMetric SoftC Agent";          Filename: "{app}\softc-scraper.exe"
Name: "{userstartup}\TubeMetric Instagram Agent";      Filename: "{app}\instagram-scraper.exe"

[Run]
; 설치 완료 후 세 에이전트 모두 즉시 실행
Filename: "{app}\tubemetric-agent.exe"; \
  Description: "라이브 지표 에이전트 시작 (포트 8001)"; \
  Flags: nowait postinstall skipifsilent
Filename: "{app}\softc-scraper.exe"; \
  Description: "SoftC 에이전트 시작 (포트 8002)"; \
  Flags: nowait postinstall skipifsilent
Filename: "{app}\instagram-scraper.exe"; \
  Description: "Instagram·TikTok 에이전트 시작 (포트 8003)"; \
  Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "taskkill.exe"; Parameters: "/F /IM tubemetric-agent.exe";  Flags: runhidden
Filename: "taskkill.exe"; Parameters: "/F /IM softc-scraper.exe";     Flags: runhidden
Filename: "taskkill.exe"; Parameters: "/F /IM instagram-scraper.exe"; Flags: runhidden

[Messages]
WelcomeLabel1=TubeMetric 에이전트 설치에 오신 것을 환영합니다
WelcomeLabel2=이 설치 파일은 TubeMetric 로컬 분석에 필요한 모든 에이전트를 한 번에 설치합니다.%n%n포함 항목:%n  · 라이브 지표 분석 에이전트 (포트 8001)%n  · Instagram 분석 에이전트 (포트 8003)%n  · TikTok 분석 에이전트 (포트 8003, Instagram과 통합)%n%nPython 및 모든 패키지가 내장되어 있어 별도 설치가 필요 없습니다.%n%n설치 후 Windows 시작 시 자동으로 실행됩니다.%n%n설치를 계속하려면 [다음]을 클릭하세요.
FinishedLabel=TubeMetric 에이전트 설치가 완료되었습니다.%n%n이제 TubeMetric 사이트에서 라이브 지표, Instagram, TikTok 분석을 모두 사용할 수 있습니다.
