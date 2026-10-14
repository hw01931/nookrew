"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollaborationStore = void 0;
const sqlite_js_1 = require("./sqlite.js");
const node_crypto_1 = require("node:crypto");
const hash_js_1 = require("./hash.js");
const command_js_1 = require("../domain/command.js");
const job_js_1 = require("../domain/job.js");
const collaboration_js_1 = require("../domain/collaboration.js");
const model_routing_js_1 = require("../domain/model-routing.js");
const record_lifecycle_js_1 = require("../domain/record-lifecycle.js");
class CollaborationStore {
    project;
    db;
    constructor(path, project) {
        this.project = project;
        this.db = (0, sqlite_js_1.openDatabase)(path);
        this.db.exec('PRAGMA journal_mode=WAL;');
        const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
        if (![0, 1, 2, 3, 4].includes(version))
            throw Error('UNSUPPORTED_COLLAB_VERSION');
        this.db
            .exec(`CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY,kind TEXT NOT NULL,version INTEGER NOT NULL,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions(id TEXT NOT NULL,version INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(id,version));
      CREATE TABLE IF NOT EXISTS receipts(key TEXT PRIMARY KEY,hash TEXT NOT NULL,result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,result TEXT NOT NULL,at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,name TEXT NOT NULL,active INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS room_reads(actor TEXT NOT NULL,room TEXT NOT NULL,version INTEGER NOT NULL,message TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(actor,room));
      CREATE TABLE IF NOT EXISTS attention_seen(actor TEXT NOT NULL,source TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(actor,source));
      PRAGMA user_version=4;`);
    }
    close() {
        this.db.close();
    }
    /** Set only while a lifecycle command (ADR 0067) writes; ordinary puts keep lifecycle fields as they are. */
    lifecycle = false;
    /**
     * The one write path for decision changes and memory retention. Callers are the owner commands in
     * application/record-lifecycle.ts; every other check of put still applies.
     */
    lifecyclePut(kind, id, data, audience, actor, command) {
        this.lifecycle = true;
        try {
            return this.put(kind, id, data, audience, actor, command);
        }
        finally {
            this.lifecycle = false;
        }
    }
    /** A deleted memory's earlier versions lose their content too; version numbers and times stay. */
    redactRevisions(id, data) {
        this.db
            .prepare("UPDATE revisions SET json=json_set(json,'$.data',json(?)) WHERE id=?")
            .run(JSON.stringify(data), id);
    }
    all() {
        return this.db
            .prepare('SELECT json FROM entities ORDER BY rowid')
            .all()
            .map((r) => JSON.parse(String(r.json)));
    }
    get(id) {
        const row = this.db.prepare('SELECT json FROM entities WHERE id=?').get(id);
        if (!row)
            throw Error('ENTITY_NOT_FOUND');
        return JSON.parse(String(row.json));
    }
    employee(actor) {
        return actor.kind === 'employee' ? this.get(actor.id) : undefined;
    }
    canRead(entity, actor) {
        if (actor.kind === 'owner')
            return true;
        const employee = this.employee(actor);
        const team = employee ? this.get((0, collaboration_js_1.string)(employee.data, 'teamId')) : undefined;
        const isLeader = team?.kind === 'team' && team.data.leaderId === employee?.id;
        return (0, collaboration_js_1.readable)(entity, actor, employee, isLeader);
    }
    read(id, actor) {
        const entity = this.get(id);
        if (!this.canRead(entity, actor))
            throw Error('ACCESS_DENIED');
        return entity;
    }
    list(actor) {
        const entities = this.all(), employee = this.employee(actor), isLeader = !!employee &&
            entities.some((e) => e.kind === 'team' && e.id === employee.data.teamId && e.data.leaderId === employee.id);
        return entities.filter((e) => (0, collaboration_js_1.readable)(e, actor, employee, isLeader));
    }
    history(id, actor) {
        this.read(id, actor);
        return this.db
            .prepare('SELECT json FROM revisions WHERE id=? ORDER BY version DESC LIMIT 100')
            .all(id)
            .map((r) => JSON.parse(String(r.json)))
            .filter((e) => this.canRead(e, actor));
    }
    audit(actor) {
        if (actor.kind !== 'owner')
            throw Error('ACCESS_DENIED');
        return this.db.prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT 200').all();
    }
    log(actor, action, target, result) {
        this.db
            .prepare('INSERT INTO audit(actor,action,target,result,at) VALUES(?,?,?,?,?)')
            .run(actor.id, action, target, result, new Date().toISOString());
    }
    /**
     * Runs write() once per idempotency key inside a transaction. A retry with the same fingerprint
     * returns the stored result; a different request under the same key is IDEMPOTENCY_CONFLICT.
     * Key composition stays with each caller because existing receipts depend on it.
     */
    idempotent(key, fingerprint, write) {
        return (0, sqlite_js_1.transaction)(this.db, () => {
            const prior = this.db.prepare('SELECT hash,result FROM receipts WHERE key=?').get(key);
            if (prior) {
                if (prior.hash !== fingerprint)
                    throw Error('IDEMPOTENCY_CONFLICT');
                return JSON.parse(String(prior.result));
            }
            const result = write();
            this.db.prepare('INSERT INTO receipts VALUES(?,?,?)').run(key, fingerprint, JSON.stringify(result));
            return result;
        });
    }
    transaction(write) {
        return (0, sqlite_js_1.transaction)(this.db, write);
    }
    receipt(key) {
        const row = this.db.prepare('SELECT hash,result FROM receipts WHERE key=?').get(key);
        return row ? { hash: String(row.hash), result: String(row.result) } : undefined;
    }
    /** Raw receipt write for flows that record a marker without replaying a result. */
    addReceipt(key, fingerprint, value, ifAbsent = false) {
        this.db
            .prepare(`INSERT${ifAbsent ? ' OR IGNORE' : ''} INTO receipts VALUES(?,?,?)`)
            .run(key, fingerprint, JSON.stringify(value));
    }
    jobs(limit = 200) {
        return this.db
            .prepare('SELECT json FROM jobs ORDER BY rowid DESC LIMIT ?')
            .all(limit)
            .map((row) => JSON.parse(String(row.json)));
    }
    job(id) {
        const row = this.db.prepare('SELECT json FROM jobs WHERE id=?').get(id);
        return row ? JSON.parse(String(row.json)) : undefined;
    }
    activeJobs() {
        const statuses = job_js_1.activeJobStatuses.map(() => '?').join(',');
        return this.db
            .prepare(`SELECT json FROM jobs WHERE json_extract(json,'$.status') IN (${statuses})`)
            .all(...job_js_1.activeJobStatuses)
            .map((row) => JSON.parse(String(row.json)));
    }
    saveJob(job) {
        job.version++;
        job.updatedAt = new Date().toISOString();
        this.db
            .prepare('INSERT INTO jobs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json')
            .run(job.id, JSON.stringify(job));
    }
    clients() {
        return this.db.prepare('SELECT id,name,active FROM clients').all();
    }
    addClient(id, tokenHash, name) {
        this.db.prepare('INSERT INTO clients VALUES(?,?,?,1)').run(id, tokenHash, name);
    }
    activeClientId(tokenHash) {
        const row = this.db.prepare('SELECT id FROM clients WHERE token_hash=? AND active=1').get(tokenHash);
        return row ? String(row.id) : undefined;
    }
    deactivateClient(id) {
        this.db.prepare('UPDATE clients SET active=0 WHERE id=?').run(id);
    }
    seenVersions(actorId) {
        return new Map(this.db
            .prepare('SELECT source,version FROM attention_seen WHERE actor=?')
            .all(actorId)
            .map((row) => [String(row.source), Number(row.version)]));
    }
    markSeen(actorId, source, version) {
        this.db
            .prepare('INSERT INTO attention_seen VALUES(?,?,?) ON CONFLICT(actor,source) DO UPDATE SET version=excluded.version')
            .run(actorId, source, version);
    }
    allowTool(actor, tool) {
        if (actor.kind === 'owner')
            return;
        if (actor.kind !== 'employee')
            throw Error('ACCESS_DENIED');
        const e = this.employee(actor);
        if (e.data.enabled !== true || !(0, collaboration_js_1.hasTool)((0, collaboration_js_1.strings)(e.data, 'tools'), tool))
            throw Error('TOOL_DENIED');
    }
    readState(actor) {
        const visible = this.list(actor), positions = new Map(this.db
            .prepare("SELECT id,rowid AS position FROM entities WHERE kind='message'")
            .all()
            .map((r) => [String(r.id), Number(r.position)]));
        return visible
            .filter((e) => e.kind === 'room')
            .map((room) => {
            const row = this.db
                .prepare('SELECT * FROM room_reads WHERE actor=? AND room=?')
                .get(actor.id, room.id);
            const messages = visible.filter((e) => e.kind === 'message' && e.data.roomId === room.id);
            return {
                roomId: room.id,
                version: Number(row?.version ?? 0),
                messageId: String(row?.message ?? ''),
                latestId: messages.at(-1)?.id ?? '',
                unread: messages.filter((e) => e.actor !== actor.id && (positions.get(e.id) ?? 0) > Number(row?.position ?? 0)).length,
            };
        });
    }
    markRead(roomId, messageId, actor, command) {
        (0, command_js_1.assertCommand)(command, { actor: actor.id, project: this.project });
        if (this.read(roomId, actor).kind !== 'room')
            throw Error('INVALID_REFERENCE');
        const message = this.read(messageId, actor);
        if (message.kind !== 'message' || message.data.roomId !== roomId)
            throw Error('INVALID_REFERENCE');
        const fingerprint = (0, hash_js_1.hash)({ action: 'room-read', roomId, messageId, version: command.expected_version }), key = (0, hash_js_1.hash)([actor.id, this.project, command.idempotency_key]);
        return this.idempotent(key, fingerprint, () => {
            const old = this.db.prepare('SELECT * FROM room_reads WHERE actor=? AND room=?').get(actor.id, roomId);
            if (Number(old?.version ?? 0) !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            const position = Number(this.db.prepare('SELECT rowid AS position FROM entities WHERE id=?').get(messageId)?.position);
            const current = position >= Number(old?.position ?? 0)
                ? { messageId, position }
                : { messageId: String(old.message), position: Number(old.position) };
            const result = { roomId, messageId: current.messageId, version: command.expected_version + 1 };
            this.db
                .prepare('INSERT INTO room_reads VALUES(?,?,?,?,?) ON CONFLICT(actor,room) DO UPDATE SET version=excluded.version,message=excluded.message,position=excluded.position')
                .run(actor.id, roomId, result.version, current.messageId, current.position);
            this.log(actor, 'room.read', roomId, 'SUCCEEDED');
            return result;
        });
    }
    put(kind, id, data, audience, actor, command) {
        (0, command_js_1.assertCommand)(command, { actor: actor.id, project: this.project });
        (0, collaboration_js_1.validateEntity)(kind, data);
        if (kind === 'work' &&
            data.nativeAssigneeId &&
            (actor.kind !== 'owner' || data.assigneeId || !/^[a-f0-9]{64}$/.test(String(data.nativeAssigneeId))))
            throw Error('NATIVE_ASSIGNMENT_DENIED');
        if (!Array.isArray(audience) ||
            !audience.length ||
            audience.length > 100 ||
            audience.some((v) => typeof v !== 'string' || !v || v.length > 150))
            throw Error('INVALID_AUDIENCE');
        const action = kind + '.write';
        try {
            if (['team', 'employee', 'room'].includes(kind) && actor.kind !== 'owner')
                throw Error(actor.kind === 'client' ? 'ACCESS_DENIED' : 'TOOL_DENIED');
            if (kind === 'room' &&
                (audience.includes('leaders') || (id && this.get(id).audience.includes('leaders'))) &&
                (audience.length !== 1 || audience[0] !== 'leaders'))
                throw Error('LEADERSHIP_ROOM_AUDIENCE_REQUIRED');
            if (kind === 'team' && (0, collaboration_js_1.string)(data, 'leaderId')) {
                const leader = this.get((0, collaboration_js_1.string)(data, 'leaderId'));
                if (leader.kind !== 'employee' || leader.data.teamId !== id || leader.data.enabled !== true)
                    throw Error('INVALID_TEAM_LEADER');
            }
            if (kind === 'employee' &&
                id &&
                this.all().some((e) => e.kind === 'team' && e.data.leaderId === id && e.id !== data.teamId))
                throw Error('REASSIGN_TEAM_LEADER_FIRST');
            if (actor.kind === 'client') {
                if (kind !== 'feedback' && kind !== 'message')
                    throw Error('ACCESS_DENIED');
            }
            else if (actor.kind === 'employee')
                this.allowTool(actor, action);
            if (id)
                this.read(id, actor);
            if (actor.kind !== 'owner') {
                const source = (0, collaboration_js_1.string)(data, 'roomId') || (0, collaboration_js_1.string)(data, 'artifactId');
                if (!source)
                    throw Error('SCOPE_REQUIRED');
                const parent = this.read(source, actor);
                if (audience.some((a) => !parent.audience.includes(a)))
                    throw Error('AUDIENCE_ESCALATION');
                if (id && this.get(id).actor !== actor.id)
                    throw Error('ACCESS_DENIED');
            }
            if (kind === 'message' && id)
                throw Error('IMMUTABLE_MESSAGE');
            if (kind === 'message') {
                const room = this.read((0, collaboration_js_1.string)(data, 'roomId'), actor);
                if ((0, collaboration_js_1.string)(data, 'replyTo')) {
                    const parent = this.read((0, collaboration_js_1.string)(data, 'replyTo'), actor);
                    if (parent.kind !== 'message' || parent.data.roomId !== room.id)
                        throw Error('INVALID_REPLY');
                    if (audience.some((a) => !parent.audience.includes(a)))
                        throw Error('SOURCE_AUDIENCE_CONFLICT');
                }
                for (const ref of (0, collaboration_js_1.strings)(data, 'mentions')) {
                    const employee = this.read(ref, actor);
                    if (employee.kind !== 'employee' || !this.canRead(room, { kind: 'employee', id: ref }))
                        throw Error('INVALID_MENTION');
                }
            }
            if (actor.kind !== 'owner' && ['ACCEPTED', 'CLOSED', 'DONE'].includes((0, collaboration_js_1.string)(data, 'status')))
                throw Error('APPROVAL_REQUIRED');
            for (const field of ['teamId', 'assigneeId', 'parentId', 'roomId', 'workId', 'meetingId', 'artifactId'])
                if ((0, collaboration_js_1.string)(data, field) && this.read((0, collaboration_js_1.string)(data, field), actor).kind !== collaboration_js_1.referenceKinds[field])
                    throw Error('INVALID_REFERENCE');
            for (const field of ['sourceIds', 'links', 'artifactIds', 'dependencies', 'participants', 'members'])
                for (const ref of (0, collaboration_js_1.strings)(data, field)) {
                    const target = this.read(ref, actor);
                    if (actor.kind !== 'owner' &&
                        ['sourceIds', 'links', 'artifactIds'].includes(field) &&
                        audience.some((a) => !target.audience.includes(a)))
                        throw Error('SOURCE_AUDIENCE_CONFLICT');
                    if (collaboration_js_1.referenceKinds[field] && target.kind !== collaboration_js_1.referenceKinds[field])
                        throw Error('INVALID_REFERENCE');
                }
            if (kind === 'feedback' &&
                !this.history((0, collaboration_js_1.string)(data, 'artifactId'), actor).some((a) => a.version === data.artifactVersion))
                throw Error('INVALID_ARTIFACT_VERSION');
            if (!this.lifecycle)
                data = (0, record_lifecycle_js_1.carryLifecycle)(kind, id ? this.get(id) : undefined, data);
            // A lifecycle write keeps the evidence snapshot: archiving must not make a stale memory current.
            if (kind === 'memory' && !this.lifecycle)
                data = {
                    ...data,
                    snapshot: JSON.stringify((0, collaboration_js_1.strings)(data, 'sourceIds').map((ref) => ({ id: ref, version: this.get(ref).version }))),
                };
            const target = id ?? (0, node_crypto_1.randomUUID)();
            if (kind === 'work')
                (0, collaboration_js_1.assertAcyclic)(target, (0, collaboration_js_1.strings)(data, 'dependencies'), this.all().filter((e) => e.kind === 'work'));
            if (kind === 'work') {
                const seen = new Set([target]);
                let parent = (0, collaboration_js_1.string)(data, 'parentId');
                while (parent) {
                    if (seen.has(parent))
                        throw Error('PARENT_CYCLE');
                    seen.add(parent);
                    parent = (0, collaboration_js_1.string)(this.get(parent).data, 'parentId');
                }
                if (['ACTIVE', 'DONE'].includes((0, collaboration_js_1.string)(data, 'status')) &&
                    (0, collaboration_js_1.strings)(data, 'dependencies').some((ref) => this.get(ref).data.status !== 'DONE'))
                    throw Error('DEPENDENCY_NOT_DONE');
                // A locked assignee (ADR 0072) takes no other target or effort; the same check for the
                // editor and for a planner's work.write, whose detail names the pin so it can reassign.
                const assignee = (0, collaboration_js_1.string)(data, 'assigneeId') ? this.get((0, collaboration_js_1.string)(data, 'assigneeId')) : undefined;
                const lock = assignee?.kind === 'employee' ? (0, model_routing_js_1.employeeLock)(assignee.data) : undefined;
                try {
                    (0, model_routing_js_1.assertLockAllows)(lock, (0, model_routing_js_1.workRule)(data));
                }
                catch (error) {
                    throw new collaboration_js_1.ToolError(String(error.message), `${(0, collaboration_js_1.string)(assignee.data, 'name')} (${assignee.id}) is pinned to ${(0, model_routing_js_1.formatLock)(lock)}; omit routeTarget/routeEffort or assign an employee whose pin matches.`);
                }
            }
            const fingerprint = (0, hash_js_1.hash)({ kind, id, data, audience, version: command.expected_version }), key = (0, hash_js_1.hash)([actor.id, this.project, command.idempotency_key]);
            return this.idempotent(key, fingerprint, () => {
                if (kind === 'message' &&
                    this.receipt((0, hash_js_1.hash)(['chat-message-abandon', actor.id, this.project, command.idempotency_key])))
                    throw Error('REQUEST_ABANDONED');
                const existing = id ? this.get(id) : undefined;
                if ((existing?.version ?? 0) !== command.expected_version || (existing && existing.kind !== kind))
                    throw Error('VERSION_CONFLICT');
                const now = new Date().toISOString();
                const entity = {
                    id: target,
                    kind,
                    version: command.expected_version + 1,
                    data,
                    audience: [...new Set(audience)],
                    actor: actor.id,
                    createdAt: existing?.createdAt ?? now,
                    updatedAt: now,
                };
                const json = JSON.stringify(entity);
                this.db
                    .prepare('INSERT INTO entities VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,json=excluded.json')
                    .run(target, kind, entity.version, json);
                this.db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(target, entity.version, json);
                this.log(actor, action, target, 'SUCCEEDED');
                return entity;
            });
        }
        catch (error) {
            this.log(actor, action, id ?? '', error instanceof Error ? error.message : 'FAILED');
            throw error;
        }
    }
}
exports.CollaborationStore = CollaborationStore;
//# sourceMappingURL=collaboration-store.js.map