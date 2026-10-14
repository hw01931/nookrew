"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.presetsFor = presetsFor;
const node_path_1 = require("node:path");
const json_file_js_1 = require("./json-file.js");
/**
 * The seeded teams and role presets in a project's language (ADR 0062). Korean is
 * config/collaboration.json itself; other languages overlay its text from config/presets.<lang>.json,
 * keeping ids, tools and models. A role missing from an overlay stays in Korean.
 */
function presetsFor(root, config) {
    const overlays = {
        en: (0, json_file_js_1.readJsonFile)((0, node_path_1.resolve)(root, 'config/presets.en.json')),
    };
    const cache = new Map();
    return (lang) => {
        const overlay = overlays[lang];
        if (!overlay)
            return config;
        if (!cache.has(lang))
            cache.set(lang, {
                ...config,
                teams: config.teams.map((t) => ({ ...t, ...overlay.teams[t.role] })),
                ...(config.rolePresets
                    ? { rolePresets: config.rolePresets.map((p) => ({ ...p, ...overlay.rolePresets[p.id] })) }
                    : {}),
                ...(config.staffingPresets
                    ? {
                        staffingPresets: config.staffingPresets.map((s) => ({
                            ...s,
                            label: overlay.staffingPresets[s.id] ?? s.label,
                        })),
                    }
                    : {}),
            });
        return cache.get(lang);
    };
}
//# sourceMappingURL=presets.js.map