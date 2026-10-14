# 실험 계약 파일

현재는 schema, 예시와 신뢰된 fixture 전용 실행기·검증기가 존재한다. 실제 모델 adapter와 benchmark task corpus는 아직 없다.

- `task-schema.yaml`: JSON Schema 2020-12. JSON 문법으로 작성된 유효한 YAML 1.2 문서다.
- `examples/task.example.json`: 가입 검증 fixture. 내장 registry와 연결된 가입·로그인·범위 검사를 실행할 수 있다. Codyssey에서 추출한 실제 작업은 아니다.
- `decision-policy.example.json`: 임계값을 본 평가 전에 채우기 위한 초안. UNFROZEN 상태에서는 제품 승격 판정에 쓸 수 없다.

Schema 검사 후 별도 의미 검사가 필요하다. 경로는 repo-relative로 제한하고 parent traversal·absolute path를 거부한다. criterion/check ID의 유일성, 모든 criterion의 필수 검사 연결, registry의 존재, profile capability와 실행 예산을 확인한다. schema 자체는 정답 여부나 안전한 명령을 보증하지 않는다.

Task의 verification에는 check ID만 둔다. 실제 실행 파일과 argv는 신뢰된 검증 registry에서 해석한다. evaluator manifest에는 gold patch와 hidden checks를 별도로 둔다. 그 경로나 내용은 worker-public task에 넣지 않는다.
