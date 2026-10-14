"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBackup = createBackup;
exports.listBackups = listBackups;
exports.requestRestore = requestRestore;
exports.pendingRestore = pendingRestore;
exports.applyPendingRestore = applyPendingRestore;
const node_sqlite_1 = require("node:sqlite");
const node_fs_1 = require("node:fs");
const hash_js_1 = require("./hash.js");
const node_path_1 = require("node:path");
const backupsDirectory = 'backups';
const pendingFile = 'restore-pending.json';
const idPattern = /^[0-9]{8}T[0-9]{6}Z(-[a-z0-9]{4})?$/;
function databases(stateDir, base = stateDir, out = []) {
    if (!(0, node_fs_1.existsSync)(base))
        return out;
    for (const entry of (0, node_fs_1.readdirSync)(base, { withFileTypes: true })) {
        if (entry.isSymbolicLink())
            continue;
        const full = (0, node_path_1.join)(base, entry.name);
        if (entry.isDirectory()) {
            if (base === stateDir && entry.name === backupsDirectory)
                continue;
            databases(stateDir, full, out);
        }
        else if (entry.isFile() && entry.name.endsWith('.db'))
            out.push((0, node_path_1.relative)(stateDir, full).split(node_path_1.sep).join('/'));
    }
    return out;
}
const fileSha256 = (path) => (0, hash_js_1.sha256)((0, node_fs_1.readFileSync)(path));
const backupRoot = (stateDir) => (0, node_path_1.resolve)(stateDir, backupsDirectory);
function newId() {
    return (new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '') +
        '-' +
        Math.random().toString(36).slice(2, 6));
}
function createBackup(stateDir, reason = 'manual') {
    const id = newId();
    const target = (0, node_path_1.resolve)(backupRoot(stateDir), id);
    (0, node_fs_1.mkdirSync)(target, { recursive: true });
    const files = [];
    try {
        for (const path of databases(stateDir)) {
            const out = (0, node_path_1.resolve)(target, path);
            (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(out), { recursive: true });
            // VACUUM INTO writes a transactionally consistent copy even while the server is writing.
            const db = new node_sqlite_1.DatabaseSync((0, node_path_1.resolve)(stateDir, path));
            db.exec('PRAGMA busy_timeout=5000');
            try {
                db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
            }
            finally {
                db.close();
            }
            files.push({ path, bytes: (0, node_fs_1.statSync)(out).size, sha256: fileSha256(out) });
        }
    }
    catch (error) {
        (0, node_fs_1.rmSync)(target, { recursive: true, force: true });
        throw error;
    }
    const manifest = { schemaVersion: 1, id, createdAt: new Date().toISOString(), reason, files };
    (0, node_fs_1.writeFileSync)((0, node_path_1.resolve)(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
}
function readManifest(stateDir, id) {
    if (!idPattern.test(id))
        throw Error('INVALID_BACKUP');
    const path = (0, node_path_1.resolve)(backupRoot(stateDir), id, 'manifest.json');
    if (!(0, node_fs_1.existsSync)(path))
        throw Error('BACKUP_NOT_FOUND');
    const manifest = JSON.parse((0, node_fs_1.readFileSync)(path, 'utf8'));
    if (manifest.schemaVersion !== 1 || manifest.id !== id || !Array.isArray(manifest.files))
        throw Error('INVALID_BACKUP');
    for (const f of manifest.files) {
        const full = (0, node_path_1.resolve)(backupRoot(stateDir), id, f.path);
        if (!full.startsWith((0, node_path_1.resolve)(backupRoot(stateDir), id) + node_path_1.sep) || !f.path.endsWith('.db'))
            throw Error('INVALID_BACKUP');
        if (!(0, node_fs_1.existsSync)(full) || fileSha256(full) !== f.sha256)
            throw Error('BACKUP_CORRUPTED');
    }
    return manifest;
}
function listBackups(stateDir) {
    if (!(0, node_fs_1.existsSync)(backupRoot(stateDir)))
        return [];
    return (0, node_fs_1.readdirSync)(backupRoot(stateDir))
        .filter((id) => idPattern.test(id))
        .sort()
        .reverse()
        .map((id) => {
        try {
            return { ...readManifest(stateDir, id), valid: true };
        }
        catch {
            return {
                schemaVersion: 1,
                id,
                createdAt: '',
                reason: 'manual',
                files: [],
                valid: false,
            };
        }
    });
}
/** Validates the backup now; the actual file swap happens at the next start. */
function requestRestore(stateDir, id) {
    const manifest = readManifest(stateDir, id);
    (0, node_fs_1.writeFileSync)((0, node_path_1.resolve)(stateDir, pendingFile), JSON.stringify({ id, requestedAt: new Date().toISOString() }));
    return { id: manifest.id, files: manifest.files.length, restartRequired: true };
}
function pendingRestore(stateDir) {
    const path = (0, node_path_1.resolve)(stateDir, pendingFile);
    if (!(0, node_fs_1.existsSync)(path))
        return null;
    return String(JSON.parse((0, node_fs_1.readFileSync)(path, 'utf8')).id);
}
/**
 * Call before opening any database. Saves the current data as a "pre-restore" backup, then puts
 * the requested backup's files in place. Databases absent from the backup are moved aside.
 */
function applyPendingRestore(stateDir) {
    const id = pendingRestore(stateDir);
    if (!id)
        return null;
    const manifest = readManifest(stateDir, id);
    createBackup(stateDir, 'pre-restore');
    const keep = new Set(manifest.files.map((f) => f.path));
    for (const path of databases(stateDir))
        if (!keep.has(path))
            (0, node_fs_1.renameSync)((0, node_path_1.resolve)(stateDir, path), (0, node_path_1.resolve)(stateDir, path) + '.replaced');
    for (const f of manifest.files) {
        const target = (0, node_path_1.resolve)(stateDir, f.path);
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(target), { recursive: true });
        for (const suffix of ['-wal', '-shm', '-journal'])
            (0, node_fs_1.rmSync)(target + suffix, { force: true });
        (0, node_fs_1.copyFileSync)((0, node_path_1.resolve)(backupRoot(stateDir), id, f.path), target);
    }
    (0, node_fs_1.rmSync)((0, node_path_1.resolve)(stateDir, pendingFile), { force: true });
    return manifest;
}
//# sourceMappingURL=backup.js.map