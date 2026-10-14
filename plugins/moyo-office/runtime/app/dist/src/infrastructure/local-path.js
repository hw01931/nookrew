"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.localDirectory = localDirectory;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
/** Validate each existing ancestor; a worktree or junction is not a sandbox. */
function localDirectory(input) {
    if (!input ||
        !(0, node_path_1.isAbsolute)(input) ||
        input.includes('\0') ||
        input.startsWith('\\\\') ||
        input.startsWith('//'))
        throw Error('INVALID_LOCAL_PATH');
    const full = (0, node_path_1.resolve)(input), base = (0, node_path_1.parse)(full).root;
    if (full === base)
        throw Error('ROOT_DIRECTORY_DENIED');
    let cursor = base;
    for (const part of (0, node_path_1.relative)(base, full).split(/[\\/]/)) {
        cursor = (0, node_path_1.resolve)(cursor, part);
        const stat = (0, node_fs_1.lstatSync)(cursor);
        if (stat.isSymbolicLink() || !stat.isDirectory())
            throw Error('PATH_DENIED');
    }
    return (0, node_fs_1.realpathSync)(full);
}
//# sourceMappingURL=local-path.js.map