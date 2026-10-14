"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ruleScanLimits = void 0;
exports.scanRulesIsolated = scanRulesIsolated;
/**
 * Project rule checks (ADR 0052) run owner-written regular expressions. One catastrophic pattern
 * would freeze the single server process, so they run in a worker thread under a time limit.
 * Running out of time or failing to run is INCONCLUSIVE: never a pass, never a violation.
 */
const node_worker_threads_1 = require("node:worker_threads");
const node_path_1 = require("node:path");
/** Time one check may take over all files; the worker gets longer to start. */
exports.ruleScanLimits = { checkMs: 2000, startMs: 10000 };
/** Why a scan is INCONCLUSIVE; stored in verification evidence, so in the project's language (ADR 0062). */
const scanReasons = {
    ko: {
        slow: (check, seconds) => `프로젝트 규칙 「${check}」 검사가 ${seconds}초 안에 끝나지 않아 판정할 수 없습니다. 이 규칙의 정규식을 단순하게 고치세요.`,
        notStarted: '프로젝트 규칙 검사를 시작하지 못해 판정할 수 없습니다.',
        failed: (check, message) => check
            ? `프로젝트 규칙 「${check}」을 실행하지 못해 판정할 수 없습니다: ${message}`
            : `프로젝트 규칙 검사를 실행하지 못해 판정할 수 없습니다: ${message}`,
        noResult: '프로젝트 규칙 검사가 결과 없이 끝나 판정할 수 없습니다.',
    },
    en: {
        slow: (check, seconds) => `Project rule 「${check}」 did not finish within ${seconds} seconds, so it cannot be judged. Simplify this rule's regular expression.`,
        notStarted: 'The project rule check could not start, so it cannot be judged.',
        failed: (check, message) => check
            ? `Project rule 「${check}」 could not run, so it cannot be judged: ${message}`
            : `The project rule check could not run, so it cannot be judged: ${message}`,
        noResult: 'The project rule check ended without a result, so it cannot be judged.',
    },
};
function scanRulesIsolated(files, checks, options = {}) {
    if (!checks.length)
        return Promise.resolve({ status: 'DONE', violations: [] });
    const checkMs = options.timeoutMs ?? exports.ruleScanLimits.checkMs;
    const reasons = scanReasons[options.language ?? 'ko'];
    return new Promise((done) => {
        const worker = new node_worker_threads_1.Worker((0, node_path_1.resolve)(__dirname, 'rule-scan-worker.js'), {
            workerData: { files: files.map((f) => ({ path: f.path, content: f.content })), checks },
        });
        let current = null, settled = false;
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            void worker.terminate();
            done(result);
        };
        const inconclusive = (reason) => finish({ status: 'INCONCLUSIVE', check: current, reason });
        const expire = () => inconclusive(current ? reasons.slow(current, checkMs / 1000) : reasons.notStarted);
        let timer = setTimeout(expire, exports.ruleScanLimits.startMs);
        worker.on('message', (m) => {
            if (m.type === 'check') {
                current = m.id;
                clearTimeout(timer);
                timer = setTimeout(expire, checkMs);
            }
            else if (m.type === 'failed') {
                current = m.id;
                inconclusive(reasons.failed(current, m.message));
            }
            else
                finish({ status: 'DONE', violations: m.violations });
        });
        worker.on('error', (e) => inconclusive(reasons.failed(current, e.message)));
        worker.on('exit', () => inconclusive(reasons.noResult));
    });
}
//# sourceMappingURL=rule-scan.js.map