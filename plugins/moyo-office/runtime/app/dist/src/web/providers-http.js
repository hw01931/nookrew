"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultPrices = defaultPrices;
exports.priceFor = priceFor;
exports.providersView = providersView;
exports.usageView = usageView;
exports.providersCommand = providersCommand;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const api_model_js_1 = require("../adapters/api-model.js");
const api_budget_js_1 = require("../domain/api-budget.js");
const api_usage_report_js_1 = require("../domain/api-usage-report.js");
const api_model_settings_js_1 = require("../infrastructure/api-model-settings.js");
const run_usage_js_1 = require("../domain/run-usage.js");
function defaultPrices(root) {
    try {
        return JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(root, 'config/api-prices.json'), 'utf8'));
    }
    catch {
        return { asOf: '', sources: {}, models: {} };
    }
}
/** Default price for a provider model id or its dated snapshot (lookup owned by domain/run-usage). */
function priceFor(prices, id) {
    const key = (0, run_usage_js_1.priceKeyFor)(prices, id);
    return key ? prices.models[key] : undefined;
}
const provider = (v) => {
    if (!api_model_settings_js_1.apiProviders.includes(v))
        throw Error('UNKNOWN_PROVIDER');
    return v;
};
function providersView(api, root) {
    const usage = api.settings.usage();
    const now = new Date();
    // One row per call this month (a settled reservation is replaced by its settling row).
    const month = (0, api_budget_js_1.callRows)(usage).filter((r) => (0, api_budget_js_1.inMonth)(r.at, now));
    return {
        keys: api.credentials.status(),
        settings: api.settings.read(),
        spend: {
            month: (0, api_budget_js_1.monthSpend)(usage, now),
            byProvider: Object.fromEntries(api_model_settings_js_1.apiProviders.map((p) => [p, (0, api_budget_js_1.monthSpend)(usage, now, p)])),
            calls: month.length,
            // Share of input tokens the providers served from their prompt cache this month.
            input: month.reduce((n, r) => n + r.input, 0),
            cached: month.reduce((n, r) => n + (r.cached ?? 0), 0),
        },
        prices: defaultPrices(root),
    };
}
/**
 * Cost and trend dashboard (ADR 0063): one month of the ledger grouped by provider, model, work kind
 * and day, the monthly trend, the current alerts and the subscription comparison. Read-only.
 */
function usageView(api, month, now = new Date()) {
    const rows = api.settings.usage(), settings = api.settings.read();
    return {
        report: (0, api_usage_report_js_1.usageReport)(rows, month || (0, api_usage_report_js_1.monthKey)(now), now),
        alerts: (0, api_usage_report_js_1.costAlerts)(rows, settings.limits, now),
        limits: settings.limits,
        subscriptions: settings.subscriptions ?? [],
        comparison: (0, api_usage_report_js_1.subscriptionComparison)(settings.subscriptions ?? [], rows, now),
    };
}
async function providersCommand(api, root, input) {
    switch (input.action) {
        case 'key-set':
            return api.credentials.set(provider(input.provider), String(input.key ?? ''));
        case 'key-remove':
            return api.credentials.remove(provider(input.provider));
        case 'list-models': {
            const p = provider(input.provider);
            const key = await api.credentials.get(p);
            const prices = defaultPrices(root);
            return (await (0, api_model_js_1.listProviderModels)(p, key, api.request)).map((m) => ({
                ...m,
                id: `${p}:${m.model}`,
                price: priceFor(prices, `${p}:${m.model}`) ?? null,
            }));
        }
        case 'model-put':
            return api.settings.putModel(input.model);
        case 'model-remove':
            return api.settings.removeModel(String(input.id ?? ''));
        case 'limits-set':
            return api.settings.setLimits(input.limits);
        case 'subscriptions-set':
            return api.settings.setSubscriptions(input.subscriptions);
        case 'usage-references-set':
            return api.settings.setUsageReferences(input.references, defaultPrices(root));
        default:
            throw Error('UNKNOWN_ACTION');
    }
}
//# sourceMappingURL=providers-http.js.map