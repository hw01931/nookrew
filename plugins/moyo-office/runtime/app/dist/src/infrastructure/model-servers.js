"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelServerSettings = exports.defaultServerOptions = exports.serverCredential = exports.serverModelId = exports.replyFormats = void 0;
exports.validServerModel = validServerModel;
exports.serverSlug = serverSlug;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const api_budget_js_1 = require("../domain/api-budget.js");
const model_server_js_1 = require("../domain/model-server.js");
const json_file_js_1 = require("./json-file.js");
/**
 * The owner's OpenAI-compatible model servers and the models from them employees may use (ADR 0064).
 * No secrets live here: a server's key is in the credential store under "server:<id>". Shared by
 * every project of this app, next to the paid API settings.
 */
/** How the reply is forced into the app's JSON shape; servers differ in what they accept. */
exports.replyFormats = ['schema', 'object', 'none'];
const serverModelId = (serverId, model) => `server:${serverId}:${model}`;
exports.serverModelId = serverModelId;
const serverCredential = (serverId) => `server:${serverId}`;
exports.serverCredential = serverCredential;
const defaultServerOptions = () => ({
    maxOutputTokens: 4096,
    contextTokens: 32768,
    timeoutMs: 300000,
    replyFormat: 'schema',
});
exports.defaultServerOptions = defaultServerOptions;
function validServer(s) {
    const v = s;
    if (!v || typeof v.id !== 'string' || !model_server_js_1.serverIdPattern.test(v.id))
        return false;
    if (typeof v.label !== 'string' || !v.label.trim() || v.label.length > 80)
        return false;
    if (v.free !== undefined && typeof v.free !== 'boolean')
        return false;
    if (v.keyed !== undefined && typeof v.keyed !== 'boolean')
        return false;
    try {
        return (0, model_server_js_1.parseServerUrl)(v.baseUrl) === v.baseUrl;
    }
    catch {
        return false;
    }
}
function validServerModel(m) {
    const v = m;
    const o = v?.options;
    return (!!v &&
        typeof v.serverId === 'string' &&
        typeof v.model === 'string' &&
        model_server_js_1.serverModelPattern.test(v.model) &&
        v.id === (0, exports.serverModelId)(v.serverId, v.model) &&
        typeof v.label === 'string' &&
        !!v.label.trim() &&
        v.label.length <= 120 &&
        typeof v.enabled === 'boolean' &&
        (v.price === undefined || (0, api_budget_js_1.validPrice)(v.price)) &&
        !!o &&
        Number.isInteger(o.maxOutputTokens) &&
        o.maxOutputTokens >= 64 &&
        o.maxOutputTokens <= 200000 &&
        Number.isInteger(o.contextTokens) &&
        o.contextTokens >= 2048 &&
        o.contextTokens <= 2000000 &&
        o.maxOutputTokens < o.contextTokens &&
        Number.isInteger(o.timeoutMs) &&
        o.timeoutMs >= 1000 &&
        o.timeoutMs <= 1800000 &&
        exports.replyFormats.includes(o.replyFormat));
}
/** A short id from the label, unique among the given ids: "ollama", "ollama-2". */
function serverSlug(label, taken) {
    const stem = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 30) || 'server';
    let id = stem;
    for (let n = 2; taken.includes(id); n++)
        id = `${stem}-${n}`;
    return id;
}
class ModelServerSettings {
    file;
    constructor(directory) {
        this.file = (0, node_path_1.resolve)(directory, 'model-servers.json');
    }
    read() {
        if (!(0, node_fs_1.existsSync)(this.file))
            return { schemaVersion: 1, servers: [], models: [] };
        const data = JSON.parse((0, node_fs_1.readFileSync)(this.file, 'utf8'));
        if (data.schemaVersion !== 1 || !Array.isArray(data.servers) || !Array.isArray(data.models))
            throw Error('INVALID_SERVER_SETTINGS');
        const servers = data.servers.filter(validServer);
        return {
            schemaVersion: 1,
            servers,
            models: data.models.filter((m) => validServerModel(m) && servers.some((s) => s.id === m.serverId)),
        };
    }
    write(data) {
        (0, json_file_js_1.writeJsonFile)(this.file, data);
    }
    /** Adds a server (no id) or changes one. The address is normalized and checked here. */
    putServer(input) {
        const data = this.read();
        const baseUrl = (0, model_server_js_1.parseServerUrl)(input.baseUrl);
        const label = String(input.label ?? '').trim() || new URL(baseUrl).host;
        if (label.length > 80)
            throw Error('INVALID_SERVER');
        const existing = typeof input.id === 'string' && input.id ? data.servers.find((s) => s.id === input.id) : undefined;
        if (input.id && !existing)
            throw Error('SERVER_NOT_FOUND');
        const server = {
            id: existing?.id ??
                serverSlug(label, data.servers.map((s) => s.id)),
            label,
            baseUrl,
            ...(input.free === true ? { free: true } : {}),
            ...((input.keyed ?? existing?.keyed) === true ? { keyed: true } : {}),
        };
        if (!existing && data.servers.length >= 20)
            throw Error('SERVER_LIMIT');
        data.servers = [...data.servers.filter((s) => s.id !== server.id), server];
        this.write(data);
        return server;
    }
    setKeyed(id, keyed) {
        const data = this.read();
        const server = data.servers.find((s) => s.id === id);
        if (!server)
            throw Error('SERVER_NOT_FOUND');
        if (keyed)
            server.keyed = true;
        else
            delete server.keyed;
        this.write(data);
        return server;
    }
    /** Removes the server and every model taken from it. */
    removeServer(id) {
        const data = this.read();
        data.servers = data.servers.filter((s) => s.id !== id);
        data.models = data.models.filter((m) => m.serverId !== id);
        this.write(data);
        return { removed: true };
    }
    putModel(model) {
        if (!validServerModel(model))
            throw Error('INVALID_SERVER_MODEL');
        const data = this.read();
        if (!data.servers.some((s) => s.id === model.serverId))
            throw Error('SERVER_NOT_FOUND');
        const o = model.options;
        const clean = {
            id: model.id,
            serverId: model.serverId,
            model: model.model,
            label: model.label.trim(),
            enabled: model.enabled,
            ...(model.price ? { price: model.price } : {}),
            options: {
                maxOutputTokens: o.maxOutputTokens,
                contextTokens: o.contextTokens,
                timeoutMs: o.timeoutMs,
                replyFormat: o.replyFormat,
            },
        };
        data.models = [...data.models.filter((m) => m.id !== clean.id), clean];
        if (data.models.length > 200)
            throw Error('SERVER_MODEL_LIMIT');
        this.write(data);
        return clean;
    }
    removeModel(id) {
        const data = this.read();
        data.models = data.models.filter((m) => m.id !== id);
        this.write(data);
        return { removed: true };
    }
}
exports.ModelServerSettings = ModelServerSettings;
//# sourceMappingURL=model-servers.js.map