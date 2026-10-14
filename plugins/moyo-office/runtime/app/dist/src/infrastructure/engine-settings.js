"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectEngineSettings = exports.EngineRegistry = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const engine_registry_js_1 = require("../domain/engine-registry.js");
const json_file_js_1 = require("./json-file.js");
/**
 * Engines the owner registered (ADR 0065). Shared by every project of this app, like the API model
 * settings. No secrets: the CLIs keep their own sign-in.
 */
class EngineRegistry {
    isFile;
    file;
    constructor(directory, isFile = (p) => (0, node_fs_1.existsSync)(p) && (0, node_fs_1.statSync)(p).isFile()) {
        this.isFile = isFile;
        this.file = (0, node_path_1.resolve)(directory, 'engine-registry.json');
    }
    read() {
        if (!(0, node_fs_1.existsSync)(this.file))
            return [];
        const data = JSON.parse((0, node_fs_1.readFileSync)(this.file, 'utf8'));
        if (data.schemaVersion !== 1 || !Array.isArray(data.engines))
            throw Error('INVALID_ENGINE_SETTINGS');
        return data.engines.flatMap((e) => {
            try {
                return [(0, engine_registry_js_1.validateRegistration)(e)];
            }
            catch {
                return [];
            }
        });
    }
    put(input) {
        const engine = (0, engine_registry_js_1.validateRegistration)(input);
        if (!this.isFile(engine.executable))
            throw Error('ENGINE_EXECUTABLE_MISSING');
        const engines = [...this.read().filter((e) => e.id !== engine.id), engine];
        if (engines.length > engine_registry_js_1.engineBounds.maxEngines)
            throw Error('ENGINE_LIMIT');
        (0, json_file_js_1.writeJsonFile)(this.file, { schemaVersion: 1, engines });
        return engine;
    }
    remove(id) {
        (0, json_file_js_1.writeJsonFile)(this.file, { schemaVersion: 1, engines: this.read().filter((e) => e.id !== id) });
        return { removed: true };
    }
}
exports.EngineRegistry = EngineRegistry;
class ProjectEngineSettings {
    file;
    constructor(directory) {
        this.file = (0, node_path_1.resolve)(directory, 'engine-consent.json');
    }
    read() {
        if (!(0, node_fs_1.existsSync)(this.file))
            return { developEngine: '', consents: [] };
        const data = JSON.parse((0, node_fs_1.readFileSync)(this.file, 'utf8'));
        if (data.schemaVersion !== 1 || !Array.isArray(data.consents) || typeof data.developEngine !== 'string')
            throw Error('INVALID_ENGINE_SETTINGS');
        return { developEngine: data.developEngine, consents: data.consents };
    }
    write(state) {
        (0, json_file_js_1.writeJsonFile)(this.file, { schemaVersion: 1, ...state });
    }
    grant(engine, at = new Date().toISOString()) {
        const state = this.read();
        const consent = { engineId: engine.id, executable: engine.executable, grantedAt: at };
        this.write({ ...state, consents: [...state.consents.filter((c) => c.engineId !== engine.id), consent] });
        return consent;
    }
    revoke(engineId) {
        const state = this.read();
        this.write({
            developEngine: state.developEngine === engineId ? '' : state.developEngine,
            consents: state.consents.filter((c) => c.engineId !== engineId),
        });
        return { revoked: true };
    }
    setDevelopEngine(engineId) {
        this.write({ ...this.read(), developEngine: engineId });
        return { developEngine: engineId };
    }
}
exports.ProjectEngineSettings = ProjectEngineSettings;
//# sourceMappingURL=engine-settings.js.map