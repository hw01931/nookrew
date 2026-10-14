"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lineCommentWords = void 0;
exports.reviewBlocked = reviewBlocked;
exports.validateReview = validateReview;
exports.validateLineAnchor = validateLineAnchor;
exports.openLineComments = openLineComments;
exports.lineCommentText = lineCommentText;
const reviewVerdicts = ['COMMENT', 'CHANGES', 'RESOLVED'];
function reviewBlocked(candidate) {
    return (candidate.reviews?.filter((r) => r.candidateHash === candidate.hash && r.verdict !== 'COMMENT').at(-1)
        ?.verdict === 'CHANGES');
}
function validateReview(verdict, body) {
    if (!reviewVerdicts.includes(verdict) ||
        typeof body !== 'string' ||
        !body.trim() ||
        body.length > 6000)
        throw Error('INVALID_REVIEW');
    return { verdict: verdict, body: body.trim() };
}
/**
 * Where a line comment points. Only lines that exist in the reviewed version of a file the
 * candidate changes; a deleted file has no lines to point at. Absent path and line = whole change.
 */
function validateLineAnchor(path, line, files) {
    if (path === undefined && line === undefined)
        return null;
    const file = files.find((f) => f.path === path);
    if (!file || file.content === null || !Number.isSafeInteger(line) || line < 1)
        throw Error('INVALID_REVIEW_LINE');
    const lines = file.content.split('\n').length;
    if (line > lines)
        throw Error('INVALID_REVIEW_LINE');
    return { path: file.path, line: line };
}
/** Line comments still open, oldest first; `outdated` when written on an earlier version. */
function openLineComments(candidate) {
    return (candidate.reviews ?? [])
        .filter((r) => r.path && r.line && !r.resolvedAt)
        .map((r) => ({
        id: r.id,
        path: r.path,
        line: r.line,
        body: r.body,
        outdated: r.candidateHash !== candidate.hash,
    }));
}
/** Words the app writes around line comments, in the project's language (ADR 0062). */
exports.lineCommentWords = {
    ko: { heading: '줄 단위 검토 의견:', outdated: ' (이전 버전 기준, 줄 위치가 바뀌었을 수 있음)' },
    en: { heading: 'Line comments:', outdated: ' (written on an earlier version; the line may have moved)' },
};
/** The open line comments as lines of text for a fix run or a follow-up work item. */
function lineCommentText(comments, lang = 'ko', max = 20) {
    return comments
        .slice(0, max)
        .map((c) => `- ${c.path}:${c.line}${c.outdated ? exports.lineCommentWords[lang].outdated : ''} — ${c.body.slice(0, 400)}`)
        .join('\n');
}
//# sourceMappingURL=change-review.js.map