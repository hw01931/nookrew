"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectCatalog = void 0;
const project_seed_js_1 = require("./project-seed.js");
const sqlite_js_1 = require("./sqlite.js");
const command_js_1 = require("../domain/command.js");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const local_path_js_1 = require("./local-path.js");
const workspace_js_1 = require("../domain/workspace.js");
const hash_js_1 = require("./hash.js");
const language_js_1 = require("../domain/language.js");
/** Only owner commands register explicit local paths. Employee tools never register roots. */
class ProjectCatalog {
    directory;
    config;
    workspace;
    localized;
    db;
    constructor(directory, config, 
    /** Where new projects go when no folder is chosen: <workspace>/myproject1, 2, … (2026-10-07). */
    workspace, 
    /** Seeded teams and presets in a language (ADR 0062); default: the config as it is. */
    localized = () => config) {
        this.directory = directory;
        this.config = config;
        this.workspace = workspace;
        this.localized = localized;
        (0, node_fs_1.mkdirSync)(directory, { recursive: true });
        if ((0, node_fs_1.lstatSync)(directory).isSymbolicLink())
            throw Error('PATH_DENIED');
        this.db = (0, sqlite_js_1.openDatabase)((0, node_path_1.resolve)(directory, 'catalog.db'));
        this.db.exec('CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS project_recoveries(key TEXT PRIMARY KEY, hash TEXT NOT NULL, json TEXT NOT NULL)');
    }
    list() {
        return this.db
            .prepare('SELECT json FROM projects ORDER BY rowid')
            .all()
            .map((r) => JSON.parse(String(r.json)));
    }
    get(id) {
        const p = this.list().find((p) => p.id === id);
        if (!p)
            throw Error('PROJECT_NOT_FOUND');
        return p;
    }
    root(id) {
        if (!/^[a-f0-9]{24}$/.test(id))
            throw Error('PATH_DENIED');
        const project = this.list().find((p) => p.id === id);
        if (project?.location)
            return (0, local_path_js_1.localDirectory)(project.location);
        const root = (0, node_path_1.resolve)(this.directory, id);
        if ((0, node_fs_1.existsSync)(root) &&
            ((0, node_fs_1.lstatSync)(root).isSymbolicLink() ||
                (0, node_path_1.relative)((0, node_fs_1.realpathSync)(this.directory), (0, node_fs_1.realpathSync)(root)).startsWith('..')))
            throw Error('PATH_DENIED');
        return root;
    }
    /** The folder a new project gets when the owner does not choose one. */
    nextLocation() {
        if (!this.workspace)
            return null;
        const used = new Set(this.list().map((p) => (p.location ?? '').toLowerCase()));
        for (let n = 1; n < 10000; n++) {
            const path = (0, node_path_1.resolve)(this.workspace, 'myproject' + n);
            if (!(0, node_fs_1.existsSync)(path) && !used.has(path.toLowerCase()))
                return path;
        }
        throw Error('WORKSPACE_FULL');
    }
    /**
     * Remove a project from the list. Its folder and files stay; linking the folder again brings the
     * code back (records of the old connection are not restored).
     */
    unlink(id, version) {
        const p = this.get(id);
        if ((p.version ?? 1) !== version)
            throw Error('VERSION_CONFLICT');
        const location = p.location ? this.root(id) : null;
        this.db.prepare('DELETE FROM projects WHERE id=?').run(id);
        return { id, removed: true, location };
    }
    /** Only folders this app created inside its workspace may be sent to the recycle bin. */
    ownedFolder(id) {
        const p = this.get(id);
        if (p.kind !== 'created' || !p.location || !this.workspace || !(0, node_fs_1.existsSync)(p.location))
            return null;
        const folder = (0, local_path_js_1.localDirectory)(p.location);
        const rel = (0, node_path_1.relative)((0, node_fs_1.realpathSync)(this.workspace), (0, node_fs_1.realpathSync)(folder));
        // A direct child of the workspace; a different drive or anything nested is refused.
        return rel === (0, node_path_1.basename)(folder) ? folder : null;
    }
    stateDirectory(id) {
        this.get(id);
        return (0, node_path_1.resolve)(this.directory, id, 'state');
    }
    create(name, idea, models, key, location = '', kind = 'created', roleIds, lang = 'ko') {
        const presets = this.localized(lang);
        if (name.length > 120 ||
            !idea.trim() ||
            idea.length > 4000 ||
            !key ||
            key.length > command_js_1.idempotencyKeyMaxLength)
            throw Error('INVALID_PROJECT');
        const id = (0, hash_js_1.hash)(['project', key]).slice(0, 24), requestHash = (0, hash_js_1.hash)({
            name,
            idea,
            models,
            ...(roleIds ? { roleIds } : {}),
            ...(location ? { location, kind } : {}),
            ...(lang !== 'ko' ? { language: lang } : {}),
        }), prior = this.db.prepare('SELECT request_hash,json FROM projects WHERE id=?').get(id);
        if (prior) {
            if (prior.request_hash !== requestHash)
                throw Error('IDEMPOTENCY_CONFLICT');
            return JSON.parse(String(prior.json));
        }
        if (roleIds !== undefined &&
            (!Array.isArray(roleIds) ||
                !roleIds.length ||
                roleIds.length > 20 ||
                new Set(roleIds).size !== roleIds.length ||
                roleIds.some((id) => !presets.rolePresets?.some((r) => r.id === id))))
            throw Error('INVALID_STAFFING');
        const templates = roleIds
            ? roleIds.map((id) => presets.rolePresets.find((r) => r.id === id))
            : presets.teams;
        if (!models ||
            typeof models !== 'object' ||
            Array.isArray(models) ||
            Object.keys(models).some((role) => !templates.some((t) => t.role === role)))
            throw Error('INVALID_MODEL_ASSIGNMENT');
        for (const id of Object.values(models))
            if (!(this.config.models ?? [this.config.runtime]).some((m) => m.modelId === id))
                throw Error('MODEL_UNAVAILABLE');
        const existingDirectory = (path) => {
            try {
                return (0, local_path_js_1.localDirectory)(path);
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    throw Error('DIRECTORY_NOT_FOUND');
                throw error;
            }
        };
        let target = '';
        if (kind === 'created' && !location && this.workspace) {
            (0, node_fs_1.mkdirSync)(this.workspace, { recursive: true });
            location = this.nextLocation();
        }
        if (location && (0, workspace_js_1.sensitivePath)(location))
            throw Error('SENSITIVE_DIRECTORY');
        if (kind === 'linked')
            target = existingDirectory(location);
        else if (location) {
            existingDirectory((0, node_path_1.dirname)(location));
            target = (0, node_path_1.resolve)(location);
            if ((0, node_fs_1.existsSync)(target))
                throw Error('DIRECTORY_EXISTS');
        }
        if (target &&
            this.list().some((p) => p.status === 'READY' && this.root(p.id).toLowerCase() === target.toLowerCase()))
            throw Error('PROJECT_ALREADY_CONNECTED');
        if (!name.trim() && !target)
            throw Error('INVALID_PROJECT');
        const project = {
            id,
            name: name.trim() || (0, node_path_1.basename)(target),
            idea,
            models,
            version: 1,
            ...(kind === 'created' ? { creationManifest: (0, project_seed_js_1.seedManifest)(idea, lang) } : {}),
            ...(roleIds ? { roleIds: [...roleIds], teamSnapshot: structuredClone(templates) } : {}),
            ...(lang !== 'ko' ? { language: lang } : {}),
            status: 'UNKNOWN',
            createdAt: new Date().toISOString(),
            kind,
            ...(target ? { location: target } : {}),
        };
        this.db.prepare('INSERT INTO projects VALUES(?,?,?)').run(id, requestHash, JSON.stringify(project));
        if (kind === 'linked') {
            project.status = 'READY';
            this.db.prepare('UPDATE projects SET json=? WHERE id=?').run(JSON.stringify(project), id);
            return project;
        }
        const root = target || this.root(id);
        (0, node_fs_1.mkdirSync)(root);
        for (const folder of project_seed_js_1.seedDirectories)
            (0, node_fs_1.mkdirSync)((0, node_path_1.resolve)(root, folder));
        for (const [path, content] of Object.entries((0, project_seed_js_1.projectSeed)(idea, lang)))
            (0, node_fs_1.writeFileSync)((0, node_path_1.resolve)(root, path), content, { flag: 'wx' });
        project.status = 'READY';
        this.db.prepare('UPDATE projects SET json=? WHERE id=?').run(JSON.stringify(project), id);
        return project;
    }
    request(key) {
        if (!key || key.length > command_js_1.idempotencyKeyMaxLength)
            throw Error('INVALID_REQUEST_KEY');
        const p = this.list().find((p) => p.id === (0, hash_js_1.hash)(['project', key]).slice(0, 24));
        return p
            ? { status: p.status, inspection: this.inspect(p.id) }
            : { status: 'NOT_RECEIVED', inspection: null };
    }
    inspect(id) {
        const p = this.get(id);
        let inspection;
        try {
            inspection = (0, project_seed_js_1.inspectSeed)(this.root(id), p.creationManifest);
        }
        catch {
            inspection = {
                status: 'FAIL',
                checks: [{ path: '.', status: 'FAIL', reason: 'ROOT_UNAVAILABLE_OR_UNSAFE' }],
            };
        }
        const evidence = {
            id: p.id,
            version: p.version ?? 1,
            projectStatus: p.status,
            name: p.name,
            ...inspection,
        };
        return {
            ...evidence,
            snapshotHash: (0, hash_js_1.hash)(evidence),
            canRecover: p.status === 'UNKNOWN' && p.kind === 'created' && inspection.status === 'PASS',
        };
    }
    recover(id, snapshotHash, command) {
        (0, command_js_1.assertCommand)(command, { actor: 'local-user', project: id, minVersion: 1 });
        const key = (0, hash_js_1.hash)([id, command.actor, command.idempotency_key]), fingerprint = (0, hash_js_1.hash)([id, snapshotHash, command.expected_version]);
        return (0, sqlite_js_1.transaction)(this.db, () => {
            const prior = this.db.prepare('SELECT * FROM project_recoveries WHERE key=?').get(key);
            if (prior) {
                if (prior.hash !== fingerprint)
                    throw Error('IDEMPOTENCY_CONFLICT');
                return JSON.parse(String(prior.json)).result;
            }
            const p = this.get(id);
            if ((p.version ?? 1) !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            const checked = this.inspect(id);
            if (checked.snapshotHash !== snapshotHash)
                throw Error('SOURCE_CHANGED');
            if (!checked.canRecover)
                throw Error('PROJECT_NOT_RECOVERABLE');
            const result = { ...p, status: 'READY', version: (p.version ?? 1) + 1 };
            this.db.prepare('UPDATE projects SET json=? WHERE id=?').run(JSON.stringify(result), id);
            this.db
                .prepare('INSERT INTO project_recoveries VALUES(?,?,?)')
                .run(key, fingerprint, JSON.stringify({ command, evidence: checked, result, at: new Date().toISOString() }));
            return result;
        });
    }
    configFor(project) {
        const presets = this.localized((0, language_js_1.language)(project.language));
        return {
            ...presets,
            teams: (project.teamSnapshot ?? presets.teams).map((t) => ({
                ...t,
                modelId: project.models[t.role] ?? t.modelId ?? this.config.runtime.modelId,
            })),
        };
    }
    close() {
        this.db.close();
    }
}
exports.ProjectCatalog = ProjectCatalog;
//# sourceMappingURL=project-catalog.js.map