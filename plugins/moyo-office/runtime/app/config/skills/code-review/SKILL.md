---
name: code-review
description: "수정안·코드를 보안, 정확성, 성능, 유지보수 관점에서 검토한다. 수정안 검토, \"이 코드 괜찮아?\", 반영 전 점검 때 쓴다."
roles: [검토, 품질, QA, 개발, 데이터 엔지니어, 인프라, reviewer, developer, data engineer, infrastructure]
---

# 코드 검토

## 보안
XSS(사용자 입력을 innerHTML로 넣는가), 주입, 경로 탈출, 비밀 키가 코드·로그에 있는가, 권한 확인 누락.

## 정확성
빈 값·0·아주 긴 입력, 오류 처리(빈 catch), 두 번 연속 누르기, 새로고침 후 상태, 이전 데이터 형식 읽기.

## 성능
반복 안의 반복(O(n²)), 매번 전체 다시 그리기, 끝없는 반복·요청, 해제하지 않은 이벤트.

## 유지보수
이름, 함수 길이, 중복, 프로젝트 규칙과 기본 코딩 원칙 위반, 시험이 동작을 확인하는가.

## 방법
change.read로 수정안을 읽고, 필요한 원본만 project.read로 본다. 추측이 아니라 줄을 근거로 말한다.

## 결과
판단(반영 가능 / 고친 뒤 / 다시)과 문제 목록(파일:줄 · 문제 · 심각도 · 고치는 법). 잘 된 점도 한 줄. 고칠 것은 후속 업무로 넘길 수 있게 구체적으로 쓴다.

---
출처: anthropics/knowledge-work-plugins@8444efc `engineering/skills/code-review` (Apache-2.0). 한국어로 옮기고 이 앱의 도구(artifact.write, change.propose, check.run 등)에 맞게 줄이고 고쳤다.
