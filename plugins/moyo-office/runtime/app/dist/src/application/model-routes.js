"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelRouteSettings = void 0;
const command_js_1 = require("../domain/command.js");
const collaboration_js_1 = require("../domain/collaboration.js");
const model_routing_js_1 = require("../domain/model-routing.js");
const hash_js_1 = require("../infrastructure/hash.js");
/**
 * The project's work-type routing rules (ADR 0063), stored next to its records with a version and an
 * idempotency receipt like other owner settings. The rule decides a run's target once, when the run
 * is created; the run record keeps the decision and its reason.
 */
class ModelRouteSettings {
    store;
    config;
    constructor(store, config) {
        this.store = store;
        this.config = config;
        store.db.exec('CREATE TABLE IF NOT EXISTS model_routes(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,json TEXT NOT NULL);');
    }
    /** Model profiles that can run now (config.models is kept in sync with keys and prices) and engines. */
    targets() {
        return {
            models: (this.config.models ?? [this.config.runtime]).map((m) => ({
                id: m.modelId,
                paid: m.provider === 'api',
            })),
            engines: (this.config.engines ?? []).map((e) => ({ id: e.id, enabled: e.enabled })),
        };
    }
    read() {
        const row = this.store.db.prepare('SELECT version,json FROM model_routes WHERE id=1').get();
        return row
            ? { version: Number(row.version), rules: JSON.parse(String(row.json)) }
            : { version: 0, rules: {} };
    }
    set(input, command) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.store.project });
        const rules = (0, model_routing_js_1.validRoutes)(input, this.targets());
        const key = (0, hash_js_1.hash)(['model-routes-set', this.store.project, command.idempotency_key]), fingerprint = (0, hash_js_1.hash)([rules, command.expected_version]);
        return this.store.idempotent(key, fingerprint, () => {
            const current = this.read();
            if (current.version !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            const next = { version: current.version + 1, rules };
            this.store.db
                .prepare('INSERT INTO model_routes VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,json=excluded.json')
                .run(next.version, JSON.stringify(rules));
            this.store.log(collaboration_js_1.owner, 'model-routes.set', 'model-routes', 'SUCCEEDED');
            return next;
        });
    }
    /**
     * The target of a new run of this employee in this mode. `work` is the work item the run executes;
     * `previous` is the newest earlier run of that work item, whose target a rerun keeps.
     */
    decide(employee, mode, 
    /** The employee's fallback engine (its own, or the project's develop route, ADR 0065); '' for none. */
    fallbackEngine, work, previous) {
        const engine = fallbackEngine;
        const routeRules = (0, collaboration_js_1.string)(employee.data, 'routeRules');
        const named = work?.data.kind;
        const rule = work ? (0, model_routing_js_1.workRule)(work.data) : undefined;
        const kind = (0, model_routing_js_1.isWorkKind)(named) ? named : (0, model_routing_js_1.workKindOf)(mode, (0, collaboration_js_1.strings)(employee.data, 'tools'));
        const lock = (0, model_routing_js_1.employeeLock)(employee.data);
        return (0, model_routing_js_1.routeRun)({
            kind,
            engineAllowed: (0, model_routing_js_1.engineMayRun)(kind, mode),
            employee: { model: (0, collaboration_js_1.string)(employee.data, 'model'), ...(engine ? { engine } : {}), ...(lock ? { lock } : {}) },
            rules: {
                ...(rule ? { work: rule } : {}),
                ...(routeRules ? { employee: (0, model_routing_js_1.parseEmployeeRoutes)(routeRules) } : {}),
                project: this.read().rules,
            },
            ...(previous
                ? {
                    previous: {
                        target: previous.decision.target,
                        ...(previous.decision.effort ? { effort: previous.decision.effort } : {}),
                        failed: previous.failed,
                        attempt: previous.attempt,
                    },
                }
                : {}),
            targets: this.targets(),
        });
    }
}
exports.ModelRouteSettings = ModelRouteSettings;
//# sourceMappingURL=model-routes.js.map