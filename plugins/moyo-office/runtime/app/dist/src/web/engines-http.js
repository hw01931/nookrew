"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enginesView = enginesView;
exports.enginesCommand = enginesCommand;
const engine_registry_js_1 = require("../domain/engine-registry.js");
const workspace_engine_js_1 = require("../adapters/workspace-engine.js");
function enginesView(services) {
    const find = services.find ?? ((name) => (0, workspace_engine_js_1.findOnPath)(name));
    let registered = [], error = '';
    try {
        registered = services.registry.read();
    }
    catch (e) {
        error = e instanceof Error ? e.message : 'INVALID_ENGINE_SETTINGS';
    }
    return {
        templates: engine_registry_js_1.engineTemplateIds.map((id) => ({
            id,
            commands: engine_registry_js_1.engineTemplates[id].commands,
            models: engine_registry_js_1.engineTemplates[id].models,
            effort: engine_registry_js_1.engineTemplates[id].effort,
            // What will actually run, so the owner sees the exact command before registering.
            args: (0, engine_registry_js_1.engineRunArgs)(id),
            detected: engine_registry_js_1.engineTemplates[id].commands.map(find).find((p) => !!p) ?? null,
        })),
        registered,
        bounds: engine_registry_js_1.engineBounds,
        efforts: engine_registry_js_1.engineEfforts,
        error,
    };
}
async function enginesCommand(services, input) {
    switch (input.action) {
        case 'engine-put':
            return services.registry.put(input.engine);
        case 'engine-remove':
            return services.registry.remove(String(input.id ?? ''));
        case 'probe': {
            // Only a registered engine's own executable, never a path typed into this request.
            const engine = services.registry.read().find((e) => e.id === input.id);
            if (!engine)
                throw Error('ENGINE_NOT_FOUND');
            return { version: await (services.probe ?? workspace_engine_js_1.probeVersion)(engine.executable) };
        }
        default:
            throw Error('UNKNOWN_ACTION');
    }
}
//# sourceMappingURL=engines-http.js.map