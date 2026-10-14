"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.alertRules = exports.dayKey = exports.monthKey = void 0;
exports.usageReport = usageReport;
exports.costAlerts = costAlerts;
exports.validSubscriptions = validSubscriptions;
exports.subscriptionComparison = subscriptionComparison;
/**
 * Cost and trend views over the paid API ledger (ADR 0063). Everything here is computed from the
 * append-only ledger rows; nothing is estimated or filled in. Rows written before work kind and
 * latency were recorded still count toward spend, tokens and failures; they only have no kind (an
 * empty key) and no latency.
 */
const api_budget_js_1 = require("./api-budget.js");
const pad = (n) => String(n).padStart(2, '0');
/** Local calendar month / day, as the spending caps use (api-budget inMonth). */
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
exports.monthKey = monthKey;
const dayKey = (d) => `${(0, exports.monthKey)(d)}-${pad(d.getDate())}`;
exports.dayKey = dayKey;
/** Provider error or sent-but-unanswered call. A pending reservation is neither a call result nor a failure. */
const failed = (r) => r.status === 'FAILED' || r.status === 'UNKNOWN';
function group(key, rows) {
    const input = rows.reduce((s, r) => s + r.input, 0), cached = rows.reduce((s, r) => s + (r.cached ?? 0), 0), timed = rows.filter((r) => !failed(r) && typeof r.latencyMs === 'number');
    return {
        key,
        costUsd: rows.reduce((s, r) => s + r.costUsd, 0),
        calls: rows.length,
        failures: rows.filter(failed).length,
        input,
        output: rows.reduce((s, r) => s + r.output, 0),
        cached,
        cacheHitRate: input ? cached / input : null,
        avgLatencyMs: timed.length ? timed.reduce((s, r) => s + r.latencyMs, 0) / timed.length : null,
    };
}
function groups(rows, keyOf, order) {
    const by = new Map();
    for (const r of rows)
        by.set(keyOf(r), [...(by.get(keyOf(r)) ?? []), r]);
    const out = [...by].map(([k, rs]) => group(k, rs));
    return order === 'key'
        ? out.sort((a, b) => a.key.localeCompare(b.key))
        : out.sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls || a.key.localeCompare(b.key));
}
function usageReport(rows, month, now = new Date()) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
        throw Error('INVALID_MONTH');
    const calls = (0, api_budget_js_1.callRows)(rows).filter((r) => !Number.isNaN(new Date(r.at).getTime()));
    const inMonth = calls.filter((r) => (0, exports.monthKey)(new Date(r.at)) === month);
    const months = [...new Set([...calls.map((r) => (0, exports.monthKey)(new Date(r.at))), (0, exports.monthKey)(now)])].sort();
    return {
        month,
        months,
        total: group(month, inMonth),
        byProvider: groups(inMonth, (r) => r.provider, 'spend'),
        byModel: groups(inMonth, (r) => `${r.provider}:${r.model}`, 'spend'),
        byKind: groups(inMonth, (r) => r.kind ?? '', 'spend'),
        byKindEffort: groups(inMonth, (r) => `${r.kind ?? ''}|${r.effort ?? ''}`, 'key'),
        byKindModel: groups(inMonth, (r) => `${r.kind ?? ''}|${r.provider}:${r.model}`, 'key'),
        days: groups(inMonth, (r) => (0, exports.dayKey)(new Date(r.at)), 'key'),
        trend: months.map((m) => group(m, calls.filter((r) => (0, exports.monthKey)(new Date(r.at)) === m))),
    };
}
/** When the owner is told. Fixed in code so an alert means the same thing in every project. */
exports.alertRules = {
    /** Shares of a monthly cap; the highest one passed is shown. */
    spendShares: [0.8, 1],
    /** Calls today before a failure rate is judged. */
    minFailureCalls: 5,
    failureRate: 0.3,
    /** Answered calls with a latency, today and over the previous days, before latency is judged. */
    minLatencyCalls: 3,
    minBaselineCalls: 5,
    latencyRatio: 2,
    baselineDays: 7,
};
function costAlerts(rows, limits, now = new Date()) {
    const calls = (0, api_budget_js_1.callRows)(rows).filter((r) => !Number.isNaN(new Date(r.at).getTime()));
    const month = (0, exports.monthKey)(now), today = (0, exports.dayKey)(now);
    const thisMonth = calls.filter((r) => (0, exports.monthKey)(new Date(r.at)) === month);
    const alerts = [];
    const caps = [
        ['all', limits.monthlyUsd],
        ...Object.entries(limits.providerMonthlyUsd),
    ];
    for (const [scope, cap] of caps) {
        if (cap === null || cap === undefined || cap <= 0)
            continue;
        const spent = thisMonth
            .filter((r) => scope === 'all' || r.provider === scope)
            .reduce((s, r) => s + r.costUsd, 0);
        const share = [...exports.alertRules.spendShares].reverse().find((s) => spent >= cap * s);
        if (share === undefined)
            continue;
        const pct = Math.round(share * 100);
        alerts.push({
            id: `api-spend:${month}:${scope}:${pct}`,
            version: 1,
            reason: pct >= 100 ? 'SPEND_100' : 'SPEND_80',
            params: { scope, spent: round2(spent), cap, pct: Math.floor((spent / cap) * 100), month },
            at: now.toISOString(),
        });
    }
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - exports.alertRules.baselineDays);
    const models = new Set(calls.map((r) => `${r.provider}:${r.model}`));
    for (const model of [...models].sort()) {
        const mine = calls.filter((r) => `${r.provider}:${r.model}` === model);
        const now_ = mine.filter((r) => (0, exports.dayKey)(new Date(r.at)) === today);
        const before = mine.filter((r) => (0, exports.dayKey)(new Date(r.at)) !== today && new Date(r.at) >= start && new Date(r.at) < now);
        const alert = (reason, params) => alerts.push({
            id: `api-model:${today}:${model}:${reason}`,
            version: 1,
            reason,
            params: { model, ...params },
            at: now.toISOString(),
        });
        if (now_.length >= exports.alertRules.minFailureCalls) {
            const rate = now_.filter(failed).length / now_.length;
            const baseRate = before.length >= exports.alertRules.minFailureCalls ? before.filter(failed).length / before.length : 0;
            if (rate >= exports.alertRules.failureRate && rate >= 2 * baseRate)
                alert('MODEL_FAILURES', {
                    pct: Math.round(rate * 100),
                    failures: now_.filter(failed).length,
                    calls: now_.length,
                });
        }
        const t = group('', now_).avgLatencyMs, timedNow = now_.filter((r) => !failed(r) && typeof r.latencyMs === 'number').length, b = group('', before), timedBefore = before.filter((r) => !failed(r) && typeof r.latencyMs === 'number').length;
        if (t !== null &&
            b.avgLatencyMs !== null &&
            timedNow >= exports.alertRules.minLatencyCalls &&
            timedBefore >= exports.alertRules.minBaselineCalls &&
            t >= exports.alertRules.latencyRatio * b.avgLatencyMs)
            alert('MODEL_LATENCY', { now: Math.round(t), before: Math.round(b.avgLatencyMs) });
    }
    return alerts;
}
const round2 = (n) => Math.round(n * 100) / 100;
function validSubscriptions(input) {
    if (!Array.isArray(input) || input.length > 20)
        throw Error('INVALID_SUBSCRIPTIONS');
    return input.map((s) => {
        const v = s;
        if (!v ||
            typeof v.label !== 'string' ||
            !v.label.trim() ||
            v.label.length > 80 ||
            typeof v.monthlyUsd !== 'number' ||
            !Number.isFinite(v.monthlyUsd) ||
            v.monthlyUsd < 0 ||
            v.monthlyUsd > 100000)
            throw Error('INVALID_SUBSCRIPTIONS');
        return { label: v.label.trim(), monthlyUsd: v.monthlyUsd };
    });
}
/** This month's actual API spend next to the subscriptions' total. Positive difference: API cost less. */
function subscriptionComparison(subscriptions, rows, now = new Date()) {
    const month = (0, exports.monthKey)(now);
    const r = usageReport(rows, month, now).total;
    const subscriptionsUsd = subscriptions.reduce((s, x) => s + x.monthlyUsd, 0);
    return {
        month,
        apiUsd: r.costUsd,
        subscriptionsUsd,
        differenceUsd: subscriptionsUsd - r.costUsd,
        calls: r.calls,
    };
}
//# sourceMappingURL=api-usage-report.js.map