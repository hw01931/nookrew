"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalJson = canonicalJson;
exports.sha256 = sha256;
exports.hash = hash;
const node_crypto_1 = require("node:crypto");
function canonicalJson(value) {
    if (Array.isArray(value))
        return '[' + value.map(canonicalJson).join(',') + ']';
    if (value !== null && typeof value === 'object') {
        return ('{' +
            Object.entries(value)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item))
                .join(',') +
            '}');
    }
    const result = JSON.stringify(value);
    if (result === undefined)
        throw new Error('NON_JSON_VALUE');
    return result;
}
/** SHA-256 of raw bytes or text, as hex. */
function sha256(data) {
    return (0, node_crypto_1.createHash)('sha256').update(data).digest('hex');
}
/** SHA-256 of a value's canonical JSON. */
function hash(value) {
    return sha256(canonicalJson(value));
}
//# sourceMappingURL=hash.js.map