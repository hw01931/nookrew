---
name: sql-queries
description: "정확하고 읽기 쉬운 SQL을 쓰고 고친다(CTE, 윈도 함수, 집계, 중복 제거). 쿼리 작성·검토, 느린 쿼리, 방언 차이 때 쓴다."
roles: [데이터, 백엔드, data, backend]
---

# SQL 쿼리

## 시작 전
- 프로젝트가 쓰는 DB와 방언을 확인한다(project.search로 "sqlite", "postgres", 스키마·마이그레이션 파일). 모르면 가정을 적는다.
- 표와 열 이름은 스키마 파일에서 확인한다. 추측한 이름을 쓰지 않는다.
- 이 앱의 직원은 DB에 쿼리를 실행할 수 없다. **실행 결과를 지어내지 않는다.** 쿼리는 코드(change.propose)나 산출물(artifact.write type code)로 내고, 결과는 사용자가 실행하거나 등록된 검사(check.run)로 확인한다.

## 쓰는 법
- 단계마다 CTE(WITH)로 나눈다: 대상 정하기 → 대상별 계산 → 요약.
- 조인할 때 열은 별칭으로 구분한다(u.id). 조인 뒤 행 수가 늘었는지 생각한다(일대다).
- 대상을 셀 때 조인 뒤에는 COUNT(DISTINCT id).
- 나눗셈은 NULLIF(분모, 0)로 0 나누기를 막는다.
- 날짜는 시간대를 하나로 맞추고, 덜 끝난 기간을 비교하지 않는다.
- 사용자 입력은 문자열로 이어 붙이지 않고 매개변수(?, $1)로 넘긴다(주입 방지).

## 자주 쓰는 형태
- 최신 한 건만: ROW_NUMBER() OVER (PARTITION BY 키 ORDER BY 수정시각 DESC) = 1
- 누적·이동 합계: SUM(값) OVER (ORDER BY 날짜 ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
- 전체 대비 비율: 값 / SUM(값) OVER ()
- 단계별 전환: 사용자별 MAX(CASE WHEN 이벤트='가입' THEN 1 ELSE 0 END) 후 합계
- 코호트: 첫 활동 월별로 묶고 N개월 뒤 활동한 사용자 수를 센다.

## 방언 차이(자주 틀리는 것)
- 날짜 더하기: SQLite date(d, '+7 days'), PostgreSQL d + INTERVAL '7 days'.
- 월 단위 자르기: SQLite strftime('%Y-%m', d), PostgreSQL DATE_TRUNC('month', d).
- 대소문자 무시 검색: PostgreSQL ILIKE, SQLite는 LIKE가 영문 대소문자를 무시.

## 오류가 나면
문법(방언), 없는 열(오타·대소문자), 형 불일치(CAST), 0 나누기, 모호한 열(별칭), GROUP BY에 빠진 열 순서로 본다.

## 성능
필터·조인 열의 인덱스, 필요한 열만 SELECT, 상관 서브쿼리 대신 EXISTS나 조인, 실행 계획(EXPLAIN)은 사용자에게 확인을 요청한다.

---
출처: anthropics/knowledge-work-plugins@8444efc `data/skills/sql-queries` (Apache-2.0). 한국어로 옮기고 이 앱의 도구(project.search, change.propose, artifact.write 등)에 맞게 줄이고 고쳤다. 웨어하우스별(Snowflake·BigQuery·Redshift·Databricks) 상세는 뺐다.
