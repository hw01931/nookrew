"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webPolicy = void 0;
exports.publicSettings = publicSettings;
exports.renderIndex = renderIndex;
const board_contract_js_1 = require("../domain/board-contract.js");
const execution_js_1 = require("../domain/execution.js");
const fixture_js_1 = require("../adapters/fixture.js");
const product_js_1 = require("../config/product.js");
const storage_js_1 = require("../config/storage.js");
// Security and persisted storage identity must not change when the display name changes.
exports.webPolicy = Object.freeze({
    storageDirectory: storage_js_1.storageIdentity.directory,
    draftNamespace: storage_js_1.storageIdentity.draftNamespace,
    maxBodyBytes: 16384,
    maxConcurrentRuns: 2,
    fixtureDelayMs: 2500,
    runHistoryEntries: 30,
});
function publicSettings(config) {
    return {
        schemaVersion: 1,
        display: { ...config.display, projectName: (0, product_js_1.projectName)(config) },
        regional: config.regional,
        client: config.client,
        limits: {
            ...board_contract_js_1.boardLimits,
            runHistoryEntries: exports.webPolicy.runHistoryEntries,
            maxConcurrentRuns: exports.webPolicy.maxConcurrentRuns,
        },
        boardStatuses: board_contract_js_1.boardStatuses,
        terminalStates: execution_js_1.terminalStates,
        fixtureScenarios: fixture_js_1.fixtureScenarios,
        draftNamespace: exports.webPolicy.draftNamespace,
    };
}
function renderIndex(template, config) {
    const values = {
        ...config.display,
        projectName: (0, product_js_1.projectName)(config),
        titleCharacters: board_contract_js_1.boardLimits.titleCharacters,
        goalCharacters: board_contract_js_1.boardLimits.goalCharacters,
        runHistoryEntries: exports.webPolicy.runHistoryEntries,
        publicConfig: JSON.stringify(publicSettings(config)),
    };
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
        if (!(key in values))
            throw new Error('UNKNOWN_TEMPLATE_SETTING');
        return String(values[key]).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    });
}
//# sourceMappingURL=settings.js.map