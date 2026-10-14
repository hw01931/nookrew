"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordReadLimit = void 0;
exports.readRecord = readRecord;
const collaboration_js_1 = require("./collaboration.js");
exports.recordReadLimit = 2000;
/** Caller supplies only actor- and destination-visible records. Stable versions make paging explicit. */
function readRecord(visible, id, offset = 0, version) {
    if (!Number.isSafeInteger(offset) || offset < 0)
        throw Error('INVALID_PAGE');
    const entity = visible.find((e) => e.id === id);
    if (!entity)
        throw Error('ACCESS_DENIED');
    if (version !== undefined && entity.version !== version)
        throw Error('SOURCE_CHANGED');
    const field = ['content', 'goal', 'body', 'agenda', 'summary', 'instructions', 'purpose'].find((f) => (0, collaboration_js_1.string)(entity.data, f)) ?? '';
    const content = field ? (0, collaboration_js_1.string)(entity.data, field) : '';
    if (offset > content.length)
        throw Error('INVALID_PAGE');
    return {
        id: entity.id,
        kind: entity.kind,
        version: entity.version,
        title: (0, collaboration_js_1.string)(entity.data, 'title') || (0, collaboration_js_1.string)(entity.data, 'name'),
        field,
        offset,
        total: content.length,
        content: content.slice(offset, offset + exports.recordReadLimit),
        next: offset + exports.recordReadLimit < content.length ? offset + exports.recordReadLimit : null,
    };
}
//# sourceMappingURL=record-read.js.map