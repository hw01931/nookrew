"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.boardLimits = void 0;
exports.validateBoard = validateBoard;
/**
 * Whiteboard artifacts (type `board`, ADR 0060): sticky notes, text and frames placed on a plane,
 * joined by links. Plain JSON so a small model can write one and a person can move things around.
 */
exports.boardLimits = Object.freeze({
    items: 300,
    links: 600,
    text: 1000,
    coordinate: 20000,
    /** Saved JSON, like a spreadsheet's; a full board is about 300 × 1,100 characters. */
    chars: 400_000,
});
const boardKinds = ['note', 'text', 'frame'];
const boardColors = ['yellow', 'blue', 'green', 'pink', 'gray'];
const fail = (why) => {
    throw Object.assign(Error('INVALID_BOARD'), { detail: why });
};
const int = (v, min, max, what) => Number.isInteger(v) && v >= min && v <= max ? v : fail(what);
/** Parses and checks a board; the error's `detail` says what is wrong, for the employee to fix. */
function validateBoard(content) {
    let data;
    try {
        data = JSON.parse(content);
    }
    catch {
        return fail('JSON이 아닙니다');
    }
    if (!data || typeof data !== 'object' || data.version !== 1)
        fail('version은 1이어야 합니다');
    const items = data.items, links = data.links ?? [];
    if (!Array.isArray(items) || items.length > exports.boardLimits.items)
        fail(`items는 ${exports.boardLimits.items}개 이하 배열`);
    if (!Array.isArray(links) || links.length > exports.boardLimits.links)
        fail(`links는 ${exports.boardLimits.links}개 이하 배열`);
    const c = exports.boardLimits.coordinate;
    const ids = new Set();
    const clean = items.map((item, i) => {
        const where = `items[${i}]`;
        if (!item || typeof item !== 'object')
            fail(`${where}는 객체여야 합니다`);
        if (typeof item.id !== 'string' || !/^[\w-]{1,40}$/.test(item.id) || ids.has(item.id))
            fail(`${where}.id는 겹치지 않는 1~40자 영문·숫자`);
        ids.add(item.id);
        if (!boardKinds.includes(item.kind))
            fail(`${where}.kind는 ${boardKinds.join('|')}`);
        if (typeof item.text !== 'string' || item.text.length > exports.boardLimits.text)
            fail(`${where}.text는 ${exports.boardLimits.text}자 이하 문자열`);
        if (item.color !== undefined && !boardColors.includes(item.color))
            fail(`${where}.color는 ${boardColors.join('|')}`);
        return {
            id: item.id,
            kind: item.kind,
            x: int(item.x, -c, c, `${where}.x`),
            y: int(item.y, -c, c, `${where}.y`),
            w: int(item.w, 20, 4000, `${where}.w(20~4000)`),
            h: int(item.h, 20, 4000, `${where}.h(20~4000)`),
            text: item.text,
            ...(item.color ? { color: item.color } : {}),
        };
    });
    const cleanLinks = links.map((link, i) => {
        if (!link || !ids.has(link.from) || !ids.has(link.to) || link.from === link.to)
            fail(`links[${i}]의 from·to는 서로 다른 items의 id`);
        return { from: link.from, to: link.to };
    });
    return { version: 1, items: clean, links: cleanLinks };
}
//# sourceMappingURL=board.js.map