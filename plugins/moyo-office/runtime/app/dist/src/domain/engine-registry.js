"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeArgument = exports.engineBounds = exports.engineTemplates = exports.engineFlags = exports.mcpUrlPattern = exports.engineMcp = exports.engineOutputs = exports.engineEfforts = exports.engineTemplateIds = void 0;
exports.claudeMcpConfig = claudeMcpConfig;
exports.engineRunArgs = engineRunArgs;
exports.validExecutablePath = validExecutablePath;
exports.validateRegistration = validateRegistration;
exports.registrationArgs = registrationArgs;
exports.engineSpeaksMcp = engineSpeaksMcp;
exports.engineIdForRun = engineIdForRun;
exports.consentGranted = consentGranted;
exports.redactEngineOutput = redactEngineOutput;
/**
 * External development engines the owner registers from a fixed list of command templates (ADR 0065).
 * Nothing here runs a process: it validates what the owner chose and builds the exact argument list.
 * The prompt always goes through standard input, never through the command line, so no argument
 * carries free text and a Windows .cmd shim can be started without shell interpretation risk.
 */
exports.engineTemplateIds = ['claude-code', 'codex-exec', 'generic'];
/** Reasoning effort a run may ask for; mapped per engine by the flag table below. */
exports.engineEfforts = ['low', 'medium', 'high'];
/** Output modes a run may ask for (ADR 0070): 'json' asks the CLI for machine-readable usage. */
exports.engineOutputs = ['text', 'json'];
/**
 * The app's MCP endpoint as an engine run sees it (ADR 0071). The bearer token never appears in an
 * argument or a file: the engine reads it from this environment variable of its own process.
 */
exports.engineMcp = Object.freeze({
    server: 'aiorchestra',
    tokenEnv: 'AIORCHESTRA_MCP_TOKEN',
});
/** Only a literal loopback address of this PC, a port and the fixed path. */
exports.mcpUrlPattern = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):\d{1,5}\/mcp$/;
/** An absolute .json path a .cmd shim can carry as a plain argument. */
const plainConfigPath = /^(?:[A-Za-z]:\\[^"%!^&|<>`$;\r\n\t\0]*|\/[^"%!^&|<>`$;\r\n\t\0 ]*)\.json$/;
/**
 * The Claude Code client config of one run (`--mcp-config`). The header names the environment
 * variable; Claude Code expands `${VAR}` in MCP config values, so the file holds no secret.
 * TODO(owner): verify the expansion and the `type: "http"` shape against the installed version.
 */
function claudeMcpConfig(url) {
    if (!exports.mcpUrlPattern.test(url))
        throw Error('ENGINE_OPTION_UNSUPPORTED');
    return {
        mcpServers: {
            [exports.engineMcp.server]: {
                type: 'http',
                url,
                headers: { Authorization: 'Bearer ${' + exports.engineMcp.tokenEnv + '}' },
            },
        },
    };
}
/**
 * The one table of engine CLI flags (ADR 0065). Values come only from `models`, the template's
 * `modelName` shape (ADR 0072) and `engineEfforts`.
 * TODO(owner): verify against the installed version (`claude --help`, `codex exec --help`); these were
 * written from public documentation and never run here. Claude Code `-p` reads the prompt from stdin;
 * Codex `exec` reads it from stdin when the prompt argument is `-`.
 */
exports.engineFlags = {
    'claude-code': {
        base: ['-p', '--permission-mode', 'acceptEdits'],
        models: ['sonnet', 'opus', 'haiku'],
        /**
         * A model a run may name besides the aliases (an employee's pin, ADR 0072): a full Claude model
         * id. Only these characters reach the argument list. TODO(owner): verify against the installed version.
         */
        modelName: /^claude-[a-z0-9][a-z0-9.-]{0,60}$/,
        model: (m) => ['--model', m],
        effort: (e) => ['--effort', e],
        /** Final result object with usage, cost estimate and per-model usage (ADR 0070). */
        json: ['--output-format', 'json'],
        /**
         * The app's tools for this run only (ADR 0071): the generated config, no other MCP servers from
         * the owner's own settings, and this server's tools allowed without a prompt (`-p` cannot ask).
         * `--mcp-config` and `--allowedTools` take several values, so a plain flag follows the first and
         * the second comes last. TODO(owner): verify against the installed version.
         */
        mcp: (t) => [
            '--mcp-config',
            t.configPath,
            '--strict-mcp-config',
            '--allowedTools',
            `mcp__${exports.engineMcp.server}`,
        ],
        /** Inserted before this many trailing arguments (0: appended). */
        tail: 0,
    },
    'codex-exec': {
        base: ['exec', '--full-auto', '--skip-git-repo-check', '-'],
        models: ['gpt-5-codex', 'gpt-5', 'gpt-5-mini'],
        /**
         * A model a run may name besides the listed ones (an employee's pin, ADR 0072), e.g. a newer
         * "gpt-6.1-sol". `--model` is the long form of `-m`. TODO(owner): verify against the installed version.
         */
        modelName: /^(?:gpt-[a-z0-9][a-z0-9.-]{0,60}|o[0-9][a-z0-9.-]{0,30}|codex-[a-z0-9][a-z0-9.-]{0,60})$/,
        model: (m) => ['--model', m],
        effort: (e) => ['-c', `model_reasoning_effort=${e}`],
        /** JSON Lines events with token counts (ADR 0070). */
        json: ['--json'],
        /**
         * A streamable HTTP MCP server as `-c` overrides (ADR 0071), never the owner's config.toml. An
         * unquoted value that is not valid TOML is read as a string; the token comes from the named
         * environment variable. TODO(owner): verify against the installed version (older versions also
         * needed `experimental_use_rmcp_client=true` for HTTP servers).
         */
        mcp: (t) => [
            '-c',
            `mcp_servers.${exports.engineMcp.server}.url=${t.url}`,
            '-c',
            `mcp_servers.${exports.engineMcp.server}.bearer_token_env_var=${exports.engineMcp.tokenEnv}`,
        ],
        tail: 1,
    },
};
/**
 * Command templates. API key variables are never passed, so the tools use their own sign-in
 * (subscription), not a pay-per-use key from this process.
 */
exports.engineTemplates = {
    'claude-code': {
        commands: ['claude'],
        models: exports.engineFlags['claude-code'].models,
        effort: true,
        env: ['CLAUDE_CONFIG_DIR'],
    },
    'codex-exec': {
        commands: ['codex'],
        models: exports.engineFlags['codex-exec'].models,
        effort: true,
        env: ['CODEX_HOME'],
    },
    generic: { commands: [], models: [], effort: false, env: [] },
};
/**
 * The exact arguments of one run: the template's fixed flags, then model and effort from the enums.
 * Throws ENGINE_OPTION_UNSUPPORTED for a value outside them; nothing else is accepted.
 */
function engineRunArgs(template, options = {}, genericArgs = [], mcp) {
    if (options.output !== undefined && !exports.engineOutputs.includes(options.output))
        throw Error('ENGINE_OPTION_UNSUPPORTED');
    if (template === 'generic') {
        if (options.model || options.effort || options.output === 'json')
            throw Error('ENGINE_OPTION_UNSUPPORTED');
        if (mcp)
            throw Error('ENGINE_MCP_UNSUPPORTED');
        return [...genericArgs];
    }
    if (mcp &&
        (!exports.mcpUrlPattern.test(mcp.url) ||
            (template === 'claude-code' && !plainConfigPath.test(mcp.configPath ?? ''))))
        throw Error('ENGINE_OPTION_UNSUPPORTED');
    const flags = exports.engineFlags[template];
    if (options.model !== undefined &&
        !flags.models.includes(options.model) &&
        !flags.modelName.test(options.model))
        throw Error('ENGINE_OPTION_UNSUPPORTED');
    if (options.effort !== undefined && !exports.engineEfforts.includes(options.effort))
        throw Error('ENGINE_OPTION_UNSUPPORTED');
    const extra = [
        ...(options.output === 'json' ? flags.json : []),
        ...(options.model ? flags.model(options.model) : []),
        ...(options.effort ? flags.effort(options.effort) : []),
        // Last: Claude Code's --allowedTools takes every value after it.
        ...(mcp ? flags.mcp(mcp) : []),
    ];
    const base = [...flags.base];
    return [...base.slice(0, base.length - flags.tail), ...extra, ...base.slice(base.length - flags.tail)];
}
exports.engineBounds = Object.freeze({
    minTimeoutMs: 60000,
    maxTimeoutMs: 3600000,
    maxArgs: 16,
    maxEngines: 8,
});
/** A plain argument: no quotes, spaces, shell or cmd.exe metacharacters, no variable expansion. */
exports.safeArgument = /^(?:\{workspace\}|[A-Za-z0-9][A-Za-z0-9._:=/@+-]{0,199}|-{1,2}[A-Za-z0-9][A-Za-z0-9._:=/@+-]{0,198})$/;
/** Characters cmd.exe or a shell could interpret, and control characters. */
const unsafePathCharacters = /["%!^&|<>`$;\r\n\t\0]/;
/** Executable path shape: absolute, no metacharacters, a runnable extension on Windows. */
function validExecutablePath(path, platform = process.platform) {
    if (typeof path !== 'string' || !path || path.length > 400 || unsafePathCharacters.test(path))
        return false;
    if (platform === 'win32')
        return /^[A-Za-z]:\\/.test(path) && /\.(exe|cmd|bat)$/i.test(path);
    return path.startsWith('/');
}
function baseName(path) {
    return (path.split(/[\\/]/).pop() ?? '').replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
}
/** Throws INVALID_ENGINE (with the field in the message) unless the registration is acceptable. */
function validateRegistration(input, platform = process.platform) {
    const v = input;
    const fail = (field) => {
        throw Object.assign(Error('INVALID_ENGINE'), { field });
    };
    if (!v || typeof v !== 'object')
        return fail('input');
    if (!exports.engineTemplateIds.includes(v.template))
        fail('template');
    const template = v.template, spec = exports.engineTemplates[template];
    if (typeof v.label !== 'string' || !v.label.trim() || v.label.length > 80)
        fail('label');
    if (!validExecutablePath(v.executable, platform))
        fail('executable');
    if (spec.commands.length && !spec.commands.includes(baseName(v.executable)))
        fail('executable');
    if (v.model !== undefined && v.model !== '' && !spec.models.includes(String(v.model)))
        fail('model');
    if (template === 'generic') {
        if (typeof v.id !== 'string' || !/^generic-[a-z0-9-]{1,30}$/.test(v.id))
            fail('id');
        if (!Array.isArray(v.args) ||
            v.args.length > exports.engineBounds.maxArgs ||
            v.args.some((a) => typeof a !== 'string' || !exports.safeArgument.test(a)))
            fail('args');
    }
    else {
        if (v.id !== template)
            fail('id');
        if (v.args !== undefined && (!Array.isArray(v.args) || v.args.length))
            fail('args');
    }
    if (!Number.isInteger(v.timeoutMs) ||
        v.timeoutMs < exports.engineBounds.minTimeoutMs ||
        v.timeoutMs > exports.engineBounds.maxTimeoutMs)
        fail('timeoutMs');
    if (typeof v.enabled !== 'boolean')
        fail('enabled');
    return {
        id: v.id,
        template,
        label: v.label.trim(),
        executable: v.executable,
        ...(v.model ? { model: v.model } : {}),
        ...(template === 'generic' ? { args: [...v.args] } : {}),
        timeoutMs: v.timeoutMs,
        enabled: v.enabled,
    };
}
/** The exact argument list for a registration; the prompt is not part of it (stdin). */
function registrationArgs(r) {
    return engineRunArgs(r.template, r.model ? { model: r.model } : {}, r.args ?? []);
}
/** Whether an engine of this template can reach the app's tools over MCP (ADR 0071). */
function engineSpeaksMcp(template) {
    return template === 'claude-code' || template === 'codex-exec';
}
/**
 * The fallback engine of a run: an employee's own engine or the project's develop route take develop
 * work only (ADR 0065). Planning reaches an engine only through a routing rule (ADR 0071). '' means
 * the employee's model.
 */
function engineIdForRun(input) {
    if (input.mode !== 'develop' || !input.canPropose)
        return '';
    return input.employeeEngine || input.developRoute;
}
/** Whether the project's owner agreed that this engine (this program) may receive its code. */
function consentGranted(consents, engine) {
    return consents.some((c) => c.engineId === engine.id && c.executable === engine.executable);
}
/** Masks values that look like credentials in engine output before it is stored or shown. */
function redactEngineOutput(text) {
    return text
        .replace(/(sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abpr]-[A-Za-z0-9-]{10,})/g, '[REDACTED]')
        .replace(/(authorization\s*[:=]\s*)(bearer\s+)?\S+/gi, '$1[REDACTED]')
        .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*[=:]\s*)("[^"]*"|\S+)/g, '$1[REDACTED]')
        .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED]');
}
//# sourceMappingURL=engine-registry.js.map