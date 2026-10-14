---
name: design-system
description: "색·간격·글꼴 토큰과 공통 컴포넌트 규칙을 정하고 점검한다. 디자인 시스템 정리, 토큰 만들기, 일관성 점검 때 쓴다."
roles: [디자인, 디자이너, 프론트엔드, designer, frontend]
---

# 디자인 시스템

## 토큰
- 색: 역할 이름으로(--bg, --surface, --ink, --muted, --accent, --border, --red). 값이 아니라 쓰임으로 이름 짓는다.
- 간격: 4의 배수 단계(4, 8, 12, 16, 24, 32).
- 글꼴: 크기 단계(12, 13, 14, 16, 20, 28)와 굵기.
- 모서리·그림자는 2~3단계만.

## 컴포넌트
버튼(주·보조·텍스트), 입력, 선택, 카드, 표, 대화상자, 알림. 컴포넌트마다 상태와 쓰는 때를 적는다.

## 점검
시안 HTML에서 토큰 밖의 색·간격 값을 찾고, 같은 역할에 다른 값을 쓰는 곳을 표로 만든다.

## 결과
토큰 정의는 CSS 변수 목록으로, 규칙은 artifact.write type plan으로 저장한다. 프로젝트 규칙에 넣을 짧은 약속도 따로 제안한다.

---
출처: anthropics/knowledge-work-plugins@8444efc `design/skills/design-system` (Apache-2.0). 한국어로 옮기고 이 앱의 도구(artifact.write, change.propose, check.run 등)에 맞게 줄이고 고쳤다.
