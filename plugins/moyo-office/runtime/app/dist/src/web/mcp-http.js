"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mcpEndpoint = mcpEndpoint;
exports.handleMcp = handleMcp;
const engine_mcp_js_1 = require("../application/engine-mcp.js");
const mcp_protocol_js_1 = require("../domain/mcp-protocol.js");
const http_js_1 = require("./http.js");
/** MCP requests are small JSON-RPC messages; a tool's own input limits apply after this. */
const maxMcpBody = 1_000_000;
/** The endpoint's URL on the loopback address the server actually bound, or undefined. */
function mcpEndpoint(server) {
    const address = server.address();
    if (!address || typeof address === 'string')
        return undefined;
    const host = address.family === 'IPv6' || address.address.includes(':') ? `[${address.address}]` : address.address;
    return `http://${host}:${address.port}/mcp`;
}
/**
 * Streamable HTTP transport of the engine MCP endpoint (ADR 0071), JSON responses only (no SSE
 * stream, no session id: the bearer token is the session). The caller has already refused any Host
 * that is not a literal loopback address of this port. Browsers are refused (an Origin header), so a
 * web page cannot reach it even with a token. The token is read from the header and never logged.
 */
async function handleMcp(req, res, office) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.headers.origin !== undefined) {
        (0, http_js_1.json)(res, 403, { error: 'ORIGIN_DENIED' });
        return;
    }
    if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST' });
        res.end();
        return;
    }
    const header = String(req.headers.authorization ?? '');
    const token = /^Bearer [A-Za-z0-9_-]{20,200}$/.test(header) ? header.slice(7) : '';
    let grant;
    try {
        grant = office.engineTools.authorize(token, office.store.project);
    }
    catch (error) {
        const code = error instanceof Error ? error.message : 'MCP_TOKEN_INVALID';
        res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
        (0, http_js_1.json)(res, 401, (0, mcp_protocol_js_1.rpcError)(null, mcp_protocol_js_1.jsonRpcCodes.invalidRequest, 'Unauthorized', { error: code }));
        return;
    }
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        (0, http_js_1.json)(res, 415, (0, mcp_protocol_js_1.rpcError)(null, mcp_protocol_js_1.jsonRpcCodes.invalidRequest, 'Content-Type must be application/json'));
        return;
    }
    req.setEncoding('utf8');
    let text = '';
    for await (const chunk of req) {
        text += String(chunk);
        if (Buffer.byteLength(text) > maxMcpBody) {
            (0, http_js_1.json)(res, 413, (0, mcp_protocol_js_1.rpcError)(null, mcp_protocol_js_1.jsonRpcCodes.invalidRequest, 'Request too large'));
            return;
        }
    }
    let message;
    try {
        message = JSON.parse(text);
    }
    catch {
        (0, http_js_1.json)(res, 400, (0, mcp_protocol_js_1.rpcError)(null, mcp_protocol_js_1.jsonRpcCodes.parseError, 'Parse error'));
        return;
    }
    const reply = await (0, engine_mcp_js_1.answerMcp)(grant, message, office.engineToolHost);
    if (!reply) {
        // A notification: accepted, nothing to answer.
        res.writeHead(202);
        res.end();
        return;
    }
    (0, http_js_1.json)(res, 200, reply);
}
//# sourceMappingURL=mcp-http.js.map