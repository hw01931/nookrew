"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.containsElision = exports.elisionMark = exports.textEditLimits = void 0;
exports.applyEdits = applyEdits;
exports.readLines = readLines;
/** Exact-match text edits and paged reads used by employee file tools. Pure: no I/O. */
exports.textEditLimits = Object.freeze({
    edits: 20,
    contentCharacters: 24000,
    readLines: 400,
    readCharacters: 4000,
});
/**
 * Marker used when a long string is shortened in model context. Content containing it was copied
 * from a shortened replay, not written, so drafts reject it.
 */
const elisionMark = (characters) => `⟦생략 ${characters}자⟧`;
exports.elisionMark = elisionMark;
const containsElision = (text) => text.includes('⟦생략 ');
exports.containsElision = containsElision;
const truncatedMark = ' …(truncated)';
function occurrences(text, search) {
    let count = 0;
    for (let at = text.indexOf(search); at !== -1; at = text.indexOf(search, at + search.length))
        count++;
    return count;
}
/**
 * Applies edits in order; each edit sees the result of the previous one. The search text must
 * occur exactly once unless replaceAll is set. Replacement text is inserted literally.
 */
function applyEdits(content, edits) {
    if (!Array.isArray(edits) || !edits.length || edits.length > exports.textEditLimits.edits)
        throw Error('INVALID_EDIT');
    let text = content;
    for (const edit of edits) {
        if (!edit ||
            typeof edit.old !== 'string' ||
            typeof edit.new !== 'string' ||
            !edit.old ||
            (edit.replaceAll !== undefined && typeof edit.replaceAll !== 'boolean'))
            throw Error('INVALID_EDIT');
        if (edit.old === edit.new)
            throw Error('EDIT_NO_OP');
        const count = occurrences(text, edit.old);
        if (!count)
            throw Error('EDIT_NOT_FOUND');
        if (count > 1 && !edit.replaceAll)
            throw Error('EDIT_AMBIGUOUS');
        text = text.split(edit.old).join(edit.new);
    }
    if (text.length > exports.textEditLimits.contentCharacters)
        throw Error('CANDIDATE_TOO_LARGE');
    return text;
}
/** A window of 1-based numbered lines starting at a 0-based offset, bounded by lines and characters. */
function readLines(content, offset = 0, limit = exports.textEditLimits.readLines) {
    const all = content === '' ? [] : content.split('\n');
    if (!Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(limit) ||
        offset < 0 ||
        limit < 1 ||
        (offset > 0 && offset >= all.length))
        throw Error('INVALID_PAGE');
    const out = [];
    let used = 0;
    for (let i = offset; i < all.length && out.length < Math.min(limit, exports.textEditLimits.readLines); i++) {
        let line = all[i];
        const room = exports.textEditLimits.readCharacters - used;
        if (line.length > room) {
            if (out.length)
                break;
            line = line.slice(0, room) + truncatedMark;
        }
        out.push(`${i + 1}\t${line}`);
        used += line.length + 1;
        if (used >= exports.textEditLimits.readCharacters)
            break;
    }
    const end = offset + out.length;
    return {
        text: out.join('\n'),
        offset,
        lines: out.length,
        totalLines: all.length,
        next: end < all.length ? end : null,
    };
}
//# sourceMappingURL=text-edit.js.map