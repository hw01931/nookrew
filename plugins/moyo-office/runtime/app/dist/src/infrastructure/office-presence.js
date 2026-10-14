"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OfficePresence = void 0;
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const sqlite_js_1 = require("./sqlite.js");
const command_js_1 = require("../domain/command.js");
const collaboration_js_1 = require("../domain/collaboration.js");
const hash_js_1 = require("./hash.js");
const events = [
    'SessionStart',
    'SessionEnd',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'PermissionRequest',
    'Stop',
    'Interrupt',
    'SubagentStart',
    'SubagentStop',
];
const digest = (value) => (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
/** Passive local observations only: no execution, approvals, chat content or tool arguments. */
class OfficePresence {
    project;
    db;
    constructor(project, directory = (0, node_path_1.resolve)(project, '.aiorchestra')) {
        this.project = project;
        this.db = (0, sqlite_js_1.openDatabase)((0, node_path_1.resolve)(directory, 'office-presence.db'));
        this.db.exec(`CREATE TABLE IF NOT EXISTS presence (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS presence_receipts (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS presence_events (seq INTEGER PRIMARY KEY, person TEXT NOT NULL, event TEXT NOT NULL, at TEXT NOT NULL);`);
        this.db.exec('CREATE TABLE IF NOT EXISTS presence_work_links(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS presence_work_audit(seq INTEGER PRIMARY KEY, data TEXT NOT NULL);');
        this.db.exec('CREATE TABLE IF NOT EXISTS presence_usage(id TEXT PRIMARY KEY, person TEXT, data TEXT);');
    }
    list(includeMissing = false) {
        return this.db.prepare('SELECT data FROM presence ORDER BY rowid DESC LIMIT 100').all()
            .map((r) => JSON.parse(r.data))
            .filter((p) => includeMissing || p.sourceAvailable !== false);
    }
    /** Observer reconciles source existence. Keep history, never invent a completion event. */
    sourceAvailability(id, available, command) {
        (0, command_js_1.assertCommand)(command, { actor: 'hook:codex', project: this.project, version: 0 });
        const person = this.list(true).find((p) => p.id === id);
        if (!person || person.provider !== 'codex')
            throw Error('INVALID_SESSION');
        if ((person.sourceAvailable !== false) === available)
            return;
        person.sourceAvailable = available;
        person.version++;
        this.db.prepare('UPDATE presence SET data=? WHERE id=?').run(JSON.stringify(person), id);
        this.db
            .prepare('INSERT INTO presence_events(person,event,at) VALUES(?,?,?)')
            .run(id, available ? 'SourceRestored' : 'SourceMissing', new Date().toISOString());
    }
    history(id) {
        return this.db
            .prepare('SELECT event, at FROM presence_events WHERE person=? ORDER BY seq DESC LIMIT 100')
            .all(id);
    }
    async openChat(id, command, launch) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.project, version: 0 });
        const person = this.list().find((p) => p.id === id && p.provider === 'codex');
        if (!person || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(person.session))
            throw Error('CODEX_CHAT_UNAVAILABLE');
        const key = 'chat:' + command.idempotency_key, fingerprint = (0, hash_js_1.hash)([id, person.session]);
        const previous = this.db
            .prepare('SELECT fingerprint,result FROM presence_receipts WHERE id=?')
            .get(key);
        if (previous) {
            if (previous.fingerprint !== fingerprint)
                throw Error('IDEMPOTENCY_CONFLICT');
            return JSON.parse(previous.result);
        }
        const result = { requested: false, state: 'UNKNOWN', url: 'codex://threads/' + person.session };
        this.db
            .prepare('INSERT INTO presence_receipts VALUES(?,?,?)')
            .run(key, fingerprint, JSON.stringify(result));
        await launch(person.session);
        const launched = { ...result, requested: true, state: 'REQUESTED' };
        this.db.prepare('UPDATE presence_receipts SET result=? WHERE id=?').run(JSON.stringify(launched), key);
        return launched;
    }
    usage() {
        return this.db
            .prepare("SELECT data FROM presence_usage ORDER BY json_extract(data, '$.observedAt') DESC LIMIT 1000")
            .all().map((r) => JSON.parse(r.data));
    }
    recordUsage(report, command) {
        (0, command_js_1.assertCommand)(command, { actor: 'hook:codex', project: this.project, version: 0 });
        if (!this.list().some((p) => p.id === report.person && p.provider === 'codex') ||
            report.source !== 'codex-rollout' ||
            !Number.isFinite(Date.parse(report.observedAt)) ||
            !/^[\w.-]{0,150}$/.test(report.turn) ||
            typeof report.model !== 'string' ||
            report.model.length > 120 ||
            !report.session ||
            !report.lastCall ||
            report.currentTurn === undefined)
            throw Error('INVALID_USAGE');
        for (const counts of [report.session, report.lastCall, report.currentTurn].filter(Boolean)) {
            const c = counts;
            if (Object.keys(c).sort().join(',') !== 'cacheRead,cacheWrite,input,output,reasoning,total' ||
                Object.values(c).some((v) => v !== null && (!Number.isSafeInteger(v) || v < 0)))
                throw Error('INVALID_USAGE');
        }
        const id = digest(report.person + ':' + report.turn);
        return (0, sqlite_js_1.transaction)(this.db, () => {
            const receiptId = 'usage:' + command.idempotency_key;
            const data = {
                person: report.person,
                turn: report.turn,
                model: report.model,
                observedAt: report.observedAt,
                source: report.source,
                session: report.session,
                lastCall: report.lastCall,
                currentTurn: report.currentTurn,
            };
            const fingerprint = (0, hash_js_1.hash)(data);
            const receipt = this.db
                .prepare('SELECT fingerprint FROM presence_receipts WHERE id=?')
                .get(receiptId);
            if (receipt) {
                if (receipt.fingerprint !== fingerprint)
                    throw Error('IDEMPOTENCY_CONFLICT');
                return;
            }
            const row = this.db.prepare('SELECT data FROM presence_usage WHERE id=?').get(id);
            if (row && Date.parse(JSON.parse(row.data).observedAt) >= Date.parse(report.observedAt)) {
                this.db
                    .prepare('INSERT INTO presence_receipts VALUES(?,?,?)')
                    .run(receiptId, fingerprint, JSON.stringify({ ignored: true, correlationId: command.correlation_id }));
                return;
            }
            // Only allowlisted data is persisted; account quota, prompts and arbitrary extra fields are excluded.
            this.db
                .prepare('INSERT INTO presence_usage VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
                .run(id, report.person, JSON.stringify(data));
            this.db
                .prepare('INSERT INTO presence_receipts VALUES(?,?,?)')
                .run(receiptId, fingerprint, JSON.stringify({ recorded: true, correlationId: command.correlation_id }));
        });
    }
    workLinks(readWork) {
        const audit = this.db.prepare('SELECT data FROM presence_work_audit ORDER BY seq DESC LIMIT 1000').all().map(({ data }) => JSON.parse(data));
        return this.db.prepare('SELECT data FROM presence_work_links').all().map(({ data }) => {
            const stored = JSON.parse(data);
            const link = {
                ...stored,
                history: audit
                    .filter((entry) => entry.id === stored.id)
                    .map((entry) => ({
                    actor: entry.actor,
                    at: entry.updatedAt,
                    action: entry.action,
                    version: entry.version,
                })),
            };
            try {
                const work = readWork(link.workId);
                return {
                    ...link,
                    title: String(work.data.title),
                    currentWorkVersion: work.version,
                    referenceStatus: this.list().some((p) => p.id === link.presenceId) ? 'AVAILABLE' : 'BROKEN',
                    versionChanged: work.version !== link.workVersion,
                };
            }
            catch {
                return { ...link, referenceStatus: 'BROKEN', versionChanged: false };
            }
        });
    }
    setWorkLink(presenceId, workId, workVersion, linkVersion, linked, command, readWork) {
        if (!workId ||
            !Number.isSafeInteger(workVersion) ||
            workVersion < 1 ||
            !Number.isSafeInteger(linkVersion) ||
            linkVersion < 0)
            throw Error('INVALID_LINK');
        const fingerprint = digest(JSON.stringify([presenceId, workId, workVersion, linkVersion, linked, command.expected_version]));
        return this.ownerReceipt(command, fingerprint, () => {
            const person = this.list().find((p) => p.id === presenceId);
            if (!person)
                throw Error('SESSION_NOT_FOUND');
            if (person.version !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            const work = readWork(workId);
            if (work.kind !== 'work')
                throw Error('INVALID_WORK');
            if (work.version !== workVersion)
                throw Error('WORK_VERSION_CONFLICT');
            if (linked &&
                (['DONE', 'CLOSED', 'CANCELED'].includes(String(work.data.status)) || person.status === 'CLOSED'))
                throw Error('LINK_TARGET_CLOSED');
            const id = digest(presenceId + ':' + workId);
            const row = this.db.prepare('SELECT data FROM presence_work_links WHERE id=?').get(id);
            const before = row ? JSON.parse(row.data) : undefined;
            if ((before?.version || 0) !== linkVersion)
                throw Error('LINK_VERSION_CONFLICT');
            if (!linked && (!before || before.removedAt))
                throw Error('LINK_NOT_FOUND');
            const now = new Date().toISOString();
            const result = {
                id,
                presenceId,
                workId,
                workVersion,
                version: (before?.version || 0) + 1,
                actor: command.actor,
                createdAt: before?.createdAt || now,
                updatedAt: now,
                ...(!linked ? { removedAt: now } : {}),
            };
            // Re-read permission/version immediately before the durable write across the two stores.
            const checked = readWork(workId);
            if (checked.version !== workVersion || checked.kind !== 'work')
                throw Error('WORK_VERSION_CONFLICT');
            this.db
                .prepare('INSERT OR REPLACE INTO presence_work_links VALUES (?,?)')
                .run(id, JSON.stringify(result));
            this.db.prepare('INSERT INTO presence_work_audit(data) VALUES (?)').run(JSON.stringify({
                ...result,
                correlationId: command.correlation_id,
                action: linked ? 'LINK' : 'UNLINK',
            }));
            return result;
        }, 'owner-work-link');
    }
    observe(provider, input, command) {
        (0, command_js_1.assertCommand)(command, { actor: 'hook:' + provider, project: this.project, version: 0 });
        if (!['codex', 'claude'].includes(provider) ||
            !events.includes(input.hook_event_name))
            throw Error('INVALID_EVENT');
        if (typeof input.cwd !== 'string' ||
            (0, node_fs_1.realpathSync)(input.cwd).toLowerCase() !== (0, node_fs_1.realpathSync)(this.project).toLowerCase())
            throw Error('PROJECT_MISMATCH');
        if (typeof input.session_id !== 'string' || !/^[\w.-]{1,150}$/.test(input.session_id))
            throw Error('INVALID_SESSION');
        const event = String(input.hook_event_name);
        const turn = typeof input.turn_id === 'string' ? input.turn_id : '';
        if (turn && !/^[\w.-]{1,150}$/.test(turn))
            throw Error('INVALID_TURN');
        const agent = typeof input.agent_id === 'string' ? input.agent_id : '';
        if (agent && !/^[\w.-]{1,150}$/.test(agent))
            throw Error('INVALID_AGENT');
        if (event.startsWith('Subagent') && !agent)
            throw Error('INVALID_AGENT');
        const id = digest([provider, input.session_id, agent].join(':'));
        const activity = ['SEARCH', 'READ', 'BUILD', 'DELEGATE', 'WORK'].includes(String(input.activity))
            ? input.activity
            : 'WORK';
        // Keep existing receipt identities compatible across the additive display metadata change.
        const fingerprint = digest(JSON.stringify([id, event, input.turn_id || '']));
        return (0, sqlite_js_1.transaction)(this.db, () => {
            const key = provider + ':' + command.idempotency_key;
            const receipt = this.db
                .prepare('SELECT fingerprint,result FROM presence_receipts WHERE id=?')
                .get(key);
            if (receipt) {
                const saved = JSON.parse(receipt.result);
                const previousDisplayFingerprint = digest(JSON.stringify([id, event, input.turn_id || '', saved.activity || 'WORK']));
                if (receipt.fingerprint !== fingerprint && receipt.fingerprint !== previousDisplayFingerprint)
                    throw Error('IDEMPOTENCY_CONFLICT');
                return saved;
            }
            const row = this.db.prepare('SELECT data FROM presence WHERE id=?').get(id);
            const before = row ? JSON.parse(row.data) : undefined;
            // A known newer turn cannot be completed by an older turn's delayed hook.
            if (before?.turn &&
                turn &&
                before.turn !== turn &&
                !['UserPromptSubmit', 'SubagentStart'].includes(event)) {
                this.db
                    .prepare('INSERT INTO presence_events(person,event,at) VALUES (?,?,?)')
                    .run(id, 'Stale:' + event, new Date().toISOString());
                this.db
                    .prepare('INSERT INTO presence_receipts VALUES (?,?,?)')
                    .run(key, fingerprint, JSON.stringify(before));
                return before;
            }
            const status = ['Stop', 'SubagentStop'].includes(event)
                ? 'DELIVERED'
                : event === 'SessionEnd'
                    ? before?.status === 'DELIVERED'
                        ? 'DELIVERED'
                        : 'CLOSED'
                    : event === 'PermissionRequest'
                        ? 'BLOCKED'
                        : event === 'Interrupt'
                            ? 'CANCELED'
                            : event === 'SessionStart'
                                ? 'IDLE'
                                : 'RUNNING';
            const result = {
                id,
                provider,
                session: input.session_id,
                agent,
                role: before?.role || (agent ? 'subagent' : 'main'),
                ...(before?.label ? { label: before.label } : {}),
                status,
                version: (before?.version || 0) + 1,
                event,
                activity: status === 'RUNNING' ? activity : 'WORK',
                updatedAt: new Date().toISOString(),
                ...(turn || before?.turn ? { turn: turn || before?.turn } : {}),
            };
            this.db.prepare('INSERT OR REPLACE INTO presence VALUES (?,?)').run(id, JSON.stringify(result));
            this.db
                .prepare('INSERT INTO presence_events(person,event,at) VALUES (?,?,?)')
                .run(id, event, result.updatedAt);
            this.db
                .prepare('INSERT INTO presence_receipts VALUES (?,?,?)')
                .run(key, fingerprint, JSON.stringify(result));
            return result;
        });
    }
    acknowledge(id, command) {
        return this.change(id, command, 'Acknowledged', [], (result) => {
            if (result.status !== 'DELIVERED')
                throw Error('RESULT_NOT_READY');
            result.status = 'IDLE';
        });
    }
    configure(id, label, role, command) {
        if (typeof label !== 'string' ||
            typeof role !== 'string' ||
            !label.trim() ||
            !role.trim() ||
            label.length > 60 ||
            role.length > 100)
            throw Error('INVALID_SESSION_LABEL');
        return this.change(id, command, 'Configured', [label, role], (result) => {
            result.label = label.trim();
            result.role = role.trim();
        });
    }
    change(id, command, action, input, change) {
        const fingerprint = digest(JSON.stringify([id, command.expected_version, action, input]));
        return this.ownerReceipt(command, fingerprint, () => {
            const row = this.db.prepare('SELECT data FROM presence WHERE id=?').get(id);
            if (!row)
                throw Error('SESSION_NOT_FOUND');
            const result = JSON.parse(row.data);
            if (result.version !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            change(result);
            result.version++;
            result.event = action;
            result.updatedAt = new Date().toISOString();
            this.db.prepare('UPDATE presence SET data=? WHERE id=?').run(JSON.stringify(result), id);
            this.db
                .prepare('INSERT INTO presence_events(person,event,at) VALUES (?,?,?)')
                .run(id, result.event, result.updatedAt);
            return result;
        });
    }
    ownerReceipt(command, fingerprint, operation, namespace = 'owner') {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.project, minVersion: 1 });
        return (0, sqlite_js_1.transaction)(this.db, () => {
            const key = namespace + ':' + command.idempotency_key;
            const receipt = this.db
                .prepare('SELECT fingerprint,result FROM presence_receipts WHERE id=?')
                .get(key);
            if (receipt) {
                if (receipt.fingerprint !== fingerprint)
                    throw Error('IDEMPOTENCY_CONFLICT');
                return JSON.parse(receipt.result);
            }
            const result = operation();
            this.db
                .prepare('INSERT INTO presence_receipts VALUES (?,?,?)')
                .run(key, fingerprint, JSON.stringify(result));
            return result;
        });
    }
    close() {
        this.db.close();
    }
}
exports.OfficePresence = OfficePresence;
//# sourceMappingURL=office-presence.js.map