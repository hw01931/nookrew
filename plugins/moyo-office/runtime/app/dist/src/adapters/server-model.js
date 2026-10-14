"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerModelAdapter = exports.knownServers = void 0;
exports.parseModelList = parseModelList;
exports.listServerModels = listServerModels;
exports.detectServers = detectServers;
exports.buildServerRequest = buildServerRequest;
exports.serverModelState = serverModelState;
exports.syncServerProfiles = syncServerProfiles;
const model_servers_js_1 = require("../infrastructure/model-servers.js");
const model_server_js_1 = require("../domain/model-server.js");
const local_completion_js_1 = require("./local-completion.js");
const openrouter_model_js_1 = require("./openrouter-model.js");
const api_model_js_1 = require("./api-model.js");
const paid_ledger_js_1 = require("./paid-ledger.js");
const abortable_sleep_js_1 = require("./abortable-sleep.js");
/**
 * Model ids from a list answer. OpenAI shape {data: [{id}]} is what every listed server returns on
 * /v1/models; Ollama's own {models: [{name|model}]} is read too. Invalid or repeated ids are dropped.
 */
function parseModelList(body) {
    const b = body;
    const rows = Array.isArray(b?.data)
        ? b.data
        : Array.isArray(b?.models)
            ? b.models
            : undefined;
    if (!rows)
        throw Error('SERVER_BAD_MODEL_LIST');
    const seen = new Set();
    const out = [];
    for (const row of rows) {
        const r = row;
        const id = typeof r?.id === 'string' ? r.id : typeof r?.model === 'string' ? r.model : r?.name;
        if (typeof id !== 'string' || !model_server_js_1.serverModelPattern.test(id) || seen.has(id))
            continue;
        seen.add(id);
        const label = typeof r.name === 'string' && r.name !== id && r.name.length <= 120 ? r.name : id;
        out.push({ model: id, label });
        if (out.length >= 500)
            break;
    }
    return out;
}
const headers = (key) => ({
    'Content-Type': 'application/json',
    ...(key ? { Authorization: 'Bearer ' + key } : {}),
});
/**
 * A refusal status as a code (letters only, so the screen can explain it). 400/422 usually means the
 * server does not accept the forced reply format; the model's settings can loosen it.
 */
function httpCode(status, listing = false) {
    if (status === 401 || status === 403)
        return 'SERVER_KEY_REJECTED';
    if (status === 404)
        return listing ? 'SERVER_NO_MODEL_LIST' : 'SERVER_MODEL_NOT_FOUND';
    if (status === 400 || status === 422)
        return 'SERVER_REQUEST_REJECTED';
    if (status === 429)
        return 'SERVER_RATE_LIMITED';
    return 'SERVER_HTTP_ERROR';
}
/** Turns a network failure into a code; the caller's abort and the timeout keep their meaning. */
function networkError(e, signal, timeout) {
    if (signal.aborted)
        return e instanceof Error ? e : Error('ABORTED');
    if (timeout.aborted)
        return Error('SERVER_TIMEOUT');
    return Error('SERVER_UNREACHABLE');
}
/** What a server offers (free: a list request runs nothing). */
async function listServerModels(baseUrl, key, request = fetch, timeoutMs = 10000) {
    const base = (0, model_server_js_1.parseServerUrl)(baseUrl);
    (0, model_server_js_1.assertKeyTransport)(base, !!key);
    const never = new AbortController().signal;
    const timeout = AbortSignal.timeout(timeoutMs);
    let r;
    try {
        r = await request(base + '/models', { headers: headers(key), signal: timeout });
    }
    catch (e) {
        throw networkError(e, never, timeout);
    }
    if (!r.ok)
        throw Error(httpCode(r.status, true));
    let body;
    try {
        body = await r.json();
    }
    catch {
        throw Error('SERVER_BAD_MODEL_LIST');
    }
    return parseModelList(body);
}
/** Default addresses of common local servers. Only this PC is probed; nothing leaves it. */
exports.knownServers = [
    { name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
    { name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
    { name: 'vLLM', baseUrl: 'http://127.0.0.1:8000/v1' },
    { name: 'llama.cpp', baseUrl: 'http://127.0.0.1:8080/v1' },
];
/** Which candidates answer a model list right now. Non-loopback candidates are refused, not probed. */
async function detectServers(request = fetch, candidates = exports.knownServers) {
    const found = await Promise.all(candidates.map(async (c) => {
        if ((0, model_server_js_1.serverReach)(c.baseUrl) !== 'loopback')
            return undefined;
        try {
            const models = await listServerModels(c.baseUrl, undefined, request, 1500);
            return { name: c.name, baseUrl: (0, model_server_js_1.parseServerUrl)(c.baseUrl), models: models.length };
        }
        catch {
            // Nothing there, or something else answering on that port.
            return undefined;
        }
    }));
    return found.filter((f) => !!f);
}
/** The chat request for one call. Pure, so its shape is tested without a network. */
function buildServerRequest(model, messages) {
    const format = model.options.replyFormat;
    return {
        model: model.model,
        messages,
        max_tokens: model.options.maxOutputTokens,
        temperature: 0.2,
        stream: false,
        ...(format === 'schema'
            ? { response_format: { type: 'json_schema', json_schema: { name: 'employee_reply', schema: local_completion_js_1.replySchema } } }
            : format === 'object'
                ? { response_format: { type: 'json_object' } }
                : {}),
    };
}
const retryable = (status) => [429, 500, 502, 503, 504].includes(status);
const retryDelaysMs = [2000, 5000];
const count = (v) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined);
class ServerModelAdapter {
    settings;
    credentials;
    ledger;
    request;
    wait;
    constructor(settings, credentials, 
    /** Ledger and caps for priced remote servers; absent means priced servers cannot be called. */
    ledger, request = fetch, wait = abortable_sleep_js_1.sleep) {
        this.settings = settings;
        this.credentials = credentials;
        this.ledger = ledger;
        this.request = request;
        this.wait = wait;
    }
    status() {
        return 'READY';
    }
    close() { }
    async complete(messages, signal, modelId = '', meta = {}) {
        const data = this.settings.read();
        const model = data.models.find((m) => m.id === modelId);
        const server = data.servers.find((s) => s.id === model?.serverId);
        if (!model || !server || !model.enabled)
            throw Error('MODEL_UNAVAILABLE');
        // Before the side effect, from the stored address (code, not the model, decides).
        const base = (0, model_server_js_1.parseServerUrl)(server.baseUrl);
        const rule = (0, model_server_js_1.costRule)(server, model);
        if (rule.kind === 'undecided')
            throw Error('SERVER_PRICE_REQUIRED');
        (0, model_server_js_1.assertKeyTransport)(base, !!server.keyed);
        const key = server.keyed ? await this.credentials.get((0, model_servers_js_1.serverCredential)(server.id)) : undefined;
        signal.throwIfAborted();
        let paid;
        if (rule.kind === 'paid') {
            if (!this.ledger)
                throw Error('API_MODELS_UNAVAILABLE');
            paid = (0, paid_ledger_js_1.reservePaidCall)(this.ledger, rule.price, {
                provider: 'server:' + server.id,
                model: model.model,
                promptTokens: (0, api_model_js_1.promptTokenBound)(messages),
                maxOutputTokens: model.options.maxOutputTokens,
            }, 
            // Kind and run for the cost report (ADR 0063); a server model has no effort option.
            { ...(meta.kind ? { kind: meta.kind } : {}), ...(meta.run ? { run: meta.run } : {}) });
        }
        const timeout = AbortSignal.timeout(model.options.timeoutMs);
        const abort = AbortSignal.any([signal, timeout]);
        let inFlight = false;
        let body;
        try {
            let response;
            for (let attempt = 0;; attempt++) {
                inFlight = true;
                try {
                    response = await this.request(base + '/chat/completions', {
                        method: 'POST',
                        headers: headers(key),
                        body: JSON.stringify(buildServerRequest(model, messages)),
                        signal: abort,
                    });
                }
                catch (e) {
                    throw networkError(e, signal, timeout);
                }
                if (response.ok)
                    break;
                // An error status is the server's answer that it did not run this attempt.
                inFlight = false;
                // Error bodies may echo the request; only the status code leaves this function.
                if (!retryable(response.status) || attempt >= retryDelaysMs.length)
                    throw Error(httpCode(response.status));
                // The same model on the same server is retried; never a different one.
                const after = Number(response.headers.get('retry-after'));
                try {
                    await this.wait(after > 0 ? Math.min(after * 1000, 30000) : retryDelaysMs[attempt], abort);
                }
                catch (e) {
                    throw networkError(e, signal, timeout);
                }
            }
            try {
                body = (await response.json());
            }
            catch (e) {
                throw signal.aborted || timeout.aborted
                    ? networkError(e, signal, timeout)
                    : Error('SERVER_BAD_RESPONSE');
            }
        }
        catch (e) {
            paid?.fail(inFlight, e);
            throw e;
        }
        const choice = body.choices?.[0];
        const content = choice?.message?.content;
        const usage = {
            input: count(body.usage?.prompt_tokens),
            output: count(body.usage?.completion_tokens),
            cached: count(body.usage?.prompt_tokens_details?.cached_tokens),
        };
        // A free server bills nothing; a paid one bills what the ledger settled (unknown without counts).
        let billedUsd = paid ? undefined : 0;
        if (paid) {
            if (usage.input !== undefined && usage.output !== undefined)
                billedUsd = paid.settle({ input: usage.input, output: usage.output, cached: usage.cached ?? 0 });
            // A reply without token counts cannot be priced: its worst case stays on the ledger.
            else
                paid.fail(true, Error('SERVER_USAGE_MISSING'));
        }
        if (typeof content !== 'string' || !content.trim())
            throw Error('EMPTY_MODEL_RESPONSE');
        const promptTokens = usage.input ?? (0, api_model_js_1.promptTokenBound)(messages);
        const total = count(body.usage?.total_tokens) ?? promptTokens + (usage.output ?? Math.ceil(content.length / 2));
        return {
            content: (0, openrouter_model_js_1.unfence)(content),
            tokens: total,
            finishReason: choice.finish_reason === 'length' ? 'length' : (choice.finish_reason ?? 'stop'),
            // Only the counts the server returned (ADR 0070); estimates above are for the token budget.
            report: {
                target: 'server',
                model: model.model,
                ...(usage.input !== undefined ? { input: usage.input } : {}),
                ...(usage.output !== undefined ? { output: usage.output } : {}),
                ...(usage.cached !== undefined ? { cacheRead: usage.cached } : {}),
                ...(billedUsd !== undefined ? { billedUsd } : {}),
            },
            context: {
                promptTokens,
                outputLimit: model.options.maxOutputTokens,
                contextTokens: model.options.contextTokens,
            },
        };
    }
}
exports.ServerModelAdapter = ServerModelAdapter;
/** Whether a stored model may be offered to employees now; the reason when not. */
function serverModelState(server, model, keySet, paidAllowed) {
    const rule = (0, model_server_js_1.costRule)(server, model);
    if (rule.kind === 'undecided')
        return 'PRICE_REQUIRED';
    if (server.keyed && !keySet)
        return 'KEY_MISSING';
    try {
        (0, model_server_js_1.assertKeyTransport)(server.baseUrl, !!server.keyed);
    }
    catch {
        return 'KEY_NEEDS_HTTPS';
    }
    if (rule.kind === 'paid' && !paidAllowed)
        return 'PAID_UNAVAILABLE';
    return model.enabled ? 'READY' : 'OFF';
}
/**
 * Callable server models become employee model profiles, in place (projects share config.models).
 * Models that would be refused (no price decision, missing key) are left out, so employees are only
 * offered what can run.
 */
function syncServerProfiles(config, settings, credentials, paidAllowed) {
    const models = (config.models ??= [config.runtime]);
    let data;
    try {
        data = settings.read();
    }
    catch {
        return;
    }
    const wanted = data.models.filter((m) => {
        const server = data.servers.find((s) => s.id === m.serverId);
        let keySet = false;
        try {
            keySet = !server.keyed || credentials.entry((0, model_servers_js_1.serverCredential)(server.id)).set;
        }
        catch {
            keySet = false;
        }
        return serverModelState(server, m, keySet, paidAllowed) === 'READY';
    });
    for (let i = models.length - 1; i >= 0; i--)
        if (models[i].provider === 'server' && !wanted.some((m) => m.id === models[i].modelId))
            models.splice(i, 1);
    for (const m of wanted) {
        const profile = {
            executable: '',
            modelFile: '',
            modelId: (0, model_servers_js_1.serverModelId)(m.serverId, m.model),
            port: 0,
            contextTokens: m.options.contextTokens,
            maxOutputTokens: m.options.maxOutputTokens,
            gpuLayers: 0,
            timeoutMs: m.options.timeoutMs,
            provider: 'server',
            label: m.label,
        };
        const at = models.findIndex((p) => p.modelId === m.id);
        if (at >= 0)
            models[at] = profile;
        else
            models.push(profile);
    }
}
//# sourceMappingURL=server-model.js.map