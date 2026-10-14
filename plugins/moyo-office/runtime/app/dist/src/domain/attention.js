"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attentionQueue = attentionQueue;
const collaboration_js_1 = require("./collaboration.js");
const job_outcome_js_1 = require("./job-outcome.js");
const record_lifecycle_js_1 = require("./record-lifecycle.js");
function attentionQueue(entities, jobs, seen = new Map()) {
    const items = [], byId = new Map(entities.map((e) => [e.id, e]));
    const add = (e, category, reason, priority, values) => {
        const id = e.kind + ':' + e.id + ':' + reason;
        items.push({
            id,
            sourceId: e.id,
            sourceKind: e.kind,
            version: e.version,
            category,
            reason,
            title: (0, collaboration_js_1.string)(e.data, 'title') || (0, collaboration_js_1.string)(e.data, 'name'),
            ...(values ? { values } : {}),
            updatedAt: e.updatedAt,
            priority,
            seen: seen.get(id) === e.version,
        });
    };
    for (const e of entities) {
        // Drafted work waits here until the owner accepts or declines it (ADR 0058).
        if (e.kind === 'work' && e.data.triage === 'PENDING') {
            add(e, 'triage', 'TRIAGE', 0);
            continue;
        }
        if (e.kind === 'work' && e.data.triage === 'DECLINED')
            continue;
        if (e.kind === 'work' && e.data.status === 'BLOCKED')
            add(e, 'issue', 'BLOCKED', 1);
        if (e.kind === 'work' && e.data.status === 'REVIEW')
            add(e, 'review', 'WORK_REVIEW', 3);
        if (e.kind === 'artifact' && e.data.status === 'REVIEW')
            add(e, 'review', 'ARTIFACT_REVIEW', 3);
        if (e.kind === 'decision' && e.data.status === 'PROPOSED')
            add(e, 'decision', 'PROPOSED', 2);
        if (e.kind === 'feedback' && e.data.verdict === 'CHANGES') {
            const document = byId.get((0, collaboration_js_1.string)(e.data, 'artifactId'));
            if (!document)
                continue;
            add({ ...e, data: { ...e.data, title: (0, collaboration_js_1.string)(document.data, 'title') } }, 'feedback', 'CHANGES', 2, {
                artifactVersion: Number(e.data.artifactVersion),
                // Written on another version than the document has now.
                stale: document.version !== e.data.artifactVersion,
                body: (0, collaboration_js_1.string)(e.data, 'body').slice(0, 300),
            });
        }
    }
    // Work citing a cancelled or superseded decision waits here until the owner checks it (ADR 0067).
    for (const { work, decision } of (0, record_lifecycle_js_1.uncheckedDecisionWork)(entities)) {
        const id = 'work:' + work.id + ':DECISION_CHANGED:' + decision.id;
        items.push({
            id,
            sourceId: work.id,
            sourceKind: 'work',
            version: decision.version,
            category: 'decision',
            reason: 'DECISION_CHANGED',
            title: (0, collaboration_js_1.string)(work.data, 'title'),
            updatedAt: decision.updatedAt,
            priority: 1,
            seen: seen.get(id) === decision.version,
            decision: {
                id: decision.id,
                title: (0, collaboration_js_1.string)(decision.data, 'title'),
                status: (0, collaboration_js_1.string)(decision.data, 'status'),
                version: decision.version,
            },
        });
    }
    for (const job of jobs) {
        const outcome = (0, job_outcome_js_1.jobOutcome)(job);
        if (job.status !== 'UNKNOWN' && job.status !== 'FAILED' && !outcome.failed)
            continue;
        const target = byId.get(job.targetId), reason = job.status === 'UNKNOWN' ? 'UNKNOWN' : job.status === 'FAILED' ? 'FAILED' : 'TOOL_ERRORS', id = 'job:' + job.id + ':' + reason;
        items.push({
            id,
            sourceId: job.id,
            sourceKind: 'job',
            version: job.version,
            category: 'issue',
            reason,
            title: target ? (0, collaboration_js_1.string)(target.data, 'title') : '',
            ...(reason === 'TOOL_ERRORS' ? { values: { failed: outcome.failed } } : {}),
            updatedAt: job.updatedAt,
            priority: reason === 'UNKNOWN' ? 0 : 1,
            seen: seen.get(id) === job.version,
        });
    }
    return items.sort((a, b) => a.priority - b.priority || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
//# sourceMappingURL=attention.js.map