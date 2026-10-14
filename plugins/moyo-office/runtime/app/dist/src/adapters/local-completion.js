"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replySchema = void 0;
exports.compactLocalMessages = compactLocalMessages;
exports.completeLocalRequest = completeLocalRequest;
const loopback_js_1 = require("../infrastructure/loopback.js");
const hash_js_1 = require("../infrastructure/hash.js");
function compactLocalMessages(messages) {
    const copy = messages.map((m) => ({ ...m }));
    let changed = false;
    try {
        const context = JSON.parse(copy[1]?.content ?? '');
        if (!context ||
            typeof context.request !== 'string' ||
            !Array.isArray(context.records) ||
            !Array.isArray(context.history))
            return { messages: copy, changed };
        for (const record of context.records)
            if (typeof record.excerpt === 'string' && record.excerpt.length > 160) {
                record.excerpt = record.excerpt.slice(0, 160);
                record.truncated = true;
                changed = true;
            }
        for (const row of context.history)
            if (typeof row.text === 'string' && row.text.length > 80) {
                row.text = row.text.slice(0, 80);
                row.truncated = true;
                changed = true;
            }
        if (changed)
            copy[1].content = JSON.stringify(context);
    }
    catch {
        /* Free-form callers retain their exact input. */
    }
    return { messages: copy, changed };
}
/**
 * Every employee reply is one {text, tools} object. llama.cpp turns this schema into a grammar, so
 * the local model cannot emit prose around it or an unbalanced bracket (a dropped closer discards
 * the whole reply). Tool inputs stay free-form objects; their handlers validate them.
 */
exports.replySchema = {
    type: 'object',
    properties: {
        text: { type: 'string' },
        tools: {
            type: 'array',
            items: {
                type: 'object',
                properties: { name: { type: 'string' }, input: { type: 'object' } },
                required: ['name', 'input'],
            },
        },
    },
    required: ['text', 'tools'],
};
/** llama.cpp's template/tokenizer endpoints count the actual local model prompt before inference. */
async function completeLocalRequest(config, credential, messages, signal, request = fetch) {
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + credential }, abort = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]);
    const post = async (path, body) => request(`http://${loopback_js_1.loopback.label}:${config.port}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: abort,
    });
    const count = async (input) => {
        const rendered = await post('/apply-template', {
            messages: input,
            chat_template_kwargs: { enable_thinking: false },
        });
        if (!rendered.ok)
            throw Error('LOCAL_MODEL_TEMPLATE_UNAVAILABLE');
        const template = (await rendered.json());
        if (typeof template.prompt !== 'string')
            throw Error('LOCAL_MODEL_TEMPLATE_UNAVAILABLE');
        const tokenized = await post('/tokenize', { content: template.prompt, add_special: true });
        if (!tokenized.ok)
            throw Error('LOCAL_MODEL_TOKENIZER_UNAVAILABLE');
        const counted = (await tokenized.json());
        if (!Array.isArray(counted.tokens) || counted.tokens.some((t) => !Number.isSafeInteger(t)))
            throw Error('LOCAL_MODEL_TOKENIZER_UNAVAILABLE');
        return counted.tokens.length;
    };
    let prepared = messages, promptTokens = await count(prepared), compacted = false;
    if (promptTokens + config.maxOutputTokens + 32 > config.contextTokens) {
        const next = compactLocalMessages(messages);
        if (next.changed) {
            prepared = next.messages;
            compacted = true;
            promptTokens = await count(prepared);
        }
    }
    const outputLimit = Math.min(config.maxOutputTokens, config.contextTokens - promptTokens - 32);
    if (outputLimit < 128)
        throw Error('LOCAL_MODEL_CONTEXT_LIMIT');
    const response = await post('/v1/chat/completions', {
        model: config.modelId,
        messages: prepared,
        max_tokens: outputLimit,
        temperature: 0.2,
        chat_template_kwargs: { enable_thinking: false },
        response_format: { type: 'json_schema', json_schema: { name: 'employee_reply', schema: exports.replySchema } },
    });
    if (!response.ok) {
        if (response.status === 401 || response.status === 403)
            throw Error('LOCAL_MODEL_AUTH_FAILED');
        if (response.status === 429)
            throw Error('LOCAL_MODEL_RATE_LIMIT');
        throw Error('LOCAL_MODEL_RESPONSE_FAILED');
    }
    const data = (await response.json());
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim())
        throw Error('EMPTY_MODEL_RESPONSE');
    const usage = data.usage?.total_tokens;
    const counted = (n) => (Number.isSafeInteger(n) && Number(n) >= 0 ? Number(n) : undefined);
    const input = counted(data.usage?.prompt_tokens), output = counted(data.usage?.completion_tokens);
    return {
        content,
        tokens: Number.isSafeInteger(usage) && Number(usage) >= 0 ? Number(usage) : config.contextTokens,
        finishReason: data.choices?.[0]?.finish_reason,
        // llama-server's own counts when it sends them (ADR 0070); a local model bills nothing.
        report: {
            target: 'local',
            model: config.modelId,
            ...(input !== undefined ? { input } : {}),
            ...(output !== undefined ? { output } : {}),
            billedUsd: 0,
        },
        context: {
            promptTokens,
            outputLimit,
            contextTokens: config.contextTokens,
            compacted,
            requestHash: (0, hash_js_1.hash)(prepared),
        },
    };
}
//# sourceMappingURL=local-completion.js.map