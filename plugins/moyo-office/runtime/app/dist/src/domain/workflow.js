"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.finishedWorkflowStatuses = exports.liveWorkflowStatuses = exports.workflowLimits = void 0;
exports.workDefinition = workDefinition;
exports.workflowWorks = workflowWorks;
exports.workflowProgress = workflowProgress;
const collaboration_js_1 = require("./collaboration.js");
exports.workflowLimits = { tasks: 20, attempts: 3, tokens: 300000 };
/** Runs that still dispatch or wait on their nodes; a restart or shutdown pauses them. */
exports.liveWorkflowStatuses = ['RUNNING', 'WAITING_REVIEW', 'BLOCKED'];
exports.finishedWorkflowStatuses = ['COMPLETED', 'CANCELED'];
// Status and attached deliverables may change during review. Assignment, inputs and scope may not.
function workDefinition(work) {
    const { status, artifactIds, ...definition } = work.data;
    return JSON.stringify({ definition, audience: [...work.audience].sort() });
}
function workflowWorks(root, entities) {
    if (root.kind !== 'work')
        throw Error('INVALID_WORK');
    const children = entities.filter((e) => e.kind === 'work' && e.data.parentId === root.id);
    if (!children.length || children.length > exports.workflowLimits.tasks)
        throw Error('WORKFLOW_TASK_LIMIT');
    if (children.some((e) => entities.some((child) => child.kind === 'work' && child.data.parentId === e.id)))
        throw Error('WORKFLOW_NESTING_UNSUPPORTED');
    const ids = new Set(children.map((e) => e.id));
    if (children.some((e) => (0, collaboration_js_1.strings)(e.data, 'dependencies').includes(root.id)))
        throw Error('WORKFLOW_PARENT_DEPENDENCY');
    const pending = new Set(ids), ordered = [];
    while (pending.size) {
        const ready = children.find((e) => pending.has(e.id) && (0, collaboration_js_1.strings)(e.data, 'dependencies').every((id) => !pending.has(id)));
        if (!ready)
            throw Error('DEPENDENCY_CYCLE');
        ordered.push(ready);
        pending.delete(ready.id);
    }
    return ordered;
}
function workflowProgress(run, read, job) {
    return run.nodes.map((node) => {
        const work = read(node.workId), current = node.jobId ? job(node.jobId) : null;
        return {
            ...node,
            workVersion: work.version,
            workStatus: (0, collaboration_js_1.string)(work.data, 'status'),
            dependencies: (0, collaboration_js_1.strings)(work.data, 'dependencies'),
            assigneeId: (0, collaboration_js_1.string)(work.data, 'assigneeId'),
            jobStatus: current?.status ?? 'NOT_RUN',
            tokens: current?.tokens ?? 0,
            jobError: current?.error ?? null,
        };
    });
}
//# sourceMappingURL=workflow.js.map