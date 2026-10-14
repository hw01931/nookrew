"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobOutcome = jobOutcome;
function jobOutcome(job) {
    const results = job.results.filter((r) => !!r && typeof r === 'object');
    const automatic = results.filter((r) => r.origin === 'report-preservation').length;
    const calls = results.filter((r) => r.origin !== 'report-preservation');
    const failed = calls.filter((r) => !!r.error).length, succeeded = calls.length - failed;
    return {
        state: outcomeState(job.status, succeeded, failed),
        succeeded,
        failed,
        total: calls.length,
        automatic,
    };
}
function outcomeState(status, succeeded, failed) {
    if (status === 'UNKNOWN')
        return 'UNKNOWN';
    if (status === 'FAILED' || status === 'CANCELED')
        return 'INTERRUPTED';
    if (status === 'QUEUED')
        return 'NOT_RUN';
    if (status === 'RUNNING')
        return 'RUNNING';
    if (!succeeded && !failed)
        return 'NO_TOOLS';
    if (!failed)
        return 'TOOLS_SUCCEEDED';
    return succeeded ? 'PARTIAL' : 'TOOLS_FAILED';
}
//# sourceMappingURL=job-outcome.js.map