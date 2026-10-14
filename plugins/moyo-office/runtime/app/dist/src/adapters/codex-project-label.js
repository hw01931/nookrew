"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.codexProjectLabel = codexProjectLabel;
exports.projectLabelFromState = projectLabelFromState;
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
/** Desktop metadata is optional, read-only and version-dependent. Never return its other fields. */
function codexProjectLabel(root, fallback) {
    try {
        const file = (0, node_path_1.resolve)(process.env.CODEX_HOME || (0, node_path_1.resolve)((0, node_os_1.homedir)(), '.codex'), '.codex-global-state.json');
        if ((0, node_fs_1.statSync)(file).size > 4 * 1024 * 1024)
            return fallback;
        return projectLabelFromState(JSON.parse((0, node_fs_1.readFileSync)(file, 'utf8')), root) || fallback;
    }
    catch {
        return fallback;
    }
}
function projectLabelFromState(state, root) {
    if (!state || typeof state !== 'object')
        return null;
    const projects = state['local-projects'];
    if (!projects || typeof projects !== 'object' || Array.isArray(projects))
        return null;
    const matching = Object.values(projects).filter((p) => Array.isArray(p?.rootPaths) &&
        p.rootPaths.some((r) => typeof r === 'string' && (0, node_path_1.resolve)(r).toLowerCase() === (0, node_path_1.resolve)(root).toLowerCase()));
    if (matching.length !== 1)
        return null;
    const name = matching[0]?.name;
    return typeof name === 'string' && name.trim() && name.length <= 80 && !/[\u0000-\u001f]/.test(name)
        ? name
        : null;
}
//# sourceMappingURL=codex-project-label.js.map