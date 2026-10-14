"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Worker side of `scanRulesIsolated`: runs project rule checks one at a time, announcing each check
 * before it starts so the main thread can name the rule that ran out of time.
 */
const node_worker_threads_1 = require("node:worker_threads");
const project_rules_js_1 = require("../domain/project-rules.js");
const { files, checks } = node_worker_threads_1.workerData;
const violations = [];
for (const check of checks) {
    node_worker_threads_1.parentPort.postMessage({ type: 'check', id: check.id });
    try {
        violations.push(...(0, project_rules_js_1.scanRules)(files, [check]));
    }
    catch (error) {
        // Use the same ordered message channel; Worker.error can arrive before the check message.
        node_worker_threads_1.parentPort.postMessage({
            type: 'failed',
            id: check.id,
            message: error instanceof Error ? error.message : 'RULE_FAILED',
        });
        process.exit(0);
    }
}
// scanRules keeps the first 50 across checks in order; one check at a time gives the same list.
node_worker_threads_1.parentPort.postMessage({ type: 'done', violations: violations.slice(0, 50) });
//# sourceMappingURL=rule-scan-worker.js.map