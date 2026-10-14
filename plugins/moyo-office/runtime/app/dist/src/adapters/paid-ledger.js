"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reservePaidCall = reservePaidCall;
const node_crypto_1 = require("node:crypto");
const api_budget_js_1 = require("../domain/api-budget.js");
/**
 * The spending check and ledger of one paid call (ADR 0051), shared by paid API models and priced
 * model servers (ADR 0064). The check and the RESERVED row are written with no await between them,
 * so concurrent calls in this process see each other's reservations. A failed ledger write throws
 * here, before anything is sent.
 */
function reservePaidCall(ledger, price, call, 
/** What the call served (ADR 0063): recorded on every row of the call. */
meta = {}) {
    const worst = (0, api_budget_js_1.assertAffordable)(price, ledger.read().limits, ledger.usage(), call);
    const reservation = (0, node_crypto_1.randomUUID)();
    const kind = typeof meta.kind === 'string' && /^[a-z-]{1,20}$/.test(meta.kind) ? meta.kind : undefined;
    const effort = typeof meta.effort === 'string' && /^[a-z]{1,20}$/.test(meta.effort) ? meta.effort : undefined;
    const run = typeof meta.run === 'string' && /^[\w-]{1,100}$/.test(meta.run) ? meta.run : undefined;
    // Latency runs from the reservation (just before sending) to the settling row, retries included.
    const sentAt = Date.now();
    const row = (status, costUsd, u, error) => ({
        at: new Date().toISOString(),
        provider: call.provider,
        model: call.model,
        input: u?.input ?? 0,
        output: u?.output ?? 0,
        ...(u ? { cached: u.cached ?? 0, cacheWrite: u.cacheWrite ?? 0, searches: u.searches ?? 0 } : {}),
        costUsd,
        status,
        ...(status === 'RESERVED' ? { id: reservation } : { settles: reservation }),
        ...(error ? { error } : {}),
        ...(kind ? { kind } : {}),
        ...(effort ? { effort } : {}),
        ...(run ? { run } : {}),
        ...(status !== 'RESERVED' ? { latencyMs: Math.max(0, Date.now() - sentAt) } : {}),
    });
    ledger.record(row('RESERVED', worst));
    return {
        worst,
        /** The provider's own token counts × the configured price. */
        settle(u) {
            const usd = (0, api_budget_js_1.cost)(price, u);
            ledger.record(row('SETTLED', usd, u));
            return usd;
        },
        /**
         * Sent but unanswered (aborted, timed out, unreadable reply): the worst case stays as UNKNOWN.
         * An error status is the provider's answer that it did not run the call: FAILED at $0.
         */
        fail(inFlight, e) {
            const reason = e instanceof Error ? (e.name !== 'Error' ? e.name : e.message) : 'ERROR';
            ledger.record(inFlight
                ? row('UNKNOWN', worst, undefined, reason.slice(0, 80))
                : row('FAILED', 0, undefined, reason.slice(0, 80)));
        },
    };
}
//# sourceMappingURL=paid-ledger.js.map