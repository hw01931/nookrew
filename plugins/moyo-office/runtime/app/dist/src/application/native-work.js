"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NativeWork = void 0;
const node_crypto_1 = require("node:crypto");
const hash_js_1 = require("../infrastructure/hash.js");
const sqlite_js_1 = require("../infrastructure/sqlite.js");
const collaboration_js_1 = require("../domain/collaboration.js");
const command_js_1 = require("../domain/command.js");
const routine_js_1 = require("../domain/routine.js");
/** Native sessions get recorded work and handoff prompts, not fake model/engine identities. */
class NativeWork {
    store;
    employee;
    constructor(store, employee) {
        this.store = store;
        this.employee = employee;
        store.db.exec('CREATE TABLE IF NOT EXISTS native_work_plans(id TEXT PRIMARY KEY,data TEXT)');
    }
    plans() {
        return this.store.db.prepare('SELECT data FROM native_work_plans ORDER BY rowid DESC LIMIT 100').all().map((r) => JSON.parse(r.data));
    }
    view() {
        return this.plans().map((p) => ({
            ...p,
            employeeAvailable: this.employee(p.employeeId),
            waiting: p.workIds.some((id) => {
                try {
                    return this.store.read(id, collaboration_js_1.owner).data.status !== 'DONE';
                }
                catch {
                    return true;
                }
            }),
            next: p.enabled && p.schedule ? (0, routine_js_1.slotId)((0, routine_js_1.nextSlot)(p.schedule, new Date())) : null,
        }));
    }
    save(p) {
        this.store.db
            .prepare('INSERT OR REPLACE INTO native_work_plans VALUES(?,?)')
            .run(p.id, JSON.stringify(p));
        return p;
    }
    create(title, goal, employeeId, command, dependencies = [], parentId = '') {
        if (!this.employee(employeeId))
            throw Error('NATIVE_EMPLOYEE_NOT_FOUND');
        if (!title.trim() || title.length > 120 || !goal.trim() || goal.length > 4000)
            throw Error('INVALID_WORK');
        return this.store.put('work', null, {
            title,
            goal,
            status: 'BACKLOG',
            priority: 'NORMAL',
            nativeAssigneeId: employeeId,
            assigneeId: '',
            dependencies,
            artifactIds: [],
            sourceIds: [],
            parentId,
        }, ['leaders'], collaboration_js_1.owner, { ...command, expected_version: 0 });
    }
    command(action, input, command) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.store.project });
        return this.store.idempotent((0, hash_js_1.hash)(['native-work', command.idempotency_key]), (0, hash_js_1.hash)([action, input, command.expected_version]), () => (0, sqlite_js_1.transaction)(this.store.db, () => {
            if (action === 'create') {
                if (command.expected_version !== 0)
                    throw Error('VERSION_CONFLICT');
                return this.create(String(input.title || ''), String(input.goal || ''), String(input.employeeId || ''), command);
            }
            if (action === 'plan') {
                if (command.expected_version !== 0)
                    throw Error('VERSION_CONFLICT');
                const title = String(input.title || ''), employeeId = String(input.employeeId || ''), steps = input.steps;
                if (!title.trim() ||
                    title.length > 120 ||
                    !this.employee(employeeId) ||
                    !Array.isArray(steps) ||
                    !steps.length ||
                    steps.length > 12 ||
                    steps.some((s) => typeof s !== 'string' || !s.trim() || s.length > 4000))
                    throw Error('INVALID_WORKFLOW');
                let schedule;
                if (input.schedule)
                    schedule = (0, routine_js_1.validateRoutine)({
                        title,
                        employeeId,
                        instruction: steps[0],
                        enabled: true,
                        schedule: input.schedule,
                    }).schedule;
                if (this.plans().length >= 50)
                    throw Error('ROUTINE_LIMIT');
                return this.save({
                    id: (0, node_crypto_1.randomUUID)(),
                    version: 1,
                    title,
                    employeeId,
                    steps,
                    schedule,
                    enabled: true,
                    since: new Date().toISOString(),
                    workIds: [],
                });
            }
            if (['run', 'toggle', 'plan-assign'].includes(action)) {
                const p = this.plans().find((p) => p.id === input.id);
                if (!p)
                    throw Error('WORKFLOW_NOT_FOUND');
                if (p.version !== command.expected_version)
                    throw Error('VERSION_CONFLICT');
                if (action === 'plan-assign') {
                    const id = String(input.employeeId || '');
                    if (!this.employee(id))
                        throw Error('NATIVE_EMPLOYEE_NOT_FOUND');
                    p.employeeId = id;
                    p.version++;
                    return this.save(p);
                }
                if (action === 'toggle') {
                    p.enabled = !p.enabled;
                    p.version++;
                    return this.save(p);
                }
                return this.run(p, 'manual:' + command.idempotency_key, command);
            }
            const work = this.store.read(String(input.id), collaboration_js_1.owner);
            if (work.kind !== 'work' || !work.data.nativeAssigneeId)
                throw Error('INVALID_WORK');
            if (work.version !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            if (action === 'assign') {
                const id = String(input.employeeId || '');
                if (!this.employee(id))
                    throw Error('NATIVE_EMPLOYEE_NOT_FOUND');
                return this.store.put('work', work.id, { ...work.data, nativeAssigneeId: id }, work.audience, collaboration_js_1.owner, command);
            }
            if (action === 'status') {
                const state = String(input.status);
                if (!['BACKLOG', 'ACTIVE', 'REVIEW', 'DONE', 'BLOCKED'].includes(state))
                    throw Error('INVALID_WORK');
                // Status is an explicit owner record. Session response never sets DONE automatically.
                return this.store.put('work', work.id, { ...work.data, status: state }, work.audience, collaboration_js_1.owner, command);
            }
            throw Error('NATIVE_ACTION_DENIED');
        }));
    }
    run(p, slot, command) {
        if (!this.employee(p.employeeId))
            throw Error('NATIVE_EMPLOYEE_NOT_FOUND');
        if (p.workIds.some((id) => {
            try {
                return this.store.read(id, collaboration_js_1.owner).data.status !== 'DONE';
            }
            catch {
                return true;
            }
        }))
            throw Error('PREVIOUS_RUN_ACTIVE');
        const ids = [];
        for (const [index, step] of p.steps.entries()) {
            const work = this.create(p.title + ' · ' + (index + 1), step, p.employeeId, { ...command, idempotency_key: 'native-step-' + (0, hash_js_1.hash)([p.id, slot, index]) }, ids.length ? [ids.at(-1)] : []);
            ids.push(work.id);
        }
        p.workIds = ids;
        p.lastSlot = slot;
        p.version++;
        return this.save(p);
    }
    tick(now = new Date()) {
        for (const p of this.plans().filter((p) => p.schedule && p.enabled)) {
            if (!this.employee(p.employeeId))
                continue;
            const slot = (0, routine_js_1.dueSlot)({ schedule: p.schedule, enabled: true, since: p.since, runs: [] }, now);
            if (!slot || slot === p.lastSlot)
                continue;
            (0, sqlite_js_1.transaction)(this.store.db, () => {
                const fresh = this.plans().find((v) => v.id === p.id);
                if (fresh.lastSlot === slot)
                    return;
                // Keep overdue work queued; do not stack new work or execute external Codex automatically.
                if (fresh.workIds.some((id) => this.store.read(id, collaboration_js_1.owner).data.status !== 'DONE'))
                    return;
                this.run(fresh, slot, {
                    actor: collaboration_js_1.owner.id,
                    project_id: this.store.project,
                    expected_version: fresh.version,
                    idempotency_key: 'native-slot-' + (0, hash_js_1.hash)([fresh.id, slot]),
                    correlation_id: 'native-schedule',
                });
            });
        }
    }
}
exports.NativeWork = NativeWork;
//# sourceMappingURL=native-work.js.map