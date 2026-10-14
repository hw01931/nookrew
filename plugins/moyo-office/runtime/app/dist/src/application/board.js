"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Board = void 0;
const node_crypto_1 = require("node:crypto");
const sqlite_js_1 = require("../infrastructure/sqlite.js");
const hash_js_1 = require("../infrastructure/hash.js");
const command_js_1 = require("../domain/command.js");
const board_contract_js_1 = require("../domain/board-contract.js");
class Board {
    db;
    constructor(path) {
        this.db = (0, sqlite_js_1.openDatabase)(path);
        this.db
            .exec(`CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,kind TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS board_commands(key TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,result TEXT NOT NULL,envelope TEXT NOT NULL,created_at TEXT NOT NULL);`);
    }
    close() {
        this.db.close();
    }
    list() {
        return this.db
            .prepare('SELECT * FROM documents ORDER BY rowid DESC')
            .all()
            .map((row) => ({
            id: String(row.id),
            kind: String(row.kind),
            version: Number(row.version),
            data: JSON.parse(String(row.data)),
        }));
    }
    history(id) {
        const document = this.db.prepare('SELECT kind FROM documents WHERE id=?').get(id);
        if (!document || document.kind !== 'task')
            throw new Error('TASK_NOT_FOUND');
        const entries = this.db
            .prepare(`SELECT result,created_at FROM board_commands
      WHERE json_extract(result,'$.id')=? ORDER BY json_extract(result,'$.version') DESC LIMIT ?`)
            .all(id, board_contract_js_1.boardLimits.historyEntries);
        return {
            schema_version: 1,
            entries: entries.map((row) => ({
                document: JSON.parse(String(row.result)),
                created_at: String(row.created_at),
                actor: 'local-user',
            })),
        };
    }
    put(kind, id, data, command) {
        (0, command_js_1.assertCommand)(command, { actor: 'local-user' });
        if (kind === 'task') {
            if (Object.keys(data).sort().join(',') !== 'goal,status,title' ||
                typeof data.title !== 'string' ||
                !data.title.trim() ||
                data.title.length > board_contract_js_1.boardLimits.titleCharacters ||
                typeof data.goal !== 'string' ||
                data.goal.length > board_contract_js_1.boardLimits.goalCharacters ||
                !board_contract_js_1.boardStatuses.some((status) => status === data.status))
                throw new Error('INVALID_TASK');
        }
        const payloadHash = (0, hash_js_1.hash)({ kind, id, data, version: command.expected_version });
        const key = (0, hash_js_1.hash)([command.actor, command.project_id, command.idempotency_key]);
        return (0, sqlite_js_1.transaction)(this.db, () => {
            const previous = this.db.prepare('SELECT payload_hash,result FROM board_commands WHERE key=?').get(key);
            if (previous) {
                if (previous.payload_hash !== payloadHash)
                    throw new Error('IDEMPOTENCY_CONFLICT');
                return JSON.parse(String(previous.result));
            }
            const target = id ?? (0, node_crypto_1.randomUUID)();
            const existing = this.db.prepare('SELECT version,kind FROM documents WHERE id=?').get(target);
            if ((existing ? Number(existing.version) : 0) !== command.expected_version ||
                (existing && existing.kind !== kind))
                throw new Error('VERSION_CONFLICT');
            const result = { id: target, kind, version: command.expected_version + 1, data };
            this.db
                .prepare('INSERT INTO documents VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data')
                .run(target, kind, result.version, JSON.stringify(data));
            this.db
                .prepare('INSERT INTO board_commands VALUES(?,?,?,?,?)')
                .run(key, payloadHash, JSON.stringify(result), JSON.stringify(command), new Date().toISOString());
            return result;
        });
    }
}
exports.Board = Board;
//# sourceMappingURL=board.js.map