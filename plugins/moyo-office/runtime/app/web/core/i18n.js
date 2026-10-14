import ko from '../i18n/ko.js';
import en from '../i18n/en.js';

/**
 * Screen text by key (ADR 0061). Every user-facing string of a migrated screen comes from a
 * catalog in web/i18n; Korean is the source language and the fallback for a missing key. The
 * choice is a per-browser preference, so it lives in localStorage and never in project data.
 */
const catalogs = {ko, en};
export const languages = {ko: '한국어', en: 'English'};
const storageKey = 'aiorchestra.language';

function stored() {
  try {
    return globalThis.localStorage?.getItem(storageKey) ?? null;
  } catch {
    return null;
  }
}
/**
 * A window opened for a project runs on another port, so another origin with its own storage; the
 * opener passes its choice as ?lang=, which is kept and then taken out of the address.
 */
function passed() {
  const location = globalThis.location;
  const lang = location ? new URLSearchParams(location.search).get('lang') : null;
  if (!lang || !catalogs[lang]) return null;
  try {
    globalThis.localStorage?.setItem(storageKey, lang);
  } catch {
    // Without storage the choice still holds for this page.
  }
  const clean = new URL(location.href);
  clean.searchParams.delete('lang');
  globalThis.history?.replaceState(null, '', clean.pathname + clean.search + clean.hash);
  return lang;
}
let current = passed() ?? (catalogs[stored()] ? stored() : 'ko');

export function language() {
  return current;
}

/** Dates and numbers follow the screen language; the time zone stays the configured one. */
const locales = {ko: 'ko-KR', en: 'en-US'};
export function locale() {
  return locales[current];
}

/** `t('nav.work')`, or with values: `t('work.count', {n: 3})` for "{n}건". */
export function t(key, values) {
  const text = catalogs[current][key] ?? catalogs.ko[key] ?? key;
  return values
    ? text.replace(/\{(\w+)\}/g, (all, name) => (name in values ? String(values[name]) : all))
    : text;
}

/**
 * A fixed set of ids whose labels follow the language: `labels('nav', ['work'])['work']`. It still
 * behaves like the plain object it replaces (`in`, `Object.entries`).
 */
export function labels(prefix, ids) {
  const target = Object.fromEntries(ids.map((id) => [id, id]));
  const text = (id) => t(`${prefix}.${id}`);
  return new Proxy(target, {
    get: (o, id) => (typeof id === 'string' && Object.hasOwn(o, id) ? text(id) : undefined),
    getOwnPropertyDescriptor: (o, id) =>
      Object.hasOwn(o, id)
        ? {value: text(id), enumerable: true, configurable: true, writable: false}
        : undefined,
  });
}

/**
 * Static markup: data-i18n (text), data-i18n-label (aria-label), data-i18n-title, and
 * data-i18n-placeholder. data-i18n-values holds JSON values for {placeholders} the server filled.
 */
export function translatePage(root = globalThis.document) {
  if (!root) return;
  root.documentElement && (root.documentElement.lang = current);
  const values = (node) => {
    try {
      return node.dataset.i18nValues ? JSON.parse(node.dataset.i18nValues) : undefined;
    } catch {
      return undefined;
    }
  };
  for (const node of root.querySelectorAll('[data-i18n]'))
    node.textContent = t(node.dataset.i18n, values(node));
  for (const [attribute, key] of [
    ['aria-label', 'i18nLabel'],
    ['title', 'i18nTitle'],
    ['placeholder', 'i18nPlaceholder'],
  ])
    for (const node of root.querySelectorAll(`[data-${key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}]`))
      node.setAttribute(attribute, t(node.dataset[key], values(node)));
}

const listeners = new Set();
/** Re-render hooks for screens built from strings. */
export function onLanguageChange(listener) {
  listeners.add(listener);
}
export function setLanguage(next) {
  if (!catalogs[next] || next === current) return;
  current = next;
  try {
    globalThis.localStorage?.setItem(storageKey, next);
  } catch {
    // Private windows may refuse storage; the choice then lasts until the page is reloaded.
  }
  translatePage();
  for (const listener of listeners) listener(next);
}
