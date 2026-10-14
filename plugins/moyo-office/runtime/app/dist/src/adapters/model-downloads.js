"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelDownloads = void 0;
exports.loadModelCatalog = loadModelCatalog;
exports.linkTarget = linkTarget;
exports.extractZip = extractZip;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:dns/promises");
const node_net_1 = require("node:net");
const web_access_js_1 = require("./web-access.js");
const local_models_js_1 = require("./local-models.js");
const pinned = /^https:\/\/(github\.com\/ggml-org\/llama\.cpp\/releases\/download|huggingface\.co\/[\w.-]+\/[\w.-]+\/resolve\/[0-9a-f]{40})\//;
const sha = /^[0-9a-f]{64}$/;
const local = /^local-lab\/(runtime|models)\/(?!\.{1,2}(\/|$))[\w.-]+(\/(?!\.{1,2}$)[\w.-]+)?$/;
/** Hops a pasted link may take to reach the file (Hugging Face and GitHub use one or two). */
const maxLinkRedirects = 5;
/** Ceiling for a download whose size the catalog does not pin; the largest GGUF files are ~150 GB. */
const maxUnpinnedBytes = 200 * 1024 ** 3;
async function resolveAddresses(hostname) {
    return (await (0, promises_1.lookup)(hostname, { all: true })).map((a) => a.address);
}
/** Loads and checks the catalog; a URL that is not pinned or a path outside local-lab is refused. */
function loadModelCatalog(root) {
    const catalog = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(root, 'config/model-catalog.json'), 'utf8'));
    const files = [...catalog.runtimes.flatMap((r) => r.archives), ...catalog.models];
    if (catalog.schemaVersion !== 1 ||
        files.some((f) => !pinned.test(f.url) || !sha.test(f.sha256 ?? '')) ||
        catalog.runtimes.some((r) => !local.test(r.dir) || !/^[\w.-]+\.exe$/.test(r.executable)) ||
        catalog.models.some((m) => !local.test(m.file) || !catalog.runtimes.some((r) => r.id === m.runtime)))
        throw Error('INVALID_MODEL_CATALOG');
    return catalog;
}
/**
 * Where a pasted link is saved: https only, a .gguf file name, inside the model folder. Hugging Face
 * page links (/blob/) are turned into file links (/resolve/).
 */
function linkTarget(raw) {
    let url;
    try {
        url = new URL(String(raw).trim());
    }
    catch {
        throw Error('INVALID_MODEL_LINK');
    }
    if (url.protocol !== 'https:' || url.username || url.password)
        throw Error('INVALID_MODEL_LINK');
    if (url.hostname === 'huggingface.co')
        url.pathname = url.pathname.replace(/^(\/[^/]+\/[^/]+)\/blob\//, '$1/resolve/');
    let name;
    try {
        name = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
    }
    catch {
        throw Error('INVALID_MODEL_LINK');
    }
    if (!/^[\w.+-]{1,200}\.gguf$/i.test(name) || name.startsWith('.'))
        throw Error('MODEL_LINK_NOT_GGUF');
    return { url: url.href, file: `${local_models_js_1.modelFolder}/links/${name}`, name };
}
async function fileHash(path) {
    const hash = (0, node_crypto_1.createHash)('sha256');
    for await (const chunk of (0, node_fs_1.createReadStream)(path))
        hash.update(chunk);
    return hash.digest('hex');
}
/** Windows' bundled bsdtar unpacks zip archives and refuses absolute or parent paths by default. */
function extractZip(archive, destination) {
    const tar = (0, node_path_1.join)(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    return new Promise((done, fail) => (0, node_child_process_1.execFile)(tar, ['-xf', archive, '-C', destination], { windowsHide: true }, (error) => error ? fail(Error('EXTRACT_FAILED')) : done()));
}
class ModelDownloads {
    root;
    catalog;
    request;
    extract;
    resolveHost;
    progress = new Map();
    active = null;
    constructor(root, catalog = loadModelCatalog(root), request = fetch, extract = extractZip, 
    /** DNS for pasted links; tests give fixed answers. The address policy itself is not injectable. */
    resolveHost = resolveAddresses) {
        this.root = root;
        this.catalog = catalog;
        this.request = request;
        this.extract = extract;
        this.resolveHost = resolveHost;
    }
    /** Catalog files: pinned hosts and SHA-256, so the platform's redirect handling is kept. */
    catalogGet = (url, headers, signal) => this.request(url, { signal, headers });
    /**
     * Pasted links: every hop must be https to a public address. One private DNS answer is enough to
     * refuse, since DNS can mix public and private records. The check runs before each request, so a
     * DNS answer that changes between the check and the connection is not covered here.
     */
    linkGet = async (start, headers, signal) => {
        let url = new URL(start);
        for (let hop = 0;; hop++) {
            if (url.protocol !== 'https:' || url.username || url.password)
                throw Error(hop ? 'MODEL_LINK_INSECURE_REDIRECT' : 'INVALID_MODEL_LINK');
            const host = url.hostname.replace(/^\[|\]$/g, '');
            let addresses;
            try {
                addresses = (0, node_net_1.isIP)(host) ? [host] : await this.resolveHost(host);
            }
            catch {
                throw Error('MODEL_LINK_DNS_FAILED');
            }
            if (!addresses.length || addresses.some((a) => !(0, web_access_js_1.isPublicAddress)(a)))
                throw Error('MODEL_LINK_ADDRESS_BLOCKED');
            const response = await this.request(url.href, { signal, headers, redirect: 'manual' });
            const location = response.headers.get('location');
            if (response.status < 300 || response.status > 399 || !location)
                return response;
            await response.body?.cancel();
            if (hop >= maxLinkRedirects)
                throw Error('MODEL_LINK_TOO_MANY_REDIRECTS');
            try {
                url = new URL(location, url);
            }
            catch {
                throw Error('MODEL_LINK_BAD_REDIRECT');
            }
        }
    };
    runtimeReady(r) {
        return (0, node_fs_1.existsSync)((0, node_path_1.resolve)(this.root, r.dir, r.executable));
    }
    modelReady(m) {
        const path = (0, node_path_1.resolve)(this.root, m.file);
        return (0, node_fs_1.existsSync)(path) && (0, node_fs_1.statSync)(path).size === m.bytes;
    }
    list() {
        return {
            runtimes: this.catalog.runtimes.map((r) => ({
                id: r.id,
                label: r.label,
                description: r.description,
                license: r.license,
                installed: this.runtimeReady(r),
                progress: this.progress.get(r.id) ?? null,
            })),
            models: this.catalog.models.map((m) => {
                const runtime = this.catalog.runtimes.find((r) => r.id === m.runtime);
                return {
                    id: m.id,
                    label: m.label,
                    description: m.description,
                    license: m.license,
                    bytes: m.bytes,
                    vramGb: m.vramGb,
                    ...(m.ramGb ? { ramGb: m.ramGb } : {}),
                    checked: m.checked !== false,
                    runtime: runtime.label,
                    installed: this.modelReady(m),
                    runtimeInstalled: this.runtimeReady(runtime),
                    progress: this.progress.get(m.id) ?? null,
                };
            }),
            links: [...this.progress.entries()]
                .filter(([id]) => id.startsWith('link:'))
                .map(([id, progress]) => ({ id, label: id.slice(5), progress })),
            busy: this.active?.id ?? null,
        };
    }
    /** Downloads a pasted .gguf link into the model folder, with the runtime first if missing. */
    startLink(raw, sha256 = '') {
        const target = linkTarget(raw);
        const digest = sha256.trim().toLowerCase();
        if (digest && !sha.test(digest))
            throw Error('INVALID_SHA256');
        if ((0, node_fs_1.existsSync)((0, node_path_1.resolve)(this.root, target.file)))
            throw Error('MODEL_FILE_EXISTS');
        if (this.active)
            throw Error('DOWNLOAD_BUSY');
        const id = 'link:' + target.name;
        const runtime = this.catalog.runtimes[0];
        this.launch(id, target.name, async (signal, report) => {
            if (!this.runtimeReady(runtime))
                await this.installRuntime(runtime, signal, report);
            await this.fetchVerified({ url: target.url, ...(digest ? { sha256: digest } : {}) }, (0, node_path_1.resolve)(this.root, target.file), signal, (bytes, total, state) => report({ step: target.name, bytes, total, state }), this.linkGet);
        });
        return { started: true, id, file: target.file };
    }
    /** Forget a failed or canceled link download (its partial file stays for a resume). */
    dismiss(id) {
        if (id.startsWith('link:') && this.active?.id !== id)
            this.progress.delete(id);
        return { dismissed: true };
    }
    /** Starts a download in the background; a model also gets its runtime first if missing. */
    start(id) {
        const model = this.catalog.models.find((m) => m.id === id);
        const runtime = this.catalog.runtimes.find((r) => r.id === (model?.runtime ?? id));
        if (!runtime)
            throw Error('UNKNOWN_MODEL');
        if (this.active)
            throw Error('DOWNLOAD_BUSY');
        if (model ? this.modelReady(model) && this.runtimeReady(runtime) : this.runtimeReady(runtime))
            return { started: false };
        this.launch(id, undefined, async (signal, report) => {
            if (!this.runtimeReady(runtime))
                await this.installRuntime(runtime, signal, report);
            if (model && !this.modelReady(model))
                await this.fetchVerified(model, (0, node_path_1.resolve)(this.root, model.file), signal, (bytes, total, state) => report({ step: model.label, bytes, total, state }));
        });
        return { started: true };
    }
    /**
     * Runs one download in the background as the active one. A finished download leaves the progress
     * list; a failed or canceled one stays there with its last step (or `failedStep`) and byte count.
     */
    launch(id, failedStep, work) {
        const controller = new AbortController();
        this.active = { id, controller };
        const report = (p) => this.progress.set(id, { state: 'DOWNLOADING', ...p });
        void (async () => {
            try {
                await work(controller.signal, report);
                this.progress.delete(id);
            }
            catch (error) {
                const canceled = controller.signal.aborted;
                this.progress.set(id, {
                    state: canceled ? 'CANCELED' : 'FAILED',
                    step: failedStep ?? this.progress.get(id)?.step ?? '',
                    bytes: this.progress.get(id)?.bytes ?? 0,
                    total: this.progress.get(id)?.total ?? null,
                    ...(canceled ? {} : { error: error instanceof Error ? error.message : 'DOWNLOAD_FAILED' }),
                });
            }
            finally {
                this.active = null;
            }
        })();
    }
    cancel(id) {
        if (this.active?.id === id)
            this.active.controller.abort();
        return { canceled: this.active?.id === id };
    }
    /** Resolves once nothing is downloading (tests and shutdown). */
    async idle() {
        while (this.active)
            await new Promise((done) => setTimeout(done, 20));
    }
    async installRuntime(runtime, signal, report) {
        const downloads = (0, node_path_1.resolve)(this.root, 'local-lab/runtime/.downloads');
        const staging = (0, node_path_1.resolve)(this.root, runtime.dir + '.partial');
        const archives = [];
        for (const [i, archive] of runtime.archives.entries()) {
            const name = new URL(archive.url).pathname.split('/').at(-1);
            const target = (0, node_path_1.join)(downloads, name);
            await this.fetchVerified(archive, target, signal, (bytes, total, state) => report({ step: `${runtime.label} (${i + 1}/${runtime.archives.length})`, bytes, total, state }));
            archives.push(target);
        }
        report({ step: runtime.label, bytes: 0, total: null, state: 'EXTRACTING' });
        (0, node_fs_1.rmSync)(staging, { recursive: true, force: true });
        (0, node_fs_1.mkdirSync)(staging, { recursive: true });
        for (const archive of archives)
            await this.extract(archive, staging);
        if (!(0, node_fs_1.existsSync)((0, node_path_1.join)(staging, runtime.executable))) {
            (0, node_fs_1.rmSync)(staging, { recursive: true, force: true });
            throw Error('RUNTIME_INCOMPLETE');
        }
        const dir = (0, node_path_1.resolve)(this.root, runtime.dir);
        (0, node_fs_1.rmSync)(dir, { recursive: true, force: true });
        (0, node_fs_1.renameSync)(staging, dir);
    }
    /**
     * Downloads to `<target>.part` with resume, then checks size and SHA-256 before renaming.
     * `<target>.part.json` records the URL and validators the part came from: a part is continued
     * only from the same URL, with If-Range when a validator is known, so a different or changed
     * file starts over instead of being spliced onto old bytes. A part without a record is continued
     * only when a pinned SHA-256 will catch a splice.
     */
    async fetchVerified(file, target, signal, progress, get = this.catalogGet) {
        if ((0, node_fs_1.existsSync)(target) && (file.bytes === undefined || (0, node_fs_1.statSync)(target).size === file.bytes)) {
            if (!file.sha256)
                return;
            progress(0, null, 'VERIFYING');
            if ((await fileHash(target)) === file.sha256)
                return;
            (0, node_fs_1.rmSync)(target, { force: true });
        }
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(target), { recursive: true });
        const part = target + '.part';
        const record = part + '.json';
        const discard = () => {
            (0, node_fs_1.rmSync)(part, { force: true });
            (0, node_fs_1.rmSync)(record, { force: true });
        };
        let source = null;
        try {
            source = JSON.parse((0, node_fs_1.readFileSync)(record, 'utf8'));
        }
        catch {
            source = null;
        }
        const resumable = (0, node_fs_1.existsSync)(part) && (source ? source.url === file.url : !!file.sha256);
        if (!resumable)
            discard();
        const limit = file.bytes ?? maxUnpinnedBytes;
        let response;
        let offset = resumable ? (0, node_fs_1.statSync)(part).size : 0;
        for (;;) {
            const validator = source?.etag && !source.etag.startsWith('W/') ? source.etag : source?.lastModified;
            response = await get(file.url, {
                'User-Agent': 'AIOrchestra',
                ...(offset ? { Range: `bytes=${offset}-`, ...(validator ? { 'If-Range': validator } : {}) } : {}),
            }, signal);
            // The part is longer than the file now served: it cannot be continued, so start over once.
            if (response.status !== 416 || !offset)
                break;
            await response.body?.cancel();
            discard();
            source = null;
            offset = 0;
        }
        if (!response.ok || !response.body)
            throw Error('DOWNLOAD_HTTP_' + response.status);
        // A server that ignores Range (or whose If-Range failed) sends the whole file; start over.
        const append = offset > 0 && response.status === 206;
        const length = Number(response.headers.get('content-length')) || 0;
        if ((append ? offset : 0) + length > limit) {
            await response.body.cancel();
            discard();
            throw Error('DOWNLOAD_TOO_LARGE');
        }
        const total = file.bytes ?? (length ? (append ? offset : 0) + length : null);
        const etag = response.headers.get('etag'), lastModified = response.headers.get('last-modified');
        (0, node_fs_1.writeFileSync)(record, JSON.stringify({
            url: file.url,
            ...(etag ? { etag } : {}),
            ...(lastModified ? { lastModified } : {}),
        }));
        let bytes = append ? offset : 0;
        let tooLarge = false;
        const out = (0, node_fs_1.createWriteStream)(part, { flags: append ? 'a' : 'w' });
        try {
            for await (const chunk of response.body) {
                // A missing or false length must not fill the disk.
                if (bytes + chunk.byteLength > limit) {
                    tooLarge = true;
                    break;
                }
                if (!out.write(chunk))
                    await new Promise((done) => out.once('drain', () => done()));
                bytes += chunk.byteLength;
                progress(bytes, total);
            }
        }
        finally {
            await new Promise((done) => out.end(() => done()));
        }
        if (tooLarge) {
            discard();
            throw Error('DOWNLOAD_TOO_LARGE');
        }
        if (file.bytes !== undefined && (0, node_fs_1.statSync)(part).size !== file.bytes)
            throw Error('DOWNLOAD_SIZE_MISMATCH');
        // Without a known size the server's own length is the only completeness check.
        if (file.bytes === undefined && total !== null && (0, node_fs_1.statSync)(part).size !== total)
            throw Error('DOWNLOAD_SIZE_MISMATCH');
        progress(bytes, total, 'VERIFYING');
        if (file.sha256 && (await fileHash(part)) !== file.sha256) {
            discard();
            throw Error('DOWNLOAD_CHECKSUM_MISMATCH');
        }
        (0, node_fs_1.renameSync)(part, target);
        (0, node_fs_1.rmSync)(record, { force: true });
    }
}
exports.ModelDownloads = ModelDownloads;
//# sourceMappingURL=model-downloads.js.map