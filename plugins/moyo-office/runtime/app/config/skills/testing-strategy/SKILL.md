---
name: testing-strategy
description: "무엇을 어떤 시험으로 확인할지 정하고 시험을 쓴다. 시험 계획, 검증 기준 초안, \"어떻게 확인하지?\" 때 쓴다."
roles: [개발, 품질, QA, 데이터 엔지니어, developer, data engineer]
---

# 시험 전략

## 원칙
- 동작을 확인한다(구현을 베끼지 않는다). 사용자가 보는 결과와 저장된 상태를 본다.
- 허용과 거부를 둘 다: 정상 입력, 빈 값, 너무 긴 값, 잘못된 형식, 중복.
- 시험끼리 상태를 공유하지 않는다. 각 시험은 스스로 준비한다.
- 순수 함수는 단위 시험, 화면은 openPage로 입력·클릭·새로고침 흐름 시험.

## 순서
1. 완료 기준을 문장으로 나열한다.
2. 기준마다 시험 하나(시험 이름 = 기준 문장).
3. 실패하는 것을 먼저 확인할 수 있으면 확인한다.

## 이 앱에서
require("node:test")와 require("node:assert/strict")만 쓴다(describe/it/expect 없음). 화면은 require("aiorchestra-page")의 openPage. 검증 기준 초안은 artifact.write type checks.

---
출처: anthropics/knowledge-work-plugins@8444efc `engineering/skills/testing-strategy` (Apache-2.0). 한국어로 옮기고 이 앱의 도구(artifact.write, change.propose, check.run 등)에 맞게 줄이고 고쳤다.
