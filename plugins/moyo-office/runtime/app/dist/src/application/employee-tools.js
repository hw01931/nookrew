"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.criteriaKeptBy = criteriaKeptBy;
exports.employeeSkills = employeeSkills;
exports.runEmployeeTool = runEmployeeTool;
const skills_js_1 = require("../infrastructure/skills.js");
const record_read_js_1 = require("../domain/record-read.js");
const message_search_js_1 = require("../domain/message-search.js");
const record_search_js_1 = require("../domain/record-search.js");
const record_graph_js_1 = require("../domain/record-graph.js");
const record_lifecycle_js_1 = require("../domain/record-lifecycle.js");
const collaboration_js_1 = require("../domain/collaboration.js");
const acceptance_js_1 = require("../domain/acceptance.js");
const job_js_1 = require("../domain/job.js");
const model_routing_js_1 = require("../domain/model-routing.js");
/** Record names and defaults the tools write, in the project's language (ADR 0062). */
const toolText = {
    ko: { defaultRelation: '참고', meetingSummary: ' · 회의 요약 제안' },
    en: { defaultRelation: 'Reference', meetingSummary: ' · Meeting summary proposal' },
};
const offset = (input) => (input.offset === undefined ? 0 : input.offset);
function project(c, method) {
    const tools = c.host.projectTools;
    if (!tools || typeof tools[method] !== 'function')
        throw Error('PROJECT_TOOL_UNAVAILABLE');
    return tools;
}
/** A work run attaches its saves to the target work unless the model names another. */
const targetWork = (c) => {
    const workId = (0, collaboration_js_1.string)(c.input, 'workId') || (0, job_js_1.jobWorkId)(c.job);
    return workId ? { workId } : {};
};
/**
 * A planner may name a work item's target and effort (ADR 0063) among what exists now, but never a
 * paid model: that stays the owner's direct choice (ADR 0051). A locked assignee's pin (ADR 0072) is
 * checked by the shared put, for the editor and this tool alike, and refused with ROUTE_LOCKED.
 */
function workRoute(c) {
    if (c.input.routeTarget === undefined && c.input.routeEffort === undefined)
        return {};
    const rule = (0, model_routing_js_1.workRule)({
        kind: c.input.kind,
        routeTarget: c.input.routeTarget,
        routeEffort: c.input.routeEffort,
    });
    const targets = c.host.routeTargets?.();
    const model = targets?.models.find((m) => rule.target.kind === 'model' && m.id === rule.target.id);
    const engine = targets?.engines.find((e) => rule.target.kind === 'engine' && e.id === rule.target.id);
    const known = [
        ...(targets?.models ?? []).filter((m) => !m.paid).map((m) => 'model:' + m.id),
        ...(targets?.engines ?? []).filter((e) => e.enabled).map((e) => 'engine:' + e.id),
    ];
    if (model?.paid)
        throw new collaboration_js_1.ToolError('ROUTE_PAID_OWNER_ONLY', `${(0, model_routing_js_1.formatTarget)(rule.target)} bills per call; usable: ${known.join(', ')}`);
    if (!model && !engine?.enabled)
        throw new collaboration_js_1.ToolError('ROUTE_TARGET_UNKNOWN', `usable: ${known.join(', ') || '(none)'}`);
    return { routeTarget: c.input.routeTarget, ...(rule.effort ? { routeEffort: rule.effort } : {}) };
}
/** Work items a work run creates are its sub-items unless the model names another parent. */
const parentWork = (c) => {
    const parentId = (0, collaboration_js_1.string)(c.input, 'parentId') || (0, job_js_1.jobWorkId)(c.job);
    return parentId ? { parentId } : {};
};
/**
 * Criteria are names of tests in the registered acceptance check (ADR 0045). A name that is not in
 * the check could never be met, so it is refused with the names that exist.
 */
function workCriteria(c) {
    if (!('criteria' in c.input))
        return {};
    const criteria = (0, collaboration_js_1.strings)(c.input, 'criteria');
    const names = (0, acceptance_js_1.acceptanceTestNames)(c.host.projectTools?.checks?.().content ?? '');
    const unknown = criteria.filter((name) => !names.includes(name));
    if (unknown.length)
        throw new collaboration_js_1.ToolError('UNKNOWN_CRITERIA', names.length
            ? `등록된 시험 이름: ${names.map((n) => `「${n}」`).join(', ')}`
            : '등록된 검증 기준이 없습니다.');
    return { criteria };
}
/**
 * Several work items written in one reply cannot know each other's ids yet, so a planner would leave
 * every item without predecessors. A dependency may therefore name an earlier work item in this
 * room by its exact title; the newest such item is used. Anything else is passed on unchanged and
 * the usual reference checks drop it.
 */
function workDependencies(c) {
    const works = c.visible().filter((e) => e.kind === 'work');
    return (0, collaboration_js_1.strings)(c.input, 'dependencies').map((ref) => {
        if (works.some((w) => w.id === ref))
            return ref;
        const named = works
            .filter((w) => (0, collaboration_js_1.string)(w.data, 'title') === ref)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .at(-1);
        return named?.id ?? ref;
    });
}
/** The criteria of the work this run executes, if any. */
const targetCriteria = (c) => {
    const workId = (0, job_js_1.jobWorkId)(c.job);
    return workId ? (0, collaboration_js_1.strings)(c.host.store.get(workId).data, 'criteria') : [];
};
/**
 * Criteria of predecessor work the owner already marked DONE, followed through dependencies. They
 * must keep passing; a rerun compared only with its own broken attempt could not tell when it broke
 * a predecessor's test.
 */
function criteriaKeptBy(store, workId) {
    const kept = new Set(), seen = new Set();
    const visit = (id) => {
        if (seen.has(id))
            return;
        seen.add(id);
        const work = store.get(id);
        if (work.kind !== 'work')
            return;
        if ((0, collaboration_js_1.string)(work.data, 'status') === 'DONE')
            (0, collaboration_js_1.strings)(work.data, 'criteria').forEach((n) => kept.add(n));
        (0, collaboration_js_1.strings)(work.data, 'dependencies').forEach(visit);
    };
    (0, collaboration_js_1.strings)(store.get(workId).data, 'dependencies').forEach(visit);
    return [...kept];
}
const keptCriteria = (c) => {
    const workId = (0, job_js_1.jobWorkId)(c.job);
    return workId ? criteriaKeptBy(c.host.store, workId) : [];
};
/** Skills assigned to an employee (ADR 0055): its own list when set, otherwise its role's defaults. */
function employeeSkills(employee, library) {
    return (0, skills_js_1.skillsFor)({
        role: (0, collaboration_js_1.string)(employee.data, 'role'),
        name: (0, collaboration_js_1.string)(employee.data, 'name'),
        ...(Array.isArray(employee.data.skills) ? { skills: (0, collaboration_js_1.strings)(employee.data, 'skills') } : {}),
    }, library.list());
}
const web = (c) => {
    if (!c.host.web)
        throw Error('WEB_UNAVAILABLE');
    return c.host.web;
};
const handlers = {
    'web.search': (c) => web(c).search(c.input),
    'web.fetch': (c) => web(c).fetchPage(c.input),
    'skill.read': (c) => {
        const library = c.host.skills;
        if (!library || c.actor.kind !== 'employee')
            throw Error('SKILL_UNAVAILABLE');
        const skill = employeeSkills(c.host.store.get(c.actor.id), library).find((s) => s.name === (0, collaboration_js_1.string)(c.input, 'name'));
        if (!skill)
            throw Error('SKILL_NOT_ASSIGNED');
        const file = (0, collaboration_js_1.string)(c.input, 'file');
        return file
            ? { name: skill.name, file, content: library.readFile(skill, file) }
            : { name: skill.name, instructions: skill.body, files: skill.files };
    },
    'record.read': (c) => (0, record_read_js_1.readRecord)(c.visible(), (0, collaboration_js_1.string)(c.input, 'id'), offset(c.input), c.input.version),
    'message.search': (c) => (0, message_search_js_1.searchMessages)(c.visible(), c.room.id, (0, collaboration_js_1.string)(c.input, 'query')),
    'record.search': (c) => (0, record_search_js_1.searchRecords)(c.visible(), (0, collaboration_js_1.string)(c.input, 'query'), (0, collaboration_js_1.string)(c.input, 'kind'), offset(c.input)),
    'record.trace': (c) => (0, record_graph_js_1.traceRecord)(c.visible(), (0, collaboration_js_1.string)(c.input, 'id')),
    'work.inspect': (c) => {
        const visible = c.visible();
        const work = visible.find((e) => e.id === (0, collaboration_js_1.string)(c.input, 'id') && e.kind === 'work');
        if (!work)
            throw Error('ACCESS_DENIED');
        return {
            work,
            planning: (0, record_graph_js_1.workPlanning)(visible, (record, employee) => c.host.store.canRead(record, { kind: 'employee', id: employee.id })).find((e) => e.id === work.id),
        };
    },
    'memory.search': (c) => {
        const q = (0, collaboration_js_1.string)(c.input, 'query').toLowerCase();
        return c
            .visible()
            .filter((e) => e.kind === 'memory' && (0, record_lifecycle_js_1.currentRecord)(e) && JSON.stringify(e.data).toLowerCase().includes(q))
            .slice(0, 8)
            .map((e) => ({ ...e, freshness: c.host.memoryStatus(e, c.actor) }));
    },
    'memory.write': (c) => c.write('memory', {
        title: (0, collaboration_js_1.string)(c.input, 'title'),
        type: (0, collaboration_js_1.string)(c.input, 'type'),
        content: (0, collaboration_js_1.string)(c.input, 'content'),
        sourceIds: (0, collaboration_js_1.strings)(c.input, 'sourceIds'),
        snapshot: '',
        relation: (0, collaboration_js_1.string)(c.input, 'relation') || toolText[c.host.language].defaultRelation,
        // An employee's own note is tied to the employee; only the code sets this, never the input.
        ...(c.input.scope === 'self' && c.actor.kind === 'employee' ? { employeeId: c.actor.id } : {}),
    }),
    'decision.write': (c) => c.write('decision', {
        title: (0, collaboration_js_1.string)(c.input, 'title'),
        body: (0, collaboration_js_1.string)(c.input, 'body'),
        sourceIds: (0, collaboration_js_1.strings)(c.input, 'sourceIds'),
        status: 'PROPOSED',
        ...(c.job.mode === 'meeting' ? { meetingId: c.job.targetId } : {}),
        ...((0, collaboration_js_1.string)(c.input, 'workId') ? { workId: c.input.workId } : {}),
    }),
    'meeting.summarize': (c) => {
        if (c.job.mode !== 'meeting' || !c.job.targetId)
            throw Error('MEETING_REQUIRED');
        const meeting = c.host.store.read(c.job.targetId, c.actor);
        // AI proposes a versioned report; the user's meeting record is never overwritten.
        return c.write('artifact', {
            title: (0, collaboration_js_1.string)(meeting.data, 'title') + toolText[c.host.language].meetingSummary,
            type: 'report',
            content: (0, collaboration_js_1.string)(c.input, 'summary'),
            sourceIds: [meeting.id, ...(0, collaboration_js_1.strings)(c.input, 'sourceIds').filter((id) => id !== meeting.id)],
            status: 'DRAFT',
        });
    },
    'artifact.write': (c) => c.write('artifact', {
        title: (0, collaboration_js_1.string)(c.input, 'title'),
        type: (0, collaboration_js_1.string)(c.input, 'type'),
        content: (0, collaboration_js_1.string)(c.input, 'content'),
        sourceIds: (0, collaboration_js_1.strings)(c.input, 'sourceIds'),
        status: 'DRAFT',
        ...targetWork(c),
    }),
    'work.write': (c) => c.write('work', {
        title: (0, collaboration_js_1.string)(c.input, 'title'),
        goal: (0, collaboration_js_1.string)(c.input, 'goal'),
        status: 'BACKLOG',
        ...Object.fromEntries(['priority', 'startDate', 'dueDate', 'kind']
            .filter((key) => key in c.input)
            .map((key) => [key, c.input[key]])),
        dependencies: workDependencies(c),
        artifactIds: [],
        ...workCriteria(c),
        ...((0, collaboration_js_1.string)(c.input, 'assigneeId') ? { assigneeId: c.input.assigneeId } : {}),
        ...workRoute(c),
        ...parentWork(c),
    }),
    'project.list': (c) => c.host.projectTools?.list(c.actor) ?? [],
    'project.read': (c) => {
        const tools = project(c, 'read');
        return tools.readPage
            ? tools.readPage(c.input, c.actor, c.job.id)
            : tools.read((0, collaboration_js_1.string)(c.input, 'path'), c.actor);
    },
    'project.search': (c) => project(c, 'search').search(c.input, c.actor),
    'change.read': (c) => project(c, 'readCandidate').readCandidate(c.input, c.actor, c.room),
    'change.edit': (c) => project(c, 'editDraft').editDraft(c.input, c.actor, c.job.id),
    'change.write': (c) => project(c, 'writeDraft').writeDraft(c.input, c.actor, c.job.id),
    'check.run': (c) => project(c, 'checkDraft').checkDraft(c.actor, c.job.id, c.job.baseCandidateId, targetCriteria(c), keptCriteria(c)),
    'change.propose': (c) => {
        const tools = project(c, 'propose');
        const data = { ...c.input, ...targetWork(c) };
        // Without explicit files the run's draft is submitted (ADR 0040).
        if (!Array.isArray(c.input.files) && !(0, collaboration_js_1.string)(c.input, 'path') && tools.proposeDraft)
            return tools.proposeDraft(data, c.actor, c.room, c.job.id, c.job.baseCandidateId);
        return tools.propose(data, c.actor, c.room, c.job);
    },
};
/**
 * Runs one employee tool call. Tool permission and room access are checked first; every write goes
 * through the host's shared command handler, so GUI and AI tools share one policy path.
 */
async function runEmployeeTool(host, name, input, actor, room, job) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw Error('INVALID_TOOL_INPUT');
    host.store.allowTool(actor, name);
    host.store.read(room.id, actor);
    const handler = handlers[name];
    if (!handler)
        throw Error('UNKNOWN_TOOL');
    let cached;
    const visible = () => (cached ??= host.store.list(actor).filter((e) => room.audience.every((a) => e.audience.includes(a))));
    // Models often invent source/work IDs. Optional references the employee cannot see, or of the
    // wrong kind, are dropped (and reported) instead of failing the save; no unverified link is stored.
    const write = (kind, data) => {
        const known = new Map(host.store.list(actor).map((e) => [e.id, e.kind]));
        const fits = (key, id) => typeof id === 'string' &&
            known.has(id) &&
            (!collaboration_js_1.referenceKinds[key] || known.get(id) === collaboration_js_1.referenceKinds[key]);
        const dropped = [];
        const clean = { ...data };
        for (const [key, rule] of Object.entries(collaboration_js_1.entityContract.fields[kind])) {
            if (key === 'roomId' || clean[key] === undefined)
                continue;
            if (rule === 'ref' && typeof clean[key] === 'string' && clean[key] && !fits(key, clean[key])) {
                dropped.push(String(clean[key]));
                delete clean[key];
            }
            if (rule === 'refs' && Array.isArray(clean[key])) {
                const kept = clean[key].filter((id) => fits(key, id));
                dropped.push(...clean[key].filter((id) => !kept.includes(id)).map(String));
                clean[key] = kept;
            }
        }
        const saved = host.put(kind, null, { ...clean, roomId: room.id }, room.audience, actor, host.command(actor, job.id + ':tool:' + job.toolCalls));
        return dropped.length ? { ...saved, droppedReferences: dropped } : saved;
    };
    return handler({ host, input, actor, room, job, visible, write });
}
//# sourceMappingURL=employee-tools.js.map