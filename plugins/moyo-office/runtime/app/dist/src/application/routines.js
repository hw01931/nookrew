"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Routines = void 0;
const node_crypto_1 = require("node:crypto");
const collaboration_js_1 = require("../domain/collaboration.js");
const command_js_1 = require("../domain/command.js");
const routine_js_1 = require("../domain/routine.js");
const job_js_1 = require("../domain/job.js");
const hash_js_1 = require("../infrastructure/hash.js");
/** Slots of "run now" runs start with this; every other slot is a scheduled time. */
const manualSlot = 'manual:';
/** Words in the work a run writes into the project, in the project's language (ADR 0062). */
const runWords = {
    ko: { manual: '수동 실행', routine: '반복 업무' },
    en: { manual: 'manual run', routine: 'Recurring work' },
};
class RoutineStore {
    store;
    constructor(store) {
        this.store = store;
        this.store.db.exec('CREATE TABLE IF NOT EXISTS routines(id TEXT PRIMARY KEY,json TEXT NOT NULL)');
    }
    list() {
        return this.store.db
            .prepare('SELECT json FROM routines ORDER BY rowid')
            .all()
            .map((row) => JSON.parse(String(row.json)));
    }
    get(id) {
        const row = this.store.db.prepare('SELECT json FROM routines WHERE id=?').get(id);
        return row ? JSON.parse(String(row.json)) : undefined;
    }
    save(routine) {
        this.store.db
            .prepare('INSERT INTO routines VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json')
            .run(routine.id, JSON.stringify(routine));
    }
    remove(id) {
        this.store.db.prepare('DELETE FROM routines WHERE id=?').run(id);
    }
}
/**
 * Recurring work (ADR 0048). Each due slot becomes an ordinary work record started through
 * Collaboration.startWork, so budgets, permissions, results in the room and run history are the same
 * as work the owner hands over by hand. Keys derive from routine and slot, so a slot runs once even if
 * two ticks race or the server restarts mid-run.
 */
class Routines {
    office;
    routines;
    timers = [];
    constructor(office) {
        this.office = office;
        this.routines = new RoutineStore(office.store);
    }
    list() {
        return this.routines.list();
    }
    view(now = new Date()) {
        // No schedule label: the screen words `schedule` in its own language (ADR 0062).
        return this.list().map((r) => ({
            ...r,
            next: r.enabled ? (0, routine_js_1.slotId)((0, routine_js_1.nextSlot)(r.schedule, now)) : null,
        }));
    }
    receipt(command, input, write) {
        const key = (0, hash_js_1.hash)(['routine', command.project_id, command.actor, command.idempotency_key]), fingerprint = (0, hash_js_1.hash)([input, command.expected_version]);
        return this.office.store.idempotent(key, fingerprint, write);
    }
    assertEmployee(id) {
        const employee = this.office.store.read(id, collaboration_js_1.owner);
        if (employee.kind !== 'employee')
            throw Error('INVALID_REFERENCE');
    }
    put(id, input, command) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.office.store.project });
        const data = (0, routine_js_1.validateRoutine)(input);
        this.assertEmployee(data.employeeId);
        return this.receipt(command, [id, data], () => {
            const existing = id ? this.routines.get(id) : undefined;
            if (id && !existing)
                throw Error('ROUTINE_NOT_FOUND');
            if ((existing?.version ?? 0) !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            if (!existing && this.list().length >= routine_js_1.routineLimits.routines)
                throw Error('ROUTINE_LIMIT');
            const now = new Date().toISOString();
            const rescheduled = !existing ||
                JSON.stringify(existing.schedule) !== JSON.stringify(data.schedule) ||
                (data.enabled && !existing.enabled);
            const routine = {
                id: existing?.id ?? (0, node_crypto_1.randomUUID)(),
                version: (existing?.version ?? 0) + 1,
                actor: collaboration_js_1.owner.id,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
                since: rescheduled ? now : existing.since,
                runs: existing?.runs ?? [],
                ...(existing?.lastScheduledSlot
                    ? { lastScheduledSlot: existing.lastScheduledSlot }
                    : {}),
                ...data,
            };
            this.routines.save(routine);
            this.office.store.log(collaboration_js_1.owner, 'routine.write', routine.id, 'SUCCEEDED');
            return routine;
        });
    }
    remove(id, command) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.office.store.project, minVersion: 1 });
        return this.receipt(command, ['remove', id], () => {
            const existing = this.routines.get(id);
            if (!existing)
                throw Error('ROUTINE_NOT_FOUND');
            if (existing.version !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            this.routines.remove(id);
            this.office.store.log(collaboration_js_1.owner, 'routine.delete', id, 'SUCCEEDED');
            return { id, removed: true };
        });
    }
    /** Run once now, outside the schedule ("지금 한 번 실행"). */
    runNow(id, command) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.office.store.project, minVersion: 1 });
        return this.receipt(command, ['run', id], () => {
            const routine = this.routines.get(id);
            if (!routine)
                throw Error('ROUTINE_NOT_FOUND');
            if (routine.version !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            return this.run(routine, manualSlot + command.idempotency_key.slice(0, 80), new Date());
        });
    }
    /** Start every routine whose latest slot has not run. Called by the timer and by tests. */
    tick(now = new Date()) {
        const started = [];
        for (const routine of this.list()) {
            const slot = (0, routine_js_1.dueSlot)(routine, now);
            // The run list keeps only the newest runs, so manual runs can push a scheduled one out of it;
            // the last scheduled slot is kept separately so that slot never runs twice.
            if (slot && slot !== routine.lastScheduledSlot)
                started.push(this.run(routine, slot, now));
        }
        return started;
    }
    run(routine, slot, now) {
        const going = (r) => {
            const status = r.jobId ? this.office.store.job(r.jobId)?.status : undefined;
            return !!status && job_js_1.activeJobStatuses.includes(status);
        };
        const record = (run) => {
            const fresh = this.routines.get(routine.id) ?? routine;
            // Newest runs only, but a run still going stays: it is what stops the next one from stacking.
            fresh.runs = [run, ...fresh.runs.filter((r) => r.slot !== run.slot)].filter((r, i) => i < routine_js_1.routineLimits.runs || going(r));
            if (!run.slot.startsWith(manualSlot))
                fresh.lastScheduledSlot = run.slot;
            this.routines.save(fresh);
            this.office.store.log(collaboration_js_1.owner, 'routine.run', routine.id, run.status);
            return run;
        };
        const at = now.toISOString();
        // A run that is still going is not stacked with another one for the same routine.
        const active = routine.runs.find(going);
        if (active)
            return record({ slot, at, status: 'SKIPPED', error: 'PREVIOUS_RUN_ACTIVE' });
        const lang = this.office.language, words = runWords[lang];
        try {
            const employee = this.office.store.read(routine.employeeId, collaboration_js_1.owner);
            if (employee.kind !== 'employee' || employee.data.enabled !== true)
                throw Error('EMPLOYEE_DISABLED');
            const rooms = this.office.store.all().filter((e) => e.kind === 'room');
            const room = rooms.find((r) => r.data.type === 'project') ?? rooms[0];
            if (!room)
                throw Error('ROOM_REQUIRED');
            const key = `routine:${routine.id}:${slot}`;
            const work = this.office.put('work', null, {
                title: `${routine.title} · ${slot.startsWith(manualSlot) ? words.manual : slot.replace('T', ' ')}`.slice(0, 120),
                goal: `${routine.instruction}\n\n(${words.routine} 「${routine.title}」 · ${(0, routine_js_1.scheduleLabel)(routine.schedule, lang)})`,
                status: 'BACKLOG',
                assigneeId: employee.id,
                roomId: room.id,
                dependencies: [],
                artifactIds: [],
            }, room.audience, collaboration_js_1.owner, this.office.command(collaboration_js_1.owner, key, 0));
            const job = this.office.startWork(work.id, this.office.command(collaboration_js_1.owner, 'start:' + key, work.version));
            return record({ slot, at, status: 'STARTED', workId: work.id, jobId: job.id });
        }
        catch (error) {
            return record({
                slot,
                at,
                status: 'FAILED',
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    /** Check every 30 s; the first check runs shortly after start so missed slots catch up once. */
    startTimer(intervalMs = 30000) {
        if (this.timers.length)
            return;
        const check = () => {
            try {
                this.tick();
            }
            catch {
                // One broken routine must not stop the scheduler; each run records its own failure.
            }
        };
        this.timers = [setTimeout(check, 2000), setInterval(check, intervalMs)];
        for (const t of this.timers)
            t.unref();
    }
    close() {
        for (const t of this.timers)
            clearTimeout(t);
        this.timers = [];
    }
}
exports.Routines = Routines;
//# sourceMappingURL=routines.js.map