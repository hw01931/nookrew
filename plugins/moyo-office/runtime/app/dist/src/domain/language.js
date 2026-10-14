"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replyLanguage = exports.seedText = exports.languages = void 0;
exports.language = language;
/**
 * The language a project is created in (ADR 0062): its seeded teams and roles, the records the app
 * writes into it, and the language employees reply in. Chosen once from the screen language at
 * creation; the owner's later screen choice does not rewrite a project's data.
 */
exports.languages = ['ko', 'en'];
/** Anything else (absent header, older project) is Korean, the source language. */
function language(value) {
    return value === 'en' ? 'en' : 'ko';
}
/** Names the app gives the rooms it creates in a new project. */
exports.seedText = {
    ko: { allRoom: '전체 대화방', teamRoom: ' · 실무', deletedMemory: '삭제된 기억' },
    en: { allRoom: 'All hands', teamRoom: ' · Work', deletedMemory: 'Deleted memory' },
};
/** Said to every employee of an English project; Korean projects need no extra line. */
exports.replyLanguage = {
    ko: '',
    en: 'Language: this project works in English. Write every reply, document, record, work title and test name in English.',
};
//# sourceMappingURL=language.js.map