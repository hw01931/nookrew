"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.usagePeriods = void 0;
exports.periodStart = periodStart;
exports.usageSummary = usageSummary;
/**
 * The usage panel's numbers (ADR 0070), computed from run records only. Totals keep unknown apart
 * from zero: `{value: null}` when nothing in the period reported the field, `partial: true` when
 * some runs did and others did not. Shares are shares of reported tokens (input + output), so a
 * local model and a paid API model compare on the same scale; money is shown next to them.
 */
const run_usage_js_1 = require("./run-usage.js");
exports.usagePeriods = ['session', 'today', 'week', 'month', 'all'];
const total = (values) => {
    const knownValues = values.filter((v) => v !== null);
    return {
        value: knownValues.length ? knownValues.reduce((s, v) => s + v, 0) : null,
        partial: knownValues.length > 0 && knownValues.length < values.length,
    };
};
const plus = (a, b) => {
    const t = total([a.value, b.value]);
    return { value: t.value, partial: a.partial || b.partial || t.partial };
};
/** Start of a period in local time; null for all time. `session`: since this app process started. */
function periodStart(period, now, sessionStart) {
    if (period === 'all')
        return null;
    if (period === 'session')
        return sessionStart;
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'today')
        return day;
    if (period === 'week') {
        // Weeks start on Monday.
        const back = (day.getDay() + 6) % 7;
        return new Date(day.getFullYear(), day.getMonth(), day.getDate() - back);
    }
    return new Date(now.getFullYear(), now.getMonth(), 1);
}
function runFacts(run, references, prices) {
    const usage = (0, run_usage_js_1.readRunUsage)({ usage: run.usage, ...(run.modelId ? { modelId: run.modelId } : {}) });
    const rows = (usage?.models ?? []).map((m) => {
        const e = (0, run_usage_js_1.modelEquivalent)(m, run.engine, references, prices);
        return {
            model: m.model,
            target: m.target,
            ...(run.engine ? { engine: run.engine } : {}),
            calls: m.calls,
            input: { value: m.input, partial: m.partial },
            output: { value: m.output, partial: m.partial },
            cacheRead: { value: m.cacheRead, partial: m.partial },
            cacheWrite: { value: m.cacheWrite, partial: m.partial },
            actualUsd: { value: m.billedUsd, partial: m.partial },
            apiEquivalentUsd: { value: e.usd, partial: e.partial },
            sources: [e.source],
            references: e.reference ? [e.reference] : [],
            share: null,
            tokens: (m.input ?? 0) + (m.output ?? 0),
        };
    });
    const sumOf = (pick) => rows.length ? rows.map(pick).reduce(plus) : { value: null, partial: false };
    const started = run.startedAt ? Date.parse(run.startedAt) : NaN, ended = run.endedAt ? Date.parse(run.endedAt) : NaN;
    const finished = !['QUEUED', 'RUNNING'].includes(run.status);
    const activeMs = finished && ended >= started ? ended - started : null;
    const input = sumOf((r) => r.input), cacheRead = sumOf((r) => r.cacheRead);
    const searches = total((usage?.models ?? []).map((m) => m.webSearches));
    const webSearches = usage && usage.toolSearches > 0 ? plus(searches, { value: usage.toolSearches, partial: false }) : searches;
    const totals = {
        runs: 1,
        actualUsd: sumOf((r) => r.actualUsd),
        apiEquivalentUsd: sumOf((r) => r.apiEquivalentUsd),
        activeMs: { value: activeMs, partial: false },
        modelMs: { value: usage?.modelMs ?? null, partial: false },
        linesAdded: { value: run.lines ? run.lines.added : null, partial: false },
        linesRemoved: { value: run.lines ? run.lines.removed : null, partial: false },
        webSearches: usage ? webSearches : { value: null, partial: false },
        input,
        output: sumOf((r) => r.output),
        cacheRead,
        cacheWrite: sumOf((r) => r.cacheWrite),
        cacheHitRate: null,
    };
    return {
        run,
        tokens: rows.reduce((s, r) => s + r.tokens, 0),
        actual: totals.actualUsd,
        equivalent: totals.apiEquivalentUsd,
        rows,
        totals,
    };
}
/** Totals of several runs; code changes count only for runs that produced a candidate. */
function addTotals(facts) {
    const field = (pick) => {
        const parts = facts.map((f) => pick(f.totals));
        const t = total(parts.map((p) => p.value));
        return { value: t.value, partial: t.partial || parts.some((p) => p.partial) };
    };
    const lineField = (pick) => {
        // A run without a candidate changed no lines through this app: that is a known zero for lines.
        const values = facts.map((f) => pick(f.totals).value ?? 0);
        return { value: facts.length ? values.reduce((s, v) => s + v, 0) : null, partial: false };
    };
    // Cache hit rate only over models that reported both input and cache reads.
    let hitInput = 0, hitRead = 0;
    for (const f of facts)
        for (const r of f.rows)
            if (r.input.value !== null && r.cacheRead.value !== null) {
                hitInput += r.input.value;
                hitRead += r.cacheRead.value;
            }
    return {
        runs: facts.length,
        actualUsd: field((t) => t.actualUsd),
        apiEquivalentUsd: field((t) => t.apiEquivalentUsd),
        activeMs: field((t) => t.activeMs),
        modelMs: field((t) => t.modelMs),
        linesAdded: lineField((t) => t.linesAdded),
        linesRemoved: lineField((t) => t.linesRemoved),
        webSearches: field((t) => t.webSearches),
        input: field((t) => t.input),
        output: field((t) => t.output),
        cacheRead: field((t) => t.cacheRead),
        cacheWrite: field((t) => t.cacheWrite),
        cacheHitRate: hitInput > 0 ? hitRead / hitInput : null,
    };
}
function shares(facts, keysOf, all) {
    const by = new Map();
    for (const f of facts)
        for (const [key, tokens, equivalent, actual] of keysOf(f)) {
            const s = by.get(key) ?? {
                key,
                tokens: 0,
                share: null,
                runs: 0,
                apiEquivalentUsd: { value: null, partial: false },
                actualUsd: { value: null, partial: false },
            };
            s.tokens += tokens;
            s.runs++;
            s.apiEquivalentUsd = plus(s.apiEquivalentUsd, equivalent);
            s.actualUsd = plus(s.actualUsd, actual);
            by.set(key, s);
        }
    return [...by.values()]
        .map((s) => ({ ...s, share: all > 0 ? s.tokens / all : null }))
        .sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key));
}
/** A run's execution target class for "what is using it": the engine id, or the model's target. */
function targetKey(row) {
    return row.target === 'engine' && row.engine ? `engine:${row.engine}` : row.target;
}
function usageSummary(runs, options) {
    if (!exports.usagePeriods.includes(options.period))
        throw Error('INVALID_USAGE_PERIOD');
    const now = options.now ?? new Date();
    const from = periodStart(options.period, now, options.sessionStart);
    const all = runs.map((r) => runFacts(r, options.references, options.prices));
    const facts = all.filter((f) => {
        const at = Date.parse(f.run.createdAt);
        return !Number.isNaN(at) && (!from || at >= from.getTime()) && at <= now.getTime();
    });
    const tokens = facts.reduce((s, f) => s + f.tokens, 0);
    const models = new Map();
    for (const f of facts)
        for (const r of f.rows) {
            const key = `${targetKey(r)}|${r.model}`;
            const m = models.get(key);
            if (!m) {
                const row = {
                    ...r,
                    sources: [...r.sources],
                    references: [...r.references],
                };
                delete row.tokens;
                models.set(key, row);
                continue;
            }
            m.calls += r.calls;
            for (const k of [
                'input',
                'output',
                'cacheRead',
                'cacheWrite',
                'actualUsd',
                'apiEquivalentUsd',
            ])
                m[k] = plus(m[k], r[k]);
            m.sources = [...new Set([...m.sources, ...r.sources])];
            m.references = [...new Set([...m.references, ...r.references])];
        }
    const modelTokens = (m) => (m.input.value ?? 0) + (m.output.value ?? 0);
    const byWork = {};
    const workIds = new Set(all.flatMap((f) => (f.run.workId ? [f.run.workId] : [])));
    for (const id of workIds)
        byWork[id] = addTotals(all.filter((f) => f.run.workId === id));
    // Latest windows per engine, whenever observed: limits are about the account, not the period.
    const limits = new Map();
    for (const f of [...all].sort((a, b) => a.run.createdAt.localeCompare(b.run.createdAt)))
        if (f.run.engine && f.run.limits?.length)
            limits.set(f.run.engine, {
                engine: f.run.engine,
                observedAt: f.run.endedAt ?? f.run.createdAt,
                windows: f.run.limits,
            });
    return {
        period: options.period,
        from: from ? from.toISOString() : null,
        totals: addTotals(facts),
        models: [...models.values()]
            .map((m) => ({ ...m, share: tokens > 0 ? modelTokens(m) / tokens : null }))
            .sort((a, b) => modelTokens(b) - modelTokens(a) || a.model.localeCompare(b.model)),
        byEmployee: shares(facts, (f) => [[f.run.employeeId, f.tokens, f.equivalent, f.actual]], tokens),
        byKind: shares(facts, (f) => [[f.run.kind, f.tokens, f.equivalent, f.actual]], tokens),
        byTarget: shares(facts, (f) => f.rows.length
            ? f.rows.map((r) => [targetKey(r), r.tokens, r.apiEquivalentUsd, r.actualUsd])
            : [[f.run.engine ? `engine:${f.run.engine}` : 'unknown', 0, f.equivalent, f.actual]], tokens),
        topRuns: facts
            .filter((f) => f.tokens > 0)
            .sort((a, b) => b.tokens - a.tokens || b.run.createdAt.localeCompare(a.run.createdAt))
            .slice(0, 5)
            .map((f) => ({
            key: f.run.id,
            id: f.run.id,
            title: f.run.title,
            employeeId: f.run.employeeId,
            createdAt: f.run.createdAt,
            tokens: f.tokens,
            share: tokens > 0 ? f.tokens / tokens : null,
            runs: 1,
            apiEquivalentUsd: f.equivalent,
            actualUsd: f.actual,
            ...(f.run.requested ? { requested: f.run.requested } : {}),
        })),
        byWork,
        limits: [...limits.values()],
    };
}
//# sourceMappingURL=usage-summary.js.map