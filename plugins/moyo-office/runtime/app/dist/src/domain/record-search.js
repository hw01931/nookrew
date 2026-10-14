"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchRecords = searchRecords;
const collaboration_js_1 = require("./collaboration.js");
function searchRecords(visible, query, kind = '', offset = 0) {
    if (typeof query !== 'string' ||
        !query.trim() ||
        query.length > 200 ||
        typeof kind !== 'string' ||
        (kind && !collaboration_js_1.collaborationKinds.includes(kind)) ||
        !Number.isSafeInteger(offset) ||
        offset < 0)
        throw Error('INVALID_QUERY');
    const needle = query.trim().toLocaleLowerCase(), matches = visible
        .filter((e) => !kind || e.kind === kind)
        .map((e) => ({
        entity: e,
        title: (0, collaboration_js_1.string)(e.data, 'title') || (0, collaboration_js_1.string)(e.data, 'name') || (0, collaboration_js_1.string)(e.data, 'body').slice(0, 80),
        text: ['body', 'content', 'goal', 'agenda', 'summary', 'purpose', 'role']
            .map((key) => (0, collaboration_js_1.string)(e.data, key))
            .filter(Boolean)
            .join('\n'),
    }))
        .filter((r) => (r.title + '\n' + r.text).toLocaleLowerCase().includes(needle))
        .sort((a, b) => b.entity.updatedAt.localeCompare(a.entity.updatedAt) || a.entity.id.localeCompare(b.entity.id));
    const pageSize = 30, start = Math.min(offset, Math.max(0, Math.floor((matches.length - 1) / pageSize) * pageSize));
    return {
        query: query.trim(),
        kind,
        total: matches.length,
        offset: start,
        pageSize,
        results: matches.slice(start, start + pageSize).map(({ entity: e, title, text }) => {
            const position = text.toLocaleLowerCase().indexOf(needle), first = Math.max(0, position - 80);
            return {
                id: e.id,
                kind: e.kind,
                version: e.version,
                title,
                excerpt: text.slice(first, first + 360),
                updatedAt: e.updatedAt,
                status: (0, collaboration_js_1.string)(e.data, 'status'),
            };
        }),
    };
}
//# sourceMappingURL=record-search.js.map