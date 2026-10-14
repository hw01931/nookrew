"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.officePluginTools = void 0;
exports.answerOfficePlugin = answerOfficePlugin;
exports.startOfficePlugin = startOfficePlugin;
const mcp_protocol_js_1 = require("../domain/mcp-protocol.js");
const office_host_js_1 = require("./office-host.js");
const tool = (name, description, readOnly) => ({
    name,
    description,
    inputSchema: {
        type: 'object',
        properties: {
            project: { type: 'string', description: 'Absolute local path of the user-selected Codex project.' },
            ...(!readOnly
                ? {
                    key: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 150,
                        description: 'Unique request ID. Reuse only when retrying this same operation.',
                    },
                }
                : {}),
        },
        required: readOnly ? ['project'] : ['project', 'key'],
        additionalProperties: false,
    },
    annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});
exports.officePluginTools = [
    tool('office_open', 'Start or reuse the selected project office. Returns its local URL to open in the Codex browser panel. Does not send a model message.', false),
    tool('office_status', 'Check a project office started by this plugin instance.', true),
    tool('office_close', 'Stop only the selected project office. Keeps project files and records.', false),
];
async function answerOfficePlugin(value, host) {
    const parsed = (0, mcp_protocol_js_1.parseMcpMessage)(value);
    if ('error' in parsed)
        return parsed.error;
    const { id, method, params } = parsed.request;
    if (id === undefined)
        return;
    if (method === 'initialize')
        return (0, mcp_protocol_js_1.rpcResult)(id, {
            protocolVersion: (0, mcp_protocol_js_1.negotiateVersion)(params.protocolVersion),
            capabilities: { tools: {} },
            serverInfo: { name: 'moyo-office', version: '0.1.0' },
        });
    if (method === 'ping')
        return (0, mcp_protocol_js_1.rpcResult)(id, {});
    if (method === 'tools/list')
        return (0, mcp_protocol_js_1.rpcResult)(id, { tools: exports.officePluginTools });
    if (method !== 'tools/call')
        return (0, mcp_protocol_js_1.rpcError)(id, mcp_protocol_js_1.jsonRpcCodes.methodNotFound, 'Method not found');
    const args = params.arguments;
    if (!args ||
        typeof args.project !== 'string' ||
        Object.keys(args).some((k) => !['project', 'key'].includes(k)))
        return (0, mcp_protocol_js_1.rpcError)(id, mcp_protocol_js_1.jsonRpcCodes.invalidParams, 'Expected project path only');
    try {
        let result;
        if (params.name !== 'office_status' &&
            (typeof args.key !== 'string' || !args.key || args.key.length > 150))
            return (0, mcp_protocol_js_1.rpcError)(id, mcp_protocol_js_1.jsonRpcCodes.invalidParams, 'Expected request key');
        if (params.name === 'office_open')
            result = await host.open(args.project, args.key);
        else if (params.name === 'office_status')
            result = await host.status(args.project);
        else if (params.name === 'office_close')
            result = await host.close(args.project, args.key);
        else
            return (0, mcp_protocol_js_1.rpcError)(id, mcp_protocol_js_1.jsonRpcCodes.invalidParams, 'Unknown tool');
        return (0, mcp_protocol_js_1.rpcResult)(id, (0, mcp_protocol_js_1.toolResult)(result));
    }
    catch (error) {
        return (0, mcp_protocol_js_1.rpcResult)(id, (0, mcp_protocol_js_1.toolResult)({ error: error instanceof Error ? error.message : 'OFFICE_PLUGIN_FAILED' }, true));
    }
}
/** Reuses the project's published MCP contracts; bounded newline stdio, no stdout log mixing. */
function startOfficePlugin(launcher) {
    const host = new office_host_js_1.OfficePluginHost(launcher);
    let buffer = '';
    const output = (value) => {
        if (value)
            process.stdout.write(JSON.stringify(value) + '\n');
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 1_000_000) {
            output((0, mcp_protocol_js_1.rpcError)(null, mcp_protocol_js_1.jsonRpcCodes.invalidRequest, 'Request too large'));
            buffer = '';
            process.stdin.destroy();
            return;
        }
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            let value;
            try {
                value = JSON.parse(line);
            }
            catch {
                output((0, mcp_protocol_js_1.rpcError)(null, mcp_protocol_js_1.jsonRpcCodes.parseError, 'Parse error'));
                continue;
            }
            void answerOfficePlugin(value, host)
                .then(output)
                .catch(() => output((0, mcp_protocol_js_1.rpcError)(null, mcp_protocol_js_1.jsonRpcCodes.internalError, 'Plugin request failed')));
        }
    });
}
//# sourceMappingURL=stdio.js.map