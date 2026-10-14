"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.usageJobLimit = void 0;
exports.usageRuns = usageRuns;
exports.projectUsage = projectUsage;
const job_js_1 = require("../domain/job.js");
const run_usage_js_1 = require("../domain/run-usage.js");
const usage_summary_js_1 = require("../domain/usage-summary.js");
/** Line counts per candidate, cached by content hash so repeated views do not diff again. */
const lineCache = new Map();
function candidateLines(c) {
    const key = `${c.id}:${c.hash}`;
    const hit = lineCache.get(key);
    if (hit)
        return hit;
    const files = c.files?.length ? c.files : [{ before: c.before, content: c.content }];
    const counted = files.reduce((s, f) => {
        const d = (0, run_usage_js_1.lineChanges)(f.before, f.content);
        return { added: s.added + d.added, removed: s.removed + d.removed };
    }, { added: 0, removed: 0 });
    if (lineCache.size > 5000)
        lineCache.clear();
    lineCache.set(key, counted);
    return counted;
}
/** What the run's route asked for (ADR 0072): the engine model and effort, and whether a pin chose them. */
function requestedOf(job) {
    const r = job.route;
    if (!r || (!r.engineModel && !r.effort))
        return {};
    return {
        requested: {
            ...(r.engineModel ? { model: r.engineModel } : {}),
            ...(r.effort ? { effort: r.effort } : {}),
            pinned: r.reason === 'EMPLOYEE_LOCK',
        },
    };
}
function usageRuns(jobs, candidates) {
    const byJob = new Map();
    for (const c of candidates)
        if (c.jobId)
            byJob.set(c.jobId, [...(byJob.get(c.jobId) ?? []), c]);
    return jobs.map((job) => {
        const engineRun = job.results.find((r) => r?.name === 'engine.run')?.result;
        const made = byJob.get(job.id) ?? [];
        const workId = (0, job_js_1.jobWorkId)(job);
        const finished = !['QUEUED', 'RUNNING'].includes(job.status);
        return {
            id: job.id,
            title: job.prompt.slice(0, 80),
            employeeId: job.employeeId,
            // Runs from before routing recorded no kind; they are grouped as "no kind recorded".
            kind: job.route?.kind ?? '',
            ...(workId ? { workId } : {}),
            ...(engineRun?.engine ? { engine: engineRun.engine } : {}),
            status: job.status,
            createdAt: job.createdAt,
            ...(job.startedAt ? { startedAt: job.startedAt } : {}),
            ...(finished ? { endedAt: job.updatedAt } : {}),
            usage: job.usage,
            ...(job.modelId ? { modelId: job.modelId } : {}),
            lines: made.length
                ? made
                    .map(candidateLines)
                    .reduce((s, d) => ({ added: s.added + d.added, removed: s.removed + d.removed }))
                : null,
            ...(engineRun?.limits?.length ? { limits: engineRun.limits } : {}),
            ...requestedOf(job),
        };
    });
}
/** Runs read for the panel; enough for a month of a busy project, oldest beyond it dropped. */
exports.usageJobLimit = 5000;
function projectUsage(input, period, now = new Date()) {
    const p = (period || 'today');
    if (!usage_summary_js_1.usagePeriods.includes(p))
        throw Error('INVALID_USAGE_PERIOD');
    const runs = usageRuns(input.jobs, input.candidates);
    const summary = (0, usage_summary_js_1.usageSummary)(runs, {
        period: p,
        now,
        sessionStart: input.sessionStart,
        references: input.references,
        prices: input.prices,
    });
    // A workflow's total is the total of its steps' runs, summarised by the same code.
    const byWorkflow = {};
    for (const w of input.workflows ?? []) {
        const ids = new Set(w.nodes.map((n) => n.workId));
        byWorkflow[w.id] = (0, usage_summary_js_1.usageSummary)(runs.filter((r) => r.workId && ids.has(r.workId)), {
            period: 'all',
            now,
            sessionStart: input.sessionStart,
            references: input.references,
            prices: input.prices,
        }).totals;
    }
    return { ...summary, byWorkflow };
}
//# sourceMappingURL=usage-http.js.map