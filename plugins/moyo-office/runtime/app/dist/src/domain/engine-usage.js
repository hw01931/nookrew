"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseClaudeCodeUsage = parseClaudeCodeUsage;
exports.parseCodexUsage = parseCodexUsage;
exports.parseEngineUsage = parseEngineUsage;
const obj = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
const sum = (...values) => values.every((v) => v === undefined) ? undefined : values.reduce((s, v) => s + (v ?? 0), 0);
/** Drops absent fields so `undefined` means unknown to the merge in run-usage. */
const clean = (r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));
/** JSON values in the output: the whole text, else one per line (JSONL, or a log with a final line). */
function jsonValues(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return [];
    try {
        const whole = JSON.parse(trimmed);
        return Array.isArray(whole) ? whole : [whole];
    }
    catch {
        // Not one document; read it line by line below.
    }
    const out = [];
    for (const line of trimmed.split(/\r?\n/)) {
        const l = line.trim();
        if (!l.startsWith('{') && !l.startsWith('['))
            continue;
        try {
            const v = JSON.parse(l);
            out.push(...(Array.isArray(v) ? v : [v]));
        }
        catch {
            // A plain log line that starts with a brace.
        }
    }
    return out;
}
/**
 * Claude Code `-p --output-format json`: a final `{"type":"result", ...}` object with `usage`
 * (Anthropic API names: input_tokens excludes cache reads and writes), `total_cost_usd` (the tool's
 * own estimate, not a bill under a subscription), `duration_api_ms` and per-model `modelUsage`.
 */
function parseClaudeCodeUsage(stdout, fallbackModel = '') {
    const result = jsonValues(stdout)
        .map(obj)
        .filter((v) => !!v && v.type === 'result')
        .at(-1);
    if (!result)
        return null;
    const perModel = obj(result.modelUsage);
    const models = [];
    if (perModel && Object.keys(perModel).length) {
        for (const [model, raw] of Object.entries(perModel)) {
            const m = obj(raw);
            if (!m)
                continue;
            const read = num(m.cacheReadInputTokens), write = num(m.cacheCreationInputTokens);
            models.push(clean({
                target: 'engine',
                model,
                input: sum(num(m.inputTokens), read, write),
                output: num(m.outputTokens),
                cacheRead: read,
                cacheWrite: write,
                webSearches: num(m.webSearchRequests),
                reportedUsd: num(m.costUSD),
            }));
        }
    }
    else {
        const u = obj(result.usage);
        if (u) {
            const read = num(u.cache_read_input_tokens), write = num(u.cache_creation_input_tokens);
            models.push(clean({
                target: 'engine',
                model: fallbackModel,
                input: sum(num(u.input_tokens), read, write),
                output: num(u.output_tokens),
                cacheRead: read,
                cacheWrite: write,
                webSearches: num(obj(u.server_tool_use)?.web_search_requests),
                reportedUsd: num(result.total_cost_usd),
            }));
        }
    }
    if (!models.length)
        return null;
    return { models, apiMs: num(result.duration_api_ms) ?? null, limits: [] };
}
/**
 * Codex `exec --json`: JSON Lines events. Token counts come from `turn.completed` events' `usage`
 * (OpenAI names: input_tokens includes cached_input_tokens), or from older `token_count` events'
 * `info.total_token_usage`. Web searches are `web_search` items. Subscription windows come from a
 * `rate_limits` object (`primary`/`secondary` with `used_percent`, `window_minutes` and `resets_at`
 * in epoch seconds or `resets_in_seconds`), wherever an event carries one.
 */
function parseCodexUsage(stdout, model = '', observedAt = new Date()) {
    let input, cached, output, searches = 0, found = false, totals, rateLimits;
    for (const raw of jsonValues(stdout)) {
        const event = obj(raw);
        if (!event)
            continue;
        const msg = obj(event.msg) ?? event;
        if (event.type === 'turn.completed' && obj(event.usage)) {
            const u = obj(event.usage);
            input = sum(input, num(u.input_tokens));
            cached = sum(cached, num(u.cached_input_tokens));
            output = sum(output, num(u.output_tokens));
            found = true;
        }
        if (msg.type === 'token_count') {
            const t = obj(obj(msg.info)?.total_token_usage);
            if (t)
                totals = t;
        }
        const item = obj(event.item);
        if (event.type === 'item.completed' && item?.type === 'web_search')
            searches++;
        const limits = obj(msg.rate_limits) ?? obj(event.rate_limits);
        if (limits)
            rateLimits = limits;
    }
    if (!found && totals) {
        input = num(totals.input_tokens);
        cached = num(totals.cached_input_tokens);
        output = num(totals.output_tokens);
        found = input !== undefined || output !== undefined;
    }
    const limits = rateLimits ? codexWindows(rateLimits, observedAt) : [];
    if (!found && !limits.length)
        return null;
    return {
        models: found
            ? [
                clean({
                    target: 'engine',
                    model,
                    input,
                    output,
                    cacheRead: cached,
                    // Codex reports no cache writes and the web_search items only when it searched.
                    webSearches: searches,
                }),
            ]
            : [],
        apiMs: null,
        limits,
    };
}
function codexWindows(limits, observedAt) {
    const out = [];
    for (const id of ['primary', 'secondary']) {
        const w = obj(limits[id]);
        const used = num(w?.used_percent);
        if (!w || used === undefined)
            continue;
        const at = num(w.resets_at), inSeconds = num(w.resets_in_seconds);
        out.push({
            id,
            usedPercent: Math.min(100, used),
            windowMinutes: num(w.window_minutes) ?? null,
            resetsAt: at !== undefined
                ? new Date(at * 1000).toISOString()
                : inSeconds !== undefined
                    ? new Date(observedAt.getTime() + inSeconds * 1000).toISOString()
                    : null,
        });
    }
    return out;
}
/** The parser for an engine template; generic engines have no machine-readable output. */
function parseEngineUsage(template, stdout, model = '', observedAt = new Date()) {
    try {
        if (template === 'claude-code')
            return parseClaudeCodeUsage(stdout, model);
        if (template === 'codex-exec')
            return parseCodexUsage(stdout, model, observedAt);
    }
    catch {
        // Unreadable output: usage stays unknown.
    }
    return null;
}
//# sourceMappingURL=engine-usage.js.map