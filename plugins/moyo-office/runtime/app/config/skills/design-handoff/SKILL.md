---
name: design-handoff
description: "시안을 개발에 넘길 사양으로 정리한다: 화면 구조, 상태, 간격·색 토큰, 동작, 예외. 개발 전달, \"개발자가 뭘 알아야 해?\" 때 쓴다."
roles: [디자인, 디자이너, designer]
---

# 개발 전달

## 담을 것
1. 화면 목록과 각 화면의 목적.
2. 요소별 사양: 이름(id), 크기·간격·색은 토큰 이름으로(var(--...)), 글꼴.
3. 상태: 기본·마우스 올림·초점·누름·비활성·오류·빈 화면·불러오는 중.
4. 동작: 누르면 무엇이 바뀌는지, 키보드 동작, 전환.
5. 반응형: 360·768·1280에서 바뀌는 점.
6. 예외: 긴 글자, 0개·많은 개수, 실패 응답.
7. 접근성: 라벨, 초점 순서, 대체 텍스트.

## 방법
시안(type design)과 프로젝트 규칙을 읽고, 화면 흐름은 diagram(Mermaid)으로, 사양은 artifact.write type plan 문서로 쓴다. 개발 업무의 인터페이스 문서와 이름을 맞춘다.

---
출처: anthropics/knowledge-work-plugins@8444efc `design/skills/design-handoff` (Apache-2.0). 한국어로 옮기고 이 앱의 도구(artifact.write, change.propose, check.run 등)에 맞게 줄이고 고쳤다.
