"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acceptanceTestNames = acceptanceTestNames;
/**
 * Test names declared in an acceptance check, in order. Matches test('name', ...) and wrappers whose
 * name ends in "test"/"Test" (approved checks may use runTest('name', fn)); a method call such as
 * /x/.test('a') is not a declaration. Names are what work items list as their criteria (ADR 0045).
 */
function acceptanceTestNames(source) {
    const names = [];
    for (const m of source.matchAll(/(?<![\w.$])\w*[tT]est\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
        const name = m[2].replace(/\\(.)/g, '$1').trim();
        if (name && !m[2].includes('${') && !names.includes(name))
            names.push(name);
    }
    return names;
}
//# sourceMappingURL=acceptance.js.map