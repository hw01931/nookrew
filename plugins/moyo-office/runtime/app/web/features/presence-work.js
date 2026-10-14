import {api} from '../core/api.js';
import {esc} from '../core/dom.js';
import {t, locale} from '../core/i18n.js';
export function presenceWorkPanel(person, state) {
  const text = (k) => t('presenceWork.' + k);
  const all = (state.presenceWorkLinks || []).filter((l) => l.presenceId === person.id);
  const links = all.filter((l) => !l.removedAt);
  const works = state.entities.filter(
    (e) => e.kind === 'work' && !['DONE', 'CLOSED', 'CANCELED'].includes(e.data.status),
  );
  const records = links
    .map(
      (l) =>
        `<article><div><button data-office="work-details" data-id="${esc(l.workId)}" ${l.referenceStatus === 'BROKEN' ? 'disabled' : ''}>${esc(l.title || l.workId)}</button><small>v${l.workVersion}${l.versionChanged ? ' · ' + text('changed') : ''} · ${esc(new Date(l.updatedAt).toLocaleDateString(locale()))}</small>${l.referenceStatus === 'BROKEN' ? `<p>${text('broken')}</p>` : ''}</div><button data-presence-unlink="${esc(l.id)}">${text('unlink')}</button></article>`,
    )
    .join('');
  const history = all
    .flatMap((l) =>
      (l.history || []).map(
        (h) =>
          `<p>${esc(l.title || l.workId)} · ${text(h.action)} · ${esc(h.actor)} · ${esc(new Date(h.at).toLocaleString(locale()))}</p>`,
      ),
    )
    .join('');
  return `<section class="presence-work session-related-work"><header><h3>${text('title')}</h3></header><div class="presence-work-links">${records || `<p class="presence-work-empty">${text('empty')}</p>`}</div><details class="presence-work-compose"><summary>${text('connect')}</summary><p>${text('note')}</p>${works.length ? `<form id="presence-work-link" data-person="${esc(person.id)}"><label class="office-field">${text('search')}<input type="search" data-presence-work-search placeholder="${text('search')}"></label><label class="office-field">${text('choose')}<select name="workId" required><option value="">${text('selectPlaceholder')}</option>${works.map((w) => `<option value="${esc(w.id)}">${esc(w.data.title)} · v${w.version}</option>`).join('')}</select></label><div role="status" class="presence-work-confirm"></div><button type="submit" ${!works.length || person.status === 'CLOSED' ? 'disabled' : ''}>${text('review')}</button></form>` : `<p>${text('noWorks')}</p>`}<button class="presence-work-new" data-office="new-work">${text('new')}</button></details>${history ? `<details class="presence-work-history"><summary>${text('history')}</summary>${history}</details>` : ''}<p role="alert" class="presence-work-error"></p></section>`;
}
export function linkedSessions(work, state) {
  const links = (state.presenceWorkLinks || []).filter((l) => l.workId === work.id && !l.removedAt);
  if (!state.presence?.length && !links.length) return '';
  return `<section class="presence-work"><h3>${t('presenceWork.sessions')}</h3>${
    links
      .map((l) => {
        const p = state.presence?.find((p) => p.id === l.presenceId);
        return `<article>${p ? `<button data-office="pixel-chat" data-id="${esc(p.id)}">${esc(p.label || p.session)} · ${t('pixel.state.' + p.status)}</button><small>${esc(p.event)} · ${esc(new Date(p.updatedAt).toLocaleString(locale()))}</small>` : `<p>${t('presenceWork.broken')}</p>`}${l.versionChanged ? `<p>${t('presenceWork.changed')}</p>` : ''}</article>`;
      })
      .join('') || `<p>${t('presenceWork.empty')}</p>`
  }</section>`;
}
export function bindPresenceWork({getState, saved}) {
  const text = (k) => t('presenceWork.' + k);
  let review;
  async function submit(event) {
    if (event.target.id !== 'presence-work-link') return;
    event.preventDefault();
    const form = event.target,
      state = getState(),
      person = state.presence.find((p) => p.id === form.dataset.person),
      work = state.entities.find((w) => w.id === form.elements.workId.value);
    if (!person || !work) return;
    const signature = [person.id, work.id].join(':');
    if (review?.signature !== signature) {
      review = {signature, person, work, key: crypto.randomUUID()};
      form.querySelector('.presence-work-confirm').textContent = [
        state.projectRoot,
        person.label || person.session,
        t('pixel.state.' + person.status),
        work.data.title,
        'v' + work.version,
        text('note'),
      ].join(' · ');
      form.querySelector('button').textContent = text('confirm');
      return;
    }
    const b = form.querySelector('button');
    b.disabled = true;
    const existing = (state.presenceWorkLinks || []).find(
      (l) => l.presenceId === person.id && l.workId === work.id,
    );
    let persisted = false;
    try {
      await api('/api/office/presence-work-link', {
        id: person.id,
        version: review.person.version,
        workId: work.id,
        workVersion: review.work.version,
        linkVersion: existing?.version || 0,
        linked: true,
        key: review.key,
      });
      persisted = true;
      review = null;
      await saved(person.id);
    } catch (e) {
      form.closest('.presence-work').querySelector('.presence-work-error').textContent = persisted
        ? text('refreshFailed')
        : /VERSION_CONFLICT/.test(e.message)
          ? text('conflict')
          : text('failed') + ' · ' + e.message;
      review = null;
      form.querySelector('button').textContent = text('review');
    } finally {
      b.disabled = false;
    }
  }
  async function click(event) {
    const b = event.target.closest('[data-presence-unlink]');
    if (!b) return;
    const state = getState(),
      link = state.presenceWorkLinks.find((l) => l.id === b.dataset.presenceUnlink),
      p = state.presence.find((p) => p.id === link.presenceId),
      w = state.entities.find((w) => w.id === link.workId);
    if (!p || !w) return;
    b.disabled = true;
    let persisted = false;
    try {
      await api('/api/office/presence-work-link', {
        id: p.id,
        version: p.version,
        workId: w.id,
        workVersion: w.version,
        linkVersion: link.version,
        linked: false,
        key: crypto.randomUUID(),
      });
      persisted = true;
      await saved(p.id);
    } catch (e) {
      b.closest('.presence-work').querySelector('.presence-work-error').textContent = persisted
        ? text('refreshFailed')
        : /VERSION_CONFLICT/.test(e.message)
          ? text('conflict')
          : text('failed') + ' · ' + e.message;
      b.disabled = false;
    }
  }
  function input(event) {
    if (!event.target.matches('[data-presence-work-search]')) return;
    const form = event.target.closest('form'),
      query = event.target.value.toLowerCase();
    const works = getState().entities.filter(
      (w) =>
        w.kind === 'work' &&
        !['DONE', 'CLOSED', 'CANCELED'].includes(w.data.status) &&
        String(w.data.title).toLowerCase().includes(query),
    );
    form.elements.workId.innerHTML =
      `<option value="">${text('selectPlaceholder')}</option>` +
      works.map((w) => `<option value="${esc(w.id)}">${esc(w.data.title)} · v${w.version}</option>`).join('');
    review = null;
    form.querySelector('button').textContent = text('review');
    form.querySelector('button').disabled = !works.length;
    form.querySelector('.presence-work-confirm').textContent = '';
  }
  return {submit, click, input};
}
