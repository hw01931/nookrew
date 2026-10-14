"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalModelRouter = exports.LocalModel = void 0;
exports.llamaServerArgs = llamaServerArgs;
exports.loadCollaborationConfig = loadCollaborationConfig;
const loopback_js_1 = require("../infrastructure/loopback.js");
const record_lifecycle_js_1 = require("../domain/record-lifecycle.js");
const workspace_engine_js_1 = require("./workspace-engine.js");
const openrouter_model_js_1 = require("./openrouter-model.js");
const local_completion_js_1 = require("./local-completion.js");
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const json_file_js_1 = require("../infrastructure/json-file.js");
const node_path_1 = require("node:path");
const promises_1 = require("node:timers/promises");
const node_crypto_1 = require("node:crypto");
const node_net_1 = require("node:net");
/** llama-server command line for one model profile. Kept pure so launch options are testable. */
function llamaServerArgs(root, c) {
    return [
        '-m',
        (0, node_path_1.resolve)(root, c.modelFile),
        '--host',
        loopback_js_1.loopback.address,
        '--port',
        String(c.port),
        '-c',
        String(c.contextTokens),
        '-ngl',
        String(c.gpuLayers),
        '-t',
        '8',
        '-b',
        '256',
        '-ub',
        '128',
        '-np',
        '1',
        '-fa',
        c.flashAttention ? 'on' : 'off',
        ...(c.kvCacheType ? ['-ctk', c.kvCacheType, '-ctv', c.kvCacheType] : []),
        ...(c.cpuMoeLayers ? ['--n-cpu-moe', String(c.cpuMoeLayers)] : []),
        '--fit',
        'off',
        '--reasoning',
        'off',
        '--no-webui',
    ];
}
function loadCollaborationConfig(root) {
    const config = (0, json_file_js_1.readJsonFile)((0, node_path_1.resolve)(root, 'config/collaboration.json'));
    if (config.schemaVersion !== 1 || !config.runtime || !Array.isArray(config.teams))
        throw Error('INVALID_COLLAB_CONFIG');
    (0, record_lifecycle_js_1.notePolicy)(config.memory);
    const profiles = config.models ?? [config.runtime];
    if (!Array.isArray(profiles) ||
        !profiles.length ||
        profiles.length > 8 ||
        new Set(profiles.map((p) => p.modelId)).size !== profiles.length ||
        !profiles.some((p) => p.modelId === config.runtime.modelId))
        throw Error('INVALID_COLLAB_CONFIG');
    for (const r of profiles) {
        if (r.provider === 'openrouter') {
            if (typeof r.modelId !== 'string' ||
                !r.modelId ||
                typeof r.remoteModel !== 'string' ||
                !/^[a-z0-9._-]+\/[a-z0-9._-]+:free$/i.test(r.remoteModel) ||
                typeof r.allowDataCollection !== 'boolean' ||
                typeof r.credentialFile !== 'string' ||
                !r.credentialFile.startsWith('secrets/') ||
                r.credentialFile.includes('..') ||
                !Number.isInteger(r.contextTokens) ||
                r.contextTokens < 2048 ||
                r.contextTokens > 262144 ||
                !Number.isInteger(r.maxOutputTokens) ||
                r.maxOutputTokens < 32 ||
                r.maxOutputTokens > 16384 ||
                r.maxOutputTokens >= r.contextTokens ||
                !Number.isInteger(r.timeoutMs) ||
                r.timeoutMs < 1000 ||
                r.timeoutMs > 600000 ||
                (r.dailyRequestLimit !== undefined &&
                    (!Number.isInteger(r.dailyRequestLimit) || r.dailyRequestLimit < 1 || r.dailyRequestLimit > 100000)))
                throw Error('INVALID_COLLAB_CONFIG');
            continue;
        }
        if (r.provider !== undefined && r.provider !== 'local')
            throw Error('INVALID_COLLAB_CONFIG');
        for (const name of ['executable', 'modelFile'])
            if (typeof r[name] !== 'string' ||
                !r[name].startsWith('local-lab/') ||
                r[name].includes('..') ||
                r[name].includes('\\'))
                throw Error('INVALID_COLLAB_CONFIG');
        if (!Number.isInteger(r.port) ||
            r.port < 1024 ||
            r.port > 65535 ||
            !Number.isInteger(r.maxOutputTokens) ||
            r.maxOutputTokens < 32 ||
            r.maxOutputTokens > 8192 ||
            r.maxOutputTokens >= r.contextTokens ||
            !Number.isInteger(r.timeoutMs) ||
            r.timeoutMs < 1000 ||
            r.timeoutMs > 600000 ||
            !Number.isInteger(r.contextTokens) ||
            r.contextTokens < 2048 ||
            r.contextTokens > 32768 ||
            (r.flashAttention !== undefined && typeof r.flashAttention !== 'boolean') ||
            (r.kvCacheType !== undefined && !['f16', 'q8_0'].includes(r.kvCacheType)) ||
            (r.kvCacheType === 'q8_0' && r.flashAttention !== true) ||
            (r.cpuMoeLayers !== undefined &&
                (!Number.isInteger(r.cpuMoeLayers) || r.cpuMoeLayers < 1 || r.cpuMoeLayers > 200)) ||
            !Number.isInteger(r.gpuLayers) ||
            r.gpuLayers < 0 ||
            r.gpuLayers > 200 ||
            typeof r.modelId !== 'string' ||
            !r.modelId)
            throw Error('INVALID_COLLAB_CONFIG');
    }
    (0, workspace_engine_js_1.validateEngines)(config.engines);
    for (const team of config.teams)
        if (team.modelId && !profiles.some((p) => p.modelId === team.modelId))
            throw Error('INVALID_COLLAB_CONFIG');
    if (config.rolePresets) {
        if (!Array.isArray(config.rolePresets) ||
            config.rolePresets.length > 30 ||
            new Set(config.rolePresets.map((p) => p.id)).size !== config.rolePresets.length ||
            new Set(config.rolePresets.map((p) => p.role)).size !== config.rolePresets.length)
            throw Error('INVALID_ROLE_CATALOG');
        for (const p of config.rolePresets)
            if (!/^[a-z][a-z0-9-]{0,49}$/.test(p.id) ||
                ['name', 'purpose', 'role', 'instructions'].some((k) => typeof p[k] !== 'string' || !p[k]) ||
                !Array.isArray(p.tools) ||
                p.tools.some((t) => typeof t !== 'string'))
                throw Error('INVALID_ROLE_CATALOG');
    }
    for (const p of config.staffingPresets ?? [])
        if (!p.id ||
            !p.label ||
            !p.roles.length ||
            p.roles.some((id) => !config.rolePresets?.some((r) => r.id === id)))
            throw Error('INVALID_ROLE_CATALOG');
    return config;
}
class LocalModel {
    root;
    config;
    process;
    starting;
    state = 'STOPPED';
    credential = (0, node_crypto_1.randomBytes)(32).toString('hex');
    constructor(root, config) {
        this.root = root;
        this.config = config;
    }
    status() {
        return this.state;
    }
    async close() {
        await this.starting?.catch(() => undefined);
        const proc = this.process;
        if (proc && proc.exitCode === null && proc.signalCode === null)
            await new Promise((done, reject) => {
                const timer = setTimeout(() => reject(Error('MODEL_STOP_TIMEOUT')), 10000);
                proc.once('close', () => {
                    clearTimeout(timer);
                    done();
                });
                proc.kill();
            });
        this.process = undefined;
        this.state = 'STOPPED';
    }
    async start() {
        if (this.state === 'READY')
            return;
        if (this.starting)
            return this.starting;
        this.starting = (async () => {
            const c = this.config;
            if (!(0, node_fs_1.existsSync)((0, node_path_1.resolve)(this.root, c.executable)) || !(0, node_fs_1.existsSync)((0, node_path_1.resolve)(this.root, c.modelFile)))
                throw Error('LOCAL_MODEL_MISSING');
            // llama-server binds by itself, so the address it gets is checked here first; listenLoopback
            // also moves the shared preference to ::1 if 127.0.0.1 refuses binds on this machine.
            const probe = (0, node_net_1.createServer)();
            try {
                await (0, loopback_js_1.listenLoopback)(probe, c.port);
            }
            catch {
                throw Error('LOCAL_MODEL_PORT_BUSY');
            }
            finally {
                if (probe.listening)
                    await new Promise((done) => probe.close(() => done()));
            }
            this.state = 'LOADING';
            const proc = (0, node_child_process_1.spawn)((0, node_path_1.resolve)(this.root, c.executable), llamaServerArgs(this.root, c), {
                cwd: this.root,
                windowsHide: true,
                stdio: 'ignore',
                env: { ...process.env, LLAMA_API_KEY: this.credential },
            });
            this.process = proc;
            let failed = false;
            proc.on('error', () => {
                failed = true;
                this.state = 'FAILED';
            });
            proc.on('exit', () => {
                failed = true;
                this.state = 'STOPPED';
            });
            const deadline = Date.now() + c.timeoutMs;
            while (Date.now() < deadline) {
                if (failed)
                    throw Error('LOCAL_MODEL_START_FAILED');
                try {
                    const res = await fetch(`http://${loopback_js_1.loopback.label}:${c.port}/health`, {
                        signal: AbortSignal.timeout(1000),
                    });
                    if (res.ok) {
                        if (failed)
                            throw Error('LOCAL_MODEL_START_FAILED');
                        this.state = 'READY';
                        return;
                    }
                }
                catch {
                    // Not answering yet while the model loads; poll again until the deadline.
                }
                await (0, promises_1.setTimeout)(500);
            }
            proc.kill();
            throw Error('LOCAL_MODEL_LOAD_TIMEOUT');
        })();
        try {
            await this.starting;
        }
        catch (error) {
            this.state = 'FAILED';
            throw error;
        }
        finally {
            this.starting = undefined;
        }
    }
    async complete(messages, signal) {
        await this.start();
        signal.throwIfAborted();
        return (0, local_completion_js_1.completeLocalRequest)(this.config, this.credential, messages, signal);
    }
}
exports.LocalModel = LocalModel;
/** One GPU slot shared by all profiles; model identity never grants a tool permission. */
class LocalModelRouter {
    config;
    factory;
    remote;
    api;
    server;
    current;
    queue = Promise.resolve();
    closed = false;
    constructor(root, config, factory = (c) => new LocalModel(root, c), remote = (c) => new openrouter_model_js_1.OpenRouterModel(root, c), 
    /** Paid API models (ADR 0051); absent in tests and setups without them. */
    api, 
    /** OpenAI-compatible model servers (ADR 0064); they never occupy the local GPU slot either. */
    server) {
        this.config = config;
        this.factory = factory;
        this.remote = remote;
        this.api = api;
        this.server = server;
    }
    /** Remote profiles never occupy the single local slot, so switching does not reload the GPU model. */
    remotes = new Map();
    status() {
        return this.current?.adapter.status() ?? 'STOPPED';
    }
    complete(messages, signal, modelId = this.config.runtime.modelId, meta) {
        const next = this.queue.then(async () => {
            if (this.closed)
                throw Error('MODEL_ROUTER_CLOSED');
            signal.throwIfAborted();
            const profile = (this.config.models ?? [this.config.runtime]).find((c) => c.modelId === modelId);
            if (!profile)
                throw Error('MODEL_UNAVAILABLE');
            if (profile.provider === 'api') {
                if (!this.api)
                    throw Error('MODEL_UNAVAILABLE');
                return this.api.complete(messages, signal, modelId, meta);
            }
            if (profile.provider === 'server') {
                if (!this.server)
                    throw Error('MODEL_UNAVAILABLE');
                return this.server.complete(messages, signal, modelId, meta);
            }
            if (profile.provider === 'openrouter') {
                if (!this.remotes.has(modelId))
                    this.remotes.set(modelId, this.remote(profile));
                return this.remotes.get(modelId).complete(messages, signal, modelId);
            }
            if (this.current?.config.modelId !== modelId) {
                await this.current?.adapter.close();
                this.current = undefined;
                signal.throwIfAborted();
                this.current = { config: profile, adapter: this.factory(profile) };
            }
            return this.current.adapter.complete(messages, signal, modelId);
        });
        this.queue = next.catch(() => undefined);
        return next;
    }
    async close() {
        this.closed = true;
        await this.queue;
        await this.current?.adapter.close();
        this.current = undefined;
    }
}
exports.LocalModelRouter = LocalModelRouter;
//# sourceMappingURL=local-model.js.map