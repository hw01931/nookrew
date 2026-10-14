"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanWorkspace = scanWorkspace;
const hash_js_1 = require("../infrastructure/hash.js");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const workspace_js_1 = require("../domain/workspace.js");
const task_js_1 = require("../domain/task.js");
// Read-only inventory for a quiescent, trusted workspace. This is not a sandbox.
function scanWorkspace(rootInput, inputScope) {
    const scope = (0, workspace_js_1.parseScope)(inputScope);
    const requested = (0, node_path_1.resolve)(rootInput);
    if ((0, node_fs_1.lstatSync)(requested).isSymbolicLink())
        throw new Error('WORKSPACE_LINK_DENIED');
    const root = (0, node_fs_1.realpathSync)(requested);
    if (!(0, node_fs_1.lstatSync)(root).isDirectory())
        throw new Error('WORKSPACE_DIRECTORY_REQUIRED');
    const files = [];
    const names = new Set();
    let total = 0;
    const inside = (absolute) => {
        const rel = (0, node_path_1.relative)(root, (0, node_fs_1.realpathSync)(absolute));
        if ((0, node_path_1.isAbsolute)(rel) || rel === '..' || rel.startsWith('..' + node_path_1.sep))
            throw new Error('WORKSPACE_ESCAPE');
    };
    const visit = (path, recurse) => {
        if (!(0, task_js_1.safeRelativePath)(path))
            throw new Error('UNSAFE_WORKSPACE_PATH');
        if ((0, workspace_js_1.protectedPath)(path) ||
            scope.exclude.some((p) => (0, task_js_1.pathMatches)(path, p) || (p.endsWith('/**') && p.slice(0, -3).toLowerCase() === path.toLowerCase())))
            return;
        const absolute = (0, node_path_1.resolve)(root, path);
        let stat;
        try {
            // Check every ancestor, including when include names one deep file.
            let cursor = root;
            for (const part of path.split('/')) {
                cursor = (0, node_path_1.resolve)(cursor, part);
                if ((0, node_fs_1.lstatSync)(cursor).isSymbolicLink())
                    throw new Error('WORKSPACE_LINK_DENIED');
                inside(cursor);
            }
            stat = (0, node_fs_1.lstatSync)(absolute);
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return;
            throw error;
        }
        if (stat.isDirectory()) {
            if (!recurse)
                throw new Error('WORKSPACE_DIRECTORY_NEEDS_GLOB');
            for (const name of (0, node_fs_1.readdirSync)(absolute).sort())
                visit(path + '/' + name, true);
            return;
        }
        if (!stat.isFile())
            throw new Error('WORKSPACE_FILE_TYPE_UNSUPPORTED');
        if (!(0, workspace_js_1.selectedPath)(scope, path))
            return;
        if (names.has(path.toLowerCase())) {
            if (files.some((f) => f.path === path))
                return; // overlapping include patterns
            throw new Error('WORKSPACE_CASE_COLLISION');
        }
        if (stat.nlink !== 1)
            throw new Error('WORKSPACE_HARDLINK_DENIED');
        if (stat.size > workspace_js_1.WORKSPACE_LIMITS.file_bytes ||
            total + stat.size > workspace_js_1.WORKSPACE_LIMITS.total_bytes ||
            files.length >= workspace_js_1.WORKSPACE_LIMITS.files)
            throw new Error('WORKSPACE_SIZE_LIMIT');
        const fd = (0, node_fs_1.openSync)(absolute, 'r');
        try {
            const before = (0, node_fs_1.fstatSync)(fd);
            if (!before.isFile() ||
                before.nlink !== 1 ||
                before.ino !== stat.ino ||
                before.dev !== stat.dev ||
                before.size !== stat.size)
                throw new Error('WORKSPACE_CHANGED_DURING_SCAN');
            const buffer = Buffer.alloc(before.size + 1);
            let length = 0;
            while (length < buffer.length) {
                const got = (0, node_fs_1.readSync)(fd, buffer, length, buffer.length - length, null);
                if (!got)
                    break;
                length += got;
            }
            const data = buffer.subarray(0, length);
            const after = (0, node_fs_1.fstatSync)(fd);
            inside(absolute);
            const final = (0, node_fs_1.lstatSync)(absolute);
            if (final.isSymbolicLink() ||
                final.nlink !== 1 ||
                after.nlink !== 1 ||
                final.ino !== before.ino ||
                final.dev !== before.dev ||
                before.size !== data.length ||
                before.size !== after.size ||
                before.mtimeMs !== after.mtimeMs ||
                before.ctimeMs !== after.ctimeMs)
                throw new Error('WORKSPACE_CHANGED_DURING_SCAN');
            files.push({ path, bytes: data.length, sha256: (0, hash_js_1.sha256)(data) });
            names.add(path.toLowerCase());
            total += data.length;
        }
        finally {
            (0, node_fs_1.closeSync)(fd);
        }
    };
    for (const pattern of scope.include)
        visit(pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern, pattern.endsWith('/**'));
    return { files: files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
}
//# sourceMappingURL=workspace.js.map