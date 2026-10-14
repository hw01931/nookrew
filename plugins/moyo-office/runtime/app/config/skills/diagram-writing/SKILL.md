---
name: diagram-writing
description: "Mermaid로 흐름도·시퀀스·ER·상태·간트·마인드맵을 그린다. 화면 흐름, 데이터 구조, 일정, 순서 설명이 필요할 때 쓴다."
roles: [기획, 디자인, 디자이너, 개발, 데이터, 인프라, planner, designer, developer, data, infrastructure]
---

# 다이어그램(Mermaid)

artifact.write type diagram, 내용은 Mermaid 원문 하나(코드펜스 없이). 문서 안에서는 ```mermaid 블록.

## 고르는 법
- 순서·분기: flowchart TD
- 주고받는 요청: sequenceDiagram
- 데이터 구조: erDiagram
- 상태 변화: stateDiagram-v2
- 일정: gantt
- 생각 정리: mindmap

## 예
flowchart TD
  A[제목 입력] --> B{비어 있나?}
  B -- 예 --> C[오류 표시]
  B -- 아니오 --> D[목록에 추가]

## 주의
- 노드 id는 영문(A, B, addBook), 한글은 대괄호 안 라벨에만.
- 라벨에 괄호·따옴표가 있으면 큰따옴표로 감싼다: A["저장(localStorage)"]
- 한 그림에 노드 20개 이하. 크면 나눈다.
- HTML 태그를 쓰지 않는다(표시되지 않음).
