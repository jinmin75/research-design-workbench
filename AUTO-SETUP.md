# 필요한 도구 자동 준비

Windows 배포본 v0.10.0과 개인 연결기 v1.2.0은 시작할 때 필요한 도구를 확인합니다. 학생은 통합 ZIP 한 개를 일반 폴더에 풀고 `시작.cmd`를 실행하면 됩니다. `Start.cmd`도 같은 기능입니다. 별도의 연결기 ZIP이나 체크섬 파일을 받을 필요가 없습니다. 공유 연구 웹앱의 개인 연결기만 사용하는 경우에는 `Start-Connector.cmd`를 실행합니다.

## 설치 범위

- 앱을 실행할 Node.js 22 이상을 먼저 찾습니다. 없거나 사용할 수 없으면 공식 Node.js 24.22.0 ZIP을 내려받습니다.
- GPT 구독 연결에 사용할 Codex와 Claude 구독 연결에 사용할 Claude Code를 찾습니다. 없는 도구는 공식 고정 npm 패키지로 준비합니다.
- Gemini는 API 키 방식입니다. Gemini CLI는 설치하지 않습니다.

기본 저장 위치는 `%LOCALAPPDATA%\ResearchWorkbench\tools`입니다. 관리자 권한을 요청하거나 시스템 PATH를 수정하지 않습니다. 현재 시작 과정과 자식 프로세스에만 실행 경로를 전달합니다. 기존 프로젝트와 공식 도구의 계정 인증 파일을 설치 파일에 복사하지 않습니다.

첫 준비에는 인터넷과 다운로드 공간이 필요합니다. 학교 PC의 실행 제한이나 네트워크 정책은 이 프로그램이 해제하지 않습니다. 이미 사용할 수 있는 도구는 재사용합니다. Windows x64와 ARM64를 구분하며 다른 운영체제의 자동 설치는 제공하지 않습니다.

## 설치와 로그인은 별도입니다

설치가 끝나면 작업실에서 **GPT / Codex 로그인 시작**, **Claude 로그인 시작**을 눌러 본인 계정으로 로그인합니다. 실제 버튼 표시는 상세 안내를 따릅니다. 로그인 창을 열었다는 사실이나 설치 성공만으로 구독 사용 권한과 모델 응답 성공이 확인되지는 않습니다.

Gemini는 작업실의 API 설정에서 본인 키와 이용 조건을 확인합니다. 키는 실행 중 메모리에만 보관합니다. 설치 프로그램은 API 키를 요구하지 않습니다. 구독·API의 요금과 한도는 각 제공자의 조건을 따릅니다.

## 실패와 다시 준비하기

`Setup.cmd`로 누락되거나 실패한 도구의 준비를 다시 시도할 수 있습니다. 이미 작업실을 실행했다면 저장한 뒤 `Stop.cmd`로 종료하고 `Start.cmd`로 다시 시작합니다. 개인 연결기는 `Stop-Connector.cmd`로 종료하고 `Start-Connector.cmd`로 다시 시작합니다. 새 도구를 설치해도 실행 중인 서버가 기억한 경로는 자동으로 바뀌지 않습니다.

Node 준비가 실패하면 앱을 시작할 수 없습니다. GPT·Claude 준비만 실패하면 일반 연구 안내·계산·저장 기능은 계속 사용할 수 있습니다. 실패한 제공자로 실제 요청이 성공한 것처럼 표시하지 않습니다. 네트워크를 복구한 뒤 다시 실행하거나, 승인된 PC에서 이용하세요.

고급 실행 옵션은 Windows PowerShell에서 사용합니다. 일반 학생은 직접 입력할 필요가 없습니다.

```powershell
# AI 도구 설치를 건너뛰고 일반 연구 기능 시작
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Launch.ps1 -CoreOnly

# 다운로드 없이 이미 준비된 도구만 확인
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Setup.ps1 -Offline
```

## 다운로드 검증과 유지보수

앱의 `dependency-lock.json`에 Node ZIP의 SHA-256, 제공자 npm 패키지의 정확한 버전·URL·SHA-512를 보관합니다. Node ZIP은 해시를 확인한 뒤 해제합니다. npm 설치에서는 자동 설치 스크립트를 막고 패키지 목록과 무결성을 확인한 뒤 필요한 Claude 후처리만 실행합니다. 마지막에는 각 도구의 버전 명령을 실행해 실제 시작 여부를 확인합니다.

이 검사는 고정 배포 바이트의 무결성과 실행 여부를 확인합니다. 외부 도구의 전체 보안성·공급망·향후 호환성을 보증하지 않습니다. 기존 설치를 재사용할 때는 그 도구의 업데이트 정책이 적용됩니다. 연구 원문이나 인증 파일은 공개 ZIP에 포함하지 않습니다.

고정판은 Node 24.22.0, Codex 0.163.0, Claude Code 2.1.303입니다. 버전 변경은 공식 근거 확인과 회귀 검사 뒤 새 배포판에서 반영합니다. 배포 후에도 제공자 변경에 따른 유지보수는 필요합니다.

## 설치 방식의 공식 근거

2026-10-19 확인. 앱 전용 폴더·무결성 검사·실패 처리 방식은 이 제품의 구현 선택입니다.

- [Node 공식 24.22.0 배포 파일과 체크섬](https://nodejs.org/dist/v24.22.0/): x64·ARM64 ZIP을 사용합니다.
- [Codex 공식 설치 안내](https://github.com/openai/codex/blob/rust-v0.163.0/README.md), [0.163.0 패키지 등록부](https://registry.npmjs.org/@openai/codex/0.163.0): 공식 npm 배포를 사용합니다.
- [Claude Code 설치 문서](https://code.claude.com/docs/en/setup#install-with-npm), [2.1.303 패키지 등록부](https://registry.npmjs.org/@anthropic-ai/claude-code/2.1.303): npm은 네이티브 바이너리를 설치하며 Node 22 이상과 선택 의존성 설치가 필요합니다. 네이티브 Windows는 Git Bash·WSL·관리자 권한을 필수로 요구하지 않습니다.
- [npm 설치 폴더 규칙](https://docs.npmjs.com/cli/v11/configuring-npm/folders/): 전용 prefix를 사용해 기존 전역 패키지와 분리합니다.

현재 검사의 통과·실패·미실시와 실제 학생 PC 검증 범위는 [배포 검사](RELEASE-VERIFICATION.md)에 따릅니다. 실제 연구 진행은 [상세한 사용법 및 활용법](<상세한 사용법 및 활용법.md>)을 참고하세요.
