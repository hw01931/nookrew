"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.idempotencyKeyMaxLength = void 0;
exports.assertCommand = assertCommand;
exports.idempotencyKeyMaxLength = 150;
/** Shared envelope check for every mutating command; the single owner of these rules. */
function assertCommand(command, expect) {
    const valid = command.actor === expect.actor &&
        (expect.project === undefined ? Boolean(command.project_id) : command.project_id === expect.project) &&
        Boolean(command.correlation_id) &&
        Boolean(command.idempotency_key) &&
        command.idempotency_key.length <= exports.idempotencyKeyMaxLength &&
        Number.isSafeInteger(command.expected_version) &&
        command.expected_version >= (expect.minVersion ?? 0) &&
        (expect.version === undefined || command.expected_version === expect.version);
    if (!valid)
        throw Error('INVALID_COMMAND');
}
//# sourceMappingURL=command.js.map