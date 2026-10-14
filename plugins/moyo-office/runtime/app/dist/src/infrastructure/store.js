"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Store = void 0;
const node_crypto_1 = require("node:crypto");
const sqlite_js_1 = require("./sqlite.js");
const execution_js_1 = require("../domain/execution.js");
const hash_js_1 = require("./hash.js");
class Store {
    db;
    constructor(path) {
        this.db = (0, sqlite_js_1.openDatabase)(path);
        this.db.exec('PRAGMA foreign_keys = ON;');
        const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
        if (version !== 0 && version !== 1) {
            this.db.close();
            throw new Error('UNSUPPORTED_DATABASE_VERSION');
        }
        if (version === 0)
            (0, sqlite_js_1.transaction)(this.db, () => {
                this.db.exec(`
        CREATE TABLE runs (
          id TEXT PRIMARY KEY, state TEXT NOT NULL, generation INTEGER NOT NULL,
          version INTEGER NOT NULL, task TEXT NOT NULL, task_status TEXT NOT NULL,
          owner_pid INTEGER NOT NULL, candidate_hash TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE commands (
          id TEXT PRIMARY KEY, actor TEXT NOT NULL, project_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL, correlation_id TEXT NOT NULL,
          expected_version INTEGER NOT NULL, payload_hash TEXT NOT NULL,
          run_id TEXT NOT NULL REFERENCES runs(id),
          UNIQUE(actor, project_id, idempotency_key)
        );
        CREATE TABLE events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id),
          sequence INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL,
          created_at TEXT NOT NULL, UNIQUE(run_id, sequence)
        );
        CREATE TABLE outbox (event_id INTEGER PRIMARY KEY REFERENCES events(id), delivered INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE artifacts (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, content TEXT NOT NULL);
        CREATE TABLE evidence (
          run_id TEXT NOT NULL REFERENCES runs(id), check_id TEXT NOT NULL,
          content TEXT NOT NULL, PRIMARY KEY(run_id, check_id)
        );
        CREATE TABLE ledger (
          run_id TEXT PRIMARY KEY REFERENCES runs(id), profile TEXT NOT NULL,
          api_cost_usd_micros INTEGER NOT NULL, total_cost_status TEXT NOT NULL
        );
        PRAGMA user_version = 1;
      `);
            });
    }
    close() {
        this.db.close();
    }
    event(id, type, payload) {
        const result = this.db
            .prepare(`INSERT INTO events(run_id, sequence, type, payload, created_at)
      VALUES (?, (SELECT COALESCE(MAX(sequence), 0)+1 FROM events WHERE run_id=?), ?, ?, ?)`)
            .run(id, id, type, (0, hash_js_1.canonicalJson)(payload), new Date().toISOString());
        this.db.prepare('INSERT INTO outbox(event_id) VALUES (?)').run(result.lastInsertRowid);
    }
    get(id) {
        const row = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id);
        if (!row)
            throw new Error('RUN_NOT_FOUND');
        return { ...row, task: JSON.parse(row.task) };
    }
    listRuns(limit = 30) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 100)
            throw new Error('INVALID_LIMIT');
        return this.db
            .prepare('SELECT id FROM runs ORDER BY created_at DESC LIMIT ?')
            .all(limit)
            .map((row) => this.get(String(row.id)));
    }
    start(task, profile, command) {
        if (!command.actor || !command.project_id || !command.idempotency_key || !command.correlation_id)
            throw new Error('INVALID_COMMAND');
        const payloadHash = (0, hash_js_1.hash)({ task, profile });
        return (0, sqlite_js_1.transaction)(this.db, () => {
            const existing = this.db
                .prepare('SELECT * FROM commands WHERE actor=? AND project_id=? AND idempotency_key=?')
                .get(command.actor, command.project_id, command.idempotency_key);
            if (existing) {
                if (existing.payload_hash !== payloadHash)
                    throw new Error('IDEMPOTENCY_CONFLICT');
                return { run: this.get(existing.run_id), created: false };
            }
            if (command.expected_version !== 0)
                throw new Error('VERSION_CONFLICT');
            const id = (0, node_crypto_1.randomUUID)();
            const now = new Date().toISOString();
            this.db
                .prepare('INSERT INTO runs VALUES (?, ?, 1, 0, ?, ?, ?, NULL, ?, ?)')
                .run(id, 'CREATED', (0, hash_js_1.canonicalJson)(task), 'ACTIVE', process.pid, now, now);
            this.db
                .prepare('INSERT INTO commands VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                .run((0, node_crypto_1.randomUUID)(), command.actor, command.project_id, command.idempotency_key, command.correlation_id, command.expected_version, payloadHash, id);
            this.db.prepare('INSERT INTO ledger VALUES (?, ?, 0, ?)').run(id, 'fake-fixture-v1', 'NOT_MEASURED');
            this.event(id, 'CREATED', { profile, contract_hash: (0, hash_js_1.hash)(task), command });
            return { run: this.get(id), created: true };
        });
    }
    move(run, to, payload) {
        (0, execution_js_1.assertTransition)(run.state, to);
        const taskStatus = to === 'VERIFIED'
            ? 'COMPLETED'
            : to === 'CANCELED'
                ? 'CANCELED'
                : to === 'UNKNOWN'
                    ? 'BLOCKED'
                    : (0, execution_js_1.isTerminal)(to)
                        ? 'FAILED'
                        : 'ACTIVE';
        const result = this.db
            .prepare('UPDATE runs SET state=?, task_status=?, version=version+1, updated_at=? WHERE id=? AND version=?')
            .run(to, taskStatus, new Date().toISOString(), run.id, run.version);
        if (Number(result.changes) !== 1)
            throw new Error('VERSION_CONFLICT');
        this.event(run.id, to, payload);
        return this.get(run.id);
    }
    advance(id, to, generation, expectedVersion) {
        return (0, sqlite_js_1.transaction)(this.db, () => {
            const run = this.get(id);
            if (run.generation !== generation) {
                this.event(id, 'LATE_EVENT', { to, generation });
                return false;
            }
            if (run.version !== expectedVersion)
                throw new Error('VERSION_CONFLICT');
            this.move(run, to, {});
            return true;
        });
    }
    requestCancel(id, command) {
        return (0, sqlite_js_1.transaction)(this.db, () => {
            const run = this.get(id);
            const existing = this.db
                .prepare('SELECT * FROM commands WHERE actor=? AND project_id=? AND idempotency_key=?')
                .get(command.actor, command.project_id, command.idempotency_key);
            const payload = (0, hash_js_1.hash)({ action: 'CANCEL', run_id: id });
            if (existing) {
                if (existing.payload_hash !== payload)
                    throw new Error('IDEMPOTENCY_CONFLICT');
                return run;
            }
            if (run.version !== command.expected_version)
                throw new Error('VERSION_CONFLICT');
            if ((0, execution_js_1.isTerminal)(run.state))
                throw new Error('RUN_ALREADY_TERMINAL');
            if (run.state !== 'CANCEL_REQUESTED')
                this.move(run, 'CANCEL_REQUESTED', { command });
            this.db.prepare('UPDATE runs SET generation=generation+1 WHERE id=?').run(id);
            this.db
                .prepare('INSERT INTO commands VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                .run((0, node_crypto_1.randomUUID)(), command.actor, command.project_id, command.idempotency_key, command.correlation_id, command.expected_version, payload, id);
            return this.get(id);
        });
    }
    finalize(id, generation, expectedVersion, candidate, evidence) {
        return (0, sqlite_js_1.transaction)(this.db, () => {
            const run = this.get(id);
            if (run.generation !== generation) {
                this.event(id, 'LATE_EVENT', { to: 'VERIFIED', generation });
                return false;
            }
            if (run.version !== expectedVersion)
                throw new Error('VERSION_CONFLICT');
            if (run.state !== 'VERIFYING')
                throw new Error('INVALID_TRANSITION');
            const snapshot = (0, hash_js_1.hash)(candidate);
            const pass = run.task.delivery === 'patch' && (0, execution_js_1.passesGate)(run.task, evidence, snapshot);
            this.db
                .prepare('INSERT OR IGNORE INTO artifacts VALUES (?, ?, ?)')
                .run(snapshot, 'candidate-file-map-v1', (0, hash_js_1.canonicalJson)(candidate));
            for (const row of evidence)
                this.db.prepare('INSERT INTO evidence VALUES (?, ?, ?)').run(id, row.check_id, (0, hash_js_1.canonicalJson)(row));
            this.db.prepare('UPDATE runs SET candidate_hash=? WHERE id=?').run(snapshot, id);
            this.move(run, pass ? 'VERIFIED' : 'REJECTED', { snapshot_hash: snapshot });
            return true;
        });
    }
    recover(id, ownerAlive = (pid) => {
        try {
            process.kill(pid, 0);
            return true;
        }
        catch (error) {
            return error.code !== 'ESRCH';
        }
    }) {
        return (0, sqlite_js_1.transaction)(this.db, () => {
            const run = this.get(id);
            if ((0, execution_js_1.isTerminal)(run.state))
                return run;
            if (ownerAlive(run.owner_pid))
                throw new Error('OWNER_STILL_ALIVE');
            this.db.prepare('UPDATE runs SET generation=generation+1 WHERE id=?').run(id);
            return this.move(this.get(id), 'UNKNOWN', {
                reason: 'OWNER_LOST',
                action: '확인 후 새 실행을 만드세요. 자동 재실행하지 않습니다.',
            });
        });
    }
    report(id) {
        const run = this.get(id);
        const events = this.db
            .prepare('SELECT sequence, type, payload, created_at FROM events WHERE run_id=? ORDER BY sequence')
            .all(id)
            .map((row) => ({
            sequence: Number(row.sequence),
            type: String(row.type),
            created_at: String(row.created_at),
            payload: JSON.parse(row.payload),
        }));
        const evidence = this.db
            .prepare('SELECT content FROM evidence WHERE run_id=? ORDER BY check_id')
            .all(id)
            .map((row) => JSON.parse(row.content));
        return {
            run,
            integration: 'NOT_REQUESTED',
            simulated_worker: true,
            evidence,
            events,
            cost: this.db
                .prepare('SELECT profile, api_cost_usd_micros, total_cost_status FROM ledger WHERE run_id=?')
                .get(id),
        };
    }
    artifact(snapshot) {
        const row = this.db.prepare('SELECT content FROM artifacts WHERE hash=?').get(snapshot);
        if (!row)
            throw new Error('ARTIFACT_NOT_FOUND');
        const content = JSON.parse(row.content);
        if ((0, hash_js_1.hash)(content) !== snapshot)
            throw new Error('ARTIFACT_INTEGRITY_ERROR');
        return content;
    }
}
exports.Store = Store;
//# sourceMappingURL=store.js.map