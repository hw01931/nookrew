"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseProductConfig = parseProductConfig;
exports.loadProductConfig = loadProductConfig;
exports.projectName = projectName;
const node_path_1 = require("node:path");
const json_file_js_1 = require("../infrastructure/json-file.js");
const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
function exact(value, keys) {
    if (!record(value) || Object.keys(value).sort().join() !== keys.sort().join())
        throw new Error('INVALID_PRODUCT_CONFIG');
}
function text(value, max) {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value))
        throw new Error('INVALID_PRODUCT_CONFIG');
}
function integer(value, min, max) {
    if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
        throw new Error('INVALID_PRODUCT_CONFIG');
}
function parseProductConfig(value) {
    exact(value, ['schemaVersion', 'display', 'regional', 'client', 'server', 'retainedModelLabel']);
    if (value.schemaVersion !== 1)
        throw new Error('INVALID_PRODUCT_CONFIG');
    exact(value.display, ['name', 'projectName', 'monogram', 'taskPrefix', 'workspaceTitle', 'previewVersion']);
    for (const key of ['name', 'workspaceTitle', 'previewVersion'])
        text(value.display[key], 80);
    if (value.display.projectName !== null)
        text(value.display.projectName, 80);
    text(value.display.monogram, 4);
    text(value.display.taskPrefix, 16);
    exact(value.regional, ['locale', 'timeZone']);
    text(value.regional.locale, 80);
    text(value.regional.timeZone, 80);
    try {
        new Intl.DateTimeFormat(String(value.regional.locale), {
            timeZone: String(value.regional.timeZone),
        }).format();
    }
    catch {
        throw new Error('INVALID_PRODUCT_CONFIG');
    }
    exact(value.client, ['pollIntervalMs', 'requestTimeoutMs', 'toastDurationMs', 'staleWorkDays']);
    integer(value.client.pollIntervalMs, 1000, 60000);
    integer(value.client.requestTimeoutMs, 1000, 60000);
    integer(value.client.toastDurationMs, 1000, 60000);
    integer(value.client.staleWorkDays, 1, 90);
    exact(value.server, ['port']);
    integer(value.server.port, 1, 65535);
    text(value.retainedModelLabel, 160);
    return structuredClone(value);
}
function loadProductConfig(path = (0, node_path_1.resolve)(__dirname, '../../../config/product.json')) {
    let value;
    try {
        value = (0, json_file_js_1.readJsonFile)(path);
    }
    catch {
        throw new Error('INVALID_PRODUCT_CONFIG');
    }
    return parseProductConfig(value);
}
function projectName(config) {
    return config.display.projectName ?? config.display.name;
}
//# sourceMappingURL=product.js.map