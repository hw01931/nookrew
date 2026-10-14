import {configure, settings} from './core/config.js';
import {model} from './core/state.js';
import {api} from './core/api.js';
import {$, esc, html} from './core/dom.js';
import {notify} from './core/notifications.js';
import {t, language, onLanguageChange, translatePage} from './core/i18n.js';
import {createPixelOffice} from './features/pixel-office.js';
import {createNativeWork} from './features/native-work.js';
import {createSocialWorkspace} from './features/social-workspace.js';
import {createProjectLibrary} from './features/project-library.js';
import {createFileBrowser} from './features/project-files.js';
import {presenceDetail} from './features/presence-detail.js';
import {presenceName} from './features/presence-labels.js';
import {presenceUsagePanel} from './features/presence-usage.js';
import {saveOfficeAppearance} from './features/office-art.js';
import {bindPresenceWork} from './features/presence-work.js';
import {openPresenceChat} from './features/presence-chat.js';
import {officeThemeStyle} from './features/office-theme.js';
import {createOfficeConversation} from './features/office-conversation.js';

// Codex companion has its own entry point. No legacy dashboard/engine/editor controller is loaded.
const initialLocation = new URL(location.href);
initialLocation.searchParams.set('source', 'hooks');
history.replaceState(null, '', initialLocation.pathname + initialLocation.search + initialLocation.hash);
let state,
  loading = false,
  selectedProfile = '',
  lastSnapshot = '';
const host = $('#office-content'),
  viewer = $('#office-viewer');
const pixel = createPixelOffice({
  conversation: (id) => {
    selectedProfile = '';
    const p = state?.presence.find((p) => p.id === id);
    if (p) conversation.open(id, presenceName(p));
  },
  chat: profile,
  viewChanged: () => render(true),
  assign: () => {
    location.hash = '#office/work';
  },
  meeting: () => {},
});
const conversation = createOfficeConversation(viewer, async (data) => {
  if (data.presenceStatus !== 'DELIVERED' || !data.messages.length) return;
  try {
    await api('/api/office/presence-ack', {id: data.person, version: data.presenceVersion});
    await refresh();
  } catch (error) {
    // A newer activity must keep its state; do not retry acknowledgement against a newer version.
    if (error.message !== 'VERSION_CONFLICT' && error.message !== 'RESULT_NOT_READY') notify(error.message);
  }
});
const work = createNativeWork(() => render(true), refresh),
  social = createSocialWorkspace(() => render(true)),
  library = createProjectLibrary(() => render(true)),
  files = createFileBrowser(() => render(true), '', true);
const presenceLinks = bindPresenceWork({
  getState: () => state,
  saved: async (id) => {
    await refresh();
    profile(id);
  },
});
const pages = ['studio', 'work', 'files', 'artifacts', 'marketing'];
function page() {
  const next = location.hash.split('/')[1];
  return pages.includes(next) ? next : 'studio';
}
function render(force = false) {
  if (!state) return;
  const snapshot = JSON.stringify([state, language(), page()]);
  if (!force && snapshot === lastSnapshot) return;
  if (pixel.isDragging()) return;
  lastSnapshot = snapshot;
  const active = page(),
    office = pixel.render({...state, projectLabel: state.projectName || settings.display.projectName});
  const content =
    active === 'work'
      ? work.render(state)
      : active === 'files'
        ? files.render(state.projectRoot)
        : active === 'artifacts'
          ? library.render()
          : active === 'marketing'
            ? social.render()
            : '';
  html(
    host,
    office +
      (active === 'studio'
        ? ''
        : `<aside class="office-workbench-panel" style="${officeThemeStyle(state.projectRoot)}" aria-label="${esc(t('nav.' + active))}"><header><a href="#office/studio">← ${t('nav.studio')}</a><strong>${esc(state.projectName || settings.display.projectName)}</strong></header><div class="office-workbench-content">${content}</div></aside>`),
  );
  pixel.mount(host);
}
async function refresh() {
  if (loading) return;
  loading = true;
  try {
    const [next, security] = await Promise.all([api('/api/office'), api('/api/state')]);
    state = next;
    model.state = security;
    render();
    if (viewer.open && selectedProfile) {
      const p = state.presence.find((p) => p.id === selectedProfile);
      if (p) {
        const panel = viewer.querySelector('.presence-token-panel');
        if (panel)
          html(
            panel.parentNode.querySelector('.presence-token-panel'),
            presenceUsagePanel(p, state).replace(/^<section[^>]*>|<\/section>$/g, ''),
          );
        const badge = viewer.querySelector('.office-roster-state');
        if (badge) {
          badge.dataset.status = p.status;
          badge.textContent = t('pixel.state.' + p.status);
        }
        const play = viewer.querySelector('[data-game-with]');
        if (play) play.hidden = p.status !== 'IDLE';
      }
    }
  } catch (error) {
    if (!state)
      html(
        host,
        `<section class="companion-recovery"><h2>${t('pixel.profileMissing')}</h2><p>${esc(error.message)}</p><button data-companion-retry>${t('common.retry')}</button></section>`,
      );
    else notify(t('common.requestFailed', {reason: error.message}), {error: true});
  } finally {
    loading = false;
  }
}
function profile(id) {
  viewer.classList.remove('conversation-open');
  const p = state?.presence.find((p) => p.id === id);
  if (!p) return;
  selectedProfile = id;
  $('#office-viewer-title').textContent = presenceName(p);
  html($('#office-viewer-content'), presenceDetail(p, state));
  if (!viewer.open) viewer.showModal();
  $('#presence-settings input:checked')?.focus();
}
function close() {
  viewer.close();
  selectedProfile = '';
}
host.addEventListener('click', (e) => {
  void work.click(e);
  void social.click(e);
  void library.click(e);
  void files.click(e);
  const b = e.target.closest('[data-office]');
  if (b?.dataset.office === 'pixel-chat') profile(b.dataset.id);
  if (b?.dataset.office === 'presence-ack') {
    const p = state.presence.find((p) => p.id === b.dataset.id);
    void api('/api/office/presence-ack', {id: p.id, version: p.version})
      .then(refresh)
      .catch((error) => notify(error.message, {error: true}));
  }
  if (e.target.closest('[data-companion-retry]')) void refresh();
});
for (const event of ['input', 'change'])
  host.addEventListener(event, (e) => {
    work.input(e);
    social.input(e);
    library.input(e);
    files.input(e);
  });
host.addEventListener('submit', (e) => {
  void work.submit(e);
  void social.submit(e);
  library.search(e);
  files.search(e);
});
document.addEventListener('click', (e) => {
  void presenceLinks.click(e);
  const chat = e.target.closest('[data-presence-chat]');
  if (chat) {
    e.preventDefault();
    void openPresenceChat(chat.dataset.presenceChat);
  }
  if (e.target.closest('[data-companion-close]')) close();
  if (e.target.closest('[data-notice-close]')) $('#notice').hidden = true;
  const game = e.target.closest('[data-game-with]');
  if (game) {
    close();
    location.hash = '#office/studio';
    pixel.play(game.dataset.gameWith);
    render(true);
  }
  const detail = e.target.closest('[data-office="work-details"]');
  if (detail) {
    close();
    location.hash = '#office/work';
    render(true);
    document.getElementById('native-work-' + detail.dataset.id)?.scrollIntoView({block: 'center'});
  }
  if (e.target.closest('[data-office="new-work"]')) {
    const id = selectedProfile;
    close();
    work.prepare(id);
    location.hash = '#office/work';
    render(true);
  }
});
document.addEventListener('input', presenceLinks.input);
document.addEventListener('submit', async (e) => {
  void presenceLinks.submit(e);
  if (e.target.id !== 'presence-settings') return;
  e.preventDefault();
  const form = e.target,
    b = form.querySelector('button[type=submit]');
  b.disabled = true;
  form.dataset.key ||= crypto.randomUUID();
  try {
    const p = (await api('/api/office')).presence.find((p) => p.id === form.dataset.id);
    if (!p) throw Error(t('pixel.profileMissing'));
    if (
      (p.label || p.provider + ' · ' + p.session.slice(0, 8)) !== form.dataset.originalLabel ||
      p.role !== form.dataset.originalRole
    )
      throw Error(t('pixel.profileChanged'));
    await api('/api/office/presence-configure', {
      id: p.id,
      version: p.version,
      label: form.elements.label.value,
      role: form.elements.role.value,
      key: form.dataset.key,
    });
    saveOfficeAppearance(p.id, state.projectRoot, form.elements.avatar.value);
    close();
    await refresh();
  } catch (error) {
    notify(t('common.requestFailed', {reason: error.message}), {error: true});
  } finally {
    b.disabled = false;
  }
});
addEventListener('hashchange', () => render(true));
onLanguageChange(() => {
  translatePage();
  render(true);
  if (viewer.open && selectedProfile && !viewer.querySelector('#presence-settings input:focus'))
    profile(selectedProfile);
});
configure(await (await fetch('/api/config')).json());
translatePage();
await refresh();
setInterval(() => {
  if (!document.hidden) void refresh();
}, settings.client.pollIntervalMs);
