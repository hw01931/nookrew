import {esc} from '../core/dom.js';
import {t, language} from '../core/i18n.js';
import {officeCharacter} from './office-character.js';
import {officeAvatarOptions, officeAppearance} from './office-art.js';
import {presenceUsagePanel} from './presence-usage.js';
import {presenceWorkPanel} from './presence-work.js';
import {presenceRole} from './presence-labels.js';
export function presenceDetail(observed, state) {
  const id = observed.id;
  return `<div class="session-detail">
          <header class="session-profile"><div class="session-portrait">${officeCharacter(id, state.projectRoot)}</div><div><span class="session-provider">${esc(observed.provider)} <span>· ${esc(observed.session.slice(0, 8))}</span></span><strong>${esc(presenceRole(observed.role))}</strong><span class="office-roster-state" data-status="${esc(observed.status)}">${esc(t('pixel.state.' + observed.status))}</span></div></header>
          <section class="session-activity"><span>${t('pixel.lastEvent')}</span><div><strong>${esc(observed.status === 'RUNNING' && observed.activity && observed.activity !== 'WORK' ? t('pixel.action.' + observed.activity) : t('pixel.state.' + observed.status))}</strong><time datetime="${esc(observed.updatedAt)}">${esc(new Date(observed.updatedAt).toLocaleString(language() === 'ko' ? 'ko-KR' : 'en-US', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'}))}</time></div></section>
          <button type="button" class="session-play" data-game-with="${esc(id)}" ${observed.status === 'IDLE' ? '' : 'hidden'}>${t('leisure.play')}</button>${presenceUsagePanel(observed, state)}${presenceWorkPanel(observed, state)}<form id="presence-settings" data-id="${esc(id)}" data-version="${observed.version}" data-original-label="${esc(observed.label || observed.provider + ' · ' + observed.session.slice(0, 8))}" data-original-role="${esc(observed.role)}"><fieldset class="session-avatar-picker"><legend>${t('pixel.character')}</legend>${Object.keys(
            officeAvatarOptions(state.projectRoot),
          )
            .map(
              (avatar) =>
                `<label><input type="radio" name="avatar" value="${avatar}" ${officeAppearance(id, state.projectRoot) === avatar ? 'checked' : ''} aria-label="${avatar.startsWith('user-') ? avatar.slice(5) : t('pixel.avatar.' + avatar)}"><span>${officeCharacter(id, state.projectRoot, avatar)}</span></label>`,
            )
            .join(
              '',
            )}</fieldset><div class="session-fields"><label class="office-field">${t('pixel.sessionName')}<input name="label" required maxlength="60" value="${esc(observed.label || observed.provider + ' · ' + observed.session.slice(0, 8))}"></label><label class="office-field">${t('pixel.sessionRole')}<input name="role" required maxlength="100" value="${esc(observed.role)}"></label></div><p class="session-caption">${t('pixel.sessionRoleHint')}</p><footer class="session-actions"><a class="session-file-link" href="#office/files">${t('nav.files')} <span aria-hidden="true">↗</span></a><button type="submit" class="primary">${t('pixel.sessionSave')}</button></footer></form>
          <aside class="session-connection-note"><span aria-hidden="true">↗</span><p>${t('pixel.externalChatLimit')}</p></aside>
        </div>`;
}
