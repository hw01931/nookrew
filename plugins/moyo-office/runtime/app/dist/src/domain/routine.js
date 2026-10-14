"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routineLimits = void 0;
exports.validateRoutine = validateRoutine;
exports.slotId = slotId;
exports.latestSlot = latestSlot;
exports.nextSlot = nextSlot;
exports.dueSlot = dueSlot;
exports.scheduleLabel = scheduleLabel;
exports.routineLimits = { title: 120, instruction: 4000, runs: 20, routines: 50 };
const everyValues = ['day', 'week', 'month'];
function validateRoutine(input) {
    const d = input;
    const s = d?.schedule;
    const text = (v, max) => typeof v === 'string' && !!v.trim() && v.length <= max;
    if (!d ||
        typeof d !== 'object' ||
        !text(d.title, exports.routineLimits.title) ||
        !text(d.instruction, exports.routineLimits.instruction) ||
        typeof d.employeeId !== 'string' ||
        !d.employeeId ||
        typeof d.enabled !== 'boolean' ||
        !s ||
        !everyValues.includes(s.every) ||
        typeof s.time !== 'string' ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) ||
        (s.every === 'week' && (!Number.isInteger(s.weekday) || s.weekday < 0 || s.weekday > 6)) ||
        (s.every === 'month' && (!Number.isInteger(s.day) || s.day < 1 || s.day > 31)))
        throw Error('INVALID_ROUTINE');
    return {
        title: d.title.trim(),
        employeeId: d.employeeId,
        instruction: d.instruction.trim(),
        enabled: d.enabled,
        schedule: {
            every: s.every,
            time: s.time,
            ...(s.every === 'week' ? { weekday: s.weekday } : {}),
            ...(s.every === 'month' ? { day: s.day } : {}),
        },
    };
}
const pad = (n) => String(n).padStart(2, '0');
/** Slot id in local time, e.g. 2026-10-07T09:00. */
function slotId(at) {
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
function monthSlot(year, month, day, h, m) {
    const last = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(day, last), h, m);
}
/** The most recent scheduled time at or before `now`. */
function latestSlot(s, now) {
    const [h, m] = s.time.split(':').map(Number);
    if (s.every === 'month') {
        const here = monthSlot(now.getFullYear(), now.getMonth(), s.day, h, m);
        return here <= now ? here : monthSlot(now.getFullYear(), now.getMonth() - 1, s.day, h, m);
    }
    const back = s.every === 'week' ? (now.getDay() - s.weekday + 7) % 7 : 0;
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, h, m);
    if (at <= now)
        return at;
    at.setDate(at.getDate() - (s.every === 'week' ? 7 : 1));
    return at;
}
/** The next scheduled time strictly after `now`. */
function nextSlot(s, now) {
    for (let i = 1; i <= 62; i++) {
        const at = latestSlot(s, new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, now.getHours(), now.getMinutes()));
        if (at > now)
            return at;
    }
    throw Error('ROUTINE_SCHEDULE_UNREACHABLE');
}
/** The slot to run now, if any: the latest one since the routine existed that has not run yet. */
function dueSlot(routine, now) {
    if (!routine.enabled)
        return undefined;
    const at = latestSlot(routine.schedule, now);
    if (at < new Date(routine.since))
        return undefined;
    const slot = slotId(at);
    return routine.runs.some((r) => r.slot === slot) ? undefined : slot;
}
/**
 * The schedule in words, for the work a run writes into the project, so in the project's language
 * (ADR 0062). The screen words a routine's schedule from its own catalog.
 */
const scheduleWords = {
    ko: {
        weekdays: ['일', '월', '화', '수', '목', '금', '토'],
        label: (s, weekday) => s.every === 'day'
            ? `매일 ${s.time}`
            : s.every === 'week'
                ? `매주 ${weekday}요일 ${s.time}`
                : `매월 ${s.day}일 ${s.time}`,
    },
    en: {
        weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        label: (s, weekday) => s.every === 'day'
            ? `daily at ${s.time}`
            : s.every === 'week'
                ? `every ${weekday} at ${s.time}`
                : `monthly on day ${s.day} at ${s.time}`,
    },
};
function scheduleLabel(s, lang = 'ko') {
    const words = scheduleWords[lang];
    return words.label(s, words.weekdays[s.weekday ?? 0]);
}
//# sourceMappingURL=routine.js.map