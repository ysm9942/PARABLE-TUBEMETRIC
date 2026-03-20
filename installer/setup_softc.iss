[Setup]
AppName=TubeMetric SoftC Scraper
AppVersion=1.1
AppPublisher=TubeMetric
AppPublisherURL=https://github.com/ysm9942/PARABLE-TUBEMETRIC
DefaultDirName={autopf}\TubeMetric SoftC Scraper
DefaultGroupName=TubeMetric SoftC Scraper
OutputBaseFilename=TubeMetric-SoftC-Scraper-Setup-Windows
OutputDir=Output
Compression=lzma
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\softc-scraper.exe
PrivilegesRequired=lowest

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[CustomMessages]
korean.WelcomeLabel1=TubeMetric SoftC Scraper 설치
korean.WelcomeLabel2=이 프로그램은 라이브 지표를 PC의 Chrome으로 직접 수집합니다.%n%n설치를 계속하려면 [다음]을 클릭하세요.

[Files]
Source: "dist\softc-scraper.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\TubeMetric SoftC Scraper 시작";  Filename: "{app}\softc-scraper.exe"
Name: "{group}\TubeMetric SoftC Scraper 제거";  Filename: "{uninstallexe}"
; 시작프로그램: Windows 부팅 시 자동 실행
Name: "{userstartup}\TubeMetric SoftC Scraper"; Filename: "{app}\softc-scraper.exe"

[Run]
Filename: "{app}\softc-scraper.exe"; \
  Description: "TubeMetric SoftC Scraper를 지금 시작합니다 (권장)"; \
  Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "taskkill.exe"; Parameters: "/F /IM softc-scraper.exe"; Flags: runhidden

[Messages]
WelcomeLabel1=TubeMetric SoftC Scraper 설치에 오신 것을 환영합니다
WelcomeLabel2=이 프로그램은 CHZZK / SOOP 라이브 지표를 PC의 Chrome으로 수집합니다.%n%nundetected_chromedriver 기반으로 bot 감지 우회 수집이 가능합니다.%n%n설치 후 Windows 시작 시 자동으로 실행됩니다.%n%n설치를 계속하려면 [다음]을 클릭하세요.
FinishedLabel=TubeMetric SoftC Scraper 설치가 완료되었습니다.%n%n이제 TubeMetric 사이트의 [라이브 지표 분석] 탭에서 로컬 에이전트 모드로 수집할 수 있습니다.
