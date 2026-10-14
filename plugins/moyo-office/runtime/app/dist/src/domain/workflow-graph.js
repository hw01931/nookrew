"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.finishedGraphStatuses = exports.liveGraphStatuses = exports.stepOutcomes = exports.graphLimits = void 0;
exports.validateGraph = validateGraph;
exports.handledFailures = handledFailures;
exports.evaluateGraph = evaluateGraph;
exports.workSteps = workSteps;
/**
 * Workflow definitions with branches, parallel groups, bounded loops and nested sub-workflows
 * (ADR 0068, TARGET-FLOW-02). This module is pure: it validates the owner's JSON and, given the
 * recorded facts of each step instance, decides what is ready, skipped, stuck or finished. Facts come
 * from stored job, work and verification states, never from model text. The application layer
 * (WorkflowGraphs) performs the side effects.
 */
exports.graphLimits = {
    /** Composite nesting (parallel, loop, sub-workflow) inside one definition. */
    depth: 4,
    /** Worst-case work step instances, counting every loop iteration. */
    instances: 40,
    branches: 4,
    iterations: 5,
    title: 120,
    goal: 4000,
    criteria: 20,
    bytes: 30000,
    attempts: 3,
    tokens: 300000,
};
exports.stepOutcomes = ['verified', 'rejected', 'done', 'failed'];
const fail = (code, detail) => {
    throw Error(detail ? `${code}:${detail}` : code);
};
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => typeof v === 'string' && !!v.trim() && v.length <= max;
const allowed = {
    work: ['id', 'kind', 'when', 'title', 'goal', 'assigneeId', 'roomId', 'criteria'],
    parallel: ['id', 'kind', 'when', 'join', 'branches'],
    loop: ['id', 'kind', 'when', 'maxIterations', 'until', 'body'],
    workflow: ['id', 'kind', 'when', 'title', 'steps'],
};
function conditions(input, at) {
    const list = Array.isArray(input) ? input : [input];
    if (!list.length || list.length > 10)
        fail('WORKFLOW_CONDITION', at);
    return list.map((c) => {
        if (!isObject(c) || typeof c.step !== 'string')
            return fail('WORKFLOW_CONDITION', at);
        const outcomes = Array.isArray(c.outcome) ? c.outcome : [c.outcome];
        if (!outcomes.length || outcomes.some((o) => !exports.stepOutcomes.includes(o)))
            fail('WORKFLOW_CONDITION', at);
        return { step: c.step, outcome: [...new Set(outcomes)] };
    });
}
/** Parses and checks shape, limits and that every condition looks only backwards. */
function validateGraph(input) {
    if (typeof input === 'string') {
        if (input.length > exports.graphLimits.bytes)
            fail('WORKFLOW_TOO_LARGE');
        try {
            input = JSON.parse(input);
        }
        catch {
            fail('WORKFLOW_JSON');
        }
    }
    else if (JSON.stringify(input ?? null).length > exports.graphLimits.bytes)
        fail('WORKFLOW_TOO_LARGE');
    if (!isObject(input) || input.schemaVersion !== 1)
        return fail('WORKFLOW_SCHEMA');
    if (!text(input.title, exports.graphLimits.title))
        fail('WORKFLOW_TITLE');
    if (typeof input.roomId !== 'string' || !input.roomId)
        fail('WORKFLOW_ROOM');
    const ids = new Set();
    const sequence = (list, depth, at) => {
        if (!Array.isArray(list) || !list.length)
            return fail('WORKFLOW_EMPTY', at);
        return list.map((s) => step(s, depth));
    };
    const step = (s, depth) => {
        if (!isObject(s) || typeof s.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(s.id))
            return fail('WORKFLOW_STEP_ID');
        const id = s.id;
        if (ids.has(id))
            fail('WORKFLOW_DUPLICATE_STEP', id);
        ids.add(id);
        const kind = s.kind;
        if (!(kind in allowed))
            fail('WORKFLOW_STEP_KIND', id);
        const extra = Object.keys(s).find((k) => !allowed[kind].includes(k));
        if (extra)
            fail('WORKFLOW_UNKNOWN_FIELD', `${id}.${extra}`);
        const base = { id, ...(s.when !== undefined ? { when: conditions(s.when, id) } : {}) };
        if (kind === 'work') {
            if (!text(s.title, exports.graphLimits.title) || !text(s.goal, exports.graphLimits.goal))
                fail('WORKFLOW_STEP_TEXT', id);
            if (typeof s.assigneeId !== 'string' || !s.assigneeId)
                fail('WORKFLOW_ASSIGNEE', id);
            if (s.roomId !== undefined && (typeof s.roomId !== 'string' || !s.roomId))
                fail('WORKFLOW_ROOM', id);
            if (s.criteria !== undefined &&
                (!Array.isArray(s.criteria) ||
                    s.criteria.length > exports.graphLimits.criteria ||
                    s.criteria.some((c) => !text(c, 200))))
                fail('WORKFLOW_CRITERIA', id);
            return {
                ...base,
                kind,
                title: s.title.trim(),
                goal: s.goal.trim(),
                assigneeId: s.assigneeId,
                ...(s.roomId ? { roomId: s.roomId } : {}),
                ...(s.criteria ? { criteria: s.criteria } : {}),
            };
        }
        if (depth + 1 > exports.graphLimits.depth)
            fail('WORKFLOW_DEPTH', id);
        if (kind === 'parallel') {
            if (s.join !== 'all' && s.join !== 'any')
                fail('WORKFLOW_JOIN', id);
            if (!Array.isArray(s.branches) || s.branches.length < 2 || s.branches.length > exports.graphLimits.branches)
                fail('WORKFLOW_BRANCHES', id);
            return {
                ...base,
                kind,
                join: s.join,
                branches: s.branches.map((b) => sequence(b, depth + 1, id)),
            };
        }
        if (kind === 'loop') {
            // A repeat is the only cycle a definition can express, and it must carry its own hard cap.
            if (s.maxIterations === undefined)
                fail('WORKFLOW_LOOP_UNBOUNDED', id);
            if (!Number.isInteger(s.maxIterations) ||
                s.maxIterations < 1 ||
                s.maxIterations > exports.graphLimits.iterations)
                fail('WORKFLOW_LOOP_LIMIT', id);
            if (s.until === undefined)
                fail('WORKFLOW_LOOP_STOP', id);
            return {
                ...base,
                kind,
                maxIterations: s.maxIterations,
                until: conditions(s.until, id),
                body: sequence(s.body, depth + 1, id),
            };
        }
        if (!text(s.title, exports.graphLimits.title))
            fail('WORKFLOW_STEP_TEXT', id);
        return { ...base, kind, title: s.title.trim(), steps: sequence(s.steps, depth + 1, id) };
    };
    const definition = {
        schemaVersion: 1,
        title: input.title.trim(),
        roomId: input.roomId,
        steps: sequence(input.steps, 0, 'root'),
    };
    checkReferences(definition, ids);
    if (worstCase(definition.steps) > exports.graphLimits.instances)
        fail('WORKFLOW_TOO_LARGE');
    return definition;
}
/** Every step id inside a step, itself included. */
function descendants(step) {
    const inner = step.kind === 'parallel'
        ? step.branches.flat()
        : step.kind === 'loop'
            ? step.body
            : step.kind === 'workflow'
                ? step.steps
                : [];
    return [step.id, ...inner.flatMap(descendants)];
}
/**
 * A condition may only name a step that has settled before the condition is read: an earlier step
 * of the same or an enclosing sequence (or anything inside it). Naming itself, an enclosing step or
 * a later one would be a cycle with no bound; naming a step of a concurrent branch would be a race.
 */
function checkReferences(definition, ids) {
    const check = (list, visible, at) => {
        for (const c of list) {
            if (!ids.has(c.step))
                fail('WORKFLOW_UNKNOWN_STEP', `${at}->${c.step}`);
            if (!visible.has(c.step))
                fail(order.get(c.step) >= order.get(at) ? 'WORKFLOW_CYCLE' : 'WORKFLOW_REFERENCE', `${at}->${c.step}`);
        }
    };
    const order = new Map();
    const number = (list) => list.forEach((s) => {
        order.set(s.id, order.size);
        if (s.kind === 'parallel')
            s.branches.forEach(number);
        if (s.kind === 'loop')
            number(s.body);
        if (s.kind === 'workflow')
            number(s.steps);
    });
    number(definition.steps);
    const walk = (list, outer) => {
        const visible = new Set(outer);
        for (const s of list) {
            if (s.when)
                check(s.when, visible, s.id);
            if (s.kind === 'parallel')
                for (const b of s.branches)
                    walk(b, visible);
            if (s.kind === 'loop') {
                walk(s.body, visible);
                const body = new Set(s.body.flatMap(descendants));
                for (const c of s.until)
                    if (!body.has(c.step))
                        fail(ids.has(c.step) ? 'WORKFLOW_LOOP_STOP' : 'WORKFLOW_UNKNOWN_STEP', s.id);
            }
            if (s.kind === 'workflow')
                walk(s.steps, visible);
            for (const d of descendants(s))
                visible.add(d);
        }
    };
    walk(definition.steps, new Set());
}
function worstCase(list) {
    return list.reduce((sum, s) => sum +
        (s.kind === 'work'
            ? 1
            : s.kind === 'parallel'
                ? s.branches.reduce((n, b) => n + worstCase(b), 0)
                : s.kind === 'loop'
                    ? s.maxIterations * worstCase(s.body)
                    : worstCase(s.steps)), 0);
}
/** Failure outcomes some condition reacts to; any other failure stops the run for the owner. */
function handledFailures(definition) {
    const handled = new Set();
    const visit = (list) => list.forEach((s) => {
        for (const c of [...(s.when ?? []), ...(s.kind === 'loop' ? s.until : [])])
            if (c.outcome.includes('failed'))
                handled.add(c.step);
        if (s.kind === 'parallel')
            s.branches.forEach(visit);
        if (s.kind === 'loop')
            visit(s.body);
        if (s.kind === 'workflow')
            visit(s.steps);
    });
    visit(definition.steps);
    return handled;
}
/**
 * Deterministic walk of the definition over recorded facts. Instance keys are paths: a sub-step is
 * `parent/child`, loop iteration i is `loop#i/child`. Conditions read the latest instance of a step.
 */
function evaluateGraph(definition, fact) {
    const handled = handledFailures(definition);
    const out = {
        ready: [],
        outcomes: {},
        waitingReview: [],
        unknown: [],
        failed: [],
        exhausted: [],
        complete: false,
    };
    const holds = (list, scope) => list.every((c) => {
        const key = scope.get(c.step), o = key ? out.outcomes[key] : undefined;
        return !!o && o !== 'skipped' && c.outcome.includes(o);
    });
    const settle = (s, key, outcome, scope) => {
        scope.set(s.id, key);
        out.outcomes[key] = outcome;
        return true;
    };
    const sequence = (list, prefix, scope, sink) => {
        for (const s of list)
            if (!step(s, prefix + s.id, scope, sink))
                return false;
        return true;
    };
    const step = (s, key, scope, sink) => {
        if (s.when && !holds(s.when, scope))
            return settle(s, key, 'skipped', scope);
        if (s.kind === 'work') {
            const f = fact(key);
            if (f === 'new')
                sink.ready.push({ key, step: s });
            else if (f === 'review')
                sink.waitingReview.push(key);
            else if (f === 'unknown')
                sink.unknown.push(key);
            else if (f !== 'active') {
                settle(s, key, f, scope);
                if (f !== 'failed' || handled.has(s.id))
                    return true;
                sink.failed.push(key);
            }
            return false;
        }
        if (s.kind === 'parallel') {
            const branches = s.branches.map((b, i) => {
                const local = {
                    ...out,
                    ready: [],
                    waitingReview: [],
                    unknown: [],
                    failed: [],
                    exhausted: [],
                };
                return { settled: sequence(b, `${key}/${i}/`, scope, local), local };
            });
            const joined = s.join === 'all' ? branches.every((b) => b.settled) : branches.some((b) => b.settled);
            // Once an "any" join is met, the other branches dispatch nothing more and their late
            // results stay recorded on their own instances only.
            for (const b of s.join === 'any' && joined ? branches.filter((b) => b.settled) : branches)
                for (const k of ['ready', 'waitingReview', 'unknown', 'failed', 'exhausted'])
                    sink[k].push(...b.local[k]);
            return joined ? settle(s, key, 'done', scope) : false;
        }
        if (s.kind === 'loop') {
            for (let i = 1; i <= s.maxIterations; i++) {
                if (!sequence(s.body, `${key}#${i}/`, scope, sink))
                    return false;
                if (holds(s.until, scope))
                    return settle(s, key, 'done', scope);
            }
            settle(s, key, 'failed', scope);
            if (handled.has(s.id))
                return true;
            sink.exhausted.push(key);
            return false;
        }
        return sequence(s.steps, key + '/', scope, sink) && settle(s, key, 'done', scope);
    };
    out.complete = sequence(definition.steps, '', new Map(), out);
    return out;
}
/** Runs the engine still advances; a restart or shutdown pauses them. */
exports.liveGraphStatuses = ['RUNNING', 'WAITING'];
exports.finishedGraphStatuses = ['COMPLETED', 'FAILED', 'CANCELED'];
/** Every work step of a definition, for reservation and assignment checks. */
function workSteps(list) {
    return list.flatMap((s) => s.kind === 'work'
        ? [s]
        : s.kind === 'parallel'
            ? s.branches.flatMap(workSteps)
            : workSteps(s.kind === 'loop' ? s.body : s.steps));
}
//# sourceMappingURL=workflow-graph.js.map