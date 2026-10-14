const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char],
  );
// Stable identity for <details> and scroll containers across a re-render: explicit keys first,
// otherwise the summary text / class, with an occurrence index for duplicates.
function viewKeys(root, selector, keyOf) {
  const seen = new Map();
  return [...root.querySelectorAll(selector)].map((el) => {
    const base = keyOf(el);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return [base + '#' + n, el];
  });
}
const detailsKey = (el) =>
  el.dataset.reviewKey || el.id || (el.querySelector(':scope > summary')?.textContent || '').trim();
const scrollKey = (el) => el.id || el.dataset.reviewKey || el.className || el.tagName;
function html(node, value) {
  if (node.innerHTML === value) return;
  // Polling re-renders must not close what the user opened or jump their scroll position.
  const opened = new Map(viewKeys(node, 'details', detailsKey).map(([key, el]) => [key, el.open]));
  const scrolled = new Map(
    viewKeys(node, '*', scrollKey)
      .filter(([, el]) => el.scrollTop > 0 || el.scrollLeft > 0)
      .map(([key, el]) => [key, [el.scrollTop, el.scrollLeft]]),
  );
  const pageY = window.scrollY;
  const active = document.activeElement,
    inside = node.contains(active);
  const identity = inside
    ? {
        id: active.id,
        href: active.getAttribute('href'),
        filter: active.dataset.filter,
        tab: active.dataset.detailTab,
        action: active.dataset.action,
        office: active.dataset.office,
        recordId: active.dataset.id,
        node: active.dataset.node,
        start: active.selectionStart,
        end: active.selectionEnd,
      }
    : null;
  node.innerHTML = value;
  for (const [key, el] of viewKeys(node, 'details', detailsKey))
    if (opened.has(key)) el.open = opened.get(key);
  if (scrolled.size)
    for (const [key, el] of viewKeys(node, '*', scrollKey))
      if (scrolled.has(key)) [el.scrollTop, el.scrollLeft] = scrolled.get(key);
  if (window.scrollY !== pageY) window.scrollTo(window.scrollX, pageY);
  if (!identity) return;
  // The first identity the focused control had decides how its replacement is found.
  const sameControl = (item) => {
    if (identity.id) return item.id === identity.id;
    if (identity.href) return item.getAttribute('href') === identity.href;
    if (identity.filter) return item.dataset.filter === identity.filter;
    if (identity.tab) return item.dataset.detailTab === identity.tab;
    if (identity.action) return item.dataset.action === identity.action;
    if (identity.office)
      return (
        item.dataset.office === identity.office &&
        item.dataset.id === identity.recordId &&
        item.dataset.node === identity.node
      );
    return false;
  };
  const target = [...node.querySelectorAll('a,button,input,select,textarea')].find(sameControl);
  if (target && !target.disabled) {
    target.focus({preventScroll: true});
    if (typeof identity.start === 'number' && target.setSelectionRange)
      target.setSelectionRange(identity.start, identity.end);
  }
}
function openDialog(id) {
  const dialog = $('#' + id);
  if (!dialog.open) dialog.showModal();
  for (const body of dialog.querySelectorAll('.office-form-body,#office-viewer-content,.composer-body'))
    body.scrollTop = 0;
  dialog.querySelector('input:not([type=hidden]),textarea,select')?.focus({preventScroll: true});
}
export {$, $$, esc, html, openDialog};
