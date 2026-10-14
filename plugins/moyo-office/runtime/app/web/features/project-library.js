import {api} from '../core/api.js';
import {esc} from '../core/dom.js';
import {t, locale} from '../core/i18n.js';
import {renderMarkdown} from '../vendor/markdown.js';
export function createProjectLibrary(changed) {
  let index,
    file,
    error = '',
    busy = false,
    query = '',
    category = '',
    draftQuery = '',
    draftCategory = '',
    generation = 0;
  const drafts = new Map();
  const commentDrafts = new Map();
  let document,
    editing = false,
    documentMessage = '',
    commentText = '',
    pending;
  const editable = (f) =>
    f?.kind === 'text' &&
    !f.truncated &&
    /^(docs|design|artifacts|deliverables|reports)\//.test(f.path) &&
    /\.(md|txt)$/i.test(f.path) &&
    !f.path.split('/').includes('history');
  addEventListener('beforeunload', (e) => {
    if (drafts.size || commentDrafts.size) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  const text = (key) => t('library.' + key);
  async function load() {
    const revision = ++generation;
    busy = true;
    error = '';
    changed();
    try {
      const next = await api('/api/project-files?view=library');
      if (revision === generation) index = next;
    } catch (e) {
      if (revision === generation) error = e.message;
    } finally {
      if (revision === generation) {
        busy = false;
        changed();
      }
    }
  }
  function render() {
    if (!index && !busy && !error) queueMicrotask(load);
    const rows = (index?.documents || []).filter(
      (d) =>
        (!category || d.category === category) &&
        (d.title + ' ' + d.name + ' ' + d.path).toLowerCase().includes(query.toLowerCase()),
    );
    const preview = file
      ? `<section class="project-library-reader"><header><div><h3>${esc(file.path.split('/').pop())}</h3><small>${esc(file.path)}</small></div><button data-library="close">${text('close')}</button></header>${editable(file) ? `<div class="library-document-actions"><button data-library="edit" ${busy || !document ? 'disabled' : ''}>${text('edit')}</button><span>${document ? 'v ' + document.snapshot.slice(0, 8) : text('loading')}</span></div>` : ''}${editing ? `<label class="library-edit-label">${text('body')}<textarea id="library-document-body" rows="16" maxlength="262144" ${busy ? 'disabled' : ''}>${esc(drafts.get(file.path) ?? file.content)}</textarea></label><div class="library-document-actions"><button data-library="save" ${busy ? 'disabled' : ''}>${text('save')}</button><button data-library="cancel-edit">${text('cancelEdit')}</button><button data-library="latest" ${busy ? 'disabled' : ''}>${text('latest')}</button></div><details class="library-current-source"><summary>${text('currentSource')}</summary><pre>${esc(file.content)}</pre></details>` : file.kind === 'text' ? (/\.md$/i.test(file.path) ? `<article class="artifact-document">${renderMarkdown(file.content)}</article>` : `<pre>${esc(file.content)}</pre>`) : `<p>${text('binary')}</p>`}${documentMessage ? `<p role="status" class="library-document-message">${esc(documentMessage)}</p>` : ''}${document ? `<section class="library-comments"><h4>${text('comments')}</h4><p class="caption">${text('commentHint')}</p>${document.comments.map((c) => `<article><header><strong>${text('commentAuthor')}</strong><time>${esc(new Date(c.at).toLocaleString(locale()))}</time></header><p>${esc(c.text)}</p>${c.outdated ? `<small>${text('oldComment')}</small>` : ''}</article>`).join('') || `<p>${text('noComments')}</p>`}<label>${text('commentBody')}<textarea id="library-comment-body" rows="3" maxlength="4000" ${busy ? 'disabled' : ''}>${esc(commentText)}</textarea></label><button data-library="comment" ${busy ? 'disabled' : ''}>${text('commentSave')}</button></section>` : ''}${file.truncated ? `<p role="status">${text('truncated')}</p>` : ''}</section>`
      : '';
    return `<section class="project-library"><header class="section-heading"><div><h2>${text('title')}</h2><p>${text('intro')}</p></div><button data-library="reload" ${busy ? 'disabled' : ''}>${text('refresh')}</button></header><form id="project-library-filter"><label>${text('search')}<input name="query" value="${esc(draftQuery)}" maxlength="200" placeholder="${text('search')}"></label><label>${text('category')}<select name="category"><option value="">${text('all')}</option>${['docs', 'design', 'artifacts', 'deliverables', 'reports', 'project'].map((c) => `<option value="${c}" ${draftCategory === c ? 'selected' : ''}>${text(c)}</option>`).join('')}</select></label><button>${text('filter')}</button></form>${error ? `<p role="alert">${esc(error)} <button data-library="reload">${text('retry')}</button></p>` : ''}${busy ? `<p role="status">${text('loading')}</p>` : ''}${index?.limited ? `<p>${text('limited')}</p>` : ''}${preview}<div class="project-library-grid">${rows.map((d) => `<button class="project-document-card" data-library="read" data-path="${esc(d.path)}"><span class="document-kind">${text(d.category)} · ${esc(d.name.split('.').pop().toUpperCase())}</span><strong>${esc(d.title || d.name)}</strong><small>${esc(d.path)}</small><footer><span>${esc(new Date(d.updatedAt).toLocaleDateString(locale()))}</span><span>${Math.ceil(d.bytes / 1024)} KB</span></footer></button>`).join('') || (!busy ? `<p>${text('empty')}</p>` : '')}</div><p class="caption">${text('authorNote')}</p></section>`;
  }
  async function click(event) {
    const b = event.target.closest('[data-library]');
    if (!b || busy) return;
    if (['edit', 'cancel-edit', 'save', 'comment', 'latest'].includes(b.dataset.library)) {
      if (!document || busy) return;
      const action = b.dataset.library;
      if (action === 'edit') {
        editing = true;
        changed();
        return;
      }
      if (action === 'cancel-edit') {
        editing = false;
        changed();
        return;
      }
      busy = true;
      documentMessage = '';
      changed();
      const activePath = file.path;
      let persisted = false;
      try {
        if (action === 'latest') {
          document = await api('/api/project-documents?' + new URLSearchParams({path: activePath}));
          file = document;
          pending = null;
          documentMessage = text('latestLoaded');
        } else {
          const intent = {
            action: action === 'save' ? 'save' : 'comment',
            path: activePath,
            snapshot: document.snapshot,
            text: action === 'save' ? (drafts.get(activePath) ?? file.content) : commentText,
          };
          if (!pending || JSON.stringify(pending.intent) !== JSON.stringify(intent))
            pending = {intent, key: crypto.randomUUID()};
          const result = await api('/api/office/project-document', {...intent, key: pending.key});
          persisted = true;
          if (action === 'save') {
            document = {...document, snapshot: result.snapshot, content: intent.text};
            file = document;
          }
          pending = null;
          if (action === 'save') {
            drafts.delete(activePath);
            editing = false;
          } else {
            commentText = '';
            commentDrafts.delete(activePath);
          }
          documentMessage = text('saved');
          document = await api('/api/project-documents?' + new URLSearchParams({path: activePath}));
          file = document;
        }
      } catch (e) {
        documentMessage = persisted
          ? text('savedRefreshFailed')
          : ['DOCUMENT_CONFLICT', 'DOCUMENT_SAVE_UNKNOWN'].includes(e.message)
            ? text('conflict')
            : text('saveFailed');
      } finally {
        busy = false;
        changed();
      }
      return;
    }
    if (b.dataset.library === 'reload') return load();
    if (b.dataset.library === 'close') {
      file = null;
      document = null;
      editing = false;
      changed();
      return;
    }
    if (b.dataset.library !== 'read') return;
    document = null;
    editing = false;
    documentMessage = '';
    commentText = '';
    const revision = ++generation;
    busy = true;
    error = '';
    changed();
    try {
      const next = await api(
        '/api/project-files?' + new URLSearchParams({view: 'file', path: b.dataset.path}),
      );
      if (revision === generation) {
        file = next;
        commentText = commentDrafts.get(next.path) || '';
      }
      if (editable(next)) {
        const detail = await api('/api/project-documents?' + new URLSearchParams({path: next.path}));
        if (revision === generation) document = detail;
      }
    } catch (e) {
      if (revision === generation) error = e.message;
    } finally {
      if (revision === generation) {
        busy = false;
        changed();
      }
    }
  }
  function search(event) {
    if (event.target.id !== 'project-library-filter') return;
    event.preventDefault();
    query = event.target.elements.query.value;
    category = event.target.elements.category.value;
    changed();
  }
  function input(event) {
    if (event.target.id === 'library-document-body') {
      if (event.target.value === file.content) drafts.delete(file.path);
      else drafts.set(file.path, event.target.value);
    }
    if (event.target.id === 'library-comment-body') {
      commentText = event.target.value;
      if (commentText) commentDrafts.set(file.path, commentText);
      else commentDrafts.delete(file.path);
    }
    if (event.target.closest('#project-library-filter')) {
      draftQuery = event.target.closest('form').elements.query.value;
      draftCategory = event.target.closest('form').elements.category.value;
    }
  }
  return {render, click, search, input};
}
