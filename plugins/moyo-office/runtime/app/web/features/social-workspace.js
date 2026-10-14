import {api} from '../core/api.js';
import {esc} from '../core/dom.js';
import {t, locale} from '../core/i18n.js';
export function createSocialWorkspace(changed) {
  let state,
    busy = false,
    error = '',
    message = '',
    pending;
  const assignments = new Map();
  const drafts = {
    connect: {platform: 'threads', apiVersion: 'v25.0', userId: '', token: ''},
    draft: {accountId: '', text: '', imageUrl: ''},
  };
  const tx = (k) => t('social.' + k);
  async function load() {
    busy = true;
    error = '';
    changed();
    try {
      state = await api('/api/social');
      if (!drafts.draft.accountId) drafts.draft.accountId = state.accounts[0]?.id || '';
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
      changed();
    }
  }
  function render() {
    if (!state && !busy && !error) queueMicrotask(load);
    const a = state?.accounts.find((a) => a.id === drafts.draft.accountId),
      c = drafts.connect;
    return `<section class="social-workspace"><header class="section-heading"><div><span class="social-eyebrow">THREADS / INSTAGRAM</span><h2>${tx('title')}</h2><p>${tx('intro')}</p></div><button data-social="reload" ${busy ? 'disabled' : ''}>${tx('refresh')}</button></header>${error ? `<p role="alert">${esc(tx('error'))} · ${esc(error)}${pending ? `<button data-social="retry">${tx('retry')}</button>` : ''}</p>` : ''}${message ? `<p role="status">${esc(message)}</p>` : ''}<div class="social-columns"><section class="social-accounts"><h3>${tx('accounts')}</h3>${(state?.accounts || []).map((a) => `<article class="social-account"><header><strong>@${esc(a.username)}</strong><span>${esc(a.platform)}</span></header><p>${esc(a.userId)} · ${esc(a.apiVersion)}</p><label>${tx('marketer')}<select id="social-assign-${esc(a.id)}" data-social-assign="${esc(a.id)}" data-version="${a.version}" ${busy ? 'disabled' : ''}><option value="">${tx('unassigned')}</option>${(state?.employees || []).map((p) => `<option value="${esc(p.id)}" ${p.id === (assignments.get(a.id) ?? a.employeeId) ? 'selected' : ''}>${esc(p.label)}${p.role ? ' · ' + esc(p.role) : ''}</option>`).join('')}</select></label><button data-social="assign" data-id="${a.id}" data-version="${a.version}" ${busy ? 'disabled' : ''}>${tx('assign')}</button><button data-social="disconnect" data-id="${a.id}" data-version="${a.version}" ${busy ? 'disabled' : ''}>${tx('disconnect')}</button></article>`).join('') || `<p>${tx('noAccounts')}</p>`}<details class="social-connect"><summary>${tx('connect')}</summary><p>${tx('tokenHint')}</p><a href="https://developers.facebook.com/docs/threads/get-started/" target="_blank" rel="noreferrer">Threads API ↗</a> · <a href="https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/" target="_blank" rel="noreferrer">Instagram API ↗</a><form data-social-form="connect"><label>${tx('platform')}<select id="social-connect-platform" name="platform"><option value="threads" ${c.platform === 'threads' ? 'selected' : ''}>Threads</option><option value="instagram" ${c.platform === 'instagram' ? 'selected' : ''}>Instagram</option></select></label><label>${tx('userId')}<input id="social-connect-userId" name="userId" value="${esc(c.userId)}" inputmode="numeric" pattern="[0-9]+" required maxlength="40"></label><label>${tx('apiVersion')}<input id="social-connect-apiVersion" name="apiVersion" value="${esc(c.apiVersion)}" pattern="v[0-9]{1,2}\\.0" required></label><label>${tx('token')}<input id="social-connect-token" name="token" type="password" value="${esc(c.token)}" autocomplete="off" required maxlength="512"></label><button ${busy ? 'disabled' : ''}>${tx('verifyConnect')}</button></form></details><p class="caption">${tx('boundary')}</p></section><section class="social-compose"><h3>${tx('compose')}</h3><form data-social-form="draft"><label>${tx('account')}<select id="social-draft-accountId" name="accountId" ${busy ? 'disabled' : ''} required><option value="">${tx('choose')}</option>${(state?.accounts || []).map((a) => `<option value="${a.id}" ${a.id === drafts.draft.accountId ? 'selected' : ''}>${esc(a.platform)} · @${esc(a.username)}</option>`).join('')}</select></label><label>${tx('body')}<textarea id="social-draft-text" name="text" rows="8" maxlength="${a?.platform === 'threads' ? 500 : 2200}" required ${busy ? 'disabled' : ''}>${esc(drafts.draft.text)}</textarea></label><p class="caption">${[...drafts.draft.text].length} / ${a?.platform === 'threads' ? 500 : 2200}</p>${a?.platform === 'instagram' ? `<label>${tx('image')}<input type="url" id="social-draft-imageUrl" name="imageUrl" value="${esc(drafts.draft.imageUrl)}" required placeholder="https://…" ${busy ? 'disabled' : ''}></label><p class="caption">${tx('imageHint')}</p>` : ''}<button ${busy || !a ? 'disabled' : ''}>${tx('saveDraft')}</button></form></section></div><section class="social-publications"><h3>${tx('queue')}</h3>${(state?.drafts || []).map((d) => `<article class="social-publication"><header><strong>${esc(state.accounts.find((a) => a.id === d.accountId)?.username || tx('disconnected'))}</strong><span class="social-state">${esc(tx(d.state))}</span></header><p class="social-post-text">${esc(d.text)}</p>${d.imageUrl ? `<p class="caption">${esc(d.imageUrl)}</p>` : ''}<footer><time>${esc(new Date(d.updatedAt).toLocaleString(locale()))}</time><span>${esc(state.employees.find((p) => p.id === d.employeeId)?.label || tx('unassigned'))}</span></footer>${d.state === 'UNKNOWN' ? `<p role="alert">${tx('unknownHint')}</p>` : ''}${d.postId ? `<p>${tx('postId')}: ${esc(d.postId)}</p>` : ''}${['DRAFT', 'APPROVED', 'READY'].includes(d.state) ? `<button data-social="${{DRAFT: 'approve', APPROVED: 'prepare', READY: 'publish'}[d.state]}" data-id="${d.id}" data-version="${d.version}" ${busy ? 'disabled' : ''}>${tx({DRAFT: 'approve', APPROVED: 'prepare', READY: 'publish'}[d.state])}</button>` : ''}</article>`).join('') || `<p>${tx('noDrafts')}</p>`}</section><details><summary>${tx('agentTools')}</summary><p>${tx('agentHint')}</p><code>node scripts/office-social.cjs --project "${esc(state?.projectRoot || '.')}" list</code><p>${tx('agentDoc')}</p></details></section>`;
  }
  function input(e) {
    if (e.target.dataset.socialAssign) assignments.set(e.target.dataset.socialAssign, e.target.value);
    const f = e.target.closest('[data-social-form]');
    if (!f || !e.target.name) return;
    drafts[f.dataset.socialForm][e.target.name] = e.target.value;
    if (e.target.name === 'accountId') changed();
  }
  async function run(action, data, version = 0) {
    if (
      pending &&
      JSON.stringify([action, data, version]) !==
        JSON.stringify([pending.action, pending.data, pending.version])
    ) {
      error = tx('pendingHint');
      changed();
      return;
    }
    busy = true;
    error = '';
    message = '';
    pending ||= {action, data, version, key: crypto.randomUUID()};
    changed();
    try {
      const result = await api('/api/office/social', pending);
      message = tx(result.state === 'UNKNOWN' ? 'unknownHint' : 'saved');
      pending = null;
      if (action === 'connect') drafts.connect.token = '';
      if (action === 'draft') {
        drafts.draft.text = '';
        drafts.draft.imageUrl = '';
      }
      state = await api('/api/social');
      if (!drafts.draft.accountId) drafts.draft.accountId = state.accounts[0]?.id || '';
    } catch (e) {
      error = e.message;
      if (e.message !== 'REQUEST_TIMEOUT' && e.message !== 'NETWORK_ERROR') pending = null;
    } finally {
      busy = false;
      changed();
    }
  }
  async function submit(e) {
    const f = e.target.closest('[data-social-form]');
    if (!f) return;
    e.preventDefault();
    if (busy) return;
    await run(f.dataset.socialForm, {...drafts[f.dataset.socialForm]});
  }
  async function click(e) {
    const b = e.target.closest('[data-social]');
    if (!b || busy) return;
    const action = b.dataset.social;
    if (action === 'retry' && pending) {
      await run(pending.action, pending.data, pending.version);
      return;
    }
    if (action === 'reload') {
      await load();
      return;
    }
    if (action === 'publish' && !confirm(tx('confirmPublish'))) return;
    if (action === 'disconnect' && !confirm(tx('confirmDisconnect'))) return;
    await run(
      action,
      {
        id: b.dataset.id,
        ...(action === 'assign'
          ? {employeeId: document.querySelector(`[data-social-assign="${b.dataset.id}"]`).value}
          : {}),
      },
      Number(b.dataset.version),
    );
  }
  return {render, input, submit, click};
}
