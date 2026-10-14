"use strict";
/**
 * The small part of the Model Context Protocol the app serves to external engine runs (ADR 0071):
 * JSON-RPC 2.0 messages for `initialize`, `ping`, `tools/list`, `tools/call` and notifications,
 * written from the published specification (revision 2025-06-18) because no MCP SDK is installed.
 * No resources, prompts, sampling, batching or server-to-client requests. Pure: no I/O.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mcpToolName = exports.rpcError = exports.rpcResult = exports.jsonRpcCodes = exports.mcpProtocolVersions = void 0;
exports.parseMcpMessage = parseMcpMessage;
exports.negotiateVersion = negotiateVersion;
exports.toolResult = toolResult;
/** Revisions this server answers; a client asking for another gets the newest one (the spec's rule). */
exports.mcpProtocolVersions = ['2025-06-18', '2025-03-26'];
exports.jsonRpcCodes = Object.freeze({
    parseError: -32700,
    invalidRequest: -32600,
    methodNotFound: -32601,
    invalidParams: -32602,
    internalError: -32603,
});
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
exports.rpcResult = rpcResult;
const rpcError = (id, code, message, data) => ({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });
exports.rpcError = rpcError;
/** A single JSON-RPC request or notification, or the error response it deserves. */
function parseMcpMessage(value) {
    if (Array.isArray(value))
        // Batching was removed from the protocol in 2025-06-18.
        return { error: (0, exports.rpcError)(null, exports.jsonRpcCodes.invalidRequest, 'Batch requests are not supported') };
    const v = value;
    if (!v || typeof v !== 'object' || v.jsonrpc !== '2.0' || typeof v.method !== 'string')
        return { error: (0, exports.rpcError)(null, exports.jsonRpcCodes.invalidRequest, 'Invalid request') };
    const hasId = 'id' in v;
    if (hasId && !(typeof v.id === 'string' || (typeof v.id === 'number' && Number.isSafeInteger(v.id))))
        return { error: (0, exports.rpcError)(null, exports.jsonRpcCodes.invalidRequest, 'Invalid id') };
    if (v.params !== undefined && (!v.params || typeof v.params !== 'object' || Array.isArray(v.params)))
        return {
            error: (0, exports.rpcError)(hasId ? v.id : null, exports.jsonRpcCodes.invalidParams, 'Invalid params'),
        };
    return {
        request: {
            ...(hasId ? { id: v.id } : {}),
            method: v.method,
            params: v.params ?? {},
        },
    };
}
/** The revision both sides use: the client's when supported, otherwise the newest this server has. */
function negotiateVersion(requested) {
    return exports.mcpProtocolVersions.includes(requested)
        ? requested
        : exports.mcpProtocolVersions[0];
}
/** A `tools/call` result: the value as JSON text, and as structured content when it is an object. */
function toolResult(value, isError = false) {
    return {
        content: [{ type: 'text', text: JSON.stringify(value ?? null) }],
        ...(value && typeof value === 'object' && !Array.isArray(value)
            ? { structuredContent: value }
            : {}),
        isError,
    };
}
/**
 * MCP tool names as clients pass them to models: Claude-style tool names allow only letters, digits,
 * `_` and `-`, so `work.write` is offered as `work_write`.
 */
const mcpToolName = (name) => name.replace(/\./g, '_');
exports.mcpToolName = mcpToolName;
//# sourceMappingURL=mcp-protocol.js.map