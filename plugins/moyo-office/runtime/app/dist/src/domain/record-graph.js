"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordEdges = recordEdges;
exports.traceRecord = traceRecord;
exports.workPlanning = workPlanning;
const collaboration_js_1 = require("./collaboration.js");
const work_execution_js_1 = require("./work-execution.js");
/** Only caller-visible records enter the graph; hidden IDs never become nodes. */
function recordEdges(visible) {
    const ids = new Set(visible.map((e) => e.id)), edges = [];
    for (const e of visible) {
        for (const field of ['dependencies', 'sourceIds', 'artifactIds', 'links'])
            for (const ref of (0, collaboration_js_1.strings)(e.data, field))
                if (ids.has(ref) && ref !== e.id)
                    edges.push({ from: ref, to: e.id, relation: field });
        for (const field of ['parentId', 'workId', 'meetingId', 'artifactId', 'supersedes']) {
            const ref = (0, collaboration_js_1.string)(e.data, field);
            if (ids.has(ref) && ref !== e.id)
                edges.push({ from: ref, to: e.id, relation: field });
        }
    }
    return edges;
}
function traceRecord(visible, id, limit = 100) {
    const target = visible.find((e) => e.id === id);
    if (!target)
        throw Error('ACCESS_DENIED');
    const edges = recordEdges(visible), upstream = edges.filter((e) => e.to === id), downstream = edges.filter((e) => e.from === id);
    const seen = new Set([id]), queue = [id], impacted = [];
    const next = new Map();
    for (const edge of edges)
        next.set(edge.from, [...(next.get(edge.from) || []), edge.to]);
    for (let index = 0; index < queue.length; index++)
        for (const child of next.get(queue[index]) || [])
            if (!seen.has(child)) {
                seen.add(child);
                queue.push(child);
                impacted.push(child);
            }
    const selected = new Set([id, ...upstream.slice(0, limit).map((e) => e.from), ...impacted.slice(0, limit)]);
    return {
        target: id,
        upstream: upstream.slice(0, limit),
        downstream: downstream.slice(0, limit),
        impacted: impacted.slice(0, limit),
        totalImpacted: impacted.length,
        truncated: impacted.length > limit || upstream.length > limit || downstream.length > limit,
        records: [target, ...visible.filter((e) => e.id !== id && selected.has(e.id))].map((e) => ({
            id: e.id,
            kind: e.kind,
            version: e.version,
            title: (0, collaboration_js_1.string)(e.data, 'title') || (0, collaboration_js_1.string)(e.data, 'name') || (0, collaboration_js_1.string)(e.data, 'body').slice(0, 100),
            status: (0, collaboration_js_1.string)(e.data, 'status'),
        })),
    };
}
function workPlanning(visible, canRead) {
    const works = visible.filter((e) => e.kind === 'work'), employees = visible.filter((e) => e.kind === 'employee'), byId = new Map(visible.map((e) => [e.id, e]));
    const workload = new Map();
    for (const work of works)
        if (work.data.status !== 'DONE') {
            const id = (0, collaboration_js_1.string)(work.data, 'assigneeId');
            workload.set(id, (workload.get(id) || 0) + 1);
        }
    return works.map((work) => {
        const d = work.data, dependencies = (0, collaboration_js_1.strings)(d, 'dependencies'), blocked = dependencies.filter((id) => byId.get(id)?.data.status !== 'DONE');
        const assigned = byId.get((0, collaboration_js_1.string)(d, 'assigneeId')), room = byId.get((0, collaboration_js_1.string)(d, 'roomId'));
        const issues = [];
        if (!assigned)
            issues.push('UNASSIGNED');
        else if (assigned.data.enabled !== true)
            issues.push('EMPLOYEE_DISABLED');
        if (!room)
            issues.push('ROOM_REQUIRED');
        else if (assigned && (!canRead(work, assigned) || !canRead(room, assigned)))
            issues.push('ASSIGNEE_ACCESS');
        if (blocked.length)
            issues.push('DEPENDENCY_NOT_DONE');
        if ((0, work_execution_js_1.workNotRunnable)(work))
            issues.push('WORK_NOT_RUNNABLE');
        const scheduleConflicts = dependencies.filter((id) => {
            const upstream = byId.get(id);
            return (upstream &&
                (0, collaboration_js_1.string)(upstream.data, 'dueDate') &&
                (0, collaboration_js_1.string)(d, 'startDate') &&
                (0, collaboration_js_1.string)(upstream.data, 'dueDate') >= (0, collaboration_js_1.string)(d, 'startDate'));
        });
        const candidates = employees
            .filter((e) => e.data.enabled === true &&
            room &&
            canRead(work, e) &&
            canRead(room, e) &&
            (0, collaboration_js_1.strings)(e.data, 'tools').includes('message.write'))
            .map((e) => ({
            id: e.id,
            role: (0, collaboration_js_1.string)(e.data, 'role'),
            open: workload.get(e.id) || 0,
            tools: (0, collaboration_js_1.strings)(e.data, 'tools'),
        }))
            .sort((a, b) => a.open - b.open || a.id.localeCompare(b.id));
        return {
            id: work.id,
            version: work.version,
            issues,
            blocked: blocked.filter((id) => byId.has(id)),
            unavailableDependencies: blocked.filter((id) => !byId.has(id)).length,
            scheduleConflicts,
            candidates,
        };
    });
}
//# sourceMappingURL=record-graph.js.map