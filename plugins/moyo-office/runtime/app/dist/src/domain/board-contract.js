"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.boardLimits = exports.boardStatuses = void 0;
const command_js_1 = require("./command.js");
// Persisted IDs and limits are domain contracts, independent of product branding.
exports.boardStatuses = ['BACKLOG', 'ACTIVE', 'REVIEW', 'DONE'];
exports.boardLimits = Object.freeze({
    titleCharacters: 120,
    goalCharacters: 5000,
    historyEntries: 100,
    idempotencyKeyCharacters: command_js_1.idempotencyKeyMaxLength,
});
//# sourceMappingURL=board-contract.js.map