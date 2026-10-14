"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocialWorkspace = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_crypto_1 = require("node:crypto");
const command_js_1 = require("../domain/command.js");
const hash_js_1 = require("./hash.js");
const sqlite_js_1 = require("./sqlite.js");
const local_path_js_1 = require("./local-path.js");
const credentials_js_1 = require("./credentials.js");
const meta_social_js_1 = require("../adapters/meta-social.js");
/** Owner control and durable side-effect intent; AI local CLI can prepare, never auto-publish. */
class SocialWorkspace {
    root;
    credentials;
    meta;
    employee;
    db;
    constructor(root, credentials = new credentials_js_1.CredentialStore(), meta = new meta_social_js_1.MetaSocial(), employee = () => true) {
        this.root = root;
        this.credentials = credentials;
        this.meta = meta;
        this.employee = employee;
        (0, local_path_js_1.localDirectory)(root);
        if (!(0, node_fs_1.existsSync)((0, node_path_1.resolve)(root, '.aiorchestra')))
            (0, node_fs_1.mkdirSync)((0, node_path_1.resolve)(root, '.aiorchestra'));
        const folder = (0, local_path_js_1.localDirectory)((0, node_path_1.resolve)(root, '.aiorchestra'));
        const file = (0, node_path_1.resolve)(folder, 'social.db');
        if ((0, node_fs_1.existsSync)(file) && ((0, node_fs_1.lstatSync)(file).isSymbolicLink() || (0, node_fs_1.lstatSync)(file).nlink !== 1))
            throw Error('PATH_DENIED');
        this.db = (0, sqlite_js_1.openDatabase)(file);
        this.db.exec('CREATE TABLE IF NOT EXISTS social_accounts(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE IF NOT EXISTS social_drafts(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE IF NOT EXISTS social_receipts(id TEXT PRIMARY KEY,fingerprint TEXT,data TEXT);');
    }
    rows(table) {
        return this.db.prepare(`SELECT data FROM ${table} ORDER BY rowid DESC LIMIT 200`).all().map((r) => JSON.parse(r.data));
    }
    view() {
        return {
            accounts: this.rows('social_accounts').map(({ credential, ...a }) => ({
                ...a,
                tokenSet: this.credentials.entry(credential).set,
            })),
            drafts: this.rows('social_drafts').map((d) => ({
                ...d,
                state: ['CONTAINER_CREATING', 'PUBLISHING'].includes(d.state) ? 'UNKNOWN' : d.state,
            })),
            supports: ['threads-text', 'instagram-image'],
            auth: 'manual-meta-token',
        };
    }
    account(id) {
        const row = this.db.prepare('SELECT data FROM social_accounts WHERE id=?').get(id);
        if (!row)
            throw Error('SOCIAL_ACCOUNT_NOT_FOUND');
        return JSON.parse(row.data);
    }
    draft(id) {
        const row = this.db.prepare('SELECT data FROM social_drafts WHERE id=?').get(id);
        if (!row)
            throw Error('SOCIAL_DRAFT_NOT_FOUND');
        return JSON.parse(row.data);
    }
    save(d) {
        this.db.prepare('INSERT OR REPLACE INTO social_drafts VALUES(?,?)').run(d.id, JSON.stringify(d));
        return d;
    }
    async command(action, input, command) {
        (0, command_js_1.assertCommand)(command, { actor: 'local-user', project: this.root });
        if (!['connect', 'assign', 'disconnect', 'draft', 'approve', 'prepare', 'publish'].includes(action))
            throw Error('SOCIAL_ACTION_DENIED');
        // Only a digest of connection token is used in the receipt fingerprint.
        const fingerprint = (0, hash_js_1.hash)([
            action,
            { ...input, ...(input.token ? { token: (0, hash_js_1.hash)(input.token) } : {}) },
            command.expected_version,
        ]);
        const receipt = this.db
            .prepare('SELECT fingerprint,data FROM social_receipts WHERE id=?')
            .get(command.idempotency_key);
        if (receipt) {
            if (receipt.fingerprint !== fingerprint)
                throw Error('IDEMPOTENCY_CONFLICT');
            return JSON.parse(receipt.data);
        }
        const remember = (result) => {
            this.db
                .prepare('INSERT INTO social_receipts VALUES(?,?,?)')
                .run(command.idempotency_key, fingerprint, JSON.stringify(result));
            return result;
        };
        if (action === 'connect') {
            if (command.expected_version !== 0)
                throw Error('VERSION_CONFLICT');
            const platform = input.platform, version = String(input.apiVersion || ''), userId = String(input.userId || ''), token = String(input.token || '');
            if (!['threads', 'instagram'].includes(platform) ||
                !/^\d{1,40}$/.test(userId) ||
                !/^v\d{1,2}\.0$/.test(version) ||
                token.length < 8 ||
                token.length > 512 ||
                /\s/.test(token))
                throw Error('SOCIAL_INVALID_ACCOUNT');
            const profile = await this.meta.profile(platform, version, token, userId);
            if (profile.userId !== userId)
                throw Error('SOCIAL_ACCOUNT_MISMATCH');
            const id = (0, hash_js_1.hash)([this.root, platform, userId]).slice(0, 40), credential = `social:${id}`;
            if (this.rows('social_accounts').some((a) => a.id === id))
                throw Error('SOCIAL_ACCOUNT_EXISTS');
            await this.credentials.set(credential, token);
            return (0, sqlite_js_1.transaction)(this.db, () => {
                this.db.prepare('INSERT INTO social_accounts VALUES(?,?)').run(id, JSON.stringify({
                    id,
                    platform,
                    ...profile,
                    apiVersion: version,
                    credential,
                    employeeId: '',
                    version: 1,
                }));
                return remember({ id, connected: true });
            });
        }
        if (action === 'assign' || action === 'disconnect')
            return (0, sqlite_js_1.transaction)(this.db, () => {
                const a = this.account(String(input.id));
                if (a.version !== command.expected_version)
                    throw Error('VERSION_CONFLICT');
                if (action === 'disconnect') {
                    this.db.prepare('DELETE FROM social_accounts WHERE id=?').run(a.id);
                    return remember({ disconnected: true });
                }
                const id = String(input.employeeId || '');
                if (id && !this.employee(id))
                    throw Error('SOCIAL_EMPLOYEE_NOT_FOUND');
                a.employeeId = id;
                a.version++;
                this.db.prepare('UPDATE social_accounts SET data=? WHERE id=?').run(JSON.stringify(a), a.id);
                return remember({ assigned: true });
            });
        if (action === 'draft')
            return (0, sqlite_js_1.transaction)(this.db, () => {
                if (command.expected_version !== 0)
                    throw Error('VERSION_CONFLICT');
                const a = this.account(String(input.accountId)), text = String(input.text || ''), imageUrl = String(input.imageUrl || '');
                if (!text.trim() || [...text].length > (a.platform === 'threads' ? 500 : 2200) || text.includes('\0'))
                    throw Error('SOCIAL_INVALID_TEXT');
                if (a.platform === 'instagram') {
                    let url;
                    try {
                        url = new URL(imageUrl);
                    }
                    catch {
                        throw Error('SOCIAL_PUBLIC_IMAGE_REQUIRED');
                    }
                    if (url.protocol !== 'https:' ||
                        url.username ||
                        url.password ||
                        url.hash ||
                        url.hostname === 'localhost' ||
                        /^[\d.:\[\]]+$/.test(url.hostname) ||
                        url.hostname.endsWith('.local') ||
                        url.hostname.endsWith('.internal') ||
                        imageUrl.length > 2048)
                        throw Error('SOCIAL_PUBLIC_IMAGE_REQUIRED');
                }
                return remember(this.save({
                    id: (0, node_crypto_1.randomUUID)(),
                    accountId: a.id,
                    employeeId: a.employeeId,
                    text,
                    imageUrl: a.platform === 'instagram' ? imageUrl : '',
                    version: 1,
                    state: 'DRAFT',
                    updatedAt: new Date().toISOString(),
                    correlationId: command.correlation_id,
                }));
            });
        const d = this.draft(String(input.id));
        if (d.version !== command.expected_version)
            throw Error('VERSION_CONFLICT');
        const a = this.account(d.accountId);
        if (action === 'approve')
            return (0, sqlite_js_1.transaction)(this.db, () => {
                if (d.state !== 'DRAFT')
                    throw Error('SOCIAL_STATE_DENIED');
                d.state = 'APPROVED';
                d.version++;
                d.updatedAt = new Date().toISOString();
                d.correlationId = command.correlation_id;
                return remember(this.save(d));
            });
        if (action === 'prepare') {
            if (!['APPROVED', 'READY'].includes(d.state))
                throw Error('SOCIAL_STATE_DENIED');
            const token = await this.credentials.get(a.credential);
            // Compare again after credential IO, just before external side effect.
            if (this.draft(d.id).version !== d.version)
                throw Error('VERSION_CONFLICT');
            if (!d.container) {
                d.state = 'CONTAINER_CREATING';
                d.version++;
                this.save(d);
                try {
                    d.container = await this.meta.create(a, token, d.text, d.imageUrl);
                }
                catch {
                    d.state = 'UNKNOWN';
                    d.error = 'SOCIAL_CREATE_UNKNOWN';
                    return remember(this.save(d));
                }
            }
            d.state = 'READY';
            d.version++;
            d.updatedAt = new Date().toISOString();
            return remember(this.save(d));
        }
        if (d.state !== 'READY' || !d.container)
            throw Error('SOCIAL_STATE_DENIED');
        const token = await this.credentials.get(a.credential);
        if (!(await this.meta.ready(a, token, d.container)))
            throw Error('SOCIAL_MEDIA_NOT_READY');
        const latest = this.draft(d.id);
        if (latest.version !== d.version || latest.state !== 'READY')
            throw Error('VERSION_CONFLICT');
        // Persist UNKNOWN on restart before calling publish. A retry can never silently publish twice.
        d.state = 'PUBLISHING';
        d.version++;
        d.correlationId = command.correlation_id;
        this.save(d);
        try {
            d.postId = await this.meta.publish(a, token, d.container);
            d.state = 'PUBLISHED';
            delete d.error;
        }
        catch {
            d.state = 'UNKNOWN';
            d.error = 'SOCIAL_PUBLISH_UNKNOWN';
        }
        d.version++;
        d.updatedAt = new Date().toISOString();
        return remember(this.save(d));
    }
    close() {
        this.db.close();
    }
}
exports.SocialWorkspace = SocialWorkspace;
//# sourceMappingURL=social-workspace.js.map