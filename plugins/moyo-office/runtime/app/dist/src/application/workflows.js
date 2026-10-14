"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Workflows = void 0;
const collaboration_js_1 = require("../domain/collaboration.js");
const command_js_1 = require("../domain/command.js");
const workflow_js_1 = require("../domain/workflow.js");
const hash_js_1 = require("../infrastructure/hash.js");
const workflow_store_js_1 = require("../infrastructure/workflow-store.js");
const job_outcome_js_1 = require("../domain/job-outcome.js");
const job_js_1 = require("../domain/job.js");
/** Durable intent and dispatch checkpoints. Actual jobs always use Collaboration.startWork. */
class Workflows {
    office;
    scheduled = false;
    closed = false;
    runs;
    constructor(office) {
        this.office = office;
        this.runs = new workflow_store_js_1.WorkflowStore(office.store);
        this.pauseLive('SERVER_RESTARTED');
    }
    pauseLive(error) {
        for (const run of this.list())
            if (workflow_js_1.liveWorkflowStatuses.includes(run.status)) {
                run.status = 'PAUSED';
                run.error = error;
                this.save(run);
            }
    }
    list() {
        return this.runs.list();
    }
    get(id) {
        const run = this.runs.get(id);
        if (!run)
            throw Error('WORKFLOW_NOT_FOUND');
        return run;
    }
    view() {
        return this.list().map((run) => ({
            ...run,
            nodes: (0, workflow_js_1.workflowProgress)(run, (id) => this.office.store.get(id), (id) => this.office.job(id)),
        }));
    }
    save(run) {
        run.version++;
        run.updatedAt = new Date().toISOString();
        this.runs.save(run);
    }
    validate(command, create = false) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.office.store.project, minVersion: create ? 0 : 1 });
    }
    receipt(command, input, write) {
        const key = (0, hash_js_1.hash)(['workflow', command.project_id, command.actor, command.idempotency_key]), fingerprint = (0, hash_js_1.hash)([input, command.expected_version]);
        return this.office.store.idempotent(key, fingerprint, write);
    }
    preview(rootId) {
        const root = this.office.store.read(rootId, collaboration_js_1.owner), works = (0, workflow_js_1.workflowWorks)(root, this.office.store.all());
        const nodes = works.map((work) => {
            const employee = this.office.store.read((0, collaboration_js_1.string)(work.data, 'assigneeId'), collaboration_js_1.owner), room = this.office.store.read((0, collaboration_js_1.string)(work.data, 'roomId'), collaboration_js_1.owner), actor = { kind: 'employee', id: employee.id };
            if (employee.kind !== 'employee' ||
                employee.data.enabled !== true ||
                room.kind !== 'room' ||
                !this.office.store.canRead(work, actor) ||
                !this.office.store.canRead(room, actor))
                throw Error('WORKFLOW_ASSIGNMENT_INVALID');
            this.office.store.allowTool(actor, 'message.write');
            for (const dep of (0, collaboration_js_1.strings)(work.data, 'dependencies'))
                this.office.store.read(dep, actor);
            if (room.audience.some((a) => !work.audience.includes(a)))
                throw Error('SOURCE_AUDIENCE_CONFLICT');
            return {
                workId: work.id,
                title: (0, collaboration_js_1.string)(work.data, 'title'),
                definition: (0, workflow_js_1.workDefinition)(work),
                employeeVersion: employee.version,
                reservation: Number(employee.data.tokenBudget),
                attempt: 0,
            };
        });
        const evidence = { rootId, rootVersion: root.version, rootDefinition: (0, workflow_js_1.workDefinition)(root), nodes };
        return {
            ...evidence,
            title: (0, collaboration_js_1.string)(root.data, 'title'),
            snapshotHash: (0, hash_js_1.hash)(evidence),
            minimumTokens: nodes
                .filter((n) => this.office.store.get(n.workId).data.status !== 'DONE')
                .reduce((sum, n) => sum + n.reservation, 0),
            limits: workflow_js_1.workflowLimits,
        };
    }
    start(rootId, snapshotHash, tokenLimit, command) {
        this.validate(command);
        const run = this.receipt(command, { action: 'start', rootId, snapshotHash, tokenLimit }, () => {
            const plan = this.preview(rootId);
            if (plan.rootVersion !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            if (plan.snapshotHash !== snapshotHash)
                throw Error('SOURCE_CHANGED');
            if (!Number.isSafeInteger(tokenLimit) ||
                tokenLimit < plan.minimumTokens ||
                tokenLimit > workflow_js_1.workflowLimits.tokens)
                throw Error('WORKFLOW_BUDGET');
            if (this.list().some((r) => r.rootId === rootId && !workflow_js_1.finishedWorkflowStatuses.includes(r.status)))
                throw Error('WORKFLOW_ALREADY_ACTIVE');
            const now = new Date().toISOString(), run = {
                id: (0, hash_js_1.hash)(['workflow', command.project_id, command.idempotency_key]),
                rootId,
                title: plan.title,
                rootDefinition: plan.rootDefinition,
                version: 0,
                status: 'RUNNING',
                nodes: plan.nodes,
                tokenLimit,
                reservedTokens: 0,
                createdAt: now,
                updatedAt: now,
                correlationId: command.correlation_id,
            };
            this.save(run);
            this.office.store.log(collaboration_js_1.owner, 'workflow.start', run.id, 'SUCCEEDED');
            return run;
        });
        this.schedule();
        return run;
    }
    control(id, action, nodeId, command) {
        this.validate(command);
        const result = this.receipt(command, { id, action, nodeId }, () => {
            const run = this.get(id);
            if (run.version !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            if (workflow_js_1.finishedWorkflowStatuses.includes(run.status))
                throw Error('WORKFLOW_TERMINAL');
            if (action === 'pause') {
                run.status = 'PAUSED';
                run.error = 'USER_PAUSED';
            }
            else if (action === 'cancel') {
                run.status = 'CANCELED';
                run.error = 'USER_CANCELED';
            }
            else {
                if (action === 'retry') {
                    const node = run.nodes.find((n) => n.workId === nodeId);
                    if (!node?.jobId)
                        throw Error('WORKFLOW_NODE_NOT_RETRYABLE');
                    const job = this.office.job(node.jobId);
                    if (job_js_1.activeJobStatuses.includes(job.status) || node.attempt >= workflow_js_1.workflowLimits.attempts)
                        throw Error('WORKFLOW_NODE_NOT_RETRYABLE');
                    if (run.reservedTokens + node.reservation > run.tokenLimit)
                        throw Error('WORKFLOW_BUDGET');
                    // UNKNOWN has possible side effects. Retry is explicit, creates a new attempt and keeps old jobs.
                    delete node.jobId;
                    delete node.requestKey;
                    delete node.error;
                }
                run.status = 'RUNNING';
                delete run.error;
            }
            this.save(run);
            this.office.store.log(collaboration_js_1.owner, 'workflow.' + action, id, 'SUCCEEDED');
            return run;
        });
        this.schedule();
        return result;
    }
    schedule() {
        if (this.closed || this.scheduled)
            return;
        this.scheduled = true;
        queueMicrotask(() => {
            this.scheduled = false;
            if (this.closed || !this.runs.isOpen)
                return;
            for (const run of this.list())
                if (workflow_js_1.liveWorkflowStatuses.includes(run.status))
                    try {
                        this.advance(run.id);
                    }
                    catch (error) {
                        this.office.store.log(collaboration_js_1.owner, 'workflow.checkpoint', run.id, error instanceof Error ? error.message : 'FAILED');
                    }
        });
    }
    /**
     * Ordering hint (ADR 0063): among nodes, those whose next run would use the same target as the
     * newest run come first, so work on one model runs back to back while its prompt cache is warm.
     * Otherwise the plan order is kept (stable sort); a node whose route cannot be told keeps its place.
     */
    sameModelFirst(nodes) {
        const last = this.office.jobs().find((j) => j.route)?.route?.target;
        if (!last)
            return nodes;
        const same = (node) => {
            try {
                const work = this.office.store.get(node.workId), employee = this.office.store.get((0, collaboration_js_1.string)(work.data, 'assigneeId'));
                const t = this.office.routeOf(employee, this.office.workMode(employee), work.id).target;
                return t.kind === last.kind && t.id === last.id ? 0 : 1;
            }
            catch {
                return 1;
            }
        };
        return nodes
            .map((node, i) => ({ node, i, rank: same(node) }))
            .sort((a, b) => a.rank - b.rank || a.i - b.i)
            .map((x) => x.node);
    }
    advance(id) {
        const run = this.get(id), store = this.office.store;
        const pause = (error) => {
            run.status = 'PAUSED';
            run.error = error;
            this.save(run);
        };
        if ((0, workflow_js_1.workDefinition)(store.get(run.rootId)) !== run.rootDefinition) {
            pause('WORKFLOW_SOURCE_CHANGED');
            return;
        }
        try {
            const ids = (0, workflow_js_1.workflowWorks)(store.get(run.rootId), store.all()).map((w) => w.id);
            if (ids.length !== run.nodes.length || run.nodes.some((n) => !ids.includes(n.workId))) {
                pause('WORKFLOW_SOURCE_CHANGED');
                return;
            }
        }
        catch {
            pause('WORKFLOW_SOURCE_CHANGED');
            return;
        }
        // Validate the entire pinned plan before dispatching even its first node.
        for (const node of run.nodes) {
            const work = store.get(node.workId), employee = store.get((0, collaboration_js_1.string)(work.data, 'assigneeId'));
            if ((0, workflow_js_1.workDefinition)(work) !== node.definition || employee.version !== node.employeeVersion) {
                pause('WORKFLOW_SOURCE_CHANGED');
                return;
            }
        }
        let running = run.nodes.some((n) => n.jobId && job_js_1.activeJobStatuses.includes(this.office.job(n.jobId).status)), review = false, blocked = false;
        for (const node of this.sameModelFirst(run.nodes)) {
            const work = store.get(node.workId);
            // Discover the original job after a crash between dispatch and checkpoint write.
            if (node.requestKey && !node.jobId) {
                const found = this.office.workRequest(node.requestKey);
                if (found)
                    node.jobId = found.id;
            }
            if (node.jobId) {
                const job = this.office.job(node.jobId);
                if (job_js_1.activeJobStatuses.includes(job.status)) {
                    running = true;
                    continue;
                }
                if (work.data.status === 'DONE')
                    continue;
                if (job.status !== 'SUCCEEDED' || (0, job_outcome_js_1.jobOutcome)(job).failed) {
                    node.error = job.error ?? 'WORKFLOW_TOOL_FAILURE';
                    pause(node.error);
                    return;
                }
                review = true;
                continue;
            }
            if (work.data.status === 'DONE')
                continue;
            if (work.data.status === 'BLOCKED' ||
                (0, collaboration_js_1.strings)(work.data, 'dependencies').some((dep) => store.get(dep).data.status !== 'DONE')) {
                blocked = true;
                continue;
            }
            if (running)
                continue; // One active job per workflow; single GPU queue remains shared.
            if (!node.requestKey) {
                if (node.attempt >= workflow_js_1.workflowLimits.attempts ||
                    run.reservedTokens + node.reservation > run.tokenLimit) {
                    pause('WORKFLOW_BUDGET');
                    return;
                }
                node.attempt++;
                node.requestKey = (0, hash_js_1.hash)([run.id, node.workId, node.attempt]);
                run.reservedTokens += node.reservation;
                this.save(run);
            }
            try {
                const job = this.office.startWork(work.id, {
                    ...this.office.command(collaboration_js_1.owner, node.requestKey, work.version),
                    correlation_id: run.correlationId,
                });
                node.jobId = job.id;
                running = true;
            }
            catch (error) {
                node.error = error instanceof Error ? error.message : 'WORKFLOW_START_FAILED';
                pause(node.error);
                return;
            }
        }
        const status = running
            ? 'RUNNING'
            : run.nodes.every((n) => store.get(n.workId).data.status === 'DONE')
                ? 'COMPLETED'
                : review
                    ? 'WAITING_REVIEW'
                    : blocked
                        ? 'BLOCKED'
                        : 'RUNNING';
        const changed = JSON.stringify(run) !== JSON.stringify(this.get(id));
        if (status !== run.status || changed) {
            run.status = status;
            delete run.error;
            this.save(run);
        }
    }
    close() {
        this.closed = true;
        this.pauseLive('SERVER_CLOSING');
    }
}
exports.Workflows = Workflows;
//# sourceMappingURL=workflows.js.map