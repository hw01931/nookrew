"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.json = json;
exports.body = body;
const settings_js_1 = require("./settings.js");
function json(res, code, value) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
}
async function body(req, limit = settings_js_1.webPolicy.maxBodyBytes) {
    req.setEncoding('utf8');
    let text = '';
    for await (const chunk of req) {
        text += String(chunk);
        if (Buffer.byteLength(text) > limit)
            throw new Error('BODY_TOO_LARGE');
    }
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        throw new Error('INVALID_JSON');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('INVALID_JSON');
    return value;
}
//# sourceMappingURL=http.js.map