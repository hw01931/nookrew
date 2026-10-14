"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validPrice = validPrice;
exports.validLimits = validLimits;
exports.cost = cost;
exports.inMonth = inMonth;
exports.callRows = callRows;
exports.monthSpend = monthSpend;
exports.assertAffordable = assertAffordable;
function validPrice(p) {
    const v = p;
    const ok = (n, optional = false) => (optional && n === undefined) || (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10000);
    return (!!v &&
        ok(v.input) &&
        ok(v.output) &&
        ok(v.cachedInput, true) &&
        ok(v.cacheWrite, true) &&
        ok(v.perSearch, true));
}
function validLimits(l) {
    const v = l;
    const cap = (n) => n === null || (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e6);
    return (!!v &&
        cap(v.monthlyUsd) &&
        cap(v.perCallUsd) &&
        !!v.providerMonthlyUsd &&
        typeof v.providerMonthlyUsd === 'object' &&
        Object.values(v.providerMonthlyUsd).every((n) => typeof n === 'number' && cap(n)));
}
/** `input` is all input tokens; `cached` (cache reads) and `cacheWrite` are the parts billed differently. */
function cost(price, u) {
    const cached = Math.min(u.cached ?? 0, u.input);
    const written = Math.min(u.cacheWrite ?? 0, u.input - cached);
    return (((u.input - cached - written) * price.input +
        cached * (price.cachedInput ?? price.input) +
        written * (price.cacheWrite ?? price.input * 1.25) +
        u.output * price.output) /
        1e6 +
        (u.searches ?? 0) * (price.perSearch ?? 0));
}
/** Same calendar month of the same year, local time. */
function inMonth(at, now = new Date()) {
    const d = new Date(at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}
/**
 * One row per call: settled reservations are replaced by the rows that settle them, so a call is
 * neither counted twice nor dropped. An unsettled reservation stays in at its worst case.
 */
function callRows(rows) {
    const settled = new Set(rows.flatMap((r) => (r.settles ? [r.settles] : [])));
    return rows.filter((r) => !(r.status === 'RESERVED' && r.id && settled.has(r.id)));
}
function monthSpend(rows, now = new Date(), provider) {
    return callRows(rows)
        .filter((r) => inMonth(r.at, now) && (!provider || r.provider === provider))
        .reduce((sum, r) => sum + r.costUsd, 0);
}
/** Throws unless the worst case of this call fits every cap. Returns the worst case to reserve. */
function assertAffordable(price, limits, rows, call, now = new Date()) {
    if (!price || !validPrice(price))
        throw Error('API_PRICE_REQUIRED');
    const worst = cost(price, {
        input: call.promptTokens,
        output: call.maxOutputTokens,
        searches: call.maxSearches ?? 0,
    });
    if (limits.perCallUsd !== null && worst > limits.perCallUsd)
        throw Error('API_CALL_LIMIT');
    if (limits.monthlyUsd !== null && monthSpend(rows, now) + worst > limits.monthlyUsd)
        throw Error('API_MONTHLY_LIMIT');
    const providerCap = limits.providerMonthlyUsd[call.provider];
    if (providerCap !== undefined && monthSpend(rows, now, call.provider) + worst > providerCap)
        throw Error('API_PROVIDER_MONTHLY_LIMIT');
    return worst;
}
//# sourceMappingURL=api-budget.js.map