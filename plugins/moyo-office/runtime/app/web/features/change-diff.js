/* i18n: all text from catalogs */
import {lineDiff} from '../core/line-diff.js';
import {esc} from '../core/dom.js';
import {t, labels} from '../core/i18n.js';

const signs = labels('changes.diff.sign', ['same', 'add', 'remove']);
/** Marks a line comment resolved, or reopens it with `resolve` false. */
export function resolveButton(candidateId, commentId, resolve = true) {
  return `<button type="button" class="text-button" data-office="change-review-resolve" data-id="${esc(candidateId)}" data-review="${esc(commentId)}" data-resolved="${resolve}">${t(resolve ? 'changes.comment.resolve' : 'changes.comment.reopen')}</button>`;
}
/** A line comment shown under the line it points at (ADR 0057). */
function thread(comment, candidateId) {
  return `<div class="diff-thread ${comment.resolvedAt ? 'resolved' : ''}" role="note" aria-label="${esc(t('changes.diff.threadLabel', {path: comment.path, line: comment.line}))}"><p>${esc(comment.body)}</p><span class="caption">${comment.resolvedAt ? t('changes.comment.resolved') : t('changes.comment.open')}</span>${resolveButton(candidateId, comment.id, !comment.resolvedAt)}</div>`;
}
function row(r, line) {
  const sign = {same: ' ', add: '+', remove: '−'}[r.kind];
  const terminator = r.text.endsWith('\r\n')
    ? 'CRLF'
    : r.text.endsWith('\n')
      ? 'LF'
      : t('changes.diff.noEol');
  return `<div class="diff-line ${r.kind}"><span class="diff-number">${r.old ?? ''}</span><span class="diff-number">${r.next ?? ''}</span><span class="diff-sign" aria-label="${signs[r.kind]}">${sign}</span><code>${esc(r.text.replace(/\r?\n$/, ''))}</code><span class="diff-eol">${terminator}</span>${line(r)}</div>`;
}
/**
 * One file of a candidate. With `review` ({candidateId, hash, comments}), lines of the new version
 * get a comment button and the comments written on this version appear under their line.
 */
export function changeDiff(file, key, review) {
  const diff = lineDiff(file.before, file.content);
  const commentable = review && file.content !== null;
  const here = commentable
    ? (review.comments || []).filter((c) => c.path === file.path && c.candidateHash === review.hash)
    : [];
  const line = (r) =>
    commentable && r.next
      ? `<button type="button" class="diff-comment" data-office="change-line-comment" data-id="${esc(review.candidateId)}" data-path="${esc(file.path)}" data-line="${r.next}" aria-label="${esc(t('changes.comment.onLine', {path: file.path, line: r.next}))}">${t('changes.diff.comment')}</button>`
      : '';
  const render = (r) =>
    row(r, line) +
    (r.next
      ? here
          .filter((c) => c.line === r.next)
          .map((c) => thread(c, review.candidateId))
          .join('')
      : '');
  let body = '';
  for (let i = 0; i < diff.rows.length;) {
    if (diff.rows[i].kind !== 'same') {
      body += render(diff.rows[i++]);
      continue;
    }
    let end = i;
    while (end < diff.rows.length && diff.rows[end].kind === 'same') end++;
    const run = diff.rows.slice(i, end),
      head = i ? 3 : 0,
      tail = end < diff.rows.length ? 3 : 0;
    // Unchanged lines that carry a comment stay visible instead of folding away.
    const hidden = run.slice(head, run.length - tail);
    if (run.length > head + tail + 3 && !hidden.some((r) => here.some((c) => c.line === r.next))) {
      body += run.slice(0, head).map(render).join('');
      body += `<details class="diff-context" data-review-key="${esc(key + ':context:' + i)}"><summary>${t('changes.diff.expand', {n: hidden.length})}</summary>${hidden.map(render).join('')}</details>`;
      if (tail) body += run.slice(-tail).map(render).join('');
    } else body += run.map(render).join('');
    i = end;
  }
  return `<details class="change-file" data-review-key="${esc(key)}" open><summary><span class="diff-path">${esc(file.path)}</span><span class="diff-kind">${file.before === null ? t('changes.diff.newFile') : file.content === null ? t('changes.diff.deleted') : t('changes.diff.modified')}</span><span class="diff-count"><b>+${diff.added}</b><em>−${diff.removed}</em></span></summary>${diff.coarse ? `<p class="diff-caution">${t('changes.diff.coarse')}</p>` : ''}<div class="diff-scroll" tabindex="0" role="region" aria-label="${esc(t('changes.diff.region', {path: file.path}))}"><div class="diff-columns"><span>${t('changes.diff.before')}</span><span>${t('changes.diff.after')}</span><span></span><span>${t('changes.diff.content')}</span><span>${t('changes.diff.eol')}</span></div>${body || `<p class="diff-empty">${t('changes.diff.empty')}</p>`}</div></details>`;
}
