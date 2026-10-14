"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngineToolGrants = exports.engineToolSets = void 0;
exports.engineToolsFor = engineToolsFor;
exports.answerMcp = answerMcp;
const node_crypto_1 = require("node:crypto");
const collaboration_js_1 = require("../domain/collaboration.js");
const mcp_protocol_js_1 = require("../domain/mcp-protocol.js");
const hash_js_1 = require("../infrastructure/hash.js");
const collaboration_tools_js_1 = require("./collaboration-tools.js");
/**
 * Employee tools an engine run may call over MCP (ADR 0071), by what the run is for. A planning run
 * reads records and writes work items and plan documents; it changes no files. Each set is further
 * cut to the tools the run's employee has, and every call still passes the employee's own checks.
 */
exports.engineToolSets = {
    plan: ['work.write', 'record.search', 'record.read', 'memory.search', 'artifact.write'],
};
function engineToolsFor(purpose, employeeTools) {
    return exports.engineToolSets[purpose].filter((name) => (0, collaboration_js_1.hasTool)(employeeTools, name));
}
/**
 * Bearer tokens of engine runs (ADR 0071). Only a hash of each token is kept, in memory: a restart
 * ends every run (UNKNOWN) and with it every token. Tokens are never logged or stored.
 */
class EngineToolGrants {
    project;
    now;
    grants = new Map();
    constructor(project, now = Date.now) {
        this.project = project;
        this.now = now;
    }
    mint(input) {
        const now = this.now();
        // Ended runs' entries are kept a while for a precise refusal, then dropped.
        for (const [key, g] of this.grants)
            if (g.expiresAt + 3_600_000 < now)
                this.grants.delete(key);
        const token = (0, node_crypto_1.randomBytes)(32).toString('base64url');
        this.grants.set((0, hash_js_1.hash)(['engine-mcp', token]), {
            ...input,
            tools: [...input.tools],
            project: this.project,
            revoked: false,
            calls: new Map(),
        });
        return token;
    }
    /** The grant of a token presented to this project's endpoint, or a refusal code. */
    authorize(token, project) {
        const grant = token ? this.grants.get((0, hash_js_1.hash)(['engine-mcp', token])) : undefined;
        if (!grant)
            throw Error('MCP_TOKEN_INVALID');
        if (grant.project !== project)
            throw Error('MCP_PROJECT_MISMATCH');
        if (grant.revoked)
            throw Error('MCP_TOKEN_REVOKED');
        if (grant.expiresAt <= this.now())
            throw Error('MCP_TOKEN_EXPIRED');
        return grant;
    }
    /** Ends the access of one run (finished, failed or canceled). */
    revokeRun(jobId) {
        let count = 0;
        for (const g of this.grants.values())
            if (g.jobId === jobId && !g.revoked) {
                g.revoked = true;
                g.calls.clear();
                count++;
            }
        return count;
    }
    revokeAll() {
        for (const g of this.grants.values())
            g.revoked = true;
    }
}
exports.EngineToolGrants = EngineToolGrants;
const serverInfo = { name: 'aiorchestra', version: '1' };
/**
 * Answers one MCP message for an authorized run; null for a notification (no response body).
 * Business errors of a tool come back as a tool result with isError, like the model loop sees them;
 * a tool outside the grant or a conflicting replay is a protocol error.
 */
async function answerMcp(grant, message, host) {
    const parsed = (0, mcp_protocol_js_1.parseMcpMessage)(message);
    if ('error' in parsed)
        return parsed.error;
    const { id, method, params } = parsed.request;
    if (id === undefined)
        return null;
    switch (method) {
        case 'initialize':
            return (0, mcp_protocol_js_1.rpcResult)(id, {
                protocolVersion: (0, mcp_protocol_js_1.negotiateVersion)(params.protocolVersion),
                capabilities: { tools: { listChanged: false } },
                serverInfo,
                instructions: 'Tools of the AIOrchestra project this run belongs to. Every call acts as the assigned employee and is checked and recorded by the app.',
            });
        case 'ping':
            return (0, mcp_protocol_js_1.rpcResult)(id, {});
        case 'tools/list':
            return (0, mcp_protocol_js_1.rpcResult)(id, {
                tools: grant.tools.map((name) => ({
                    name: (0, mcp_protocol_js_1.mcpToolName)(name),
                    description: collaboration_tools_js_1.toolDescriptions[name],
                    inputSchema: collaboration_tools_js_1.engineToolSchemas[name],
                })),
            });
        case 'tools/call': {
            const name = grant.tools.find((t) => (0, mcp_protocol_js_1.mcpToolName)(t) === params.name || t === params.name);
            if (!name)
                return (0, mcp_protocol_js_1.rpcError)(id, mcp_protocol_js_1.jsonRpcCodes.invalidParams, 'Tool not allowed for this run', {
                    error: 'MCP_TOOL_NOT_ALLOWED',
                });
            const input = params.arguments === undefined ? {} : params.arguments;
            const key = JSON.stringify(id), fingerprint = (0, hash_js_1.hash)([name, input]);
            const prior = grant.calls.get(key);
            if (prior) {
                if (prior.fingerprint !== fingerprint)
                    return (0, mcp_protocol_js_1.rpcError)(id, mcp_protocol_js_1.jsonRpcCodes.invalidParams, 'Request id reused for a different call', {
                        error: 'IDEMPOTENCY_CONFLICT',
                    });
                return (0, mcp_protocol_js_1.rpcResult)(id, await prior.reply);
            }
            const reply = host.callTool(grant, name, input).then((value) => (0, mcp_protocol_js_1.toolResult)(value), (error) => {
                const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'TOOL_FAILED';
                const detail = error.detail;
                return (0, mcp_protocol_js_1.toolResult)({
                    error: code,
                    ...(typeof detail === 'string' ? { detail: detail.slice(0, 500) } : {}),
                    recovery: host.recovery(code, name),
                }, true);
            });
            grant.calls.set(key, { fingerprint, reply });
            return (0, mcp_protocol_js_1.rpcResult)(id, await reply);
        }
        default:
            return (0, mcp_protocol_js_1.rpcError)(id, mcp_protocol_js_1.jsonRpcCodes.methodNotFound, 'Method not found');
    }
}
//# sourceMappingURL=engine-mcp.js.map