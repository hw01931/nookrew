"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueCodexMessage = void 0;
const node_child_process_1 = require("node:child_process");
const codex_app_client_js_1 = require("./codex-app-client.js");
/** Official queue enters the existing Codex owner's inbox; never resumes or overrides its model. */
const queueCodexMessage = async (root, threadId, text) => {
    if (!/^[a-f0-9-]{36}$/.test(threadId) || !text.trim() || text.length > 16000 || text.includes('\0'))
        return { state: 'REJECTED', error: 'INVALID_MESSAGE' };
    let binary;
    try {
        binary = await (0, codex_app_client_js_1.codexExecutable)();
    }
    catch {
        return { state: 'REJECTED', error: 'CODEX_CLI_NOT_FOUND' };
    }
    return new Promise((resolve) => (0, node_child_process_1.execFile)(binary, ['queue', '--thread', threadId, '--message=' + text, '-C', root], { cwd: root, windowsHide: true, timeout: 20000, maxBuffer: 16384, encoding: 'utf8' }, (error, output) => {
        // stderr can include native config or message data; never copy it into product logs.
        if (error) {
            resolve({
                state: error.code === 'ENOENT' ? 'REJECTED' : 'UNKNOWN',
                error: 'CODEX_QUEUE_UNCONFIRMED',
            });
            return;
        }
        const match = /Queued message ([a-f0-9-]{36}) for thread ([a-f0-9-]{36})\./.exec(output);
        resolve(match && match[2] === threadId
            ? { state: 'QUEUED', messageId: match[1] }
            : { state: 'UNKNOWN', error: 'CODEX_QUEUE_UNCONFIRMED' });
    }));
};
exports.queueCodexMessage = queueCodexMessage;
//# sourceMappingURL=codex-queue.js.map