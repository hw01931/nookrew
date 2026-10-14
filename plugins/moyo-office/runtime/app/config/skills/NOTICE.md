# 기본 스킬 출처

아래 스킬은 anthropics/knowledge-work-plugins (https://github.com/anthropics/knowledge-work-plugins, 커밋 8444efc, Apache License 2.0)의 같은 이름 스킬을 바탕으로 한국어로 옮기고 이 앱의 도구에 맞게 줄이고 고친 것이다. 각 SKILL.md 끝에 원본 경로와 변경 내용을 적었다. 원본 라이선스: LICENSE-knowledge-work-plugins.txt.

| 플러그인 | 스킬 (원본 경로 `<플러그인>/skills/<이름>/SKILL.md`) |
| --- | --- |
| design | design-critique, accessibility-review, ux-copy, design-handoff, design-system, user-research, research-synthesis |
| engineering | code-review, debug, architecture (system-design을 합침), testing-strategy, documentation, standup, deploy-checklist, tech-debt, incident-response |
| data | analyze, explore-data, data-visualization, validate-data, statistical-analysis, sql-queries |
| marketing | content-creation, campaign-plan, competitive-brief, brand-review, seo-audit, email-sequence |

공통 변경: 외부 연결(MCP·데이터 웨어하우스·SaaS 도구)과 Python·노트북 단계를 빼고 직원 도구(artifact.write, record.search/read, web.search/fetch, project.read/search 등)로 바꿨다. 출처 없는 업계 수치·기준표는 뺐고, 숫자·인용·조사 결과를 지어내지 않는 규칙을 더했다.

diagram-writing, task-splitting, prd-writing은 이 프로젝트에서 새로 쓴 것이다.
