# Nookrew · 누크루

AI에게 일을 맡겼는데, 기다리는 건 나였습니다. 채팅창만 보고 기다리는 시간이 심심하고, 세션이 늘어나니 누가 끝났는지도 헷갈려서 작은 사무실을 만들었습니다.

**Your little AI office.** by **miscforge · 잡동사니대장간** — 일단 만들고 생각합니다.

![Nookrew](media/02-office.png)

## 설치 · Windows / macOS / Linux 무료 베타

**Codex에 아래 문장만 보내세요.** 로컬 실행이 가능한 Codex 대화에서 사용합니다.

```text
https://github.com/hw01931/nookrew
이 저장소의 Nookrew 플러그인을 사용자 공용으로 설치하고, 지금 작업 폴더의 사무실을 열어줘. README의 공식 Codex 설치 명령을 사용하고 프로젝트마다 다시 설치하지 마.
```

Codex가 저장소 안내를 읽고 아래 두 공식 명령으로 설치할 수 있습니다. 설치 후 Nookrew를 선택해 `시작` 또는 `start`라고 입력하면 됩니다. 호스트가 설치·실행 승인을 요청하면 확인하세요. 안내를 읽은 것과 실행 성공은 다르므로 반환된 설치 결과와 사무실 URL을 확인합니다.

이미 miscforge를 등록한 사용자는 `codex plugin marketplace upgrade miscforge`로 목록을 갱신하세요.

직접 설치할 때의 공식 CLI:

```powershell
codex plugin marketplace add https://github.com/hw01931/nookrew.git
codex plugin add nookrew@miscforge
```

플러그인 선택에서 **Nookrew**를 고른 뒤 **시작** 또는 **start**라고 입력하세요. 한 번 설치하면 다른 로컬 작업 폴더에서도 사용합니다. 최초 실행 권한 검토는 호스트 정책을 따릅니다. 일반 텍스트 멘션과 실제 플러그인 선택은 다를 수 있습니다.

프로젝트 등록은 필수가 아닙니다. 로컬 작업 폴더와 실행 도구는 필요합니다. ChatGPT 웹이나 로컬 실행이 없는 일반 대화에서는 시작할 수 없습니다. Windows x64, macOS Apple Silicon·Intel, Linux ARM64·x64용 베타 런타임을 제공합니다. OS별 런타임 시험과 실제 Codex Desktop 대화/UI 수용은 별개입니다. Codex 및 기존 로그인을 사용하며 별도 Node/npm·API 키는 필요하지 않습니다. 최초 실행에서 OS에 맞는 체크섬 고정 패키지를 사용자 캐시에 받습니다.

## Claude Code에서 설치

Claude Code만 쓰셔도 됩니다. **터미널**에서 아래 두 줄을 실행하세요. Claude 앱의 코드 탭에서는 `/plugin` 화면이 열리지 않으니 터미널이 확실합니다. 터미널의 클로드 코드 안에서는 `/plugin marketplace add hw01931/nookrew`, `/plugin install nookrew@miscforge`로도 됩니다.

```bash
claude plugin marketplace add hw01931/nookrew
claude plugin install nookrew@miscforge
```

설치한 뒤 앱이나 터미널을 한 번 다시 켜세요.

설치한 뒤 **"누크루 사무실 열어줘"** 라고 하거나 `/nookrew:open-office`를 실행하면 현재 작업 폴더의 사무실 주소(127.0.0.1)를 알려 줍니다. Claude Code에는 내장 브라우저가 없으니 그 주소를 직접 브라우저에서 여세요. Codex 플러그인도 설치했다면 어느 쪽에서 열어도 같은 폴더의 Claude Code·Codex 세션이 한 사무실에 직원으로 나타납니다.

- 실행 기록(`~/.claude/projects`)을 읽어 상태·서브에이전트(조수 1, 2, 3)·토큰을 보여 주고, 캐릭터를 누르면 대화를 읽습니다.
- 쉬는 Claude 세션에는 공식 CLI로 메시지를 보낼 수 있지만, Claude Code에서 열려 있는 세션은 읽기 전용입니다(Codex와 달리 접수할 공식 경로가 없습니다).
- 실제 Claude 메시지 전송과, Claude Code가 이 스킬을 따라 사무실을 여는 대화는 아직 실제 계정으로 검증하지 않았습니다(NOT_RUN). 설치, 매니페스트 검증, 설치된 스크립트의 실제 실행은 확인했습니다.

## 베타3에서 새로 하는 일

- **작업 확인**: AI가 남긴 실제 검사 기록과 내가 직접 확인한 결과를 모아 봅니다. 검사 부탁할 글도 복사할 수 있습니다.
- **변경 확인**: AI가 바꾼 파일을 영역별로 읽고 확인할 부분을 찾습니다.
- **저장 지점**: 파일 상태를 저장하고, 무엇이 복원·삭제될지 본 뒤 되돌립니다. 운영 DB·배포된 앱은 되돌리지 않습니다.
- **업무·반복작업**: Codex·Claude 담당자를 골라 한 번·반복·단계별 업무를 등록합니다. 메시지 전송과 완료 검토는 사용자가 합니다.

[베타3 릴리스](https://github.com/hw01931/nookrew/releases/tag/v0.2.0-beta.3)

## 함께 쓸 수 있는 기능

- 실제 Codex·Claude Code 세션의 관찰 상태, 최근 대화, Codex 직원에게 메시지 접수(Claude는 쉬는 세션만)
- 테마 전환(따뜻한 작업실·구름빛·복숭아빛·픽셀 레트로)
- 프로젝트 문서·파일·변경 확인, 문서 편집과 코멘트
- 가구 배치·테마·사용자 에셋, 혼자/쉬는 캐릭터와 로컬 미니게임

게임은 실제 직원 모델을 호출하지 않습니다. 접수·응답 종료·검증 완료는 별개입니다. 승인·중단은 원래 Codex에서 처리합니다. 캐시 포함 누적 토큰은 생성한 글의 양이나 청구액이 아닙니다.

[자세한 사용법](docs/GETTING_STARTED.md) · [지원과 알려진 한계](docs/SUPPORT.md) · [데이터 처리 설명](docs/DATA_HANDLING.md)

이 저장소는 검토한 배포 패키지입니다. 기존 비공개 개발 저장소·세션·비밀키·모델 데이터는 포함하지 않습니다. 새 플러그인 패키지 ID는 nookrew입니다. 기존 moyo-office 설치와 프로젝트 기록은 자동 삭제하지 않습니다. 공개 Git 배포와 OpenAI 공식 디렉터리 등록은 별개이며, 공식 디렉터리 심사 완료를 뜻하지 않습니다.

코드와 번들 파일의 이용 조건은 각 제공자의 라이선스를 따릅니다. 서드파티 라이선스는 plugins/moyo-office/runtime/licenses 및 runtime/app의 라이선스 파일에 있습니다. 별도 배포 서명·새 PC 수용은 아직 미완료입니다.
