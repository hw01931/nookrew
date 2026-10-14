"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serversView = serversView;
exports.serversCommand = serversCommand;
const server_model_js_1 = require("../adapters/server-model.js");
const model_server_js_1 = require("../domain/model-server.js");
const model_servers_js_1 = require("../infrastructure/model-servers.js");
const keyOf = (s, id) => {
    try {
        return s.credentials.entry((0, model_servers_js_1.serverCredential)(id));
    }
    catch {
        return { set: false };
    }
};
function serversView(s) {
    const data = s.settings.read();
    return {
        servers: data.servers.map((server) => ({
            ...server,
            reach: (0, model_server_js_1.serverReach)(server.baseUrl),
            key: keyOf(s, server.id),
        })),
        models: data.models.map((m) => {
            const server = data.servers.find((x) => x.id === m.serverId);
            const rule = (0, model_server_js_1.costRule)(server, m);
            return {
                ...m,
                serverLabel: server.label,
                cost: rule.kind === 'free' ? 'free-' + rule.why : rule.kind,
                state: (0, server_model_js_1.serverModelState)(server, m, keyOf(s, server.id).set, !!s.ledger),
            };
        }),
        known: server_model_js_1.knownServers,
        defaults: (0, model_servers_js_1.defaultServerOptions)(),
    };
}
function serverOf(s, id) {
    const server = s.settings.read().servers.find((x) => x.id === id);
    if (!server)
        throw Error('SERVER_NOT_FOUND');
    return server;
}
async function serversCommand(s, input) {
    switch (input.action) {
        case 'server-put': {
            const given = (input.server ?? {});
            // `apiKey`, not `key`: every command already carries `key` as its idempotency key.
            const key = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
            // Refused before anything is stored: a key may not travel in clear text over the internet.
            const keyed = !!key || (!!given.id && serverOf(s, given.id).keyed === true);
            if (keyed)
                (0, model_server_js_1.assertKeyTransport)((0, model_server_js_1.parseServerUrl)(given.baseUrl), true);
            const server = s.settings.putServer(given);
            if (!key)
                return server;
            await s.credentials.set((0, model_servers_js_1.serverCredential)(server.id), key);
            return s.settings.setKeyed(server.id, true);
        }
        case 'server-remove': {
            const server = serverOf(s, input.id);
            s.settings.removeServer(server.id);
            s.credentials.remove((0, model_servers_js_1.serverCredential)(server.id));
            return { removed: true };
        }
        case 'key-set': {
            const server = serverOf(s, input.id);
            (0, model_server_js_1.assertKeyTransport)(server.baseUrl, true);
            await s.credentials.set((0, model_servers_js_1.serverCredential)(server.id), String(input.apiKey ?? ''));
            return s.settings.setKeyed(server.id, true);
        }
        case 'key-remove': {
            const server = serverOf(s, input.id);
            s.credentials.remove((0, model_servers_js_1.serverCredential)(server.id));
            return s.settings.setKeyed(server.id, false);
        }
        case 'list-models': {
            const server = serverOf(s, input.id);
            const key = server.keyed ? await s.credentials.get((0, model_servers_js_1.serverCredential)(server.id)) : undefined;
            const added = s.settings.read().models;
            return (await (0, server_model_js_1.listServerModels)(server.baseUrl, key, s.request)).map((m) => {
                const id = (0, model_servers_js_1.serverModelId)(server.id, m.model);
                return { ...m, id, serverId: server.id, added: added.some((x) => x.id === id) };
            });
        }
        case 'model-put':
            return s.settings.putModel(input.model);
        case 'model-remove':
            return s.settings.removeModel(String(input.id ?? ''));
        case 'detect': {
            const servers = s.settings.read().servers;
            return (await (0, server_model_js_1.detectServers)(s.request, s.candidates)).map((f) => ({
                ...f,
                added: servers.some((x) => x.baseUrl === f.baseUrl),
            }));
        }
        default:
            throw Error('UNKNOWN_ACTION');
    }
}
//# sourceMappingURL=model-servers-http.js.map