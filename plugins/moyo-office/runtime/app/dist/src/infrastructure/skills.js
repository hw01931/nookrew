"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillLibrary = exports.skillLimits = void 0;
exports.parseSkill = parseSkill;
exports.roleMatches = roleMatches;
exports.skillsFor = skillsFor;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
exports.skillLimits = { name: 64, description: 1024, body: 20000, file: 20000, files: 30 };
const namePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Frontmatter subset: `key: value`, `key: [a, b]`, and `- item` lists. Quotes are stripped. */
function parseSkill(text) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.replace(/^\uFEFF/, ''));
    if (!match)
        throw Error('INVALID_SKILL');
    const meta = {};
    let listKey = '';
    for (const raw of match[1].split(/\r?\n/)) {
        const item = /^\s*-\s+(.*)$/.exec(raw);
        if (item && listKey) {
            meta[listKey].push(unquote(item[1]));
            continue;
        }
        const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(raw);
        if (!pair)
            continue;
        const [, key, value] = pair;
        if (value === '') {
            meta[key] = [];
            listKey = key;
        }
        else if (/^\[.*\]$/.test(value)) {
            meta[key] = value
                .slice(1, -1)
                .split(',')
                .map((v) => unquote(v.trim()))
                .filter(Boolean);
            listKey = '';
        }
        else {
            meta[key] = unquote(value);
            listKey = '';
        }
    }
    return { meta, body: match[2].trim() };
}
/** Double-quoted values are JSON strings (escaped quotes inside); single quotes are stripped. */
const unquote = (raw) => {
    const v = raw.trim();
    if (/^".*"$/.test(v))
        try {
            return String(JSON.parse(v));
        }
        catch {
            return v.slice(1, -1);
        }
    return v.replace(/^'(.*)'$/, '$1');
};
function readSkill(dir, source) {
    const file = (0, node_path_1.join)(dir, 'SKILL.md');
    if (!(0, node_fs_1.existsSync)(file) || (0, node_fs_1.statSync)(file).size > exports.skillLimits.body * 4)
        return undefined;
    let parsed;
    try {
        parsed = parseSkill((0, node_fs_1.readFileSync)(file, 'utf8'));
    }
    catch {
        return undefined;
    }
    const name = String(parsed.meta.name ?? ''), description = String(parsed.meta.description ?? '');
    if (!namePattern.test(name) || !description || description.length > exports.skillLimits.description)
        return undefined;
    const roles = Array.isArray(parsed.meta.roles)
        ? parsed.meta.roles
        : parsed.meta.roles
            ? [String(parsed.meta.roles)]
            : [];
    const files = [];
    const walk = (d, depth) => {
        for (const entry of (0, node_fs_1.readdirSync)(d, { withFileTypes: true })) {
            const path = (0, node_path_1.join)(d, entry.name);
            if (entry.isDirectory() && depth < 2 && !entry.name.startsWith('.'))
                walk(path, depth + 1);
            else if (entry.isFile() && entry.name !== 'SKILL.md' && /\.(md|txt|json|csv)$/i.test(entry.name))
                files.push((0, node_path_1.relative)(dir, path).split(node_path_1.sep).join('/'));
        }
    };
    walk(dir, 0);
    return {
        name,
        description,
        roles,
        body: parsed.body.slice(0, exports.skillLimits.body),
        source,
        files: files.slice(0, exports.skillLimits.files),
        dir,
    };
}
class SkillLibrary {
    builtinDir;
    userDir;
    constructor(
    /** Shipped with the app, read-only. */
    builtinDir, 
    /** The owner's own skills; created on first use. */
    userDir) {
        this.builtinDir = builtinDir;
        this.userDir = userDir;
    }
    /** User skills replace built-in ones of the same name, like a local override. */
    list() {
        const out = new Map();
        for (const [dir, source] of [
            [this.builtinDir, 'builtin'],
            [this.userDir, 'user'],
        ]) {
            if (!(0, node_fs_1.existsSync)(dir))
                continue;
            for (const entry of (0, node_fs_1.readdirSync)(dir, { withFileTypes: true }))
                if (entry.isDirectory()) {
                    const skill = readSkill((0, node_path_1.join)(dir, entry.name), source);
                    if (skill)
                        out.set(skill.name, skill);
                }
        }
        return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    get(name) {
        return this.list().find((s) => s.name === name);
    }
    /** A text file inside a skill folder; paths that leave the folder are refused. */
    readFile(skill, file) {
        if (!skill.files.includes(file))
            throw Error('SKILL_FILE_NOT_FOUND');
        const path = (0, node_path_1.resolve)(skill.dir, file);
        if (!path.startsWith((0, node_path_1.resolve)(skill.dir) + node_path_1.sep))
            throw Error('PATH_DENIED');
        return (0, node_fs_1.readFileSync)(path, 'utf8').slice(0, exports.skillLimits.file);
    }
    /** Create or replace a user skill (built-in names make a user copy that overrides them). */
    save(input) {
        const name = String(input.name ?? '').trim(), description = String(input.description ?? '')
            .trim()
            .replace(/\s+/g, ' '), body = String(input.body ?? '').trim();
        const roles = Array.isArray(input.roles)
            ? input.roles
                .map((r) => String(r).trim())
                .filter(Boolean)
                .slice(0, 20)
            : [];
        if (!namePattern.test(name) ||
            !description ||
            description.length > exports.skillLimits.description ||
            !body ||
            body.length > exports.skillLimits.body ||
            roles.some((r) => r.length > 40 || /[\r\n\]\[,]/.test(r)))
            throw Error('INVALID_SKILL');
        const dir = (0, node_path_1.join)(this.userDir, name);
        (0, node_fs_1.mkdirSync)(dir, { recursive: true });
        const yaml = (v) => JSON.stringify(v);
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${yaml(description)}\n${roles.length ? `roles: [${roles.join(', ')}]\n` : ''}---\n\n${body}\n`);
        return this.get(name);
    }
}
exports.SkillLibrary = SkillLibrary;
/** Lower-cased words of a role; spaces and punctuation such as / · , ( ) - separate words. */
const roleWords = (text) => text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
/**
 * Whether a skill's role word fits a role. Matching rule (case-insensitive, role only):
 * - The employee's name never counts; only the role field does ("디자인 김" as a name is not a role).
 * - A role word matches when some word of the role *starts with* it: 개발 matches 개발자 and
 *   "백엔드 개발자", QA matches "qa engineer", but 개발 does not match 사업개발 — a word that only
 *   contains it elsewhere is a different role. Words are split on spaces and punctuation, so
 *   "프론트엔드/모바일 개발자" has the word 개발자, while "풀스택개발자" written as one word does not.
 * - A role word of several words ("데이터 엔지니어") matches the same words in order, each by prefix,
 *   so it can single out one of two roles that share a first word (데이터 엔지니어 vs 데이터 분석가).
 */
function roleMatches(role, roleWord) {
    const words = roleWords(role), want = roleWords(roleWord);
    if (!want.length)
        return false;
    return words.some((_, i) => want.every((w, j) => words[i + j]?.startsWith(w)));
}
/**
 * The skills an employee works with: the explicit list when the owner set one, otherwise every skill
 * with a `roles` word that matches the employee's role (see roleMatches).
 */
function skillsFor(employee, all) {
    if (Array.isArray(employee.skills))
        return all.filter((s) => employee.skills.includes(s.name));
    return all.filter((s) => s.roles.some((r) => roleMatches(employee.role, r)));
}
//# sourceMappingURL=skills.js.map