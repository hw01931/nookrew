import {api} from '../core/api.js';
import {esc, html} from '../core/dom.js';
import {language, onLanguageChange} from '../core/i18n.js';
import {openPresenceChat} from './presence-chat.js';
import {renderMarkdown} from '../vendor/markdown.js';
import {userMessageDisplay} from './conversation-display.js';

export function createOfficeConversation(viewer, onOpened = () => {}) {
  let openedGeneration = -1;
  let id = '',
    generation = 0,
    timer,
    busy = false,
    pending;
  const drafts = new Map();
  const words = () =>
    language() === 'en'
      ? {
          loading: 'Loading conversation…',
          send: 'Send',
          original: 'Open in Codex',
          retry: 'Retry',
          hint: 'Messages go to the original Codex session. While it is working, your message waits in its queue. Approvals and stop controls remain in Codex.',
          empty: 'No messages yet.',
          unknown: 'Delivery could not be confirmed. Do not resend; check Codex.',
          stop: 'Stop',
          placeholder: 'Message this employee…',
        }
      : {
          loading: '대화를 불러오는 중…',
          send: '보내기',
          original: 'Codex에서 열기',
          retry: '다시 불러오기',
          hint: '원래 Codex 직원에게 메시지를 전달해요. 작업 중이면 다음 지시로 대기해요. 승인과 중단은 Codex에서 처리해 주세요.',
          empty: '아직 대화가 없어요.',
          unknown: '전송 여부를 확인하지 못했어요. 다시 보내지 말고 Codex에서 확인해 주세요.',
          stop: '중단',
          placeholder: '이 직원에게 메시지 보내기…',
        };
  async function update() {
    if (!id || busy || !viewer.open) return;
    const token = generation;
    try {
      const data = await api('/api/office/conversation?id=' + encodeURIComponent(id));
      if (token !== generation || !viewer.open) return;
      const host = viewer.querySelector('[data-conversation-messages]');
      if (!host) return;
      const nearBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 70;
      const messages = new Map([...data.messages, ...data.liveMessages].map((m) => [m.id, m]));
      html(
        host,
        [...messages.values()]
          .map((m) => (m.role === 'user' ? {...m, text: userMessageDisplay(m.text)} : m))
          .filter((m) => m.text.trim())
          .map(
            (m) =>
              `<article class="conversation-message" data-role="${m.role}"><strong>${m.role === 'user' ? (language() === 'en' ? 'You' : '나') : 'Codex'}</strong><div class="conversation-body">${m.role === 'assistant' ? renderMarkdown(m.text) : esc(m.text)}${m.truncated ? '\n…' : ''}</div></article>`,
          )
          .join('') || `<p>${words().empty}</p>`,
      );
      if (nearBottom) host.scrollTop = host.scrollHeight;
      if (openedGeneration !== token) {
        openedGeneration = token;
        void onOpened(data);
      }
      viewer.querySelector('[data-conversation-send]').disabled = !data.canSend || !!pending;
      if (data.blockedReason === 'SESSION_ALREADY_ACTIVE')
        viewer.querySelector('[data-conversation-result]').textContent =
          language() === 'en'
            ? 'Codex already owns this session. Send your message in the original Codex conversation.'
            : '원래 Codex에서 사용 중인 세션이에요. 메시지는 Codex에서 보내 주세요.';
      const stop = viewer.querySelector('[data-conversation-stop]');
      stop.hidden = !data.turnId || ['completed', 'failed', 'interrupted'].includes(data.state);
      stop.dataset.turnId = data.turnId;
      const stateLabels =
        language() === 'en'
          ? {
              notLoaded: 'Idle',
              idle: 'Idle',
              active: 'Working',
              blocked: 'Waiting for input',
              inProgress: 'Working',
              starting: 'Starting',
              completed: 'Completed',
              interrupted: 'Stopped',
              failed: 'Failed',
              UNKNOWN: 'Connection uncertain',
              inputRequired: 'Continue in Codex',
              approvalDeclined: 'Approval declined',
            }
          : {
              notLoaded: '쉬는 중',
              idle: '쉬는 중',
              active: '작업 중',
              blocked: '입력 대기',
              inProgress: '작업 중',
              starting: '시작 중',
              completed: '응답 완료',
              interrupted: '중단됨',
              failed: '실패',
              UNKNOWN: '연결 확인 필요',
              inputRequired: 'Codex에서 이어가세요',
              approvalDeclined: '승인 거부됨',
            };
      viewer.querySelector('[data-conversation-state]').textContent =
        (stateLabels[data.state] || data.state) +
        (data.limited ? (language() === 'en' ? ' · Recent conversation' : ' · 최근 대화') : '');
      let history = viewer.querySelector('[data-conversation-history]');
      if (!history) {
        history = document.createElement('p');
        history.dataset.conversationHistory = '';
        history.className = 'conversation-hint';
        viewer.querySelector('.conversation-toolbar').after(history);
      }
      history.hidden = !data.limited && data.historyTurnLimit !== 1;
      history.textContent =
        language() === 'en'
          ? `Showing only the latest ${data.historyTurnLimit || 6} turns. Open Codex to see the full conversation.`
          : `전체 대신 최근 ${data.historyTurnLimit || 6}회 대화만 표시해요. 전체 대화는 Codex에서 확인할 수 있어요.`;
      const approvals = viewer.querySelector('[data-conversation-approvals]');
      html(
        approvals,
        (data.approvals || [])
          .map(
            (a) =>
              `<section><pre>${esc(a.description)}</pre><button type="button" data-conversation-approval="${esc(a.id)}" data-decision="decline">${language() === 'en' ? 'Decline' : '거부'}</button><button type="button" data-conversation-approval="${esc(a.id)}" data-decision="accept">${language() === 'en' ? 'Allow once' : '이번만 허용'}</button></section>`,
          )
          .join(''),
      );
    } catch (error) {
      if (token === generation && viewer.open)
        viewer.querySelector('[data-conversation-state]').textContent =
          error.message === 'CODEX_PROTOCOL_LIMIT'
            ? language() === 'en'
              ? 'This conversation is too large to load here. Open it in Codex.'
              : '대화가 너무 길어 여기서 불러올 수 없어요. Codex에서 열어 주세요.'
            : error.message;
    }
  }
  function open(person, name) {
    viewer.classList.add('conversation-open');
    id = person;
    generation++;
    pending = undefined;
    clearInterval(timer);
    viewer.querySelector('#office-viewer-title').textContent = name;
    const w = words();
    html(
      viewer.querySelector('#office-viewer-content'),
      `<section class="office-conversation"><p class="conversation-hint">${w.hint}</p><div class="conversation-toolbar"><button type="button" data-conversation-original>${w.original}</button><button type="button" data-conversation-refresh>${w.retry}</button><span data-conversation-state>${w.loading}</span></div><div data-conversation-messages class="conversation-messages" aria-live="polite"></div><form data-conversation-form><label><textarea rows="3" maxlength="16000" placeholder="${w.placeholder}" aria-label="${w.placeholder}" required></textarea></label><footer><span data-conversation-result role="status"></span><button type="button" data-conversation-stop hidden>${w.stop}</button><button data-conversation-send disabled>${w.send}</button></footer></form></section>`,
    );
    const approvals = document.createElement('div');
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.dataset.conversationCopy = '';
    copy.textContent = language() === 'en' ? 'Copy draft' : '입력 복사';
    viewer.querySelector('.conversation-toolbar').append(copy);
    viewer.querySelector('textarea').value = drafts.get(id) || '';
    approvals.dataset.conversationApprovals = '';
    viewer.querySelector('.office-conversation').append(approvals);
    if (!viewer.open) viewer.showModal();
    void update();
    timer = setInterval(() => void update(), 2000);
  }
  viewer.addEventListener('close', () => {
    viewer.classList.remove('conversation-open');
    id = '';
    generation++;
    clearInterval(timer);
  });
  viewer.addEventListener('input', (e) => {
    if (id && e.target.matches('[data-conversation-form] textarea')) drafts.set(id, e.target.value);
  });
  onLanguageChange(() => {
    if (!id || !viewer.open) return;
    const w = words();
    viewer.querySelector('.conversation-hint').textContent = w.hint;
    viewer.querySelector('[data-conversation-original]').textContent = w.original;
    viewer.querySelector('[data-conversation-refresh]').textContent = w.retry;
    viewer.querySelector('[data-conversation-send]').textContent = w.send;
    viewer.querySelector('[data-conversation-stop]').textContent = w.stop;
    viewer.querySelector('[data-conversation-copy]').textContent =
      language() === 'en' ? 'Copy draft' : '입력 복사';
    const input = viewer.querySelector('textarea');
    input.placeholder = w.placeholder;
    input.setAttribute('aria-label', w.placeholder);
    void update();
  });
  viewer.addEventListener('click', (e) => {
    if (e.target.closest('[data-conversation-copy]'))
      void navigator.clipboard
        .writeText(viewer.querySelector('textarea').value)
        .then(() => {
          viewer.querySelector('[data-conversation-result]').textContent =
            language() === 'en' ? 'Draft copied' : '입력을 복사했어요';
        })
        .catch(() => {
          viewer.querySelector('[data-conversation-result]').textContent =
            language() === 'en'
              ? 'Select and copy your message manually.'
              : '입력을 선택해서 직접 복사해 주세요.';
        });
    if (e.target.closest('[data-conversation-original]')) void openPresenceChat(id);
    if (e.target.closest('[data-conversation-refresh]')) void update();
    const stop = e.target.closest('[data-conversation-stop]');
    const approval = e.target.closest('[data-conversation-approval]');
    if (approval)
      void api('/api/office/chat', {
        action: 'approve',
        data: {id, approvalId: approval.dataset.conversationApproval, decision: approval.dataset.decision},
      })
        .then(update)
        .catch((error) => {
          viewer.querySelector('[data-conversation-result]').textContent = error.message;
        });
    if (stop)
      void api('/api/office/chat', {action: 'interrupt', data: {id, turnId: stop.dataset.turnId}}).then(
        update,
      );
  });
  viewer.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-conversation-form]');
    if (!form) return;
    e.preventDefault();
    if (busy || pending) return;
    const text = form.querySelector('textarea').value.trim();
    if (!text) return;
    busy = true;
    pending = crypto.randomUUID();
    form.querySelector('[data-conversation-send]').disabled = true;
    try {
      const result = await api('/api/office/chat', {key: pending, action: 'send', data: {id, text}});
      if (result.state === 'ACCEPTED' || result.state === 'QUEUED') {
        drafts.delete(id);
        form.querySelector('textarea').value = '';
        pending = undefined;
      }
      form.querySelector('[data-conversation-result]').textContent =
        result.state === 'UNKNOWN'
          ? words().unknown
          : result.state === 'QUEUED'
            ? language() === 'en'
              ? 'Codex accepted your message. Its reply will appear here.'
              : 'Codex가 메시지를 접수했어요. 응답은 여기에 표시돼요.'
            : result.state;
    } catch (error) {
      if (
        [
          'CODEX_THREAD_BUSY',
          'CODEX_CHATGPT_LOGIN_REQUIRED',
          'INVALID_MESSAGE',
          'PROJECT_MISMATCH',
          'SESSION_NOT_FOUND',
          'CODEX_ACTION_DENIED',
          'INVALID_COMMAND',
        ].includes(error.message)
      )
        pending = undefined;
      if (
        error.message === 'CODEX_THREAD_ALREADY_ACTIVE' ||
        error.message.startsWith('CODEX_RPC_REJECTED_THREAD_RESUME')
      )
        pending = undefined;
      form.querySelector('[data-conversation-result]').textContent =
        error.message === 'CODEX_THREAD_ALREADY_ACTIVE'
          ? language() === 'en'
            ? 'Codex already owns this session. Your draft is preserved; send it in Codex.'
            : '원래 Codex에서 사용 중인 세션이에요. 입력은 보존했으니 Codex에서 보내 주세요.'
          : error.message;
    } finally {
      busy = false;
      void update();
    }
  });
  return {open};
}
