"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.engineLimits = void 0;
exports.validateEngines = validateEngines;
exports.registrationConfig = registrationConfig;
exports.syncEngines = syncEngines;
exports.spawnProgram = spawnProgram;
exports.runArgs = runArgs;
exports.runWorkspaceEngine = runWorkspaceEngine;
exports.findOnPath = findOnPath;
exports.probeVersion = probeVersion;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const engine_registry_js_1 = require("../domain/engine-registry.js");
const engine_usage_js_1 = require("../domain/engine-usage.js");
const baseEnv = [
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'SystemDrive',
    'ComSpec',
    'USERPROFILE',
    'HOME',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'TEMP',
    'TMP',
];
const skippedDirectories = new Set(['node_modules', '.git']);
exports.engineLimits = Object.freeze({ output: 24000, fileBytes: 200000, files: 2000 });
function validateEngines(engines) {
    if (engines === undefined)
        return [];
    if (!Array.isArray(engines) || engines.length > 8)
        throw Error('INVALID_COLLAB_CONFIG');
    const ids = new Set();
    for (const e of engines) {
        if (!e ||
            typeof e.id !== 'string' ||
            !/^[a-z0-9-]{2,40}$/.test(e.id) ||
            ids.has(e.id) ||
            typeof e.label !== 'string' ||
            !e.label.trim() ||
            typeof e.executable !== 'string' ||
            !e.executable.trim() ||
            !Array.isArray(e.args) ||
            e.args.some((a) => typeof a !== 'string') ||
            (e.promptVia !== undefined && !['argument', 'stdin'].includes(e.promptVia)) ||
            (e.promptVia === 'stdin' ? e.args.includes('{prompt}') : !e.args.includes('{prompt}')) ||
            !Number.isInteger(e.timeoutMs) ||
            e.timeoutMs < 10000 ||
            e.timeoutMs > 3600000 ||
            typeof e.enabled !== 'boolean' ||
            (e.env !== undefined && (!Array.isArray(e.env) || e.env.some((v) => !/^[A-Z_][A-Z0-9_]*$/.test(v)))))
            throw Error('INVALID_COLLAB_CONFIG');
        ids.add(e.id);
    }
    return engines;
}
/** The run configuration of an owner registration (ADR 0065): fixed arguments, prompt on stdin. */
function registrationConfig(r) {
    return {
        id: r.id,
        label: r.label,
        executable: r.executable,
        args: (0, engine_registry_js_1.registrationArgs)(r),
        timeoutMs: r.timeoutMs,
        enabled: r.enabled,
        env: engine_registry_js_1.engineTemplates[r.template].env,
        promptVia: 'stdin',
        template: r.template,
        ...(r.model ? { model: r.model } : {}),
    };
}
/**
 * Puts the owner's registered engines into the shared config in place, next to engines from
 * config/collaboration.json (which have no template). A removed registration disappears.
 */
function syncEngines(config, registrations) {
    let registered;
    try {
        registered = registrations().map(registrationConfig);
    }
    catch {
        // An unreadable registry file leaves the current list as it is; the engine screen shows the error.
        return;
    }
    const fromFile = (config.engines ?? []).filter((e) => !e.template && !registered.some((r) => r.id === e.id));
    config.engines = validateEngines([...fromFile, ...registered].slice(0, 8));
}
function walk(root, base = root, out = []) {
    for (const entry of (0, node_fs_1.readdirSync)(base, { withFileTypes: true })) {
        if (entry.isSymbolicLink())
            continue;
        const full = (0, node_path_1.join)(base, entry.name);
        if (entry.isDirectory()) {
            if (!skippedDirectories.has(entry.name))
                walk(root, full, out);
        }
        else if (entry.isFile())
            out.push((0, node_path_1.relative)(root, full).split(node_path_1.sep).join('/'));
        if (out.length > exports.engineLimits.files)
            throw Error('ENGINE_WORKSPACE_TOO_LARGE');
    }
    return out;
}
const isShim = (path) => process.platform === 'win32' && /\.(cmd|bat)$/i.test(path);
/**
 * Starts a program without a shell. Windows .cmd/.bat shims (how npm installs CLIs) cannot run without
 * cmd.exe, so they go through `cmd.exe /d /s /c` — only when every argument is a plain token and the
 * paths hold no cmd.exe metacharacters, which the registry guarantees (the prompt is on stdin).
 */
function spawnProgram(executable, args, options) {
    if (!isShim(executable))
        return (0, node_child_process_1.spawn)(executable, args, { ...options, windowsHide: true, shell: false, stdio: 'pipe' });
    if (!(0, engine_registry_js_1.validExecutablePath)(executable, 'win32') || args.some((a) => !engine_registry_js_1.safeArgument.test(a) && !plainPath(a)))
        throw Error('ENGINE_ARGUMENT_UNSAFE');
    const line = [executable, ...args].map((a) => `"${a}"`).join(' ');
    return (0, node_child_process_1.spawn)(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
        ...options,
        windowsHide: true,
        shell: false,
        windowsVerbatimArguments: true,
        stdio: 'pipe',
    });
}
/** A substituted working-copy path: absolute, with no character cmd.exe would interpret. */
const plainPath = (a) => /^[A-Za-z]:\\[^"%!^&|<>`\r\n\t\0]*$/.test(a);
/** Stops the program and everything it started (a shim's cmd.exe has the real tool as a child). */
function killTree(child) {
    if (child.pid === undefined || child.exitCode !== null)
        return;
    if (process.platform === 'win32')
        (0, node_child_process_1.spawn)('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
    else
        child.kill('SIGKILL');
}
/**
 * The arguments of one run. A registered Claude Code or Codex engine takes the run's model and effort
 * from the flag table's enums (falling back to its registered model); any other engine takes none.
 */
function runArgs(engine, options = {}, mcp) {
    if (engine.template && engine.template !== 'generic') {
        const model = options.model ?? engine.model;
        return (0, engine_registry_js_1.engineRunArgs)(engine.template, {
            // Machine-readable output carries the run's token usage (ADR 0070).
            output: options.output ?? 'json',
            ...(model ? { model } : {}),
            ...(options.effort ? { effort: options.effort } : {}),
        }, [], mcp);
    }
    if (options.model || options.effort || options.output === 'json')
        throw Error('ENGINE_OPTION_UNSUPPORTED');
    // An engine from config or a generic command has no known MCP client configuration (ADR 0071).
    if (mcp)
        throw Error('ENGINE_MCP_UNSUPPORTED');
    return engine.args;
}
/** Raw standard output kept for usage parsing only (never stored); a longer output keeps its end. */
const usageCapture = 4_000_000;
/**
 * Copies `files` into a fresh temporary directory, runs the engine there and reports what it changed.
 * The real project directory is never touched. The engine process is not sandboxed (ADR 0041).
 */
async function runWorkspaceEngine(engine, files, prompt, signal, options = {}, mcp) {
    signal.throwIfAborted();
    // The client config goes in its own temp folder next to the copy, never into the copy (it would
    // look like a changed file) and never into the owner's global settings. It holds no secret.
    const configDir = mcp && engine.template === 'claude-code' ? (0, node_fs_1.mkdtempSync)((0, node_path_1.resolve)((0, node_os_1.tmpdir)(), 'aiorchestra-mcp-')) : undefined;
    const configPath = configDir ? (0, node_path_1.resolve)(configDir, 'mcp.json') : undefined;
    let template;
    try {
        template = runArgs(engine, options, mcp ? { url: mcp.url, ...(configPath ? { configPath } : {}) } : undefined);
        if (configPath)
            (0, node_fs_1.writeFileSync)(configPath, JSON.stringify((0, engine_registry_js_1.claudeMcpConfig)(mcp.url)));
    }
    catch (error) {
        if (configDir)
            (0, node_fs_1.rmSync)(configDir, { recursive: true, force: true });
        throw error;
    }
    const model = options.model ?? (engine.template ? engine.model : undefined);
    const workspace = (0, node_fs_1.mkdtempSync)((0, node_path_1.resolve)((0, node_os_1.tmpdir)(), 'aiorchestra-engine-'));
    const startedAt = new Date();
    try {
        for (const [path, content] of Object.entries(files)) {
            const target = (0, node_path_1.resolve)(workspace, path);
            if (!target.startsWith(workspace + node_path_1.sep))
                throw Error('PATH_DENIED');
            (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(target), { recursive: true });
            (0, node_fs_1.writeFileSync)(target, content);
        }
        // Only the allowlist: never API keys, so a subscription CLI does not switch to pay-per-use billing.
        const env = {};
        for (const name of [...baseEnv, ...(engine.env ?? [])])
            if (process.env[name])
                env[name] = process.env[name];
        // The run's own token, for this process only; it is never an argument, a file or a log line.
        if (mcp)
            env[engine_registry_js_1.engineMcp.tokenEnv] = mcp.token;
        const stdin = engine.promptVia === 'stdin';
        const args = template.map((a) => a === '{prompt}' && !stdin ? prompt : a === '{workspace}' ? workspace : a);
        let stdout = '', stdoutTruncated = false;
        const run = await new Promise((done) => {
            let output = '', truncated = false, settled = false, timedOut = false, canceled = false, child;
            const finish = (exitCode) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                clearTimeout(grace);
                signal.removeEventListener('abort', cancel);
                done({
                    exitCode: timedOut || canceled ? null : exitCode,
                    timedOut,
                    canceled,
                    output: (0, engine_registry_js_1.redactEngineOutput)(output),
                    outputTruncated: truncated,
                });
            };
            let grace;
            const stop = () => {
                killTree(child);
                // The run ends when the process closes; a process that ignores the kill is given up on.
                grace = setTimeout(() => finish(null), 5000);
            };
            const cancel = () => {
                canceled = true;
                stop();
            };
            const timer = setTimeout(() => {
                timedOut = true;
                stop();
            }, engine.timeoutMs);
            try {
                child = spawnProgram(engine.executable, args, { cwd: workspace, env });
            }
            catch (error) {
                output = `[engine start refused: ${error instanceof Error ? error.message : 'FAILED'}]`;
                finish(null);
                return;
            }
            signal.addEventListener('abort', cancel, { once: true });
            const collect = (d) => {
                output += String(d);
                if (output.length > exports.engineLimits.output) {
                    truncated = true;
                    output = output.slice(-exports.engineLimits.output);
                }
            };
            child.stdout.on('data', (d) => {
                collect(d);
                stdout += String(d);
                if (stdout.length > usageCapture) {
                    stdoutTruncated = true;
                    stdout = stdout.slice(-usageCapture);
                }
            });
            child.stderr.on('data', collect);
            child.on('error', (e) => {
                output += `\n[engine start failed: ${e.message}]`;
                finish(null);
            });
            child.on('close', (code) => finish(code));
            child.stdin.on('error', () => undefined);
            child.stdin.end(stdin ? prompt : undefined);
        });
        const durationMs = Date.now() - startedAt.getTime();
        // Only numbers leave the raw output; the text itself is not stored (the redacted tail is).
        const usage = (0, engine_usage_js_1.parseEngineUsage)(engine.template, stdout, model ?? '');
        // Searches are counted from events; with the start of the output cut off they are not all seen.
        if (usage && stdoutTruncated)
            for (const m of usage.models)
                delete m.webSearches;
        const base = {
            ...run,
            ...(model ? { model } : {}),
            ...(options.effort ? { effort: options.effort } : {}),
            startedAt: startedAt.toISOString(),
            durationMs,
            usage,
        };
        if (signal.aborted || run.timedOut)
            return { ...base, changes: [] };
        const changes = [];
        const after = new Set(walk(workspace));
        for (const path of after) {
            const full = (0, node_path_1.resolve)(workspace, path);
            if ((0, node_fs_1.statSync)(full).size > exports.engineLimits.fileBytes)
                continue;
            const bytes = (0, node_fs_1.readFileSync)(full);
            const text = bytes.toString('utf8');
            if (text.includes('\0') || Buffer.from(text, 'utf8').length !== bytes.length)
                continue;
            if (files[path] !== text)
                changes.push({ path, content: text });
        }
        for (const path of Object.keys(files))
            if (!after.has(path))
                changes.push({ path, content: null });
        return { ...base, changes };
    }
    finally {
        for (const dir of [workspace, configDir])
            try {
                if (dir)
                    (0, node_fs_1.rmSync)(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
            }
            catch {
                // A killed engine can hold a file briefly on Windows; the temp copy is left for the OS to clean.
            }
    }
}
/**
 * PATH lookup only: which known CLIs exist as files, without running them. On Windows an .exe wins
 * over an npm .cmd shim of the same name.
 */
function findOnPath(name, pathValue = process.env.PATH ?? process.env.Path, platform = process.platform, exists = (p) => (0, node_fs_1.existsSync)(p) && (0, node_fs_1.statSync)(p).isFile()) {
    const extensions = platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
    for (const ext of extensions)
        for (const dir of (pathValue ?? '').split(platform === 'win32' ? ';' : node_path_1.delimiter)) {
            if (!dir.trim())
                continue;
            const candidate = (platform === 'win32' ? dir.replace(/[\\/]+$/, '') + '\\' : dir.replace(/\/+$/, '') + '/') +
                name +
                ext;
            if (exists(candidate) && (0, engine_registry_js_1.validExecutablePath)(candidate, platform))
                return candidate;
        }
    return null;
}
/**
 * Runs `<executable> --version` with a short timeout and returns the first line. Only on the owner's
 * explicit request; tests inject a stub instead (ADR 0065).
 */
function probeVersion(executable, timeoutMs = 5000) {
    return new Promise((done) => {
        let output = '', child;
        try {
            child = spawnProgram(executable, ['--version'], { cwd: (0, node_os_1.tmpdir)(), env: { ...pickEnv() } });
        }
        catch (error) {
            done(error instanceof Error ? error.message : 'ENGINE_PROBE_FAILED');
            return;
        }
        const timer = setTimeout(() => {
            killTree(child);
            done('ENGINE_PROBE_TIMEOUT');
        }, timeoutMs);
        child.stdout.on('data', (d) => (output = (output + String(d)).slice(0, 400)));
        child.on('error', () => {
            clearTimeout(timer);
            done('ENGINE_PROBE_FAILED');
        });
        child.on('close', () => {
            clearTimeout(timer);
            done((0, engine_registry_js_1.redactEngineOutput)(output.split(/\r?\n/)[0].trim().slice(0, 120)) || 'ENGINE_PROBE_EMPTY');
        });
        child.stdin.end();
    });
}
function pickEnv() {
    const env = {};
    for (const name of baseEnv)
        if (process.env[name])
            env[name] = process.env[name];
    return env;
}
//# sourceMappingURL=workspace-engine.js.map