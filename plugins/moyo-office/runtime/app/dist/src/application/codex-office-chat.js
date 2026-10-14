"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodexOfficeChat = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const command_js_1 = require("../domain/command.js");
const sqlite_js_1 = require("../infrastructure/sqlite.js");
const hash_js_1 = require("../infrastructure/hash.js");
const local_path_js_1 = require("../infrastructure/local-path.js");
const codex_app_client_js_1 = require("../adapters/codex-app-client.js");
const codex_queue_js_1 = require("../adapters/codex-queue.js");
/** Read history via official RPC; send only to the original owner's official queue. */
class CodexOfficeChat {
    root;
    presence;
    rpc;
    queue;
    db;
    sending = new Set();
    constructor(root, presence, rpc = new codex_app_client_js_1.CodexAppClient(root), queue = codex_queue_js_1.queueCodexMessage) {
        this.root = root;
        this.presence = presence;
        this.rpc = rpc;
        this.queue = queue;
        const file = (0, node_path_1.resolve)((0, local_path_js_1.localDirectory)((0, node_path_1.resolve)(root, '.aiorchestra')), 'codex-chat.db');
        if ((0, node_fs_1.existsSync)(file) && ((0, node_fs_1.lstatSync)(file).isSymbolicLink() || (0, node_fs_1.lstatSync)(file).nlink !== 1))
            throw Error('PATH_DENIED');
        this.db = (0, sqlite_js_1.openDatabase)(file);
        this.db.exec('CREATE TABLE IF NOT EXISTS codex_chat_receipts(id TEXT PRIMARY KEY,fingerprint TEXT,data TEXT)');
    }
    person(id) {
        const p = this.presence.list().find((p) => p.id === id && p.provider === 'codex');
        if (!p)
            throw Error('SESSION_NOT_FOUND');
        return p;
    }
    async thread(p) {
        const threadId = p.agent || p.session;
        if (!/^[a-f0-9-]{36}$/.test(threadId))
            throw Error('INVALID_SESSION');
        const response = await this.rpc.call('thread/read', { threadId }), thread = response?.thread;
        const canonical = (path) => process.platform === 'win32' ? (0, node_fs_1.realpathSync)(path).toLowerCase() : (0, node_fs_1.realpathSync)(path);
        if (!thread ||
            thread.id !== threadId ||
            typeof thread.cwd !== 'string' ||
            canonical(thread.cwd) !== canonical(this.root))
            throw Error('PROJECT_MISMATCH');
        return thread;
    }
    unknown(id) {
        return this.db.prepare('SELECT data FROM codex_chat_receipts').all().some((r) => {
            const d = JSON.parse(r.data);
            return d.person === id && d.state === 'UNKNOWN';
        });
    }
    async read(id) {
        const p = this.person(id), thread = await this.thread(p);
        let historyTurnLimit = 6;
        const recent = () => this.rpc.call('thread/turns/list', {
            threadId: thread.id,
            limit: historyTurnLimit,
            sortDirection: 'desc',
            itemsView: 'summary',
        });
        let response;
        try {
            response = await recent();
        }
        catch (error) {
            if (!(error instanceof Error) || error.message !== 'CODEX_PROTOCOL_LIMIT')
                throw error;
            historyTurnLimit = 1;
            response = await recent();
        }
        const messages = [];
        for (const turn of Array.isArray(response?.data) ? [...response.data].reverse() : [])
            for (const item of turn.items || []) {
                if (!['userMessage', 'agentMessage'].includes(item.type))
                    continue;
                const text = item.type === 'userMessage'
                    ? (item.content || [])
                        .filter((c) => c.type === 'text' && typeof c.text === 'string')
                        .map((c) => c.text)
                        .join('\n')
                    : item.text;
                if (typeof text !== 'string' || !text.trim())
                    continue;
                messages.push({
                    id: String(item.id),
                    role: item.type === 'userMessage' ? 'user' : 'assistant',
                    text: text.slice(0, 16000),
                    truncated: text.length > 16000,
                });
            }
        const uncertain = this.unknown(p.id);
        return {
            person: p.id,
            presenceStatus: p.status,
            presenceVersion: p.version,
            threadId: thread.id,
            messages: messages.slice(-40),
            liveMessages: [],
            limited: !!response?.nextCursor || messages.length > 40,
            historyTurnLimit,
            state: p.status === 'RUNNING'
                ? 'active'
                : p.status === 'BLOCKED'
                    ? 'blocked'
                    : p.status === 'DELIVERED'
                        ? 'completed'
                        : p.status === 'IDLE'
                            ? 'idle'
                            : thread.status?.type || 'UNKNOWN',
            turnId: '',
            approvals: [],
            canSend: !p.agent && !this.sending.has(p.id) && !uncertain,
            blockedReason: uncertain ? 'DELIVERY_UNKNOWN' : p.agent ? 'SUBAGENT_READ_ONLY' : '',
            source: 'codex-app-server',
            client: 'original-codex-queue',
        };
    }
    async command(action, input, command) {
        (0, command_js_1.assertCommand)(command, { actor: 'local-user', project: this.root, version: 0 });
        if (action !== 'send')
            throw Error('CODEX_USE_ORIGINAL_CONTROLS');
        const p = this.person(String(input.id)), key = command.idempotency_key, fingerprint = (0, hash_js_1.hash)([p.id, action, input]);
        const prior = () => {
            const row = this.db.prepare('SELECT fingerprint,data FROM codex_chat_receipts WHERE id=?').get(key);
            if (!row)
                return;
            if (row.fingerprint !== fingerprint)
                throw Error('IDEMPOTENCY_CONFLICT');
            return JSON.parse(row.data);
        };
        const previous = prior();
        if (previous)
            return previous;
        if (p.agent)
            throw Error('CODEX_SUBAGENT_READ_ONLY');
        if (this.sending.has(p.id))
            throw Error('CODEX_THREAD_BUSY');
        if (this.unknown(p.id))
            throw Error('CODEX_DELIVERY_UNKNOWN');
        const text = input.text;
        if (typeof text !== 'string' || !text.trim() || text.length > 16000 || text.includes('\0'))
            throw Error('INVALID_MESSAGE');
        this.sending.add(p.id);
        try {
            const thread = await this.thread(p), account = await this.rpc.call('account/read', {});
            if (account?.account?.type !== 'chatgpt' || thread.modelProvider !== 'openai')
                throw Error('CODEX_CHATGPT_LOGIN_REQUIRED');
            this.person(p.id); // Presence still exists immediately before the external side effect.
            const raced = (0, sqlite_js_1.transaction)(this.db, () => {
                const previous = prior();
                if (previous)
                    return previous;
                if (this.unknown(p.id))
                    throw Error('CODEX_DELIVERY_UNKNOWN');
                this.db
                    .prepare('INSERT INTO codex_chat_receipts VALUES(?,?,?)')
                    .run(key, fingerprint, JSON.stringify({ state: 'UNKNOWN', person: p.id, correlationId: command.correlation_id }));
            });
            if (raced)
                return raced;
            let result;
            try {
                result = await this.queue(this.root, thread.id, text);
            }
            catch {
                result = { state: 'UNKNOWN', error: 'CODEX_QUEUE_UNCONFIRMED' };
            }
            const data = { ...result, person: p.id, correlationId: command.correlation_id };
            this.db.prepare('UPDATE codex_chat_receipts SET data=? WHERE id=?').run(JSON.stringify(data), key);
            return data;
        }
        finally {
            this.sending.delete(p.id);
        }
    }
    close() {
        this.rpc.close();
        this.db.close();
    }
}
exports.CodexOfficeChat = CodexOfficeChat;
//# sourceMappingURL=codex-office-chat.js.map