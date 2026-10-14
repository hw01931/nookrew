"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activeJobStatuses = exports.jobModes = exports.maxHandoffs = void 0;
exports.jobWorkId = jobWorkId;
/** Consecutive step-limit continuations of one work item before the owner has to look (ADR 0063). */
exports.maxHandoffs = 2;
/** Kinds of work an employee run can be asked for; the composer offers all but meeting. */
exports.jobModes = [
    'chat',
    'plan',
    'design',
    'slides',
    'flow',
    'diagram',
    'develop',
    'checks',
    'meeting',
];
/** Jobs in these states still own a model slot and block a second run of the same work. */
exports.activeJobStatuses = ['QUEUED', 'RUNNING'];
/** The work item a run executes. Only a run whose target is work pins the target's version. */
function jobWorkId(job) {
    return job.targetVersion !== undefined ? job.targetId : undefined;
}
//# sourceMappingURL=job.js.map