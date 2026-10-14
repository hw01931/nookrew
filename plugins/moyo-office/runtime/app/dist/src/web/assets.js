"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webAssets = void 0;
exports.moduleGraph = moduleGraph;
exports.companionAssets = companionAssets;
exports.staticAsset = staticAsset;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const settings_js_1 = require("./settings.js");
// Explicit public surface. Never turn the project root into a static file server.
exports.webAssets = [
    '/core/status-labels.js',
    '/companion.js',
    '/companion.html',
    '/companion.css',
    '/features/presence-detail.js',
    '/features/presence-chat.js',
    '/features/office-conversation.js',
    '/features/conversation-display.js',
    '/features/presence-labels.js',
    '/features/native-work.js',
    '/i18n/ko/native-work.js',
    '/i18n/en/native-work.js',
    '/features/social-workspace.js',
    '/i18n/ko/social.js',
    '/i18n/en/social.js',
    '/features/office-card-art.js',
    '/features/presence-usage.js',
    '/features/office-custom.js',
    '/features/office-game.js',
    '/features/office-leisure.js',
    '/i18n/ko/leisure.js',
    '/i18n/en/leisure.js',
    '/office-assets.example.json',
    '/assets/office/colleague-v2.png',
    '/assets/office/colleague-lavender.png',
    '/assets/office/colleague-blue.png',
    '/assets/office/colleague-peach.png',
    '/features/office-art.js',
    '/features/office-theme.js',
    '/features/change-review.js',
    '/features/employee-handover.js',
    '/features/workflow.js',
    '/core/project-drafts.js',
    '/core/i18n.js',
    '/i18n/ko.js',
    '/i18n/en.js',
    '/i18n/ko/base.js',
    '/i18n/ko/work.js',
    '/i18n/ko/chat.js',
    '/i18n/ko/changes.js',
    '/i18n/ko/artifacts.js',
    '/i18n/ko/office.js',
    '/i18n/ko/client.js',
    '/i18n/en/base.js',
    '/i18n/en/work.js',
    '/i18n/en/chat.js',
    '/i18n/en/changes.js',
    '/i18n/en/artifacts.js',
    '/i18n/en/office.js',
    '/i18n/en/client.js',
    '/features/project-draft-form.js',
    '/features/project-inspection.js',
    '/features/role-presets.js',
    '/features/work-origin.js',
    '/features/work-planning.js',
    '/features/conversation-tools.js',
    '/features/document-editor.js',
    '/features/operations.js',
    '/core/download.js',
    '/styles/operations.css',
    '/features/record-conflict.js',
    '/core/record-merge.js',
    '/features/attention-center.js',
    '/features/record-lifecycle.js',
    '/core/entity-drafts.js',
    '/features/draft-library.js',
    '/core/chat-delivery.js',
    '/core/pending-work.js',
    '/features/work-recovery.js',
    '/features/record-search.js',
    '/features/artifact-editor.js',
    '/features/sheet-editor.js',
    '/sheet-frame.html',
    '/styles/sheet-frame.css',
    '/vendor/sheet.js',
    '/vendor/sheet.css',
    '/vendor/sheet.LICENSE.txt',
    '/app.js',
    '/style.css',
    '/features/code-editor.js',
    '/features/artifact-export.js',
    '/features/artifact-formats.js',
    '/features/artifact-ooxml.js',
    '/features/artifact-print.js',
    '/features/artifact-import.js',
    '/core/zip.js',
    '/styles/print.css',
    '/vendor/markdown.js',
    '/vendor/markdown.LICENSE.txt',
    '/vendor/diagram.js',
    '/vendor/diagram.LICENSE.txt',
    '/features/diagram-view.js',
    '/features/change-selection.js',
    '/core/code-drafts.js',
    '/vendor/code-editor.js',
    '/vendor/code-editor.LICENSE.txt',
    '/core/config.js',
    '/core/dialog-guard.js',
    '/core/state.js',
    '/core/dom.js',
    '/core/icons.js',
    '/core/copy.js',
    '/core/application.js',
    '/core/events.js',
    '/core/format.js',
    '/core/selectors.js',
    '/core/api.js',
    '/core/notifications.js',
    '/features/tasks.js',
    '/features/composer.js',
    '/features/files.js',
    '/features/runs.js',
    '/features/commands.js',
    '/features/project-files.js',
    '/features/project-library.js',
    '/features/presence-work.js',
    '/features/project-search.js',
    '/features/work-board.js',
    '/features/work-detail.js',
    '/features/project-guide.js',
    '/features/quick-assign.js',
    '/features/pixel-office.js',
    '/features/office-scene.js',
    '/features/office-isometric.js',
    '/features/office-character.js',
    '/features/office-map.js',
    '/styles/pixel-office.css',
    '/features/routines.js',
    '/features/workflow-graph.js',
    '/features/project-list.js',
    '/features/api-models.js',
    '/features/model-routes.js',
    '/features/cost-dashboard.js',
    '/features/usage-panel.js',
    '/features/model-servers.js',
    '/features/web-search-settings.js',
    '/features/engines-page.js',
    '/features/engine-consent.js',
    '/features/slides.js',
    '/features/board.js',
    '/features/project-rules.js',
    '/features/skills-page.js',
    '/features/model-manager.js',
    '/features/artifact-library.js',
    '/styles/work-board.css',
    '/styles/project-search.css',
    '/features/office.js',
    '/features/execution-log.js',
    '/styles/execution-log.css',
    '/features/office-forms.js',
    '/features/office-preview.js',
    '/features/office-history.js',
    '/styles/office.css',
    '/client.html',
    '/client.js',
    '/features/chat-report.js',
    '/features/office-ui.js',
    '/features/office-cards.js',
    '/features/office-room.js',
    '/features/office-pages.js',
    '/features/office-selectors.js',
    '/core/http.js',
    '/styles/tokens.css',
    '/styles/base.css',
    '/styles/workspace.css',
    '/styles/reviews.css',
    '/styles/dialogs.css',
    '/styles/responsive.css',
    '/styles/code-editor.css',
    '/styles/documents.css',
    '/styles/change-diff.css',
    '/core/line-diff.js',
    '/features/change-diff.js',
];
/**
 * The modules a page entry loads, following relative `import … from` and `export … from`. The
 * customer port allows exactly this set for client.js, so the list cannot fall behind the page.
 */
function moduleGraph(root, entry) {
    const seen = new Set();
    const visit = (path) => {
        if (seen.has(path) || !exports.webAssets.includes(path))
            return;
        seen.add(path);
        const code = (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(root, 'web', path.slice(1)), 'utf8');
        for (const m of code.matchAll(/^\s*(?:import|export)\s[^'"]*?['"](\.{1,2}\/[^'"]+)['"]/gm))
            visit(node_path_1.posix.normalize(node_path_1.posix.join(node_path_1.posix.dirname(path), m[1])));
    };
    visit(entry);
    return seen;
}
function companionAssets(root) {
    const assets = moduleGraph(root, '/companion.js');
    assets.add('/companion.html');
    assets.add('/companion.css');
    const css = (path) => {
        assets.add(path);
        const source = (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(root, 'web', path.slice(1)), 'utf8');
        for (const match of source.matchAll(/@import\s+url\(['"]?([^)'"\s]+)['"]?\)/g)) {
            if (!assets.has(match[1]))
                css(match[1]);
        }
    };
    css('/companion.css');
    for (const path of exports.webAssets.filter((p) => p.startsWith('/assets/office/') ||
        p === '/vendor/markdown.LICENSE.txt' ||
        p === '/office-assets.example.json'))
        assets.add(path);
    assets.add('/fonts/PretendardVariable.woff2');
    assets.add('/fonts/OFL-Pretendard.txt');
    return assets;
}
function staticAsset(path, root, config, entry = 'index.html') {
    if (path === '/fonts/PretendardVariable.woff2')
        return { content: (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(root, 'web/fonts/PretendardVariable.woff2')), type: 'font/woff2' };
    if (path === '/fonts/OFL-Pretendard.txt')
        return {
            content: (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(root, 'web/fonts/OFL-Pretendard.txt'), 'utf8'),
            type: 'text/plain; charset=utf-8',
        };
    if (path !== '/' && !exports.webAssets.some((asset) => asset === path))
        return null;
    const file = path === '/' ? entry : path.slice(1);
    if (file.endsWith('.png'))
        return { content: (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(root, 'web', file)), type: 'image/png' };
    const source = (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(root, 'web', file), 'utf8');
    return {
        content: path === '/' ? (0, settings_js_1.renderIndex)(source, config) : source,
        type: file.endsWith('.html')
            ? 'text/html; charset=utf-8'
            : file.endsWith('.js')
                ? 'text/javascript; charset=utf-8'
                : file.endsWith('.json')
                    ? 'application/json; charset=utf-8'
                    : file.endsWith('.txt')
                        ? 'text/plain; charset=utf-8'
                        : 'text/css; charset=utf-8',
    };
}
//# sourceMappingURL=assets.js.map