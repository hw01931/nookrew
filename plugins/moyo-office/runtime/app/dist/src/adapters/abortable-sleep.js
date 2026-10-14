"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sleep = void 0;
/** Waits between provider retries; an abort ends the wait with the signal's own reason. */
const sleep = (ms, signal) => new Promise((done, fail) => {
    const t = setTimeout(done, ms);
    signal.addEventListener('abort', () => {
        clearTimeout(t);
        fail(signal.reason);
    }, { once: true });
});
exports.sleep = sleep;
//# sourceMappingURL=abortable-sleep.js.map