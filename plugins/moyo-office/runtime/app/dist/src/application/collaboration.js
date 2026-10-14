"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Collaboration = void 0;
exports.employeeNotes = employeeNotes;
const employee_handover_js_1 = require("./employee-handover.js");
const routines_js_1 = require("./routines.js");
const workflows_js_1 = require("./workflows.js");
const model_routes_js_1 = require("./model-routes.js");
const run_usage_js_1 = require("../domain/run-usage.js");
const record_lifecycle_js_1 = require("./record-lifecycle.js");
const record_lifecycle_js_2 = require("../domain/record-lifecycle.js");
const workflow_graphs_js_1 = require("./workflow-graphs.js");
const attention_js_1 = require("../domain/attention.js");
const work_execution_js_1 = require("../domain/work-execution.js");
const work_context_js_1 = require("./work-context.js");
const model_reply_js_1 = require("./model-reply.js");
const acceptance_js_1 = require("../domain/acceptance.js");
const collaboration_tools_js_1 = require("./collaboration-tools.js");
const employee_tools_js_1 = require("./employee-tools.js");
const employee_prompt_js_1 = require("./employee-prompt.js");
const collaboration_view_js_1 = require("./collaboration-view.js");
const node_crypto_1 = require("node:crypto");
const collaboration_js_1 = require("../domain/collaboration.js");
const hash_js_1 = require("../infrastructure/hash.js");
const command_js_1 = require("../domain/command.js");
const job_js_1 = require("../domain/job.js");
const command_js_2 = require("./command.js");
const report_js_1 = require("../domain/report.js");
const language_js_1 = require("../domain/language.js");
const engine_registry_js_1 = require("../domain/engine-registry.js");
const engine_mcp_js_1 = require("./engine-mcp.js");
const workspace_engine_js_1 = require("../adapters/workspace-engine.js");
/** The run is stale or its employee changed: it stops at once and must not change state. */
const fencedErrors = ['JOB_FENCED', 'EMPLOYEE_CHANGED'];
/** What the app itself posts in rooms and names records after a run, in the project's language (ADR 0062). */
const runText = {
    ko: {
        engineChanged: (engine, applied, skipped, exit) => `${engine}로 수정안을 만들었습니다. 바뀐 파일 ${applied}개${skipped ? `, 반영하지 않은 파일 ${skipped}개` : ''}.${exit} 검증을 실행해 확인하세요.`,
        engineUnchanged: (engine, timedOut, exit) => `${engine} 실행이 끝났지만 바뀐 파일이 없습니다.${timedOut ? ' 제한 시간을 넘겼습니다.' : ''}${exit}`,
        enginePlanned: (engine, created, timedOut, exit) => `${engine}로 기획해 기록 ${created}개를 만들었습니다.${timedOut ? ' 제한 시간을 넘겼습니다.' : ''}${exit} 하위 업무의 종류와 담당을 확인하세요.`,
        enginePlanBrief: '\n\n[외부 엔진 실행] 이 실행에서는 위의 JSON 응답 형식을 쓰지 않습니다. 앱의 도구는 MCP 서버 aiorchestra의 도구(work_write, record_search, record_read, memory_search, artifact_write)로 직접 호출하세요. 일을 하위 업무로 나눌 때 work_write마다 kind(code, simple-fix, review, research, plan, design, document)를 정하세요. 앱이 종류별 규칙으로 각 업무를 알맞은 모델이나 엔진에 보냅니다. 파일을 바꿔도 반영되지 않습니다.',
        exitCode: (code) => ` 종료 코드 ${code}.`,
        reportDocument: ' · 상세 작업 보고',
        attached: '작업 결과를 첨부했습니다. 내용을 검토해 주세요.',
        ended: '응답이 종료되었습니다. 실행 상세에서 결과를 확인해 주세요.',
    },
    en: {
        engineChanged: (engine, applied, skipped, exit) => `${engine} made a change: ${applied} files changed${skipped ? `, ${skipped} files not applied` : ''}.${exit} Run verification to check it.`,
        engineUnchanged: (engine, timedOut, exit) => `${engine} finished without changing any files.${timedOut ? ' It ran out of time.' : ''}${exit}`,
        enginePlanned: (engine, created, timedOut, exit) => `${engine} planned the work and created ${created} records.${timedOut ? ' It ran out of time.' : ''}${exit} Check the kind and assignee of each sub-item.`,
        enginePlanBrief: '\n\n[External engine run] Do not use the JSON reply format above in this run. Call the app tools directly through the MCP server aiorchestra (work_write, record_search, record_read, memory_search, artifact_write). When you split the work into sub-items, give each work_write a kind (code, simple-fix, review, research, plan, design, document); the app sends each item to the model or engine its rule names for that kind. File changes are not applied.',
        exitCode: (code) => ` Exit code ${code}.`,
        reportDocument: ' · Detailed work report',
        attached: 'I attached the results of the work. Please review them.',
        ended: 'The response ended. Check the results in the run details.',
    },
};
class Collaboration {
    store;
    model;
    config;
    projectTools;
    brief;
    workflows;
    /** Workflow definitions with branches, parallel groups, loops and nesting (ADR 0068). */
    graphs;
    routines;
    /** Skill library shared by every project of the app (ADR 0055); set by the server. */
    skills;
    /** Free web search (ADR 0056); set by the server, shared by every project of the app. */
    web;
    /**
     * This project's engine consents and develop route (ADR 0065); set by the server. Without it no
     * engine can be consented to, so none runs.
     */
    engineSettings;
    /** Brings config.engines up to date with the owner's engine registry; set by the server. */
    refreshEngines;
    handover;
    /** Work-type routing rules of this project (ADR 0063). */
    routes;
    /** Paid API cost alerts for the inbox (ADR 0063); set by the server when API models are configured. */
    costAlerts;
    /** Decision changes and memory retention (ADR 0067). */
    lifecycle;
    /** Bearer tokens of engine runs that reach the employee tools over MCP (ADR 0071). */
    engineTools;
    /** The loopback URL of this project's MCP endpoint while its server listens; set by the server. */
    mcpUrl;
    running = new Map();
    queue = Promise.resolve();
    closed = false;
    constructor(store, model, config, projectTools, 
    /** The user's own project name and goal; every employee run sees it (it is not model output). */
    brief) {
        this.store = store;
        this.model = model;
        this.config = config;
        this.projectTools = projectTools;
        this.brief = brief;
        for (const job of this.jobs())
            if (job_js_1.activeJobStatuses.includes(job.status)) {
                job.status = 'UNKNOWN';
                job.error = 'SERVER_RESTARTED';
                this.saveJob(job);
            }
        this.workflows = new workflows_js_1.Workflows(this);
        this.graphs = new workflow_graphs_js_1.WorkflowGraphs(this);
        this.routines = new routines_js_1.Routines(this);
        this.handover = new employee_handover_js_1.EmployeeHandover(this);
        this.routes = new model_routes_js_1.ModelRouteSettings(store, config);
        this.lifecycle = new record_lifecycle_js_1.RecordLifecycle(store, () => this.language, config.memory);
        this.engineTools = new engine_mcp_js_1.EngineToolGrants(store.project);
    }
    command(actor, key = (0, node_crypto_1.randomUUID)(), version = 0) {
        return (0, command_js_2.createCommand)(actor.id, this.store.project, key, version);
    }
    put(kind, id, data, audience, actor = collaboration_js_1.owner, command = this.command(actor, undefined, id ? this.store.get(id).version : 0)) {
        // An employee's new self note and the note policy it may trigger are one write (ADR 0067).
        const result = this.store.transaction(() => {
            const saved = this.store.put(kind, id, data, audience, actor, command);
            if (kind === 'memory' && !id && actor.kind === 'employee' && saved.data.employeeId === actor.id)
                this.lifecycle.applyNotePolicy(actor.id);
            return saved;
        });
        if (kind === 'employee' || kind === 'team')
            this.ensureTeamRooms();
        this.scheduleWorkflows();
        return result;
    }
    /** Both workflow engines re-read recorded states after any change that may unblock them. */
    scheduleWorkflows() {
        this.workflows?.schedule();
        this.graphs?.schedule();
    }
    /** Verification state of the newest change candidate made for a work item, if any. */
    candidateState(workId) {
        return workId ? this.projectTools?.newestCandidateSummary?.(workId)?.state : undefined;
    }
    ensureTeamRooms() {
        const entities = this.store.all();
        for (const team of entities.filter((e) => e.kind === 'team')) {
            const employees = entities.filter((e) => e.kind === 'employee' && e.data.teamId === team.id && e.data.enabled === true);
            if (employees.length >= 2 &&
                !entities.some((e) => e.kind === 'room' &&
                    e.data.type === 'team' &&
                    e.data.teamId === team.id &&
                    e.audience.length === 1 &&
                    e.audience[0] === 'team:' + team.id))
                this.put('room', null, {
                    name: (0, collaboration_js_1.string)(team.data, 'name') + language_js_1.seedText[this.language].teamRoom,
                    type: 'team',
                    teamId: team.id,
                    members: [],
                }, ['team:' + team.id]);
        }
    }
    /** The project's language (ADR 0062): rooms it seeds, records it writes, how employees reply. */
    get language() {
        return (0, language_js_1.language)(this.brief?.language);
    }
    bootstrap() {
        if (!this.store.all().some((e) => e.kind === 'team'))
            for (const template of this.config.teams) {
                const team = this.store.all().find((e) => e.kind === 'team' && e.data.name === template.name) ??
                    this.put('team', null, { name: template.name, purpose: template.purpose }, ['staff']);
                const employee = this.put('employee', null, {
                    name: template.role,
                    teamId: team.id,
                    role: template.role,
                    instructions: template.instructions,
                    tools: template.tools,
                    model: template.modelId ?? this.config.runtime.modelId,
                    enabled: true,
                    tokenBudget: (0, collaboration_js_1.defaultTokenBudget)(template.tools),
                    scope: ['src/**', 'web/**', 'docs/**', 'tests/**', 'package.json'],
                }, ['staff']);
                if (!team.data.leaderId)
                    this.put('team', team.id, { ...team.data, leaderId: employee.id }, team.audience);
            }
        for (const team of this.store.all().filter((e) => e.kind === 'team' && !('leaderId' in e.data))) {
            const members = this.store
                .all()
                .filter((e) => e.kind === 'employee' && e.data.teamId === team.id && e.data.enabled === true);
            this.put('team', team.id, { ...team.data, leaderId: members.length === 1 ? members[0].id : '' }, team.audience);
        }
        const room = this.store
            .all()
            .find((e) => e.kind === 'room' &&
            e.data.type === 'project' &&
            e.audience.length === 1 &&
            e.audience[0] === 'leaders');
        if (!room)
            this.put('room', null, { name: language_js_1.seedText[this.language].allRoom, type: 'project', members: [] }, [
                'leaders',
            ]);
        this.ensureTeamRooms();
    }
    memoryStatus(entity, actor = collaboration_js_1.owner) {
        try {
            const refs = JSON.parse((0, collaboration_js_1.string)(entity.data, 'snapshot'));
            if (!Array.isArray(refs) || !refs.length)
                return 'UNLINKED';
            return refs.every((ref) => this.store.read(ref.id, actor).version === ref.version)
                ? 'CURRENT'
                : 'STALE';
        }
        catch {
            return 'INCONCLUSIVE';
        }
    }
    teamStats(actor = collaboration_js_1.owner) {
        return (0, collaboration_view_js_1.teamStatistics)(this.store.list(actor));
    }
    state(actor = collaboration_js_1.owner) {
        const visible = this.store.list(actor), recent = actor.kind === 'client' ? [] : this.jobs();
        return {
            workflows: actor.kind === 'owner' ? this.workflows.view() : [],
            workflowGraphs: actor.kind === 'owner' ? this.graphs.view() : [],
            routines: actor.kind === 'owner' ? this.routines.view() : [],
            rolePresets: actor.kind === 'owner' ? (this.config.rolePresets ?? []) : [],
            staffingPresets: actor.kind === 'owner' ? (this.config.staffingPresets ?? []) : [],
            attention: actor.kind === 'owner' ? this.attention(visible, recent) : [],
            memoryPolicy: actor.kind === 'owner' ? this.lifecycle.policy : null,
            readState: this.store.readState(actor),
            ...(0, collaboration_view_js_1.collaborationView)(visible, recent, {
                canRead: (entity, employee) => this.store.canRead(entity, { kind: 'employee', id: employee.id }),
                memoryStatus: (entity) => this.memoryStatus(entity, actor),
            }),
            runtime: actor.kind === 'client' ? 'NOT_EXPOSED' : this.model.status(),
            models: actor.kind === 'client'
                ? []
                : (this.config.models ?? [this.config.runtime]).map((c) => ({
                    id: c.modelId,
                    label: c.label ?? c.modelId,
                    remote: c.provider === 'openrouter',
                    paid: c.provider === 'api',
                    contextTokens: c.contextTokens,
                })),
            tools: actor.kind === 'client' ? {} : collaboration_tools_js_1.toolDescriptions,
            engines: actor.kind === 'owner' ? this.listEngines() : [],
            clients: actor.kind === 'owner' ? this.store.clients() : [],
        };
    }
    attention(visible = this.store.list(collaboration_js_1.owner), jobs = this.jobs()) {
        const seen = this.store.seenVersions(collaboration_js_1.owner.id);
        const queue = (0, attention_js_1.attentionQueue)(visible, jobs, seen);
        let alerts = [];
        try {
            alerts = this.costAlerts?.() ?? [];
        }
        catch {
            // An unreadable API settings file shows on the model page; the inbox still opens.
        }
        // Cost alerts carry codes and values only; the screen words them in its language.
        const costs = alerts.map((a) => ({
            id: a.id,
            sourceId: a.id,
            sourceKind: 'api',
            version: a.version,
            category: 'cost',
            reason: a.reason,
            title: '',
            detail: '',
            updatedAt: a.at,
            priority: a.reason === 'SPEND_100' ? 0 : 1,
            seen: seen.get(a.id) === a.version,
            params: a.params,
        }));
        return [...costs, ...queue];
    }
    markAttention(id, command) {
        this.assertOwnerCommand(command);
        const key = (0, hash_js_1.hash)(['attention-seen', this.store.project, command.actor, command.idempotency_key]), fingerprint = (0, hash_js_1.hash)([id, command.expected_version]);
        return this.store.idempotent(key, fingerprint, () => {
            const item = this.attention().find((row) => row.id === id);
            if (!item)
                throw Error('ATTENTION_NOT_FOUND');
            if (item.version !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            this.store.markSeen(collaboration_js_1.owner.id, id, item.version);
            const result = { id, version: item.version, seen: true };
            this.store.log(collaboration_js_1.owner, 'attention.seen', id, 'SUCCEEDED');
            return result;
        });
    }
    jobs() {
        return this.store.jobs();
    }
    job(id) {
        const job = this.store.job(id);
        if (!job)
            throw Error('JOB_NOT_FOUND');
        return job;
    }
    saveJob(job) {
        this.store.saveJob(job);
    }
    workRequest(key) {
        if (typeof key !== 'string' || !key || key.length > command_js_1.idempotencyKeyMaxLength)
            throw Error('INVALID_COMMAND');
        return this.store.job((0, hash_js_1.hash)(['work-start', this.store.project, collaboration_js_1.owner.id, key])) ?? null;
    }
    workRequestAbandoned(key) {
        return !!this.store.receipt((0, hash_js_1.hash)(['work-abandon', this.store.project, collaboration_js_1.owner.id, key]));
    }
    abandonWorkRequest(workId, requestKey, command) {
        this.assertOwnerCommand(command);
        this.workRequest(requestKey);
        return this.store.transaction(() => {
            const job = this.workRequest(requestKey);
            if (job)
                return {
                    abandoned: false,
                    job: { id: job.id, status: job.status, roomId: job.roomId, targetId: job.targetId },
                };
            const key = (0, hash_js_1.hash)(['work-abandon', this.store.project, collaboration_js_1.owner.id, requestKey]), fingerprint = (0, hash_js_1.hash)([workId, command.expected_version]);
            const prior = this.store.receipt(key);
            if (prior && prior.hash !== fingerprint)
                throw Error('IDEMPOTENCY_CONFLICT');
            if (!prior) {
                this.store.addReceipt(key, fingerprint, { workId, requestKey, command });
                this.store.log(collaboration_js_1.owner, 'work.request.abandon', workId, 'SUCCEEDED');
            }
            return { abandoned: true, job: null };
        });
    }
    abandonChat(roomId, employeeId, messageKey, jobKey, command) {
        this.assertOwnerCommand(command);
        for (const value of [roomId, messageKey, ...(employeeId ? [employeeId, jobKey] : [])])
            if (typeof value !== 'string' || !value || value.length > 150)
                throw Error('INVALID_COMMAND');
        return this.store.transaction(() => {
            const message = this.store.receipt((0, hash_js_1.hash)([collaboration_js_1.owner.id, this.store.project, messageKey]));
            const jobId = (0, hash_js_1.hash)(['job', roomId, employeeId, jobKey]), job = employeeId ? this.store.job(jobId) : undefined;
            const result = {
                messageId: message ? JSON.parse(message.result).id : null,
                job: job ? { id: jobId, status: job.status } : null,
            };
            const entries = [
                (0, hash_js_1.hash)(['chat-message-abandon', collaboration_js_1.owner.id, this.store.project, messageKey]),
                ...(employeeId ? [(0, hash_js_1.hash)(['chat-job-abandon', jobId])] : []),
            ];
            const fingerprint = (0, hash_js_1.hash)([roomId, employeeId, messageKey, jobKey]);
            for (const key of entries) {
                const prior = this.store.receipt(key);
                if (prior && prior.hash !== fingerprint)
                    throw Error('IDEMPOTENCY_CONFLICT');
                this.store.addReceipt(key, fingerprint, { command, result }, true);
            }
            this.store.log(collaboration_js_1.owner, 'chat.request.abandon', roomId, 'SUCCEEDED');
            return result;
        });
    }
    engineState() {
        try {
            return this.engineSettings?.read() ?? { developEngine: '', consents: [] };
        }
        catch {
            return { developEngine: '', consents: [] };
        }
    }
    /**
     * Engines an execution target can name (ADR 0065), with stable ids: registered ones from the owner's
     * registry and any from config/collaboration.json. `consented` is this project's consent.
     */
    listEngines() {
        this.refreshEngines?.();
        const state = this.engineState();
        return (this.config.engines ?? []).map((e) => ({
            id: e.id,
            label: e.label,
            enabled: e.enabled,
            template: e.template ?? 'config',
            consented: (0, engine_registry_js_1.consentGranted)(state.consents, e),
            developRoute: state.developEngine === e.id,
        }));
    }
    /** A registered and enabled engine by id, or undefined. Routing calls this before choosing it. */
    engineById(id) {
        this.refreshEngines?.();
        const engine = this.config.engines?.find((e) => e.id === id);
        return engine?.enabled ? engine : undefined;
    }
    /**
     * The engine a run uses: engines take develop work only (whole work item in, changed files out as a
     * candidate). Unavailable or not consented in this project stops the run before anything is sent.
     */
    engineFor(employee, mode) {
        const id = (0, engine_registry_js_1.engineIdForRun)({
            mode,
            employeeEngine: (0, collaboration_js_1.string)(employee.data, 'engine'),
            developRoute: this.engineState().developEngine,
            canPropose: (0, collaboration_js_1.hasTool)((0, collaboration_js_1.strings)(employee.data, 'tools'), 'change.propose'),
        });
        if (!id)
            return undefined;
        const engine = this.engineById(id);
        if (!engine)
            throw Error('ENGINE_UNAVAILABLE');
        if (!(0, engine_registry_js_1.consentGranted)(this.engineState().consents, engine))
            throw Error('ENGINE_CONSENT_REQUIRED');
        return engine;
    }
    /** The engine a routed run uses; a model target runs no engine. Consent is checked like engineFor. */
    routedEngine(target) {
        if (target.kind !== 'engine')
            return undefined;
        const engine = this.engineById(target.id);
        if (!engine)
            throw Error('ENGINE_UNAVAILABLE');
        if (!(0, engine_registry_js_1.consentGranted)(this.engineState().consents, engine))
            throw Error('ENGINE_CONSENT_REQUIRED');
        return engine;
    }
    /** Owner agrees that this engine may receive this project's code (ADR 0065). Audited. */
    grantEngineConsent(engineId, command) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.store.project });
        const engine = this.engineById(engineId);
        if (!engine)
            throw Error('ENGINE_UNAVAILABLE');
        if (!this.engineSettings)
            throw Error('ENGINE_SETTINGS_UNAVAILABLE');
        const consent = this.engineSettings.grant(engine);
        this.store.log(collaboration_js_1.owner, 'engine.consent', engineId, 'GRANTED');
        return consent;
    }
    revokeEngineConsent(engineId, command) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.store.project });
        if (!this.engineSettings)
            throw Error('ENGINE_SETTINGS_UNAVAILABLE');
        const result = this.engineSettings.revoke(engineId);
        this.store.log(collaboration_js_1.owner, 'engine.consent', engineId, 'REVOKED');
        return result;
    }
    /** The engine develop work uses when its employee names none; '' turns the route off. */
    setDevelopEngine(engineId, command) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.store.project });
        if (!this.engineSettings)
            throw Error('ENGINE_SETTINGS_UNAVAILABLE');
        if (engineId && !this.engineById(engineId))
            throw Error('ENGINE_UNAVAILABLE');
        const result = this.engineSettings.setDevelopEngine(engineId);
        this.store.log(collaboration_js_1.owner, 'engine.route', engineId || 'NONE', 'SUCCEEDED');
        return result;
    }
    assertOwnerCommand(command) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.store.project, minVersion: 1 });
    }
    /**
     * Handoff from each predecessor work, from records only (ADR 0053): its status, the last report of
     * its finished run, its newest change candidate and test results, accepted decisions. Nothing here
     * is model-written summary; the next employee reads what actually happened.
     */
    handoffs(target, visible) {
        const out = {};
        for (const id of (0, collaboration_js_1.strings)(target.data, 'dependencies')) {
            const work = visible.find((e) => e.id === id && e.kind === 'work');
            if (!work)
                continue;
            const run = this.jobs()
                .filter((j) => j.targetId === id && j.status === 'SUCCEEDED')
                .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
                .at(-1);
            const report = run
                ? visible
                    .filter((e) => e.kind === 'message' && e.data.jobId === run.id)
                    .map((e) => (0, collaboration_js_1.string)(e.data, 'body'))
                    .at(-1)
                : undefined;
            const change = this.projectTools?.newestCandidateSummary?.(id);
            const decisions = visible
                .filter((e) => e.kind === 'decision' && e.data.workId === id && e.data.status === 'ACCEPTED')
                .map((e) => (0, collaboration_js_1.string)(e.data, 'title'));
            const parts = [
                `상태 ${(0, collaboration_js_1.string)(work.data, 'status')}`,
                report ? `마지막 보고: ${report.slice(0, 240)}` : '완료된 실행 보고 없음',
                change
                    ? `수정안 「${change.title}」(${change.state}) 파일 ${change.files.join(', ')}` +
                        (change.tests
                            ? ` · 시험 통과 ${change.tests.passed.length}개` +
                                (change.tests.failed.length ? `, 실패 ${change.tests.failed.slice(0, 5).join(', ')}` : '')
                            : '')
                    : '',
                decisions.length ? `확정 결정: ${decisions.slice(0, 5).join(', ')}` : '',
            ].filter(Boolean);
            out[id] = parts.join(' · ').slice(0, 700);
        }
        return out;
    }
    /**
     * The target and effort a new run would get (ADR 0063): the work item's choice, the target its
     * previous attempt used (escalating effort after a failed verification), the employee's or the
     * project's rule for the kind, else the employee's default.
     */
    routeOf(employee, mode, targetId = '') {
        const work = targetId ? this.store.get(targetId) : undefined;
        const attempts = work?.kind === 'work' ? this.store.jobs().filter((j) => j.targetId === targetId) : [];
        const last = attempts.find((j) => j.route);
        const fallbackEngine = (0, engine_registry_js_1.engineIdForRun)({
            mode,
            employeeEngine: (0, collaboration_js_1.string)(employee.data, 'engine'),
            developRoute: this.engineState().developEngine,
            canPropose: (0, collaboration_js_1.hasTool)((0, collaboration_js_1.strings)(employee.data, 'tools'), 'change.propose'),
        });
        return this.routes.decide(employee, mode, fallbackEngine, work?.kind === 'work' ? work : undefined, last?.route
            ? {
                decision: last.route,
                // Failed verification, not a stopped run: a run cut at its step limit keeps its effort.
                failed: this.projectTools?.newestCandidateSummary?.(targetId)?.state === 'REJECTED',
                attempt: attempts.length,
            }
            : undefined);
    }
    /** The mode a work item runs in: development for an employee who can submit changes. */
    workMode(employee) {
        return (0, collaboration_js_1.hasTool)((0, collaboration_js_1.strings)(employee.data, 'tools'), 'change.propose') ? 'develop' : 'chat';
    }
    /**
     * Runs a work item. `handoff` is set when a run of the same work stopped at its step limit and this
     * one continues it (ADR 0063): it starts a fresh conversation from the preserved draft instead of
     * carrying the whole earlier conversation.
     */
    startWork(workId, command, handoff) {
        this.assertOwnerCommand(command);
        const prior = this.workRequest(command.idempotency_key);
        if (prior) {
            if (prior.targetId !== workId || prior.workCommand?.expected_version !== command.expected_version)
                throw Error('IDEMPOTENCY_CONFLICT');
            return prior;
        }
        if (this.workRequestAbandoned(command.idempotency_key))
            throw Error('REQUEST_ABANDONED');
        const work = this.store.read(workId, collaboration_js_1.owner);
        if (work.kind !== 'work')
            throw Error('INVALID_WORK');
        if (work.version !== command.expected_version)
            throw Error('VERSION_CONFLICT');
        const employeeId = (0, collaboration_js_1.string)(work.data, 'assigneeId'), roomId = (0, collaboration_js_1.string)(work.data, 'roomId');
        (0, work_execution_js_1.assertWorkExecutable)(work, employeeId, roomId, (id) => this.store.read(id, collaboration_js_1.owner), command.expected_version);
        const employee = this.store.get(employeeId), mode = this.workMode(employee);
        const criteria = (0, collaboration_js_1.strings)(work.data, 'criteria');
        // Development work builds on what its predecessors produced and has not been applied yet. A
        // rerun of the same work fixes its own last attempt instead, with that attempt's failure log,
        // unless that attempt broke criteria of finished predecessors: repairing such an attempt made
        // things worse in practice, so the rerun starts again from the predecessors' result. Among its
        // own attempts the one that passed most tests is fixed, not merely the newest, since a later
        // attempt can pass fewer.
        const latestOwn = mode === 'develop'
            ? (this.projectTools?.bestCandidateFor?.(work.id) ??
                this.projectTools?.latestCandidateFor?.([work.id]))
            : undefined;
        const ownTests = latestOwn ? this.projectTools?.candidateTests?.(latestOwn) : undefined;
        const kept = (0, employee_tools_js_1.criteriaKeptBy)(this.store, work.id);
        const own = latestOwn && !(ownTests && kept.some((n) => !ownTests.passed.includes(n))) ? latestOwn : undefined;
        const previous = mode === 'develop' && !own
            ? this.projectTools?.latestCandidateFor?.((0, collaboration_js_1.strings)(work.data, 'dependencies'))
            : undefined;
        return this.start(roomId, employeeId, (0, collaboration_js_1.string)(work.data, 'title') +
            '\n업무 target의 목표와 완료 기준을 수행하고 결과를 남기세요.' +
            (handoff
                ? '\n앞선 실행이 단계 한도에 도달해 멈췄습니다. 불러온 편집본에 이미 한 일이 있으니 남은 부분만 이어서 하고 change.propose로 제출하세요.'
                : '') +
            (criteria.length
                ? `\n이 업무의 완료 기준은 검증 기준의 시험 ${criteria.map((n) => `「${n}」`).join(', ')}입니다. 이 시험들을 통과시키고, 이미 통과하던 시험을 깨지 마세요. check.run 결과의 target에서 확인하세요. 다른 시험의 실패는 다음 업무에서 다룹니다.`
                : ''), mode, work.id, command.idempotency_key, command, {
            ...(own ? { baseCandidateId: own } : previous ? { baseCandidateId: previous, continues: true } : {}),
            ...(handoff ? { handoff } : {}),
        });
    }
    start(roomId, employeeId, prompt, mode = 'chat', targetId = '', key = (0, node_crypto_1.randomUUID)(), workCommand, options = {}) {
        if (this.closed)
            throw Error('SERVER_CLOSING');
        if (options.baseCandidateId && mode !== 'develop')
            throw Error('INVALID_JOB');
        const room = this.store.get(roomId), employee = this.store.get(employeeId);
        const actor = { kind: 'employee', id: employeeId };
        if (room.kind !== 'room' || employee.kind !== 'employee' || !this.store.canRead(room, actor))
            throw Error('ACCESS_DENIED');
        this.store.allowTool(actor, 'message.write');
        if (!(this.config.models ?? [this.config.runtime]).some((c) => c.modelId === employee.data.model))
            throw Error('MODEL_UNAVAILABLE');
        if (typeof prompt !== 'string' ||
            !prompt.trim() ||
            prompt.length > 4000 ||
            !job_js_1.jobModes.includes(mode))
            throw Error('INVALID_JOB');
        if (targetId) {
            const target = this.store.read(targetId, actor);
            if (room.audience.some((a) => !target.audience.includes(a)))
                throw Error('SOURCE_AUDIENCE_CONFLICT');
        }
        // Decided once per run and kept on it (ADR 0063).
        const route = this.routeOf(employee, mode, targetId);
        const id = workCommand
            ? (0, hash_js_1.hash)(['work-start', this.store.project, workCommand.actor, key])
            : (0, hash_js_1.hash)(['job', roomId, employeeId, key]);
        const prior = this.store.job(id);
        if (prior) {
            if (prior.prompt !== prompt || prior.mode !== mode || prior.targetId !== targetId)
                throw Error('IDEMPOTENCY_CONFLICT');
            return prior;
        }
        if (!workCommand && this.store.receipt((0, hash_js_1.hash)(['chat-job-abandon', id])))
            throw Error('REQUEST_ABANDONED');
        // The first engine run in a project waits for the owner's consent (ADR 0065); checked again before it runs.
        // The route (ADR 0063) names the engine, if any; the employee's engine or the project's develop
        // route (ADR 0065) is its fallback.
        const engineId = route.target.kind === 'engine' ? route.target.id : '';
        const routed = engineId ? this.engineById(engineId) : undefined;
        if (routed && !(0, engine_registry_js_1.consentGranted)(this.engineState().consents, routed))
            throw Error('ENGINE_CONSENT_REQUIRED');
        // A planning engine works only through the app's tools (ADR 0071); without an MCP client it could
        // do nothing that counts.
        if (routed && route.kind === 'plan' && !(0, engine_registry_js_1.engineSpeaksMcp)(routed.template))
            throw Error('ENGINE_MCP_UNSUPPORTED');
        // A route's effort reaches an engine that takes one (low/medium/high; minimal counts as low).
        let engineRun = options.engineRun;
        if (routed && route.reason === 'EMPLOYEE_LOCK') {
            // A pinned model and effort (ADR 0072) are passed as they are or the run is refused; they are
            // never dropped for the engine's own default.
            if (engineRun)
                throw Error('ROUTE_LOCKED');
            const pinned = {
                ...(route.engineModel ? { model: route.engineModel } : {}),
                ...(route.effort ? { effort: route.effort === 'minimal' ? 'low' : route.effort } : {}),
            };
            if (pinned.model || pinned.effort)
                engineRun = pinned;
        }
        else if (!engineRun && routed && route.effort) {
            const effort = route.effort === 'minimal' ? 'low' : route.effort;
            try {
                (0, workspace_engine_js_1.runArgs)(routed, { effort });
                engineRun = { effort };
            }
            catch {
                // This engine takes no effort flag; it runs with its own default.
            }
        }
        // Model and effort are checked against the engine's flag table now, not first at spawn time.
        if (engineRun) {
            if (!engineId)
                throw Error('ENGINE_OPTION_UNSUPPORTED');
            if (routed)
                (0, workspace_engine_js_1.runArgs)(routed, engineRun);
        }
        let targetVersion;
        if (targetId) {
            const target = this.store.read(targetId, actor);
            if (target.kind === 'work') {
                (0, work_execution_js_1.assertWorkExecutable)(target, employeeId, roomId, (id) => this.store.read(id, actor));
                targetVersion = target.version;
            }
        }
        const active = this.store.activeJobs();
        if (targetVersion !== undefined && active.some((j) => j.targetId === targetId))
            throw Error('WORK_ALREADY_RUNNING');
        if (active.length >= 8)
            throw Error('RUN_CAPACITY');
        const now = new Date().toISOString();
        const job = {
            id,
            roomId,
            employeeId,
            employeeVersion: employee.version,
            modelId: route.target.kind === 'model' ? route.target.id : (0, collaboration_js_1.string)(employee.data, 'model'),
            route,
            status: 'QUEUED',
            version: 0,
            prompt,
            mode,
            targetId,
            tokens: 0,
            tokenBudget: Number(employee.data.tokenBudget),
            toolCalls: 0,
            error: null,
            results: [],
            createdAt: now,
            updatedAt: now,
            correlationId: workCommand?.correlation_id ?? (0, node_crypto_1.randomUUID)(),
            ...(targetVersion !== undefined ? { targetVersion } : {}),
            ...(workCommand ? { workCommand } : {}),
            ...(options.baseCandidateId ? { baseCandidateId: options.baseCandidateId } : {}),
            ...(options.baseCandidateId && options.continues ? { continues: true } : {}),
            ...(options.handoff ? { handoff: options.handoff } : {}),
            ...(engineRun
                ? {
                    engineRun: {
                        ...(engineRun.model ? { model: engineRun.model } : {}),
                        ...(engineRun.effort ? { effort: engineRun.effort } : {}),
                    },
                }
                : {}),
        };
        this.saveJob(job);
        this.queue = this.queue.then(() => this.execute(job.id)).catch(() => undefined);
        return job;
    }
    cancel(id, version) {
        const j = this.job(id);
        if (j.version !== version)
            throw Error('VERSION_CONFLICT');
        if (!job_js_1.activeJobStatuses.includes(j.status))
            return j;
        j.status = 'CANCELED';
        this.saveJob(j);
        // The engine's access to the tools ends with the run, before its process is stopped.
        if (this.engineTools.revokeRun(id))
            this.store.log(collaboration_js_1.owner, 'engine.mcp', id, 'REVOKED');
        this.running.get(id)?.abort();
        this.projectTools?.cancelCheck?.(id);
        this.scheduleWorkflows();
        return j;
    }
    guard(job, reserve = 0) {
        if (this.job(job.id).status !== 'RUNNING')
            throw Error('JOB_FENCED');
        if (this.store.get(job.employeeId).version !== job.employeeVersion)
            throw Error('EMPLOYEE_CHANGED');
        if (job.targetVersion !== undefined) {
            const actor = { kind: 'employee', id: job.employeeId }, work = this.store.read(job.targetId, actor);
            (0, work_execution_js_1.assertWorkExecutable)(work, job.employeeId, job.roomId, (id) => this.store.read(id, actor), job.targetVersion);
            const room = this.store.read(job.roomId, actor);
            if (room.audience.some((a) => !work.audience.includes(a)))
                throw Error('SOURCE_AUDIENCE_CONFLICT');
        }
        if (job.tokens + reserve > job.tokenBudget)
            throw Error('TOKEN_BUDGET_EXCEEDED');
    }
    async execute(id) {
        let job = this.job(id);
        if (job.status !== 'QUEUED')
            return;
        const controller = new AbortController();
        this.running.set(id, controller);
        job.status = 'RUNNING';
        // Active time runs from here to the run's last update (ADR 0070).
        job.startedAt = new Date().toISOString();
        this.saveJob(job);
        const actor = { kind: 'employee', id: job.employeeId };
        // True when the run stopped at its step limit with work still under way (ADR 0063).
        let limited = false;
        try {
            this.guard(job);
            const employee = this.store.get(job.employeeId), room = this.store.read(job.roomId, actor);
            // A fix request continues from the rejected candidate instead of starting over from disk; a
            // work item continues from its predecessor's result, whose other failures are expected.
            let base;
            if (job.baseCandidateId && this.projectTools?.seedDraft) {
                const { failure, ...seeded } = this.projectTools.seedDraft(id, job.baseCandidateId, actor, room);
                base = job.continues
                    ? { id: job.baseCandidateId, ...seeded, continues: true }
                    : { id: job.baseCandidateId, ...seeded, ...(failure ? { failure } : {}) };
            }
            // A planner that splits development work names the registered tests as criteria (ADR 0045).
            const testNames = (0, collaboration_js_1.hasTool)((0, collaboration_js_1.strings)(employee.data, 'tools'), 'work.write')
                ? (0, acceptance_js_1.acceptanceTestNames)(this.projectTools?.checks?.().content ?? '')
                : [];
            let report = '';
            const attachments = [];
            const available = Object.entries(collaboration_tools_js_1.toolDescriptions).filter(([name]) => name !== 'message.write' && (0, collaboration_js_1.hasTool)((0, collaboration_js_1.strings)(employee.data, 'tools'), name));
            const visible = this.store
                .list(actor)
                .filter((e) => room.audience.every((a) => e.audience.includes(a)));
            const context = (0, work_context_js_1.workContext)(job.prompt, job.targetId ? this.store.read(job.targetId, actor) : undefined, visible, room.id, this.store
                .list(actor)
                .filter((e) => e.kind === 'employee' && this.store.canRead(room, { kind: 'employee', id: e.id })), job.targetId ? this.handoffs(this.store.read(job.targetId, actor), visible) : {});
            job.contextRefs = context.refs;
            job.contextHash = (0, hash_js_1.hash)(context.content);
            this.saveJob(job);
            const messages = [
                {
                    role: 'system',
                    content: (0, employee_prompt_js_1.employeePrompt)({
                        name: (0, collaboration_js_1.string)(employee.data, 'name'),
                        instructions: (0, collaboration_js_1.string)(employee.data, 'instructions'),
                        tools: available,
                        mode: job.mode,
                        ...(this.brief ? { brief: this.brief } : {}),
                        ...(this.projectTools?.rules?.().content ? { rules: this.projectTools.rules().content } : {}),
                        notes: employeeNotes(this.store.all(), employee.id, {
                            policy: this.lifecycle.policy,
                            now: new Date(),
                        }),
                        skills: this.skills
                            ? (0, employee_tools_js_1.employeeSkills)(employee, this.skills).map((s) => ({ name: s.name, description: s.description }))
                            : [],
                        ...(testNames.length ? { testNames } : {}),
                        ...(job.mode === 'develop'
                            ? {
                                develop: {
                                    environment: this.projectTools?.checkEnvironment?.(),
                                    acceptance: this.projectTools?.checks?.().content,
                                    ...(base ? { base } : {}),
                                },
                            }
                            : {}),
                    }),
                },
                { role: 'user', content: context.content },
            ];
            const loop = (0, collaboration_js_1.loopLimits)(job.mode, this.config.loop);
            let rejected = 0;
            // Same tool, same input, same error: counted so a stuck model is redirected, then stopped.
            const repeats = new Map();
            let stuck = false;
            const engine = job.route ? this.routedEngine(job.route.target) : this.engineFor(employee, job.mode);
            if (engine) {
                // External engine (ADR 0041): one run on a copy of the project; its changes become a
                // candidate through the same draft/proposal path. It never verifies or approves.
                if (!this.projectTools?.runEngine)
                    throw Error('PROJECT_TOOL_UNAVAILABLE');
                const workId = (0, job_js_1.jobWorkId)(job);
                // A planning run (ADR 0071) works through the employee tools over MCP with a token of its
                // own, scoped to this run, this employee and the planning tools, revoked when it ends.
                const plan = job.route?.kind === 'plan';
                let mcp;
                if (plan) {
                    const url = this.mcpUrl?.();
                    const tools = (0, engine_mcp_js_1.engineToolsFor)('plan', (0, collaboration_js_1.strings)(employee.data, 'tools'));
                    if (!url || !(0, engine_registry_js_1.engineSpeaksMcp)(engine.template))
                        throw Error('ENGINE_MCP_UNAVAILABLE');
                    if (!tools.length)
                        throw Error('TOOL_DENIED');
                    mcp = {
                        url,
                        token: this.engineTools.mint({
                            jobId: id,
                            employeeId: job.employeeId,
                            tools,
                            expiresAt: Date.now() + engine.timeoutMs + 60_000,
                            maxCalls: loop.toolCalls,
                        }),
                    };
                    this.store.log(actor, 'engine.mcp', id, 'ISSUED');
                }
                let outcome;
                try {
                    outcome = await this.projectTools.runEngine({
                        engine,
                        prompt: `${messages[0].content}${plan ? runText[this.language].enginePlanBrief : ''}

${messages[1].content}`,
                        jobId: id,
                        actor,
                        room,
                        signal: controller.signal,
                        title: job.prompt.slice(0, 80),
                        ...(workId ? { workId } : {}),
                        ...(job.engineRun ? { options: job.engineRun } : {}),
                        ...(mcp ? { mcp, plan: true } : {}),
                    });
                }
                finally {
                    if (mcp && this.engineTools.revokeRun(id))
                        this.store.log(actor, 'engine.mcp', id, 'REVOKED');
                }
                // Tool calls over MCP updated the stored run meanwhile; continue from that record.
                if (mcp)
                    job = this.job(id);
                // Which engine ran, how long, how it ended. Its cost is billed by that tool's own subscription
                // or account and is unknown to the app (ADR 0065); nothing is added to the API ledger. Token
                // counts the tool printed in its JSON output are recorded; unreadable output stays unknown.
                const { usage: engineUsage, ...ran } = outcome;
                const runUsage = (0, run_usage_js_1.emptyRunUsage)();
                runUsage.parse = engineUsage ? 'OK' : 'UNKNOWN';
                for (const m of engineUsage?.models ?? [])
                    (0, run_usage_js_1.addCall)(runUsage, { ...m, target: 'engine' });
                runUsage.modelMs = engineUsage?.apiMs ?? ran.durationMs ?? null;
                const record = {
                    name: 'engine.run',
                    result: {
                        engine: engine.id,
                        label: engine.label,
                        template: engine.template ?? 'config',
                        billing: 'EXTERNAL_SUBSCRIPTION',
                        usageParse: runUsage.parse,
                        ...(engineUsage?.limits.length ? { limits: engineUsage.limits } : {}),
                        ...ran,
                    },
                };
                job.usage = runUsage;
                if (this.job(id).status !== 'RUNNING') {
                    // Canceled meanwhile: the run record is kept, the state it would have changed is not.
                    const late = this.job(id);
                    late.results.push(record);
                    // What the run consumed is a receipt, kept like the record itself.
                    late.usage = runUsage;
                    this.saveJob(late);
                    this.store.log(actor, 'late-response', id, 'IGNORED');
                    return;
                }
                this.guard(job);
                job.results.push(record);
                this.saveJob(job);
                const exit = outcome.exitCode && outcome.exitCode !== 0 ? runText[this.language].exitCode(outcome.exitCode) : '';
                if (plan) {
                    // Records the engine made through the tools are linked from the run's report message.
                    for (const r of job.results)
                        if (r.via === 'mcp' && ['work.write', 'artifact.write'].includes(r.name ?? '') && r.result?.id)
                            attachments.push(String(r.result.id));
                    report = runText[this.language].enginePlanned(engine.label, attachments.length, !!outcome.timedOut, exit);
                }
                else
                    report = outcome.candidateId
                        ? runText[this.language].engineChanged(engine.label, outcome.applied.length, outcome.skipped.length, exit)
                        : runText[this.language].engineUnchanged(engine.label, !!outcome.timedOut, exit);
            }
            for (let round = 0; !engine && round < loop.rounds; round++) {
                limited = false;
                const profile = (this.config.models ?? [this.config.runtime]).find((c) => c.modelId === (job.modelId ?? this.config.runtime.modelId));
                if (!profile)
                    throw Error('MODEL_UNAVAILABLE');
                // Reserve what this call can consume: the prompt (a token never covers less than one
                // character) plus the output cap, bounded by the window. Reserving the full window would
                // exhaust ordinary budgets as soon as larger contexts are configured.
                const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);
                this.guard(job, Math.min(profile.contextTokens, promptChars + profile.maxOutputTokens));
                this.store.read(room.id, actor);
                const callStarted = Date.now();
                const response = await this.model.complete(messages, controller.signal, job.modelId ?? this.config.runtime.modelId, {
                    run: job.id,
                    ...(job.route ? { kind: job.route.kind } : {}),
                    ...(job.route?.effort ? { effort: job.route.effort } : {}),
                });
                job.tokens += response.tokens;
                // Per-run usage (ADR 0063, 0070): what the adapter reported, in one shape for every target.
                // A count the model did not report stays unknown; targets that never bill cost a known $0.
                const target = (0, run_usage_js_1.usageTargetOf)(profile.provider);
                const callReport = response.report ?? {
                    target,
                    model: job.modelId ?? this.config.runtime.modelId,
                    ...(target === 'local' || target === 'free-remote' ? { billedUsd: 0 } : {}),
                };
                job.usage = (0, run_usage_js_1.addCall)((0, run_usage_js_1.readRunUsage)(job) ?? (0, run_usage_js_1.emptyRunUsage)(), callReport, Date.now() - callStarted);
                if (response.context)
                    (job.modelContexts ??= []).push(response.context);
                if (this.job(id).status !== 'RUNNING') {
                    const late = this.job(id);
                    late.tokens = job.tokens;
                    if (job.usage)
                        late.usage = job.usage;
                    this.saveJob(late);
                    this.store.log(actor, 'late-response', id, 'IGNORED');
                    return;
                }
                this.saveJob(job);
                this.guard(job);
                if (this.store.get(actor.id).version !== job.employeeVersion)
                    throw Error('EMPLOYEE_CHANGED');
                if (job.tokens > job.tokenBudget)
                    throw Error('TOKEN_BUDGET_EXCEEDED');
                // A cut-off or malformed reply may hold a partial tool call, so nothing in it runs. One retry
                // with a correction; a second consecutive rejected reply fails the run.
                // A reply cut at the output limit is never repaired: its missing part is unknown, not a typo.
                let parsed;
                const reply = response.finishReason === 'length' ? undefined : (0, model_reply_js_1.parseModelReply)(response.content);
                if (reply && reply.value && typeof reply.value === 'object') {
                    parsed = reply.value;
                    if (reply.repaired) {
                        job.results.push({ name: 'model.output', note: 'MODEL_JSON_REPAIRED' });
                        this.saveJob(job);
                    }
                }
                if (!parsed) {
                    const code = response.finishReason === 'length' ? 'MODEL_OUTPUT_LIMIT' : 'INVALID_MODEL_JSON';
                    // The start and end of the rejected reply show how it broke (prose around the JSON, a
                    // fence, an unescaped quote); it is model output, never a credential.
                    const text = response.content;
                    job.results.push({
                        name: 'model.output',
                        error: code,
                        recovery: code === 'MODEL_OUTPUT_LIMIT'
                            ? '응답이 출력 한도에서 잘려 실행하지 않았습니다.'
                            : '응답이 JSON 형식이 아니어서 실행하지 않았습니다.',
                        excerpt: text.length > 600 ? `${text.slice(0, 300)}\n…(${text.length}자)…\n${text.slice(-300)}` : text,
                    });
                    this.saveJob(job);
                    if (rejected++)
                        throw Error(code);
                    messages.push({
                        role: 'assistant',
                        content: `{"text":"(${code === 'MODEL_OUTPUT_LIMIT' ? '출력 한도에서 잘림' : '형식 오류'})","tools":[]}`,
                    }, {
                        role: 'user',
                        content: code === 'MODEL_OUTPUT_LIMIT'
                            ? `직전 응답이 출력 한도(${profile.maxOutputTokens}토큰)에서 잘려 아무것도 실행하지 않았습니다. 같은 작업을 더 작게 나누세요. 긴 문서는 핵심만 쓰고, 긴 파일은 change.write로 뼈대를 만든 뒤 change.edit로 나눠 추가하세요.`
                            : '직전 응답이 JSON 하나로 끝나지 않아 아무것도 실행하지 않았습니다. 설명 문장이나 코드 울타리 없이 {"text":...,"tools":[...]} 객체 하나만 답하세요. 파일 내용이 길면 change.write로 뼈대를 만든 뒤 change.edit로 나눠 추가하세요.',
                    });
                    continue;
                }
                rejected = 0;
                const calls = Array.isArray(parsed.tools) ? parsed.tools : [];
                if (typeof parsed.text === 'string' && parsed.text.trim())
                    report = parsed.text.slice(0, collaboration_js_1.collaborationLimits.output);
                if (!calls.length)
                    break;
                const results = [];
                for (const raw of calls) {
                    this.guard(job);
                    if (++job.toolCalls > loop.toolCalls)
                        throw Error('TOOL_BUDGET_EXCEEDED');
                    const call = raw;
                    try {
                        const result = await this.tool(call.name, (0, work_context_js_1.toolCallInput)(raw), actor, room, job);
                        // A tool may wait (check.run); a cancel or revision during the wait must win.
                        this.guard(job);
                        results.push({ name: call.name, result });
                        // Web searches the app ran for the run, counted by code (ADR 0070).
                        if (call.name === 'web.search') {
                            const u = (0, run_usage_js_1.readRunUsage)(job) ?? (0, run_usage_js_1.emptyRunUsage)();
                            u.toolSearches++;
                            job.usage = u;
                        }
                        if ([
                            'artifact.write',
                            'work.write',
                            'decision.write',
                            'memory.write',
                            'meeting.summarize',
                        ].includes(call.name) &&
                            result &&
                            typeof result === 'object' &&
                            'id' in result)
                            attachments.push(String(result.id));
                        this.store.log(actor, call.name, id, 'SUCCEEDED');
                    }
                    catch (error) {
                        if (error instanceof Error && fencedErrors.includes(error.message))
                            throw error;
                        const message = error instanceof Error ? error.message : 'TOOL_FAILED';
                        results.push({
                            name: call.name,
                            error: message,
                            ...(error instanceof collaboration_js_1.ToolError ? { detail: error.detail.slice(0, 500) } : {}),
                            recovery: (0, work_context_js_1.toolRecovery)(message, String(call.name)),
                            received: (0, work_context_js_1.describeInput)('input' in call ? call.input : raw),
                        });
                        this.store.log(actor, String(call.name), id, message);
                        const signature = (0, hash_js_1.hash)([call.name, message, (0, work_context_js_1.toolCallInput)(raw)]);
                        const count = (repeats.get(signature) ?? 0) + 1;
                        repeats.set(signature, count);
                        if (count === 2)
                            results[results.length - 1].recovery =
                                `같은 호출이 같은 오류(${message})로 두 번 실패했습니다. 같은 호출을 반복하지 말고 다른 방법을 쓰세요. 파일 일부 수정이 계속 실패하면 project.read로 최신 내용을 읽고 change.write로 파일 전체를 다시 쓰세요.`;
                        if (count >= 3)
                            stuck = true;
                    }
                    job.results.push(results[results.length - 1]);
                    this.saveJob(job);
                }
                this.saveJob(job);
                // Keep earlier steps (compacted) so a long development run remembers what it already read.
                const window = (profile.contextTokens ?? 4096) * 2;
                messages.splice(0, messages.length, ...(0, work_context_js_1.compactHistory)(messages, window));
                if (stuck) {
                    job.results.push({
                        name: 'model.loop',
                        error: 'REPEATED_FAILURE',
                        recovery: '같은 실패를 세 번 반복해 실행을 멈췄습니다.',
                    });
                    this.saveJob(job);
                    break;
                }
                messages.push(...(0, work_context_js_1.toolContinuation)(parsed.text, results, Math.max(2600, Math.floor(window * 0.4)), calls.map((raw) => {
                    const call = raw;
                    return { name: call.name, input: (0, work_context_js_1.toolCallInput)(call) };
                })));
                limited = true;
            }
            this.guard(job);
            this.store.read(room.id, actor);
            if (!engine)
                this.preserveDraft(job, actor, room);
            if (report &&
                (0, report_js_1.briefReport)(report) !== report.trim() &&
                (0, collaboration_js_1.hasTool)((0, collaboration_js_1.strings)(employee.data, 'tools'), 'artifact.write')) {
                if (job.toolCalls >= loop.toolCalls)
                    throw Error('TOOL_BUDGET_EXCEEDED');
                job.toolCalls++;
                const document = this.put('artifact', null, {
                    title: (0, collaboration_js_1.string)(employee.data, 'name') + runText[this.language].reportDocument,
                    type: 'report',
                    content: report,
                    sourceIds: [...attachments],
                    status: 'DRAFT',
                    roomId: room.id,
                }, room.audience, actor, this.command(actor, id + ':report-document'));
                attachments.push(document.id);
                job.results.push({ name: 'artifact.write', origin: 'report-preservation', result: document });
            }
            const body = report
                ? attachments.length
                    ? (0, report_js_1.briefReport)(report)
                    : report
                : attachments.length
                    ? runText[this.language].attached
                    : runText[this.language].ended;
            const target = job.targetId ? this.store.read(job.targetId, actor) : undefined;
            this.put('message', null, {
                roomId: room.id,
                body,
                links: [...new Set(attachments)],
                jobId: id,
                ...(target?.kind === 'message' ? { replyTo: (0, collaboration_js_1.string)(target.data, 'replyTo') || target.id } : {}),
            }, room.audience, actor, this.command(actor, id + ':report'));
            job.status = 'SUCCEEDED';
            this.saveJob(job);
        }
        catch (error) {
            job = this.job(id);
            limited = error instanceof Error && error.message === 'TOOL_BUDGET_EXCEEDED';
            if (job.status !== 'CANCELED') {
                job.status = 'FAILED';
                job.error =
                    error instanceof Error && /^[A-Z_]+$/.test(error.message)
                        ? error.message
                        : 'MODEL_EXECUTION_FAILED';
                this.saveJob(job);
                // A run stopped by a budget, limit or model error still keeps what it edited. A fenced run
                // must not change state, and a canceled run was abandoned on purpose.
                if (!fencedErrors.includes(job.error))
                    try {
                        this.preserveDraft(job, actor, this.store.read(job.roomId, actor));
                    }
                    catch {
                        // The failure itself is already recorded; a draft that cannot be submitted stays a draft.
                    }
            }
        }
        finally {
            this.running.delete(id);
            if (limited)
                this.handOff(id);
            this.scheduleWorkflows();
        }
    }
    /**
     * A development run of a work item that stopped at its step limit is continued by a new run (ADR
     * 0063): same target, the preserved draft as its base, a fresh short conversation. At most
     * maxHandoffs in a row; workflow runs are left to their workflow, which pauses instead.
     */
    handOff(id) {
        const job = this.job(id), workId = (0, job_js_1.jobWorkId)(job), depth = (job.handoff?.depth ?? 0) + 1;
        if (this.closed || job.mode !== 'develop' || !workId || !job.workCommand || job.status === 'CANCELED')
            return;
        if (depth > job_js_1.maxHandoffs) {
            this.store.log(collaboration_js_1.owner, 'work.handoff', workId, 'HANDOFF_LIMIT');
            return;
        }
        if (this.workflows.list().some((run) => run.nodes.some((n) => n.jobId === id)) ||
            this.graphs
                .list()
                .some((run) => Object.values(run.instances).some((i) => i.attempts.some((a) => a.jobId === id))))
            return;
        try {
            const work = this.store.get(workId);
            this.startWork(workId, { ...this.command(collaboration_js_1.owner, (0, hash_js_1.hash)(['handoff', id]), work.version), correlation_id: job.correlationId }, { from: id, depth });
            this.store.log(collaboration_js_1.owner, 'work.handoff', workId, 'SUCCEEDED');
        }
        catch (error) {
            this.store.log(collaboration_js_1.owner, 'work.handoff', workId, error instanceof Error ? error.message : 'FAILED');
        }
    }
    /**
     * A development run that edited files but never submitted keeps its work: the draft becomes one
     * candidate through the normal proposal path, still subject to verification and approval.
     */
    preserveDraft(job, actor, room) {
        if (job.mode !== 'develop' ||
            !this.projectTools?.draftFiles?.(job.id).length ||
            !this.projectTools.proposeDraft)
            return;
        const workId = (0, job_js_1.jobWorkId)(job);
        try {
            const candidate = this.projectTools.proposeDraft({ title: job.prompt.slice(0, 80), ...(workId ? { workId } : {}) }, actor, room, job.id, job.baseCandidateId, false);
            job.results.push({ name: 'change.propose', origin: 'auto-submit', result: candidate });
        }
        catch (error) {
            job.results.push({
                name: 'change.propose',
                origin: 'auto-submit',
                error: error instanceof Error ? error.message : 'FAILED',
            });
        }
        this.saveJob(job);
    }
    /** One employee tool call; the handlers live in employee-tools.ts and share this service's put. */
    tool(name, input, actor, room, job) {
        return (0, employee_tools_js_1.runEmployeeTool)({
            store: this.store,
            projectTools: this.projectTools,
            put: (kind, id, data, audience, actor, command) => this.put(kind, id, data, audience, actor, command),
            command: (actor, key) => this.command(actor, key),
            memoryStatus: (entity, actor) => this.memoryStatus(entity, actor),
            routeTargets: () => this.routes.targets(),
            language: this.language,
            ...(this.skills ? { skills: this.skills } : {}),
            ...(this.web ? { web: this.web } : {}),
        }, name, input, actor, room, job);
    }
    /**
     * One employee tool call of an engine run over MCP (ADR 0071): the run must still be the current
     * one, the call counts against the run's step budget, and it goes through the same handler, room
     * and permission checks, write key (run id + call index) and audit entry as the model loop.
     */
    async engineToolCall(grant, name, input) {
        const job = this.job(grant.jobId);
        const actor = { kind: 'employee', id: job.employeeId };
        if (actor.id !== grant.employeeId)
            throw Error('ACCESS_DENIED');
        this.guard(job);
        if (job.toolCalls >= grant.maxCalls) {
            this.store.log(actor, name, job.id, 'TOOL_BUDGET_EXCEEDED');
            throw Error('TOOL_BUDGET_EXCEEDED');
        }
        job.toolCalls++;
        this.saveJob(job);
        const record = (entry) => {
            const latest = this.job(job.id);
            latest.results.push({ name, via: 'mcp', ...entry });
            this.saveJob(latest);
        };
        try {
            const result = await this.tool(name, input, actor, this.store.read(job.roomId, actor), job);
            // A cancel or a revision while the tool ran wins; the write itself is kept like the loop's.
            this.guard(this.job(job.id));
            record({ result });
            this.store.log(actor, name, job.id, 'SUCCEEDED');
            return result;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'TOOL_FAILED';
            record({ error: message });
            this.store.log(actor, name, job.id, message);
            throw error;
        }
    }
    /** What the MCP endpoint calls for an authorized engine run. */
    engineToolHost = {
        callTool: (grant, name, input) => this.engineToolCall(grant, name, input),
        recovery: (error, tool) => (0, work_context_js_1.toolRecovery)(error, tool),
    };
    createClient(name) {
        if (!name.trim() || name.length > 120)
            throw Error('INVALID_CLIENT');
        const id = (0, node_crypto_1.randomUUID)(), token = (0, node_crypto_1.randomBytes)(32).toString('hex');
        this.store.addClient(id, (0, hash_js_1.hash)(token), name);
        return { id, token, name };
    }
    client(token) {
        const id = this.store.activeClientId((0, hash_js_1.hash)(token));
        if (!id)
            throw Error('ACCESS_DENIED');
        return { kind: 'client', id };
    }
    revokeClient(id) {
        this.store.deactivateClient(id);
        this.store.log(collaboration_js_1.owner, 'client.revoke', id, 'SUCCEEDED');
    }
    async close() {
        this.closed = true;
        this.engineTools.revokeAll();
        this.workflows.close();
        this.graphs.close();
        this.routines.close();
        for (const [id, controller] of this.running) {
            controller.abort();
            this.projectTools?.cancelCheck?.(id);
        }
        for (const j of this.jobs())
            if (j.status === 'QUEUED') {
                j.status = 'CANCELED';
                this.saveJob(j);
            }
        await this.queue;
        await this.model.close();
        this.store.close();
    }
}
exports.Collaboration = Collaboration;
/**
 * An employee's own notes for its prompt: newest five, each cut short, within about 1,500 characters.
 * Archived and deleted notes never appear; with a policy, neither do expired ones (ADR 0067).
 */
function employeeNotes(entities, employeeId, expiry) {
    let room = 1500;
    return entities
        .filter((e) => e.kind === 'memory' &&
        e.data.employeeId === employeeId &&
        (0, record_lifecycle_js_2.currentRecord)(e) &&
        !(expiry && (0, record_lifecycle_js_2.noteExpired)(e, expiry.policy, expiry.now)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 5)
        .map((e) => ({
        title: (0, collaboration_js_1.string)(e.data, 'title').slice(0, 80),
        content: (0, collaboration_js_1.string)(e.data, 'content').slice(0, 300),
    }))
        .filter((n) => (room -= n.title.length + n.content.length) >= 0);
}
//# sourceMappingURL=collaboration.js.map