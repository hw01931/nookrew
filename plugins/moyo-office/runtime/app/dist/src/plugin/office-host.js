"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OfficePluginHost = void 0;
const node_child_process_1 = require("node:child_process");
const local_path_js_1 = require("../infrastructure/local-path.js");
const runner_js_1 = require("../application/runner.js");
const command_js_1 = require("../domain/command.js");
class OfficePluginHost {
    launcher;
    offices = new Map();
    opening = new Map();
    commands = new Map();
    constructor(launcher) {
        this.launcher = launcher;
    }
    async valid(root, url) {
        try {
            const u = new URL(url);
            if (!['127.0.0.1', '[::1]'].includes(u.hostname) || u.protocol !== 'http:')
                return false;
            const r = await fetch(u.origin + '/api/office', { signal: AbortSignal.timeout(1500) });
            const data = (await r.json());
            return r.ok && data.officeCompanion === true && data.projectRoot === root;
        }
        catch {
            return false;
        }
    }
    mutate(project, action, key, operation) {
        const root = (0, local_path_js_1.localDirectory)(project), command = (0, runner_js_1.localCommand)(root, key, 0);
        (0, command_js_1.assertCommand)(command, { actor: 'local-user', project: root, version: 0 });
        const previous = this.commands.get(key);
        if (previous) {
            if (previous.project !== root || previous.action !== action)
                throw Error('IDEMPOTENCY_CONFLICT');
            return previous.result;
        }
        const result = operation(root).then((value) => ({
            ...value,
            actor: command.actor,
            version: 0,
            correlationId: command.correlation_id,
        }));
        this.commands.set(key, { project: root, action, result });
        return result;
    }
    open(project, key) {
        return this.mutate(project, 'open', key, (root) => this.launch(root));
    }
    async launch(project) {
        const root = (0, local_path_js_1.localDirectory)(project);
        const current = this.opening.get(root);
        if (current)
            return current;
        const operation = (async () => {
            const url = this.offices.get(root);
            if (url && (await this.valid(root, url)))
                return { project: root, url, reused: true };
            const result = await new Promise((done, reject) => {
                const child = (0, node_child_process_1.spawn)(this.launcher, ['--project', root, '--no-open'], {
                    windowsHide: true,
                    detached: true,
                    stdio: ['ignore', 'pipe', 'ignore'],
                });
                let output = '', finished = false;
                const timer = setTimeout(() => {
                    if (!finished) {
                        finished = true;
                        child.kill();
                        reject(Error('OFFICE_START_TIMEOUT'));
                    }
                }, 30000);
                child.stdout.setEncoding('utf8');
                child.stdout.on('data', (chunk) => {
                    if (finished)
                        return;
                    output += chunk;
                    if (output.length > 65536) {
                        finished = true;
                        clearTimeout(timer);
                        child.kill();
                        reject(Error('OFFICE_REPORT_LIMIT'));
                        return;
                    }
                    const newline = output.indexOf('\n');
                    if (newline < 0)
                        return;
                    let report;
                    try {
                        report = JSON.parse(output.slice(0, newline));
                    }
                    catch {
                        return;
                    }
                    if (report.project !== root || typeof report.url !== 'string') {
                        finished = true;
                        clearTimeout(timer);
                        child.kill();
                        reject(Error('OFFICE_REPORT_INVALID'));
                        return;
                    }
                    finished = true;
                    clearTimeout(timer);
                    child.stdout.destroy();
                    child.unref();
                    done(report);
                });
                child.once('error', () => {
                    if (!finished) {
                        finished = true;
                        clearTimeout(timer);
                        reject(Error('OFFICE_LAUNCH_FAILED'));
                    }
                });
                child.once('exit', () => {
                    if (!finished) {
                        finished = true;
                        clearTimeout(timer);
                        reject(Error('OFFICE_LAUNCH_FAILED'));
                    }
                });
            });
            if (!(await this.valid(root, result.url)))
                throw Error('OFFICE_PROJECT_MISMATCH');
            this.offices.set(root, result.url);
            return result;
        })();
        this.opening.set(root, operation);
        try {
            return await operation;
        }
        finally {
            this.opening.delete(root);
        }
    }
    async status(project) {
        const root = (0, local_path_js_1.localDirectory)(project), url = this.offices.get(root);
        return { project: root, running: !!url && (await this.valid(root, url)), url: url || null };
    }
    close(project, key) {
        return this.mutate(project, 'close', key, (root) => this.stop(root, key));
    }
    async stop(project, key) {
        const root = (0, local_path_js_1.localDirectory)(project), url = this.offices.get(root);
        if (!url || !(await this.valid(root, url)))
            return { project: root, stopped: false };
        const base = new URL(url).origin;
        const state = (await (await fetch(base + '/api/state', { signal: AbortSignal.timeout(3000) })).json());
        const reply = await fetch(base + '/api/office/companion-stop', {
            method: 'POST',
            headers: { Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': state.token },
            body: JSON.stringify({ key, version: 0 }),
            signal: AbortSignal.timeout(3000),
        });
        if (!reply.ok)
            throw Error('OFFICE_STOP_FAILED');
        this.offices.delete(root);
        return { project: root, stopped: true };
    }
}
exports.OfficePluginHost = OfficePluginHost;
//# sourceMappingURL=office-host.js.map