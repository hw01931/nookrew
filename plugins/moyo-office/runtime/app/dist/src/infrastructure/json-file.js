"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readJsonFile = readJsonFile;
exports.writeJsonFile = writeJsonFile;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
/** Reads a hand-editable config file; Windows editors may save it with a byte-order mark. */
function readJsonFile(file) {
    return JSON.parse((0, node_fs_1.readFileSync)(file, 'utf8').replace(/^\uFEFF/, ''));
}
/** Writes a settings file whole: a crash mid-write leaves the previous file, never half of one. */
function writeJsonFile(file, value, mode) {
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(file), { recursive: true });
    const temporary = file + '.tmp';
    (0, node_fs_1.writeFileSync)(temporary, JSON.stringify(value, null, 2), mode === undefined ? undefined : { mode });
    (0, node_fs_1.renameSync)(temporary, file);
}
//# sourceMappingURL=json-file.js.map