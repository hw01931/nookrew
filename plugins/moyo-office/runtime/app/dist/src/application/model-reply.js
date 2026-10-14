"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseModelReply = parseModelReply;
/**
 * Reads a model reply as one JSON object. Models that put long file contents inside JSON strings
 * sometimes drop a closing bracket near the end (`"}]}]}` where `"}]}}]}` was meant), which would
 * throw the whole reply away. Only bracket structure is repaired: string contents are never
 * changed, a closer that does not match the open bracket gets the missing closers inserted before
 * it, and closers still missing at the end are appended. Anything else stays unparseable.
 * The repaired value is still only a proposal; every tool input is validated by its handler.
 */
function parseModelReply(text) {
    try {
        return { value: JSON.parse(text), repaired: false };
    }
    catch {
        // fall through to the bracket repair
    }
    const repaired = repairBrackets(text);
    if (repaired === undefined)
        return undefined;
    try {
        return { value: JSON.parse(repaired), repaired: true };
    }
    catch {
        return undefined;
    }
}
const closerOf = { '{': '}', '[': ']' };
function repairBrackets(text) {
    const open = [];
    let out = '', inString = false, escaped = false, changed = false;
    for (const ch of text) {
        if (inString) {
            out += ch;
            if (escaped)
                escaped = false;
            else if (ch === '\\')
                escaped = true;
            else if (ch === '"')
                inString = false;
            continue;
        }
        if (ch === '"')
            inString = true;
        else if (ch === '{' || ch === '[')
            open.push(ch);
        else if (ch === '}' || ch === ']') {
            // Close inner brackets the model forgot until this closer matches; give up if it never does.
            if (!open.some((b) => closerOf[b] === ch))
                return undefined;
            while (closerOf[open[open.length - 1]] !== ch) {
                out += closerOf[open.pop()];
                changed = true;
            }
            open.pop();
        }
        out += ch;
    }
    if (inString)
        return undefined;
    while (open.length) {
        out += closerOf[open.pop()];
        changed = true;
    }
    return changed ? out : undefined;
}
//# sourceMappingURL=model-reply.js.map