"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedDirectories = void 0;
exports.projectSeed = projectSeed;
exports.seedManifest = seedManifest;
exports.inspectSeed = inspectSeed;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const local_path_js_1 = require("./local-path.js");
const hash_js_1 = require("./hash.js");
exports.seedDirectories = ['src', 'tests', 'experiments', '.aiorchestra'];
/**
 * Words of the seeded files in the project's language (ADR 0062). The Korean files stay byte for byte
 * what they were, so manifests of existing projects still match.
 */
const seedWords = {
    ko: {
        readme: (idea) => '# 프로젝트 요구\n\n' +
            idea +
            '\n\n## 구조\n\n' +
            '- src/index.html: 시작 화면. 필요한 스크립트를 <script src>로 불러온다.\n' +
            '- src/app.js: 화면 동작.\n' +
            "- 상태 변경·저장 같은 순수 로직은 src/의 별도 파일로 나누고, 끝에 `if (typeof module !== 'undefined') module.exports = {...};`로 내보낸다. 브라우저에서는 <script>로, 시험에서는 require로 같은 파일을 쓴다.\n" +
            '- 외부 의존성·통신 없이 동작해야 한다.\n',
        htmlLang: 'ko',
        title: '앱',
        appComment: '// 화면 동작. 순수 로직은 별도 파일로 나누고 index.html에서 이 파일보다 먼저 불러온다.\n',
        empty: '아직 구현하지 않았습니다.',
    },
    en: {
        readme: (idea) => '# Project requirements\n\n' +
            idea +
            '\n\n## Structure\n\n' +
            '- src/index.html: the start page. Load the scripts it needs with <script src>.\n' +
            '- src/app.js: page behavior.\n' +
            "- Put pure logic such as state changes and saving in separate files under src/ and export it at the end with `if (typeof module !== 'undefined') module.exports = {...};`. The browser loads the same file with <script>, tests with require.\n" +
            '- It must work without external dependencies or network access.\n',
        htmlLang: 'en',
        title: 'App',
        appComment: '// Page behavior. Put pure logic in separate files and load them in index.html before this one.\n',
        empty: 'Not implemented yet.',
    },
};
function projectSeed(idea, lang = 'ko') {
    const words = seedWords[lang];
    return {
        'package.json': JSON.stringify({ name: 'managed-project', private: true, scripts: { test: 'node --test tests/*.test.cjs' } }, null, 2),
        'experiments/workspace-scope.json': JSON.stringify({ schema_version: 1, include: ['src/**', 'tests/**', 'package.json'], exclude: [] }, null, 2),
        'src/README.md': words.readme(idea),
        'src/index.html': [
            '<!doctype html>',
            `<html lang="${words.htmlLang}">`,
            '  <head>',
            '    <meta charset="utf-8" />',
            '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
            `    <title>${words.title}</title>`,
            '    <link rel="stylesheet" href="styles.css" />',
            '  </head>',
            '  <body>',
            '    <main id="app"></main>',
            '    <script src="app.js"></script>',
            '  </body>',
            '</html>',
            '',
        ].join('\n'),
        'src/app.js': words.appComment +
            // Only fills an empty #app: a developer who builds the page in index.html but has not touched
            // this file yet must not see their elements wiped.
            "const app = document.getElementById('app');\n" +
            `if (app && !app.children.length) app.textContent = '${words.empty}';\n`,
        'src/styles.css': 'body {\n  margin: 0;\n  font-family: system-ui, sans-serif;\n}\n',
    };
}
/** Hashes of the seed in the language it was written in; inspection compares the files with these. */
function seedManifest(idea, lang = 'ko') {
    return {
        schemaVersion: 1,
        files: Object.fromEntries(Object.entries(projectSeed(idea, lang)).map(([path, content]) => [path, (0, hash_js_1.hash)(content)])),
    };
}
function inspectSeed(root, manifest) {
    if (!manifest ||
        manifest.schemaVersion !== 1 ||
        // The manifest records what was created then; the seed may have grown since.
        !Object.keys(manifest.files).length ||
        Object.keys(manifest.files).some((path) => path.startsWith('/') || path.split('/').includes('..')))
        return {
            status: 'INCONCLUSIVE',
            checks: [{ path: '.', status: 'INCONCLUSIVE', reason: 'MANIFEST_UNAVAILABLE' }],
        };
    const checks = [];
    try {
        (0, local_path_js_1.localDirectory)(root);
    }
    catch {
        return { status: 'FAIL', checks: [{ path: '.', status: 'FAIL', reason: 'ROOT_UNAVAILABLE_OR_UNSAFE' }] };
    }
    for (const path of exports.seedDirectories) {
        try {
            (0, local_path_js_1.localDirectory)((0, node_path_1.resolve)(root, path));
            checks.push({ path, status: 'PASS' });
        }
        catch {
            checks.push({ path, status: 'FAIL', reason: 'DIRECTORY_UNAVAILABLE_OR_UNSAFE' });
        }
    }
    for (const [path, expected] of Object.entries(manifest.files)) {
        try {
            const full = (0, node_path_1.resolve)(root, path);
            (0, local_path_js_1.localDirectory)((0, node_path_1.dirname)(full));
            const stat = (0, node_fs_1.lstatSync)(full);
            if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1000000)
                throw Error();
            const actual = (0, hash_js_1.hash)((0, node_fs_1.readFileSync)(full, 'utf8'));
            checks.push({
                path,
                status: actual === expected ? 'PASS' : 'FAIL',
                hash: actual,
                ...(actual === expected ? {} : { reason: 'CONTENT_CHANGED' }),
            });
        }
        catch {
            checks.push({ path, status: 'FAIL', reason: 'FILE_UNAVAILABLE_OR_UNSAFE' });
        }
    }
    return { status: checks.every((c) => c.status === 'PASS') ? 'PASS' : 'FAIL', checks };
}
//# sourceMappingURL=project-seed.js.map