"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolError = exports.entityContract = exports.entityOptions = exports.retentionStates = exports.decisionChangeStates = exports.collaborationLimits = exports.referenceKinds = exports.tokenBudgets = exports.owner = exports.collaborationKinds = void 0;
exports.hasTool = hasTool;
exports.loopLimits = loopLimits;
exports.defaultTokenBudget = defaultTokenBudget;
exports.string = string;
exports.strings = strings;
exports.validateEntity = validateEntity;
exports.readable = readable;
exports.assertAcyclic = assertAcyclic;
const spreadsheet_js_1 = require("./spreadsheet.js");
const board_js_1 = require("./board.js");
const automation_js_1 = require("./automation.js");
const model_routing_js_1 = require("./model-routing.js");
exports.collaborationKinds = [
    'team',
    'employee',
    'room',
    'message',
    'work',
    'meeting',
    'decision',
    'artifact',
    'memory',
    'feedback',
];
exports.owner = { kind: 'owner', id: 'local-user' };
/**
 * Draft tools only prepare a code-change candidate, so holding change.propose grants them. This keeps
 * existing employee permissions meaningful without migrating stored tool lists.
 */
const impliedTools = {
    'change.edit': 'change.propose',
    'change.write': 'change.propose',
    'check.run': 'change.propose',
};
/** Reading an assigned skill's instructions needs no grant; the handler limits it to assigned skills. */
const openTools = new Set(['skill.read']);
function hasTool(tools, name) {
    if (openTools.has(name))
        return true;
    return tools.includes(name) || (impliedTools[name] !== undefined && tools.includes(impliedTools[name]));
}
/** Conversational runs stay short; development runs read, edit and check in many small steps. */
const defaultLoop = {
    default: { rounds: 3, toolCalls: 6 },
    develop: { rounds: 16, toolCalls: 40 },
    // Writing UI criteria needs the plan and the page read first; 6 calls ran out before saving.
    checks: { rounds: 6, toolCalls: 12 },
};
function loopLimits(mode, config = {}) {
    const chosen = config[mode] ?? defaultLoop[mode] ?? defaultLoop.default;
    if (!Number.isSafeInteger(chosen.rounds) ||
        !Number.isSafeInteger(chosen.toolCalls) ||
        chosen.rounds < 1 ||
        chosen.rounds > 64 ||
        chosen.toolCalls < 1 ||
        chosen.toolCalls > 200)
        throw Error('INVALID_COLLAB_CONFIG');
    return { rounds: chosen.rounds, toolCalls: chosen.toolCalls };
}
/** Per-run token budgets. Development runs read, edit and check over many rounds. */
exports.tokenBudgets = Object.freeze({ standard: 40000, development: 200000, max: 1000000 });
function defaultTokenBudget(tools) {
    return hasTool(tools, 'change.propose') ? exports.tokenBudgets.development : exports.tokenBudgets.standard;
}
/** Which record kind each reference field must point to. Fields not listed accept any kind. */
exports.referenceKinds = {
    employeeId: 'employee',
    teamId: 'team',
    assigneeId: 'employee',
    parentId: 'work',
    roomId: 'room',
    workId: 'work',
    meetingId: 'meeting',
    artifactId: 'artifact',
    dependencies: 'work',
    artifactIds: 'artifact',
    participants: 'employee',
    members: 'employee',
};
exports.collaborationLimits = {
    text: 12000,
    name: 120,
    items: 100,
    messages: 100,
    output: 12000,
    toolCalls: 6,
    contextChars: 10000,
};
const fields = {
    team: { name: 'name', purpose: 'text', leaderId: 'ref' },
    employee: {
        name: 'name',
        teamId: 'ref',
        role: 'name',
        instructions: 'text',
        tools: 'refs',
        model: 'name',
        enabled: 'boolean',
        tokenBudget: 'integer',
        engine: 'name',
        scope: 'refs',
        /** Skill names (ADR 0055); absent = defaults by role. */
        skills: 'names',
        /** Per-kind targets and effort, "code=engine:claude-code@high;document=model:…" (ADR 0063). */
        routeRules: 'text',
        /** Pin (ADR 0072): the employee's own target with this engine model and effort, nothing else. */
        locked: 'boolean',
        engineModel: 'name',
        effort: 'name',
        maxEffort: 'name',
    },
    room: { name: 'name', type: 'name', teamId: 'ref', workId: 'ref', members: 'refs' },
    message: { roomId: 'ref', body: 'text', links: 'refs', jobId: 'ref', replyTo: 'ref', mentions: 'refs' },
    work: {
        title: 'name',
        goal: 'text',
        status: 'name',
        priority: 'name',
        startDate: 'date',
        dueDate: 'date',
        assigneeId: 'ref',
        /** Passive Codex session assignment. Never grants internal engine permissions. */
        nativeAssigneeId: 'name',
        parentId: 'ref',
        dependencies: 'refs',
        roomId: 'ref',
        artifactIds: 'refs',
        sourceIds: 'refs',
        /** Acceptance test names this work must make pass (ADR 0045). */
        criteria: 'names',
        /** Inbox state of a drafted work (ADR 0058); absent for ordinary work. */
        triage: 'name',
        /** Kind of work (ADR 0063); absent = follows from the run's mode. */
        kind: 'name',
        /** This work item's own target ("model:…" or "engine:…") and effort (ADR 0063). */
        routeTarget: 'name',
        routeEffort: 'name',
        routeMaxEffort: 'name',
    },
    meeting: {
        title: 'name',
        roomId: 'ref',
        participants: 'refs',
        agenda: 'text',
        summary: 'text',
        sourceIds: 'refs',
        status: 'name',
    },
    decision: {
        title: 'name',
        body: 'text',
        meetingId: 'ref',
        roomId: 'ref',
        sourceIds: 'refs',
        workId: 'ref',
        status: 'name',
        /** Lifecycle fields (ADR 0067), written only by the decision change command. */
        supersedes: 'ref',
        supersededBy: 'ref',
        changeReason: 'text',
        affectedIds: 'refs',
        checkedIds: 'refs',
    },
    artifact: {
        title: 'name',
        type: 'name',
        content: 'text',
        workId: 'ref',
        roomId: 'ref',
        sourceIds: 'refs',
        status: 'name',
    },
    memory: {
        title: 'name',
        type: 'name',
        content: 'text',
        sourceIds: 'refs',
        snapshot: 'text',
        relation: 'name',
        roomId: 'ref',
        /** Set for an employee's own working notes (ADR 0053); absent for project-wide memory. */
        employeeId: 'ref',
        /** Retention (ADR 0067): absent = active; written only by the archive/delete commands. */
        retention: 'name',
        retentionReason: 'text',
    },
    feedback: { artifactId: 'ref', artifactVersion: 'integer', body: 'text', verdict: 'name', workId: 'ref' },
};
const required = {
    team: ['name', 'purpose'],
    employee: ['name', 'teamId', 'role', 'instructions', 'tools', 'model', 'enabled', 'tokenBudget', 'scope'],
    room: ['name', 'type', 'members'],
    message: ['roomId', 'body', 'links'],
    work: ['title', 'goal', 'status', 'dependencies', 'artifactIds'],
    meeting: ['title', 'roomId', 'participants', 'agenda', 'summary', 'sourceIds', 'status'],
    decision: ['title', 'body', 'sourceIds', 'status'],
    artifact: ['title', 'type', 'content', 'sourceIds', 'status'],
    memory: ['title', 'type', 'content', 'sourceIds', 'snapshot', 'relation'],
    feedback: ['artifactId', 'artifactVersion', 'body', 'verdict'],
};
/** Decision states reached only through the change command (ADR 0067), never offered by the editor. */
exports.decisionChangeStates = ['CANCELLED', 'SUPERSEDED'];
/** Memory retention states (ADR 0067); a memory without one is active. */
exports.retentionStates = ['ARCHIVED', 'DELETED'];
exports.entityOptions = {
    room: { type: ['project', 'team', 'direct', 'work', 'client'] },
    work: {
        status: ['BACKLOG', 'ACTIVE', 'REVIEW', 'DONE', 'BLOCKED'],
        priority: ['NORMAL', 'LOW', 'HIGH', 'URGENT'],
    },
    meeting: { status: ['OPEN', 'REVIEW', 'CLOSED'] },
    decision: { status: ['PROPOSED', 'ACCEPTED', 'REJECTED'] },
    artifact: {
        type: [
            'plan',
            'slides',
            'flow',
            'diagram',
            'design',
            'code',
            'report',
            'sheet',
            'checks',
            'rules',
            'board',
        ],
        status: ['DRAFT', 'REVIEW', 'ACCEPTED'],
    },
    memory: { type: ['requirement', 'feature', 'decision', 'code', 'test', 'note'] },
    feedback: { verdict: ['COMMENT', 'ACCEPT', 'CHANGES'] },
};
exports.entityContract = {
    fields,
    required,
    options: exports.entityOptions,
    limits: exports.collaborationLimits,
    /** Sheet limits go to the screen so an import is refused before saving (ADR 0066). */
    sheet: spreadsheet_js_1.sheetLimits,
    tokenBudgets: exports.tokenBudgets,
    /** Work kinds and effort levels the routing fields accept (ADR 0063). */
    workKinds: model_routing_js_1.workKinds,
    routeEfforts: model_routing_js_1.routeEfforts,
};
/** A tool failure whose code stays machine-readable while `detail` tells the model where to look. */
class ToolError extends Error {
    detail;
    constructor(code, detail) {
        super(code);
        this.detail = detail;
    }
}
exports.ToolError = ToolError;
function string(data, field) {
    return typeof data[field] === 'string' ? data[field] : '';
}
function strings(data, field) {
    return Array.isArray(data[field]) ? data[field] : [];
}
/** Sheet and board artifacts store JSON documents with their own, larger limits. */
function textLimit(kind, key, data) {
    if (kind === 'artifact' && key === 'content' && data.type === 'sheet')
        return spreadsheet_js_1.sheetLimits.chars;
    if (kind === 'artifact' && key === 'content' && data.type === 'board')
        return board_js_1.boardLimits.chars;
    return exports.collaborationLimits.text;
}
function validateEntity(kind, data) {
    if (!fields[kind] || !data || typeof data !== 'object' || Array.isArray(data))
        throw Error('INVALID_ENTITY');
    for (const key of required[kind])
        if (!(key in data))
            throw Error('MISSING_FIELD');
    for (const [key, value] of Object.entries(data)) {
        const rule = fields[kind][key];
        if (!rule)
            throw Error('UNKNOWN_FIELD');
        if (rule === 'date') {
            if (typeof value !== 'string' ||
                (value !== '' &&
                    (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
                        value.startsWith('0000-') ||
                        !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
                        new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value)))
                throw Error('INVALID_DATE');
        }
        else if (rule === 'boolean') {
            if (typeof value !== 'boolean')
                throw Error('INVALID_FIELD');
        }
        else if (rule === 'integer') {
            const max = key === 'tokenBudget' ? exports.tokenBudgets.max : 100000;
            if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max)
                throw Error('INVALID_FIELD');
        }
        else if (rule === 'refs' || rule === 'names') {
            if (!Array.isArray(value) ||
                value.length > exports.collaborationLimits.items ||
                value.some((v) => typeof v !== 'string' || !v || v.length > 150) ||
                new Set(value).size !== value.length)
                throw Error('INVALID_FIELD');
        }
        else if (typeof value !== 'string' ||
            value.includes('\u0000') ||
            value.length > (rule === 'text' ? textLimit(kind, key, data) : exports.collaborationLimits.name) ||
            (rule === 'name' && !value.trim()))
            throw Error('INVALID_FIELD');
    }
    for (const [key, values] of Object.entries(exports.entityOptions[kind] ?? {}))
        if ((key in data || required[kind].includes(key)) &&
            !values.includes(string(data, key)) &&
            !(kind === 'decision' && key === 'status' && exports.decisionChangeStates.includes(data.status)))
            throw Error('INVALID_FIELD');
    if (kind === 'memory' && data.retention !== undefined && !exports.retentionStates.includes(data.retention))
        throw Error('INVALID_FIELD');
    if (kind === 'work' &&
        string(data, 'startDate') &&
        string(data, 'dueDate') &&
        string(data, 'startDate') > string(data, 'dueDate'))
        throw Error('INVALID_DATE_RANGE');
    // Inbox state is set by the inbox decision, not chosen in the editor, so it is no editor option.
    if (kind === 'work' && data.triage !== undefined && !automation_js_1.triageStates.includes(data.triage))
        throw Error('INVALID_FIELD');
    if (kind === 'work' && data.kind !== undefined && !(0, model_routing_js_1.isWorkKind)(data.kind))
        throw Error('INVALID_FIELD');
    if (kind === 'work')
        (0, model_routing_js_1.workRule)(data);
    if (kind === 'employee' && data.routeRules !== undefined)
        (0, model_routing_js_1.parseEmployeeRoutes)(data.routeRules);
    if (kind === 'employee')
        (0, model_routing_js_1.employeeLock)(data);
    if (kind === 'artifact' && data.type === 'sheet')
        (0, spreadsheet_js_1.validateSpreadsheet)(string(data, 'content'));
    // Static design is an HTML/CSS document, not an application. This conservative quality
    // check is not an HTML sanitizer: the preview's sandbox and CSP remain the security boundary.
    if (kind === 'artifact' &&
        data.type === 'design' &&
        /<\s*(?:script|iframe|object|embed)\b|\bon[a-z]+\s*=|javascript\s*:/i.test(string(data, 'content')))
        throw new ToolError('DESIGN_REQUIRES_STATIC_HTML', 'Remove scripts, inline event handlers and embedded active content. Keep only static HTML/CSS; use type code for executable source.');
    if (kind === 'artifact' && data.type === 'board')
        try {
            (0, board_js_1.validateBoard)(string(data, 'content'));
        }
        catch (error) {
            // The detail tells an employee which item to fix (ADR 0060).
            throw new ToolError('INVALID_BOARD', String(error.detail ?? ''));
        }
    if (kind === 'message' && !string(data, 'body').trim())
        throw Error('EMPTY_MESSAGE');
}
function readable(entity, actor, employee, isLeader = false) {
    if (actor.kind === 'owner')
        return true;
    if (actor.kind === 'employee' &&
        (!employee || employee.kind !== 'employee' || employee.data.enabled !== true))
        return false;
    return (entity.audience.includes(actor.id) ||
        (actor.kind === 'employee' &&
            (entity.audience.includes('staff') ||
                (isLeader && entity.audience.includes('leaders')) ||
                entity.audience.includes('team:' + string(employee.data, 'teamId')))));
}
function assertAcyclic(id, dependencies, works) {
    const graph = new Map(works.map((w) => [w.id, strings(w.data, 'dependencies')]));
    graph.set(id, dependencies);
    const seen = new Set(), active = new Set();
    function visit(node) {
        if (active.has(node))
            throw Error('DEPENDENCY_CYCLE');
        if (seen.has(node))
            return;
        active.add(node);
        for (const next of graph.get(node) ?? [])
            visit(next);
        active.delete(node);
        seen.add(node);
    }
    visit(id);
}
//# sourceMappingURL=collaboration.js.map