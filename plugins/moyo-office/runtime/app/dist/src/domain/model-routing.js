"use strict";
/**
 * Work-type routing (ADR 0063); an employee's lock (ADR 0072) precedes all of it. A run's target (a model profile or an external engine) and effort are
 * chosen once per run by code: a work item's own choice, then — for a rerun of the same work item —
 * the target the previous run used (prompt caches are per model), then the employee's per-kind choice,
 * the project's per-kind rule, and the employee's default. A rule whose target is gone never falls
 * back to a paid model by itself.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.engineModelPattern = exports.formatTarget = exports.routeEfforts = exports.engineWorkKinds = exports.workKinds = void 0;
exports.engineMayRun = engineMayRun;
exports.workKindOf = workKindOf;
exports.isWorkKind = isWorkKind;
exports.isEffort = isEffort;
exports.parseTarget = parseTarget;
exports.validRoutes = validRoutes;
exports.parseEmployeeRoutes = parseEmployeeRoutes;
exports.formatEmployeeRoutes = formatEmployeeRoutes;
exports.workRule = workRule;
exports.employeeLock = employeeLock;
exports.formatLock = formatLock;
exports.assertLockAllows = assertLockAllows;
exports.routeRun = routeRun;
/** Kinds of work a rule can name. A work item may carry one; otherwise it follows from the run's mode. */
exports.workKinds = [
    'code',
    'simple-fix',
    'review',
    'research',
    'plan',
    'design',
    'document',
    'meeting',
    'chat',
];
/**
 * Kinds an external engine may take (ADR 0041, 0071): code changes through a candidate, and planning,
 * where the engine splits work through the app's own tools (MCP) and changes no files.
 */
exports.engineWorkKinds = ['code', 'simple-fix', 'plan'];
/**
 * Whether a run may go to an engine at all: a development run (its changes become a candidate) or a
 * planning run (ADR 0071). Other runs stay on a model whatever a rule names.
 */
function engineMayRun(kind, mode) {
    return mode === 'develop' || kind === 'plan';
}
/** Same levels as the per-model effort option of ADR 0051. */
exports.routeEfforts = ['minimal', 'low', 'medium', 'high'];
const modeKinds = {
    develop: 'code',
    // Acceptance checks are test code.
    checks: 'code',
    plan: 'plan',
    design: 'design',
    slides: 'document',
    flow: 'document',
    diagram: 'document',
    meeting: 'meeting',
};
/** The kind a run has when its work item names none. Chat by an employee with web tools is research. */
function workKindOf(mode, tools) {
    if (mode === 'chat')
        return tools.includes('web.search') || tools.includes('web.fetch') ? 'research' : 'chat';
    const kind = modeKinds[mode];
    if (!kind)
        throw Error('INVALID_JOB');
    return kind;
}
function isWorkKind(v) {
    return exports.workKinds.includes(v);
}
function isEffort(v) {
    return exports.routeEfforts.includes(v);
}
const level = (e) => exports.routeEfforts.indexOf(e);
const idPattern = /^[\w.:/+-]{1,160}$/;
/** "model:openai:gpt-6" or "engine:claude-code"; the first colon separates the kind. */
function parseTarget(text) {
    if (typeof text !== 'string')
        throw Error('INVALID_ROUTE');
    const at = text.indexOf(':');
    const kind = text.slice(0, at), id = text.slice(at + 1);
    if (at < 0 || (kind !== 'model' && kind !== 'engine') || !idPattern.test(id))
        throw Error('INVALID_ROUTE');
    return { kind, id };
}
const formatTarget = (t) => `${t.kind}:${t.id}`;
exports.formatTarget = formatTarget;
function shapeRule(kind, input) {
    const v = input;
    if (!v || typeof v !== 'object' || Array.isArray(v))
        throw Error('INVALID_ROUTE');
    const keys = Object.keys(v);
    if (keys.some((k) => k !== 'target' && k !== 'effort' && k !== 'maxEffort'))
        throw Error('INVALID_ROUTE');
    const t = v.target;
    if (!t || typeof t !== 'object' || Object.keys(t).length !== 2)
        throw Error('INVALID_ROUTE');
    const target = parseTarget(`${t.kind}:${t.id}`);
    if (v.effort !== undefined && !isEffort(v.effort))
        throw Error('INVALID_ROUTE');
    // A ceiling needs a starting level at or below it.
    if (v.maxEffort !== undefined &&
        (!isEffort(v.maxEffort) || !isEffort(v.effort) || level(v.maxEffort) < level(v.effort)))
        throw Error('INVALID_ROUTE');
    if (target.kind === 'engine' && kind && !exports.engineWorkKinds.includes(kind))
        throw Error('ROUTE_ENGINE_NOT_ALLOWED');
    return {
        target,
        ...(v.effort ? { effort: v.effort } : {}),
        ...(v.maxEffort ? { maxEffort: v.maxEffort } : {}),
    };
}
/** The project rules an owner may save: known kinds, tagged targets that exist, engines only for code. */
function validRoutes(input, targets) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw Error('INVALID_ROUTE');
    const out = {};
    for (const [kind, rule] of Object.entries(input)) {
        if (!isWorkKind(kind))
            throw Error('INVALID_ROUTE');
        const clean = shapeRule(kind, rule);
        const known = clean.target.kind === 'model'
            ? targets.models.some((m) => m.id === clean.target.id)
            : targets.engines.some((e) => e.id === clean.target.id);
        if (!known)
            throw Error('ROUTE_TARGET_UNKNOWN');
        out[kind] = clean;
    }
    return out;
}
/**
 * An employee's per-kind choices, stored on the employee as one line so the record stays flat:
 * "code=engine:claude-code@high;document=model:google:gemini-flash". Shape only: whether a target
 * still exists is judged when a run starts.
 */
function parseEmployeeRoutes(text) {
    if (typeof text !== 'string' || text.length > 2000)
        throw Error('INVALID_ROUTE');
    const out = {};
    for (const part of text.split(';').filter((p) => p.trim())) {
        const [kind, value = ''] = part.split('=');
        const [target, efforts, extra] = value.split('@');
        const [effort, maxEffort, more] = efforts === undefined ? [] : efforts.split('..');
        if (!isWorkKind(kind) || out[kind] || extra !== undefined || more !== undefined)
            throw Error('INVALID_ROUTE');
        out[kind] = shapeRule(kind, {
            target: parseTarget(target),
            ...(effort !== undefined ? { effort } : {}),
            ...(maxEffort !== undefined ? { maxEffort } : {}),
        });
    }
    return out;
}
function formatEmployeeRoutes(rules) {
    return Object.entries(rules)
        .map(([k, r]) => `${k}=${(0, exports.formatTarget)(r.target)}${r.effort ? '@' + r.effort : ''}${r.maxEffort ? '..' + r.maxEffort : ''}`)
        .join(';');
}
/** A work item's own target ("routeTarget") and effort ("routeEffort"), checked for shape. */
function workRule(data) {
    if (data.routeTarget === undefined) {
        if (data.routeEffort !== undefined || data.routeMaxEffort !== undefined)
            throw Error('INVALID_ROUTE');
        return undefined;
    }
    return shapeRule(isWorkKind(data.kind) ? data.kind : undefined, {
        target: parseTarget(data.routeTarget),
        ...(data.routeEffort !== undefined ? { effort: data.routeEffort } : {}),
        ...(data.routeMaxEffort !== undefined ? { maxEffort: data.routeMaxEffort } : {}),
    });
}
/**
 * An engine model name: letters, digits and . _ : - only, so it can never carry a flag, a space or a
 * shell character. Each engine's flag table checks it again against its own name shape.
 */
exports.engineModelPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
/** Effort levels an engine flag takes; "minimal" exists for models only (ADR 0051). */
const engineEffortLevels = ['low', 'medium', 'high'];
/**
 * The lock fields of an employee record, checked for shape whether or not the lock is on (the editor
 * keeps them while it is off). Returns the lock when `locked` is true. Owner of the lock rules.
 */
function employeeLock(data) {
    if (data.locked !== undefined && typeof data.locked !== 'boolean')
        throw Error('INVALID_ROUTE');
    const engine = typeof data.engine === 'string' ? data.engine : '';
    if (data.engineModel !== undefined) {
        if (typeof data.engineModel !== 'string' || !exports.engineModelPattern.test(data.engineModel))
            throw Error('INVALID_ROUTE');
        // A model name for the engine means nothing without an engine.
        if (!engine)
            throw Error('INVALID_ROUTE');
    }
    if (data.effort !== undefined && !isEffort(data.effort))
        throw Error('INVALID_ROUTE');
    if (data.maxEffort !== undefined &&
        (!isEffort(data.maxEffort) || !isEffort(data.effort) || level(data.maxEffort) < level(data.effort)))
        throw Error('INVALID_ROUTE');
    if (data.locked !== true)
        return undefined;
    const target = parseTarget(engine ? `engine:${engine}` : `model:${typeof data.model === 'string' ? data.model : ''}`);
    if (target.kind === 'engine' &&
        [data.effort, data.maxEffort].some((e) => e !== undefined && !engineEffortLevels.includes(e)))
        throw Error('INVALID_ROUTE');
    // Per-kind rules would contradict the pin; the owner clears them rather than one silently winning.
    if (typeof data.routeRules === 'string' && data.routeRules.trim())
        throw Error('ROUTE_LOCK_RULES');
    return {
        target,
        ...(data.engineModel ? { engineModel: data.engineModel } : {}),
        ...(data.effort ? { effort: data.effort } : {}),
        ...(data.maxEffort ? { maxEffort: data.maxEffort } : {}),
    };
}
/** One line for people and planners: "engine:codex-exec gpt-6.1-sol @medium..high". */
function formatLock(lock) {
    return [
        (0, exports.formatTarget)(lock.target),
        lock.engineModel ?? '',
        lock.effort ? '@' + lock.effort + (lock.maxEffort ? '..' + lock.maxEffort : '') : '',
    ]
        .filter(Boolean)
        .join(' ');
}
/**
 * A work item's own choice for a locked assignee: allowed only when it names the pinned target and,
 * if it names effort, the pinned effort. Anything else is ROUTE_LOCKED, so whoever chose it (the
 * owner in the editor or a planning employee through work.write) sees it and picks someone else.
 */
function assertLockAllows(lock, rule) {
    if (!lock || !rule)
        return;
    if (!sameTarget(rule.target, lock.target) ||
        (rule.effort !== undefined && rule.effort !== lock.effort) ||
        (rule.maxEffort !== undefined && rule.maxEffort !== lock.maxEffort))
        throw Error('ROUTE_LOCKED');
}
const usable = (t, targets) => t.kind === 'model'
    ? targets.models.some((m) => m.id === t.id)
    : targets.engines.some((e) => e.id === t.id && e.enabled);
/**
 * The target and effort of one run, fixed for the whole run (a run is one attempt of one work item).
 * `engineAllowed` is true for a run an engine can take over (`engineMayRun`: development or planning);
 * an engine rule is skipped for any other run. `previous` is the newest earlier attempt of the same work item: a
 * rerun keeps its target (prompt caches are per model) unless the work item itself names one, and
 * when that attempt failed verification the effort goes one level up, up to the applicable rule's
 * ceiling.
 */
function routeRun(input) {
    const { kind, engineAllowed, employee, rules, previous, targets } = input;
    const fallback = employee.engine
        ? { kind: 'engine', id: employee.engine }
        : { kind: 'model', id: employee.model };
    if (fallback.kind === 'model' && !targets.models.some((m) => m.id === fallback.id))
        throw Error('MODEL_UNAVAILABLE');
    if (employee.lock)
        return lockedRun(kind, engineAllowed, employee.model, employee.lock, rules.work, previous, targets);
    const applies = (r) => !!r && (r.target.kind === 'model' || engineAllowed);
    const ordered = [
        ['WORK_RULE', rules.work],
        ['EMPLOYEE_RULE', rules.employee?.[kind]],
        ['KIND_RULE', rules.project[kind]],
    ];
    const first = ordered.find(([, r]) => applies(r));
    const decide = ([reason, rule]) => {
        if (usable(rule.target, targets))
            return { kind, target: rule.target, ...(rule.effort ? { effort: rule.effort } : {}), reason };
        const paid = fallback.kind === 'model' && targets.models.find((m) => m.id === fallback.id).paid;
        if (paid)
            throw Error('ROUTE_TARGET_UNAVAILABLE');
        return { kind, target: fallback, reason: 'RULE_UNAVAILABLE', rule };
    };
    let decision;
    if (first && first[0] === 'WORK_RULE')
        decision = decide(first);
    else if (previous &&
        (previous.target.kind === 'model' || engineAllowed) &&
        usable(previous.target, targets))
        decision = {
            kind,
            target: previous.target,
            ...(previous.effort ? { effort: previous.effort } : {}),
            reason: 'CONTINUATION',
        };
    else
        decision = first ? decide(first) : { kind, target: fallback, reason: 'EMPLOYEE_DEFAULT' };
    // One level up after a failed verification of the same work item, never past the rule's ceiling.
    const ceiling = first?.[1].maxEffort;
    const from = previous?.effort ?? decision.effort;
    if (previous?.failed &&
        ceiling &&
        from &&
        decision.reason !== 'RULE_UNAVAILABLE' &&
        sameTarget(previous.target, decision.target) &&
        level(from) < level(ceiling)) {
        const to = exports.routeEfforts[level(from) + 1];
        decision.effort = to;
        decision.escalated = { from, to, afterAttempt: previous.attempt ?? 1 };
    }
    return decision;
}
function sameTarget(a, b) {
    return a.kind === b.kind && a.id === b.id;
}
/**
 * A locked employee's run (ADR 0072), ahead of every other source of ADR 0063. A run an engine may not
 * take (a chat, a meeting) uses the employee's own model, since that is the only other target the
 * owner chose for this employee. An unusable pinned target refuses the run instead of falling back.
 */
function lockedRun(kind, engineAllowed, model, lock, work, previous, targets) {
    assertLockAllows(lock, work);
    const onEngine = lock.target.kind === 'engine' && engineAllowed;
    const target = lock.target.kind === 'model' || onEngine ? lock.target : { kind: 'model', id: model };
    if (!usable(target, targets))
        throw Error('ROUTE_TARGET_UNAVAILABLE');
    const decision = {
        kind,
        target,
        ...(lock.effort ? { effort: lock.effort } : {}),
        ...(onEngine && lock.engineModel ? { engineModel: lock.engineModel } : {}),
        reason: 'EMPLOYEE_LOCK',
    };
    // Climbing only up to the lock's own ceiling; without one a locked effort never changes. A rerun
    // keeps a level already climbed to within the lock's range.
    const climbed = lock.maxEffort &&
        previous?.effort &&
        sameTarget(previous.target, target) &&
        level(previous.effort) >= level(lock.effort) &&
        level(previous.effort) <= level(lock.maxEffort)
        ? previous.effort
        : undefined;
    if (climbed)
        decision.effort = climbed;
    const from = decision.effort;
    if (previous?.failed && lock.maxEffort && from && climbed && level(from) < level(lock.maxEffort)) {
        const to = exports.routeEfforts[level(from) + 1];
        decision.effort = to;
        decision.escalated = { from, to, afterAttempt: previous.attempt ?? 1 };
    }
    return decision;
}
//# sourceMappingURL=model-routing.js.map