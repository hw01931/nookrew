"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.windowsShellAvailable = void 0;
exports.openCodexChat = openCodexChat;
exports.pickFolder = pickFolder;
exports.revealFolder = revealFolder;
exports.recycleInvocation = recycleInvocation;
exports.recycleFolder = recycleFolder;
const node_child_process_1 = require("node:child_process");
/**
 * Fixed Windows shell actions for the owner's own PC: choose a folder, open a folder in Explorer, send a
 * folder to the recycle bin. Scripts are constants; paths travel in environment variables, never in the
 * command text, so a folder name cannot change what runs.
 */
const powershellArgs = (script) => [
    '-NoProfile',
    '-NonInteractive',
    '-STA',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
];
const powershell = (script, env = {}, timeout = 0) => new Promise((resolve, reject) => (0, node_child_process_1.execFile)('powershell.exe', powershellArgs(script), { windowsHide: true, timeout, maxBuffer: 65536, encoding: 'utf8', env: { ...process.env, ...env } }, (error, stdout) => (error ? reject(error) : resolve(stdout.trim()))));
const utf8 = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ';
exports.windowsShellAvailable = process.platform === 'win32';
/** Canonical, validated local Codex chat only; no arbitrary URL or shell interpolation. */
function openCodexChat(threadId) {
    if (!exports.windowsShellAvailable)
        throw Error('CODEX_CHAT_UNAVAILABLE');
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(threadId))
        throw Error('INVALID_SESSION');
    // Store-packaged apps register a protocol activation, often without shell/open/command.
    // ShellExecute via Start-Process invokes that registration; Explorer spawn only confirms Explorer ran.
    return powershell('$ErrorActionPreference="Stop"; Start-Process -FilePath $env:AIO_CODEX_CHAT -ErrorAction Stop', { AIO_CODEX_CHAT: 'codex://threads/' + threadId }, 15000).then(() => undefined, () => {
        throw Error('CODEX_CHAT_UNAVAILABLE');
    });
}
/** The folder the owner picked, or null when they cancelled. Waits as long as the dialog is open. */
async function pickFolder(initial = '') {
    if (!exports.windowsShellAvailable)
        throw Error('FOLDER_PICKER_UNAVAILABLE');
    const out = await powershell(utf8 +
        'Add-Type -AssemblyName System.Windows.Forms; ' +
        '$owner = New-Object System.Windows.Forms.Form -Property @{TopMost = $true; ShowInTaskbar = $false}; ' +
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog; ' +
        "$d.Description = '프로젝트 폴더 선택'; $d.ShowNewFolderButton = $true; " +
        'if ($env:AIO_INITIAL -and (Test-Path -LiteralPath $env:AIO_INITIAL)) { $d.SelectedPath = $env:AIO_INITIAL }; ' +
        "if ($d.ShowDialog($owner) -eq 'OK') { $d.SelectedPath }", { AIO_INITIAL: initial });
    return out || null;
}
function revealFolder(path) {
    if (!exports.windowsShellAvailable)
        throw Error('FOLDER_REVEAL_UNAVAILABLE');
    // explorer.exe takes the folder as one argument; no shell is involved.
    (0, node_child_process_1.spawn)('explorer.exe', [path], { detached: true, stdio: 'ignore' }).unref();
}
/**
 * AllDialogs, not OnlyErrorDialogs: when a folder cannot go to the recycle bin (no bin on that drive,
 * over its size limit) Windows then asks before deleting permanently instead of doing it silently.
 * Declining that question cancels the operation and is reported as CANCELLED.
 */
const recycleScript = 'Add-Type -AssemblyName Microsoft.VisualBasic; ' +
    "try { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:AIO_TARGET, 'AllDialogs', 'SendToRecycleBin'); 'DONE' } " +
    "catch [System.OperationCanceledException] { 'CANCELLED' }";
/** The exact process the recycle action starts; exported so tests can check it without running it. */
function recycleInvocation(path) {
    // Windows may be waiting on the owner's answer, so the limit only ends a process that is stuck.
    return {
        file: 'powershell.exe',
        args: powershellArgs(recycleScript),
        env: { AIO_TARGET: path },
        timeout: 900000,
    };
}
/** Recycle bin, never a silent permanent deletion: the owner can restore it from Windows. */
async function recycleFolder(path) {
    if (!exports.windowsShellAvailable)
        throw Error('RECYCLE_UNAVAILABLE');
    const run = recycleInvocation(path);
    const out = await powershell(recycleScript, run.env, run.timeout);
    if (out === 'DONE' || out === 'CANCELLED')
        return out;
    throw Error('RECYCLE_RESULT_UNKNOWN');
}
//# sourceMappingURL=windows-shell.js.map