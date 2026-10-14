import {t} from '../core/i18n.js';
/** Translate generated observer metadata; preserve user-authored labels and roles. */
export function presenceRole(role) {
  const key = {
    'desktop · 실행 기록 관찰': 'pixel.desktopRole',
    'desktop-observer': 'pixel.desktopRole',
    main: 'pixel.mainRole',
    subagent: 'pixel.subagentRole',
  }[role];
  return key ? t(key) : role;
}
export function presenceName(person) {
  return person.label === 'Codex · 현재 대화'
    ? t('pixel.currentCodex')
    : person.label || person.provider + ' · ' + (person.agent || person.session || '').slice(0, 8);
}
