"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenCounts = tokenCounts;
exports.tokenDifference = tokenDifference;
const fields = {
    input: 'input_tokens',
    output: 'output_tokens',
    cacheRead: 'cached_input_tokens',
    cacheWrite: 'cache_write_input_tokens',
    reasoning: 'reasoning_output_tokens',
    total: 'total_tokens',
};
function tokenCounts(raw) {
    const obj = raw && typeof raw === 'object' ? raw : {};
    return Object.fromEntries(Object.entries(fields).map(([key, field]) => [
        key,
        typeof obj[field] === 'number' && Number.isSafeInteger(obj[field]) && Number(obj[field]) >= 0
            ? obj[field]
            : null,
    ]));
}
function tokenDifference(now, before) {
    if (!before ||
        Object.keys(fields).some((key) => {
            const k = key;
            return now[k] !== null && before[k] !== null && now[k] < before[k];
        }))
        return null;
    return Object.fromEntries(Object.keys(fields).map((key) => {
        const k = key;
        return [k, now[k] !== null && before[k] !== null ? now[k] - before[k] : null];
    }));
}
//# sourceMappingURL=presence-usage.js.map