"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchMessages = searchMessages;
const collaboration_js_1 = require("./collaboration.js");
function searchMessages(visible, roomId, query) {
    if (!visible.some((e) => e.kind === 'room' && e.id === roomId))
        throw Error('ACCESS_DENIED');
    if (typeof query !== 'string' || !query.trim() || query.length > 200)
        throw Error('INVALID_QUERY');
    const needle = query.trim().toLocaleLowerCase(), matches = visible.filter((e) => e.kind === 'message' &&
        e.data.roomId === roomId &&
        (0, collaboration_js_1.string)(e.data, 'body').toLocaleLowerCase().includes(needle));
    return {
        total: matches.length,
        truncated: matches.length > 50,
        messages: matches.slice(-50).map((e) => {
            const body = (0, collaboration_js_1.string)(e.data, 'body'), position = body.toLocaleLowerCase().indexOf(needle), start = Math.max(0, position - 100);
            return {
                id: e.id,
                version: e.version,
                actor: e.actor,
                createdAt: e.createdAt,
                excerpt: body.slice(start, start + 500),
                replyTo: visible.some((r) => r.id === e.data.replyTo) ? e.data.replyTo : undefined,
            };
        }),
    };
}
//# sourceMappingURL=message-search.js.map