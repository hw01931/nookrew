"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiModelAdapter = exports.searchResultTokens = exports.uncappedSearchReserve = exports.maxSearches = exports.promptTokenBound = exports.apiReplySchema = void 0;
exports.toAppReply = toAppReply;
exports.buildRequest = buildRequest;
exports.callEstimate = callEstimate;
exports.parseResponse = parseResponse;
exports.listProviderModels = listProviderModels;
exports.syncApiProfiles = syncApiProfiles;
const api_model_settings_js_1 = require("../infrastructure/api-model-settings.js");
const abortable_sleep_js_1 = require("./abortable-sleep.js");
const api_budget_js_1 = require("../domain/api-budget.js");
const paid_ledger_js_1 = require("./paid-ledger.js");
/**
 * Paid API models as an employee engine (ADR 0051): OpenAI and xAI (Responses API), Anthropic
 * (Messages) and Google (Gemini generateContent). Request shapes follow the providers' docs as read
 * on 2026-10-07. Every call passes the spending check first, reserves its worst case on the ledger
 * before sending, and is settled from the provider's own usage numbers afterwards (UNKNOWN at worst
 * case when no readable answer comes back). Keys come from the credential store and are only placed
 * in headers.
 *
 * Replies are forced to a JSON schema. Strict schemas cannot describe a free-form object, so the
 * tool input travels as a JSON string and is turned back into the usual {text, tools} reply here.
 */
exports.apiReplySchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        text: { type: 'string' },
        tools: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: { name: { type: 'string' }, input_json: { type: 'string' } },
                required: ['name', 'input_json'],
            },
        },
    },
    required: ['text', 'tools'],
};
const schemaNote = '\n\n응답 형식: {"text": 말, "tools": [{"name": 도구 이름, "input_json": 도구 입력 객체를 JSON 문자열로}]}';
/** Back to the app's reply contract: tools[].input as an object. */
function toAppReply(raw) {
    try {
        const v = JSON.parse(raw);
        if (typeof v.text !== 'string' || !Array.isArray(v.tools))
            return raw;
        return JSON.stringify({
            text: v.text,
            tools: v.tools.map((t) => ({
                name: t.name,
                input: typeof t.input_json === 'string' && t.input_json.trim() ? JSON.parse(t.input_json) : {},
            })),
        });
    }
    catch {
        // Left as is: the caller's reply parser rejects it and records why.
        return raw;
    }
}
const split = (messages) => ({
    system: messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n'),
    turns: messages.filter((m) => m.role !== 'system'),
});
/**
 * Token bound for the spending check. Hangul and other non-ASCII characters often take a whole token
 * each, so they count as 1; ASCII text runs near 4 characters per token, counted as 2 to stay above it.
 */
const textTokenBound = (text) => {
    let ascii = 0, other = 0;
    for (const ch of text)
        if (ch.charCodeAt(0) < 128)
            ascii++;
        else
            other++;
    return Math.ceil(ascii / 2) + other;
};
/** Fixed text every request carries besides the messages: the reply format note and JSON schema. */
const fixedPromptTokens = textTokenBound(schemaNote + JSON.stringify(exports.apiReplySchema));
const promptTokenBound = (messages) => messages.reduce((n, m) => n + textTokenBound(m.content) + 8, 0) + fixedPromptTokens + 64;
exports.promptTokenBound = promptTokenBound;
const geminiLevels = { minimal: 'LOW', low: 'LOW', medium: 'MEDIUM', high: 'HIGH' };
/** Provider request for one call. Pure, so the shapes are tested without a network. */
function buildRequest(m, key, messages) {
    const { system, turns } = split(messages);
    const instructions = system + schemaNote;
    const o = m.options;
    if (m.provider === 'openai' || m.provider === 'xai') {
        return {
            url: (m.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.x.ai/v1') + '/responses',
            headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: {
                model: m.model,
                instructions,
                input: turns.map((t) => ({ role: t.role === 'assistant' ? 'assistant' : 'user', content: t.content })),
                max_output_tokens: o.maxOutputTokens,
                store: false,
                text: { format: { type: 'json_schema', name: 'employee_reply', schema: exports.apiReplySchema, strict: true } },
                ...(o.effort ? { reasoning: { effort: o.effort === 'minimal' ? 'low' : o.effort } } : {}),
                ...(o.webSearch
                    ? {
                        tools: [{ type: 'web_search' }],
                        // OpenAI caps built-in tool calls per response with max_tool_calls. xAI's Responses API
                        // takes max_turns instead (docs.x.ai, read 2026-10-07); with parallel tool calls off a
                        // turn carries one search, so the turn cap is also the search cap.
                        ...(m.provider === 'openai'
                            ? { max_tool_calls: exports.maxSearches }
                            : { max_turns: exports.maxSearches, parallel_tool_calls: false }),
                    }
                    : {}),
            },
        };
    }
    if (m.provider === 'anthropic') {
        return {
            url: 'https://api.anthropic.com/v1/messages',
            headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
            body: {
                model: m.model,
                max_tokens: o.maxOutputTokens,
                // The stable part of every prompt is marked for prompt caching (cheaper repeated input).
                system: [{ type: 'text', text: instructions, cache_control: { type: 'ephemeral' } }],
                messages: turns.map((t) => ({
                    role: t.role === 'assistant' ? 'assistant' : 'user',
                    content: t.content,
                })),
                output_config: {
                    format: { type: 'json_schema', schema: exports.apiReplySchema },
                    ...(o.effort ? { effort: o.effort === 'minimal' ? 'low' : o.effort } : {}),
                },
                ...(o.webSearch
                    ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: exports.maxSearches }] }
                    : {}),
            },
        };
    }
    return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m.model)}:generateContent`,
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: {
            systemInstruction: { parts: [{ text: instructions }] },
            contents: turns.map((t) => ({
                role: t.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: t.content }],
            })),
            generationConfig: {
                maxOutputTokens: o.maxOutputTokens,
                responseMimeType: 'application/json',
                responseJsonSchema: exports.apiReplySchema,
                ...(o.effort ? { thinkingConfig: { thinkingLevel: geminiLevels[o.effort] } } : {}),
            },
            ...(o.webSearch ? { tools: [{ google_search: {} }] } : {}),
        },
    };
}
/** Searches one call may make; sent as the provider's cap where it has one. */
exports.maxSearches = 5;
/**
 * Gemini's google_search tool has no parameter that caps searches per call (generateContent, read
 * 2026-10-07), and Gemini bills each query it runs. This is an assumed ceiling for the reservation,
 * not a guarantee; a call that runs more is still recorded at its real count afterwards.
 */
exports.uncappedSearchReserve = 10;
/**
 * Input tokens reserved per search for the results the provider feeds back into the prompt. An
 * allowance from typical result sizes, not a provider-stated bound.
 */
exports.searchResultTokens = 10000;
/** The worst case the spending check reserves for one call of this model. */
function callEstimate(m, messages) {
    const searches = !m.options.webSearch ? 0 : m.provider === 'google' ? exports.uncappedSearchReserve : exports.maxSearches;
    return {
        provider: m.provider,
        promptTokens: (0, exports.promptTokenBound)(messages) + searches * exports.searchResultTokens,
        maxOutputTokens: m.options.maxOutputTokens,
        maxSearches: searches,
    };
}
/** Text and usage from a provider response. */
function parseResponse(provider, r) {
    const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    if (provider === 'openai' || provider === 'xai') {
        const text = (r.output ?? [])
            .filter((o) => o.type === 'message')
            .flatMap((o) => o.content ?? [])
            .filter((c) => c.type === 'output_text')
            .map((c) => c.text)
            .join('');
        return {
            text,
            finish: r.status === 'incomplete' ? 'length' : 'stop',
            usage: {
                input: n(r.usage?.input_tokens),
                output: n(r.usage?.output_tokens),
                cached: n(r.usage?.input_tokens_details?.cached_tokens),
                searches: (r.output ?? []).filter((o) => o.type === 'web_search_call').length,
            },
        };
    }
    if (provider === 'anthropic') {
        const text = (r.content ?? [])
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('');
        const read = n(r.usage?.cache_read_input_tokens), written = n(r.usage?.cache_creation_input_tokens);
        return {
            text,
            finish: r.stop_reason === 'max_tokens' ? 'length' : 'stop',
            usage: {
                // Anthropic reports uncached, cache-read and cache-write input separately.
                input: n(r.usage?.input_tokens) + read + written,
                output: n(r.usage?.output_tokens),
                cached: read,
                cacheWrite: written,
                searches: n(r.usage?.server_tool_use?.web_search_requests),
            },
        };
    }
    const candidate = r.candidates?.[0] ?? {};
    const text = (candidate.content?.parts ?? [])
        .filter((p) => !p.thought && typeof p.text === 'string')
        .map((p) => p.text)
        .join('');
    return {
        text,
        finish: candidate.finishReason === 'MAX_TOKENS' ? 'length' : 'stop',
        usage: {
            input: n(r.usageMetadata?.promptTokenCount) + n(r.usageMetadata?.toolUsePromptTokenCount),
            output: n(r.usageMetadata?.candidatesTokenCount) + n(r.usageMetadata?.thoughtsTokenCount),
            cached: n(r.usageMetadata?.cachedContentTokenCount),
            searches: (candidate.groundingMetadata?.webSearchQueries ?? []).length,
        },
    };
}
const retryable = (status) => status === 429 || status === 500 || status === 503 || status === 529;
class ApiModelAdapter {
    settings;
    credentials;
    request;
    constructor(settings, credentials, request = fetch) {
        this.settings = settings;
        this.credentials = credentials;
        this.request = request;
    }
    status() {
        return 'READY';
    }
    close() { }
    async complete(messages, signal, modelId = '', meta = {}) {
        const data = this.settings.read();
        const stored = data.models.find((m) => m.id === modelId);
        if (!stored || !stored.enabled)
            throw Error('MODEL_UNAVAILABLE');
        // A run's effort (ADR 0063) replaces the model's default effort for this call only.
        const effort = api_model_settings_js_1.effortLevels.includes(meta.effort) ? meta.effort : undefined;
        const model = effort ? { ...stored, options: { ...stored.options, effort } } : stored;
        const key = await this.credentials.get(model.provider);
        // Before the side effect: price known, worst case within every cap (code, not the model, decides).
        const paid = (0, paid_ledger_js_1.reservePaidCall)(this.settings, model.price, { ...callEstimate(model, messages), model: model.model }, {
            ...(meta.kind ? { kind: meta.kind } : {}),
            ...(effort ? { effort } : {}),
            ...(meta.run ? { run: meta.run } : {}),
        });
        const call = buildRequest(model, key, messages);
        let response;
        let parsed;
        // True while the provider may be running (and billing) a request whose answer has not been read.
        let inFlight = false;
        try {
            for (let attempt = 0; attempt < 3; attempt++) {
                inFlight = true;
                response = await this.request(call.url, {
                    method: 'POST',
                    headers: call.headers,
                    body: JSON.stringify(call.body),
                    signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]),
                });
                if (response.ok || !retryable(response.status) || attempt === 2)
                    break;
                // An error status is the provider's answer that it did not run this attempt.
                inFlight = false;
                const after = Number(response.headers.get('retry-after'));
                // A spending-cap 429 from the provider has no retry-after and does not recover by waiting.
                if (response.status === 429 && !after)
                    break;
                await (0, abortable_sleep_js_1.sleep)(Math.min(after > 0 ? after * 1000 : 3000 * (attempt + 1), 30000), signal);
            }
            if (!response.ok) {
                inFlight = false;
                const status = response.status;
                throw Error(status === 401 || status === 403
                    ? 'API_KEY_REJECTED'
                    : status === 402
                        ? 'API_BILLING_REQUIRED'
                        : status === 429
                            ? 'API_RATE_LIMITED'
                            : status === 404
                                ? 'API_MODEL_NOT_FOUND'
                                : 'API_HTTP_' + status);
            }
            parsed = parseResponse(model.provider, (await response.json()));
        }
        catch (e) {
            paid.fail(inFlight, e);
            throw e;
        }
        const costUsd = paid.settle(parsed.usage);
        return {
            content: toAppReply(parsed.text),
            tokens: parsed.usage.input + parsed.usage.output,
            // The provider's own counts; fields its format does not carry stay unknown (ADR 0070).
            report: {
                target: 'api',
                model: modelId,
                input: parsed.usage.input,
                output: parsed.usage.output,
                ...(parsed.usage.cached !== undefined ? { cacheRead: parsed.usage.cached } : {}),
                ...(parsed.usage.cacheWrite !== undefined ? { cacheWrite: parsed.usage.cacheWrite } : {}),
                ...(parsed.usage.searches !== undefined ? { webSearches: parsed.usage.searches } : {}),
                billedUsd: costUsd,
            },
            ...(parsed.finish ? { finishReason: parsed.finish } : {}),
            context: {
                promptTokens: parsed.usage.input,
                outputLimit: model.options.maxOutputTokens,
                contextTokens: model.options.contextTokens,
            },
        };
    }
}
exports.ApiModelAdapter = ApiModelAdapter;
/** Model ids a key can use, from the provider's list endpoint (free). */
async function listProviderModels(provider, key, request = fetch) {
    const get = async (url, headers) => {
        const r = await request(url, { headers, signal: AbortSignal.timeout(20000) });
        if (!r.ok)
            throw Error(r.status === 401 || r.status === 403 ? 'API_KEY_REJECTED' : 'API_HTTP_' + r.status);
        return (await r.json());
    };
    if (provider === 'anthropic') {
        const r = await get('https://api.anthropic.com/v1/models?limit=1000', {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
        });
        return (r.data ?? []).map((m) => ({ model: m.id, label: m.display_name || m.id }));
    }
    if (provider === 'google') {
        const out = [];
        let token = '';
        for (let page = 0; page < 10; page++) {
            const r = await get(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${token ? '&pageToken=' + encodeURIComponent(token) : ''}`, { 'x-goog-api-key': key });
            for (const m of r.models ?? [])
                if ((m.supportedGenerationMethods ?? []).includes('generateContent'))
                    out.push({ model: String(m.name).replace(/^models\//, ''), label: m.displayName || m.name });
            token = r.nextPageToken ?? '';
            if (!token)
                break;
        }
        return out;
    }
    const r = await get((provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.x.ai/v1') + '/models', {
        Authorization: 'Bearer ' + key,
    });
    return (r.data ?? []).map((m) => ({ model: m.id, label: m.id }));
}
/**
 * Enabled API models become employee model profiles, in place (projects share config.models).
 * Models whose provider has no key or that have no valid price are left out (the adapter would refuse
 * them with API_PRICE_REQUIRED), so employees are only offered what can run.
 */
function syncApiProfiles(config, settings, credentials) {
    const models = (config.models ??= [config.runtime]);
    let data;
    try {
        data = settings.read();
    }
    catch {
        return;
    }
    const keys = credentials.status();
    const wanted = data.models.filter((m) => m.enabled && (0, api_budget_js_1.validPrice)(m.price) && keys[m.provider]?.set);
    for (let i = models.length - 1; i >= 0; i--)
        if (models[i].provider === 'api' && !wanted.some((m) => m.id === models[i].modelId))
            models.splice(i, 1);
    for (const m of wanted) {
        const profile = {
            executable: '',
            modelFile: '',
            modelId: m.id,
            port: 0,
            contextTokens: m.options.contextTokens,
            maxOutputTokens: m.options.maxOutputTokens,
            gpuLayers: 0,
            timeoutMs: 300000,
            provider: 'api',
            label: m.label,
        };
        const at = models.findIndex((p) => p.modelId === m.id);
        if (at >= 0)
            models[at] = profile;
        else
            models.push(profile);
    }
}
//# sourceMappingURL=api-model.js.map