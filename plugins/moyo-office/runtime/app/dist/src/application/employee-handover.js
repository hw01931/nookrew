"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeeHandover = void 0;
const collaboration_js_1 = require("../domain/collaboration.js");
const command_js_1 = require("../domain/command.js");
const job_js_1 = require("../domain/job.js");
const hash_js_1 = require("../infrastructure/hash.js");
class EmployeeHandover {
    office;
    constructor(office) {
        this.office = office;
    }
    preview(sourceId, targetId) {
        const store = this.office.store, source = store.read(sourceId, collaboration_js_1.owner), target = store.read(targetId, collaboration_js_1.owner);
        if (source.kind !== 'employee' ||
            target.kind !== 'employee' ||
            sourceId === targetId ||
            target.data.enabled !== true)
            throw Error('INVALID_HANDOVER');
        const actor = { kind: 'employee', id: targetId };
        store.allowTool(actor, 'message.write');
        const works = store
            .all()
            .filter((e) => e.kind === 'work' && e.data.assigneeId === sourceId && e.data.status !== 'DONE');
        const active = this.office
            .jobs()
            .filter((j) => job_js_1.activeJobStatuses.includes(j.status) && works.some((w) => w.id === j.targetId));
        const rows = works.map((work) => {
            let permitted = store.canRead(work, actor);
            try {
                const room = store.read((0, collaboration_js_1.string)(work.data, 'roomId'), actor);
                for (const ref of [
                    ...(0, collaboration_js_1.strings)(work.data, 'dependencies'),
                    ...(0, collaboration_js_1.strings)(work.data, 'artifactIds'),
                    ...(0, collaboration_js_1.strings)(work.data, 'sourceIds'),
                ])
                    store.read(ref, actor);
                permitted =
                    permitted && room.kind === 'room' && room.audience.every((a) => work.audience.includes(a));
            }
            catch {
                permitted = false;
            }
            return { id: work.id, version: work.version, title: (0, collaboration_js_1.string)(work.data, 'title'), permitted };
        });
        const evidence = {
            sourceId,
            sourceVersion: source.version,
            targetId,
            targetVersion: target.version,
            works: rows,
            activeJobs: active.map((j) => ({ id: j.id, version: j.version, status: j.status })),
        };
        return {
            ...evidence,
            sourceName: (0, collaboration_js_1.string)(source.data, 'name'),
            targetName: (0, collaboration_js_1.string)(target.data, 'name'),
            snapshotHash: (0, hash_js_1.hash)(evidence),
            canHandover: rows.length > 0 && rows.every((w) => w.permitted) && !active.length,
        };
    }
    execute(sourceId, targetId, snapshotHash, command) {
        const store = this.office.store;
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: store.project, minVersion: 1 });
        const key = (0, hash_js_1.hash)(['employee-handover', store.project, command.idempotency_key]), fingerprint = (0, hash_js_1.hash)([sourceId, targetId, snapshotHash, command.expected_version]);
        const result = store.idempotent(key, fingerprint, () => {
            const plan = this.preview(sourceId, targetId);
            if (plan.sourceVersion !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            if (plan.snapshotHash !== snapshotHash)
                throw Error('SOURCE_CHANGED');
            if (!plan.canHandover)
                throw Error('HANDOVER_NOT_READY');
            const works = plan.works.map((row) => {
                const work = store.get(row.id);
                return store.put('work', work.id, { ...work.data, assigneeId: targetId }, work.audience, collaboration_js_1.owner, {
                    ...command,
                    expected_version: work.version,
                    idempotency_key: (0, hash_js_1.hash)([key, work.id]),
                });
            });
            const result = {
                sourceId,
                targetId,
                works: works.map((w) => ({ id: w.id, version: w.version })),
                evidence: plan,
            };
            store.log(collaboration_js_1.owner, 'employee.handover', sourceId, 'SUCCEEDED');
            return result;
        });
        this.office.scheduleWorkflows();
        return result;
    }
}
exports.EmployeeHandover = EmployeeHandover;
//# sourceMappingURL=employee-handover.js.map