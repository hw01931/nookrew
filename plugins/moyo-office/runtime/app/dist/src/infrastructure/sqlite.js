"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openDatabase = openDatabase;
exports.transaction = transaction;
const node_sqlite_1 = require("node:sqlite");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
/** Connection mechanics only; schema versions and durability choices belong to each store. */
function openDatabase(path) {
    if (path !== ':memory:')
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    const db = new node_sqlite_1.DatabaseSync(path);
    db.exec('PRAGMA busy_timeout=5000;');
    return db;
}
const depths = new WeakMap();
/** Nested business commands use savepoints; an outer failure still rolls back every write. */
function transaction(db, write) {
    const depth = depths.get(db) ?? 0, savepoint = 'command_' + depth;
    db.exec(depth ? 'SAVEPOINT ' + savepoint : 'BEGIN IMMEDIATE');
    depths.set(db, depth + 1);
    try {
        const result = write();
        db.exec(depth ? 'RELEASE ' + savepoint : 'COMMIT');
        return result;
    }
    catch (error) {
        db.exec(depth ? 'ROLLBACK TO ' + savepoint : 'ROLLBACK');
        if (depth)
            db.exec('RELEASE ' + savepoint);
        throw error;
    }
    finally {
        depths.set(db, depth);
    }
}
//# sourceMappingURL=sqlite.js.map