"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultRuleChecks = exports.ruleLimits = void 0;
exports.defaultRuleChecksIn = defaultRuleChecksIn;
exports.upgradeRuleChecks = upgradeRuleChecks;
exports.globRegExp = globRegExp;
exports.validateRuleChecks = validateRuleChecks;
exports.scanRules = scanRules;
exports.ruleLimits = { content: 12000, checks: 40, pattern: 300 };
/**
 * Safe defaults every project starts with; the owner can edit or remove them. Key prefixes need a
 * left boundary: without one, CSS such as `.task-list-container-items` reads as an `sk-` key.
 */
exports.defaultRuleChecks = [
    {
        id: 'no-eval',
        pattern: '\\beval\\s*\\(|\\bnew\\s+Function\\s*\\(',
        files: '**/*.{js,mjs,cjs,ts}',
        message: '문자열을 코드로 실행하지 않음',
    },
    {
        id: 'no-document-write',
        pattern: '\\bdocument\\.write\\s*\\(',
        files: '**/*.{js,html}',
        message: 'document.write 금지',
    },
    {
        id: 'no-secret',
        pattern: '((?<![A-Za-z0-9_.#-])sk-[A-Za-z0-9_-]{20,}|(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![0-9A-Za-z])|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?<![A-Za-z0-9_.#-])AIza[0-9A-Za-z_-]{30,})',
        files: '**/*',
        message: '비밀 키를 코드에 넣지 않음',
    },
];
/** The default checks' messages in an English project (ADR 0062); ids and patterns are the same. */
const englishRuleMessages = {
    'no-eval': 'Do not run strings as code',
    'no-document-write': 'No document.write',
    'no-secret': 'Do not put secret keys in code',
};
/** The defaults as a project in this language starts with them; Korean is `defaultRuleChecks`. */
function defaultRuleChecksIn(lang) {
    return lang === 'ko'
        ? exports.defaultRuleChecks
        : exports.defaultRuleChecks.map((c) => ({ ...c, message: englishRuleMessages[c.id] ?? c.message }));
}
/**
 * Default patterns that earlier versions saved into projects. A stored check still equal to one of
 * them (same id, pattern and files) is the default the owner never edited, so it is read as the
 * current default. Anything the owner changed stays as they wrote it.
 */
const earlierDefaults = {
    'no-eval': [{ pattern: '\\beval\\s*\\(|new\\s+Function\\s*\\(', files: '**/*.{js,mjs,cjs,ts}' }],
    'no-document-write': [{ pattern: 'document\\.write\\s*\\(', files: '**/*.{js,html}' }],
    'no-secret': [
        {
            pattern: '(sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[0-9A-Za-z_-]{30,})',
            files: '**/*',
        },
    ],
};
function upgradeRuleChecks(checks) {
    return checks.map((check) => {
        const current = exports.defaultRuleChecks.find((d) => d.id === check.id);
        const earlier = earlierDefaults[check.id]?.some((e) => e.pattern === check.pattern && e.files === check.files);
        return current && earlier ? { ...check, pattern: current.pattern } : check;
    });
}
/** Replaces each matched span in a violation excerpt, so a matched key never reaches evidence. */
const redactedMatch = '[REDACTED]';
/** Glob to RegExp: **, *, ?, {a,b}. Paths use forward slashes. */
function globRegExp(glob) {
    let out = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
            out += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
            i += glob[i + 2] === '/' ? 2 : 1;
        }
        else if (c === '*')
            out += '[^/]*';
        else if (c === '?')
            out += '[^/]';
        else if (c === '{') {
            const end = glob.indexOf('}', i);
            if (end < 0)
                throw Error('INVALID_RULE_CHECK');
            out +=
                '(?:' +
                    glob
                        .slice(i + 1, end)
                        .split(',')
                        .map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&'))
                        .join('|') +
                    ')';
            i = end;
        }
        else
            out += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + out + '$');
}
function validateRuleChecks(input) {
    if (!Array.isArray(input) || input.length > exports.ruleLimits.checks)
        throw Error('INVALID_RULE_CHECK');
    const ids = new Set();
    return input.map((raw) => {
        const c = raw;
        if (!c ||
            typeof c.id !== 'string' ||
            !/^[a-z0-9-]{1,40}$/.test(c.id) ||
            ids.has(c.id) ||
            typeof c.pattern !== 'string' ||
            !c.pattern ||
            c.pattern.length > exports.ruleLimits.pattern ||
            typeof c.files !== 'string' ||
            !c.files ||
            c.files.length > 120 ||
            typeof c.message !== 'string' ||
            !c.message.trim() ||
            c.message.length > 200)
            throw Error('INVALID_RULE_CHECK');
        ids.add(c.id);
        try {
            new RegExp(c.pattern);
            globRegExp(c.files);
        }
        catch {
            throw Error('INVALID_RULE_CHECK');
        }
        if (hasNestedRepetition(c.pattern))
            throw Error('INVALID_RULE_CHECK');
        return { id: c.id, pattern: c.pattern, files: c.files, message: c.message.trim() };
    });
}
/** `+`, `*`, `{n,}` or `{n,m}` at `at`: a token that repeats a variable number of times. */
function repeatsAt(source, at) {
    const c = source[at];
    return c === '+' || c === '*' || (c === '{' && /^\{\d+,\d*\}/.test(source.slice(at)));
}
/**
 * True for a repeated group that itself contains a repetition, such as `(a+)+` or `(?:\w+\s?)+`:
 * the usual shape of catastrophic backtracking. A cheap save-time screen only; it does not catch
 * every slow pattern (e.g. overlapping alternatives), so scans still run under a time limit.
 */
function hasNestedRepetition(source) {
    const groups = [false];
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (c === '\\')
            i++;
        else if (c === '[') {
            for (i++; i < source.length && source[i] !== ']'; i++)
                if (source[i] === '\\')
                    i++;
        }
        else if (c === '(')
            groups.push(false);
        else if (c === ')') {
            const inner = groups.length > 1 ? groups.pop() : false, repeated = repeatsAt(source, i + 1);
            if (inner && repeated)
                return true;
            if (inner || repeated)
                groups[groups.length - 1] = true;
        }
        else if (repeatsAt(source, i))
            groups[groups.length - 1] = true;
    }
    return false;
}
/**
 * Violations in the given files. Lines longer than 2000 characters are checked only in their first 2000.
 * Runs owner-supplied patterns synchronously: server code calls it through `scanRulesIsolated`.
 */
function scanRules(files, checks) {
    const out = [];
    for (const check of checks) {
        const scope = globRegExp(check.files), pattern = new RegExp(check.pattern), every = new RegExp(check.pattern, 'g');
        for (const f of files) {
            if (f.content === null || !scope.test(f.path))
                continue;
            f.content.split('\n').forEach((text, i) => {
                const checked = text.slice(0, 2000);
                if (out.length < 50 && pattern.test(checked))
                    out.push({
                        check: check.id,
                        path: f.path,
                        line: i + 1,
                        excerpt: checked
                            .replace(every, (m) => (m ? redactedMatch : m))
                            .trim()
                            .slice(0, 120),
                        message: check.message,
                    });
            });
        }
    }
    return out;
}
//# sourceMappingURL=project-rules.js.map