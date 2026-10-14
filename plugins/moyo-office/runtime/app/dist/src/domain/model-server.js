"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serverIdPattern = exports.serverModelPattern = void 0;
exports.parseServerUrl = parseServerUrl;
exports.serverReach = serverReach;
exports.costRule = costRule;
exports.assertKeyTransport = assertKeyTransport;
const api_budget_js_1 = require("./api-budget.js");
/**
 * A base URL the app will call, normalized: http(s) only, no user name or password, no query or
 * fragment, no trailing slash, and "/v1" added when no path is given (the OpenAI convention every
 * listed server follows). Throws a code the screen can explain.
 */
function parseServerUrl(raw) {
    const text = String(raw ?? '').trim();
    if (!text || text.length > 300)
        throw Error('INVALID_SERVER_URL');
    let url;
    try {
        url = new URL(text);
    }
    catch {
        throw Error('INVALID_SERVER_URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw Error('INVALID_SERVER_URL');
    // A key belongs in the credential store, never in an address that is shown, stored and logged.
    if (url.username || url.password)
        throw Error('SERVER_URL_CREDENTIALS');
    if (url.search || url.hash || text.includes('?') || text.includes('#'))
        throw Error('INVALID_SERVER_URL');
    if (!url.hostname)
        throw Error('INVALID_SERVER_URL');
    const path = url.pathname.replace(/\/+$/, '');
    return url.origin + (path || '/v1');
}
const ipv4 = (host) => {
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m)
        return undefined;
    const parts = m.slice(1).map(Number);
    return parts.every((n) => n <= 255) ? parts : undefined;
};
/**
 * Loopback: localhost names, 127.0.0.0/8 and ::1. LAN: private IPv4 (10/8, 172.16/12, 192.168/16),
 * link-local (169.254/16, fe80::/10) and unique-local IPv6 (fc00::/7). Any other name or address is
 * remote, including LAN host names, because a name can resolve anywhere; the owner then decides.
 */
function serverReach(baseUrl) {
    const host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host === '::1')
        return 'loopback';
    const v4 = ipv4(host) ?? ipv4(host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1] ?? '');
    if (v4) {
        const [a, b] = v4;
        if (a === 127)
            return 'loopback';
        if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254))
            return 'lan';
        return 'remote';
    }
    if (host.includes(':')) {
        if (/^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe[89ab][0-9a-f]?:/.test(host))
            return 'lan';
    }
    return 'remote';
}
function costRule(server, model) {
    if (serverReach(server.baseUrl) !== 'remote')
        return { kind: 'free', why: 'local' };
    if (server.free === true)
        return { kind: 'free', why: 'owner' };
    if (model.price && (0, api_budget_js_1.validPrice)(model.price))
        return { kind: 'paid', price: model.price };
    return { kind: 'undecided' };
}
/**
 * A key sent in clear text over the internet can be read on the way. Plain http is accepted on this
 * PC and the local network, and for keyless remote servers; a key needs https once it leaves the LAN.
 */
function assertKeyTransport(baseUrl, keyed) {
    if (keyed && serverReach(baseUrl) === 'remote' && new URL(baseUrl).protocol !== 'https:')
        throw Error('SERVER_KEY_NEEDS_HTTPS');
}
/** Model ids as servers name them: "llama3.1:8b", "lmstudio-community/x-GGUF", "/models/foo". */
exports.serverModelPattern = /^[\w.:/@+-]{1,200}$/;
/** Server ids are app-made slugs; they also name the server's credential ("server:<id>"). */
exports.serverIdPattern = /^[a-z0-9][a-z0-9-]{0,39}$/;
//# sourceMappingURL=model-server.js.map