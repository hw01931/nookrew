"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workNotRunnable = workNotRunnable;
exports.assertWorkExecutable = assertWorkExecutable;
const collaboration_js_1 = require("./collaboration.js");
/** Finished or on-hold work is not run, whoever asks. */
function workNotRunnable(work) {
    return ['DONE', 'BLOCKED'].includes((0, collaboration_js_1.string)(work.data, 'status'));
}
function assertWorkExecutable(work, employeeId, roomId, read, expectedVersion) {
    if (work.kind !== 'work')
        throw Error('INVALID_WORK');
    if (expectedVersion !== undefined && work.version !== expectedVersion)
        throw Error('WORK_CHANGED');
    if (!(0, collaboration_js_1.string)(work.data, 'assigneeId'))
        throw Error('WORK_UNASSIGNED');
    if (work.data.assigneeId !== employeeId)
        throw Error('WORK_ASSIGNEE_CHANGED');
    if (!roomId || work.data.roomId !== roomId)
        throw Error('WORK_ROOM_CHANGED');
    if (workNotRunnable(work))
        throw Error('WORK_NOT_RUNNABLE');
    for (const id of (0, collaboration_js_1.strings)(work.data, 'dependencies')) {
        const dependency = read(id);
        if (dependency.kind !== 'work' || dependency.data.status !== 'DONE')
            throw Error('DEPENDENCY_NOT_DONE');
    }
}
//# sourceMappingURL=work-execution.js.map