"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.triageStates = exports.defaultAutomation = void 0;
exports.validAutomation = validAutomation;
exports.onBoard = onBoard;
exports.fixDraft = fixDraft;
const change_review_js_1 = require("./change-review.js");
exports.defaultAutomation = {
    version: 0,
    holdWorkOnFailure: true,
    draftFixOnFailure: true,
};
function validAutomation(input) {
    const v = input;
    if (!v ||
        typeof v !== 'object' ||
        typeof v.holdWorkOnFailure !== 'boolean' ||
        typeof v.draftFixOnFailure !== 'boolean')
        throw Error('INVALID_AUTOMATION');
    return { holdWorkOnFailure: v.holdWorkOnFailure, draftFixOnFailure: v.draftFixOnFailure };
}
/** Inbox states of a work item. Absent means an ordinary work item that never went through triage. */
exports.triageStates = ['PENDING', 'ACCEPTED', 'DECLINED'];
/** Work still waiting in, or turned away from, the inbox is not on the board or in counts. */
function onBoard(work) {
    return work.data.triage === undefined || work.data.triage === 'ACCEPTED';
}
/** The drafted fix work's words, in the project's language (ADR 0062). */
const fixDraftText = {
    ko: {
        title: '검증 실패 수정 · ',
        rejected: (id, hash) => `수정안 ${id} (hash ${hash})이 검증에서 반려됐습니다.`,
        log: '검증 기록:',
        next: '원인을 고친 새 수정안을 제출하고 다시 검증하세요.',
    },
    en: {
        title: 'Fix failed verification · ',
        rejected: (id, hash) => `Change ${id} (hash ${hash}) was rejected by verification.`,
        log: 'Verification log:',
        next: 'Fix the cause, submit a new change and verify it again.',
    },
};
/** The fix work a rejected candidate drafts: what failed and what the owner pointed at. */
function fixDraft(candidate, failure, comments, lang = 'ko') {
    const words = fixDraftText[lang];
    return {
        title: (words.title + candidate.title).slice(0, 120),
        goal: (`${words.rejected(candidate.id, candidate.hash.slice(0, 16))}\n\n` +
            (failure ? `${words.log}\n${failure}\n\n` : '') +
            (comments ? `${change_review_js_1.lineCommentWords[lang].heading}\n${comments}\n\n` : '') +
            words.next).slice(0, 12000),
    };
}
//# sourceMappingURL=automation.js.map