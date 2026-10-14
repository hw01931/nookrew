"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectChanges = exports.nodeWebVerifier = exports.imageId = exports.verifierImageInspect = void 0;
exports.acceptanceResults = acceptanceResults;
exports.regressedTests = regressedTests;
exports.logExcerpt = logExcerpt;
const project_rules_js_1 = require("../domain/project-rules.js");
const rule_scan_js_1 = require("./rule-scan.js");
const change_review_js_1 = require("../domain/change-review.js");
const sqlite_js_1 = require("../infrastructure/sqlite.js");
const automation_js_1 = require("../domain/automation.js");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_crypto_1 = require("node:crypto");
const node_child_process_1 = require("node:child_process");
const node_vm_1 = require("node:vm");
const workspace_js_1 = require("../application/workspace.js");
const task_js_1 = require("../domain/task.js");
const workspace_js_2 = require("../domain/workspace.js");
const collaboration_js_1 = require("../domain/collaboration.js");
const hash_js_1 = require("../infrastructure/hash.js");
const command_js_1 = require("../domain/command.js");
const text_edit_js_1 = require("../domain/text-edit.js");
const workspace_engine_js_1 = require("./workspace-engine.js");
const page_helper_js_1 = require("./page-helper.js");
/** The verifier's ACCEPTANCE_RESULTS line, if the acceptance check ran. */
function acceptanceResults(log) {
    const line = log.match(/^ACCEPTANCE_RESULTS (\{.*\})$/m)?.[1];
    if (!line)
        return undefined;
    try {
        const value = JSON.parse(line);
        return Array.isArray(value.passed) && Array.isArray(value.failed) ? value : undefined;
    }
    catch {
        return undefined;
    }
}
/** Tests that passed before and fail now; a test that is missing now counts as failing. */
function regressedTests(before, now) {
    if (!before || !now)
        return [];
    return before.passed.filter((name) => !now.passed.includes(name));
}
/**
 * Error messages sit at the start of a failure and stack frames at the end; keep the lines that say
 * what went wrong and drop Node's internal frames so a model can act on the log.
 */
function logExcerpt(log, limit = 3000) {
    const useful = log
        .split('\n')
        // Node runtime frames, with "at" (plain stack) or without it (node:test's YAML stack).
        .filter((line) => !/^\s+(at\s+)?\S.*node:(internal|diagnostics_channel)\S*\)?\s*$/.test(line))
        .join('\n');
    if (useful.length <= limit)
        return useful;
    const head = Math.floor(limit * 0.6);
    return useful.slice(0, head) + '\n…\n' + useful.slice(-(limit - head));
}
/** Fixed docker arguments that print the verification image's id (built by scripts/verifier/build.ps1). */
exports.verifierImageInspect = ['image', 'inspect', 'aiorchestra-verifier:1', '--format', '{{.Id}}'];
/** What that command prints when the image is present. */
exports.imageId = /^sha256:[a-f0-9]{64}$/;
/** The registered acceptance check is the evaluator's input and is injected at verify time. */
const acceptancePath = 'tests/acceptance.test.cjs';
const editablePath = (path) => /^(src|web|tests)\//.test(path) &&
    path !== acceptancePath &&
    /\.(js|mjs|cjs|ts|tsx|jsx|html|css|json|md|txt|svg)$/.test(path);
const verifierScript = `const fs=require('fs'),path=require('path'),cp=require('child_process');let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{const files=JSON.parse(input);fs.mkdirSync('/tmp/work',{recursive:true});for(const [name,text]of Object.entries(files)){const p=path.resolve('/tmp/work',name);if(!p.startsWith('/tmp/work/'))throw Error('PATH');fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof text==='string'?text:Buffer.from(text.base64,'base64'));}fs.symlinkSync('/opt/check/node_modules','/tmp/work/node_modules');process.chdir('/tmp/work');const build=cp.spawnSync(process.execPath,['/opt/check/node_modules/typescript/bin/tsc','-p','tsconfig.json'],{encoding:'utf8',timeout:60000,maxBuffer:1000000});process.stdout.write(build.stdout||'');process.stderr.write(build.stderr||'');if(build.status!==0)process.exit(1);const tests=fs.readdirSync('dist/tests').filter(x=>x.endsWith('.test.js')).map(x=>'dist/tests/'+x);if(!tests.length)process.exit(2);const result=cp.spawnSync(process.execPath,['--test',...tests],{encoding:'utf8',timeout:60000,maxBuffer:1000000});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status??2);});`;
/**
 * Runs inside the offline verifier container (node-web profile); sent as source via `node -e`.
 * PASS requires the user-registered acceptance check to exist and to run at least one real test.
 * Employee-written tests also run and can fail the change, but they can never make it pass alone.
 */
function nodeWebCheck() {
    const fs = require('fs'), path = require('path'), cp = require('child_process'), vm = require('vm');
    // The container always uses /tmp/work; tests point this at a temporary directory.
    const work = path.resolve(process.env.VERIFY_WORK || '/tmp/work');
    // The page helper's DOM library is installed in the image, not in the work directory.
    const env = { ...process.env, NODE_PATH: process.env.VERIFY_NODE_PATH || '/opt/check/node_modules' };
    let input = '';
    process.stdin.on('data', (d) => (input += d));
    process.stdin.on('end', () => {
        const files = JSON.parse(input);
        fs.mkdirSync(work, { recursive: true });
        for (const [name, text] of Object.entries(files)) {
            const p = path.resolve(work, name);
            const rel = path.relative(work, p);
            if (!rel || rel.startsWith('..') || path.isAbsolute(rel))
                throw Error('PATH');
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, typeof text === 'string' ? text : Buffer.from(text.base64, 'base64'));
        }
        process.chdir(work);
        const run = (args, timeout) => {
            const r = cp.spawnSync(process.execPath, args, { encoding: 'utf8', timeout, maxBuffer: 1000000, env });
            process.stdout.write(r.stdout || '');
            process.stderr.write(r.stderr || '');
            return { status: r.status, stdout: String(r.stdout || '') };
        };
        for (const file of Object.keys(files).filter((x) => /\.(js|mjs|cjs)$/.test(x)))
            if (run(['--check', file], 10000).status !== 0)
                process.exit(1);
        // The static app must open: the page exists, every script it loads exists, nothing is fetched
        // from outside, and loaded scripts do not use bare module.exports (undefined in a browser).
        const page = files['src/index.html'];
        const shell = (message) => {
            console.error('APP_SHELL: ' + message);
            process.exit(1);
        };
        if (typeof page !== 'string')
            shell('src/index.html이 없습니다.');
        const scripts = [];
        for (const match of String(page).matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)) {
            const ref = match[1];
            if (/^([a-z]+:)?\/\//i.test(ref))
                shell(`외부 스크립트 ${ref}는 쓸 수 없습니다.`);
            const target = path.posix.normalize(path.posix.join('src', ref));
            const script = files[target];
            if (typeof script !== 'string')
                shell(`index.html이 불러오는 ${target}이 없습니다.`);
            if (/\bmodule\.exports\b/.test(String(script)) && !/typeof\s+module/.test(String(script)))
                shell(`${target}이 module.exports를 typeof module 검사 없이 써서 브라우저에서 오류가 납니다.`);
            scripts.push(target);
        }
        for (const tag of String(page).match(/<link\b[^>]*>/gi) ?? []) {
            const href = tag.match(/\shref=["']([^"']+)["']/i)?.[1];
            if (!/\srel=["']?stylesheet/i.test(tag) || !href)
                continue;
            if (/^([a-z]+:)?\/\//i.test(href))
                shell(`외부 스타일시트 ${href}는 쓸 수 없습니다.`);
            const target = path.posix.normalize(path.posix.join('src', href));
            if (typeof files[target] !== 'string')
                shell(`index.html이 불러오는 ${target}이 없습니다.`);
        }
        // Load the page's scripts in order the way a browser would: shared globals, no require/module,
        // a permissive stand-in DOM and a working localStorage. Only an undefined name or a syntax error
        // counts; anything the stand-in DOM cannot model is not judged here.
        const anything = () => new Proxy(function () { }, {
            get: (_t, key) => key === Symbol.toPrimitive
                ? () => ''
                : key === 'then'
                    ? undefined
                    : key === 'length'
                        ? 0
                        : anything(),
            apply: () => anything(),
            construct: () => anything(),
            set: () => true,
        });
        const ready = [];
        const storage = () => {
            const data = new Map();
            return {
                getItem: (k) => (data.has(String(k)) ? data.get(String(k)) : null),
                setItem: (k, v) => void data.set(String(k), String(v)),
                removeItem: (k) => void data.delete(String(k)),
                clear: () => data.clear(),
                key: (i) => [...data.keys()][i] ?? null,
                get length() {
                    return data.size;
                },
            };
        };
        const listen = (type, fn) => {
            if (type === 'DOMContentLoaded' || type === 'load')
                ready.push(fn);
        };
        const documentStub = new Proxy({}, {
            get: (_t, key) => (key === 'addEventListener' ? listen : key === 'readyState' ? 'loading' : anything()),
        });
        const context = vm.createContext({
            console,
            setTimeout: () => 0,
            clearTimeout: () => { },
            setInterval: () => 0,
            clearInterval: () => { },
            requestAnimationFrame: () => 0,
            localStorage: storage(),
            sessionStorage: storage(),
            document: documentStub,
            navigator: anything(),
            location: anything(),
            history: anything(),
            alert: () => { },
            confirm: () => true,
            prompt: () => null,
            addEventListener: listen,
            removeEventListener: () => { },
            fetch: () => new Promise(() => { }),
        });
        context.window = context.self = context.globalThis = context;
        const browserError = (where, run) => {
            try {
                run();
            }
            catch (e) {
                const error = e;
                if (error?.name === 'ReferenceError' || error?.name === 'SyntaxError')
                    shell(`브라우저에서 ${where}을 실행하면 ${error.name}: ${error.message}`);
            }
        };
        for (const target of scripts)
            browserError(target, () => new vm.Script(String(files[target]), { filename: target }).runInContext(context, { timeout: 2000 }));
        for (const fn of ready)
            browserError('페이지 준비 처리', () => fn());
        const acceptance = 'tests/acceptance.test.cjs';
        if (!(acceptance in files)) {
            console.error('NO_ACCEPTANCE_TESTS: 등록된 검증 기준이 없습니다.');
            process.exit(2);
        }
        // Run the file directly: with --test an empty file is reported as one passing entry, while a
        // direct run prints "# tests N" only when test() calls actually executed.
        const accepted = run(['--test-reporter=tap', acceptance], 60000);
        // Per-test outcome of the acceptance check only (top-level TAP lines), on one marked line so it
        // is not confused with employee tests that run later.
        // Each failure keeps its first error line so a small model sees what to fix (v38: an element id
        // the check expects was missing, and the reason was buried in the log).
        const results = { passed: [], failed: [], reasons: {} };
        let current = '';
        for (const line of accepted.stdout.split('\n')) {
            const top = line.match(/^(ok|not ok) \d+ - (.+)$/);
            if (top) {
                const name = top[2].trim();
                (top[1] === 'ok' ? results.passed : results.failed).push(name);
                current = top[1] === 'ok' ? '' : name;
                continue;
            }
            if (!current)
                continue;
            // "Expected values to be strictly equal:" alone gives no clue; add the values (v40).
            const value = line.match(/^ {2}(expected|actual): (.+)$/);
            if (value && results.reasons[current] && !results.reasons[current].includes(', actual ')) {
                results.reasons[current] +=
                    value[1] === 'expected' ? ` (expected ${value[2]}` : `, actual ${value[2]})`;
                continue;
            }
            if (results.reasons[current])
                continue;
            const error = line.match(/^\s+error: (.*)$/);
            if (error && error[1] !== '|-')
                results.reasons[current] = error[1].replace(/^'|'$/g, '').slice(0, 200);
            else if (results.reasons[current] === undefined && /^\s{4}\S/.test(line) && !/^\s+\w+: /.test(line))
                results.reasons[current] = line.trim().slice(0, 200);
        }
        console.error('ACCEPTANCE_RESULTS ' + JSON.stringify(results));
        // A crash while loading the check (e.g. the code under test is missing) is a failure of the
        // change, not an empty check; only a clean run with zero tests is inconclusive.
        if (accepted.status !== 0) {
            // A failing test that passes when run alone depends on state left by earlier tests: the
            // check itself is defective, so the result is inconclusive rather than a failed change.
            // The check itself uses browser globals that Node does not have: a defect of the check.
            // TAP shows: error: 'X is not defined' / code / name: 'ReferenceError' / stack, whose first
            // frame is in the check file when the check (not the code under test) touched X.
            const global = accepted.stdout.match(/error: '(localStorage|sessionStorage|window|document) is not defined'\s*\n[^\n]*\n\s*name: 'ReferenceError'\s*\n\s*stack: \|-\s*\n[^\n]*acceptance\.test\.cjs/);
            if (global) {
                console.error(`ACCEPTANCE_BROWSER_GLOBAL: 검증 기준이 Node에 없는 ${global[1]}를 직접 씁니다. 시험 안에서 가짜 저장소를 만들어 함수에 넘기도록 검증 기준을 고쳐야 합니다.`);
                process.exit(2);
            }
            const failing = [...accepted.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
            const escape = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const alone = failing.filter((name) => {
                const r = cp.spawnSync(process.execPath, ['--test-reporter=tap', `--test-name-pattern=^${escape(name)}$`, acceptance], { encoding: 'utf8', timeout: 30000, maxBuffer: 1000000, env });
                return r.status === 0 && /^# pass [1-9]/m.test(String(r.stdout || ''));
            });
            // State can only carry over between tests through modules the check loads itself; pages
            // opened with the page helper start fresh. A page-only check that passes alone but fails in
            // sequence points at the change instead (v33: ids from Date.now() collided when two items
            // were added in the same millisecond, so deleting one removed both).
            const check = String(files[acceptance]);
            const sharesState = /require\(\s*['"]\.\.?\/(src|web)\//.test(check) || /^(let|var)\s/m.test(check);
            if (failing.length && alone.length === failing.length) {
                if (sharesState) {
                    console.error(`ACCEPTANCE_ORDER_DEPENDENT: 검증 기준의 시험이 앞 시험의 상태에 의존합니다(혼자 실행하면 통과: ${alone.join(', ')}). 각 시험이 시작할 때 상태를 초기화하도록 검증 기준을 고쳐야 합니다.`);
                    process.exit(2);
                }
                console.error(`TIMING_DEPENDENT: 혼자 실행하면 통과하지만 이어서 실행하면 실패합니다(${alone.join(', ')}). 화면 시험은 매번 새 페이지와 빈 저장소로 시작하므로 앱 코드가 실행 속도에 따라 다르게 동작하는지 확인하세요(예: Date.now()로 만든 ID가 겹침).`);
            }
            process.exit(1);
        }
        if (!/^# tests [1-9]/m.test(accepted.stdout)) {
            console.error('NO_ACCEPTANCE_ASSERTIONS: 검증 기준에 실행된 시험이 없습니다.');
            process.exit(2);
        }
        const others = Object.keys(files).filter((x) => x !== acceptance && x.startsWith('tests/') && /\.test\.(js|mjs|cjs)$/.test(x));
        if (others.length && run(['--test', ...others], 60000).status !== 0)
            process.exit(1);
        process.exit(0);
    });
}
exports.nodeWebVerifier = `(${nodeWebCheck.toString()})()`;
/** The follow-up work a review asks for, in the project's language (ADR 0062). */
const followUpText = {
    ko: {
        title: '수정 요청 · ',
        change: '수정안',
        next: '수정 후 새 후보를 제출하고 검증·승인을 별도로 진행하세요.',
    },
    en: {
        title: 'Changes requested · ',
        change: 'Change',
        next: 'After the fix, submit a new candidate and run verification and approval separately.',
    },
};
class ProjectChanges {
    root;
    store;
    verifierProfile;
    faults;
    language;
    pending = new Map();
    cancellations = new Map();
    constructor(root, store, verifierProfile = 'typescript', faults = {}, 
    /** The project's language (ADR 0062): records this class writes into the project use it. */
    language = 'ko') {
        this.root = root;
        this.store = store;
        this.verifierProfile = verifierProfile;
        this.faults = faults;
        this.language = language;
        store.db.exec('CREATE TABLE IF NOT EXISTS proposal_receipts(key TEXT PRIMARY KEY,hash TEXT NOT NULL,candidate_id TEXT NOT NULL);');
        store.db.exec('CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY,json TEXT NOT NULL);');
        // Per-run working copy: employees read and edit here; the project directory is untouched.
        store.db.exec('CREATE TABLE IF NOT EXISTS run_drafts(job_id TEXT NOT NULL,path TEXT NOT NULL,base_hash TEXT,content TEXT,PRIMARY KEY(job_id,path));');
        store.db.exec('CREATE TABLE IF NOT EXISTS candidate_revisions(id TEXT NOT NULL,version INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(id,version));');
        store.db.exec('CREATE TABLE IF NOT EXISTS project_checks(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,content TEXT NOT NULL); CREATE TABLE IF NOT EXISTS check_receipts(key TEXT PRIMARY KEY,hash TEXT NOT NULL,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS project_rules(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,content TEXT NOT NULL,checks TEXT NOT NULL); CREATE TABLE IF NOT EXISTS rule_receipts(key TEXT PRIMARY KEY,hash TEXT NOT NULL,json TEXT NOT NULL);');
        // Built-in automation (ADR 0058): settings, and which rejected candidate versions drafted a fix.
        store.db.exec('CREATE TABLE IF NOT EXISTS automation_settings(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS automation_runs(key TEXT PRIMARY KEY,work_id TEXT NOT NULL);');
        for (const candidate of this.all())
            store.db
                .prepare('INSERT OR IGNORE INTO candidate_revisions VALUES(?,?,?)')
                .run(candidate.id, candidate.version, JSON.stringify(candidate));
        for (const c of this.all())
            if (['VERIFYING', 'APPLYING'].includes(c.state)) {
                c.state = 'UNKNOWN';
                this.save(c);
            }
    }
    scope() {
        return (0, node_fs_1.existsSync)((0, node_path_1.resolve)(this.root, 'experiments/workspace-scope.json'))
            ? (0, workspace_js_1.readWorkspaceJson)((0, node_path_1.resolve)(this.root, 'experiments/workspace-scope.json'))
            : { schema_version: 1, include: ['src/**', 'web/**', 'tests/**', 'package.json'], exclude: [] };
    }
    checks() {
        const row = this.store.db.prepare('SELECT version,content FROM project_checks WHERE id=1').get();
        return {
            version: row ? Number(row.version) : 0,
            content: row ? String(row.content) : this.legacyChecks(),
            profile: this.verifierProfile,
        };
    }
    legacyChecks() {
        return this.verifierProfile === 'node-web' &&
            (0, node_fs_1.existsSync)((0, node_path_1.resolve)(this.root, '.aiorchestra/acceptance.test.cjs'))
            ? this.contents('.aiorchestra/acceptance.test.cjs')
            : '';
    }
    setChecks(content, version, key) {
        if (this.verifierProfile !== 'node-web')
            throw Error('UNSUPPORTED_PROFILE');
        if (typeof content !== 'string' || content.length > 24000 || !key)
            throw Error('INVALID_CHECKS');
        const request = (0, hash_js_1.hash)({ content, version }), prior = this.store.db.prepare('SELECT hash,json FROM check_receipts WHERE key=?').get(key);
        if (prior) {
            if (prior.hash !== request)
                throw Error('IDEMPOTENCY_CONFLICT');
            return JSON.parse(String(prior.json));
        }
        this.assertNotVerifying();
        const result = { version: version + 1, content, profile: this.verifierProfile };
        (0, sqlite_js_1.transaction)(this.store.db, () => {
            if (this.checks().version !== version)
                throw Error('VERSION_CONFLICT');
            this.store.db
                .prepare('INSERT INTO project_checks VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,content=excluded.content')
                .run(result.version, content);
            this.store.db
                .prepare('INSERT INTO check_receipts VALUES(?,?,?)')
                .run(key, request, JSON.stringify(result));
            this.requireReverification();
        });
        this.store.log(collaboration_js_1.owner, 'checks.update', 'project-checks', 'REVALIDATION_REQUIRED');
        return result;
    }
    /** Project rules (ADR 0052): version 0 means none registered yet; the default checks still apply. */
    rules() {
        const row = this.store.db.prepare('SELECT version,content,checks FROM project_rules WHERE id=1').get();
        return row
            ? {
                version: Number(row.version),
                content: String(row.content),
                // Unedited copies of earlier defaults (e.g. the unbounded sk- key pattern) read as today's.
                checks: (0, project_rules_js_1.upgradeRuleChecks)(JSON.parse(String(row.checks))),
            }
            : { version: 0, content: '', checks: (0, project_rules_js_1.defaultRuleChecksIn)(this.language) };
    }
    setRules(content, checks, version, key) {
        if (typeof content !== 'string' || content.length > project_rules_js_1.ruleLimits.content || !key)
            throw Error('INVALID_RULES');
        const valid = (0, project_rules_js_1.validateRuleChecks)(checks);
        const request = (0, hash_js_1.hash)({ content, checks: valid, version }), prior = this.store.db.prepare('SELECT hash,json FROM rule_receipts WHERE key=?').get(key);
        if (prior) {
            if (prior.hash !== request)
                throw Error('IDEMPOTENCY_CONFLICT');
            return JSON.parse(String(prior.json));
        }
        this.assertNotVerifying();
        const result = { version: version + 1, content, checks: valid };
        (0, sqlite_js_1.transaction)(this.store.db, () => {
            if (this.rules().version !== version)
                throw Error('VERSION_CONFLICT');
            this.store.db
                .prepare('INSERT INTO project_rules VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,content=excluded.content,checks=excluded.checks')
                .run(result.version, content, JSON.stringify(valid));
            this.store.db
                .prepare('INSERT INTO rule_receipts VALUES(?,?,?)')
                .run(key, request, JSON.stringify(result));
            this.requireReverification();
        });
        this.store.log(collaboration_js_1.owner, 'rules.update', 'project-rules', 'REVALIDATION_REQUIRED');
        return result;
    }
    /** Checks and rules may not change under a verification or apply that is using them. */
    assertNotVerifying() {
        if (this.pending.size || this.all().some((c) => c.state === 'APPLYING'))
            throw Error('VERIFICATION_BUSY');
    }
    /** Different checks judge differently: verified or approved candidates must be verified again. */
    requireReverification() {
        for (const c of this.all().filter((c) => ['VERIFIED', 'APPROVED'].includes(c.state))) {
            c.state = 'PROPOSED';
            c.evidence = null;
            c.approval = null;
            this.save(c);
        }
    }
    verificationInputHash() {
        return (0, hash_js_1.hash)({
            profile: this.verifierProfile,
            ruleChecks: this.rules().checks,
            acceptance: this.verifierProfile === 'node-web' ? this.checks() : null,
            // A changed verifier or page helper judges differently, so earlier evidence no longer holds.
            verifier: this.verifierProfile === 'node-web' ? (0, hash_js_1.hash)([exports.nodeWebVerifier, page_helper_js_1.pageHelperSource]) : verifierScript,
        });
    }
    snapshot() {
        return (0, workspace_js_1.captureWorkspace)(this.root, this.scope());
    }
    allowed(path, actor, newFile = false) {
        if (!(0, task_js_1.safeRelativePath)(path) || (0, workspace_js_2.protectedPath)(path))
            throw Error('PATH_DENIED');
        if (actor.kind === 'client')
            throw Error('ACCESS_DENIED');
        if (actor.kind === 'employee' &&
            !(0, collaboration_js_1.strings)(this.store.get(actor.id).data, 'scope').some((p) => (0, task_js_1.pathMatches)(path, p)))
            throw Error('PATH_DENIED');
        if (!(0, workspace_js_2.selectedPath)((0, workspace_js_2.parseScope)(this.scope()), path))
            throw Error('PATH_NOT_TRACKED');
        if (!newFile && !this.snapshot().files.some((f) => f.path === path))
            throw Error('PATH_NOT_TRACKED');
        this.checkAncestors(path);
    }
    checkAncestors(path) {
        const base = (0, node_fs_1.realpathSync)(this.root);
        if ((0, node_fs_1.lstatSync)(this.root).isSymbolicLink())
            throw Error('PATH_DENIED');
        let cursor = base;
        for (const part of path.split('/')) {
            cursor = (0, node_path_1.resolve)(cursor, part);
            if ((0, node_fs_1.existsSync)(cursor)) {
                const stat = (0, node_fs_1.lstatSync)(cursor);
                if (stat.isSymbolicLink() || (0, node_path_1.relative)(base, (0, node_fs_1.realpathSync)(cursor)).startsWith('..'))
                    throw Error('PATH_DENIED');
            }
        }
    }
    bytes(path) {
        this.checkAncestors(path);
        const full = (0, node_path_1.resolve)((0, node_fs_1.realpathSync)(this.root), path), stat = (0, node_fs_1.lstatSync)(full);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 10000000)
            throw Error('FILE_DENIED');
        const fd = (0, node_fs_1.openSync)(full, 'r');
        try {
            const a = (0, node_fs_1.fstatSync)(fd);
            if (a.ino !== stat.ino || a.dev !== stat.dev)
                throw Error('SOURCE_CHANGED');
            const buffer = Buffer.alloc(a.size);
            let offset = 0;
            while (offset < buffer.length) {
                const n = (0, node_fs_1.readSync)(fd, buffer, offset, buffer.length - offset, null);
                if (!n)
                    throw Error('SOURCE_CHANGED');
                offset += n;
            }
            const b = (0, node_fs_1.fstatSync)(fd);
            if (a.mtimeMs !== b.mtimeMs || a.ctimeMs !== b.ctimeMs)
                throw Error('SOURCE_CHANGED');
            return buffer;
        }
        finally {
            (0, node_fs_1.closeSync)(fd);
        }
    }
    contents(path) {
        return this.bytes(path).toString('utf8');
    }
    fileEdits(c) {
        return c.files ?? [{ path: c.path, before: c.before, beforeHash: c.beforeHash, content: c.content }];
    }
    currentHash(path) {
        this.checkAncestors(path);
        return (0, node_fs_1.existsSync)((0, node_path_1.resolve)(this.root, path)) ? (0, hash_js_1.sha256)(this.bytes(path)) : null;
    }
    list(actor) {
        return this.snapshot()
            .files.filter((f) => actor.kind === 'owner' ||
            (actor.kind === 'employee' &&
                (0, collaboration_js_1.strings)(this.store.get(actor.id).data, 'scope').some((p) => (0, task_js_1.pathMatches)(f.path, p))))
            .map((f) => ({ path: f.path, hash: f.sha256, bytes: f.bytes }));
    }
    read(path, actor) {
        this.allowed(path, actor);
        const content = this.contents(path);
        return {
            path,
            content: content.slice(0, 18000),
            truncated: content.length > 18000,
            hash: (0, hash_js_1.sha256)(content),
        };
    }
    search(input, actor) {
        if (actor.kind === 'client')
            throw Error('ACCESS_DENIED');
        if (actor.kind === 'employee')
            this.store.allowTool(actor, 'project.search');
        const query = (0, collaboration_js_1.string)(input, 'query'), prefix = (0, collaboration_js_1.string)(input, 'prefix').replace(/\/$/, '');
        if (!query.trim() ||
            query.length > 200 ||
            /[\r\n\0]/.test(query) ||
            (prefix && !(0, task_js_1.safeRelativePath)(prefix)) ||
            (input.prefix !== undefined && typeof input.prefix !== 'string') ||
            (input.caseSensitive !== undefined && typeof input.caseSensitive !== 'boolean'))
            throw Error('INVALID_SEARCH');
        const files = this.list(actor).filter((f) => !prefix || f.path === prefix || f.path.startsWith(prefix + '/'));
        const results = [], skipped = [];
        let scanned = 0, bytes = 0, partial = false;
        const matcher = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), input.caseSensitive ? 'u' : 'iu');
        for (const file of files) {
            if (scanned + skipped.length >= 500) {
                partial = true;
                break;
            }
            if (file.bytes > 256 * 1024) {
                skipped.push({ path: file.path, reason: 'FILE_TOO_LARGE' });
                continue;
            }
            if (bytes + file.bytes > 2 * 1024 * 1024) {
                partial = true;
                break;
            }
            this.allowed(file.path, actor, true);
            const buffer = this.bytes(file.path);
            bytes += buffer.length;
            if ((0, hash_js_1.sha256)(buffer) !== file.hash)
                throw Error('SOURCE_CHANGED');
            let text;
            try {
                text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
                if (text.includes('\0'))
                    throw Error('BINARY');
            }
            catch {
                skipped.push({ path: file.path, reason: 'BINARY_FILE' });
                continue;
            }
            scanned++;
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].replace(/\r$/, ''), column = matcher.exec(line)?.index ?? -1;
                if (column < 0)
                    continue;
                const start = Math.max(0, column - 60), end = Math.min(line.length, column + query.length + 100);
                results.push({
                    path: file.path,
                    line: i + 1,
                    column: column + 1,
                    snippet: (start ? '…' : '') + line.slice(start, end) + (end < line.length ? '…' : ''),
                    hash: file.hash,
                });
                if (results.length >= 100) {
                    partial = true;
                    break;
                }
            }
            if (results.length >= 100)
                break;
        }
        return {
            query,
            results,
            scanned,
            bytes,
            skipped,
            partial: partial || skipped.length > 0,
            eligibleFiles: files.length,
        };
    }
    editable(path, actor, newFile = false) {
        if (newFile) {
            this.allowed(path, actor, true);
            if (!editablePath(path))
                throw Error('PROTECTED_CHANGE');
            if (this.currentHash(path) !== null)
                throw Error('SOURCE_CHANGED');
            return { path, content: '', hash: null, newFile: true, maxLength: 24000 };
        }
        this.allowed(path, actor);
        if (!editablePath(path))
            throw Error('PROTECTED_CHANGE');
        const bytes = this.bytes(path);
        let content;
        try {
            content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        }
        catch {
            throw Error('BINARY_FILE');
        }
        if (content.includes('\0'))
            throw Error('BINARY_FILE');
        if (content.length > 24000)
            throw Error('CANDIDATE_TOO_LARGE');
        return { path, content, hash: (0, hash_js_1.sha256)(bytes), maxLength: 24000 };
    }
    propose(data, actor, room, job, command) {
        this.store.read(room.id, actor);
        if (actor.kind === 'employee')
            this.store.allowTool(actor, 'change.propose');
        if (room.kind !== 'room')
            throw Error('INVALID_REFERENCE');
        let receipt;
        if (command) {
            (0, command_js_1.assertCommand)(command, { actor: actor.id, project: this.store.project, version: 0 });
            receipt = {
                key: (0, hash_js_1.hash)([actor.id, this.store.project, command.idempotency_key]),
                hash: (0, hash_js_1.hash)({ data, roomId: room.id }),
            };
            const prior = this.store.db
                .prepare('SELECT hash,candidate_id FROM proposal_receipts WHERE key=?')
                .get(receipt.key);
            if (prior) {
                if (prior.hash !== receipt.hash)
                    throw Error('IDEMPOTENCY_CONFLICT');
                return this.get(String(prior.candidate_id));
            }
        }
        const inputs = Array.isArray(data.files) ? data.files : [data];
        if (!inputs.length || inputs.length > 20)
            throw Error('INVALID_CHANGE_SET');
        const names = new Set();
        let total = 0;
        const files = inputs.map((raw) => {
            if (!raw || typeof raw !== 'object')
                throw Error('INVALID_CHANGE_SET');
            const f = raw, path = (0, collaboration_js_1.string)(f, 'path');
            this.allowed(path, actor, true);
            if (!editablePath(path))
                throw Error('PROTECTED_CHANGE');
            if (names.has(path.toLowerCase()))
                throw Error('DUPLICATE_PATH');
            names.add(path.toLowerCase());
            if (f.content !== null && typeof f.content !== 'string')
                throw Error('INVALID_CHANGE_SET');
            const content = f.content;
            total += content?.length ?? 0;
            if ((content?.length ?? 0) > 24000 || total > 80000)
                throw Error('CANDIDATE_TOO_LARGE');
            const beforeHash = this.currentHash(path);
            if (beforeHash !== f.beforeHash)
                throw Error('SOURCE_CHANGED');
            const before = beforeHash === null ? null : this.contents(path);
            if (before === content)
                throw Error('NO_CHANGE');
            return { path, before, beforeHash, content };
        });
        const first = files[0];
        const c = {
            id: (0, node_crypto_1.randomUUID)(),
            version: 0,
            title: (0, collaboration_js_1.string)(data, 'title') || first.path,
            path: first.path,
            before: first.before ?? '',
            beforeHash: first.beforeHash ?? '',
            content: first.content ?? '',
            files,
            hash: (0, hash_js_1.hash)(files),
            baseSnapshot: this.snapshot().snapshot_hash,
            actor: actor.id,
            roomId: room.id,
            workId: (0, collaboration_js_1.string)(data, 'workId'),
            state: 'PROPOSED',
            evidence: null,
            approval: null,
            createdAt: new Date().toISOString(),
        };
        if (command)
            c.proposalCommand = { ...command };
        // One run, one candidate: resubmitting before verification revises it (history keeps each version).
        if (job) {
            c.jobId = job.id;
            const prior = this.all().find((p) => p.jobId === job.id && p.actor === actor.id && p.state === 'PROPOSED');
            if (prior)
                Object.assign(c, { id: prior.id, version: prior.version, createdAt: prior.createdAt });
        }
        if (actor.kind === 'employee')
            c.employeeVersion = this.store.get(actor.id).version;
        if (c.workId && this.store.read(c.workId, actor).kind !== 'work')
            throw Error('INVALID_REFERENCE');
        this.save(c, receipt);
        this.store.log(actor, 'change.propose', c.id, 'SUCCEEDED');
        return c;
    }
    draft(jobId, path) {
        const row = this.store.db
            .prepare('SELECT base_hash,content FROM run_drafts WHERE job_id=? AND path=?')
            .get(jobId, path);
        return row
            ? {
                baseHash: row.base_hash === null ? null : String(row.base_hash),
                content: row.content,
            }
            : undefined;
    }
    saveDraft(jobId, path, baseHash, content) {
        if (content !== null && content.length > text_edit_js_1.textEditLimits.contentCharacters)
            throw Error('CANDIDATE_TOO_LARGE');
        if (content !== null && (0, text_edit_js_1.containsElision)(content))
            throw Error('ELIDED_CONTENT');
        const files = this.store.db.prepare('SELECT path FROM run_drafts WHERE job_id=?').all(jobId);
        if (!files.some((f) => f.path === path) && files.length >= 20)
            throw Error('INVALID_CHANGE_SET');
        this.store.db
            .prepare('INSERT INTO run_drafts VALUES(?,?,?,?) ON CONFLICT(job_id,path) DO UPDATE SET content=excluded.content')
            .run(jobId, path, baseHash, content);
    }
    draftFiles(jobId) {
        return this.store.db
            .prepare('SELECT path,base_hash,content FROM run_drafts WHERE job_id=? ORDER BY path')
            .all(jobId)
            .map((row) => ({
            path: String(row.path),
            beforeHash: row.base_hash === null ? null : String(row.base_hash),
            content: row.content,
        }));
    }
    newestFor(workId) {
        return this.all()
            .filter((c) => c.workId === workId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .at(-1);
    }
    bestCandidateFor(workId) {
        const tried = this.all().filter((c) => c.workId === workId && c.evidence?.tests);
        // Once the work's newest result is applied there is nothing of its own left to build on.
        const newest = this.newestFor(workId);
        if (!newest || ['APPLIED', 'APPLYING'].includes(newest.state))
            return undefined;
        return tried
            .filter((c) => !['APPLIED', 'APPLYING'].includes(c.state))
            .sort((a, b) => a.evidence.tests.passed.length - b.evidence.tests.passed.length ||
            a.createdAt.localeCompare(b.createdAt))
            .at(-1)?.id;
    }
    candidateTests(candidateId) {
        return this.all().find((c) => c.id === candidateId)?.evidence?.tests;
    }
    /** What a work's newest candidate did, for the next work's handoff (ADR 0053). Applied ones count. */
    newestCandidateSummary(workId) {
        const c = this.newestFor(workId);
        if (!c)
            return undefined;
        return {
            title: c.title,
            state: c.state,
            files: this.fileEdits(c).map((f) => f.path),
            tests: c.evidence?.tests
                ? { passed: c.evidence.tests.passed, failed: c.evidence.tests.failed }
                : undefined,
        };
    }
    /** The newest unapplied candidate made for any of these work items (ADR 0045). */
    latestCandidateFor(workIds) {
        if (!workIds.length)
            return undefined;
        // Only each work's newest candidate counts. If that one is applied, the work's result is on
        // disk already; an older unapplied attempt of the same work must not be picked up instead, or a
        // fix run would start from a rejected first attempt whose good successor was applied.
        const newest = new Map();
        for (const c of this.all())
            if (workIds.includes(c.workId) &&
                (!newest.has(c.workId) || newest.get(c.workId).createdAt < c.createdAt))
                newest.set(c.workId, c);
        return [...newest.values()]
            .filter((c) => !['APPLIED', 'APPLYING'].includes(c.state))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .at(-1)?.id;
    }
    /**
     * Loads a candidate's files into a run's draft so a fix request continues from it. Each file keeps
     * the candidate's base hash, so submitting still fails with SOURCE_CHANGED if disk moved since.
     * Idempotent: a run that already has a draft (e.g. after restart) is left as it is.
     */
    seedDraft(jobId, candidateId, actor, room) {
        const c = this.get(candidateId);
        // Same visibility rule as change.read: the candidate must belong to a room this run can use.
        if (actor.kind === 'client' || c.roomId !== room.id)
            throw Error('ACCESS_DENIED');
        const files = this.fileEdits(c);
        if (!this.draftFiles(jobId).length)
            for (const f of files) {
                this.allowed(f.path, actor, true);
                if (!editablePath(f.path))
                    throw Error('PROTECTED_CHANGE');
                this.saveDraft(jobId, f.path, f.beforeHash, f.content);
            }
        // Without the reason it failed, a fix run can only guess; the verifier's log excerpt goes along.
        const failure = c.evidence && c.evidence.status !== 'PASS' ? logExcerpt(c.evidence.log, 1500) : undefined;
        // The owner's open line comments say what to change where; the fix run sees them (ADR 0057).
        const comments = (0, change_review_js_1.lineCommentText)((0, change_review_js_1.openLineComments)(c), this.language);
        return {
            title: c.title,
            files: files.map((f) => f.path),
            ...(failure ? { failure } : {}),
            ...(comments ? { comments } : {}),
        };
    }
    /** Paged read through the run's draft when one exists, otherwise from the project directory. */
    readPage(input, actor, jobId) {
        const path = (0, collaboration_js_1.string)(input, 'path'), offset = input.offset === undefined ? 0 : input.offset, limit = input.limit === undefined ? text_edit_js_1.textEditLimits.readLines : input.limit;
        // The approved acceptance check lives in the database, not on disk; employees may read it.
        if (path === acceptancePath && this.checks().content) {
            if (actor.kind === 'client')
                throw Error('ACCESS_DENIED');
            return { path, draft: false, readOnly: true, ...(0, text_edit_js_1.readLines)(this.checks().content, offset, limit) };
        }
        const draft = this.draft(jobId, path);
        if (draft) {
            this.allowed(path, actor, true);
            if (draft.content === null)
                throw Error('FILE_DELETED_IN_DRAFT');
            return { path, draft: true, ...(0, text_edit_js_1.readLines)(draft.content, offset, limit) };
        }
        this.allowed(path, actor);
        const content = this.contents(path);
        return {
            path,
            draft: false,
            hash: (0, hash_js_1.sha256)(content),
            ...(0, text_edit_js_1.readLines)(content, offset, limit),
        };
    }
    /** Exact-match edits on the run's draft of a file; the first touch records the file's base hash. */
    editDraft(input, actor, jobId) {
        if (actor.kind === 'employee')
            this.store.allowTool(actor, 'change.edit');
        const path = (0, collaboration_js_1.string)(input, 'path');
        const draft = this.draft(jobId, path);
        let base, baseHash;
        if (draft) {
            this.allowed(path, actor, true);
            if (!editablePath(path))
                throw Error('PROTECTED_CHANGE');
            if (draft.content === null)
                throw Error('FILE_DELETED_IN_DRAFT');
            base = draft.content;
            baseHash = draft.baseHash;
        }
        else {
            // A file that exists only in a submitted candidate is gone from the draft after submission.
            if ((0, task_js_1.safeRelativePath)(path) && this.currentHash(path) === null)
                throw Error('NOT_IN_DRAFT');
            const file = this.editable(path, actor);
            base = file.content;
            baseHash = file.hash;
        }
        const content = (0, text_edit_js_1.applyEdits)(base, input.edits);
        this.saveDraft(jobId, path, baseHash, content);
        return { path, draft: true, totalLines: (0, text_edit_js_1.readLines)(content, 0, 1).totalLines, characters: content.length };
    }
    /** Create, replace or (content: null) delete a file in the run's draft. */
    writeDraft(input, actor, jobId) {
        if (actor.kind === 'employee')
            this.store.allowTool(actor, 'change.write');
        const path = (0, collaboration_js_1.string)(input, 'path');
        if (input.content !== null && typeof input.content !== 'string')
            throw Error('INVALID_CHANGE_SET');
        const content = input.content;
        const draft = this.draft(jobId, path);
        this.allowed(path, actor, true);
        if (!editablePath(path))
            throw Error('PROTECTED_CHANGE');
        const baseHash = draft ? draft.baseHash : this.currentHash(path);
        if (content === null && baseHash === null)
            throw Error('NO_CHANGE');
        this.saveDraft(jobId, path, baseHash, content);
        return { path, draft: true, deleted: content === null, characters: content?.length ?? 0 };
    }
    /** Submits the run's whole draft as one candidate through the normal proposal path, then clears it. */
    proposeDraft(data, actor, room, jobId, baseCandidateId, checkSyntax = true) {
        const files = this.draftFiles(jobId);
        if (!files.length)
            throw Error('NO_DRAFT');
        // A syntax error would only come back from verification much later; the run can fix it now.
        // Parsed, never executed. Skipped for the end-of-run auto-submit so its work is not lost.
        if (checkSyntax && this.verifierProfile === 'node-web')
            for (const f of files)
                if (f.content !== null && /\.(js|cjs)$/.test(f.path))
                    try {
                        // src/ files are page scripts the browser loads as classic scripts, where a top-level
                        // return is a syntax error; wrapping them as CommonJS would hide it. Tests stay CommonJS.
                        new node_vm_1.Script(f.path.startsWith('src/')
                            ? f.content
                            : `(function (exports, require, module, __filename, __dirname) {${f.content}\n})`, { filename: f.path });
                    }
                    catch (e) {
                        const where = String(e.stack ?? '').split('\n')[0];
                        throw new collaboration_js_1.ToolError('DRAFT_SYNTAX_ERROR', `${where} ${e.message}`);
                    }
        // A fix run that resubmits the earlier attempt untouched would only repeat the same failure.
        if (baseCandidateId) {
            const base = new Map(this.fileEdits(this.get(baseCandidateId)).map((f) => [f.path, f.content]));
            if (files.length === base.size && files.every((f) => base.get(f.path) === f.content))
                throw Error('NO_CHANGE_FROM_BASE');
        }
        const candidate = this.propose({ ...data, files }, actor, room, { id: jobId });
        this.store.db.prepare('DELETE FROM run_drafts WHERE job_id=?').run(jobId);
        return candidate;
    }
    /** Runs the registered project check on disk + draft. Advisory only: it never verifies a candidate. */
    async checkDraft(actor, jobId, baseCandidateId, criteria = [], kept = []) {
        if (actor.kind === 'employee')
            this.store.allowTool(actor, 'check.run');
        let image;
        try {
            image = this.verifierImage();
        }
        catch {
            throw Error('CHECK_UNAVAILABLE');
        }
        const edits = this.draftFiles(jobId).map((f) => ({ ...f, before: null }));
        const outcome = await this.runVerifier(image, this.verificationFiles(edits), 'check:' + jobId);
        const scan = await (0, rule_scan_js_1.scanRulesIsolated)(edits, this.rules().checks, { language: this.language });
        const rules = scan.status === 'DONE' ? scan.violations : [];
        if (rules.length)
            outcome.status = 'FAIL';
        // A rule check that could not finish is unknown: it never lets a passing check stand.
        else if (scan.status === 'INCONCLUSIVE' && outcome.status === 'PASS')
            outcome.status = 'INCONCLUSIVE';
        this.store.log(actor, 'check.run', jobId, outcome.status);
        const tests = acceptanceResults(outcome.log);
        // A fix run must not break what the earlier attempt already passed; name those tests first.
        const before = baseCandidateId
            ? this.all().find((c) => c.id === baseCandidateId)?.evidence?.tests
            : undefined;
        // What the base passed, plus what finished predecessor work must keep passing.
        const regressed = [
            ...new Set([
                ...regressedTests(before, tests),
                ...(tests ? kept.filter((n) => !tests.passed.includes(n)) : []),
            ]),
        ];
        return {
            status: outcome.status,
            draftFiles: edits.length,
            ...(tests ? { passed: tests.passed, failed: tests.failed } : {}),
            // A work item's own criteria first: the rest of the check may still fail by design.
            ...(criteria.length && tests
                ? {
                    target: {
                        criteria,
                        passed: criteria.filter((name) => tests.passed.includes(name)),
                        failed: criteria
                            .filter((name) => !tests.passed.includes(name))
                            .map((name) => (tests.reasons?.[name] ? `${name}: ${tests.reasons[name]}` : name)),
                    },
                }
                : {}),
            ...(regressed.length
                ? {
                    regressed,
                    note: '이전 수정안에서 통과하던 시험이 깨졌습니다. 다른 수정보다 이 시험을 먼저 되살리세요.',
                }
                : {}),
            ...(rules.length
                ? {
                    rules: rules.map((v) => `${v.path}:${v.line} ${v.message} (${v.excerpt})`),
                    rulesNote: '프로젝트 규칙 위반입니다. 이 줄을 고치기 전에는 검증을 통과할 수 없습니다.',
                }
                : scan.status === 'INCONCLUSIVE'
                    ? { rulesNote: scan.reason }
                    : {}),
            log: logExcerpt(outcome.log.replace(/^ACCEPTANCE_RESULTS .*$/m, '')),
        };
    }
    /** What check.run and verification actually execute, so employees write tests that can run there. */
    checkEnvironment() {
        return this.verifierProfile === 'node-web'
            ? '검사 환경: Node 22 컨테이너, 네트워크 없음, npm 패키지 없음(jsdom·jest·mocha 없음, 화면 시험 도우미 aiorchestra-page만 있음). 먼저 앱 기본 검사를 합니다: src/index.html이 있어야 하고, 거기서 <script src>로 부르는 파일이 모두 있어야 하며, 그 파일이 module.exports를 쓰면 typeof module 검사로 감싸야 합니다. 페이지 스크립트는 브라우저처럼 순서대로 실행해 보므로 require·import·export를 쓰면 실패입니다(앞 스크립트가 window에 올린 이름을 쓰세요). <link rel="stylesheet">로 부르는 파일도 있어야 합니다. src/의 .js 파일은 node --check로 문법 검사하고, 사용자가 승인한 검증 기준(tests/acceptance.test.cjs, 수정 불가)이 있어야 통과할 수 있고, 없으면 판정 불가입니다. 직원이 쓴 tests/의 *.test.js·*.test.cjs·*.test.mjs도 node --test로 함께 실행되며 하나라도 실패하면 실패입니다. 시험은 require("node:test")와 require("node:assert/strict")만 쓰고, describe/it/expect는 node:test의 test와 assert로 쓰세요. 검증 기준은 require("aiorchestra-page")의 openPage()로 src/index.html을 열어 입력·클릭·새로고침을 흉내 내므로, 검증 기준에 적힌 선택자(id)의 화면 요소를 index.html에 만들고 app.js가 실제로 동작해야 합니다. 상태 변경·저장·문자열 처리는 src/의 순수 함수 파일로 나누고 module.exports로 내보낸 뒤 시험에서 require하세요. 브라우저에서는 같은 파일을 <script>로 불러 쓰도록 typeof module 검사로 감싸세요. 예: src/todo.js 끝에 if (typeof module !== "undefined") module.exports = {addTodo}; else window.Todo = {addTodo}; 를 두고, src/index.html은 <script src="todo.js"></script> 다음에 <script src="app.js"></script>를 둡니다. src/app.js는 require 없이 Todo.addTodo(...)처럼 window의 이름을 씁니다. 시험은 require("../src/todo.js")로 같은 함수를 부릅니다.'
            : '검사 환경: Node 22 컨테이너, 네트워크 없음. tsc -p tsconfig.json으로 빌드한 뒤 dist/tests의 *.test.js를 node --test로 실행합니다. 새 npm 패키지는 쓸 수 없습니다.';
    }
    /**
     * Runs a registered external engine on a copy of the tracked text files, then imports its changes
     * into this run's draft and submits them as one candidate. Paths outside the editable set are
     * reported, not applied. The project directory itself is never written here.
     */
    async runEngine(input) {
        const { actor, jobId } = input;
        // A planning run (ADR 0071) changes records through the app's tools, never files.
        if (actor.kind === 'employee' && !input.plan)
            this.store.allowTool(actor, 'change.propose');
        const files = {};
        for (const f of this.snapshot().files) {
            try {
                const text = new TextDecoder('utf-8', { fatal: true }).decode(this.bytes(f.path));
                if (!text.includes(String.fromCharCode(0)))
                    files[f.path] = text;
            }
            catch {
                // Binary files are not offered to the engine; they cannot be edited through drafts either.
            }
        }
        // A fix or continuation run starts from its seeded draft (the base candidate), not from disk.
        // Each engine run is a fresh CLI session: the copy is a new folder every time (ADR 0065).
        for (const d of this.draftFiles(jobId)) {
            if (d.content === null)
                delete files[d.path];
            else
                files[d.path] = d.content;
        }
        const result = await (0, workspace_engine_js_1.runWorkspaceEngine)(input.engine, files, input.prompt, input.signal, input.options, input.mcp);
        const applied = [], skipped = [];
        for (const change of input.plan ? [] : result.changes) {
            try {
                this.writeDraft({ path: change.path, content: change.content }, actor, jobId);
                applied.push(change.path);
            }
            catch (error) {
                skipped.push({ path: change.path, error: error instanceof Error ? error.message : 'FAILED' });
            }
        }
        const candidate = applied.length
            ? this.proposeDraft({ title: input.title, ...(input.workId ? { workId: input.workId } : {}) }, actor, input.room, jobId)
            : null;
        this.store.log(actor, 'engine.run', jobId, input.plan ? 'PLANNED' : candidate ? 'PROPOSED' : 'NO_CHANGE');
        return {
            ...(input.plan ? { discarded: result.changes.length } : {}),
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            canceled: result.canceled,
            startedAt: result.startedAt,
            durationMs: result.durationMs,
            ...(result.model ? { model: result.model } : {}),
            ...(result.effort ? { effort: result.effort } : {}),
            usage: result.usage,
            output: result.output.slice(-4000),
            applied,
            skipped,
            candidateId: candidate?.id ?? null,
        };
    }
    cancelCheck(jobId) {
        this.cancellations.get('check:' + jobId)?.();
    }
    all() {
        return this.store.db
            .prepare('SELECT json FROM candidates ORDER BY rowid DESC')
            .all()
            .map((r) => JSON.parse(String(r.json)));
    }
    view() {
        return this.all().map((candidate) => ({ ...candidate, reviewBlocked: (0, change_review_js_1.reviewBlocked)(candidate) }));
    }
    readCandidate(input, actor, destination) {
        if (actor.kind === 'client')
            throw Error('ACCESS_DENIED');
        if (actor.kind === 'employee')
            this.store.allowTool(actor, 'change.read');
        const c = this.get((0, collaboration_js_1.string)(input, 'id')), source = this.store.read(c.roomId, actor);
        this.store.read(destination.id, actor);
        if (destination.kind !== 'room' || destination.audience.some((a) => !source.audience.includes(a)))
            throw Error('SOURCE_AUDIENCE_CONFLICT');
        const files = this.fileEdits(c);
        for (const file of files)
            this.allowed(file.path, actor, true);
        if (input.hash !== undefined && input.hash !== c.hash)
            throw Error('SOURCE_CHANGED');
        const file = files.find((f) => f.path === (input.path ?? files[0].path));
        if (!file)
            throw Error('PATH_DENIED');
        const offset = input.offset ?? 0;
        if (!Number.isSafeInteger(offset) || Number(offset) < 0 || Number(offset) > (file.content?.length ?? 0))
            throw Error('INVALID_PAGE');
        const content = file.content?.slice(Number(offset), Number(offset) + 2000) ?? null;
        return {
            id: c.id,
            version: c.version,
            hash: c.hash,
            state: c.state,
            title: c.title,
            reviewBlocked: (0, change_review_js_1.reviewBlocked)(c),
            files: files.map((f) => ({
                path: f.path,
                beforeHash: f.beforeHash,
                deleted: f.content === null,
                length: f.content?.length ?? 0,
            })),
            path: file.path,
            offset,
            content,
            next: Number(offset) + 2000 < (file.content?.length ?? 0) ? Number(offset) + 2000 : null,
            reviews: (c.reviews ?? []).slice(-5).map((r) => ({
                verdict: r.verdict,
                body: r.body.slice(0, 500),
                truncated: r.body.length > 500,
                workId: r.workId,
                ...(r.path ? { path: r.path, line: r.line, resolved: !!r.resolvedAt } : {}),
            })),
            openLineComments: (0, change_review_js_1.openLineComments)(c).slice(0, 20),
        };
    }
    get(id) {
        const c = this.all().find((c) => c.id === id);
        if (!c)
            throw Error('CANDIDATE_NOT_FOUND');
        return c;
    }
    review(id, candidateHash, input, command) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.store.project, minVersion: 1 });
        if (!input || typeof input !== 'object' || Array.isArray(input))
            throw Error('INVALID_REVIEW');
        const value = (0, change_review_js_1.validateReview)(input.verdict, input.body);
        if (input.createWork !== undefined && typeof input.createWork !== 'boolean')
            throw Error('INVALID_REVIEW');
        const key = (0, hash_js_1.hash)(['change-review', this.store.project, command.idempotency_key]), fingerprint = (0, hash_js_1.hash)([id, candidateHash, input, command.expected_version]);
        return this.store.idempotent(key, fingerprint, () => {
            const c = this.get(id);
            if (c.version !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            if (c.hash !== candidateHash)
                throw Error('SOURCE_CHANGED');
            if (['VERIFYING', 'APPLYING', 'UNKNOWN'].includes(c.state))
                throw Error('INVALID_CHANGE_STATE');
            if ((c.reviews?.length ?? 0) >= 100)
                throw Error('REVIEW_LIMIT');
            const anchor = (0, change_review_js_1.validateLineAnchor)(input.path, input.line, this.fileEdits(c));
            const note = {
                id: (0, node_crypto_1.randomUUID)(),
                actor: collaboration_js_1.owner.id,
                candidateHash,
                createdAt: new Date().toISOString(),
                ...value,
                ...(anchor ?? {}),
            };
            // One follow-up work carries every open line comment, not just this note (ADR 0057).
            const lineComments = (0, change_review_js_1.lineCommentText)((0, change_review_js_1.openLineComments)({ ...c, reviews: [...(c.reviews ?? []), note] }), this.language);
            const words = followUpText[this.language];
            if (input.createWork) {
                const room = this.store.read(c.roomId, collaboration_js_1.owner), source = c.workId ? this.store.read(c.workId, collaboration_js_1.owner) : null;
                const work = this.store.put('work', null, {
                    title: (words.title + c.title).slice(0, 120),
                    goal: (`${words.change} ${c.id} · hash ${c.hash}\n\n` +
                        value.body +
                        (lineComments ? `\n\n${change_review_js_1.lineCommentWords[this.language].heading}\n` + lineComments : '') +
                        `\n\n${words.next}`).slice(0, 12000),
                    status: 'BACKLOG',
                    roomId: room.id,
                    dependencies: [],
                    artifactIds: [],
                    sourceIds: source ? [source.id] : [],
                }, room.audience, collaboration_js_1.owner, { ...command, expected_version: 0, idempotency_key: (0, hash_js_1.hash)([key, 'work']) });
                note.workId = work.id;
            }
            c.reviews = [...(c.reviews ?? []), note];
            if (value.verdict === 'CHANGES' && c.state !== 'APPLIED') {
                c.approval = null;
                if (c.state === 'APPROVED')
                    c.state = 'VERIFIED';
            }
            this.save(c);
            this.store.log(collaboration_js_1.owner, 'change.review', c.id, value.verdict);
            return c;
        });
    }
    automation() {
        const row = this.store.db.prepare('SELECT version,json FROM automation_settings WHERE id=1').get();
        return row ? { ...JSON.parse(String(row.json)), version: Number(row.version) } : { ...automation_js_1.defaultAutomation };
    }
    setAutomation(input, command) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.store.project });
        const value = (0, automation_js_1.validAutomation)(input);
        const key = (0, hash_js_1.hash)(['automation-set', this.store.project, command.idempotency_key]), fingerprint = (0, hash_js_1.hash)([value, command.expected_version]);
        return this.store.idempotent(key, fingerprint, () => {
            const current = this.automation();
            if (current.version !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            const next = { ...value, version: current.version + 1 };
            this.store.db
                .prepare('INSERT INTO automation_settings VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,json=excluded.json')
                .run(next.version, JSON.stringify(value));
            this.store.log(collaboration_js_1.owner, 'automation.set', 'automation', 'SUCCEEDED');
            return next;
        });
    }
    /**
     * The owner's switched-on rules for a rejected candidate. Each candidate version drafts at most one
     * fix work; the draft waits in the inbox, nothing starts by itself. A rule that cannot apply (work
     * changed meanwhile) is logged and leaves the verification result as it is.
     */
    automateRejection(c) {
        const settings = this.automation();
        if (!c.workId)
            return;
        let work;
        try {
            work = this.store.get(c.workId);
        }
        catch {
            return;
        }
        const command = (key, version) => ({
            actor: collaboration_js_1.owner.id,
            project_id: this.store.project,
            idempotency_key: (0, hash_js_1.hash)([key, this.store.project, c.id, c.hash]),
            correlation_id: (0, node_crypto_1.randomUUID)(),
            expected_version: version,
        });
        try {
            if (settings.holdWorkOnFailure && !['DONE', 'BLOCKED'].includes(String(work.data.status)))
                work = this.store.put('work', work.id, { ...work.data, status: 'BLOCKED' }, work.audience, collaboration_js_1.owner, command('automation-hold', work.version));
            this.store.log(collaboration_js_1.owner, 'automation.hold', work.id, 'SUCCEEDED');
        }
        catch (error) {
            this.store.log(collaboration_js_1.owner, 'automation.hold', work.id, error.message);
        }
        if (!settings.draftFixOnFailure)
            return;
        const runKey = (0, hash_js_1.hash)(['automation-fix', this.store.project, c.id, c.hash]);
        if (this.store.db.prepare('SELECT 1 FROM automation_runs WHERE key=?').get(runKey))
            return;
        try {
            const failure = c.evidence ? logExcerpt(c.evidence.log, 1500) : '';
            const draft = (0, automation_js_1.fixDraft)(c, failure, (0, change_review_js_1.lineCommentText)((0, change_review_js_1.openLineComments)(c), this.language), this.language);
            (0, sqlite_js_1.transaction)(this.store.db, () => {
                const created = this.store.put('work', null, {
                    ...draft,
                    status: 'BACKLOG',
                    triage: 'PENDING',
                    roomId: c.roomId,
                    dependencies: [],
                    artifactIds: [],
                    sourceIds: [work.id],
                }, work.audience, collaboration_js_1.owner, command('automation-fix', 0));
                this.store.db.prepare('INSERT INTO automation_runs VALUES(?,?)').run(runKey, created.id);
            });
            this.store.log(collaboration_js_1.owner, 'automation.fix-draft', c.id, 'SUCCEEDED');
        }
        catch (error) {
            this.store.log(collaboration_js_1.owner, 'automation.fix-draft', c.id, error.message);
        }
    }
    /** The owner's inbox decision on a drafted work: accept onto the board, or decline. */
    triage(id, decision, command) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.store.project, minVersion: 1 });
        if (decision !== 'ACCEPTED' && decision !== 'DECLINED')
            throw Error('INVALID_TRIAGE');
        const work = this.store.get(id);
        if (work.kind !== 'work' || !automation_js_1.triageStates.includes(work.data.triage))
            throw Error('INVALID_TRIAGE');
        if (work.data.triage !== 'PENDING' && work.data.triage !== decision)
            throw Error('INVALID_TRIAGE');
        return this.store.put('work', id, { ...work.data, triage: decision }, work.audience, collaboration_js_1.owner, command);
    }
    /** Marks a line comment handled (or open again). Owner only, like review(). */
    resolveReview(id, reviewId, resolved, command) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.store.project, minVersion: 1 });
        if (typeof resolved !== 'boolean')
            throw Error('INVALID_REVIEW');
        const key = (0, hash_js_1.hash)(['change-review-resolve', this.store.project, command.idempotency_key]), fingerprint = (0, hash_js_1.hash)([id, reviewId, resolved, command.expected_version]);
        return this.store.idempotent(key, fingerprint, () => {
            const c = this.get(id);
            if (c.version !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            const review = c.reviews?.find((r) => r.id === reviewId);
            if (!review?.path)
                throw Error('REVIEW_NOT_FOUND');
            if (resolved)
                review.resolvedAt = new Date().toISOString();
            else
                delete review.resolvedAt;
            this.save(c);
            this.store.log(collaboration_js_1.owner, 'change.review.resolve', c.id, resolved ? 'RESOLVED' : 'OPEN');
            return c;
        });
    }
    save(c, receipt) {
        const next = { ...c, version: c.version + 1 };
        (0, sqlite_js_1.transaction)(this.store.db, () => {
            this.store.db
                .prepare('INSERT INTO candidates VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json')
                .run(c.id, JSON.stringify(next));
            this.store.db
                .prepare('INSERT INTO candidate_revisions VALUES(?,?,?)')
                .run(c.id, next.version, JSON.stringify(next));
            if (receipt)
                this.store.db
                    .prepare('INSERT INTO proposal_receipts VALUES(?,?,?)')
                    .run(receipt.key, receipt.hash, c.id);
        });
        c.version = next.version;
    }
    history(id) {
        this.get(id);
        return this.store.db
            .prepare('SELECT json FROM candidate_revisions WHERE id=? ORDER BY version DESC')
            .all(id)
            .map((r) => JSON.parse(String(r.json)));
    }
    rebase(id, version) {
        const c = this.get(id);
        if (c.version !== version)
            throw Error('VERSION_CONFLICT');
        if (['VERIFYING', 'APPLYING', 'APPLIED'].includes(c.state))
            throw Error('INVALID_CHANGE_STATE');
        if (this.fileEdits(c).some((f) => this.currentHash(f.path) !== f.beforeHash))
            throw Error('SOURCE_CHANGED');
        c.baseSnapshot = this.snapshot().snapshot_hash;
        c.state = 'PROPOSED';
        c.evidence = null;
        c.approval = null;
        this.save(c);
        this.store.log(collaboration_js_1.owner, 'change.rebase', id, 'REVALIDATION_REQUIRED');
        return c;
    }
    verifierImage() {
        const inspection = (0, node_child_process_1.spawnSync)('docker', exports.verifierImageInspect, {
            windowsHide: true,
            encoding: 'utf8',
            timeout: 10000,
        });
        const image = inspection.stdout?.trim();
        if (inspection.status !== 0 || !exports.imageId.test(image))
            throw Error('VERIFIER_IMAGE_UNAVAILABLE');
        return image;
    }
    /** Tracked project files with the given edits applied, plus evaluator-only inputs. */
    verificationFiles(edits) {
        const files = {};
        for (const f of this.snapshot().files)
            files[f.path] = f.path.endsWith('.woff2')
                ? { base64: this.bytes(f.path).toString('base64') }
                : this.contents(f.path);
        // Tests read registered fixture contracts; these are evaluator inputs, not model context.
        for (const path of [
            'experiments/workspace-scope.json',
            'experiments/examples/task.example.json',
            'experiments/task-schema.yaml',
            'config/collaboration.json',
        ])
            if ((0, node_fs_1.existsSync)((0, node_path_1.resolve)(this.root, path)))
                files[path] = this.contents(path);
        for (const f of edits) {
            if (f.content === null)
                delete files[f.path];
            else
                files[f.path] = f.content;
        }
        if (this.verifierProfile === 'node-web' && this.checks().content)
            files[acceptancePath] = this.checks().content;
        if (this.verifierProfile === 'node-web')
            files[page_helper_js_1.pageHelperPath] = page_helper_js_1.pageHelperSource;
        return files;
    }
    /** Runs the registered check in an offline, read-only container. `key` names the cancellation slot. */
    runVerifier(image, files, key) {
        const name = 'aiorchestra-check-' + (0, node_crypto_1.randomUUID)();
        return new Promise((done) => {
            const process = (0, node_child_process_1.spawn)('docker', [
                'run',
                '--rm',
                '-i',
                '--name',
                name,
                '--network',
                'none',
                '--read-only',
                '--cap-drop=ALL',
                '--security-opt=no-new-privileges',
                '--pids-limit=128',
                '--memory=768m',
                '--cpus=2',
                '--tmpfs=/tmp:rw,nosuid,size=128m',
                image,
                'node',
                '-e',
                this.verifierProfile === 'node-web' ? exports.nodeWebVerifier : verifierScript,
            ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
            let output = '', settled = false;
            const finish = (status) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                this.cancellations.delete(key);
                done({ status, log: output.slice(-24000) });
            };
            // Killing the docker CLI does not stop the container, so remove it by name. An 'error'
            // listener is required: without one a missing docker binary crashes the server process.
            const stopContainer = () => {
                const cleanup = (0, node_child_process_1.spawn)('docker', ['rm', '-f', name], { windowsHide: true, stdio: 'ignore' });
                cleanup.on('error', () => undefined);
                process.kill();
                finish('INCONCLUSIVE');
            };
            const timer = setTimeout(stopContainer, 150000);
            this.cancellations.set(key, stopContainer);
            const collect = (d) => {
                output = (output + String(d)).slice(-24000);
            };
            process.stdout.on('data', collect);
            process.stderr.on('data', collect);
            process.on('error', () => finish('INCONCLUSIVE'));
            process.on('exit', (code) => finish(code === 0 ? 'PASS' : code === 125 || code === 2 ? 'INCONCLUSIVE' : 'FAIL'));
            process.stdin.on('error', () => undefined);
            process.stdin.end(JSON.stringify(files));
        });
    }
    verify(id, version) {
        const c = this.get(id);
        if (c.version !== version)
            throw Error('VERSION_CONFLICT');
        if (c.state === 'APPLIED' || c.state === 'APPLYING')
            throw Error('INVALID_CHANGE_STATE');
        if (this.pending.has(id))
            return this.pending.get(id);
        if (this.snapshot().snapshot_hash !== c.baseSnapshot)
            throw Error('SOURCE_CHANGED');
        const image = this.verifierImage();
        const files = this.verificationFiles(this.fileEdits(c));
        c.state = 'VERIFYING';
        c.approval = null;
        c.evidence = null;
        this.save(c);
        const inputHash = this.verificationInputHash();
        const promise = (async () => {
            const outcome = await this.runVerifier(image, files, id);
            const tests = acceptanceResults(outcome.log);
            // Project rule checks are a gate of their own: a violation fails verification even if tests pass.
            const scan = await (0, rule_scan_js_1.scanRulesIsolated)(this.fileEdits(c), this.rules().checks, {
                language: this.language,
            });
            const rules = scan.status === 'DONE' ? scan.violations : [];
            if (rules.length)
                outcome.status = 'FAIL';
            // Unfinished rule checks cannot confirm a pass; the reason stays in the evidence log.
            else if (scan.status === 'INCONCLUSIVE') {
                if (outcome.status === 'PASS')
                    outcome.status = 'INCONCLUSIVE';
                outcome.log += `\nRULE_CHECK_INCONCLUSIVE ${scan.reason}`;
            }
            c.evidence = {
                ...outcome,
                image,
                candidateHash: c.hash,
                inputHash,
                ...(tests ? { tests } : {}),
                ...(rules.length ? { rules } : {}),
            };
            c.state = outcome.status === 'PASS' ? 'VERIFIED' : outcome.status === 'FAIL' ? 'REJECTED' : 'UNKNOWN';
            this.save(c);
            this.store.log(collaboration_js_1.owner, 'change.verify', id, outcome.status);
            if (c.state === 'REJECTED')
                this.automateRejection(c);
            return c;
        })().finally(() => {
            this.pending.delete(id);
            this.cancellations.delete(id);
        });
        this.pending.set(id, promise);
        return promise;
    }
    cancel(id, version) {
        const c = this.get(id);
        if (c.version !== version)
            throw Error('VERSION_CONFLICT');
        if (c.state !== 'VERIFYING')
            throw Error('INVALID_CHANGE_STATE');
        this.cancellations.get(id)?.();
        this.store.log(collaboration_js_1.owner, 'change.cancel', id, 'REQUESTED');
        return c;
    }
    approve(id, version) {
        const c = this.get(id);
        if (c.version !== version)
            throw Error('VERSION_CONFLICT');
        if ((0, change_review_js_1.reviewBlocked)(c))
            throw Error('REVIEW_CHANGES_REQUIRED');
        if (c.state !== 'VERIFIED' || c.evidence?.status !== 'PASS' || c.evidence.candidateHash !== c.hash)
            throw Error('VERIFICATION_REQUIRED');
        if (this.snapshot().snapshot_hash !== c.baseSnapshot ||
            c.evidence.inputHash !== this.verificationInputHash())
            throw Error('SOURCE_CHANGED');
        c.approval = { actor: collaboration_js_1.owner.id, hash: c.hash };
        c.state = 'APPROVED';
        this.save(c);
        return c;
    }
    apply(id, version) {
        const c = this.get(id);
        if (c.version !== version)
            throw Error('VERSION_CONFLICT');
        if ((0, change_review_js_1.reviewBlocked)(c))
            throw Error('REVIEW_CHANGES_REQUIRED');
        if (c.state !== 'APPROVED' ||
            c.approval?.hash !== c.hash ||
            c.evidence?.candidateHash !== c.hash ||
            c.evidence.status !== 'PASS')
            throw Error('APPROVAL_REQUIRED');
        const edits = this.fileEdits(c);
        const actor = c.actor === collaboration_js_1.owner.id ? collaboration_js_1.owner : { kind: 'employee', id: c.actor };
        if (actor.kind === 'employee') {
            this.store.allowTool(actor, 'change.propose');
            if (this.store.get(actor.id).version !== c.employeeVersion)
                throw Error('EMPLOYEE_CHANGED');
            this.store.read(c.roomId, actor);
        }
        for (const f of edits) {
            this.allowed(f.path, actor, true);
            if (this.currentHash(f.path) !== f.beforeHash)
                throw Error('SOURCE_CHANGED');
        }
        if (this.snapshot().snapshot_hash !== c.baseSnapshot ||
            c.evidence.inputHash !== this.verificationInputHash())
            throw Error('SOURCE_CHANGED');
        c.state = 'APPLYING';
        this.save(c);
        const staged = [], applied = [];
        try {
            for (const edit of edits) {
                this.checkAncestors(edit.path);
                const target = (0, node_path_1.resolve)(this.root, edit.path);
                (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(target), { recursive: true });
                this.checkAncestors(edit.path);
                const temporary = (0, node_path_1.resolve)((0, node_path_1.dirname)(target), '.aiorchestra-' + (0, node_crypto_1.randomUUID)() + '.tmp');
                if (edit.content !== null)
                    (0, node_fs_1.writeFileSync)(temporary, edit.content, { encoding: 'utf8', flag: 'wx' });
                staged.push({ edit, temporary });
            }
            for (const { edit, temporary } of staged) {
                this.allowed(edit.path, actor, true);
                if (this.currentHash(edit.path) !== edit.beforeHash)
                    throw Error('SOURCE_CHANGED');
                if (edit.content === null)
                    (0, node_fs_1.unlinkSync)((0, node_path_1.resolve)(this.root, edit.path));
                else
                    (0, node_fs_1.renameSync)(temporary, (0, node_path_1.resolve)(this.root, edit.path));
                applied.push(edit);
            }
            this.faults.beforeCommit?.();
            c.state = 'APPLIED';
            this.save(c);
            this.store.log(collaboration_js_1.owner, 'change.apply', id, 'SUCCEEDED');
            return c;
        }
        catch (error) {
            // A process crash or interrupted rollback remains UNKNOWN; never imply an atomic multi-file OS transaction.
            for (const edit of applied.reverse())
                try {
                    const expected = edit.content === null ? null : (0, hash_js_1.sha256)(edit.content);
                    if (this.currentHash(edit.path) !== expected)
                        continue;
                    if (edit.before === null) {
                        if ((0, node_fs_1.existsSync)((0, node_path_1.resolve)(this.root, edit.path)))
                            (0, node_fs_1.unlinkSync)((0, node_path_1.resolve)(this.root, edit.path));
                    }
                    else
                        (0, node_fs_1.writeFileSync)((0, node_path_1.resolve)(this.root, edit.path), edit.before, { encoding: 'utf8' });
                }
                catch { }
            c.state = 'UNKNOWN';
            this.save(c);
            throw error;
        }
        finally {
            for (const { temporary } of staged)
                if ((0, node_fs_1.existsSync)(temporary))
                    try {
                        (0, node_fs_1.unlinkSync)(temporary);
                    }
                    catch { }
        }
    }
    async close() {
        await Promise.allSettled([...this.pending.values()]);
    }
}
exports.ProjectChanges = ProjectChanges;
//# sourceMappingURL=project-changes.js.map