"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CredentialStore = exports.dpapi = exports.credentialProviders = void 0;
exports.defaultCredentialFile = defaultCredentialFile;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const api_model_settings_js_1 = require("./api-model-settings.js");
const json_file_js_1 = require("./json-file.js");
/**
 * API keys for paid model providers (ADR 0051). Keys are entered once in the app and never sent back
 * to the browser: the UI only sees whether a key is set and its last four characters. On Windows the
 * value is encrypted with DPAPI for the current Windows user, so the file is useless on another
 * account or PC. The file lives in the user's app-data folder, outside every project, workspace and
 * backup. Keys go to PowerShell through stdin, never through arguments or environment variables.
 */
/** Paid API providers, plus OpenRouter for the free remote models (ADR 0043). */
exports.credentialProviders = [...api_model_settings_js_1.apiProviders, 'openrouter'];
const serverCredentialPattern = /^server:[a-z0-9][a-z0-9-]{0,39}$/;
const knownName = (name) => exports.credentialProviders.includes(name) ||
    serverCredentialPattern.test(name) ||
    /^social:[a-f0-9]{40}$/.test(name);
const dpapiScript = (op) => '$ErrorActionPreference = "Stop"; Add-Type -AssemblyName System.Security; ' +
    '$in = [Console]::In.ReadToEnd().Trim(); ' +
    (op === 'Protect'
        ? '$b = [Text.Encoding]::UTF8.GetBytes($in); $o = [Security.Cryptography.ProtectedData]::Protect($b, $null, "CurrentUser"); [Convert]::ToBase64String($o)'
        : '$b = [Convert]::FromBase64String($in); $o = [Security.Cryptography.ProtectedData]::Unprotect($b, $null, "CurrentUser"); [Convert]::ToBase64String($o)');
function powershell(script, input) {
    return new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 20000, maxBuffer: 65536, encoding: 'utf8' }, 
        // The error text can contain the input on some failures; only a code leaves this function.
        (error, stdout) => (error ? reject(Error('CREDENTIAL_PROTECTION_FAILED')) : resolve(stdout.trim())));
        child.stdin.end(input);
    });
}
exports.dpapi = {
    protect: (plain) => powershell(dpapiScript('Protect'), plain),
    unprotect: async (cipher) => Buffer.from(await powershell(dpapiScript('Unprotect'), cipher), 'base64').toString('utf8'),
};
function defaultCredentialFile() {
    const base = process.env.APPDATA ||
        (process.env.HOME ? (0, node_path_1.join)(process.env.HOME, '.config') : (0, node_path_1.join)(process.cwd(), '.aiorchestra'));
    return (0, node_path_1.join)(base, 'AIOrchestra', 'credentials.json');
}
class CredentialStore {
    file;
    protector;
    cache = new Map();
    constructor(file = process.env.AIORCHESTRA_CREDENTIALS || defaultCredentialFile(), protector = process.platform === 'win32' ? exports.dpapi : null) {
        this.file = file;
        this.protector = protector;
    }
    read() {
        if (!(0, node_fs_1.existsSync)(this.file))
            return {};
        try {
            return JSON.parse((0, node_fs_1.readFileSync)(this.file, 'utf8'));
        }
        catch {
            throw Error('CREDENTIAL_FILE_UNREADABLE');
        }
    }
    write(data) {
        (0, json_file_js_1.writeJsonFile)(this.file, data, 0o600);
        try {
            (0, node_fs_1.chmodSync)(this.file, 0o600);
        }
        catch {
            // Windows ACLs come from the user's profile folder; chmod is best effort there.
        }
    }
    /** What the UI may know: set or not, last four characters, when. Never the key. */
    status() {
        const data = this.read();
        return Object.fromEntries(exports.credentialProviders.map((p) => [
            p,
            data[p]
                ? { set: true, last4: data[p].last4, updatedAt: data[p].updatedAt, protection: data[p].protection }
                : { set: false },
        ]));
    }
    /** Status of one stored key by name (also "server:<id>"), never the key. */
    entry(name) {
        if (!knownName(name))
            throw Error('UNKNOWN_PROVIDER');
        const k = this.read()[name];
        return k ? { set: true, last4: k.last4, updatedAt: k.updatedAt, protection: k.protection } : { set: false };
    }
    async set(provider, key) {
        if (!knownName(provider))
            throw Error('UNKNOWN_PROVIDER');
        const value = String(key ?? '').trim();
        if (value.length < 8 || value.length > 512 || /\s/.test(value) || /[^\x21-\x7e]/.test(value))
            throw Error('INVALID_API_KEY');
        const stored = {
            value: this.protector ? await this.protector.protect(value) : value,
            protection: this.protector ? 'dpapi' : 'file',
            last4: value.slice(-4),
            updatedAt: new Date().toISOString(),
        };
        this.write({ ...this.read(), [provider]: stored });
        this.cache.set(provider, value);
        return this.entry(provider);
    }
    remove(provider) {
        if (!knownName(provider))
            throw Error('UNKNOWN_PROVIDER');
        const data = this.read();
        delete data[provider];
        this.write(data);
        this.cache.delete(provider);
        return { removed: true };
    }
    has(provider) {
        return !!this.read()[provider];
    }
    /** The key, for the adapter's Authorization header only. */
    async get(provider) {
        const cached = this.cache.get(provider);
        if (cached)
            return cached;
        const stored = this.read()[provider];
        if (!stored)
            throw Error('API_KEY_MISSING');
        let value;
        if (stored.protection === 'dpapi') {
            if (!this.protector)
                throw Error('CREDENTIAL_PROTECTION_UNAVAILABLE');
            value = await this.protector.unprotect(stored.value);
        }
        else
            value = stored.value;
        this.cache.set(provider, value);
        return value;
    }
}
exports.CredentialStore = CredentialStore;
//# sourceMappingURL=credentials.js.map