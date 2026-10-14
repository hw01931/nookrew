"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPrototype = createPrototype;
exports.startServer = startServer;
const project_documents_js_1 = require("../infrastructure/project-documents.js");
const codex_project_label_js_1 = require("../adapters/codex-project-label.js");
const social_workspace_js_1 = require("../infrastructure/social-workspace.js");
const native_work_js_1 = require("../application/native-work.js");
const skills_js_1 = require("../infrastructure/skills.js");
const office_presence_js_1 = require("../infrastructure/office-presence.js");
const employee_prompt_js_1 = require("../application/employee-prompt.js");
const api_model_js_1 = require("../adapters/api-model.js");
const api_model_settings_js_1 = require("../infrastructure/api-model-settings.js");
const credentials_js_1 = require("../infrastructure/credentials.js");
const web_access_js_1 = require("../adapters/web-access.js");
const language_js_1 = require("../domain/language.js");
const presets_js_1 = require("../infrastructure/presets.js");
const providers_http_js_1 = require("./providers-http.js");
const usage_http_js_1 = require("./usage-http.js");
const api_usage_report_js_1 = require("../domain/api-usage-report.js");
const model_routing_js_1 = require("../domain/model-routing.js");
const model_servers_http_js_1 = require("./model-servers-http.js");
const server_model_js_1 = require("../adapters/server-model.js");
const model_servers_js_1 = require("../infrastructure/model-servers.js");
const engines_http_js_1 = require("./engines-http.js");
const engine_settings_js_1 = require("../infrastructure/engine-settings.js");
const workspace_engine_js_1 = require("../adapters/workspace-engine.js");
const local_models_js_1 = require("../adapters/local-models.js");
const windows_shell_js_1 = require("../adapters/windows-shell.js");
const workspace_js_1 = require("../domain/workspace.js");
const project_files_js_1 = require("../adapters/project-files.js");
const project_git_js_1 = require("../adapters/project-git.js");
const project_catalog_js_1 = require("../infrastructure/project-catalog.js");
const node_fs_1 = require("node:fs");
const task_js_1 = require("../domain/task.js");
const office_http_js_1 = require("./office-http.js");
const http_js_1 = require("./http.js");
const node_http_1 = require("node:http");
const node_crypto_1 = require("node:crypto");
const node_path_1 = require("node:path");
const board_js_1 = require("../application/board.js");
const store_js_1 = require("../infrastructure/store.js");
const runner_js_1 = require("../application/runner.js");
const record_graph_js_1 = require("../domain/record-graph.js");
const message_search_js_1 = require("../domain/message-search.js");
const record_search_js_1 = require("../domain/record-search.js");
const record_archive_js_1 = require("../infrastructure/record-archive.js");
const workspace_diagnostics_js_1 = require("../adapters/workspace-diagnostics.js");
const backup_js_1 = require("../infrastructure/backup.js");
const workspace_js_2 = require("../application/workspace.js");
const validation_js_1 = require("../infrastructure/validation.js");
const fixture_js_1 = require("../adapters/fixture.js");
const product_js_1 = require("../config/product.js");
const board_contract_js_1 = require("../domain/board-contract.js");
const settings_js_1 = require("./settings.js");
const assets_js_1 = require("./assets.js");
const codex_office_chat_js_1 = require("../application/codex-office-chat.js");
const storage_js_1 = require("../config/storage.js");
const collaboration_store_js_1 = require("../infrastructure/collaboration-store.js");
const collaboration_js_1 = require("../application/collaboration.js");
const local_model_js_1 = require("../adapters/local-model.js");
const project_changes_js_1 = require("../adapters/project-changes.js");
const model_downloads_js_1 = require("../adapters/model-downloads.js");
const acceptance_js_1 = require("../domain/acceptance.js");
const loopback_js_1 = require("../infrastructure/loopback.js");
const mcp_http_js_1 = require("./mcp-http.js");
const collaboration_js_2 = require("../domain/collaboration.js");
/** Content types of a project preview; any other allowed file (.json, .txt) is plain text. */
const previewTypes = {
    html: 'text/html; charset=utf-8',
    css: 'text/css',
    js: 'text/javascript',
    mjs: 'text/javascript',
    svg: 'image/svg+xml',
};
let sharedDownloads;
function createPrototype(root = validation_js_1.projectRoot, directory = (0, node_path_1.resolve)(root, settings_js_1.webPolicy.storageDirectory), product = (0, product_js_1.loadProductConfig)(), options = {}) {
    // A restore requested last session is applied before any database below is opened.
    if (!options.projects)
        (0, backup_js_1.applyPendingRestore)(directory);
    const board = new board_js_1.Board((0, node_path_1.resolve)(directory, storage_js_1.storageIdentity.boardFile));
    const presence = new office_presence_js_1.OfficePresence(root, directory);
    const codexChat = new codex_office_chat_js_1.CodexOfficeChat(root, presence, options.codexRpc, options.codexQueue);
    const social = new social_workspace_js_1.SocialWorkspace(root, options.social?.credentials, options.social?.meta, (id) => presence.list().some((p) => p.id === id));
    const store = new store_js_1.Store((0, node_path_1.resolve)(directory, storage_js_1.storageIdentity.runsFile));
    const collaborationStore = new collaboration_store_js_1.CollaborationStore((0, node_path_1.resolve)(directory, options.nativeCompanion ? 'companion-collaboration.db' : 'collaboration.db'), root);
    const collaborationConfig = options.config ?? (0, local_model_js_1.loadCollaborationConfig)(validation_js_1.projectRoot);
    const apiAdapter = options.api
        ? new api_model_js_1.ApiModelAdapter(options.api.settings, options.api.credentials, options.api.request)
        : undefined;
    const serverAdapter = options.servers
        ? new server_model_js_1.ServerModelAdapter(options.servers.settings, options.servers.credentials, options.servers.ledger, options.servers.request)
        : undefined;
    const sharedModel = options.model ??
        new local_model_js_1.LocalModelRouter(validation_js_1.projectRoot, collaborationConfig, undefined, undefined, apiAdapter, serverAdapter);
    // Models live under the app root, shared by every project; created on first use.
    const downloads = () => options.downloads ?? (sharedDownloads ??= new model_downloads_js_1.ModelDownloads(validation_js_1.projectRoot));
    // Model files in the folder are models employees can use (ADR 0050). Projects share config.models
    // (in place), and every window syncs before it lists models, so a change made in any window shows in
    // all of them. Only tests that ask for fixedModels skip it.
    const catalogLabels = (() => {
        try {
            return Object.fromEntries((0, model_downloads_js_1.loadModelCatalog)(validation_js_1.projectRoot).models.map((m) => [m.file, m.label]));
        }
        catch {
            return {};
        }
    })();
    const syncModels = () => {
        if (options.fixedModels)
            return;
        (0, local_models_js_1.syncFolderModels)(validation_js_1.projectRoot, collaborationConfig, catalogLabels);
        if (options.api)
            (0, api_model_js_1.syncApiProfiles)(collaborationConfig, options.api.settings, options.api.credentials);
        if (options.servers)
            (0, server_model_js_1.syncServerProfiles)(collaborationConfig, options.servers.settings, options.servers.credentials, !!options.servers.ledger);
        for (const m of collaborationConfig.models ?? [])
            m.label ??= catalogLabels[m.modelFile];
    };
    syncModels();
    // Records the app writes into this project (follow-up work, fix drafts, rule reasons) use its language.
    const changes = new project_changes_js_1.ProjectChanges(root, collaborationStore, options.profile, {}, (0, language_js_1.language)(options.brief?.language));
    const files = new project_files_js_1.ProjectFiles(root);
    const documents = new project_documents_js_1.ProjectDocuments(root);
    const office = new collaboration_js_1.Collaboration(collaborationStore, { complete: (...args) => sharedModel.complete(...args), status: () => sharedModel.status(), close() { } }, collaborationConfig, changes, options.brief);
    if (!options.nativeCompanion)
        office.bootstrap();
    const nativeWork = new native_work_js_1.NativeWork(collaborationStore, (id) => presence.list().some((p) => p.id === id && p.provider === 'codex'));
    let nativeScheduleError = '';
    const nativeScheduleTimer = options.nativeCompanion
        ? setInterval(() => {
            try {
                nativeWork.tick();
                nativeScheduleError = '';
            }
            catch (error) {
                nativeScheduleError = (0, office_http_js_1.clientErrorCode)(error instanceof Error ? error.message : 'REQUEST_FAILED');
            }
        }, 15000)
        : undefined;
    // Engine consents and the develop route belong to this project; the registry to the app (ADR 0065).
    office.engineSettings = new engine_settings_js_1.ProjectEngineSettings(directory);
    if (options.engines) {
        const registry = options.engines.registry;
        office.refreshEngines = () => (0, workspace_engine_js_1.syncEngines)(collaborationConfig, () => registry.read());
    }
    if (!options.nativeCompanion) {
        office.routines.startTimer();
        office.graphs.startTimer();
    }
    // Built-in skills ship in config/skills; the owner's own go next to the exe (installed) or in
    // <repo>/skills (development). Project windows share the parent's library.
    const skills = options.skills ??
        new skills_js_1.SkillLibrary((0, node_path_1.resolve)(validation_js_1.projectRoot, 'config/skills'), process.env.AIORCHESTRA_SKILLS || (0, node_path_1.resolve)(validation_js_1.projectRoot, 'skills'));
    office.skills = skills;
    if (options.web)
        office.web = options.web;
    // Spending and model-health alerts reach the inbox (ADR 0063); the ledger is shared by all projects.
    if (options.api) {
        const api = options.api;
        office.costAlerts = () => (0, api_usage_report_js_1.costAlerts)(api.settings.usage(), api.settings.read().limits);
    }
    // Usage panel (ADR 0070): this project's runs with API-equivalent figures from the price table.
    // "This session" counts from when this window's server started.
    const sessionStart = new Date();
    const projectUsageView = (period) => {
        const prices = (0, providers_http_js_1.defaultPrices)(validation_js_1.projectRoot);
        let references = {};
        try {
            references = options.api?.settings.read().usageReferences ?? {};
        }
        catch {
            // An unreadable API settings file shows on the API page; usage still shows with defaults.
        }
        return {
            ...(0, usage_http_js_1.projectUsage)({
                jobs: collaborationStore.jobs(usage_http_js_1.usageJobLimit),
                candidates: changes.all(),
                references,
                prices,
                sessionStart,
                workflows: office.workflows.list(),
            }, period),
            references,
            priceLabels: Object.fromEntries(Object.entries(prices.models).map(([k, v]) => [k, v.label])),
            pricesAsOf: prices.asOf,
            engines: office.listEngines().map((e) => ({ id: e.id, label: e.label })),
            referencesEditable: !!options.api,
        };
    };
    // Seeded teams and presets by language (ADR 0062); the screen sends its language with each request.
    const presets = (0, presets_js_1.presetsFor)(validation_js_1.projectRoot, collaborationConfig);
    const requestLanguage = (req) => (0, language_js_1.language)(req.headers['x-aio-language']);
    const catalog = options.projects
        ? null
        : new project_catalog_js_1.ProjectCatalog((0, node_path_1.resolve)(directory, 'projects'), collaborationConfig, options.workspace, presets);
    const children = new Map();
    const opening = new Map();
    const unlinkReplies = new Map();
    const removeProject = async (id, version, recycle) => {
        const owned = recycle ? catalog.ownedFolder(id) : null;
        if (recycle && !owned)
            throw Error('FOLDER_NOT_OWNED');
        const result = catalog.unlink(id, version);
        // The removed project's window is never the one answering (the request handler refuses that), so
        // it closes now; its folder goes to the recycle bin only once nothing holds it open.
        const settled = (async () => {
            const child = children.get(id);
            if (child) {
                children.delete(id);
                await stop(child.preview);
                await child.app.close();
            }
            return owned ? await (options.recycle ?? windows_shell_js_1.recycleFolder)(owned) : 'NONE';
        })().then((recycle) => ({ recycle }), (error) => {
            console.error(`[${new Date().toISOString()}] project unlink cleanup: ${String(error).slice(0, 300)}`);
            const message = error instanceof Error ? error.message : '';
            return owned
                ? {
                    recycle: 'FAILED',
                    recycleError: /^[A-Z_]+$/.test(message) ? message : 'RECYCLE_FAILED',
                }
                : { recycle: 'NONE' };
        });
        if (!owned) {
            void settled;
            return { ...result, recycle: 'NONE' };
        }
        // Windows may ask the owner first (AllDialogs); past the wait the answer says PENDING, not done.
        let timer;
        const waited = new Promise((done) => {
            timer = setTimeout(() => done({ recycle: 'PENDING' }), options.recycleWaitMs ?? 20000);
            timer.unref();
        });
        try {
            return { ...result, ...(await Promise.race([settled, waited])) };
        }
        finally {
            clearTimeout(timer);
        }
    };
    const projects = options.projects ?? {
        list: () => catalog.list().map((p) => ({
            ...p,
            owned: (() => {
                try {
                    return !!catalog.ownedFolder(p.id);
                }
                catch {
                    return false;
                }
            })(),
            url: children.get(p.id)?.url ?? null,
            previewUrl: children.get(p.id)?.previewUrl ?? null,
        })),
        create: (...args) => catalog.create(...args),
        nextLocation: () => catalog.nextLocation(),
        unlink: async (id, version, recycle, key) => {
            // Same key, same request: the first answer again (a reply lost on the way is asked for again).
            // Kept in memory; after a restart a retry gets PROJECT_NOT_FOUND, which the list treats as removed.
            const request = JSON.stringify([id, version, recycle]);
            const prior = unlinkReplies.get(key);
            if (prior) {
                if (prior.request !== request)
                    throw Error('IDEMPOTENCY_CONFLICT');
                return prior.reply;
            }
            const reply = removeProject(id, version, recycle);
            unlinkReplies.set(key, { request, reply });
            // A refused request (version conflict, not owned) changed nothing and may be sent again.
            reply.catch(() => unlinkReplies.delete(key));
            return reply;
        },
        reveal: (id) => (0, windows_shell_js_1.revealFolder)(catalog.root(id)),
        inspect: (id) => catalog.inspect(id),
        request: (key) => catalog.request(key),
        recover: (id, snapshot, command) => catalog.recover(id, snapshot, command),
        open: async (id) => {
            const current = children.get(id);
            if (current)
                return { url: current.url, previewUrl: current.previewUrl };
            if (opening.has(id))
                return opening.get(id);
            const job = (async () => {
                const p = catalog.get(id);
                if (p.status !== 'READY')
                    throw Error('PROJECT_NOT_READY');
                const childRoot = catalog.root(id);
                const self = { previewUrl: '' };
                const childProduct = { ...product, display: { ...product.display, projectName: p.name } };
                const app = createPrototype(childRoot, p.kind === 'linked' ? catalog.stateDirectory(id) : undefined, childProduct, {
                    model: sharedModel,
                    config: catalog.configFor(p),
                    ...(options.fixedModels ? { fixedModels: true } : {}),
                    projectId: id,
                    profile: 'node-web',
                    projects,
                    ...(options.api ? { api: options.api } : {}),
                    ...(options.servers ? { servers: options.servers } : {}),
                    ...(options.engines ? { engines: options.engines } : {}),
                    ...(options.web ? { web: options.web } : {}),
                    skills,
                    brief: { name: p.name, idea: p.idea, language: (0, language_js_1.language)(p.language) },
                    self,
                });
                // Each project gets three ports from its catalog position. Another program may already hold
                // them, so a busy set moves past the catalog.
                const slot = (n) => product.server.port + 100 + n * 3;
                let port = slot(catalog.list().findIndex((x) => x.id === id));
                const preview = (0, node_http_1.createServer)((req, res) => {
                    try {
                        if (!(0, loopback_js_1.isLoopbackHost)(req.headers.host, port + 2) || req.method !== 'GET') {
                            res.writeHead(403);
                            res.end();
                            return;
                        }
                        const path = decodeURIComponent(new URL(req.url ?? '/', `http://${req.headers.host}`).pathname).slice(1) ||
                            'index.html';
                        if (!(0, task_js_1.safeRelativePath)(path) ||
                            (0, workspace_js_1.protectedPath)(path) ||
                            !/\.(html|css|js|mjs|json|svg|txt)$/.test(path))
                            throw Error('PATH_DENIED');
                        let cursor = (0, node_path_1.resolve)(childRoot, 'src');
                        if ((0, node_fs_1.lstatSync)(cursor).isSymbolicLink())
                            throw Error('PATH_DENIED');
                        for (const part of path.split('/')) {
                            cursor = (0, node_path_1.resolve)(cursor, part);
                            if ((0, node_fs_1.lstatSync)(cursor).isSymbolicLink())
                                throw Error('PATH_DENIED');
                        }
                        if (!(0, node_fs_1.realpathSync)(cursor).startsWith((0, node_fs_1.realpathSync)((0, node_path_1.resolve)(childRoot, 'src')) + node_path_1.sep) ||
                            !(0, node_fs_1.lstatSync)(cursor).isFile() ||
                            (0, node_fs_1.lstatSync)(cursor).nlink !== 1 ||
                            (0, node_fs_1.lstatSync)(cursor).size > 1000000)
                            throw Error('PATH_DENIED');
                        res.setHeader('Content-Type', previewTypes[path.slice(path.lastIndexOf('.') + 1)] ?? 'text/plain');
                        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-scripts allow-same-origin");
                        res.setHeader('X-Content-Type-Options', 'nosniff');
                        res.end((0, node_fs_1.readFileSync)(cursor));
                    }
                    catch {
                        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                        res.end('아직 구현된 화면이 없습니다. src/index.html을 검증·반영하면 표시됩니다.');
                    }
                });
                let officeLabel = '', previewLabel = '';
                for (let attempt = 1;; attempt++) {
                    try {
                        officeLabel = await (0, loopback_js_1.listenLoopback)(app.server, port);
                        await (0, loopback_js_1.listenLoopback)(app.clientServer, port + 1);
                        previewLabel = await (0, loopback_js_1.listenLoopback)(preview, port + 2);
                        break;
                    }
                    catch (error) {
                        for (const server of [app.server, app.clientServer, preview])
                            if (server.listening)
                                await new Promise((done) => server.close(() => done()));
                        // EFAULT is already retried and worked around inside listenLoopback.
                        if (error.code !== 'EADDRINUSE' || attempt > 10) {
                            await app.close();
                            throw error;
                        }
                        port = slot(catalog.list().length + attempt);
                    }
                }
                const entry = {
                    app,
                    preview,
                    url: `http://${officeLabel}:${port}/#office/studio`,
                    previewUrl: `http://${previewLabel}:${port + 2}`,
                };
                self.previewUrl = entry.previewUrl;
                children.set(id, entry);
                return { url: entry.url, previewUrl: entry.previewUrl };
            })().finally(() => opening.delete(id));
            opening.set(id, job);
            return job;
        },
    };
    const token = (0, node_crypto_1.randomBytes)(32).toString('hex');
    const companionSurface = options.nativeCompanion ? (0, assets_js_1.companionAssets)(validation_js_1.projectRoot) : null;
    const jobs = new Set();
    const track = (job) => {
        jobs.add(job);
        void job.finally(() => jobs.delete(job)).catch(() => undefined);
    };
    const handle = async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', 
        // Images may come from data:/blob: URLs the page made itself (diagram PNG export, ADR 0054).
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors " +
            (req.url === '/sheet-frame.html' ? "'self'" : "'none'") +
            "; base-uri 'none'; form-action 'self'");
        try {
            const port = req.socket.localPort;
            // Only literal loopback hosts: a DNS name pointing here (rebinding) is refused.
            if (!(0, loopback_js_1.isLoopbackHost)(req.headers.host, port)) {
                (0, http_js_1.json)(res, 403, { error: 'HOST_DENIED' });
                return;
            }
            const origin = `http://${req.headers.host}`;
            const path = new URL(req.url ?? '/', origin).pathname;
            if (options.nativeCompanion &&
                path.startsWith('/api/') &&
                ![
                    '/api/config',
                    '/api/state',
                    '/api/office',
                    '/api/project-files',
                    '/api/project-documents',
                    '/api/social',
                    '/api/office/presence-chat',
                    '/api/office/conversation',
                    '/api/office/chat',
                    '/api/office/presence-ack',
                    '/api/office/presence-configure',
                    '/api/office/presence-work-link',
                    '/api/office/project-document',
                    '/api/office/native-work',
                    '/api/office/social',
                    '/api/office/companion-stop',
                ].includes(path)) {
                (0, http_js_1.json)(res, 404, { error: 'NOT_FOUND' });
                return;
            }
            // Engine runs reach the employee tools here with their own bearer token (ADR 0071). Only the
            // owner server: the client server's allowlist never passes /mcp.
            if (path === '/mcp') {
                if (options.nativeCompanion) {
                    (0, http_js_1.json)(res, 404, { error: 'NOT_FOUND' });
                    return;
                }
                await (0, mcp_http_js_1.handleMcp)(req, res, office);
                return;
            }
            if (req.headers.authorization && !path.startsWith('/api/client/')) {
                (0, http_js_1.json)(res, 403, { error: 'ACCESS_DENIED' });
                return;
            }
            if (req.method === 'GET') {
                const asset = !companionSurface || path === '/' || companionSurface.has(path)
                    ? (0, assets_js_1.staticAsset)(path, validation_js_1.projectRoot, product, options.nativeCompanion ? 'companion.html' : 'index.html')
                    : null;
                if (asset) {
                    res.setHeader('Content-Type', asset.type);
                    res.end(asset.content);
                    return;
                }
            }
            if (req.method === 'GET' && path === '/api/config') {
                (0, http_js_1.json)(res, 200, (0, settings_js_1.publicSettings)(product));
                return;
            }
            if (path.startsWith('/api/client/')) {
                const actor = office.client(String(req.headers.authorization ?? '').replace(/^Bearer /, ''));
                if (req.method === 'GET' && path === '/api/client/state') {
                    (0, http_js_1.json)(res, 200, { ...office.state(actor), name: (0, product_js_1.projectName)(product) });
                    return;
                }
                if (req.method === 'POST' &&
                    path === '/api/client/submit' &&
                    req.headers.origin === origin &&
                    req.headers['content-type'] === 'application/json') {
                    const input = await (0, http_js_1.body)(req);
                    const kind = input.kind;
                    if ((kind !== 'message' && kind !== 'feedback') || typeof input.key !== 'string')
                        throw Error('INVALID_COMMAND');
                    const data = input.data;
                    const parent = collaborationStore.read((0, collaboration_js_2.string)(data, kind === 'message' ? 'roomId' : 'artifactId'), actor);
                    (0, http_js_1.json)(res, 200, office.put(kind, null, data, parent.audience, actor, office.command(actor, input.key, 0)));
                    return;
                }
                throw Error('ACCESS_DENIED');
            }
            if (req.method === 'GET' && path === '/api/projects/inspect') {
                (0, http_js_1.json)(res, 200, projects.inspect(new URL(req.url, origin).searchParams.get('id') ?? ''));
                return;
            }
            if (req.method === 'GET' && path === '/api/projects/request') {
                (0, http_js_1.json)(res, 200, projects.request(new URL(req.url, origin).searchParams.get('key') ?? ''));
                return;
            }
            if (req.method === 'GET' && path === '/api/skills') {
                (0, http_js_1.json)(res, 200, {
                    folder: skills.userDir,
                    skills: skills.list().map(({ dir: _dir, ...s }) => s),
                });
                return;
            }
            if (req.method === 'GET' && path === '/api/web-search') {
                if (!options.web)
                    throw Error('WEB_UNAVAILABLE');
                (0, http_js_1.json)(res, 200, options.web.settings());
                return;
            }
            if (req.method === 'GET' && path === '/api/engines') {
                if (!options.engines)
                    throw Error('ENGINES_UNAVAILABLE');
                (0, http_js_1.json)(res, 200, { ...(0, engines_http_js_1.enginesView)(options.engines), project: office.listEngines() });
                return;
            }
            if (req.method === 'GET' && path === '/api/providers') {
                if (!options.api)
                    throw Error('API_MODELS_UNAVAILABLE');
                (0, http_js_1.json)(res, 200, (0, providers_http_js_1.providersView)(options.api, validation_js_1.projectRoot));
                return;
            }
            if (req.method === 'GET' && path === '/api/providers/usage') {
                if (!options.api)
                    throw Error('API_MODELS_UNAVAILABLE');
                // Next to the ledger: this month's API-equivalent of this project's subscription engine runs,
                // so the subscription comparison can show what the same work would have cost on the API.
                const month = projectUsageView('month');
                const engines = month.byTarget.filter((s) => s.key.startsWith('engine:'));
                (0, http_js_1.json)(res, 200, {
                    ...(0, providers_http_js_1.usageView)(options.api, new URL(req.url, origin).searchParams.get('month')),
                    equivalent: {
                        engineUsd: engines.reduce((t, s) => ({
                            value: s.apiEquivalentUsd.value === null ? t.value : (t.value ?? 0) + s.apiEquivalentUsd.value,
                            partial: t.partial || s.apiEquivalentUsd.partial || s.apiEquivalentUsd.value === null,
                        }), { value: null, partial: false }),
                        engineRuns: engines.reduce((n, s) => n + s.runs, 0),
                    },
                });
                return;
            }
            if (req.method === 'GET' && path === '/api/office/usage') {
                (0, http_js_1.json)(res, 200, projectUsageView(new URL(req.url, origin).searchParams.get('period')));
                return;
            }
            if (req.method === 'GET' && path === '/api/model-servers') {
                if (!options.servers)
                    throw Error('SERVERS_UNAVAILABLE');
                (0, http_js_1.json)(res, 200, (0, model_servers_http_js_1.serversView)(options.servers));
                return;
            }
            if (req.method === 'GET' && path === '/api/models') {
                syncModels();
                (0, http_js_1.json)(res, 200, {
                    ...downloads().list(),
                    folder: (0, node_path_1.resolve)(validation_js_1.projectRoot, local_models_js_1.modelFolder),
                    local: (collaborationConfig.models ?? [collaborationConfig.runtime])
                        .filter((m) => (m.provider ?? 'local') === 'local')
                        .map((m) => {
                        const path = (0, node_path_1.resolve)(validation_js_1.projectRoot, m.modelFile);
                        return {
                            id: m.modelId,
                            label: m.label ?? m.modelId,
                            file: m.modelFile,
                            present: (0, node_fs_1.existsSync)(path),
                            bytes: (0, node_fs_1.existsSync)(path) ? (0, node_fs_1.statSync)(path).size : null,
                            added: !!m.discovered,
                        };
                    }),
                });
                return;
            }
            if (req.method === 'GET' && path === '/api/projects') {
                (0, http_js_1.json)(res, 200, projects.list());
                return;
            }
            if (req.method === 'GET' && path === '/api/project-edit') {
                const query = new URL(req.url, origin).searchParams;
                (0, http_js_1.json)(res, 200, changes.editable(query.get('path') ?? '', collaboration_js_2.owner, query.get('new') === '1'));
                return;
            }
            if (req.method === 'GET' && path === '/api/project-search') {
                const query = new URL(req.url, origin).searchParams;
                (0, http_js_1.json)(res, 200, changes.search({
                    query: query.get('q') ?? '',
                    prefix: query.get('prefix') ?? '',
                    caseSensitive: query.get('case') === 'true',
                }, collaboration_js_2.owner));
                return;
            }
            if (req.method === 'GET' && path === '/api/project-files') {
                const query = new URL(req.url, origin).searchParams;
                (0, http_js_1.json)(res, 200, query.get('view') === 'library'
                    ? files.library()
                    : query.get('view') === 'file'
                        ? files.read(query.get('path') ?? '')
                        : query.get('view') === 'git'
                            ? await (0, project_git_js_1.projectGit)(root, query.get('path') ?? '')
                            : files.list(query.get('path') ?? '', Number(query.get('offset') ?? 0), query.get('q') ?? ''));
                return;
            }
            if (req.method === 'GET' && path === '/api/office/handover-plan') {
                const q = new URL(req.url, origin).searchParams;
                (0, http_js_1.json)(res, 200, office.handover.preview(q.get('source') ?? '', q.get('target') ?? ''));
                return;
            }
            if (req.method === 'GET' && path === '/api/office/workflow-plan') {
                (0, http_js_1.json)(res, 200, office.workflows.preview(new URL(req.url, origin).searchParams.get('id') ?? ''));
                return;
            }
            if (req.method === 'GET' && path === '/api/office/checks') {
                (0, http_js_1.json)(res, 200, changes.checks());
                return;
            }
            if (req.method === 'GET' && path === '/api/office/conversation') {
                (0, http_js_1.json)(res, 200, await codexChat.read(new URL(req.url, origin).searchParams.get('id') || ''));
                return;
            }
            if (req.method === 'GET' && path === '/api/office') {
                if (options.nativeCompanion) {
                    (0, http_js_1.json)(res, 200, {
                        projectName: (0, codex_project_label_js_1.codexProjectLabel)(root, (0, product_js_1.projectName)(product)),
                        projectRoot: root,
                        officeCompanion: true,
                        entities: collaborationStore.list(collaboration_js_2.owner).filter((e) => e.kind === 'work'),
                        presence: presence.list().filter((p) => p.provider === 'codex'),
                        presenceUsage: presence.usage(),
                        presenceWorkLinks: presence.workLinks((id) => collaborationStore.read(id, collaboration_js_2.owner)),
                        nativeWorkPlans: nativeWork.view(),
                        nativeScheduleError,
                    });
                    return;
                }
                syncModels();
                const state = office.state();
                (0, http_js_1.json)(res, 200, {
                    ...state,
                    officeCompanion: false,
                    nativeWorkPlans: nativeWork.view(),
                    nativeScheduleError,
                    presence: presence.list().filter((p) => !options.nativeCompanion || p.provider === 'codex'),
                    presenceUsage: presence.usage(),
                    presenceWorkLinks: presence.workLinks((id) => collaborationStore.read(id, collaboration_js_2.owner)),
                    // Employees can only pick models that can run: remote ones, or local ones whose file is here.
                    models: state.models.filter((m) => {
                        const profile = (collaborationConfig.models ?? [collaborationConfig.runtime]).find((p) => p.modelId === m.id);
                        return (!profile ||
                            (profile.provider ?? 'local') !== 'local' ||
                            (0, node_fs_1.existsSync)((0, node_path_1.resolve)(validation_js_1.projectRoot, profile.modelFile)));
                    }),
                    // The hub offers presets in the screen's language; a project window keeps its project's.
                    ...(catalog
                        ? {
                            rolePresets: presets(requestLanguage(req)).rolePresets ?? [],
                            staffingPresets: presets(requestLanguage(req)).staffingPresets ?? [],
                        }
                        : {}),
                    changes: changes.view(),
                    // Test names of the registered acceptance check; work items pick their criteria from them.
                    checkTests: (0, acceptance_js_1.acceptanceTestNames)(changes.checks().content),
                    rules: changes.rules(),
                    automation: changes.automation(),
                    // Work-type routing (ADR 0063): the project's rules and the vocabulary the form offers.
                    modelRoutes: office.routes.read(),
                    workKinds: model_routing_js_1.workKinds,
                    routeEfforts: model_routing_js_1.routeEfforts,
                    skillIndex: skills
                        .list()
                        .map((s) => ({ name: s.name, description: s.description, roles: s.roles, source: s.source })),
                    codingPrinciples: employee_prompt_js_1.codingPrincipleLines[office.language],
                    projects: projects.list(),
                    nextProjectLocation: projects.nextLocation?.() ?? null,
                    projectRoot: root,
                    projectId: options.projectId ?? null,
                    verificationProfile: options.profile ?? 'typescript',
                    previewUrl: options.self?.previewUrl || null,
                });
                return;
            }
            if (req.method === 'GET' && path.startsWith('/api/office/decision-impact/')) {
                (0, http_js_1.json)(res, 200, office.lifecycle.impact(decodeURIComponent(path.slice('/api/office/decision-impact/'.length))));
                return;
            }
            if (req.method === 'GET' && path.startsWith('/api/office/trace/')) {
                (0, http_js_1.json)(res, 200, (0, record_graph_js_1.traceRecord)(collaborationStore.list(collaboration_js_2.owner), decodeURIComponent(path.slice('/api/office/trace/'.length))));
                return;
            }
            if (req.method === 'GET' && path === '/api/office/message-search') {
                const query = new URL(req.url, origin).searchParams;
                (0, http_js_1.json)(res, 200, (0, message_search_js_1.searchMessages)(collaborationStore.list(collaboration_js_2.owner), query.get('room') ?? '', query.get('q') ?? ''));
                return;
            }
            if (req.method === 'GET' && path === '/api/office/diagnostics') {
                // Shown live and stored nowhere: worded in the asking screen's language (ADR 0062).
                (0, http_js_1.json)(res, 200, (0, workspace_diagnostics_js_1.workspaceDiagnostics)(office, validation_js_1.projectRoot, options.api, requestLanguage(req)));
                return;
            }
            if (req.method === 'GET' && path === '/api/office/backups') {
                (0, http_js_1.json)(res, 200, { backups: (0, backup_js_1.listBackups)(directory), pending: (0, backup_js_1.pendingRestore)(directory) });
                return;
            }
            if (req.method === 'GET' && path === '/api/office/archive') {
                (0, http_js_1.json)(res, 200, (0, record_archive_js_1.exportRecords)(collaborationStore));
                return;
            }
            if (req.method === 'GET' && path === '/api/office/work-request') {
                const q = new URL(req.url, origin).searchParams;
                const job = office.workRequest(q.get('key') ?? '');
                (0, http_js_1.json)(res, 200, {
                    job: job
                        ? {
                            id: job.id,
                            status: job.status,
                            roomId: job.roomId,
                            targetId: job.targetId,
                            targetVersion: job.targetVersion,
                            createdAt: job.createdAt,
                        }
                        : null,
                    abandoned: office.workRequestAbandoned(q.get('key') ?? ''),
                });
                return;
            }
            if (req.method === 'GET' && path === '/api/office/search') {
                const q = new URL(req.url, origin).searchParams;
                (0, http_js_1.json)(res, 200, (0, record_search_js_1.searchRecords)(collaborationStore.list(collaboration_js_2.owner), q.get('q') ?? '', q.get('kind') ?? '', Number(q.get('offset') ?? 0)));
                return;
            }
            if (req.method === 'GET' && path.startsWith('/api/office/history/')) {
                (0, http_js_1.json)(res, 200, collaborationStore.history(path.slice('/api/office/history/'.length), collaboration_js_2.owner));
                return;
            }
            if (req.method === 'GET' && path === '/api/office/audit') {
                (0, http_js_1.json)(res, 200, collaborationStore.audit(collaboration_js_2.owner));
                return;
            }
            if (req.method === 'GET' && path.startsWith('/api/office/changes/')) {
                (0, http_js_1.json)(res, 200, changes.history(path.slice('/api/office/changes/'.length)));
                return;
            }
            if (req.method === 'GET' && path === '/api/project-documents') {
                (0, http_js_1.json)(res, 200, documents.read(new URL(req.url, origin).searchParams.get('path') || ''));
                return;
            }
            if (req.method === 'GET' && path === '/api/social') {
                (0, http_js_1.json)(res, 200, {
                    ...social.view(),
                    employees: presence
                        .list()
                        .filter((p) => !options.nativeCompanion || p.provider === 'codex')
                        .map((p) => ({
                        id: p.id,
                        label: p.label || p.provider + ' · ' + p.session.slice(0, 8),
                        role: p.role,
                    })),
                });
                return;
            }
            if (req.method === 'GET' && path === '/api/state') {
                (0, http_js_1.json)(res, 200, {
                    token,
                    project: { name: (0, product_js_1.projectName)(product), root, model: product.retainedModelLabel, remote: false },
                    documents: board.list(),
                    runs: store.listRuns(settings_js_1.webPolicy.runHistoryEntries),
                });
                return;
            }
            if (req.method === 'GET' && path.startsWith('/api/tasks/')) {
                (0, http_js_1.json)(res, 200, board.history(decodeURIComponent(path.slice('/api/tasks/'.length))));
                return;
            }
            if (req.method === 'GET' && path.startsWith('/api/runs/')) {
                const id = path.slice('/api/runs/'.length);
                const report = store.report(id);
                (0, http_js_1.json)(res, 200, {
                    ...report,
                    base_files: fixture_js_1.baseFiles,
                    files: report.run.candidate_hash ? store.artifact(report.run.candidate_hash) : null,
                });
                return;
            }
            if (req.method !== 'POST') {
                (0, http_js_1.json)(res, 404, { error: 'NOT_FOUND' });
                return;
            }
            if (req.headers.origin !== origin ||
                req.headers['x-csrf-token'] !== token ||
                req.headers['content-type'] !== 'application/json') {
                (0, http_js_1.json)(res, 403, { error: 'REQUEST_DENIED' });
                return;
            }
            const input = await (0, http_js_1.body)(req, path === '/api/office/archive-inspect'
                ? record_archive_js_1.archiveLimits.bytes + 2048
                : path.startsWith('/api/office')
                    ? 524288
                    : settings_js_1.webPolicy.maxBodyBytes);
            if (typeof input.key !== 'string' ||
                !input.key ||
                input.key.length > board_contract_js_1.boardLimits.idempotencyKeyCharacters ||
                !Number.isSafeInteger(input.version) ||
                Number(input.version) < 0)
                throw new Error('INVALID_COMMAND');
            const command = (0, runner_js_1.localCommand)(root, input.key, Number(input.version));
            if (path === '/api/office/chat') {
                (0, http_js_1.json)(res, 200, await codexChat.command(String(input.action), input.data, command));
                return;
            }
            if (path === '/api/office/presence-chat') {
                (0, http_js_1.json)(res, 200, await presence.openChat(String(input.id), command, options.openCodexChat || windows_shell_js_1.openCodexChat));
                return;
            }
            if (path === '/api/office/native-work') {
                if (!options.nativeCompanion)
                    throw Error('COMPANION_ONLY');
                (0, http_js_1.json)(res, 200, nativeWork.command(String(input.action), input.data, command));
                return;
            }
            if (path === '/api/office/social') {
                (0, http_js_1.json)(res, 200, await social.command(String(input.action), input.data, command));
                return;
            }
            if (path === '/api/office/companion-stop') {
                if (!options.nativeCompanion)
                    throw Error('COMPANION_ONLY');
                if (command.expected_version !== 0)
                    throw Error('VERSION_CONFLICT');
                (0, http_js_1.json)(res, 200, { stopping: true });
                setImmediate(() => void close());
                return;
            }
            if (path === '/api/office/project-document') {
                (0, http_js_1.json)(res, 200, documents.command(String(input.path || ''), String(input.snapshot || ''), input.action, input.text, command));
                return;
            }
            if (path === '/api/office/presence-work-link') {
                if (typeof input.linked !== 'boolean')
                    throw Error('INVALID_LINK');
                (0, http_js_1.json)(res, 200, presence.setWorkLink(String(input.id), String(input.workId), Number(input.workVersion), Number(input.linkVersion), input.linked, command, (id) => collaborationStore.read(id, collaboration_js_2.owner)));
                return;
            }
            if (path === '/api/office/presence-ack') {
                (0, http_js_1.json)(res, 200, presence.acknowledge(String(input.id), command));
                return;
            }
            if (path === '/api/office/presence-configure') {
                (0, http_js_1.json)(res, 200, presence.configure(String(input.id), input.label, input.role, command));
                return;
            }
            if (path === '/api/office/archive-inspect') {
                (0, http_js_1.json)(res, 200, (0, record_archive_js_1.inspectRecords)(input.archive));
                return;
            }
            if (path === '/api/office/backups') {
                if (options.projects)
                    throw Error('BACKUP_FROM_MAIN_WORKSPACE');
                if (input.action === 'create')
                    (0, http_js_1.json)(res, 200, (0, backup_js_1.createBackup)(directory));
                else if (input.action === 'restore')
                    (0, http_js_1.json)(res, 200, (0, backup_js_1.requestRestore)(directory, String(input.id ?? '')));
                else
                    throw Error('UNKNOWN_ACTION');
                return;
            }
            if (path === '/api/office/diagnostics') {
                (0, http_js_1.json)(res, 200, { checks: await (0, workspace_diagnostics_js_1.inspectEnvironment)(requestLanguage(req)) });
                return;
            }
            if (path === '/api/skills') {
                if (input.action === 'save')
                    (0, http_js_1.json)(res, 200, (({ dir: _dir, ...s }) => s)(skills.save(input.skill)));
                else if (input.action === 'reveal') {
                    (0, node_fs_1.mkdirSync)(skills.userDir, { recursive: true });
                    (0, windows_shell_js_1.revealFolder)(skills.userDir);
                    (0, http_js_1.json)(res, 200, { ok: true });
                }
                else
                    throw Error('UNKNOWN_ACTION');
                return;
            }
            if (path === '/api/web-search') {
                if (!options.web)
                    throw Error('WEB_UNAVAILABLE');
                if (input.action === 'save')
                    (0, http_js_1.json)(res, 200, options.web.save(input));
                else if (input.action === 'test')
                    (0, http_js_1.json)(res, 200, await options.web.test());
                else
                    throw Error('UNKNOWN_ACTION');
                return;
            }
            if (path === '/api/engines') {
                if (!options.engines)
                    throw Error('ENGINES_UNAVAILABLE');
                const result = await (0, engines_http_js_1.enginesCommand)(options.engines, input);
                office.refreshEngines?.();
                (0, http_js_1.json)(res, 200, result);
                return;
            }
            if (path === '/api/providers') {
                if (!options.api)
                    throw Error('API_MODELS_UNAVAILABLE');
                const result = await (0, providers_http_js_1.providersCommand)(options.api, validation_js_1.projectRoot, input);
                syncModels();
                (0, http_js_1.json)(res, 200, result);
                return;
            }
            if (path === '/api/model-servers') {
                if (!options.servers)
                    throw Error('SERVERS_UNAVAILABLE');
                const result = await (0, model_servers_http_js_1.serversCommand)(options.servers, input);
                syncModels();
                (0, http_js_1.json)(res, 200, result);
                return;
            }
            if (path === '/api/models') {
                if (input.action === 'download')
                    (0, http_js_1.json)(res, 202, downloads().start(String(input.id ?? '')));
                else if (input.action === 'download-link')
                    (0, http_js_1.json)(res, 202, downloads().startLink(String(input.url ?? ''), String(input.sha256 ?? '')));
                else if (input.action === 'cancel')
                    (0, http_js_1.json)(res, 200, downloads().cancel(String(input.id ?? '')));
                else if (input.action === 'dismiss')
                    (0, http_js_1.json)(res, 200, downloads().dismiss(String(input.id ?? '')));
                else if (input.action === 'reveal-folder') {
                    const folder = (0, node_path_1.resolve)(validation_js_1.projectRoot, local_models_js_1.modelFolder);
                    (0, node_fs_1.mkdirSync)(folder, { recursive: true });
                    (0, windows_shell_js_1.revealFolder)(folder);
                    (0, http_js_1.json)(res, 200, { ok: true });
                }
                else
                    throw Error('UNKNOWN_ACTION');
                return;
            }
            if (path === '/api/projects') {
                if (input.action === 'recover') {
                    const id = String(input.id);
                    (0, http_js_1.json)(res, 200, projects.recover(id, String(input.snapshotHash), { ...command, project_id: id }));
                    return;
                }
                if (input.action === 'create' || input.action === 'link') {
                    if (input.version !== 0)
                        throw Error('VERSION_CONFLICT');
                    const p = projects.create(String(input.name ?? ''), String(input.idea ?? ''), input.models, input.key, String(input.location ?? ''), input.action === 'link' ? 'linked' : 'created', input.roleIds, requestLanguage(req));
                    const opened = await projects.open(p.id).catch((error) => {
                        throw Error('PROJECT_OPEN_FAILED: ' + (error instanceof Error ? error.message : 'UNKNOWN'));
                    });
                    (0, http_js_1.json)(res, 200, { ...p, ...opened });
                    return;
                }
                if (input.action === 'open') {
                    (0, http_js_1.json)(res, 200, await projects.open(String(input.id)));
                    return;
                }
                if (input.action === 'unlink' && projects.unlink) {
                    const id = String(input.id);
                    // Removing the project this window serves would close the server answering the request.
                    if (options.projectId && id === options.projectId)
                        throw Error('UNLINK_CURRENT_PROJECT');
                    (0, http_js_1.json)(res, 200, await projects.unlink(id, Number(input.version), input.recycle === true, String(input.key)));
                    return;
                }
                if (input.action === 'reveal' && projects.reveal) {
                    projects.reveal(String(input.id));
                    (0, http_js_1.json)(res, 200, { ok: true });
                    return;
                }
                if (input.action === 'pick-folder') {
                    (0, http_js_1.json)(res, 200, { path: await (0, windows_shell_js_1.pickFolder)(String(input.initial ?? '')) });
                    return;
                }
                throw Error('UNKNOWN_ACTION');
            }
            if (path === '/api/office') {
                const result = (0, office_http_js_1.officeCommand)(input, command, office, changes, track);
                (0, http_js_1.json)(res, result.status, result.value);
                return;
            }
            if (path === '/api/tasks') {
                if (input.id !== undefined && typeof input.id !== 'string')
                    throw new Error('INVALID_TASK');
                (0, http_js_1.json)(res, 200, board.put('task', typeof input.id === 'string' ? input.id : null, { title: input.title, goal: input.goal, status: input.status }, command));
                return;
            }
            if (path === '/api/snapshot') {
                const snapshot = (0, workspace_js_2.captureWorkspace)(root, (0, workspace_js_2.readWorkspaceJson)((0, node_path_1.resolve)(root, 'experiments/workspace-scope.json')));
                (0, http_js_1.json)(res, 200, board.put('baseline', 'baseline', { snapshot }, command));
                return;
            }
            if (path === '/api/diff') {
                const baseline = board.list().find((d) => d.id === 'baseline');
                if (!baseline)
                    throw new Error('BASELINE_REQUIRED');
                (0, http_js_1.json)(res, 200, (0, workspace_js_2.compareWorkspace)(root, baseline.data.snapshot));
                return;
            }
            if (path === '/api/run') {
                if (input.version !== 0)
                    throw new Error('VERSION_CONFLICT');
                const scenario = String(input.scenario);
                if (!fixture_js_1.fixtureScenarios.some((value) => value === scenario))
                    throw new Error('INVALID_SCENARIO');
                if (jobs.size >= settings_js_1.webPolicy.maxConcurrentRuns)
                    throw new Error('RUN_CAPACITY');
                const task = (0, validation_js_1.readTask)((0, node_path_1.resolve)(validation_js_1.projectRoot, 'experiments/examples/task.example.json'));
                let id;
                const job = (0, runner_js_1.runTask)(store, task, {
                    scenario: scenario,
                    delayMs: settings_js_1.webPolicy.fixtureDelayMs,
                    idempotencyKey: input.key,
                    onStarted: (value) => {
                        id = value;
                    },
                });
                track(job);
                if (!id)
                    id = (await job).run.id;
                (0, http_js_1.json)(res, 202, { id });
                return;
            }
            if (path === '/api/cancel' || path === '/api/recover') {
                if (typeof input.id !== 'string')
                    throw new Error('INVALID_RUN');
                if (path === '/api/cancel')
                    store.requestCancel(input.id, command);
                else {
                    if (store.get(input.id).version !== input.version)
                        throw new Error('VERSION_CONFLICT');
                    store.recover(input.id);
                }
                (0, http_js_1.json)(res, 200, store.report(input.id));
                return;
            }
            (0, http_js_1.json)(res, 404, { error: 'NOT_FOUND' });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : '';
            const code = (0, office_http_js_1.clientErrorCode)(message);
            // Expected business errors are plain codes. Anything else is a defect worth seeing in the
            // server log; the client still only gets the generic code. Request bodies are never logged.
            if (code === 'REQUEST_FAILED')
                console.error(`[${new Date().toISOString()}] ${req.method} ${(req.url ?? '').split('?')[0]}: ${message.slice(0, 500)}`);
            (0, http_js_1.json)(res, 400, { error: code });
        }
    };
    const server = (0, node_http_1.createServer)(handle);
    office.mcpUrl = () => (0, mcp_http_js_1.mcpEndpoint)(server);
    // What the customer page actually loads (client.js and its imports), computed from the files.
    const clientModules = options.nativeCompanion ? new Set() : (0, assets_js_1.moduleGraph)(validation_js_1.projectRoot, '/client.js');
    const clientServer = (0, node_http_1.createServer)((req, res) => {
        // handle() routes on the URL-normalized pathname, so the allowlist must judge the same value.
        // Any path the parser would rewrite (dot segments, encoded separators) is rejected outright.
        const raw = (req.url ?? '/').split('?')[0];
        const path = new URL(raw, 'http://client.invalid').pathname;
        if (raw !== path ||
            /%2e|%2f|%5c/i.test(raw) ||
            (!path.startsWith('/api/client/') &&
                path !== '/client.html' &&
                path !== '/style.css' &&
                !path.startsWith('/styles/') &&
                !clientModules.has(path) &&
                path !== '/fonts/PretendardVariable.woff2' &&
                path !== '/fonts/OFL-Pretendard.txt' &&
                path !== '/vendor/markdown.LICENSE.txt')) {
            (0, http_js_1.json)(res, 403, { error: 'ACCESS_DENIED' });
            return;
        }
        void handle(req, res);
    });
    const stop = (http) => http.listening
        ? new Promise((done, reject) => http.close((e) => (e ? reject(e) : done())))
        : Promise.resolve();
    return {
        server,
        clientServer,
        office,
        changes,
        close: async () => {
            await Promise.all([stop(server), stop(clientServer)]);
            await changes.close();
            await Promise.allSettled([...jobs]);
            await office.close();
            await Promise.allSettled([...opening.values()]);
            for (const child of children.values()) {
                await stop(child.preview);
                await child.app.close();
            }
            if (!options.model)
                await sharedModel.close();
            catalog?.close();
            board.close();
            documents.close();
            clearInterval(nativeScheduleTimer);
            social.close();
            presence.close();
            codexChat.close();
            store.close();
        },
    };
}
if (require.main === module)
    void startServer().then((started) => {
        if (!started)
            process.exitCode = 1;
    });
/**
 * Starts the owner and client servers. Used by `node dist/src/web/server.js` and by the installed
 * launcher (scripts/package/launcher.cjs), which loads this file from disk. Returns the owner URL,
 * or null when the owner server could not start.
 */
async function startServer() {
    await (0, loopback_js_1.chooseLoopback)();
    const product = (0, product_js_1.loadProductConfig)();
    const apiSettings = new api_model_settings_js_1.ApiModelSettings((0, node_path_1.resolve)(validation_js_1.projectRoot, settings_js_1.webPolicy.storageDirectory));
    const credentials = new credentials_js_1.CredentialStore();
    const app = createPrototype(validation_js_1.projectRoot, undefined, product, {
        // Installed: next to AIOrchestra.exe (launcher sets it). Development: <repo>/workspace.
        workspace: process.env.AIORCHESTRA_WORKSPACE || (0, node_path_1.resolve)(validation_js_1.projectRoot, 'workspace'),
        api: { settings: apiSettings, credentials },
        servers: {
            settings: new model_servers_js_1.ModelServerSettings((0, node_path_1.resolve)(validation_js_1.projectRoot, settings_js_1.webPolicy.storageDirectory)),
            credentials,
            ledger: apiSettings,
        },
        web: new web_access_js_1.WebAccess((0, node_path_1.resolve)(validation_js_1.projectRoot, settings_js_1.webPolicy.storageDirectory)),
        engines: { registry: new engine_settings_js_1.EngineRegistry((0, node_path_1.resolve)(validation_js_1.projectRoot, settings_js_1.webPolicy.storageDirectory)) },
    });
    const port = Number(process.env.AIORCHESTRA_PORT ?? product.server.port);
    let url;
    try {
        url = `http://${await (0, loopback_js_1.listenLoopback)(app.server, port)}:${port}`;
        console.log(`${product.display.name} ${url}`);
    }
    catch {
        console.error('SERVER_START_FAILED');
        await app.close();
        return null;
    }
    try {
        console.log(`고객 검토 http://${await (0, loopback_js_1.listenLoopback)(app.clientServer, port + 1)}:${port + 1}/client.html`);
    }
    catch {
        console.error('CLIENT_SERVER_START_FAILED');
    }
    for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, () => {
            void app.close().then(() => process.exit(0));
        });
    return url;
}
//# sourceMappingURL=server.js.map