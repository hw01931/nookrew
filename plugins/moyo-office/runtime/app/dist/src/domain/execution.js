"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.terminalStates = void 0;
exports.isTerminal = isTerminal;
exports.assertTransition = assertTransition;
exports.passesGate = passesGate;
exports.terminalStates = ['VERIFIED', 'REJECTED', 'FAILED', 'TIMED_OUT', 'CANCELED', 'UNKNOWN'];
const transitions = {
    CREATED: ['PREPARING', 'CANCEL_REQUESTED', 'FAILED', 'UNKNOWN'],
    PREPARING: ['RUNNING', 'CANCEL_REQUESTED', 'FAILED', 'TIMED_OUT', 'UNKNOWN'],
    RUNNING: ['OUTPUT_READY', 'CANCEL_REQUESTED', 'FAILED', 'TIMED_OUT', 'UNKNOWN'],
    OUTPUT_READY: ['VERIFYING', 'CANCEL_REQUESTED', 'FAILED', 'TIMED_OUT', 'UNKNOWN'],
    VERIFYING: ['VERIFIED', 'REJECTED', 'CANCEL_REQUESTED', 'FAILED', 'TIMED_OUT', 'UNKNOWN'],
    CANCEL_REQUESTED: ['CANCELED', 'UNKNOWN'],
    VERIFIED: [],
    REJECTED: [],
    FAILED: [],
    TIMED_OUT: [],
    CANCELED: [],
    UNKNOWN: [],
};
function isTerminal(state) {
    return exports.terminalStates.some((s) => s === state);
}
function assertTransition(from, to) {
    if (!transitions[from].includes(to))
        throw new Error(`INVALID_TRANSITION: ${from} -> ${to}`);
}
function passesGate(task, evidence, snapshot) {
    const required = task.verification.filter((check) => check.required);
    return (required.length > 0 &&
        required.every((check) => {
            const rows = evidence.filter((row) => row.check_id === check.check_id);
            return (rows.length === 1 &&
                rows[0]?.snapshot_hash === snapshot &&
                rows[0].status === 'PASS' &&
                rows[0].executed > 0 &&
                rows[0].passed === rows[0].executed);
        }));
}
//# sourceMappingURL=execution.js.map