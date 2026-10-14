"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_util_1 = require("node:util");
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const store_js_1 = require("../infrastructure/store.js");
const validation_js_1 = require("../infrastructure/validation.js");
const fixture_js_1 = require("../adapters/fixture.js");
const runner_js_1 = require("../application/runner.js");
const workspace_js_1 = require("../application/workspace.js");
const product_js_1 = require("../config/product.js");
const storage_js_1 = require("../config/storage.js");
const help = () => `${(0, product_js_1.loadProductConfig)().display.name} v0.1 — 신뢰된 fixture 기반 실행기

  validate-task <task.json> [--json] [--require-ready]
  run <task.json> [--scenario ${fixture_js_1.fixtureScenarios.join('|')}]
                 [--delay-ms 1000] [--key unique-key] [--db path] [--json]
  report <run-id> [--db path] [--json]
  artifact <run-id> [--db path]
  cancel <run-id> [--key unique-key] [--db path] [--json]
  recover <run-id> [--db path] [--json]
  workspace-snapshot <root> --scope <scope.json> [--json]
  workspace-diff <snapshot.json> --root <root> [--json]

기본 DB: ${storage_js_1.storageIdentity.directory}/${storage_js_1.storageIdentity.runsFile} (현재 폴더 기준)
실제 모델·임의 저장소·자동 반영은 아직 지원하지 않습니다.
종료 코드: 0 성공, 1 업무 실패/미완료, 2 잘못된 입력 또는 명령.
`;
async function main() {
    const { values, positionals } = (0, node_util_1.parseArgs)({
        allowPositionals: true,
        options: {
            json: { type: 'boolean', default: false },
            help: { type: 'boolean', short: 'h' },
            'require-ready': { type: 'boolean', default: false },
            db: { type: 'string' },
            scenario: { type: 'string' },
            'delay-ms': { type: 'string' },
            key: { type: 'string' },
            scope: { type: 'string' },
            root: { type: 'string' },
        },
    });
    const [command, target] = positionals;
    if (values.help || !command || command === 'help') {
        console.log(help());
        return;
    }
    if (!target || positionals.length !== 2)
        throw new Error('명령과 입력 하나를 지정하세요. --help로 사용법을 확인할 수 있습니다.');
    if (![
        'validate-task',
        'run',
        'report',
        'artifact',
        'cancel',
        'recover',
        'workspace-snapshot',
        'workspace-diff',
    ].includes(command))
        throw new Error('UNKNOWN_COMMAND');
    if (command === 'workspace-snapshot' || command === 'workspace-diff') {
        try {
            if (command === 'workspace-snapshot') {
                if (!values.scope)
                    throw new Error('WORKSPACE_SCOPE_REQUIRED');
                console.log(JSON.stringify((0, workspace_js_1.captureWorkspace)((0, node_path_1.resolve)(target), (0, workspace_js_1.readWorkspaceJson)((0, node_path_1.resolve)(values.scope))), null, 2));
            }
            else {
                if (!values.root)
                    throw new Error('WORKSPACE_ROOT_REQUIRED');
                console.log(JSON.stringify((0, workspace_js_1.compareWorkspace)((0, node_path_1.resolve)(values.root), (0, workspace_js_1.readWorkspaceJson)((0, node_path_1.resolve)(target))), null, 2));
            }
        }
        catch (error) {
            const code = error instanceof Error ? error.message : '';
            throw new Error(/^[A-Z_]+$/.test(code) ? code : 'WORKSPACE_READ_ERROR');
        }
        return;
    }
    if (command === 'validate-task') {
        const result = (0, validation_js_1.validateTask)((0, validation_js_1.readTask)((0, node_path_1.resolve)(target)), fixture_js_1.fixtureRegistry);
        console.log(values.json
            ? JSON.stringify(result, null, 2)
            : [
                `Schema: ${result.schema_valid ? 'PASS' : 'FAIL'} (v${result.schema_version})`,
                `계약: ${result.contract_valid ? 'PASS' : 'FAIL'}`,
                `실행 준비: ${result.execution_ready ? 'READY' : 'NOT_READY'}`,
                ...[...result.errors, ...result.readiness_errors].map((issue) => `${issue.path}: ${issue.code} — ${issue.message}`),
            ].join('\n'));
        if (!result.contract_valid || (values['require-ready'] && !result.execution_ready))
            process.exitCode = 2;
        return;
    }
    const dbPath = values.db
        ? (0, node_path_1.resolve)(values.db)
        : (0, node_path_1.resolve)(storage_js_1.storageIdentity.directory, storage_js_1.storageIdentity.runsFile);
    if (command !== 'run' && !(0, node_fs_1.existsSync)(dbPath))
        throw new Error('DATABASE_NOT_FOUND');
    let taskInput;
    if (command === 'run') {
        taskInput = (0, validation_js_1.readTask)((0, node_path_1.resolve)(target));
        if (!(0, validation_js_1.validateTask)(taskInput, fixture_js_1.fixtureRegistry).execution_ready)
            throw new Error('TASK_NOT_READY: validate-task로 문제를 확인하세요.');
    }
    const store = new store_js_1.Store(dbPath);
    try {
        if (command === 'run') {
            const scenario = values.scenario ?? 'success';
            if (!fixture_js_1.fixtureScenarios.some((value) => value === scenario))
                throw new Error('INVALID_SCENARIO');
            const controller = new AbortController();
            const interrupt = () => controller.abort();
            process.on('SIGINT', interrupt);
            try {
                const result = await (0, runner_js_1.runTask)(store, taskInput, {
                    scenario: scenario,
                    delayMs: values['delay-ms'] === undefined ? 0 : Number(values['delay-ms']),
                    idempotencyKey: values.key,
                    signal: controller.signal,
                    onStarted: (id) => {
                        if (!values.json)
                            console.error(`실행 시작: ${id}`);
                    },
                });
                printReport(result, values.json);
                if (result.run.state !== 'VERIFIED')
                    process.exitCode = 1;
            }
            finally {
                process.off('SIGINT', interrupt);
            }
        }
        else if (command === 'artifact') {
            const run = store.get(target);
            if (!run.candidate_hash)
                throw new Error('NO_CANDIDATE');
            console.log(JSON.stringify({
                snapshot_hash: run.candidate_hash,
                format: 'candidate-file-map-v1',
                files: store.artifact(run.candidate_hash),
            }, null, 2));
        }
        else {
            if (command === 'cancel') {
                const run = store.get(target);
                store.requestCancel(target, (0, runner_js_1.localCommand)(run.task.repository.reference, values.key ?? (0, node_crypto_1.randomUUID)(), run.version));
            }
            if (command === 'recover')
                store.recover(target);
            printReport(store.report(target), values.json);
        }
    }
    finally {
        store.close();
    }
}
function printReport(report, json) {
    if (json) {
        console.log(JSON.stringify(report, null, 2));
        return;
    }
    console.log([
        `실행: ${report.run.id}`,
        `작업: ${report.run.task.task_id}`,
        `실행 상태: ${report.run.state}`,
        `업무 상태: ${report.run.task_status}`,
        `프로젝트 반영: ${report.integration}`,
        '실행 프로필: fake-fixture-v1 (모의 실행, 실제 AI 성능 결과 아님)',
        ...report.evidence.map((row) => `${row.check_id}: ${row.status} (${row.passed}/${row.executed})`),
        'API 비용: $0 — 모의 실행; 하드웨어·총비용은 미측정',
        `후보 snapshot: ${report.run.candidate_hash ?? '없음'}`,
    ].join('\n'));
}
main().catch((error) => {
    // Do not print parser input, credentials, or raw filesystem errors.
    const message = error instanceof Error ? error.message : '명령 실행 실패';
    console.error(message.startsWith('TASK_NOT_READY') ? 'TASK_NOT_READY: validate-task 결과를 확인하세요.' : message);
    process.exitCode = 2;
});
//# sourceMappingURL=main.js.map