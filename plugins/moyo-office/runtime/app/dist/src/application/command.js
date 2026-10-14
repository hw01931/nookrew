"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCommand = createCommand;
const node_crypto_1 = require("node:crypto");
function createCommand(actor, project, key = (0, node_crypto_1.randomUUID)(), expectedVersion = 0) {
    return {
        actor,
        project_id: project,
        idempotency_key: key,
        correlation_id: (0, node_crypto_1.randomUUID)(),
        expected_version: expectedVersion,
    };
}
//# sourceMappingURL=command.js.map