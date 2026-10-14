import {esc} from '../core/dom.js';
import {t, locale} from '../core/i18n.js';
export function latestPresenceUsage(id, state) {
  return (state.presenceUsage || [])
    .filter((u) => u.person === id)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
}
export function usageBadge(id, state) {
  const u = latestPresenceUsage(id, state);
  return `<small class="presence-usage-badge">${!u ? t('tokens.missing') : u.session.total === null ? t('tokens.partialBadge') : t('tokens.badge', {n: new Intl.NumberFormat(locale(), {notation: 'compact', maximumFractionDigits: 1}).format(u.session.total)})}</small>`;
}
export function presenceUsagePanel(person, state) {
  const u = latestPresenceUsage(person.id, state),
    fmt = (n) =>
      n === null || n === undefined ? t('tokens.unknown') : new Intl.NumberFormat(locale()).format(n);
  if (!u)
    return `<section class="presence-token-panel" data-person="${esc(person.id)}"><h3>${t('tokens.title')}</h3><p>${t('tokens.missing')}</p></section>`;
  const fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'total'];
  const counts = (c) =>
    `<dl class="presence-token-grid">${fields.map((k) => `<div><dt>${t('tokens.' + k)}</dt><dd>${fmt(c?.[k])}</dd></div>`).join('')}</dl>`;
  const turns = (state.presenceUsage || [])
    .filter((v) => v.person === person.id && v.turn)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
    .slice(0, 20);
  return `<section class="presence-token-panel" data-person="${esc(person.id)}"><header><h3>${t('tokens.title')}</h3><span>${Object.values(u.session).some((v) => v === null) ? t('tokens.partialBadge') : t('tokens.measured')}</span></header><p>${esc(t('tokens.modelObserved', {model: u.model || t('tokens.unknownModel')}))} · ${esc(new Date(u.observedAt).toLocaleString(locale()))}</p><h4>${t('tokens.session')}</h4>${counts(u.session)}<details><summary>${t('tokens.turn')}</summary>${u.currentTurn && u.turn === person.turn ? counts(u.currentTurn) : `<p>${t('tokens.partial')}</p>`}</details><details><summary>${t('tokens.lastCall')}</summary>${counts(u.lastCall)}</details><details><summary>${t('tokens.history')}</summary>${turns.map((v) => `<article><strong>${esc(v.turn.slice(0, 12))}</strong><time>${esc(new Date(v.observedAt).toLocaleString(locale()))}</time>${v.currentTurn ? counts(v.currentTurn) : `<p>${t('tokens.partial')}</p>`}</article>`).join('')}</details><small>${t('tokens.note')}</small></section>`;
}
