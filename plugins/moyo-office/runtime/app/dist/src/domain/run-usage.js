"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.referenceKeyPattern = exports.countFields = exports.usageTargets = void 0;
exports.usageTargetOf = usageTargetOf;
exports.emptyRunUsage = emptyRunUsage;
exports.addCall = addCall;
exports.readRunUsage = readRunUsage;
exports.runUsageTotals = runUsageTotals;
exports.apiEquivalentUsd = apiEquivalentUsd;
exports.priceKeyFor = priceKeyFor;
exports.sameModelPriceKey = sameModelPriceKey;
exports.validReferences = validReferences;
exports.referenceClass = referenceClass;
exports.modelEquivalent = modelEquivalent;
exports.lineChanges = lineChanges;
/**
 * Per-run usage in one shape for every kind of execution target (ADR 0070): paid API models, model
 * servers, local llama.cpp, free remote models and external engines. A count nobody reported is
 * `null` (unknown), never 0, and stays unknown through every sum: a total that had unknown parts says
 * so (`partial`). Money comes in two kinds that are never mixed: what was actually billed through
 * this app, and an API-equivalent figure computed from a reference price for comparison only.
 */
const api_budget_js_1 = require("./api-budget.js");
/** Where a model call ran. 'unknown' only for records written before targets were recorded. */
exports.usageTargets = ['api', 'server', 'local', 'free-remote', 'engine'];
/** The usage target of a model profile's provider (ADR 0043, 0051, 0064). */
function usageTargetOf(provider) {
    if (provider === 'api')
        return 'api';
    if (provider === 'server')
        return 'server';
    if (provider === 'openrouter')
        return 'free-remote';
    return provider === undefined || provider === 'local' ? 'local' : 'unknown';
}
exports.countFields = ['input', 'output', 'cacheRead', 'cacheWrite', 'webSearches'];
const moneyFields = ['billedUsd', 'reportedUsd'];
const known = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
/** A known value plus another that may be unknown; the second flag says a known/unknown mix happened. */
function merge(a, b) {
    if (a === null && b === null)
        return [null, false];
    if (a === null || b === null)
        return [(a ?? 0) + (b ?? 0), true];
    return [a + b, false];
}
function emptyRunUsage() {
    return { schema: 2, models: [], modelMs: null, toolSearches: 0 };
}
/** Adds one call's report to the run (mutates and returns it). `ms`: how long the call took. */
function addCall(usage, report, ms) {
    const model = typeof report.model === 'string' ? report.model.slice(0, 200) : '';
    let row = usage.models.find((m) => m.model === model && m.target === report.target);
    const values = Object.fromEntries([...exports.countFields, ...moneyFields].map((f) => [f, known(report[f]) ? report[f] : null]));
    if (!row) {
        row = { model, target: report.target, calls: 1, ...values, partial: false };
        usage.models.push(row);
    }
    else {
        row.calls++;
        for (const f of [...exports.countFields, ...moneyFields]) {
            const [v, mixed] = merge(row[f], values[f]);
            row[f] = v;
            if (mixed)
                row.partial = true;
        }
    }
    if (known(ms))
        usage.modelMs = (usage.modelMs ?? 0) + ms;
    return usage;
}
/** The run's usage, also for records written before ADR 0070 ({input, cached, output, costUsd}). */
function readRunUsage(job) {
    const u = job.usage;
    if (!u || typeof u !== 'object')
        return null;
    if (u.schema === 2 && Array.isArray(u.models))
        return u;
    // Legacy: tokens were recorded but not where they ran. A zero cost there may mean "not billed" or
    // "not reported", so only a positive amount counts as billed.
    return {
        schema: 2,
        models: [
            {
                model: job.modelId ?? '',
                target: 'unknown',
                calls: 1,
                input: known(u.input) ? u.input : null,
                output: known(u.output) ? u.output : null,
                cacheRead: known(u.cached) ? u.cached : null,
                cacheWrite: null,
                webSearches: null,
                billedUsd: known(u.costUsd) && u.costUsd > 0 ? u.costUsd : null,
                reportedUsd: null,
                partial: false,
            },
        ],
        modelMs: null,
        toolSearches: 0,
    };
}
/** One run's counts over all its models, for a run's detail line; null fields were not reported. */
function runUsageTotals(job) {
    const usage = readRunUsage(job);
    if (!usage)
        return null;
    const sum = (pick) => {
        const values = usage.models.map(pick).filter((v) => v !== null);
        return values.length ? values.reduce((s, v) => s + v, 0) : null;
    };
    return {
        input: sum((m) => m.input),
        output: sum((m) => m.output),
        cacheRead: sum((m) => m.cacheRead),
        cacheWrite: sum((m) => m.cacheWrite),
        billedUsd: sum((m) => m.billedUsd),
        reportedUsd: sum((m) => m.reportedUsd),
        webSearches: sum((m) => m.webSearches),
        toolSearches: usage.toolSearches,
        partial: usage.models.some((m) => m.partial),
        parse: usage.parse ?? null,
    };
}
/**
 * API-equivalent cost of some usage at a reference price (USD). null when input or output is
 * unknown. Unknown cache or search counts are priced as none, which can only over-state the token
 * part (cache reads are cheaper than plain input) and under-state searches; `partial` says so.
 */
function apiEquivalentUsd(price, u) {
    if (u.input === null || u.output === null)
        return null;
    return {
        usd: (0, api_budget_js_1.cost)(price, {
            input: u.input,
            output: u.output,
            cached: u.cacheRead ?? 0,
            cacheWrite: u.cacheWrite ?? 0,
            searches: u.webSearches ?? 0,
        }),
        partial: u.cacheRead === null || u.cacheWrite === null || u.webSearches === null,
    };
}
/**
 * Default price for a provider model id, also for its dated snapshots ("claude-haiku-4-5-20251001",
 * "gpt-6-astra-2026-08-01"). Any other suffix ("-pro", "-latest") may be a different model with a
 * different price, so it gets none.
 */
const snapshotSuffix = /^-(\d{8}|\d{4}-\d{2}-\d{2})$/;
function priceKeyFor(prices, id) {
    if (prices.models[id])
        return id;
    return Object.keys(prices.models).find((k) => id.startsWith(k) && snapshotSuffix.test(id.slice(k.length)));
}
/** A bare model id an engine or server reports ("claude-sonnet-5-5-20260901"), looked up per provider. */
function sameModelPriceKey(prices, model) {
    if (!model)
        return undefined;
    const direct = priceKeyFor(prices, model);
    if (direct)
        return direct;
    for (const provider of ['anthropic', 'openai', 'google', 'xai']) {
        const hit = priceKeyFor(prices, `${provider}:${model}`);
        if (hit)
            return hit;
    }
    return undefined;
}
exports.referenceKeyPattern = /^(local|free-remote|server|engine:[a-z0-9-]{2,40})$/;
function validReferences(input, prices) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw Error('INVALID_USAGE_REFERENCES');
    const entries = Object.entries(input);
    if (entries.length > 20)
        throw Error('INVALID_USAGE_REFERENCES');
    for (const [k, v] of entries)
        if (!exports.referenceKeyPattern.test(k) || (v !== null && (typeof v !== 'string' || !prices.models[v])))
            throw Error('INVALID_USAGE_REFERENCES');
    return Object.fromEntries(entries);
}
function referenceClass(target, engine) {
    if (target === 'engine')
        return engine ? `engine:${engine}` : null;
    if (target === 'local' || target === 'free-remote' || target === 'server')
        return target;
    return null;
}
/**
 * The API-equivalent figure of one model row. A paid API call is its own equivalent (what was
 * billed). Otherwise: the owner's reference for the class; when none was set, the engine's own
 * printed estimate, else the same model's table price. An owner's explicit "none" shows nothing.
 */
function modelEquivalent(row, engine, references, prices) {
    if (row.target === 'api' || (row.target === 'server' && (row.billedUsd ?? 0) > 0))
        return { usd: row.billedUsd, partial: row.partial, source: 'BILLED' };
    const cls = referenceClass(row.target, engine);
    const chosen = cls && Object.hasOwn(references, cls) ? references[cls] : undefined;
    if (chosen === null)
        return { usd: null, partial: false, source: 'NONE' };
    const priced = (key, source) => {
        const e = apiEquivalentUsd(prices.models[key], row);
        return e
            ? { usd: e.usd, partial: e.partial || row.partial, source, reference: key }
            : { usd: null, partial: false, source: 'NONE' };
    };
    if (chosen && prices.models[chosen])
        return priced(chosen, 'REFERENCE');
    if (row.reportedUsd !== null)
        return { usd: row.reportedUsd, partial: row.partial, source: 'ENGINE_REPORTED' };
    const same = sameModelPriceKey(prices, row.model);
    return same ? priced(same, 'SAME_MODEL') : { usd: null, partial: false, source: 'NONE' };
}
/**
 * Lines added and removed between two texts, counted the way the review screen's line comparison
 * (web/core/line-diff.js) counts them: terminators kept, common prefix and suffix skipped, an LCS in
 * between, and every line replaced when the table would be too large.
 */
const lineSplit = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const maxCells = 250000;
function lineChanges(before, after) {
    const a = lineSplit(before ?? ''), b = lineSplit(after ?? '');
    let start = 0, end = 0;
    while (start < a.length && start < b.length && a[start] === b[start])
        start++;
    while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end])
        end++;
    const x = a.slice(start, a.length - end), y = b.slice(start, b.length - end);
    if ((x.length + 1) * (y.length + 1) > maxCells)
        return { added: y.length, removed: x.length };
    const width = y.length + 1, table = new Uint32Array((x.length + 1) * width);
    for (let i = x.length - 1; i >= 0; i--)
        for (let j = y.length - 1; j >= 0; j--)
            table[i * width + j] =
                x[i] === y[j]
                    ? table[(i + 1) * width + j + 1] + 1
                    : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    const common = table[0];
    return { added: y.length - common, removed: x.length - common };
}
//# sourceMappingURL=run-usage.js.map