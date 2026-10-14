"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultNotePolicy = exports.lifecycleFields = void 0;
exports.decisionRetired = decisionRetired;
exports.memoryRetired = memoryRetired;
exports.currentRecord = currentRecord;
exports.carryLifecycle = carryLifecycle;
exports.decisionImpact = decisionImpact;
exports.workOpen = workOpen;
exports.uncheckedDecisionWork = uncheckedDecisionWork;
exports.notePolicy = notePolicy;
exports.noteExpired = noteExpired;
exports.notesToRetire = notesToRetire;
const collaboration_js_1 = require("./collaboration.js");
const record_graph_js_1 = require("./record-graph.js");
/**
 * Decision changes and memory retention (ADR 0067). Fields below are written only by the lifecycle
 * commands; an ordinary edit keeps them as they are and may not change them.
 */
exports.lifecycleFields = {
    decision: ['supersedes', 'supersededBy', 'changeReason', 'affectedIds', 'checkedIds'],
    memory: ['retention', 'retentionReason'],
};
function decisionRetired(e) {
    return e.kind === 'decision' && collaboration_js_1.decisionChangeStates.includes(e.data.status);
}
function memoryRetired(e) {
    return e.kind === 'memory' && typeof e.data.retention === 'string';
}
/** What employees may be told as current: no cancelled/superseded decision, no archived/deleted memory. */
function currentRecord(e) {
    return !decisionRetired(e) && !memoryRetired(e);
}
/**
 * An ordinary edit: a retired record stays as it was (its history is the point), the change states
 * are not chosen in the editor, and lifecycle fields the editor does not know are carried over.
 */
function carryLifecycle(kind, existing, data) {
    const names = exports.lifecycleFields[kind];
    if (!names)
        return data;
    if (existing && decisionRetired(existing))
        throw Error('DECISION_RETIRED');
    if (kind === 'decision' && collaboration_js_1.decisionChangeStates.includes(data.status))
        throw Error('DECISION_CHANGE_REQUIRED');
    if (existing && memoryRetired(existing))
        throw Error(existing.data.retention === 'DELETED' ? 'MEMORY_DELETED' : 'MEMORY_ARCHIVED');
    const out = { ...data };
    for (const name of names) {
        const before = existing?.data[name];
        if (name in data && JSON.stringify(data[name]) !== JSON.stringify(before))
            throw Error('LIFECYCLE_COMMAND_REQUIRED');
        if (before !== undefined)
            out[name] = before;
    }
    return out;
}
const impactKinds = ['work', 'artifact', 'memory', 'decision', 'meeting'];
/**
 * Records that cite a decision through the record graph, plus the work it was decided for. Chat
 * messages are not listed: a message is not a record anyone keeps current. The replacement
 * decision is the change itself, not an impact.
 */
function decisionImpact(visible, decision) {
    const byId = new Map(visible.map((e) => [e.id, e])), rows = new Map();
    const work = (0, collaboration_js_1.string)(decision.data, 'workId');
    if (byId.get(work)?.kind === 'work')
        rows.set(work, 'workId');
    for (const edge of (0, record_graph_js_1.recordEdges)(visible))
        if (edge.from === decision.id && edge.relation !== 'supersedes' && !rows.has(edge.to))
            rows.set(edge.to, edge.relation);
    return [...rows]
        .map(([id, relation]) => ({ entity: byId.get(id), relation }))
        .filter(({ entity }) => impactKinds.includes(entity.kind) && entity.data.retention !== 'DELETED')
        .map(({ entity: e, relation }) => ({
        id: e.id,
        kind: e.kind,
        version: e.version,
        title: (0, collaboration_js_1.string)(e.data, 'title') || (0, collaboration_js_1.string)(e.data, 'name'),
        status: (0, collaboration_js_1.string)(e.data, 'status'),
        relation,
        open: workOpen(e),
    }));
}
function workOpen(e) {
    return e.kind === 'work' && e.data.status !== 'DONE' && e.data.triage !== 'DECLINED';
}
/** Open work affected by a changed decision that the owner has not marked checked yet. */
function uncheckedDecisionWork(entities) {
    const byId = new Map(entities.map((e) => [e.id, e])), out = [];
    for (const decision of entities.filter(decisionRetired)) {
        const checked = (0, collaboration_js_1.strings)(decision.data, 'checkedIds');
        for (const id of (0, collaboration_js_1.strings)(decision.data, 'affectedIds')) {
            const work = byId.get(id);
            if (work && workOpen(work) && !checked.includes(id))
                out.push({ work, decision });
        }
    }
    return out;
}
exports.defaultNotePolicy = Object.freeze({ notesPerEmployee: 20, noteExpiryDays: 90 });
function notePolicy(config = {}) {
    const policy = { ...exports.defaultNotePolicy, ...config };
    if (!Number.isSafeInteger(policy.notesPerEmployee) ||
        policy.notesPerEmployee < 1 ||
        policy.notesPerEmployee > 200 ||
        !Number.isSafeInteger(policy.noteExpiryDays) ||
        policy.noteExpiryDays < 1 ||
        policy.noteExpiryDays > 3650)
        throw Error('INVALID_COLLAB_CONFIG');
    return policy;
}
function noteExpired(note, policy, now) {
    return Date.parse(note.updatedAt) < now.getTime() - policy.noteExpiryDays * 86400000;
}
/** Active self notes the policy retires: expired ones, then the oldest beyond the cap. */
function notesToRetire(entities, employeeId, policy, now) {
    // Newest first; notes saved in the same millisecond keep their stored order (later = newer).
    const notes = entities
        .map((e, index) => ({ e, index }))
        .filter(({ e }) => e.kind === 'memory' && e.data.employeeId === employeeId && !memoryRetired(e))
        .sort((a, b) => b.e.updatedAt.localeCompare(a.e.updatedAt) || b.index - a.index)
        .map(({ e }) => e);
    const expired = notes.filter((e) => noteExpired(e, policy, now)), kept = notes.filter((e) => !noteExpired(e, policy, now));
    return { expired, overCap: kept.slice(policy.notesPerEmployee) };
}
//# sourceMappingURL=record-lifecycle.js.map