[Setup]
AppName=TubeMetric Local Agent
AppVersion=1.0
AppPublisher=TubeMetric
AppPublisherURL=https://github.com/ysm9942/PARABLE-TUBEMETRIC
DefaultDirName={autopf}\TubeMetric
DefaultGroupName=TubeMetric
OutputBaseFilename=TubeMetric-Agent-Setup-Windows
OutputDir=Output
Compression=lzma
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\tubemetric-agent.exe
PrivilegesRequired=lowest

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[CustomMessages]
korean.WelcomeLabel1=TubeMetric Local Agent 설치
korean.WelcomeLabel2=이 프로그램은 라이브 지표 수집을 위해 PC에서 실행되는 소형 서버입니다.%n%n설치를 계속하려면 [다음]을 클릭하세요.

[Files]
Source: "dist\tubemetric-agent.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; 시작 메뉴
Name: "{group}\TubeMetric Agent 시작"; Filename: "{app}\tubemetric-agent.exe"
Name: "{group}\TubeMetric Agent 제거"; Filename: "{uninstallexe}"
; 시작프로그램 (Windows 부팅 시 자동 실행)
Name: "{userstartup}\TubeMetric Agent"; Filename: "{app}\tubemetric-agent.exe"

[Run]
; 설치 완료 후 바로 실행
Filename: "{app}\tubemetric-agent.exe"; \
  Description: "TubeMetric Agent를 지금 시작합니다 (권장)"; \
  Flags: nowait postinstall skipifsilent

[UninstallRun]
; 제거 시 프로세스 종료
Filename: "taskkill.exe"; Parameters: "/F /IM tubemetric-agent.exe"; Flags: runhidden

[Messages]
; 한국어 메시지 커스터마이징
WelcomeLabel1=TubeMetric Local Agent 설치에 오신 것을 환영합니다
WelcomeLabel2=이 프로그램은 라이브 지표 수집을 위해 PC에서 실행되는 소형 서버입니다.%n%n설치 후 Windows 시작 시 자동으로 실행됩니다.%n%n설치를 계속하려면 [다음]을 클릭하세요.
FinishedLabel=TubeMetric Local Agent 설치가 완료되었습니다.%n%n이제 TubeMetric 사이트에서 라이브 지표를 수집할 수 있습니다.
