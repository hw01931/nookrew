"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FakeWorker = exports.baseFiles = exports.fixtureScenarios = exports.fixtureRegistry = void 0;
exports.verifyFixture = verifyFixture;
const promises_1 = require("node:timers/promises");
const node_vm_1 = require("node:vm");
const task_js_1 = require("../domain/task.js");
const hash_js_1 = require("../infrastructure/hash.js");
exports.fixtureRegistry = {
    'fixture:signup-validation': {
        snapshot: 'fixture-v1',
        required_checks: ['signup-input', 'login-regression', 'scope-policy'],
        checks: {
            'signup-input': 'test',
            'login-regression': 'test',
            'scope-policy': 'scope',
        },
    },
};
exports.fixtureScenarios = [
    'success',
    'bad-patch',
    'scope-violation',
    'crash',
    'missing-evidence',
];
exports.baseFiles = Object.freeze({
    'src/signup/validate.js': 'function signup(name) { return { ok: true, name }; }',
    'src/login/login.js': 'function login(user, password) { return user === "demo" && password === "correct"; }',
});
// Deliberately fixed trusted code: this adapter is not a model or an untrusted-code sandbox.
class FakeWorker {
    scenario;
    delayMs;
    constructor(scenario = 'success', delayMs = 0) {
        this.scenario = scenario;
        this.delayMs = delayMs;
    }
    async execute(signal) {
        await (0, promises_1.setTimeout)(this.delayMs, undefined, { signal });
        if (this.scenario === 'crash')
            throw new Error('FAKE_RUNTIME_FAILURE');
        const result = { ...exports.baseFiles };
        if (this.scenario !== 'bad-patch')
            result['src/signup/validate.js'] =
                'function signup(name) { if (!name.trim()) return { ok: false, error: "DISPLAY_NAME_REQUIRED" }; return { ok: true, name }; }';
        if (this.scenario === 'scope-violation')
            result['src/login/login.js'] = 'function login() { return true; }';
        return result;
    }
}
exports.FakeWorker = FakeWorker;
function evaluateTrusted(files, expression, timeout) {
    // Only the built-in FakeWorker supplies these strings. Never wire an external adapter here.
    const script = new node_vm_1.Script(Object.values(files).join('\n') + '\n' + expression);
    return (script.runInContext((0, node_vm_1.createContext)(Object.create(null), { codeGeneration: { strings: false, wasm: false } }), {
        timeout,
    }) === true);
}
function verifyFixture(task, files, omitEvidence = false) {
    const snapshot = (0, hash_js_1.hash)(files);
    const changed = [...new Set([...Object.keys(exports.baseFiles), ...Object.keys(files)])].filter((path) => exports.baseFiles[path] !== files[path]);
    return task.verification.map((check) => {
        const row = {
            check_id: check.check_id,
            snapshot_hash: snapshot,
            status: 'NOT_RUN',
            executed: 0,
            passed: 0,
            details: [],
            evaluator_version: 'trusted-fixture-v1',
        };
        if (omitEvidence && check.check_id === 'signup-input')
            return row;
        const probes = check.check_id === 'signup-input'
            ? [
                'signup("").ok === false',
                'signup("   ").error === "DISPLAY_NAME_REQUIRED"',
                'signup("alice").ok === true && signup("alice").name === "alice"',
            ]
            : check.check_id === 'login-regression'
                ? [
                    'login("demo", "correct") === true',
                    'login("demo", "wrong") === false',
                    'login("unknown", "correct") === false',
                ]
                : [];
        try {
            if (check.check_id === 'scope-policy') {
                row.executed = 1;
                row.passed = changed.every((path) => (0, task_js_1.canChange)(task, path)) ? 1 : 0;
                row.details = changed.map((path) => `${(0, task_js_1.canChange)(task, path) ? 'ALLOW' : 'DENY'} ${path}`);
            }
            else
                for (const probe of probes) {
                    row.executed++;
                    const pass = evaluateTrusted(files, probe, Math.min(check.timeout_seconds * 1000, 1000));
                    if (pass)
                        row.passed++;
                    row.details.push(`${pass ? 'PASS' : 'FAIL'} ${probe}`);
                }
            row.status = row.executed === 0 ? 'INCONCLUSIVE' : row.passed === row.executed ? 'PASS' : 'FAIL';
        }
        catch {
            row.status = 'INCONCLUSIVE';
            row.details.push('평가 오류 또는 시간 제한');
        }
        return row;
    });
}
//# sourceMappingURL=fixture.js.map