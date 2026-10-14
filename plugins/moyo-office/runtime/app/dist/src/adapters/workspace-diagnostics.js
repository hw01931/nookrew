"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workspaceDiagnostics = workspaceDiagnostics;
exports.inspectDocker = inspectDocker;
exports.inspectVerifier = inspectVerifier;
exports.inspectEnvironment = inspectEnvironment;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_child_process_1 = require("node:child_process");
const openrouter_model_js_1 = require("./openrouter-model.js");
const api_budget_js_1 = require("../domain/api-budget.js");
const project_changes_js_1 = require("./project-changes.js");
/**
 * Check details are worded here, in the language of the screen that asked (the X-AIO-Language
 * header), not in the project's: the report is rebuilt on every request and stored nowhere, and its
 * details carry many measured values (versions, counts, model names, times). ADR 0062.
 */
const diagnosticText = {
    ko: {
        locale: 'ko-KR',
        recordsOk: '협업 DB 구조 검사 통과',
        recordsBad: 'DB 구조를 확인해야 합니다. 원본 파일을 보존하세요.',
        recordsUnknown: 'DB 구조 검사 결과를 얻지 못했습니다.',
        node: (version) => `실행 중 Node ${version} · 이 제품의 검증 기준은 Node 22입니다.`,
        apiSettingsUnreadable: 'API 모델 설정을 읽지 못했습니다.',
        paidModel: (label, state) => `유료 API 모델 ${label} · ${state === 'unpriced'
            ? '가격 미입력 · 호출하지 않음'
            : state === 'noKey'
                ? '키 없음 · 호출하지 않음'
                : '가격·키 등록됨 · 실제 호출은 확인 안 함(유료)'}`,
        paidProfile: (label) => `유료 API 모델 ${label} · 실제 호출은 확인 안 함(유료)`,
        remoteKeyMissing: (file) => `${file} 키 파일이 없습니다.`,
        remoteModel: (model, used, limit) => `무료 원격 모델 ${model} · 오늘(UTC) 원격 요청 ${used}/${limit}회`,
        remoteExhaustedUntil: (time) => ` · 제공자 한도 소진, ${time} 이후 다시 사용`,
        remoteSpent: ' · 오늘 한도 소진',
        remoteCollected: ' · 요청 내용이 제공자에게 수집될 수 있습니다',
        localPresent: '모델 파일과 실행기 존재 확인 · 추론 성능/응답 성공은 별도 검증',
        localMissing: '모델 파일 또는 실행기가 아직 없습니다. 모델 화면에서 받으세요.',
        dockerUnreachable: 'Docker 엔진에 연결하지 못했습니다. 설치·실행 상태를 확인하세요.',
        dockerVersion: (version) => `Docker 서버 ${version} 응답 · 이미지·격리 검증 실행은 별도`,
        dockerNoVersion: 'Docker 서버 버전을 확인하지 못했습니다.',
        verifierReady: '수정안 검증 이미지가 준비되어 있습니다.',
        verifierMissing: '수정안 검증 이미지가 없습니다. PowerShell에서 scripts/verifier/build.ps1을 실행하세요.',
        verifierNeedsDocker: 'Docker를 먼저 실행해야 확인할 수 있습니다.',
    },
    en: {
        locale: 'en-US',
        recordsOk: 'Collaboration database structure check passed',
        recordsBad: 'The database structure needs checking. Keep the original file.',
        recordsUnknown: 'Could not get a result from the database structure check.',
        node: (version) => `Running Node ${version} · this product is verified on Node 22.`,
        apiSettingsUnreadable: 'Could not read the API model settings.',
        paidModel: (label, state) => `Paid API model ${label} · ${state === 'unpriced'
            ? 'no price entered · not called'
            : state === 'noKey'
                ? 'no key · not called'
                : 'price and key registered · a real call is not checked (paid)'}`,
        paidProfile: (label) => `Paid API model ${label} · a real call is not checked (paid)`,
        remoteKeyMissing: (file) => `The key file ${file} is missing.`,
        remoteModel: (model, used, limit) => `Free remote model ${model} · remote requests today (UTC) ${used}/${limit}`,
        remoteExhaustedUntil: (time) => ` · provider limit used up, available again after ${time}`,
        remoteSpent: ' · daily limit used up',
        remoteCollected: ' · the provider may collect request content',
        localPresent: 'Model file and runner found · inference quality and replies are verified separately',
        localMissing: 'The model file or runner is not there yet. Download it on the Models page.',
        dockerUnreachable: 'Could not connect to the Docker engine. Check that it is installed and running.',
        dockerVersion: (version) => `Docker server ${version} responded · image and isolation checks run separately`,
        dockerNoVersion: 'Could not read the Docker server version.',
        verifierReady: 'The change verification image is ready.',
        verifierMissing: 'The change verification image is missing. Run scripts/verifier/build.ps1 in PowerShell.',
        verifierNeedsDocker: 'Start Docker first to check this.',
    },
};
function workspaceDiagnostics(office, modelRoot, api, lang = 'ko') {
    const text = diagnosticText[lang];
    const checks = [];
    try {
        const rows = office.store.db.prepare('PRAGMA quick_check').all();
        const ok = rows.length === 1 && Object.values(rows[0])[0] === 'ok';
        checks.push({
            id: 'records',
            status: ok ? 'PASS' : 'FAIL',
            detail: ok ? text.recordsOk : text.recordsBad,
        });
    }
    catch {
        checks.push({ id: 'records', status: 'INCONCLUSIVE', detail: text.recordsUnknown });
    }
    checks.push({
        id: 'node',
        status: Number(process.versions.node.split('.')[0]) === 22 ? 'PASS' : 'INCONCLUSIVE',
        detail: text.node(process.versions.node),
    });
    const profiles = office.config.models ?? [office.config.runtime];
    // Paid API models are never called here (a check would cost money), so the best they get is NOT_RUN.
    const apiModels = (() => {
        try {
            return api?.settings.read().models.filter((m) => m.enabled);
        }
        catch {
            checks.push({ id: 'api-models', status: 'INCONCLUSIVE', detail: text.apiSettingsUnreadable });
            return [];
        }
    })();
    if (apiModels) {
        const keys = api.credentials.status();
        for (const m of apiModels) {
            const priced = (0, api_budget_js_1.validPrice)(m.price), keyed = !!keys[m.provider]?.set;
            checks.push({
                id: 'model:' + m.id,
                status: priced && keyed ? 'NOT_RUN' : 'FAIL',
                detail: text.paidModel(m.label, !priced ? 'unpriced' : !keyed ? 'noKey' : 'ready'),
            });
        }
    }
    for (const model of profiles) {
        if (model.provider === 'api') {
            if (!apiModels)
                checks.push({
                    id: 'model:' + model.modelId,
                    status: 'NOT_RUN',
                    detail: text.paidProfile(model.label ?? model.modelId),
                });
            continue;
        }
        if (model.provider === 'server') {
            // Not called here: a model server may be off, slow to load, or priced. The Models page checks it.
            checks.push({
                id: 'model:' + model.modelId,
                status: 'NOT_RUN',
                detail: `모델 서버 ${model.label ?? model.modelId} · 연결은 모델 화면의 "모델 불러오기"로 확인`,
            });
            continue;
        }
        if (model.provider === 'openrouter') {
            const key = !!process.env.OPENROUTER_API_KEY || (0, node_fs_1.existsSync)((0, node_path_1.resolve)(modelRoot, model.credentialFile ?? ''));
            const usage = (0, openrouter_model_js_1.remoteUsage)(modelRoot), limit = model.dailyRequestLimit ?? openrouter_model_js_1.defaultDailyRequestLimit;
            const spent = !!usage.exhaustedUntil || usage.requests >= limit;
            checks.push({
                id: 'model:' + model.modelId,
                status: !key || spent ? 'FAIL' : 'PASS',
                detail: !key
                    ? text.remoteKeyMissing(String(model.credentialFile))
                    : text.remoteModel(String(model.remoteModel), usage.requests, limit) +
                        (usage.exhaustedUntil
                            ? text.remoteExhaustedUntil(new Date(usage.exhaustedUntil).toLocaleString(text.locale))
                            : spent
                                ? text.remoteSpent
                                : '') +
                        text.remoteCollected,
            });
            continue;
        }
        const present = (0, node_fs_1.existsSync)((0, node_path_1.resolve)(modelRoot, model.modelFile)) && (0, node_fs_1.existsSync)((0, node_path_1.resolve)(modelRoot, model.executable));
        checks.push({
            id: 'model:' + model.modelId,
            status: present ? 'PASS' : 'FAIL',
            detail: present ? text.localPresent : text.localMissing,
        });
    }
    const jobs = office.jobs();
    return {
        checkedAt: new Date().toISOString(),
        checks,
        active: jobs.filter((j) => ['RUNNING', 'QUEUED'].includes(j.status)).length,
        unknown: jobs.filter((j) => j.status === 'UNKNOWN').length,
        failed: jobs.filter((j) => j.status === 'FAILED').length,
        jobWindow: 200,
        modelCalls: 0,
    };
}
/** Fixed read-only command: caller cannot supply executable, arguments or shell text. */
let dockerProbe;
/** The Docker server version, '' when it answered without one, null when it could not be reached. */
function probeDocker() {
    if (dockerProbe)
        return dockerProbe;
    dockerProbe = new Promise((resolve) => (0, node_child_process_1.execFile)('docker', ['version', '--format', '{{.Server.Version}}'], { windowsHide: true, timeout: 5000, maxBuffer: 16384, encoding: 'utf8' }, (error, stdout) => resolve(error ? null : stdout.trim().slice(0, 60)))).finally(() => {
        dockerProbe = undefined;
    });
    return dockerProbe;
}
async function inspectDocker(lang = 'ko') {
    const text = diagnosticText[lang], version = await probeDocker();
    return version === null
        ? { id: 'docker', status: 'INCONCLUSIVE', detail: text.dockerUnreachable }
        : {
            id: 'docker',
            status: version ? 'PASS' : 'INCONCLUSIVE',
            detail: version ? text.dockerVersion(version) : text.dockerNoVersion,
        };
}
/** Fixed read-only probe for the image that verification runs in. */
function inspectVerifier(lang = 'ko') {
    const text = diagnosticText[lang];
    return new Promise((resolve) => (0, node_child_process_1.execFile)('docker', project_changes_js_1.verifierImageInspect, { windowsHide: true, timeout: 5000, maxBuffer: 16384, encoding: 'utf8' }, (error, stdout) => resolve(!error && project_changes_js_1.imageId.test(stdout.trim())
        ? { id: 'verifier', status: 'PASS', detail: text.verifierReady }
        : { id: 'verifier', status: 'FAIL', detail: text.verifierMissing })));
}
/** Docker and verifier image checks; both are fixed commands with no caller input. */
async function inspectEnvironment(lang = 'ko') {
    const docker = await inspectDocker(lang);
    return [
        docker,
        docker.status === 'PASS'
            ? await inspectVerifier(lang)
            : { id: 'verifier', status: 'NOT_RUN', detail: diagnosticText[lang].verifierNeedsDocker },
    ];
}
//# sourceMappingURL=workspace-diagnostics.js.map