import {esc} from '../core/dom.js';
import {t} from '../core/i18n.js';

export const officeThemes = {
  cozy: {floor: '#ead6b5', wall: '#dddccc', rug: '#cbdccf', accent: '#4f8174'},
  cloud: {floor: '#e5e4df', wall: '#dbe5ee', rug: '#ccdbea', accent: '#537f9b'},
  peach: {floor: '#eed0b7', wall: '#f0e1d6', rug: '#ead1c7', accent: '#a26b65'},
};
const fields = ['floor', 'wall', 'rug', 'accent'];
const drafts = new Map();
const key = (root) => 'office-theme:v1:' + root;
export function readOfficeTheme(root) {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(key(root)));
  } catch {
    /* defaults remain usable */
  }
  const theme = Object.hasOwn(officeThemes, saved?.theme) ? saved.theme : 'cozy';
  const colors = {...officeThemes[theme]};
  for (const field of fields)
    if (/^#[\da-f]{6}$/i.test(saved?.colors?.[field])) colors[field] = saved.colors[field];
  return {theme, colors};
}
export function officeThemeStyle(root) {
  const colors = readOfficeTheme(root).colors;
  const channels = colors.accent
    .slice(1)
    .match(/../g)
    .map((value) => parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return (
    Object.entries(colors)
      .map(([key, value]) => `--office-${key}:${value}`)
      .join(';') +
    ';--office-accent-ink:' +
    (luminance > 0.179 ? '#000000' : '#ffffff')
  );
}
export function officeThemeControl(root) {
  const {theme, colors} = drafts.get(root)?.values || readOfficeTheme(root);
  return `<details class="office-theme-control" ${drafts.get(root)?.open ? 'open' : ''}><summary>${t('pixel.theme')}</summary><form data-office-theme><label>${t('pixel.themePreset')}<select name="theme" aria-label="${t('pixel.themePreset')}">${Object.keys(
    officeThemes,
  )
    .map((id) => `<option value="${id}" ${id === theme ? 'selected' : ''}>${t('pixel.theme.' + id)}</option>`)
    .join(
      '',
    )}</select></label><div class="office-theme-colors">${fields.map((field) => `<label>${t('pixel.theme.' + field)}<input type="color" name="${field}" value="${esc(colors[field])}"></label>`).join('')}</div><button type="submit">${t('pixel.themeSave')}</button><button type="button" data-theme-reset>${t('pixel.themeReset')}</button><small role="status" data-theme-status></small></form></details>`;
}
export function bindOfficeTheme(host, root, refresh) {
  const form = host.querySelector('[data-office-theme]');
  if (!form) return;
  const remember = () =>
    drafts.set(root, {
      open: true,
      values: {
        theme: form.elements.theme.value,
        colors: Object.fromEntries(fields.map((field) => [field, form.elements[field].value])),
      },
    });
  form.addEventListener('input', remember);
  form.closest('details').addEventListener('toggle', () => {
    if (!form.isConnected) return;
    drafts.set(root, {...(drafts.get(root) || {}), open: form.closest('details').open});
  });
  form.elements.theme.addEventListener('change', () => {
    const values = officeThemes[form.elements.theme.value];
    if (values) for (const field of fields) form.elements[field].value = values[field];
    remember();
  });
  const save = (reset = false) => {
    try {
      if (reset) localStorage.removeItem(key(root));
      else
        localStorage.setItem(
          key(root),
          JSON.stringify({
            theme: form.elements.theme.value,
            colors: Object.fromEntries(fields.map((field) => [field, form.elements[field].value])),
          }),
        );
      drafts.delete(root);
      refresh();
    } catch {
      form.querySelector('[data-theme-status]').textContent = t('pixel.themeFailed');
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
  form.querySelector('[data-theme-reset]').addEventListener('click', () => save(true));
}
