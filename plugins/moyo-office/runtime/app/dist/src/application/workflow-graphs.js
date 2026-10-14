"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowGraphs = void 0;
const collaboration_js_1 = require("../domain/collaboration.js");
const command_js_1 = require("../domain/command.js");
const job_js_1 = require("../domain/job.js");
const workflow_graph_js_1 = require("../domain/workflow-graph.js");
const hash_js_1 = require("../infrastructure/hash.js");
const workflow_store_js_1 = require("../infrastructure/workflow-store.js");
/** Verification states of a change candidate that count as a recorded pass. */
const verifiedStates = ['VERIFIED', 'APPROVED', 'APPLYING', 'APPLIED'];
/** Capacity is a queue condition, not a failure: the same attempt is dispatched on a later pass. */
const retryLater = ['RUN_CAPACITY', 'WORK_ALREADY_RUNNING'];
/**
 * Engine for workflow definitions (ADR 0068). Each step instance becomes an ordinary work item run
 * through Collaboration.startWork, so permissions, budgets and records are those of hand-assigned
 * work. Decisions come from evaluateGraph over stored job, work and verification states. Every
 * dispatch is checkpointed before its side effect and keyed so a repeat finds the same work and job.
 */
class WorkflowGraphs {
    office;
    scheduled = false;
    closed = false;
    timer;
    runs;
    constructor(office) {
        this.office = office;
        this.runs = new workflow_store_js_1.WorkflowGraphStore(office.store);
        // Jobs that were running are already UNKNOWN; the owner decides what happens next.
        this.pauseLive('SERVER_RESTARTED');
    }
    pauseLive(error) {
        for (const run of this.list())
            if (workflow_graph_js_1.liveGraphStatuses.includes(run.status)) {
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
    /** Runs with each reached instance's state, read-only. */
    view() {
        return this.list().map((run) => {
            const facts = {};
            const evaluation = (0, workflow_graph_js_1.evaluateGraph)(run.definition, (key) => (facts[key] = this.fact(run, key, false)));
            return {
                ...run,
                steps: Object.entries(facts).map(([key, fact]) => {
                    const instance = run.instances[key], attempt = instance?.attempts.at(-1), job = attempt?.jobId ? this.office.store.job(attempt.jobId) : undefined;
                    return {
                        key,
                        stepId: key.split('/').at(-1),
                        fact,
                        workId: instance?.workId ?? null,
                        attempt: attempt?.attempt ?? 0,
                        jobStatus: job?.status ?? 'NOT_RUN',
                        jobError: job?.error ?? instance?.error ?? null,
                        retryable: !!instance && this.retryable(run, instance),
                    };
                }),
                outcomes: evaluation.outcomes,
            };
        });
    }
    save(run) {
        run.version++;
        run.updatedAt = new Date().toISOString();
        this.runs.save(run);
    }
    receipt(command, input, write) {
        const key = (0, hash_js_1.hash)(['workflow-graph', command.project_id, command.actor, command.idempotency_key]), fingerprint = (0, hash_js_1.hash)([input, command.expected_version]);
        return this.office.store.idempotent(key, fingerprint, write);
    }
    /** Checks assignments the same way a hand-started run would, before anything is recorded. */
    assignment(step, roomId) {
        const store = this.office.store, employee = store.read(step.assigneeId, collaboration_js_1.owner), room = store.read(step.roomId ?? roomId, collaboration_js_1.owner);
        if (employee.kind !== 'employee' ||
            employee.data.enabled !== true ||
            room.kind !== 'room' ||
            !store.canRead(room, { kind: 'employee', id: employee.id }))
            throw Error('WORKFLOW_ASSIGNMENT_INVALID:' + step.id);
        return { employee, room };
    }
    start(input, tokenLimit, command) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.office.store.project });
        const definition = (0, workflow_graph_js_1.validateGraph)(input);
        const run = this.receipt(command, { action: 'start', definition, tokenLimit }, () => {
            const reservations = (0, workflow_graph_js_1.workSteps)(definition.steps).map((s) => Number(this.assignment(s, definition.roomId).employee.data.tokenBudget));
            if (!Number.isSafeInteger(tokenLimit) ||
                tokenLimit < Math.max(...reservations) ||
                tokenLimit > workflow_graph_js_1.graphLimits.tokens)
                throw Error('WORKFLOW_BUDGET');
            const now = new Date().toISOString(), run = {
                id: (0, hash_js_1.hash)(['workflow-graph', command.project_id, command.idempotency_key]),
                version: 0,
                title: definition.title,
                definition,
                status: 'RUNNING',
                tokenLimit,
                reservedTokens: 0,
                instances: {},
                createdAt: now,
                updatedAt: now,
                correlationId: command.correlation_id,
            };
            this.save(run);
            this.office.store.log(collaboration_js_1.owner, 'workflow-graph.start', run.id, 'SUCCEEDED');
            return run;
        });
        this.schedule();
        return run;
    }
    control(id, action, stepKey, command) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.office.store.project, minVersion: 1 });
        const result = this.receipt(command, { id, action, stepKey }, () => {
            const run = this.get(id);
            if (run.version !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            if (workflow_graph_js_1.finishedGraphStatuses.includes(run.status))
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
                if (action === 'retry')
                    this.retry(run, stepKey);
                run.status = 'RUNNING';
                delete run.error;
            }
            this.save(run);
            this.office.store.log(collaboration_js_1.owner, 'workflow-graph.' + action, id, 'SUCCEEDED');
            return run;
        });
        // Cancel also stops the run's jobs still going; their late results change nothing (terminal run).
        if (action === 'cancel')
            for (const instance of Object.values(result.instances)) {
                const jobId = instance.attempts.at(-1)?.jobId, job = jobId ? this.office.store.job(jobId) : undefined;
                if (job && job_js_1.activeJobStatuses.includes(job.status))
                    this.office.cancel(job.id, job.version);
            }
        this.schedule();
        return result;
    }
    /** An open run's instance whose newest job ended without success, under the attempt cap. */
    retryable(run, instance) {
        const last = instance.attempts.at(-1), job = last?.jobId ? this.office.store.job(last.jobId) : undefined;
        return (!workflow_graph_js_1.finishedGraphStatuses.includes(run.status) &&
            !!job &&
            ['FAILED', 'CANCELED', 'UNKNOWN'].includes(job.status) &&
            last.attempt < workflow_graph_js_1.graphLimits.attempts);
    }
    /** A failed or UNKNOWN instance gets a new attempt; earlier jobs stay as they are. */
    retry(run, key) {
        const instance = run.instances[key], last = instance?.attempts.at(-1);
        if (!instance || !last || !this.retryable(run, instance))
            throw Error('WORKFLOW_STEP_NOT_RETRYABLE');
        if (run.reservedTokens + last.reservation > run.tokenLimit)
            throw Error('WORKFLOW_BUDGET');
        run.reservedTokens += last.reservation;
        instance.attempts.push({
            attempt: last.attempt + 1,
            requestKey: (0, hash_js_1.hash)(['workflow-graph', run.id, key, last.attempt + 1]),
            reservation: last.reservation,
        });
        delete instance.error;
    }
    /**
     * What is recorded about one instance. With discover set, a dispatch whose checkpoint was lost
     * after the job was created is reattached by its request key instead of being sent again.
     */
    fact(run, key, discover) {
        const instance = run.instances[key], attempt = instance?.attempts.at(-1);
        if (!instance || !attempt)
            return 'new';
        if (!attempt.jobId) {
            const found = this.office.workRequest(attempt.requestKey);
            if (!found)
                return 'new';
            if (discover)
                attempt.jobId = found.id;
            else
                return 'active';
        }
        const job = this.office.job(attempt.jobId ?? ''), store = this.office.store;
        if (job_js_1.activeJobStatuses.includes(job.status))
            return 'active';
        if (job.status === 'UNKNOWN')
            return 'unknown';
        if (job.status !== 'SUCCEEDED')
            return 'failed';
        const candidate = this.office.candidateState(instance.workId ?? '');
        if (candidate === 'REJECTED')
            return 'rejected';
        if (candidate && verifiedStates.includes(candidate))
            return 'verified';
        if (instance.workId && store.get(instance.workId).data.status === 'DONE')
            return 'done';
        return 'review';
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
                if (workflow_graph_js_1.liveGraphStatuses.includes(run.status))
                    try {
                        this.advance(run.id);
                    }
                    catch (error) {
                        this.office.store.log(collaboration_js_1.owner, 'workflow-graph.checkpoint', run.id, error instanceof Error ? error.message : 'FAILED');
                    }
        });
    }
    /** Verification finishes outside this engine's events, so live runs are also checked periodically. */
    startTimer(intervalMs = 5000) {
        if (this.timer)
            return;
        this.timer = setInterval(() => this.schedule(), intervalMs);
        this.timer.unref();
    }
    advance(id) {
        const run = this.get(id), before = JSON.stringify(run);
        const evaluation = (0, workflow_graph_js_1.evaluateGraph)(run.definition, (key) => this.fact(run, key, true));
        const finish = (status, error) => {
            if (error)
                run.error = error;
            else
                delete run.error;
            run.status = status;
            if (status !== JSON.parse(before).status || JSON.stringify(run) !== before)
                this.save(run);
        };
        if (evaluation.complete)
            return finish('COMPLETED');
        if (evaluation.exhausted.length)
            return finish('FAILED', 'WORKFLOW_LOOP_EXHAUSTED');
        if (evaluation.unknown.length)
            return finish('PAUSED', 'WORKFLOW_STEP_UNKNOWN');
        if (evaluation.failed.length)
            return finish('PAUSED', 'WORKFLOW_STEP_FAILED');
        for (const { key, step } of evaluation.ready) {
            const outcome = this.dispatch(run, key, step);
            if (outcome === 'later')
                break;
            if (outcome !== 'sent')
                return finish('PAUSED', outcome);
        }
        const going = Object.values(run.instances).some((i) => {
            const jobId = i.attempts.at(-1)?.jobId;
            return !!jobId && job_js_1.activeJobStatuses.includes(this.office.job(jobId).status);
        });
        finish(!going && evaluation.waitingReview.length ? 'WAITING' : 'RUNNING');
    }
    /** Reserve, create the work item, start it: each step checkpointed before the next side effect. */
    dispatch(run, key, step) {
        const instance = (run.instances[key] ??= { key, stepId: step.id, attempts: [] });
        try {
            const { employee, room } = this.assignment(step, run.definition.roomId);
            if (!instance.attempts.length) {
                const reservation = Number(employee.data.tokenBudget);
                if (run.reservedTokens + reservation > run.tokenLimit)
                    return 'WORKFLOW_BUDGET';
                run.reservedTokens += reservation;
                instance.attempts.push({
                    attempt: 1,
                    requestKey: (0, hash_js_1.hash)(['workflow-graph', run.id, key, 1]),
                    reservation,
                });
                this.save(run);
            }
            const attempt = instance.attempts.at(-1);
            if (!instance.workId) {
                const iteration = [...key.matchAll(/#(\d+)/g)].map((m) => m[1]).join('.');
                const work = this.office.put('work', null, {
                    title: (iteration && iteration !== '1' ? `${step.title} #${iteration}` : step.title).slice(0, 120),
                    goal: step.goal,
                    status: 'BACKLOG',
                    assigneeId: employee.id,
                    roomId: room.id,
                    dependencies: [],
                    artifactIds: [],
                    ...(step.criteria ? { criteria: step.criteria } : {}),
                }, room.audience, collaboration_js_1.owner, this.office.command(collaboration_js_1.owner, 'workflow-graph-work:' + (0, hash_js_1.hash)([run.id, key]), 0));
                instance.workId = work.id;
                this.save(run);
            }
            const work = this.office.store.get(instance.workId);
            const job = this.office.startWork(work.id, {
                ...this.office.command(collaboration_js_1.owner, attempt.requestKey, work.version),
                correlation_id: run.correlationId,
            });
            attempt.jobId = job.id;
            this.save(run);
            return 'sent';
        }
        catch (error) {
            const code = error instanceof Error ? error.message : 'WORKFLOW_START_FAILED';
            if (retryLater.includes(code))
                return 'later';
            instance.error = code;
            return code;
        }
    }
    close() {
        this.closed = true;
        if (this.timer)
            clearInterval(this.timer);
        this.pauseLive('SERVER_CLOSING');
    }
}
exports.WorkflowGraphs = WorkflowGraphs;
//# sourceMappingURL=workflow-graphs.js.map