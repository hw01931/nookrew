"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebAccess = void 0;
exports.isPublicAddress = isPublicAddress;
const node_dns_1 = require("node:dns");
const node_fs_1 = require("node:fs");
const node_http_1 = require("node:http");
const node_https_1 = require("node:https");
const node_net_1 = require("node:net");
const node_path_1 = require("node:path");
const node_zlib_1 = require("node:zlib");
const collaboration_js_1 = require("../domain/collaboration.js");
const json_file_js_1 = require("../infrastructure/json-file.js");
const web_access_js_1 = require("../domain/web-access.js");
/**
 * Free web search and page reading for employees (ADR 0056). No search-engine key: Wikipedia's public
 * search API, an optional SearXNG the owner runs on their own PC, and direct page reads. Every request
 * is made here, never by the model, and only to public internet addresses.
 */
const blocked = new node_net_1.BlockList();
for (const [net, bits] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
])
    blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
    ['::', 128],
    ['::1', 128],
    ['64:ff9b::', 96],
    ['2001:db8::', 32],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
])
    blocked.addSubnet(net, bits, 'ipv6');
/** Public internet address: not loopback, private, link-local, shared, documentation or multicast. */
function isPublicAddress(ip) {
    const family = (0, node_net_1.isIP)(ip);
    if (family === 4)
        return !blocked.check(ip, 'ipv4');
    if (family !== 6)
        return false;
    // IPv4-mapped (::ffff:a.b.c.d or ::ffff:hhhh:hhhh) is judged as the IPv4 address it carries. A
    // ::ffff:0:0/96 rule cannot be used: BlockList applies mapped rules to every IPv4 check too.
    const mapped = /^(?:0{0,4}:){0,5}:?ffff:(.+)$/i.exec(ip);
    if (mapped) {
        const tail = mapped[1];
        if ((0, node_net_1.isIP)(tail) === 4)
            return isPublicAddress(tail);
        const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail);
        if (!hex)
            return false;
        const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
        return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return !blocked.check(ip, 'ipv6');
}
const userAgent = 'AIOrchestra/0.1 (local desktop app; employee web search)';
function charsetOf(contentType, head) {
    const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
    const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head.subarray(0, 4096).toString('latin1'))?.[1];
    return (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase();
}
function decode(bytes, contentType) {
    try {
        return new TextDecoder(charsetOf(contentType, bytes)).decode(bytes);
    }
    catch {
        return new TextDecoder('utf-8').decode(bytes);
    }
}
/** One GET without following redirects; the address is checked after DNS and before connecting. */
function getOnce(url, allow, accept) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if ((0, node_net_1.isIP)(host) && !allow(host))
        return Promise.reject(Error('WEB_ADDRESS_BLOCKED'));
    const lookup = (hostname, options, callback) => (0, node_dns_1.lookup)(hostname, { all: true }, (err, addresses) => {
        if (err)
            return callback(Error('WEB_DNS_FAILED'), '');
        // One private answer is enough to refuse: DNS can mix public and private records.
        if (!addresses.length || addresses.some((a) => !allow(a.address)))
            return callback(Error('WEB_ADDRESS_BLOCKED'), '');
        if (options.all)
            callback(null, addresses);
        else
            callback(null, addresses[0].address, addresses[0].family);
    });
    return new Promise((done, fail) => {
        const req = (url.protocol === 'https:' ? node_https_1.request : node_http_1.request)(url, {
            method: 'GET',
            lookup: lookup,
            headers: { 'User-Agent': userAgent, Accept: accept, 'Accept-Encoding': 'gzip, deflate, br' },
            timeout: web_access_js_1.webLimits.timeoutMs,
        }, done);
        req.on('timeout', () => req.destroy(Error('WEB_TIMEOUT')));
        req.on('error', (e) => fail(e.message.startsWith('WEB_') ? e : Error('WEB_CONNECT_FAILED')));
        req.end();
    });
}
function readBody(res) {
    const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
    const stream = encoding === 'gzip'
        ? res.pipe((0, node_zlib_1.createGunzip)())
        : encoding === 'deflate'
            ? res.pipe((0, node_zlib_1.createInflate)())
            : encoding === 'br'
                ? res.pipe((0, node_zlib_1.createBrotliDecompress)())
                : res;
    return new Promise((done, fail) => {
        const chunks = [];
        let size = 0;
        const timer = setTimeout(() => {
            res.destroy();
            fail(Error('WEB_TIMEOUT'));
        }, web_access_js_1.webLimits.timeoutMs);
        stream.on('data', (chunk) => {
            size += chunk.length;
            chunks.push(chunk);
            if (size >= web_access_js_1.webLimits.maxBytes) {
                clearTimeout(timer);
                res.destroy();
                done({ bytes: Buffer.concat(chunks).subarray(0, web_access_js_1.webLimits.maxBytes), truncated: true });
            }
        });
        stream.on('end', () => {
            clearTimeout(timer);
            done({ bytes: Buffer.concat(chunks), truncated: false });
        });
        stream.on('error', () => {
            clearTimeout(timer);
            fail(Error('WEB_READ_FAILED'));
        });
    });
}
/** GET with redirects; every hop is a new address check. `sameOrigin` keeps a trusted origin from redirecting away. */
async function get(start, allow, accept, sameOrigin = false) {
    let url = start;
    for (let hop = 0;; hop++) {
        const res = await getOnce(url, allow, accept);
        const location = res.headers.location;
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location) {
            res.resume();
            if (hop >= web_access_js_1.webLimits.redirects)
                throw Error('WEB_TOO_MANY_REDIRECTS');
            const next = (0, web_access_js_1.webUrl)(new URL(location, url).href);
            if (sameOrigin && next.origin !== start.origin)
                throw Error('WEB_REDIRECT_BLOCKED');
            url = next;
            continue;
        }
        const contentType = String(res.headers['content-type'] ?? '');
        const { bytes, truncated } = await readBody(res);
        return { url, status: res.statusCode ?? 0, contentType, body: decode(bytes, contentType), truncated };
    }
}
const defaults = () => ({
    schemaVersion: 1,
    wikipedia: true,
    wikipediaLanguage: 'ko',
    searxngUrl: '',
});
const readable = /^(text\/|application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml|ld\+json))/i;
class WebAccess {
    allow;
    file;
    pages = new Map();
    constructor(directory, 
    /** Address policy; tests widen it to reach a local fixture server. */
    allow = isPublicAddress) {
        this.allow = allow;
        this.file = (0, node_path_1.resolve)(directory, 'web-search.json');
    }
    settings() {
        if (!(0, node_fs_1.existsSync)(this.file))
            return defaults();
        const data = JSON.parse((0, node_fs_1.readFileSync)(this.file, 'utf8'));
        if (data.schemaVersion !== 1)
            throw Error('INVALID_WEB_SETTINGS');
        return { ...defaults(), ...data };
    }
    save(input) {
        const current = this.settings();
        const next = { ...current };
        if (input.wikipedia !== undefined) {
            if (typeof input.wikipedia !== 'boolean')
                throw Error('INVALID_WEB_SETTINGS');
            next.wikipedia = input.wikipedia;
        }
        if (input.wikipediaLanguage !== undefined) {
            if (!web_access_js_1.wikipediaLanguages.includes(input.wikipediaLanguage))
                throw Error('INVALID_WEB_SETTINGS');
            next.wikipediaLanguage = input.wikipediaLanguage;
        }
        if (input.searxngUrl !== undefined) {
            const raw = String(input.searxngUrl).trim();
            next.searxngUrl = raw ? (0, web_access_js_1.webUrl)(raw).href.replace(/\/+$/, '') : '';
        }
        (0, json_file_js_1.writeJsonFile)(this.file, next);
        return next;
    }
    async wikipedia(query, language) {
        const url = new URL(`https://${language}.wikipedia.org/w/rest.php/v1/search/page`);
        url.searchParams.set('q', query);
        url.searchParams.set('limit', String(web_access_js_1.webLimits.results));
        const res = await get(url, this.allow, 'application/json');
        if (res.status !== 200)
            throw new collaboration_js_1.ToolError('WEB_HTTP_ERROR', `HTTP ${res.status}`);
        const pages = JSON.parse(res.body)
            .pages;
        return (pages ?? [])
            .filter((p) => typeof p.title === 'string' && typeof p.key === 'string')
            .map((p) => ({
            title: p.title,
            url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(p.key)}`,
            snippet: (0, web_access_js_1.snippetText)(p.excerpt),
        }));
    }
    async searxng(query, base) {
        const url = new URL(base + '/search');
        url.searchParams.set('q', query);
        url.searchParams.set('format', 'json');
        // The owner chose this address, so it may be on their own PC; it may not redirect elsewhere.
        const res = await get(url, () => true, 'application/json', true);
        if (res.status === 403)
            throw Error('SEARXNG_JSON_DISABLED');
        if (res.status !== 200)
            throw new collaboration_js_1.ToolError('WEB_HTTP_ERROR', `HTTP ${res.status}`);
        let data;
        try {
            data = JSON.parse(res.body);
        }
        catch {
            throw Error('SEARXNG_JSON_DISABLED');
        }
        const results = [];
        for (const r of data.results ?? []) {
            try {
                results.push({
                    title: (0, web_access_js_1.snippetText)(r.title, 200),
                    url: (0, web_access_js_1.webUrl)(r.url).href,
                    snippet: (0, web_access_js_1.snippetText)(r.content),
                });
            }
            catch {
                // Results that are not plain http(s) links are left out.
            }
            if (results.length >= web_access_js_1.webLimits.results)
                break;
        }
        return results;
    }
    /** Search the free sources. `auto` uses the owner's SearXNG when set, otherwise Wikipedia. */
    async search(input) {
        const query = (0, web_access_js_1.webQuery)(input.query);
        const source = (input.source ?? 'auto');
        if (!web_access_js_1.webSources.includes(source))
            throw Error('WEB_SOURCE_INVALID');
        const settings = this.settings();
        const useSearxng = source === 'searxng' || (source === 'auto' && settings.searxngUrl);
        let fallback;
        if (useSearxng) {
            if (!settings.searxngUrl)
                throw Error('SEARXNG_NOT_SET');
            try {
                return {
                    source: 'searxng',
                    query,
                    results: await this.searxng(query, settings.searxngUrl),
                    note: web_access_js_1.untrustedNote,
                };
            }
            catch (e) {
                if (source === 'searxng')
                    throw e;
                // Say plainly that the owner's search failed and what was used instead.
                fallback = `SEARXNG_FAILED:${e.message}`;
            }
        }
        if (!settings.wikipedia)
            throw Error(fallback ? fallback.split(':')[1] : 'WEB_SEARCH_OFF');
        const first = settings.wikipediaLanguage;
        let language = first;
        let results = await this.wikipedia(query, first);
        if (!results.length) {
            language = first === 'ko' ? 'en' : 'ko';
            results = await this.wikipedia(query, language);
        }
        return {
            source: `wikipedia-${language}`,
            query,
            results,
            ...(fallback ? { fallback } : {}),
            note: web_access_js_1.untrustedNote,
        };
    }
    /**
     * A Wikipedia article as plain text from its own API: the HTML page carries menus and a long
     * language list that would fill a small model's context.
     */
    async wikipediaArticle(url) {
        const site = /^([a-z]{2,3})\.(?:m\.)?wikipedia\.org$/.exec(url.hostname);
        const title = /^\/wiki\/(.+)$/.exec(url.pathname)?.[1];
        if (!site || !title)
            return undefined;
        const api = new URL(`https://${site[1]}.wikipedia.org/w/api.php`);
        for (const [k, v] of Object.entries({
            action: 'query',
            prop: 'extracts',
            explaintext: '1',
            redirects: '1',
            format: 'json',
            formatversion: '2',
            titles: decodeURIComponent(title),
        }))
            api.searchParams.set(k, v);
        const res = await get(api, this.allow, 'application/json');
        if (res.status !== 200)
            throw new collaboration_js_1.ToolError('WEB_HTTP_ERROR', `HTTP ${res.status}`);
        const found = JSON.parse(res.body).query
            ?.pages?.[0];
        if (typeof found?.extract !== 'string' || !found.extract.trim())
            return undefined;
        const page = {
            title: found.title ?? '',
            text: found.extract.trim(),
            contentType: 'text/plain',
            truncated: res.truncated,
        };
        this.pages.set(url.href, page);
        if (this.pages.size > 20)
            this.pages.delete(this.pages.keys().next().value);
        return page;
    }
    /** Read one public page as text, a part at a time. */
    async fetchPage(input) {
        const url = (0, web_access_js_1.webUrl)(input.url);
        // A later part (offset > 0) reuses the text already read; a first read always fetches again.
        const continuing = input.offset !== undefined && input.offset !== 0;
        let page = continuing ? this.pages.get(url.href) : undefined;
        page ??= await this.wikipediaArticle(url);
        if (!page) {
            const res = await get(url, this.allow, 'text/html, text/plain;q=0.9, application/json;q=0.8, */*;q=0.1');
            if (res.status < 200 || res.status >= 300)
                throw new collaboration_js_1.ToolError('WEB_HTTP_ERROR', `HTTP ${res.status}`);
            const type = res.contentType.split(';')[0].trim() || 'text/html';
            if (!readable.test(type))
                throw Error('WEB_CONTENT_UNSUPPORTED');
            const html = /html|xml/i.test(type) || /^\s*</.test(res.body);
            const parsed = html ? (0, web_access_js_1.htmlToText)(res.body) : { title: '', text: res.body.trim() };
            page = { ...parsed, contentType: type, truncated: res.truncated };
            this.pages.delete(url.href);
            this.pages.set(url.href, page);
            if (this.pages.size > 20)
                this.pages.delete(this.pages.keys().next().value);
            if (res.url.href !== url.href)
                this.pages.set(res.url.href, page);
        }
        return {
            url: url.href,
            title: page.title,
            contentType: page.contentType,
            totalChars: page.text.length,
            ...(page.truncated ? { truncated: true } : {}),
            ...(0, web_access_js_1.textPage)(page.text, input.offset),
            note: web_access_js_1.untrustedNote,
        };
    }
    /** Owner's "연결 확인": one small search per configured source. */
    async test() {
        const settings = this.settings();
        const check = async (run) => {
            try {
                return { ok: true, count: (await run()).length };
            }
            catch (e) {
                return { ok: false, error: e.message };
            }
        };
        // Both at once, so the check answers within one request timeout.
        const [wikipedia, searxng] = await Promise.all([
            settings.wikipedia ? check(() => this.wikipedia('서울', settings.wikipediaLanguage)) : undefined,
            settings.searxngUrl ? check(() => this.searxng('test', settings.searxngUrl)) : undefined,
        ]);
        return { ...(wikipedia ? { wikipedia } : {}), ...(searxng ? { searxng } : {}) };
    }
}
exports.WebAccess = WebAccess;
//# sourceMappingURL=web-access.js.map