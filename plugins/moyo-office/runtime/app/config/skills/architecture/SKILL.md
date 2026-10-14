---
name: architecture
description: "구조·기술 선택을 결정하고 근거를 기록한다(ADR). 새 기능·시스템 설계, 저장 형식, API·모듈 나누기, \"어떻게 설계할까?\" 때 쓴다."
roles: [개발, 기획, 아키텍트, 데이터 엔지니어, 인프라, developer, planner, architect, data engineer, infrastructure]
---

# 구조 설계와 결정 기록(ADR)

## 쓰는 때
되돌리기 비싼 결정: 데이터·저장 형식, 모듈 경계, 공통 인터페이스·API, 외부 라이브러리. 새 기능·시스템을 처음 설계할 때.

## 설계 순서
1. 요구: 기능(무엇을 하나), 비기능(규모·속도·가용성·비용), 제약(일정, 기존 기술, 사람). 모르는 것은 가정으로 적는다.
2. 큰 그림: 구성 요소, 데이터 흐름, API 계약, 저장 방식. 그림은 artifact.write type diagram(flowchart·sequenceDiagram·erDiagram).
3. 세부: 데이터 모델, API(입력·출력·오류), 캐시, 비동기 작업, 오류 처리와 재시도(같은 요청 두 번에도 안전한가).
4. 규모와 실패: 예상 부하(근거와 함께), 늘릴 방법, 한 부분이 죽으면 어떻게 되나, 무엇을 감시하나.
5. 맞바꿈: 모든 선택에는 대가가 있다. 복잡도, 비용, 익숙함, 출시 시간, 유지보수로 비교한다.

## 기록 형식
1. 맥락: 무엇이 문제이고 어떤 제약이 있는가.
2. 선택지 2~3개와 각각의 장단점(복잡도, 성능, 바꾸기 비용).
3. 결정과 이유.
4. 영향: 쉬워지는 것, 어려워지는 것, 바뀌는 파일·모듈, 이전 데이터 처리, 시험.
5. 다시 볼 조건(시스템이 커지면 무엇을 다시 볼지).

## 방법
기존 코드를 project.list/read로 확인한 뒤 쓴다. 결정은 artifact.write type plan으로 저장하고, 함께 일하는 직원들이 따를 인터페이스는 프로젝트 규칙에 넣을 짧은 약속으로 따로 제안한다. 처음부터 크게 만들지 않는다: 지금 필요한 경계만 나누고 나중에 나눌 지점을 적는다.

---
출처: anthropics/knowledge-work-plugins@8444efc `engineering/skills/architecture`와 `engineering/skills/system-design` (Apache-2.0). 한국어로 옮기고 두 스킬을 하나로 합쳐 이 앱의 도구(artifact.write, project.read 등)에 맞게 줄이고 고쳤다.
