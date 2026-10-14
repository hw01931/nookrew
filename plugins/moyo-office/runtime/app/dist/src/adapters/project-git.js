"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectGit = projectGit;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const node_fs_1 = require("node:fs");
const project_files_js_1 = require("./project-files.js");
const exec = (0, node_util_1.promisify)(node_child_process_1.execFile);
/** Fixed read-only Git commands. Current-file access policy also gates historical content. */
async function projectGit(root, path) {
    const working = new project_files_js_1.ProjectFiles(root).read(path);
    if (working.kind !== 'text' || working.truncated)
        throw Error('GIT_PREVIEW_UNSUPPORTED');
    const git = async (...args) => {
        try {
            const result = await exec('git', ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'safe.directory=' + root, ...args], {
                cwd: root,
                windowsHide: true,
                timeout: 5000,
                maxBuffer: project_files_js_1.fileBrowserLimits.previewBytes,
                encoding: 'utf8',
            });
            return result.stdout;
        }
        catch {
            throw Error('GIT_READ_FAILED');
        }
    };
    const top = (await git('rev-parse', '--show-toplevel')).trim();
    if ((0, node_fs_1.realpathSync)(top).toLowerCase() !== (0, node_fs_1.realpathSync)(root).toLowerCase())
        throw Error('GIT_ROOT_MISMATCH');
    const commits = (await git('log', '-2', '--format=%H', '--', path)).trim().split(/\r?\n/).filter(Boolean);
    if (commits.some((c) => !/^[a-f0-9]{40,64}$/.test(c)))
        throw Error('GIT_READ_FAILED');
    const after = commits[0] ? await git('show', commits[0] + ':' + path) : '';
    const before = commits[1] ? await git('show', commits[1] + ':' + path) : '';
    // Recheck path ownership after child process reads.
    new project_files_js_1.ProjectFiles(root).read(path);
    return { path, commits, before, after, working: working.content, observedAt: new Date().toISOString() };
}
//# sourceMappingURL=project-git.js.map