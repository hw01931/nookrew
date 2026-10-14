"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectDocuments = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_crypto_1 = require("node:crypto");
const command_js_1 = require("../domain/command.js");
const hash_js_1 = require("./hash.js");
const sqlite_js_1 = require("./sqlite.js");
const project_files_js_1 = require("../adapters/project-files.js");
const local_path_js_1 = require("./local-path.js");
/** Explicit owner saves, content-hash conflicts, durable receipts and snapshot-bound comments. */
class ProjectDocuments {
    root;
    db;
    files;
    constructor(root) {
        this.root = root;
        this.files = new project_files_js_1.ProjectFiles(root);
        const folder = (0, local_path_js_1.localDirectory)((0, node_path_1.resolve)(root, '.aiorchestra'));
        const dbPath = (0, node_path_1.resolve)(folder, 'project-documents.db');
        if ((0, node_fs_1.existsSync)(dbPath) && ((0, node_fs_1.lstatSync)(dbPath).isSymbolicLink() || (0, node_fs_1.lstatSync)(dbPath).nlink !== 1))
            throw Error('PATH_DENIED');
        this.db = (0, sqlite_js_1.openDatabase)(dbPath);
        this.db.exec('CREATE TABLE IF NOT EXISTS document_receipts(id TEXT PRIMARY KEY,fingerprint TEXT,data TEXT); CREATE TABLE IF NOT EXISTS document_comments(id TEXT PRIMARY KEY,path TEXT,data TEXT);');
    }
    read(path) {
        this.files.documentTarget(path);
        const file = this.files.read(path);
        if (file.kind !== 'text' || file.truncated)
            throw Error('DOCUMENT_EDIT_DENIED');
        const snapshot = (0, hash_js_1.sha256)(Buffer.from(file.content, 'utf8'));
        const comments = this.db
            .prepare('SELECT data FROM document_comments WHERE path=? ORDER BY rowid DESC LIMIT 100')
            .all(path).map((r) => {
            const c = JSON.parse(r.data);
            return { ...c, outdated: c.snapshot !== snapshot };
        });
        return { ...file, snapshot, comments };
    }
    command(path, snapshot, action, text, command) {
        (0, command_js_1.assertCommand)(command, { actor: 'local-user', project: this.root, version: 0 });
        if (!/^[a-f0-9]{64}$/.test(snapshot) ||
            typeof text !== 'string' ||
            text.includes('\0') ||
            !['save', 'comment'].includes(action) ||
            Buffer.byteLength(text, 'utf8') > (action === 'comment' ? 4000 : project_files_js_1.fileBrowserLimits.previewBytes) ||
            (action === 'comment' && !text.trim()))
            throw Error('INVALID_DOCUMENT');
        // Validate path even on receipt replay, before returning any stored content.
        this.files.documentTarget(path);
        const fingerprint = (0, hash_js_1.hash)([path, snapshot, action, text]);
        const receipt = this.db
            .prepare('SELECT fingerprint,data FROM document_receipts WHERE id=?')
            .get(command.idempotency_key);
        let record = receipt ? JSON.parse(receipt.data) : null;
        if (receipt && receipt.fingerprint !== fingerprint)
            throw Error('IDEMPOTENCY_CONFLICT');
        if (record?.state === 'DONE')
            return record.result;
        const current = this.read(path);
        const targetHash = (0, hash_js_1.sha256)(Buffer.from(text, 'utf8'));
        if (record && action === 'save' && current.snapshot === targetHash) {
            record = { ...record, state: 'DONE', result: { path, snapshot: targetHash } };
            this.db
                .prepare('UPDATE document_receipts SET data=? WHERE id=?')
                .run(JSON.stringify(record), command.idempotency_key);
            return record.result;
        }
        if (current.snapshot !== snapshot)
            throw Error(record ? 'DOCUMENT_SAVE_UNKNOWN' : 'DOCUMENT_CONFLICT');
        if (action === 'comment')
            return (0, sqlite_js_1.transaction)(this.db, () => {
                if (this.read(path).snapshot !== snapshot)
                    throw Error('DOCUMENT_CONFLICT');
                const result = {
                    id: (0, node_crypto_1.randomUUID)(),
                    snapshot,
                    text: text.trim(),
                    actor: command.actor,
                    at: new Date().toISOString(),
                    correlationId: command.correlation_id,
                };
                this.db
                    .prepare('INSERT INTO document_comments VALUES(?,?,?)')
                    .run(result.id, path, JSON.stringify(result));
                this.db
                    .prepare('INSERT INTO document_receipts VALUES(?,?,?)')
                    .run(command.idempotency_key, fingerprint, JSON.stringify({ state: 'DONE', result }));
                return result;
            });
        if (!record) {
            record = {
                state: 'PREPARED',
                path,
                snapshot,
                targetHash,
                before: current.content,
                actor: command.actor,
                correlationId: command.correlation_id,
                at: new Date().toISOString(),
            };
            this.db
                .prepare('INSERT INTO document_receipts VALUES(?,?,?)')
                .run(command.idempotency_key, fingerprint, JSON.stringify(record));
        }
        const target = this.files.documentTarget(path), temp = target + '.' + (0, node_crypto_1.randomUUID)() + '.tmp';
        try {
            (0, node_fs_1.writeFileSync)(temp, text, { encoding: 'utf8', flag: 'wx', mode: (0, node_fs_1.lstatSync)(target).mode });
            if (this.files.documentTarget(path) !== target || this.read(path).snapshot !== snapshot)
                throw Error('DOCUMENT_CONFLICT');
            (0, node_fs_1.renameSync)(temp, target);
            if (this.read(path).snapshot !== targetHash)
                throw Error('DOCUMENT_SAVE_UNKNOWN');
            const result = { path, snapshot: targetHash };
            this.db
                .prepare('UPDATE document_receipts SET data=? WHERE id=?')
                .run(JSON.stringify({ ...record, state: 'DONE', result }), command.idempotency_key);
            return result;
        }
        finally {
            if ((0, node_fs_1.existsSync)(temp))
                (0, node_fs_1.unlinkSync)(temp);
        }
    }
    close() {
        this.db.close();
    }
}
exports.ProjectDocuments = ProjectDocuments;
//# sourceMappingURL=project-documents.js.map