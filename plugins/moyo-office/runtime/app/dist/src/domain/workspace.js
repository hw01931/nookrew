"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKSPACE_LIMITS = void 0;
exports.sensitivePath = sensitivePath;
exports.protectedPath = protectedPath;
exports.parseScope = parseScope;
exports.selectedPath = selectedPath;
exports.validateInventory = validateInventory;
exports.inventoryChanges = inventoryChanges;
const task_js_1 = require("./task.js");
exports.WORKSPACE_LIMITS = { files: 10_000, file_bytes: 10_000_000, total_bytes: 100_000_000 };
// Single owner of path-name policy. Name checks complement, not replace, realpath/symlink checks.
const credentialNames = new Set([
    'secrets',
    '.ssh',
    '.aws',
    '.aiorchestra',
    '.codex',
    '.agents',
    '.npmrc',
    '.netrc',
    '.pypirc',
]);
const toolingNames = new Set(['.git', '.venv', 'node_modules', 'local-lab']);
const parts = (path) => path.toLowerCase().split(/[\\/]/);
/** A path segment that holds or may hold credentials. Nobody reads these through the product. */
function credentialPathPart(part) {
    return (credentialNames.has(part) ||
        part.startsWith('.env') ||
        /\.(pem|key|p12|pfx)$/.test(part) ||
        /^id_(rsa|ed25519|ecdsa)/.test(part));
}
function sensitivePath(path) {
    return parts(path).some(credentialPathPart);
}
/** Never inside a workspace scope or an employee change: credentials plus tooling/runtime state. */
function protectedPath(path) {
    return parts(path).some((part) => credentialPathPart(part) || toolingNames.has(part));
}
function parseScope(value) {
    const obj = value;
    if (!obj ||
        typeof obj !== 'object' ||
        Object.keys(obj).sort().join(',') !== 'exclude,include,schema_version' ||
        obj.schema_version !== 1 ||
        !Array.isArray(obj.include) ||
        !Array.isArray(obj.exclude) ||
        !obj.include.length ||
        obj.include.length + obj.exclude.length > 100)
        throw new Error('INVALID_WORKSPACE_SCOPE');
    for (const list of [obj.include, obj.exclude]) {
        if (list.some((p) => typeof p !== 'string' || !(0, task_js_1.safeRelativePath)(p, true)) ||
            new Set(list.map((p) => p.toLowerCase())).size !== list.length)
            throw new Error('INVALID_WORKSPACE_SCOPE');
    }
    if (obj.include.some(protectedPath))
        throw new Error('PROTECTED_WORKSPACE_SCOPE');
    return structuredClone(obj);
}
function selectedPath(scope, path) {
    return ((0, task_js_1.safeRelativePath)(path) &&
        !protectedPath(path) &&
        scope.include.some((p) => (0, task_js_1.pathMatches)(path, p)) &&
        !scope.exclude.some((p) => (0, task_js_1.pathMatches)(path, p)));
}
function validateInventory(snapshot) {
    const scope = parseScope(snapshot.scope);
    if (snapshot.schema_version !== 1 ||
        snapshot.kind !== 'workspace-inventory-v1' ||
        !Array.isArray(snapshot.files) ||
        snapshot.files.length > exports.WORKSPACE_LIMITS.files ||
        !/^[a-f0-9]{64}$/.test(snapshot.snapshot_hash))
        throw new Error('INVALID_WORKSPACE_SNAPSHOT');
    const names = new Set();
    let bytes = 0;
    for (const file of snapshot.files) {
        if (!file ||
            Object.keys(file).sort().join(',') !== 'bytes,path,sha256' ||
            typeof file.path !== 'string' ||
            !selectedPath(scope, file.path) ||
            !/^[a-f0-9]{64}$/.test(file.sha256) ||
            !Number.isSafeInteger(file.bytes) ||
            file.bytes < 0 ||
            file.bytes > exports.WORKSPACE_LIMITS.file_bytes ||
            names.has(file.path.toLowerCase())) {
            throw new Error('INVALID_WORKSPACE_SNAPSHOT');
        }
        names.add(file.path.toLowerCase());
        bytes += file.bytes;
    }
    if (bytes > exports.WORKSPACE_LIMITS.total_bytes)
        throw new Error('WORKSPACE_SIZE_LIMIT');
}
function inventoryChanges(before, after) {
    validateInventory(before);
    validateInventory(after);
    const old = new Map(before.files.map((f) => [f.path, f]));
    const next = new Map(after.files.map((f) => [f.path, f]));
    const paths = [...new Set([...old.keys(), ...next.keys()])].sort();
    return paths.flatMap((path) => {
        const a = old.get(path);
        const b = next.get(path);
        const kind = !a
            ? 'ADDED'
            : !b
                ? 'DELETED'
                : a.sha256 !== b.sha256 || a.bytes !== b.bytes
                    ? 'MODIFIED'
                    : null;
        return kind ? [{ path, kind, before: a ?? null, after: b ?? null }] : [];
    });
}
//# sourceMappingURL=workspace.js.map