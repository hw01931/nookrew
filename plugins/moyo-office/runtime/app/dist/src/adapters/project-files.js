"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectFiles = exports.fileBrowserLimits = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const task_js_1 = require("../domain/task.js");
const workspace_js_1 = require("../domain/workspace.js");
const local_path_js_1 = require("../infrastructure/local-path.js");
exports.fileBrowserLimits = { page: 200, previewBytes: 256 * 1024 };
/** Owner-only read surface. This does not enlarge employee tool scope. */
class ProjectFiles {
    root;
    constructor(root) {
        this.root = root;
    }
    library() {
        const documents = [];
        let visited = 0, limited = false;
        const walk = (path, category, depth) => {
            if (++visited > 300 || depth > 6 || documents.length >= 500) {
                limited = true;
                return;
            }
            const listing = this.list(path);
            if (listing.next !== null)
                limited = true;
            for (const entry of listing.entries) {
                if (entry.blocked ||
                    entry.name.startsWith('.') ||
                    ['history', 'node_modules', 'local-lab', 'experiments'].includes(entry.name))
                    continue;
                if (entry.kind === 'directory')
                    walk(entry.path, category, depth + 1);
                else if (/\.(md|txt|pdf|docx|xlsx|csv|pptx|svg|png|jpg|webp)$/i.test(entry.name) &&
                    documents.length < 500) {
                    try {
                        const stat = (0, node_fs_1.lstatSync)(this.target(entry.path));
                        if (!stat.isFile() || stat.nlink !== 1)
                            continue;
                        documents.push({
                            title: /\.(md|txt)$/i.test(entry.name)
                                ? this.read(entry.path, 2048).content?.match(/^#\s+(.+)$/m)?.[1] || entry.name
                                : entry.name,
                            path: entry.path,
                            name: entry.name,
                            category,
                            bytes: stat.size,
                            updatedAt: stat.mtime.toISOString(),
                        });
                    }
                    catch {
                        /* A disappearing or newly protected file is omitted from the index. */
                    }
                }
            }
        };
        const roots = this.list();
        for (const entry of roots.entries) {
            if (entry.blocked)
                continue;
            if (entry.kind === 'directory' &&
                ['docs', 'design', 'artifacts', 'deliverables', 'reports'].includes(entry.name))
                walk(entry.path, entry.name, 0);
            else if (entry.kind === 'file' && /\.(md|txt)$/i.test(entry.name)) {
                const stat = (0, node_fs_1.lstatSync)(this.target(entry.path));
                if (stat.nlink === 1)
                    documents.push({
                        title: /\.(md|txt)$/i.test(entry.name)
                            ? this.read(entry.path, 2048).content?.match(/^#\s+(.+)$/m)?.[1] || entry.name
                            : entry.name,
                        path: entry.path,
                        name: entry.name,
                        category: 'project',
                        bytes: stat.size,
                        updatedAt: stat.mtime.toISOString(),
                    });
            }
        }
        return {
            documents: documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
            limited,
            observedAt: new Date().toISOString(),
        };
    }
    target(path) {
        const root = (0, local_path_js_1.localDirectory)(this.root);
        if (path && !(0, task_js_1.safeRelativePath)(path))
            throw Error('PATH_DENIED');
        if ((0, workspace_js_1.sensitivePath)(path))
            throw Error('SENSITIVE_FILE');
        let target = root;
        for (const part of path ? path.split('/') : []) {
            target = (0, node_path_1.resolve)(target, part);
            if ((0, node_fs_1.lstatSync)(target).isSymbolicLink())
                throw Error('LINK_DENIED');
        }
        const actual = (0, node_fs_1.realpathSync)(target), rel = (0, node_path_1.relative)(root, actual);
        if (rel.startsWith('..') || (0, node_path_1.isAbsolute)(rel))
            throw Error('PATH_DENIED');
        return actual;
    }
    documentTarget(path) {
        if (!/^(docs|design|artifacts|deliverables|reports)\//.test(path) ||
            !/\.(md|txt)$/i.test(path) ||
            path.split('/').includes('history'))
            throw Error('DOCUMENT_EDIT_DENIED');
        const target = this.target(path), stat = (0, node_fs_1.lstatSync)(target);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > exports.fileBrowserLimits.previewBytes)
            throw Error('FILE_DENIED');
        return target;
    }
    list(path = '', offset = 0, query = '') {
        if (!Number.isSafeInteger(offset) || offset < 0 || query.length > 200)
            throw Error('INVALID_PAGE');
        const target = this.target(path);
        if (!(0, node_fs_1.lstatSync)(target).isDirectory())
            throw Error('NOT_DIRECTORY');
        const entries = (0, node_fs_1.readdirSync)(target, { withFileTypes: true })
            .filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
            .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
        return {
            root: this.root,
            path,
            total: entries.length,
            offset,
            next: offset + exports.fileBrowserLimits.page < entries.length ? offset + exports.fileBrowserLimits.page : null,
            entries: entries.slice(offset, offset + exports.fileBrowserLimits.page).map((e) => {
                const p = path ? path + '/' + e.name : e.name;
                return {
                    name: e.name,
                    path: p,
                    kind: e.isSymbolicLink() ? 'link' : e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other',
                    blocked: (0, workspace_js_1.sensitivePath)(p) || e.isSymbolicLink(),
                };
            }),
        };
    }
    read(path, maximumBytes = exports.fileBrowserLimits.previewBytes) {
        if (!Number.isSafeInteger(maximumBytes) ||
            maximumBytes < 1 ||
            maximumBytes > exports.fileBrowserLimits.previewBytes)
            throw Error('INVALID_PREVIEW_LIMIT');
        const target = this.target(path), before = (0, node_fs_1.lstatSync)(target);
        if (!before.isFile() || before.nlink !== 1)
            throw Error('FILE_DENIED');
        const fd = (0, node_fs_1.openSync)(target, 'r');
        try {
            const a = (0, node_fs_1.fstatSync)(fd);
            if (a.ino !== before.ino || a.dev !== before.dev)
                throw Error('SOURCE_CHANGED');
            const buffer = Buffer.alloc(Math.min(a.size, maximumBytes));
            let offset = 0;
            while (offset < buffer.length) {
                const n = (0, node_fs_1.readSync)(fd, buffer, offset, buffer.length - offset, null);
                if (!n)
                    break;
                offset += n;
            }
            const b = (0, node_fs_1.fstatSync)(fd);
            this.target(path);
            if (a.size !== b.size || a.mtimeMs !== b.mtimeMs || a.ctimeMs !== b.ctimeMs)
                throw Error('SOURCE_CHANGED');
            const bytes = buffer.subarray(0, offset);
            let content = null;
            try {
                if (!bytes.includes(0))
                    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: a.size > offset });
            }
            catch {
                // Not UTF-8: shown as a binary file.
            }
            return {
                path,
                bytes: a.size,
                modifiedAt: a.mtime.toISOString(),
                kind: content === null ? 'binary' : 'text',
                content,
                truncated: a.size > offset,
            };
        }
        finally {
            (0, node_fs_1.closeSync)(fd);
        }
    }
}
exports.ProjectFiles = ProjectFiles;
//# sourceMappingURL=project-files.js.map