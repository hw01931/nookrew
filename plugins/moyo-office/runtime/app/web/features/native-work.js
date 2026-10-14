import {api} from '../core/api.js';
import {esc} from '../core/dom.js';
import {t, locale} from '../core/i18n.js';
import {states} from '../core/status-labels.js';
export function createNativeWork(changed, refresh) {
  let current,
    busy = false,
    error = '',
    message = '',
    pending,
    creating = false;
  const assignments = new Map(),
    statuses = new Map();
  const draft = {title: '', goal: '', employeeId: '', every: 'none', time: '09:00', weekday: '1', day: '1'};
  const tx = (k, v) => t('nativeWork.' + k, v);
  const people = () => (current?.presence || []).filter((p) => p.provider === 'codex');
  const name = (id) =>
    people().find((p) => p.id === id)?.label ||
    people()
      .find((p) => p.id === id)
      ?.session.slice(0, 8) ||
    tx('missingEmployee');
  function options(value) {
    return (
      `<option value="">${tx('chooseEmployee')}</option>` +
      people()
        .map((p) => `<option value="${p.id}" ${value === p.id ? 'selected' : ''}>${esc(name(p.id))}</option>`)
        .join('')
    );
  }
  function prompt(w) {
    return `${w.data.title}\n\n${w.data.goal}\n\n${tx('promptRecord')}: ${w.id}\n${tx('promptResults')}`;
  }
  function render(state) {
    current = state;
    const works = state.entities.filter((e) => e.kind === 'work'),
      plans = state.nativeWorkPlans || [];
    return `<section class="native-work"><header class="section-heading"><div><h2>${tx('title')}</h2><p>${tx('intro')}</p></div><a href="codex://automations">${tx('codexSchedules')} ↗</a></header><p class="native-work-boundary">${tx('boundary')}</p>${error ? `<p role="alert">${esc(error)}${pending ? `<button data-native="retry">${tx('retry')}</button>` : ''}</p>` : ''}${message ? `<p role="status">${esc(message)}</p>` : ''}${state.nativeScheduleError ? `<p role="alert">${esc(state.nativeScheduleError)}</p>` : ''}<details class="native-work-create" ${creating ? 'open' : ''}><summary>${tx('create')}</summary><form data-native-form><label>${tx('name')}<input id="native-create-title" name="title" value="${esc(draft.title)}" required maxlength="120"></label><label>${tx('employee')}<select id="native-create-employeeId" name="employeeId" required ${busy ? 'disabled' : ''}>${options(draft.employeeId)}</select></label><label>${tx('instruction')}<textarea id="native-create-goal" name="goal" rows="5" maxlength="48000" required ${busy ? 'disabled' : ''}>${esc(draft.goal)}</textarea></label><p class="caption">${tx('stepsHint')}</p><label>${tx('repeat')}<select id="native-create-every" name="every">${['none', 'workflow', 'day', 'week', 'month'].map((v) => `<option value="${v}" ${draft.every === v ? 'selected' : ''}>${tx(v)}</option>`).join('')}</select></label><div class="native-schedule-fields"><label>${tx('time')}<input type="time" id="native-create-time" name="time" value="${esc(draft.time)}" required></label><label>${tx('weekday')}<select id="native-create-weekday" name="weekday">${Array.from({length: 7}, (_, i) => `<option value="${i}" ${Number(draft.weekday) === i ? 'selected' : ''}>${t('work.routine.weekday.' + i)}</option>`).join('')}</select></label><label>${tx('dayOfMonth')}<input type="number" id="native-create-day" name="day" min="1" max="31" value="${esc(draft.day)}"></label></div><button ${busy ? 'disabled' : ''}>${tx('save')}</button></form></details><section><h3>${tx('plans')}</h3>${plans.map((p) => `<article class="native-work-plan"><header><strong>${esc(p.title)}</strong><span>${p.schedule ? tx(p.schedule.every) + ' · ' + esc(p.schedule.time) : tx('workflow')}</span></header><p>${esc(name(p.employeeId))} · ${tx('steps', {n: p.steps.length})}</p>${p.waiting ? `<p class="caption">${tx('waiting')}</p>` : !p.employeeAvailable ? `<p role="alert">${tx('missingEmployee')}</p>` : ''}<label>${tx('employee')}<select id="native-plan-${p.id}" data-native-plan="${p.id}">${options(assignments.get(p.id) ?? p.employeeId)}</select></label><button data-native="plan-assign" data-id="${p.id}" data-version="${p.version}" ${busy ? 'disabled' : ''}>${tx('assign')}</button>${p.next ? `<p>${tx('next')}: ${esc(p.next)}</p>` : ''}<div>${p.workIds.map((id) => `<button data-native="locate" data-id="${id}">${esc(works.find((w) => w.id === id)?.data.title || id.slice(0, 8))}</button>`).join(' · ')}</div><button data-native="run" data-id="${p.id}" data-version="${p.version}" ${busy ? 'disabled' : ''}>${tx('createRun')}</button><button data-native="toggle" data-id="${p.id}" data-version="${p.version}" ${busy ? 'disabled' : ''}>${tx(p.enabled ? 'pause' : 'resume')}</button></article>`).join('') || `<p>${tx('noPlans')}</p>`}</section><section><h3>${tx('queue')}</h3><div class="native-work-grid">${
      works
        .map((w) => {
          const blocked = (w.data.dependencies || []).some(
              (id) => works.find((v) => v.id === id)?.data.status !== 'DONE',
            ),
            person = people().find((p) => p.id === w.data.nativeAssigneeId);
          return `<article id="native-work-${w.id}" class="native-work-ticket"><header><strong>${esc(w.data.title)}</strong><span>${esc(states[w.data.status])}</span></header><p>${esc(w.data.goal)}</p><label>${tx('employee')}<select id="native-assignee-${w.id}" data-native-assignee="${w.id}" ${busy ? 'disabled' : ''}>${options(assignments.get(w.id) ?? w.data.nativeAssigneeId)}</select></label><button data-native="assign" data-id="${w.id}" data-version="${w.version}" ${busy ? 'disabled' : ''}>${tx('assign')}</button>${blocked ? `<p class="caption">${tx('dependencies')}</p>` : ''}<div class="native-work-actions"><button data-native="copy" data-id="${w.id}" ${blocked ? 'disabled' : ''}>${tx('copy')}</button>${person && /^[a-f0-9-]{36}$/.test(person.session) ? `<a data-presence-chat="${person.id}" href="codex://threads/${encodeURIComponent(person.session)}">${tx('openChat')} ↗</a>` : ''}</div><label>${tx('status')}<select id="native-status-${w.id}" data-native-status="${w.id}" ${busy ? 'disabled' : ''}>${['BACKLOG', 'ACTIVE', 'REVIEW', 'DONE', 'BLOCKED'].map((v) => `<option value="${v}" ${v === (statuses.get(w.id) ?? w.data.status) ? 'selected' : ''}>${esc(states[v])}</option>`).join('')}</select></label><button data-native="status" data-id="${w.id}" data-version="${w.version}" ${busy ? 'disabled' : ''}>${tx('saveStatus')}</button><small>${new Date(w.updatedAt).toLocaleString(locale())}</small></article>`;
        })
        .join('') || `<p>${tx('noWork')}</p>`
    }</div></section></section>`;
  }
  function input(e) {
    if (e.target.dataset.nativePlan) assignments.set(e.target.dataset.nativePlan, e.target.value);
    if (e.target.dataset.nativeAssignee) assignments.set(e.target.dataset.nativeAssignee, e.target.value);
    if (e.target.dataset.nativeStatus) statuses.set(e.target.dataset.nativeStatus, e.target.value);
    if (e.target.closest('[data-native-form]') && e.target.name) draft[e.target.name] = e.target.value;
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
      await api('/api/office/native-work', pending);
      pending = null;
      message = tx('saved');
      await refresh();
    } catch (e) {
      error = e.message;
      if (!/TIMEOUT|NETWORK/.test(e.message)) pending = null;
    } finally {
      busy = false;
      changed();
    }
  }
  async function submit(e) {
    if (!e.target.matches('[data-native-form]')) return;
    e.preventDefault();
    if (busy) return;
    const steps = draft.goal
      .split(/^---\s*$/m)
      .map((s) => s.trim())
      .filter(Boolean);
    const plan = draft.every !== 'none';
    await run(plan ? 'plan' : 'create', {
      title: draft.title,
      employeeId: draft.employeeId,
      ...(plan
        ? {
            steps,
            ...(['day', 'week', 'month'].includes(draft.every)
              ? {
                  schedule: {
                    every: draft.every,
                    time: draft.time,
                    weekday: Number(draft.weekday),
                    day: Number(draft.day),
                  },
                }
              : {}),
          }
        : {goal: draft.goal}),
    });
  }
  async function click(e) {
    const b = e.target.closest('[data-native]');
    if (!b || busy) return;
    const action = b.dataset.native,
      id = b.dataset.id;
    if (action === 'retry' && pending) {
      await run(pending.action, pending.data, pending.version);
      return;
    }
    if (action === 'locate') {
      document.getElementById('native-work-' + id)?.scrollIntoView({block: 'center'});
      return;
    }
    if (action === 'copy') {
      try {
        await navigator.clipboard.writeText(prompt(current.entities.find((w) => w.id === id)));
        message = tx('copied');
      } catch {
        error = tx('copyFailed');
      }
      changed();
      return;
    }
    const value =
      action === 'plan-assign'
        ? document.querySelector(`[data-native-plan="${id}"]`).value
        : action === 'assign'
          ? document.querySelector(`[data-native-assignee="${id}"]`).value
          : action === 'status'
            ? document.querySelector(`[data-native-status="${id}"]`).value
            : undefined;
    await run(
      action,
      {
        id,
        ...(['assign', 'plan-assign'].includes(action)
          ? {employeeId: value}
          : action === 'status'
            ? {status: value}
            : {}),
      },
      Number(b.dataset.version),
    );
  }
  return {
    render,
    input,
    submit,
    click,
    prepare(id) {
      draft.employeeId = id;
      creating = true;
    },
  };
}
