"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pageHelperPath = exports.pageHelperSource = void 0;
/**
 * Page test helper for acceptance checks (ADR 0044). Its source is written into the verifier work
 * directory as node_modules/aiorchestra-page/index.js, so a check can call
 * `require('aiorchestra-page').openPage()` and drive src/index.html like a user: type, press Enter,
 * click, reload. happy-dom comes from the verifier image (NODE_PATH).
 *
 * Browser-like rules: page scripts run in order with shared globals and without require/module;
 * pages opened in one test share localStorage like tabs of one site; it is emptied when the next
 * top-level test starts, so tests stay independent. reload() reopens the same page object.
 * A script error on load, or during an action, fails the calling test instead of being swallowed.
 */
function pageHelper() {
    const fs = require('fs'), path = require('path');
    const { Window } = require('happy-dom');
    const { beforeEach } = require('node:test');
    const shared = new Map();
    const windows = [];
    // Subtests keep their parent's storage; only a new top-level test starts empty.
    beforeEach((t) => {
        if (!String(t?.fullName ?? '').includes(' > '))
            shared.clear();
    });
    process.on('exit', () => windows.forEach((w) => w.close()));
    // A failing assert on a DOM node renders the node's whole circular object graph (window,
    // document, listeners) and ran out of memory (v27). node:assert ignores custom inspection, so
    // comparisons that involve a node are decided by identity here and fail with a short tag.
    const isNode = (v) => !!v && typeof v === 'object' && typeof v.nodeType === 'number' && 'ownerDocument' in v;
    const tag = (v) => {
        if (!isNode(v))
            return v;
        const html = String(v.outerHTML ?? v.textContent ?? v.nodeName);
        return html.length > 200 ? html.slice(0, 200) + '…' : html;
    };
    const assertModule = require('assert');
    for (const target of [assertModule, assertModule.strict])
        for (const name of [
            'equal',
            'strictEqual',
            'deepEqual',
            'deepStrictEqual',
            'notEqual',
            'notStrictEqual',
            'notDeepEqual',
            'notDeepStrictEqual',
        ]) {
            const original = target[name];
            if (typeof original !== 'function' || original.pageSafe)
                continue;
            const negative = name.startsWith('not');
            const wrapped = function (actual, expected, message) {
                if (!isNode(actual) && !isNode(expected))
                    return original.call(this, actual, expected, message);
                if (Object.is(actual, expected) !== negative)
                    return;
                throw new assertModule.AssertionError({
                    actual: tag(actual),
                    expected: tag(expected),
                    operator: name,
                    ...(message === undefined ? {} : { message }),
                });
            };
            wrapped.pageSafe = true;
            target[name] = wrapped;
        }
    const storage = {
        getItem: (k) => (shared.has(String(k)) ? shared.get(String(k)) : null),
        setItem: (k, v) => void shared.set(String(k), String(v)),
        removeItem: (k) => void shared.delete(String(k)),
        clear: () => shared.clear(),
        key: (i) => [...shared.keys()][i] ?? null,
        get length() {
            return shared.size;
        },
    };
    function load(root) {
        const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
        const window = new Window({
            url: 'http://localhost/',
            settings: {
                disableJavaScriptFileLoading: true,
                disableCSSFileLoading: true,
                disableIframePageLoading: true,
            },
        });
        windows.push(window);
        Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
        // A failing assert prints its values; a DOM node's object graph (window, document, listeners)
        // is huge and circular, and printing it exhausted memory (v27). Show a short tag instead.
        Object.defineProperty(window.Node.prototype, Symbol.for('nodejs.util.inspect.custom'), {
            configurable: true,
            value() {
                const html = String(this.outerHTML ?? this.textContent ?? this.nodeName);
                return html.length > 200 ? html.slice(0, 200) + '…' : html;
            },
        });
        const errors = [];
        window.addEventListener('error', (e) => errors.push(String(e?.error?.message ?? e?.message ?? e)));
        // Scripts are run by this helper, one by one, so a failure names the file.
        window.document.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
        const run = (label, code) => {
            try {
                window.eval(code);
            }
            catch (e) {
                throw Error(`PAGE_SCRIPT_ERROR ${label}: ${e?.name ?? 'Error'}: ${e?.message ?? e}`);
            }
        };
        for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
            const src = m[1].match(/\ssrc=["']([^"']+)["']/i)?.[1];
            if (!src)
                run('inline script', m[2]);
            else if (!/^([a-z]+:)?\/\//i.test(src))
                run('src/' + src, fs.readFileSync(path.join(root, 'src', src), 'utf8'));
        }
        window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
        window.dispatchEvent(new window.Event('load'));
        if (errors.length)
            throw Error(`PAGE_SCRIPT_ERROR page ready: ${errors[errors.length - 1]}`);
        return { window, errors, html };
    }
    function openPage(options = {}) {
        const root = options.root ?? process.cwd();
        let current = load(root);
        const find = (target) => {
            if (typeof target !== 'string')
                return target;
            const el = current.window.document.querySelector(target);
            if (!el) {
                // An element written in index.html but gone after the scripts ran was removed by a script
                // (v38: the untouched starter app.js replaced #app's contents). Say so; "not found" alone
                // sent the developer looking at index.html, where the element was.
                const id = /^#[\w-]+$/.test(target) ? target.slice(1) : '';
                const inPage = id && new RegExp('\\sid=["\']' + id + '["\']').test(current.html);
                throw Error(`PAGE_ELEMENT_NOT_FOUND ${target}` +
                    (inPage
                        ? ' (index.html에는 있지만 페이지 스크립트가 실행된 뒤 사라졌습니다. 스크립트가 그 영역을 덮어쓰는지 확인하세요)'
                        : ''));
            }
            return el;
        };
        const act = (label, fn) => {
            const before = current.errors.length;
            fn();
            if (current.errors.length > before)
                throw Error(`PAGE_SCRIPT_ERROR ${label}: ${current.errors[current.errors.length - 1]}`);
        };
        const page = {
            get window() {
                return current.window;
            },
            get document() {
                return current.window.document;
            },
            localStorage: storage,
            get errors() {
                return current.errors;
            },
            $: (selector) => current.window.document.querySelector(selector),
            $$: (selector) => [...current.window.document.querySelectorAll(selector)],
            /** Visible text: escaped input shows its characters, e.g. "<b>" stays the text "<b>". */
            text: (target = 'body') => String(find(target).textContent ?? '').trim(),
            type(target, text) {
                const el = find(target);
                act(`type ${target}`, () => {
                    el.focus?.();
                    el.value = text;
                    el.dispatchEvent(new current.window.Event('input', { bubbles: true }));
                    el.dispatchEvent(new current.window.Event('change', { bubbles: true }));
                });
            },
            press(target, key) {
                const el = find(target);
                act(`press ${key}`, () => {
                    const w = current.window;
                    const go = el.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
                    el.dispatchEvent(new w.KeyboardEvent('keypress', { key, bubbles: true, cancelable: true }));
                    el.dispatchEvent(new w.KeyboardEvent('keyup', { key, bubbles: true }));
                    // Browsers submit the form when Enter is pressed in a text field (implicit submission).
                    if (go && key === 'Enter' && el.tagName === 'INPUT' && el.form)
                        el.form.requestSubmit();
                });
            },
            click(target) {
                const el = find(target);
                act(`click ${target}`, () => el.click());
            },
            /** Reloads this same page object; localStorage is kept, everything else starts over. */
            reload() {
                page.close();
                current = load(root);
                return page;
            },
            close() {
                current.window.happyDOM.abort();
                current.window.close();
            },
        };
        return page;
    }
    module.exports = { openPage };
}
exports.pageHelperSource = `(${pageHelper.toString()})();\n`;
/** Published inside the verifier work directory; the path is outside every editable root. */
exports.pageHelperPath = 'node_modules/aiorchestra-page/index.js';
//# sourceMappingURL=page-helper.js.map