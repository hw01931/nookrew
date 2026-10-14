"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.storageIdentity = void 0;
// Persistent identities are independent of display branding. Changing these needs a migration.
exports.storageIdentity = Object.freeze({
    directory: '.aiorchestra',
    runsFile: 'results.db',
    boardFile: 'board.db',
    draftNamespace: 'aiorchestra:draft',
});
//# sourceMappingURL=storage.js.map