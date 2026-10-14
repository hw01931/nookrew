"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodexAppClient = exports.CodexRpcRejected = void 0;
exports.codexExecutable = codexExecutable;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
class CodexRpcRejected extends Error {
    method;
    rpcCode;
    reason;
    diagnostic;
    constructor(method, rpcCode, reason = 'UNKNOWN', diagnostic = []) {
        super(reason === 'SESSION_ALREADY_ACTIVE'
            ? 'CODEX_THREAD_ALREADY_ACTIVE'
            : 'CODEX_RPC_REJECTED_' + method.replaceAll('/', '_').toUpperCase());
        this.method = method;
        this.rpcCode = rpcCode;
        this.reason = reason;
        this.diagnostic = diagnostic;
    }
}
exports.CodexRpcRejected = CodexRpcRejected;
const safeDiagnosticWords = new Set('thread resume invalid request missing dynamic tools tool config configuration required unsupported cannot not found history rollout mode client model provider approval sandbox permissions profile experimental capability locked server session default field value method allowed initialize unrecognized unknown policy permission does exist path current allow inherit already active busy loaded elsewhere another process use open owned desktop memory running archived deleted mismatch failed error disconnected created persisted legacy paginated needs requires load hydratable'.split(' '));
const execute = (file, args) => new Promise((done, reject) => (0, node_child_process_1.execFile)(file, args, { windowsHide: true, timeout: 10000, maxBuffer: 65536, encoding: 'utf8' }, (error, output) => (error ? reject(Error('CODEX_CLI_NOT_FOUND')) : done(output))));
async function codexExecutable() {
    const configured = process.env.CODEX_EXECUTABLE;
    if (configured) {
        if (!(0, node_path_1.isAbsolute)(configured) ||
            !(0, node_fs_1.existsSync)(configured) ||
            (process.platform === 'win32' && !configured.toLowerCase().endsWith('.exe')))
            throw Error('CODEX_CLI_NOT_FOUND');
        return configured;
    }
    if (process.platform !== 'win32')
        return 'codex';
    let paths = [];
    try {
        paths = (await execute('where.exe', ['codex.exe'])).trim().split(/\r?\n/);
    }
    catch {
        /* desktop may keep its CLI outside PATH */
    }
    if (!paths.length) {
        const script = 'Get-CimInstance Win32_Process -Filter "name=\'codex.exe\'" | Select-Object -ExpandProperty ExecutablePath -Unique';
        try {
            paths = (await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]))
                .trim()
                .split(/\r?\n/);
        }
        catch {
            /* unsupported */
        }
    }
    const file = paths.find((p) => (0, node_path_1.isAbsolute)(p) && p.toLowerCase().endsWith('codex.exe') && (0, node_fs_1.existsSync)(p));
    if (!file)
        throw Error('CODEX_CLI_NOT_FOUND');
    return file;
}
/** Official newline JSON-RPC stdio transport. Arbitrary RPCs are never exposed to HTTP clients. */
class CodexAppClient {
    root;
    executable;
    process;
    starting;
    sequence = 0;
    pending = new Map();
    listeners = new Set();
    buffer = '';
    constructor(root, executable = codexExecutable) {
        this.root = root;
        this.executable = executable;
    }
    async start() {
        if (this.starting)
            return this.starting;
        this.starting = (async () => {
            const binary = await this.executable();
            const child = (0, node_child_process_1.spawn)(binary, ['app-server', '--stdio'], {
                cwd: this.root,
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            this.process = child;
            child.stderr.resume(); // Native stderr can contain sensitive account/tool data; never mirror it.
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (chunk) => {
                if (this.process !== child)
                    return;
                this.buffer += chunk;
                if (this.buffer.length > 16 * 1024 * 1024) {
                    this.fail('CODEX_PROTOCOL_LIMIT');
                    return;
                }
                let newline;
                while ((newline = this.buffer.indexOf('\n')) >= 0) {
                    const line = this.buffer.slice(0, newline);
                    this.buffer = this.buffer.slice(newline + 1);
                    let message;
                    try {
                        message = JSON.parse(line);
                    }
                    catch {
                        continue;
                    }
                    if (!message.method && typeof message.id === 'number' && this.pending.has(message.id)) {
                        const pending = this.pending.get(message.id);
                        this.pending.delete(message.id);
                        clearTimeout(pending.timer);
                        if (message.error)
                            pending.reject(new CodexRpcRejected(pending.method, Number(message.error.code), typeof message.error.message === 'string' && /already active/i.test(message.error.message)
                                ? 'SESSION_ALREADY_ACTIVE'
                                : typeof message.error.message === 'string' &&
                                    message.error.message.includes('requires experimentalApi capability')
                                    ? 'EXPERIMENTAL_API_REQUIRED'
                                    : 'UNKNOWN', (String(message.error.message || '').match(/\b[a-zA-Z]+\b/g) || [])
                                .map((w) => w.toLowerCase())
                                .filter((w) => safeDiagnosticWords.has(w))
                                .slice(0, 30)));
                        else
                            pending.done(message.result);
                    }
                    else
                        for (const listener of this.listeners)
                            listener(message);
                }
            });
            child.once('error', () => {
                if (this.process === child)
                    this.fail('CODEX_CLI_UNAVAILABLE');
            });
            child.once('exit', () => {
                if (this.process === child)
                    this.fail('CODEX_CONNECTION_CLOSED');
            });
            await this.request('initialize', {
                clientInfo: { name: 'moyo-office', title: 'Moyo Office', version: '0.1.0' },
            });
            child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
        })();
        try {
            await this.starting;
        }
        catch (error) {
            this.starting = undefined;
            throw error;
        }
    }
    request(method, params) {
        return new Promise((done, reject) => {
            const id = ++this.sequence, timer = setTimeout(() => {
                this.pending.delete(id);
                reject(Error('CODEX_RPC_TIMEOUT'));
            }, 30000);
            this.pending.set(id, { method, done, reject, timer });
            this.process.stdin.write(JSON.stringify({ id, method, params }) + '\n', (error) => {
                if (error) {
                    clearTimeout(timer);
                    this.pending.delete(id);
                    reject(Error('CODEX_CONNECTION_CLOSED'));
                }
            });
        });
    }
    async call(method, params) {
        await this.start();
        return this.request(method, params);
    }
    respond(id, result) {
        if (!this.process || this.process.killed)
            throw Error('CODEX_CONNECTION_CLOSED');
        this.process.stdin.write(JSON.stringify({ id, result }) + '\n');
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    fail(code) {
        const child = this.process;
        this.process = undefined;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(Error(code));
        }
        this.pending.clear();
        this.starting = undefined;
        this.buffer = '';
        for (const listener of this.listeners)
            listener({ method: 'moyo/disconnected' });
        child?.kill();
    }
    close() {
        this.listeners.clear();
        this.fail('CODEX_CONNECTION_CLOSED');
        this.process = undefined;
    }
}
exports.CodexAppClient = CodexAppClient;
//# sourceMappingURL=codex-app-client.js.map