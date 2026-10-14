"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.localCommand = localCommand;
exports.runTask = runTask;
const node_crypto_1 = require("node:crypto");
const execution_js_1 = require("../domain/execution.js");
const fixture_js_1 = require("../adapters/fixture.js");
const hash_js_1 = require("../infrastructure/hash.js");
const command_js_1 = require("./command.js");
const validation_js_1 = require("../infrastructure/validation.js");
function localCommand(project, key, expectedVersion) {
    return (0, command_js_1.createCommand)('local-user', project, key, expectedVersion);
}
async function runTask(store, input, options = {}) {
    const validation = (0, validation_js_1.validateTask)(input, fixture_js_1.fixtureRegistry);
    if (!validation.execution_ready)
        throw new Error('TASK_NOT_READY: ' + JSON.stringify(validation));
    const task = structuredClone(input);
    const scenario = options.scenario ?? 'success';
    const delayMs = options.delayMs ?? 0;
    if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 60_000)
        throw new Error('INVALID_DELAY');
    if (task.limits.max_tool_calls < task.verification.length)
        throw new Error('INSUFFICIENT_TOOL_BUDGET');
    const profile = {
        id: 'fake-fixture-v1',
        scenario,
        delay_ms: delayMs,
        node: process.version,
        base_hash: (0, hash_js_1.hash)(fixture_js_1.baseFiles),
        mode: 'constrained',
        context: 'fixed-fixture',
    };
    const start = store.start(task, profile, localCommand(task.repository.reference, options.idempotencyKey ?? (0, node_crypto_1.randomUUID)(), 0));
    const id = start.run.id;
    if (!start.created)
        return store.report(id);
    const generation = start.run.generation;
    const abort = new AbortController();
    const move = (to) => {
        const run = store.get(id);
        return store.advance(id, to, generation, run.version);
    };
    const cancel = () => {
        const run = store.get(id);
        if (!(0, execution_js_1.isTerminal)(run.state) && run.state !== 'CANCEL_REQUESTED') {
            store.requestCancel(id, localCommand(task.repository.reference, `signal-${id}`, run.version));
        }
        abort.abort();
    };
    const poll = setInterval(() => {
        try {
            if (store.get(id).state === 'CANCEL_REQUESTED')
                abort.abort();
        }
        catch {
            abort.abort();
        }
    }, 50);
    let timedOut = false;
    const deadline = Date.now() + task.limits.wall_time_seconds * 1000;
    const timer = setTimeout(() => {
        timedOut = true;
        abort.abort();
    }, Math.min(task.limits.wall_time_seconds * 1000, 2_147_483_647));
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
        options.onStarted?.(id);
        if (options.signal?.aborted)
            cancel();
        abort.signal.throwIfAborted();
        move('PREPARING');
        move('RUNNING');
        const files = await new fixture_js_1.FakeWorker(scenario, delayMs).execute(abort.signal);
        abort.signal.throwIfAborted();
        if (!move('OUTPUT_READY'))
            throw new Error('FENCED');
        if (!move('VERIFYING'))
            throw new Error('FENCED');
        const evidence = (0, fixture_js_1.verifyFixture)(task, files, scenario === 'missing-evidence');
        if (Date.now() >= deadline) {
            timedOut = true;
            throw new Error('DEADLINE');
        }
        if (!store.finalize(id, generation, store.get(id).version, files, evidence))
            throw new Error('FENCED');
    }
    catch {
        const run = store.get(id);
        if (run.state === 'CANCEL_REQUESTED') {
            // FakeWorker has settled; cancellation is now confirmed, not merely requested.
            store.advance(id, 'CANCELED', run.generation, run.version);
        }
        else if (!(0, execution_js_1.isTerminal)(run.state)) {
            store.advance(id, timedOut ? 'TIMED_OUT' : 'FAILED', run.generation, run.version);
        }
    }
    finally {
        clearInterval(poll);
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', cancel);
    }
    return store.report(id);
}
//# sourceMappingURL=runner.js.map