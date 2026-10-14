/* i18n: all text from catalogs */
import {api} from '../core/api.js';
import {esc} from '../core/dom.js';
import {icon} from '../core/icons.js';
import {t} from '../core/i18n.js';
import {changeDiff} from './change-diff.js';

function entryIcon(entry) {
  if (entry.blocked) return 'lock';
  if (entry.kind === 'directory') return 'folder';
  return /\.(js|ts|json|css|html|yaml|py|cjs|mjs)$/.test(entry.name) ? 'code' : 'files';
}

export function createFileBrowser(changed, initialFolder = '', readOnly = false) {
  let tree = null,
    file = null,
    git = null,
    error = '',
    busy = false,
    folder = initialFolder,
    offset = 0,
    query = '',
    generation = 0,
    timer = null,
    following = false,
    followTimer = null,
    composing = false;
  const notify = () => {
    if (!composing) {
      const scroll = document.querySelector('.explorer-code')?.scrollTop || 0;
      changed();
      const code = document.querySelector('.explorer-code');
      if (code) code.scrollTop = scroll;
    }
  };
  function scheduleFollow() {
    clearTimeout(followTimer);
    if (!following) return;
    followTimer = setTimeout(async () => {
      if (!document.querySelector('.project-explorer')) {
        following = false;
        return;
      }
      if (file && !busy && !document.hidden) {
        const current = generation;
        const path = file.path;
        try {
          const next = await api('/api/project-files?' + new URLSearchParams({view: 'file', path}));
          if (
            following &&
            current === generation &&
            file?.path === path &&
            JSON.stringify(file) !== JSON.stringify(next)
          ) {
            file = next;
            notify();
          }
        } catch (e) {
          if (following && current === generation) {
            following = false;
            error = e.message;
            notify();
          }
        }
      }
      scheduleFollow();
    }, 2000);
  }
  async function load(path = folder, page = 0, filter = query) {
    clearTimeout(timer);
    const current = ++generation;
    busy = true;
    error = '';
    folder = path;
    offset = page;
    query = filter;
    notify();
    try {
      const next = await api(
        '/api/project-files?' + new URLSearchParams({path, offset: String(page), q: filter}),
      );
      if (current === generation) {
        tree = next;
        file = null;
        git = null;
      }
    } catch (e) {
      if (current === generation) error = e.message;
    } finally {
      if (current === generation) {
        busy = false;
        notify();
      }
    }
  }
  async function click(event) {
    const b = event.target.closest('[data-file-action]');
    if (!b) return;
    const action = b.dataset.fileAction,
      path = b.dataset.path || '';
    if (action === 'follow') {
      following = !following;
      scheduleFollow();
      notify();
      return;
    }
    if (action === 'git' && file) {
      const current = ++generation;
      busy = true;
      error = '';
      notify();
      try {
        const next = await api('/api/project-files?' + new URLSearchParams({view: 'git', path: file.path}));
        if (current === generation) git = next;
      } catch (e) {
        if (current === generation) error = e.message;
      } finally {
        if (current === generation) {
          busy = false;
          notify();
        }
      }
      return;
    }
    if (action === 'folder') return load(path, 0, '');
    if (action === 'page') return load(folder, Number(b.dataset.offset));
    if (action === 'reload') return load(folder, offset, query);
    if (action === 'clear') return load(folder, 0, '');
    if (action === 'read') {
      git = null;
      const current = ++generation;
      busy = true;
      error = '';
      notify();
      try {
        const next = await api('/api/project-files?' + new URLSearchParams({view: 'file', path}));
        if (current === generation) file = next;
      } catch (e) {
        if (current === generation) error = e.message;
      } finally {
        if (current === generation) {
          busy = false;
          notify();
        }
      }
    }
  }
  function render(root) {
    if (!tree && !busy && !error) queueMicrotask(() => load());
    const parts = folder.split('/').filter(Boolean);
    const project = t('changes.project');
    const gitView = git
      ? `<section class="file-git-history"><h3>${t('pixel.gitWorking')}</h3><p>${esc(git.observedAt)} · ${esc(git.commits[0]?.slice(0, 12) || t('pixel.gitUntracked'))}</p>${changeDiff({path: git.path, before: git.after, content: git.working}, 'git-working')}<h3>${t('pixel.gitCommits')}</h3><p>${esc(
          git.commits
            .map((c) => c.slice(0, 12))
            .reverse()
            .join(' → '),
        )}</p>${git.commits.length ? changeDiff({path: git.path, before: git.before, content: git.after}, 'git-commits') : `<p>${t('pixel.gitUntracked')}</p>`}</section>`
      : '';
    const trail = [['', project], ...parts.map((p, i) => [parts.slice(0, i + 1).join('/'), p])];
    const rootName = (root || project).split(/[\\/]/).filter(Boolean).pop();
    const entries = tree?.entries || [];
    const basename = file?.path.split('/').pop();
    const extension = basename?.includes('.') ? basename.split('.').pop().toUpperCase() : 'TEXT';
    const size = file ? (file.bytes < 1024 ? `${file.bytes} B` : `${(file.bytes / 1024).toFixed(1)} KB`) : '';
    const lineCount = file?.kind === 'text' ? file.content.split('\n').length : 0;
    return `<header class="file-page-heading"><div><h2>${t('nav.files')}</h2><p title="${esc(root || '')}">${icon('folder')}<span>${esc(root || project)}</span></p></div><div><button type="button" class="secondary" data-file-action="git" ${file?.kind === 'text' && !file.truncated && !busy ? '' : 'disabled'}>${t('pixel.git')}</button><button type="button" class="secondary" data-file-action="follow" aria-pressed="${following}" ${file ? '' : 'disabled'}>${t(following ? 'pixel.followOn' : 'pixel.followOff')}</button>${readOnly ? '' : `<button class="secondary" data-office="file-create">${t('changes.explorer.newFile')}</button>`}</div></header>
  <section class="project-explorer" aria-busy="${busy}">
   <div class="explorer-toolbar"><nav aria-label="${t('changes.explorer.trail')}">${trail.map(([p, label], i) => `<button data-file-action="folder" data-path="${esc(p)}" ${i === trail.length - 1 ? 'aria-current="location"' : ''}>${i === 0 ? icon('folder') : ''}<span>${esc(i === 0 ? rootName : label)}</span></button>`).join(icon('chevron'))}</nav>
    <div class="explorer-tools"><form id="project-file-search" role="search"><label for="project-file-query" class="sr-only">${t('changes.explorer.searchLabel')}</label>${icon('search')}<input id="project-file-query" name="query" value="${esc(query)}" placeholder="${t('changes.explorer.searchPlaceholder')}" autocomplete="off" spellcheck="false">${query ? `<button type="button" data-file-action="clear" aria-label="${t('changes.explorer.clearSearch')}" title="${t('changes.explorer.clearSearch')}">${icon('close')}</button>` : '<kbd>↵</kbd>'}</form><button class="explorer-refresh ${busy ? 'is-loading' : ''}" data-file-action="reload" aria-label="${t('changes.explorer.refresh')}" title="${t('changes.explorer.refresh')}" ${busy ? 'disabled' : ''}>${icon('refresh')}</button></div>
   </div>
   ${error ? `<div class="explorer-error" role="alert">${t('changes.explorer.loadFailed')} <span>${esc(error)}</span><button data-file-action="reload">${t('common.retry')}</button></div>` : ''}
   <div class="explorer-columns"><aside class="explorer-sidebar" aria-label="${t('changes.explorer.list')}"><div class="explorer-list-heading"><span>${query ? t('changes.explorer.results') : t('changes.explorer.name')}</span><span>${tree?.total ?? 0}</span></div><div class="explorer-list">
    ${entries.map((e) => `<button class="explorer-entry ${e.kind === 'directory' ? 'is-folder' : ''}" data-file-action="${e.kind === 'directory' ? 'folder' : 'read'}" data-path="${esc(e.path)}" title="${esc(e.name)}${e.blocked ? ' · ' + t('changes.explorer.restricted') : ''}" ${e.blocked || !['directory', 'file'].includes(e.kind) ? 'disabled' : ''} ${file?.path === e.path ? 'aria-current="true"' : ''}>${icon(entryIcon(e))}<span>${esc(e.name)}</span>${e.kind === 'directory' && !e.blocked ? icon('chevron') : ''}</button>`).join('') || `<div class="explorer-no-results">${icon('search')}<strong>${busy ? t('common.loading') : query ? t('changes.noResults') : t('changes.explorer.emptyFolder')}</strong>${query ? `<span>${t('changes.tryAnotherName')}</span>` : ''}</div>`}
   </div><footer class="explorer-pagination"><span>${tree?.total ? t('changes.explorer.range', {from: offset + 1, to: Math.min(offset + entries.length, tree.total), total: tree.total}) : t('changes.count', {n: 0})}</span><div>${offset > 0 ? `<button data-file-action="page" data-offset="${Math.max(0, offset - 200)}" aria-label="${t('changes.explorer.previous')}">←</button>` : ''}${tree?.next !== null && tree?.next !== undefined ? `<button data-file-action="page" data-offset="${tree.next}" aria-label="${t('changes.explorer.next')}">→</button>` : ''}</div></footer></aside>
   <section class="explorer-preview" aria-label="${t('changes.explorer.preview')}">${file ? `<header class="explorer-document-head"><div>${icon('files')}<strong title="${esc(file.path)}">${esc(basename)}</strong></div><span>${esc(extension)}<i></i>${size}${file.kind === 'text' && !file.truncated && /^(src|web)\//.test(file.path) ? `<button class="secondary" data-office="code-edit" data-id="${esc(file.path)}">${t('changes.explorer.writeChange')}</button>` : ''}</span></header>${file.kind === 'binary' ? `<div class="explorer-empty">${icon('files')}<h3>${t('changes.explorer.noPreview')}</h3><p>${esc(basename)}</p></div>` : `<div class="explorer-code"><div class="code-line-numbers" aria-hidden="true">${Array.from({length: Math.min(lineCount, 10000)}, (_, i) => i + 1).join('\n')}</div><pre><code>${esc(file.content)}</code></pre></div>`}<footer class="explorer-file-status"><span>${file.kind === 'text' ? t('changes.explorer.lines', {n: lineCount.toLocaleString()}) : t('changes.explorer.binary')}</span><span>${file.truncated ? t('changes.explorer.truncated') : t('changes.explorer.readOnly')}</span></footer>` : `<div class="explorer-empty"><div class="empty-file-mark">${icon('files')}</div><h3>${t('changes.explorer.noFileTitle')}</h3><p>${t('changes.explorer.noFileBody')}</p></div>`}</section></div>${gitView}</section>`;
  }
  return {
    render,
    click,
    composition: (event) => {
      if (event.target.id === 'project-file-query') {
        composing = event.type === 'compositionstart';
        clearTimeout(timer);
        if (!composing) {
          query = event.target.value;
          timer = setTimeout(() => void load(folder, 0, query), 300);
        }
      }
    },
    input: (event) => {
      if (event.target.id === 'project-file-query') {
        query = event.target.value;
        clearTimeout(timer);
        if (event.isComposing || composing) return;
        timer = setTimeout(() => void load(folder, 0, query), 300);
      }
    },
    search: (event) => {
      if (event.target.id === 'project-file-search') {
        event.preventDefault();
        void load(folder, 0, event.target.elements.query.value);
      }
    },
  };
}
