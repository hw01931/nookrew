"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowGraphStore = exports.WorkflowStore = void 0;
/** Persistence for workflow runs; shares the collaboration database and its transactions. */
class WorkflowStore {
    store;
    constructor(store) {
        this.store = store;
        this.store.db.exec('CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY,json TEXT NOT NULL)');
    }
    get isOpen() {
        return this.store.db.isOpen;
    }
    list() {
        return this.store.db
            .prepare('SELECT json FROM workflows ORDER BY rowid DESC')
            .all()
            .map((row) => JSON.parse(String(row.json)));
    }
    get(id) {
        const row = this.store.db.prepare('SELECT json FROM workflows WHERE id=?').get(id);
        return row ? JSON.parse(String(row.json)) : undefined;
    }
    save(run) {
        this.store.db
            .prepare('INSERT INTO workflows VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json')
            .run(run.id, JSON.stringify(run));
    }
}
exports.WorkflowStore = WorkflowStore;
/** Runs of workflow definitions (ADR 0068); an added table, older databases start empty. */
class WorkflowGraphStore {
    store;
    constructor(store) {
        this.store = store;
        this.store.db.exec('CREATE TABLE IF NOT EXISTS workflow_graphs(id TEXT PRIMARY KEY,json TEXT NOT NULL)');
    }
    get isOpen() {
        return this.store.db.isOpen;
    }
    list() {
        return this.store.db
            .prepare('SELECT json FROM workflow_graphs ORDER BY rowid DESC')
            .all()
            .map((row) => JSON.parse(String(row.json)));
    }
    get(id) {
        const row = this.store.db.prepare('SELECT json FROM workflow_graphs WHERE id=?').get(id);
        return row ? JSON.parse(String(row.json)) : undefined;
    }
    save(run) {
        this.store.db
            .prepare('INSERT INTO workflow_graphs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json')
            .run(run.id, JSON.stringify(run));
    }
}
exports.WorkflowGraphStore = WorkflowGraphStore;
//# sourceMappingURL=workflow-store.js.map