"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.employeeActivity = employeeActivity;
const job_js_1 = require("./job.js");
const automation_js_1 = require("./automation.js");
/** Read-only, evidence-backed presence. Finishing a model response never means work is done. */
function employeeActivity(entities, jobs) {
    const visible = new Map(entities.map((e) => [e.id, e]));
    const newest = (rows) => rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.id.localeCompare(b.id));
    return entities
        .filter((e) => e.kind === 'employee')
        .map((employee) => {
        const works = newest(entities.filter((e) => e.kind === 'work' && (0, automation_js_1.onBoard)(e) && e.data.assigneeId === employee.id && e.data.status !== 'DONE'));
        const runs = newest(jobs.filter((j) => {
            if (j.employeeId !== employee.id || !visible.has(j.roomId))
                return false;
            const target = visible.get(j.targetId);
            // Reassigned/changed work must not inherit a previous execution's presence.
            return (!j.targetId ||
                (!!target &&
                    (target.kind !== 'work' ||
                        (target.data.assigneeId === employee.id &&
                            target.data.status !== 'DONE' &&
                            (j.targetVersion === undefined || j.targetVersion === target.version)))));
        }));
        const active = runs.find((j) => job_js_1.activeJobStatuses.includes(j.status));
        const stopped = runs[0] && ['FAILED', 'UNKNOWN', 'CANCELED'].includes(runs[0].status) ? runs[0] : undefined;
        const work = works.find((w) => w.data.status === 'BLOCKED') ||
            works.find((w) => w.data.status === 'REVIEW') ||
            works[0];
        const run = active || stopped;
        const source = run ? visible.get(run.targetId) : work;
        const delivered = work &&
            runs.find((j) => j.targetId === work.id)?.status === 'SUCCEEDED' &&
            entities.some((e) => e.kind === 'artifact' && e.actor === employee.id && e.data.workId === work.id);
        const status = active
            ? active.mode === 'meeting' && active.status === 'RUNNING'
                ? 'MEETING'
                : active.status
            : employee.data.enabled === false
                ? 'DISABLED'
                : stopped
                    ? stopped.status
                    : work
                        ? delivered && ['BACKLOG', 'ACTIVE'].includes(String(work.data.status))
                            ? 'DELIVERED'
                            : String(work.data.status)
                        : 'IDLE';
        return {
            employeeId: employee.id,
            status,
            sourceId: source?.id ?? null,
            jobId: run?.id ?? null,
            title: typeof source?.data.title === 'string' ? source.data.title : '',
        };
    });
}
//# sourceMappingURL=employee-activity.js.map