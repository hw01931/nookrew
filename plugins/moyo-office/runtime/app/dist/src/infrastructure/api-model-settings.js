"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiModelSettings = exports.effortLevels = exports.apiProviders = void 0;
exports.validModel = validModel;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const api_budget_js_1 = require("../domain/api-budget.js");
const json_file_js_1 = require("./json-file.js");
const model_routing_js_1 = require("../domain/model-routing.js");
const api_usage_report_js_1 = require("../domain/api-usage-report.js");
const run_usage_js_1 = require("../domain/run-usage.js");
/**
 * The owner's choices about paid API models (ADR 0051): which provider models employees may use,
 * their per-model options and prices, and the spending caps. No secrets live here (keys are in the
 * credential store). Shared by every project of this app.
 */
exports.apiProviders = ['openai', 'anthropic', 'google', 'xai'];
/** Same levels routing rules use (ADR 0063); one owner of the list. */
exports.effortLevels = model_routing_js_1.routeEfforts;
const defaults = () => ({
    schemaVersion: 1,
    models: [],
    // A new install starts with a small monthly cap and per-call cap; the owner raises them on purpose.
    limits: { monthlyUsd: 10, providerMonthlyUsd: {}, perCallUsd: 1 },
});
function validModel(m) {
    const v = m;
    const o = v?.options;
    return (!!v &&
        typeof v.id === 'string' &&
        v.id === `${v.provider}:${v.model}` &&
        exports.apiProviders.includes(v.provider) &&
        typeof v.model === 'string' &&
        /^[\w.:/-]{1,120}$/.test(v.model) &&
        typeof v.label === 'string' &&
        v.label.length > 0 &&
        v.label.length <= 120 &&
        typeof v.enabled === 'boolean' &&
        (v.price === undefined || (0, api_budget_js_1.validPrice)(v.price)) &&
        !!o &&
        (o.effort === undefined || exports.effortLevels.includes(o.effort)) &&
        (o.webSearch === undefined || typeof o.webSearch === 'boolean') &&
        Number.isInteger(o.maxOutputTokens) &&
        o.maxOutputTokens >= 256 &&
        o.maxOutputTokens <= 200000 &&
        Number.isInteger(o.contextTokens) &&
        o.contextTokens >= 4096 &&
        o.contextTokens <= 2000000);
}
class ApiModelSettings {
    file;
    ledger;
    constructor(directory) {
        this.file = (0, node_path_1.resolve)(directory, 'api-models.json');
        this.ledger = (0, node_path_1.resolve)(directory, 'api-usage.jsonl');
    }
    read() {
        if (!(0, node_fs_1.existsSync)(this.file))
            return defaults();
        const data = JSON.parse((0, node_fs_1.readFileSync)(this.file, 'utf8'));
        if (data.schemaVersion !== 1 || !Array.isArray(data.models) || !(0, api_budget_js_1.validLimits)(data.limits))
            throw Error('INVALID_API_SETTINGS');
        return {
            ...data,
            models: data.models.filter(validModel),
            // A hand-edited list that no longer validates is shown as empty rather than failing the page.
            subscriptions: (() => {
                try {
                    return (0, api_usage_report_js_1.validSubscriptions)(data.subscriptions ?? []);
                }
                catch {
                    return [];
                }
            })(),
            // Same leniency: a hand-edited entry of the wrong shape is dropped, not fatal.
            usageReferences: Object.fromEntries(Object.entries(data.usageReferences && typeof data.usageReferences === 'object' ? data.usageReferences : {}).filter(([k, v]) => run_usage_js_1.referenceKeyPattern.test(k) && (v === null || typeof v === 'string'))),
        };
    }
    write(data) {
        (0, json_file_js_1.writeJsonFile)(this.file, data);
    }
    /** Add or replace one model's settings. */
    putModel(model) {
        if (!validModel(model))
            throw Error('INVALID_API_MODEL');
        const data = this.read();
        const clean = {
            id: model.id,
            provider: model.provider,
            model: model.model,
            label: model.label.trim(),
            enabled: model.enabled,
            ...(model.price ? { price: model.price } : {}),
            options: {
                maxOutputTokens: model.options.maxOutputTokens,
                contextTokens: model.options.contextTokens,
                ...(model.options.effort ? { effort: model.options.effort } : {}),
                ...(model.options.webSearch !== undefined ? { webSearch: model.options.webSearch } : {}),
            },
        };
        data.models = [...data.models.filter((m) => m.id !== clean.id), clean];
        if (data.models.length > 200)
            throw Error('API_MODEL_LIMIT');
        this.write(data);
        return clean;
    }
    removeModel(id) {
        const data = this.read();
        data.models = data.models.filter((m) => m.id !== id);
        this.write(data);
        return { removed: true };
    }
    setLimits(limits) {
        if (!(0, api_budget_js_1.validLimits)(limits))
            throw Error('INVALID_API_LIMITS');
        const data = this.read();
        data.limits = {
            monthlyUsd: limits.monthlyUsd,
            perCallUsd: limits.perCallUsd,
            providerMonthlyUsd: Object.fromEntries(Object.entries(limits.providerMonthlyUsd).filter(([p]) => exports.apiProviders.includes(p))),
        };
        this.write(data);
        return data.limits;
    }
    setSubscriptions(input) {
        const subscriptions = (0, api_usage_report_js_1.validSubscriptions)(input);
        const data = this.read();
        data.subscriptions = subscriptions;
        this.write(data);
        return subscriptions;
    }
    /** Replaces the reference prices; every value must be a key of the given price table or null. */
    setUsageReferences(input, prices) {
        const references = (0, run_usage_js_1.validReferences)(input, prices);
        const data = this.read();
        data.usageReferences = references;
        this.write(data);
        return references;
    }
    usage() {
        if (!(0, node_fs_1.existsSync)(this.ledger))
            return [];
        return (0, node_fs_1.readFileSync)(this.ledger, 'utf8')
            .split('\n')
            .filter(Boolean)
            .flatMap((line) => {
            try {
                return [JSON.parse(line)];
            }
            catch {
                return [];
            }
        });
    }
    record(row) {
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(this.ledger), { recursive: true });
        (0, node_fs_1.appendFileSync)(this.ledger, JSON.stringify(row) + '\n');
    }
}
exports.ApiModelSettings = ApiModelSettings;
//# sourceMappingURL=api-model-settings.js.map