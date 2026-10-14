"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenRouterModel = exports.defaultDailyRequestLimit = void 0;
exports.remoteUsage = remoteUsage;
exports.unfence = unfence;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const abortable_sleep_js_1 = require("./abortable-sleep.js");
/**
 * Free OpenRouter models as an employee engine (ADR 0043). Free-only is enforced by code on every
 * request: the catalog price must be zero, the request caps price at zero with fallbacks off, and a
 * reply that reports any cost is an error. The API key is read here and never logged or returned.
 */
const base = 'https://openrouter.ai/api/v1';
const catalogTtlMs = 5 * 60 * 1000;
const retryDelaysMs = [3000, 10000];
/** Free-tier accounts get a small daily request allowance; the account-wide count is kept locally. */
exports.defaultDailyRequestLimit = 50;
const ledgerPath = (root) => (0, node_path_1.resolve)(root, '.aiorchestra/remote-requests.log');
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const count = (n) => (Number.isSafeInteger(n) && Number(n) >= 0 ? Number(n) : undefined);
/**
 * Requests sent today (UTC, the provider's reset boundary) across every remote profile and process,
 * and when an exhausted allowance resets. Lines are appended, never rewritten, so concurrent
 * processes cannot lose each other's counts. The ledger holds no prompt or key.
 */
function remoteUsage(root, now = Date.now()) {
    const path = ledgerPath(root);
    let requests = 0, exhaustedUntil = 0;
    if ((0, node_fs_1.existsSync)(path))
        for (const line of (0, node_fs_1.readFileSync)(path, 'utf8').split('\n')) {
            try {
                const row = JSON.parse(line);
                if (row.exhaustedUntil)
                    exhaustedUntil = Math.max(exhaustedUntil, row.exhaustedUntil);
                else if (row.at && utcDay(Date.parse(row.at)) === utcDay(now))
                    requests++;
            }
            catch { }
        }
    return { day: utcDay(now), requests, exhaustedUntil: exhaustedUntil > now ? exhaustedUntil : 0 };
}
function record(root, row) {
    const path = ledgerPath(root);
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    (0, node_fs_1.appendFileSync)(path, JSON.stringify(row) + '\n');
}
/** Per adapter cache; prices are re-read at least every few minutes and capped at zero per request. */
async function freeModel(cache, id, request, signal) {
    let catalog = cache.catalog;
    if (!catalog || Date.now() - catalog.at > catalogTtlMs) {
        const r = await request(base + '/models', { signal });
        if (!r.ok)
            throw Error('REMOTE_CATALOG_UNAVAILABLE');
        const data = (await r.json()).data;
        catalog = cache.catalog = {
            at: Date.now(),
            models: new Map(data.map((m) => [m.id, { pricing: m.pricing ?? {}, params: m.supported_parameters ?? [] }])),
        };
    }
    const model = catalog.models.get(id);
    if (!model)
        throw Error('REMOTE_MODEL_UNAVAILABLE');
    if (!('prompt' in model.pricing) || !('completion' in model.pricing))
        throw Error('REMOTE_PRICE_MISSING');
    if (Object.values(model.pricing).some((v) => Number(v) !== 0))
        throw Error('REMOTE_NOT_FREE');
    return model;
}
/** Remote models often wrap the JSON reply in a ```json fence; the loop expects bare JSON. */
function unfence(text) {
    const t = text.trim();
    const m = t.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
    return m ? m[1] : t;
}
class OpenRouterModel {
    root;
    config;
    request;
    wait;
    now;
    cache = {};
    constructor(root, config, request = fetch, wait = abortable_sleep_js_1.sleep, now = Date.now) {
        this.root = root;
        this.config = config;
        this.request = request;
        this.wait = wait;
        this.now = now;
    }
    /** Refuses before sending when today's allowance is spent; the provider's own 429 still wins. */
    reserve() {
        const usage = remoteUsage(this.root, this.now());
        if (usage.exhaustedUntil || usage.requests >= (this.config.dailyRequestLimit ?? exports.defaultDailyRequestLimit))
            throw Error('REMOTE_DAILY_LIMIT');
        record(this.root, { at: new Date(this.now()).toISOString(), model: this.config.remoteModel });
    }
    key() {
        if (process.env.OPENROUTER_API_KEY)
            return process.env.OPENROUTER_API_KEY.trim();
        const path = (0, node_path_1.resolve)(this.root, this.config.credentialFile ?? '');
        if (!this.config.credentialFile || !(0, node_fs_1.existsSync)(path))
            throw Error('REMOTE_CREDENTIAL_MISSING');
        return (0, node_fs_1.readFileSync)(path, 'utf8').trim();
    }
    status() {
        return 'REMOTE';
    }
    close() { }
    async complete(messages, signal) {
        const c = this.config;
        const timeout = AbortSignal.any([signal, AbortSignal.timeout(c.timeoutMs)]);
        const model = await freeModel(this.cache, c.remoteModel, this.request, timeout);
        const body = {
            model: c.remoteModel,
            messages,
            temperature: 0,
            max_tokens: c.maxOutputTokens,
            stream: false,
            provider: {
                allow_fallbacks: false,
                data_collection: c.allowDataCollection ? 'allow' : 'deny',
                max_price: { prompt: 0, completion: 0, request: 0 },
            },
        };
        if (model.params.includes('response_format'))
            body.response_format = { type: 'json_object' };
        // Free endpoints drop requests briefly; the same model is retried, never a different one.
        let data = {};
        for (let attempt = 0;; attempt++) {
            this.reserve();
            const r = await this.request(base + '/chat/completions', {
                method: 'POST',
                signal: timeout,
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.key() },
                body: JSON.stringify(body),
            });
            // Error bodies may echo request details; only the status code leaves this function.
            let failure = '';
            if (r.status === 429) {
                // A reset far away means the daily allowance is spent: waiting seconds would not help.
                const reset = Number(r.headers.get('x-ratelimit-reset'));
                if (Number.isFinite(reset) && reset - this.now() > 60000) {
                    record(this.root, { exhaustedUntil: reset });
                    throw Error('REMOTE_DAILY_LIMIT');
                }
                failure = 'REMOTE_RATE_LIMITED';
            }
            else if (r.status === 404)
                throw Error('REMOTE_NO_ENDPOINT');
            else if (r.status >= 500)
                failure = 'REMOTE_HTTP_' + r.status;
            else if (!r.ok)
                throw Error('REMOTE_HTTP_' + r.status);
            else {
                data = (await r.json());
                // Only the provider's numeric code is kept; its message may echo request content.
                const code = data.error?.code;
                if (data.error || !data.choices?.length)
                    failure = Number.isInteger(code) ? 'REMOTE_PROVIDER_' + code : 'REMOTE_BAD_RESPONSE';
            }
            if (!failure)
                break;
            if (attempt >= retryDelaysMs.length)
                throw Error(failure);
            const after = Number(r.headers.get('retry-after'));
            await this.wait(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 30000) : retryDelaysMs[attempt], timeout);
        }
        if (data.usage?.cost !== undefined && Number(data.usage.cost) !== 0)
            throw Error('REMOTE_CHARGED');
        const choice = data.choices[0];
        return {
            content: unfence(choice.message?.content ?? ''),
            tokens: data.usage?.total_tokens ?? 0,
            finishReason: choice.finish_reason === 'length' ? 'length' : (choice.finish_reason ?? 'stop'),
            // The provider's counts when sent (ADR 0070); a free model bills nothing (checked above).
            report: {
                target: 'free-remote',
                model: c.modelId,
                ...(count(data.usage?.prompt_tokens) !== undefined ? { input: count(data.usage?.prompt_tokens) } : {}),
                ...(count(data.usage?.completion_tokens) !== undefined
                    ? { output: count(data.usage?.completion_tokens) }
                    : {}),
                billedUsd: 0,
            },
            context: {
                promptTokens: data.usage?.prompt_tokens ?? 0,
                outputLimit: c.maxOutputTokens,
                contextTokens: c.contextTokens,
            },
        };
    }
}
exports.OpenRouterModel = OpenRouterModel;
//# sourceMappingURL=openrouter-model.js.map