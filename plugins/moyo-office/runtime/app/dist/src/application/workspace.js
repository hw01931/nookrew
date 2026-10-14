"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readWorkspaceJson = readWorkspaceJson;
exports.captureWorkspace = captureWorkspace;
exports.parseSnapshot = parseSnapshot;
exports.compareWorkspace = compareWorkspace;
const node_fs_1 = require("node:fs");
const workspace_js_1 = require("../adapters/workspace.js");
const workspace_js_2 = require("../domain/workspace.js");
const hash_js_1 = require("../infrastructure/hash.js");
function readWorkspaceJson(path) {
    try {
        return JSON.parse((0, node_fs_1.readFileSync)(path, 'utf8').replace(/^\uFEFF/, ''));
    }
    catch {
        throw new Error('WORKSPACE_JSON_READ_ERROR');
    }
}
function captureWorkspace(root, scopeInput, scan = workspace_js_1.scanWorkspace) {
    const scope = (0, workspace_js_2.parseScope)(scopeInput);
    const first = scan(root, scope);
    const second = scan(root, scope);
    if ((0, hash_js_1.hash)(first) !== (0, hash_js_1.hash)(second))
        throw new Error('WORKSPACE_CHANGED_DURING_SCAN');
    const body = {
        schema_version: 1,
        kind: 'workspace-inventory-v1',
        scope,
        files: first.files,
    };
    return { ...body, snapshot_hash: (0, hash_js_1.hash)(body) };
}
function parseSnapshot(input) {
    if (!input ||
        typeof input !== 'object' ||
        Object.keys(input).sort().join(',') !== 'files,kind,schema_version,scope,snapshot_hash')
        throw new Error('INVALID_WORKSPACE_SNAPSHOT');
    const snapshot = input;
    (0, workspace_js_2.validateInventory)(snapshot);
    const { snapshot_hash, ...body } = snapshot;
    if ((0, hash_js_1.hash)(body) !== snapshot_hash)
        throw new Error('WORKSPACE_SNAPSHOT_INTEGRITY_ERROR');
    return structuredClone(snapshot);
}
function compareWorkspace(root, input) {
    const before = parseSnapshot(input);
    const after = captureWorkspace(root, before.scope);
    return {
        schema_version: 1,
        kind: 'workspace-diff-v1',
        base_hash: before.snapshot_hash,
        current_hash: after.snapshot_hash,
        changes: (0, workspace_js_2.inventoryChanges)(before, after),
        integration: 'NOT_REQUESTED',
        scope: before.scope,
    };
}
//# sourceMappingURL=workspace.js.map