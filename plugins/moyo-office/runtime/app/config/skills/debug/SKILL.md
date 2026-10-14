---
name: debug
description: "오류·실패한 시험을 재현하고 원인을 좁혀 고친다. \"왜 안 돼?\", 검증 실패, 화면이 안 바뀜, 예외 때 쓴다."
roles: [개발, 데이터 엔지니어, 인프라, developer, data engineer, infrastructure]
---

# 디버깅

## 순서
1. 증상을 정확히 적는다: 무엇을 했고, 무엇을 기대했고, 실제로 무엇이 됐는가(검증 기록의 expected/actual).
2. 재현: check.run의 실패 시험 이름과 메시지를 기준으로 삼는다.
3. 가설 2~3개를 세우고 가장 싼 확인부터 한다(project.read로 그 줄, 관련 함수의 호출부를 모두 찾기).
4. 원인을 한 문장으로 쓴 뒤에만 고친다. 같은 처리가 여러 곳에 있으면 모두 찾는다(한 곳만 고치는 실수가 흔하다).
5. 고친 뒤 check.run으로 실패하던 시험과 이미 통과하던 시험을 모두 확인한다.

## 금지
시험을 지우거나 약하게 바꾸지 않는다. 오류를 빈 catch로 숨기지 않는다. 원인을 모르는 채 여기저기 바꾸지 않는다.

## 보고
원인, 고친 곳(파일:줄), 확인한 시험. 다음에도 쓸 교훈은 memory.write scope self 노트로 남긴다.

---
출처: anthropics/knowledge-work-plugins@8444efc `engineering/skills/debug` (Apache-2.0). 한국어로 옮기고 이 앱의 도구(artifact.write, change.propose, check.run 등)에 맞게 줄이고 고쳤다.
