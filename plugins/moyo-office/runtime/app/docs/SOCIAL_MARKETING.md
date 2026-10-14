# Moyo 마케팅 연결

현재는 프로토타입이다. Threads 텍스트·Instagram 단일 이미지의 공식 API 어댑터, 계정 확인, 관찰 직원 배정, 초안·사용자 승인·게시 컨테이너·게시 기록을 제공한다. 실제 계정 토큰이 제공되지 않아 계정 게시 수용은 **NOT_RUN**이다. 테스트 응답을 실제 SNS 게시로 집계하지 않는다.

## 연결과 게시

사무실 **마케팅 → 계정 연결하기**에서 플랫폼 사용자 ID, Meta 앱의 API 버전, 액세스 토큰을 넣는다. 버전 기본값은 v25.0이며 최신 버전이라는 주장이 아니다. 실제 Meta 앱에서 지원하는 버전을 입력한다.

- Threads: 사용자 토큰과 `threads_basic`, 게시에 `threads_content_publish`가 필요하다.
- Instagram: 이번 구현은 **Facebook Login** 방식이다. Facebook 페이지와 연결된 비즈니스·크리에이터 계정 ID를 사용한다. `instagram_basic`, `instagram_content_publish`, 연결 조회에 필요한 페이지 권한은 Meta 앱 설정을 따른다. Instagram Login 방식 토큰과 혼용하지 않는다.
- 계정 프로필 조회 성공은 게시 권한·앱 심사 통과를 의미하지 않는다. 앱 모드·테스트 사용자·권한이 부족하면 Meta 오류 코드로 실패한다.

계정의 담당 직원을 저장한다. 초안을 저장하고 **내용 검토·승인 → 게시 컨테이너 만들기 → 실제 게시**를 순서대로 수행한다. 실제 게시 버튼에는 대상 공개 게시 확인이 있다. Instagram은 Meta가 읽을 수 있는 공개 HTTPS 이미지가 필요하다. 프로그램은 이미지 호스팅·영상·캐러셀을 자동 제공하지 않는다. 컨테이너 처리 중에는 `SOCIAL_MEDIA_NOT_READY`이며 준비된 뒤 같은 화면에서 다시 요청한다.

토큰은 기존 CredentialStore를 재사용하며 Windows에서는 현재 사용자 DPAPI로 보호한다. 프로젝트 DB와 브라우저 응답에는 토큰을 저장하지 않는다. 계정 연결 해제는 프로젝트 연결을 제거하고 게시 기록을 보존한다. 사용자 자격 증명 저장소의 암호화된 참조는 남으며 Meta 토큰 취소는 원래 Meta 앱에서 한다. 이 동작은 OAuth 권한 취소가 아니다.

## 마케터가 사용할 도구

설치 앱은 `app/scripts/office-social.cjs`에 CLI를 포함한다. 소스 개발에서는 다음 명령을 사용한다.

```powershell
node scripts/office-social.cjs --project "D:\my-project" list
node scripts/office-social.cjs --project "D:\my-project" draft "reports/social-draft.json" "stable-request-key"
```

```json
{"accountId":"list에서 확인한 ID","text":"게시할 초안","imageUrl":"https://example.com/photo.jpg"}
```

`draft`의 JSON은 지정 프로젝트 안의 실제 파일이어야 한다. 최대 16KiB다. 계정 배정에 저장된 직원 ID가 작성 출처로 기록된다. 동일한 키와 동일 내용의 재시도는 같은 초안을 반환한다. CLI는 읽기와 초안만 제공한다. 승인·공개 게시 기능은 웹 화면의 owner command를 사용한다. 로컬 CLI의 실행 권한은 OS 사용자 권한이며 실제 Codex 세션별 인증을 제공하지 않는다. 담당 직원 지정만으로 Codex 지침·권한이 바뀌지 않는다.

설치 버전은 별도 Node 없이 다음 명령을 제공한다. 실행 파일은 실제 설치 폴더를 지정한다.

```powershell
& "설치 폴더\AIOrchestraOffice.exe" --project "D:\my-project" --social-list
& "설치 폴더\AIOrchestraOffice.exe" --project "D:\my-project" --social-draft "reports/social-draft.json" --request-key "stable-request-key"
```

## 외부 결과와 복구

게시 이전에 의도를 DB에 기록한다. 외부 전송 이후 응답 유실·프로세스 종료·DB 실패가 발생하면 결과는 `UNKNOWN`이다. 같은 게시물 자동 재전송은 거부한다. 원래 SNS 계정에서 확인해야 한다. API 요청 timeout은 20초, redirect는 거부하며 토큰은 Authorization 헤더로만 전달한다. 외부 오류 본문은 로그·UI에 반환하지 않는다.

자동 댓글, 예약 공개 게시, 통계/댓글 수집, 자가개선 루프, OAuth 브라우저 로그인과 공개 앱 심사, 토큰 자동 갱신은 **미구현**이다. 사용자의 목표 목록에서 삭제하지 않는다.

공개 근거: [Meta Threads 공식 컬렉션](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api), [Meta Instagram 공식 컬렉션](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [Meta Threads 샘플](https://github.com/fbsamples/threads_api). 문서는 2026-10-14 조회했으며 Meta 개발자 페이지 일부는 429/접근 제한으로 원문을 얻지 못했다. 코드 동작 시험과 실제 앱 심사는 별개다.
