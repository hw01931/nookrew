import {presenceName, presenceRole} from './presence-labels.js';
import {openPresenceChat} from './presence-chat.js';
import {usageBadge} from './presence-usage.js';
/* i18n: all text from catalogs */
import {createOfficeLeisure} from './office-leisure.js';
import {customMap} from './office-custom.js';
import {officeCharacter} from './office-character.js';
import {officeThemeStyle, bindOfficeTheme} from './office-theme.js';
import {esc} from '../core/dom.js';
import {t, language, setLanguage} from '../core/i18n.js';
import {officeScene} from './office-scene.js';
import {createOfficeMap, officePath, officeDestination, officeProjection, TILE} from './office-map.js';

/** Local selection only. All writes are delegated to existing office commands. */
export function createPixelOffice({assign, meeting, chat, conversation, viewChanged}) {
  const leisure = createOfficeLeisure();
  const selected = new Set();
  const positions = new Map();
  let animationFrame, resizeObserver, leisureFocus, dragPreview;
  let isometric = document.body.classList.contains('office-only');
  let root,
    current,
    project,
    dragging,
    multiple = false;
  const employees = () => (current?.entities || []).filter((e) => e.kind === 'employee');
  const picked = () => employees().filter((e) => selected.has(e.id));
  const status = (id) => current.employeeActivity?.find((a) => a.employeeId === id);
  const hookMode = () => new URLSearchParams(location.search).get('source') === 'hooks';
  const command = (action) => {
    if (action === 'view') {
      isometric = !isometric;
      viewChanged();
      return;
    }
    const available = picked().filter((e) => e.data.enabled !== false);
    if (action === 'assign' && picked().length === 1 && available.length === 1) assign(available[0].id);
    if (action === 'meeting' && available.length) meeting(available.map((e) => e.id));
  };
  function controls() {
    const people = picked(),
      available = people.filter((e) => e.data.enabled !== false);
    return `<div class="pixel-selection"><strong>${people.length ? esc(people.map((e) => e.data.name).join(', ')) : t('pixel.select')}</strong><span>${t(people.length > 1 ? 'pixel.multiple' : 'pixel.selectionHint')}</span></div><div class="pixel-commands"><button type="button" class="secondary" data-pixel-command="multiple" aria-pressed="${multiple}">${t('pixel.multi')}</button><button type="button" class="primary" data-pixel-command="assign" ${people.length === 1 && available.length === 1 ? '' : 'disabled'}>${t('action.assignWork')}</button><button type="button" class="secondary" data-pixel-command="meeting" ${available.length ? '' : 'disabled'}>${t('pixel.meeting')}</button>${people.length === 1 ? `<button type="button" class="secondary" data-office="edit" data-id="${esc(people[0].id)}">${t('pixel.settings')}</button>` : ''}<button type="button" class="secondary" data-pixel-command="clear" ${people.length ? '' : 'disabled'}>${t('pixel.clear')}</button></div>`;
  }
  function sync() {
    const focusedCommand = root.contains(document.activeElement)
      ? document.activeElement.dataset.pixelCommand
      : null;
    for (const node of root.querySelectorAll('[data-pixel-person]'))
      node.setAttribute('aria-pressed', String(selected.has(node.dataset.pixelPerson)));
    root.querySelector('.pixel-dock').innerHTML = controls();
    if (root.querySelector('.pixel-table'))
      root.querySelector('.pixel-table').disabled = !picked().some((e) => e.data.enabled !== false);
    if (focusedCommand)
      root
        .querySelector(`.pixel-dock [data-pixel-command="${focusedCommand}"]`)
        ?.focus({preventScroll: true});
  }
  function closeMenu() {
    root?.querySelector('.pixel-menu')?.remove();
  }
  function menu(anchor) {
    closeMenu();
    const panel = document.createElement('div');
    panel.className = 'pixel-menu';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', t('pixel.commands'));
    panel.innerHTML = controls();
    root.append(panel);
    const rect = root.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(anchor.x - rect.left, root.clientWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(anchor.y - rect.top, root.clientHeight - panel.offsetHeight - 8))}px`;
    panel.querySelector('button:not(:disabled)')?.focus();
  }
  function employeeCard(e, i) {
    const activity = status(e.id),
      s = activity?.status || 'NOT_RUN';
    const map = createOfficeMap(isometric ? Math.max(6, employees().length) : employees().length);
    const logical = positions.get(e.id) || map.desks[i];
    const projected = officeProjection(map, isometric).point(
      (logical.x + 0.5) * TILE,
      (logical.y + 0.5) * TILE,
    );
    const point = {x: projected.x / TILE - 0.5, y: projected.y / TILE - 0.5};
    return `<div class="pixel-station" style="left:${(point.x + 0.5) * TILE}px;top:${(point.y + 0.5) * TILE}px" data-employee="${esc(e.id)}" data-activity="${esc(s)}"><div class="pixel-bubble"><span class="pixel-status-dot"></span>${esc(t('pixel.state.' + s))}${activity?.title ? `<small>${esc(activity.title)}</small>` : ''}</div><button type="button" class="pixel-person" style="--uniform:var(--pixel-color-${i % 6})" id="pixel-person-${esc(e.id)}" data-pixel-person="${esc(e.id)}" aria-pressed="${selected.has(e.id)}" aria-label="${esc(e.data.name)} · ${esc(t('pixel.state.' + s))}">${officeCharacter(e.id, current.projectRoot)}<strong>${esc(e.data.name)}</strong><small>${esc(e.data.role)}</small></button>${activity?.sourceId ? `<button type="button" class="pixel-source" data-office="open-linked" data-id="${esc(activity.sourceId)}">${t('pixel.source')} ↗</button>` : ''}</div><span class="office-map-name" data-map-name="${esc(e.id)}" aria-hidden="true">${esc(e.data.name)}</span>`;
  }
  function roster(people) {
    return `<aside class="office-roster" aria-label="${t('pixel.employees')}"><header><strong>${t('pixel.peopleCount', {n: people.length})}</strong>${hookMode() ? '' : `<a href="#office/people">${t('pixel.settings')}</a>`}</header><div class="office-roster-list">${people
      .map((e, i) => {
        const activity = status(e.id);
        return `<div><button type="button" class="office-roster-person" data-office="pixel-chat" data-id="${esc(e.id)}"><span class="office-roster-avatar" style="--uniform:var(--pixel-color-${i % 6})" aria-hidden="true">${officeCharacter(e.id, current.projectRoot)}</span><span><strong>${esc(e.data.name)}</strong><small>${esc(e.data.role)}</small><span class="office-roster-state" data-status="${esc(activity?.status || 'NOT_RUN')}">${esc(t('pixel.state.' + (activity?.status || 'NOT_RUN')))}</span>${hookMode() ? usageBadge(e.id, current) : ''}${activity?.title ? `<small class="office-roster-task">${esc(activity.title)}</small>` : ''}</span><span aria-hidden="true">›</span></button>${hookMode() && activity?.status === 'DELIVERED' ? `<button type="button" class="secondary" data-office="presence-ack" data-id="${esc(e.id)}">${t('pixel.acknowledge')}</button>` : ''}</div>`;
      })
      .join(
        '',
      )}</div><nav aria-label="${t('pixel.resources')}"><a href="#office/work">${t('presenceWork.workList')} ↗</a><a href="#office/files">${t('nav.files')} ↗</a>${hookMode() ? '' : `<a href="#office/changes">${t('pixel.codeChanges')} ↗</a>`}<a href="#office/marketing">${t('nav.marketing')} ↗</a><a href="#office/artifacts">${t('pixel.archive')} ↗</a></nav><p>${t(hookMode() && current.officeCompanion ? 'pixel.codexRosterHint' : hookMode() ? 'pixel.hookRosterHint' : 'pixel.rosterHint')}</p></aside>`;
  }
  return {
    play: (id) => leisure.play(id),
    isDragging: () => !!dragging,
    render(state) {
      const focusedElement = document.activeElement;
      if (root?.contains(focusedElement) && focusedElement.closest('.office-leisure'))
        leisureFocus = {
          action: focusedElement.dataset.leisure,
          attrs: Object.fromEntries(
            ['id', 'index', 'asset', 'type']
              .filter((k) => focusedElement.dataset[k] !== undefined)
              .map((k) => [k, focusedElement.dataset[k]]),
          ),
          x: focusedElement.dataset.x,
          y: focusedElement.dataset.y,
          json: focusedElement.hasAttribute('data-leisure-json'),
          start: focusedElement.selectionStart,
          end: focusedElement.selectionEnd,
        };
      else leisureFocus = null;
      if (hookMode()) {
        // A tool event must not reshuffle desk assignments or roster order.
        const presence = [...(state.presence || [])].sort((a, b) =>
          a.provider === b.provider
            ? a.session.localeCompare(b.session) || a.agent.localeCompare(b.agent)
            : a.provider === 'codex'
              ? -1
              : 1,
        );
        state = {
          ...state,
          entities: presence.map((p) => ({
            id: p.id,
            kind: 'employee',
            data: {
              name: presenceName(p),
              role: presenceRole(p.role),
              enabled: false,
            },
          })),
          employeeActivity: presence.map((p) => ({
            employeeId: p.id,
            status: p.status,
            activity: p.activity || 'WORK',
            title:
              p.status === 'RUNNING' && p.activity && p.activity !== 'WORK'
                ? t('pixel.action.' + p.activity)
                : t('pixel.event.' + p.event),
          })),
        };
      }
      current = state;
      if (project !== state.projectRoot) {
        selected.clear();
        multiple = false;
        project = state.projectRoot;
        positions.clear();
      }
      for (const id of selected) if (!employees().some((e) => e.id === id)) selected.delete(id);
      const people = employees();
      leisure.update(
        state.projectRoot,
        people.map((e) => ({id: e.id, name: e.data.name, status: status(e.id)?.status})),
        createOfficeMap(isometric ? Math.max(6, people.length) : people.length),
        viewChanged,
        state.officeCompanion === true,
      );
      const companion = document.body.classList.contains('office-only');
      const active = (state.employeeActivity || []).filter((a) =>
        ['RUNNING', 'MEETING'].includes(a.status),
      ).length;
      return `<section class="pixel-office" data-decorating="${leisure.isEditing()}" style="${officeThemeStyle(state.projectRoot)}" aria-label="${t('nav.studio')}">${companion ? `<header class="office-project-bar"><div><span>${t('pixel.project')}</span><strong title="${esc(state.projectRoot)}">${esc(state.projectLabel || state.projectRoot.split(/[\\/]/).filter(Boolean).pop())}</strong></div><div class="office-project-tools"><label class="office-language-control"><span>${t('shell.language')}</span><select data-office-language aria-label="${t('shell.language')}"><option value="ko" ${language() === 'ko' ? 'selected' : ''}>${t('shell.korean')}</option><option value="en" ${language() === 'en' ? 'selected' : ''}>English</option></select></label><span title="${t('pixel.hookObserved')}">${t('pixel.peopleCount', {n: people.length})}</span></div></header>` : ''}${current.officeCompanion ? '' : `<header class="pixel-header"><div><span class="pixel-eyebrow">${t('pixel.eyebrow')}</span><h2>${t('pixel.title')}</h2><p>${t('pixel.hint')}</p></div><a href="#office/dashboard" class="pixel-overview">${t('pixel.active', {n: active})}<span>↗ ${t('nav.dashboard')}</span></a></header>`}${companion ? `<p class="office-companion-status" ${hookMode() && people.length ? 'hidden' : ''}>${t(hookMode() ? (people.length ? 'pixel.hookObserved' : 'pixel.hookWaiting') : 'pixel.companionStatus')}</p>` : ''}<div class="office-view-controls">${leisure.toolbar()}<button type="button" class="secondary" data-pixel-command="view">${t(isometric ? 'pixel.viewTop' : 'pixel.viewIso')}</button></div><div class="office-scene-layout">${roster(people)}<div class="office-scene-main">${officeScene({state, people, employee: employeeCard, status, isometric, custom: leisure.custom(), canMeet: picked().some((e) => e.data.enabled !== false)})}</div>${leisure.render()}</div><div class="pixel-dock" role="group" aria-label="${t('pixel.commands')}">${controls()}</div><p class="pixel-footnote">${t('pixel.evidence')}</p></section>`;
    },
    mount(host) {
      const next = host.querySelector('.pixel-office');
      if (!next || next === root) return;
      root = next;
      bindOfficeTheme(root, current.projectRoot, viewChanged);
      leisure.bind(root);
      if (leisureFocus) {
        const selector = leisureFocus.json
          ? '[data-leisure-json]'
          : `[data-leisure="${leisureFocus.action}"]${leisureFocus.x === undefined ? '' : `[data-x="${leisureFocus.x}"][data-y="${leisureFocus.y}"]`}${Object.entries(
              leisureFocus.attrs || {},
            )
              .map(([k, v]) => `[data-${k}="${v}"]`)
              .join('')}`;
        let focus = root.querySelector('.office-leisure ' + selector);
        if (!focus || focus.disabled)
          focus =
            root.querySelector('[data-leisure="memory-flip"]:not(:disabled)') ||
            root.querySelector('.leisure-turn');
        focus?.focus({preventScroll: true});
        if (leisureFocus.json && focus) focus.setSelectionRange(leisureFocus.start, leisureFocus.end);
      }
      dragging = false;
      cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      const map = customMap(
          createOfficeMap(isometric ? Math.max(6, employees().length) : employees().length),
          leisure.custom(),
        ),
        scene = root;
      const projection = officeProjection(map, isometric);
      const viewport = scene.querySelector('.office-map-viewport'),
        mapFloor = scene.querySelector('.pixel-floor');
      const fit = () => {
        const only = document.body.classList.contains('office-only');
        if (only)
          viewport.style.height =
            Math.max(320, innerHeight - viewport.getBoundingClientRect().top - scrollY) + 'px';
        mapFloor.style.zoom = (only ? innerWidth >= 700 : viewport.clientWidth >= 600)
          ? Math.min(
              1,
              viewport.clientWidth / projection.width,
              Math.max(
                0.45,
                (only ? viewport.clientHeight : Math.max(400, innerHeight - 250)) / projection.height,
              ),
            )
          : 0.85;
        mapFloor.style.setProperty('--office-label-scale', String(1 / Number(mapFloor.style.zoom)));
      };
      resizeObserver = new ResizeObserver(fit);
      resizeObserver.observe(viewport);
      fit();
      const reduced = matchMedia('(prefers-reduced-motion: reduce)');
      let last = performance.now();
      const actors = employees().map((e, i) => {
        let actor = positions.get(e.id);
        if (!actor) {
          const person = current.presence?.find((p) => p.id === e.id);
          const parent =
            person?.agent &&
            current.presence?.find(
              (p) => !p.agent && p.session === person.session && p.provider === person.provider,
            );
          const origin = parent && positions.get(parent.id);
          actor = {...(origin || map.desks[i]), path: [], stop: 0, restUntil: last + 2500 + i * 350};
          actor.layout = JSON.stringify([map.height, leisure.custom().items, leisure.custom().placements]);
          if (parent) actor.spawnUntil = last + 1800;
          positions.set(e.id, actor);
        }
        if (
          !map.walkable({x: Math.round(actor.x), y: Math.round(actor.y)}) ||
          actor.layout !== JSON.stringify([map.height, leisure.custom().items, leisure.custom().placements])
        ) {
          Object.assign(actor, {
            ...map.desks[i],
            path: [],
            destination: null,
            target: null,
            planKey: null,
            layout: JSON.stringify([map.height, leisure.custom().items, leisure.custom().placements]),
          });
        }
        return {e, i, actor, node: root.querySelector('[data-employee="' + e.id + '"]')};
      });
      const tick = (now) => {
        if (!scene.isConnected || root !== scene) {
          resizeObserver?.disconnect();
          return;
        }
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        for (const {e, i, actor, node} of actors) {
          const state = status(e.id)?.status,
            resting = state === 'IDLE';
          if (
            !reduced.matches &&
            resting &&
            now > actor.restUntil &&
            !actor.path.length &&
            actor.destination
          ) {
            actor.stop++;
            actor.destination = null;
          }
          const action = state === 'RUNNING' ? status(e.id)?.activity || 'WORK' : 'WORK';
          node.dataset.action = action;
          node.dataset.summoned = String(now < (actor.spawnUntil || 0));
          const planKey = state + ':' + actor.stop + ':' + action;
          const reserved = new Set(actors.filter((a) => a.actor !== actor).map((a) => a.actor.destination));
          const dest =
              actor.planKey === planKey && actor.target
                ? actor.target
                : officeDestination(map, i, state, actor.stop, reserved, action),
            key = dest.x + ',' + dest.y;
          if (actor.destination !== key && (!resting || now >= actor.restUntil || reduced.matches)) {
            // Finish the current edge before rerouting; no diagonal cuts through furniture.
            const next = actor.path[0] || {x: Math.round(actor.x), y: Math.round(actor.y)};
            actor.path = [next, ...officePath(map, next, dest).slice(1)];
            actor.destination = key;
            actor.target = dest;
            actor.planKey = planKey;
          }
          if (reduced.matches) {
            actor.x = dest.x;
            actor.y = dest.y;
            actor.path = [];
          }
          let distance =
            now < (actor.spawnUntil || 0) ||
            node.matches(':hover,:focus-within') ||
            (selected.has(e.id) && resting)
              ? 0
              : dt * 2.2;
          while (actor.path.length && distance > 0) {
            const next = actor.path[0],
              dx = next.x - actor.x,
              dy = next.y - actor.y,
              len = Math.hypot(dx, dy);
            if (len <= distance) {
              actor.x = next.x;
              actor.y = next.y;
              actor.path.shift();
              distance -= len;
              if (!actor.path.length) actor.restUntil = now + 12000 + i * 1700;
            } else {
              actor.x += (dx / len) * distance;
              actor.y += (dy / len) * distance;
              distance = 0;
            }
            node.dataset.direction = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';
            node.dataset.facing = dx < 0 ? 'nw' : dx > 0 ? 'se' : dy < 0 ? 'ne' : 'sw';
          }
          node.dataset.walking = String(actor.path.length > 0 && !reduced.matches);
          node.dataset.place = actor.path.length
            ? 'walking'
            : resting
              ? 'rest'
              : state === 'MEETING'
                ? 'meeting'
                : 'desk';
          const sofaSeat =
            resting && map.sofaSeats.find((p) => Math.abs(actor.x - p.x) + Math.abs(actor.y - p.y) < 0.1);
          const sofa = !!sofaSeat;
          const seated =
            !actor.path.length &&
            (sofa || (['RUNNING', 'MEETING'].includes(state) && !['SEARCH', 'READ'].includes(action)));
          node.dataset.seated = String(seated);
          node.dataset.rest = resting
            ? actor.path.length
              ? 'strolling'
              : sofa
                ? actor.stop % 2
                  ? 'sleeping'
                  : 'sitting'
                : 'standing'
            : '';
          if (seated)
            node.dataset.facing = sofa
              ? sofaSeat.facing
              : state === 'MEETING'
                ? map.meetingFacing[
                    map.meeting.findIndex((p) => p.x === Math.round(actor.x) && p.y === Math.round(actor.y))
                  ] || 'se'
                : map.deskFacing[i];
          const screen = projection.point(
            (sofa && seated ? sofaSeat.visual.x : actor.x + 0.5) * TILE,
            (sofa && seated ? sofaSeat.visual.y : actor.y + 0.5) * TILE,
            sofa && seated ? 26 : 0,
          );
          if (
            dragPreview &&
            seated &&
            ((dragPreview.id === 'sofa' && sofa) || (dragPreview.id === 'desk-' + i && state === 'RUNNING'))
          ) {
            screen.x += dragPreview.dx;
            screen.y += dragPreview.dy;
          }
          node.style.left = screen.x + 'px';
          node.style.top = screen.y + 'px';
          const name = [...root.querySelectorAll('[data-map-name]')].find(
            (label) => label.dataset.mapName === node.dataset.employee,
          );
          if (name) {
            name.style.left = screen.x + 'px';
            name.style.top = screen.y + 16 + 'px';
          }
          node.style.zIndex = String(
            sofa && seated
              ? 11 +
                  Math.floor(projection.point(map.sofaDepth.x * TILE, map.sofaDepth.y * TILE).y) +
                  (dragPreview?.id === 'sofa' ? Math.round(dragPreview.dy) : 0)
              : !actor.path.length && ['SEARCH', 'READ'].includes(action)
                ? 11 + Math.floor(projection.point(map.researchDepth.x * TILE, map.researchDepth.y * TILE).y)
                : 10 + Math.floor(screen.y),
          );
        }
        animationFrame = requestAnimationFrame(tick);
      };
      animationFrame = requestAnimationFrame(tick);
      root.addEventListener('change', (event) => {
        if (event.target.matches('[data-office-language]')) setLanguage(event.target.value);
      });
      root.addEventListener('click', (event) => {
        if (dragging) {
          dragging = false;
          return;
        }
        const person = event.target.closest('[data-pixel-person]');
        if (person) {
          if (document.body.classList.contains('office-only') && !event.shiftKey) {
            const employee = current.presence?.find((p) => p.id === person.dataset.pixelPerson);
            if (employee?.provider === 'codex' && /^[a-f0-9-]{36}$/.test(employee.session)) {
              if (conversation) conversation(employee.id);
              else void openPresenceChat(employee.id);
            } else chat(person.dataset.pixelPerson);
            return;
          }
          if (!event.shiftKey && !multiple) selected.clear();
          if ((event.shiftKey || multiple) && selected.has(person.dataset.pixelPerson))
            selected.delete(person.dataset.pixelPerson);
          else selected.add(person.dataset.pixelPerson);
          closeMenu();
          sync();
        }
        const action = event.target.closest('[data-pixel-command]')?.dataset.pixelCommand;
        if (action) {
          closeMenu();
          if (action === 'clear') {
            selected.clear();
            sync();
          } else if (action === 'multiple') {
            multiple = !multiple;
            sync();
          } else command(action);
        }
        if (root.querySelector('.pixel-table'))
          root.querySelector('.pixel-table').disabled = !picked().some((e) => e.data.enabled !== false);
      });
      root.addEventListener('contextmenu', (event) => {
        if (document.body.classList.contains('office-only')) return;
        if (!event.target.closest('.pixel-floor')) return;
        event.preventDefault();
        const person = event.target.closest('[data-pixel-person]');
        if (person && !selected.has(person.dataset.pixelPerson)) {
          selected.clear();
          selected.add(person.dataset.pixelPerson);
          sync();
        }
        menu({x: event.clientX, y: event.clientY});
      });
      root.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          if (root.querySelector('.pixel-menu')) {
            closeMenu();
            root.querySelector('[aria-pressed="true"]')?.focus();
          } else {
            selected.clear();
            sync();
          }
        }
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          const person = event.target.closest('[data-pixel-person]');
          if (person && !selected.has(person.dataset.pixelPerson)) {
            selected.clear();
            selected.add(person.dataset.pixelPerson);
            sync();
          }
          const rect = event.target.getBoundingClientRect();
          menu({x: rect.left, y: rect.bottom});
        }
      });
      const floor = root.querySelector('.pixel-floor');
      root.addEventListener(
        'click',
        (event) => {
          const furniture = event.target.closest('[data-built-in]');
          if (!leisure.isEditing() || !furniture) return;
          event.preventDefault();
          event.stopPropagation();
          if (!dragging) leisure.selectBuiltin(furniture.dataset.builtIn);
        },
        true,
      );
      floor.addEventListener('pointerdown', (event) => {
        const furniture = event.target.closest('[data-built-in]');
        if (leisure.isEditing() && furniture && event.button === 0) {
          event.preventDefault();
          const id = furniture.dataset.builtIn,
            origin = map.byId(id),
            start = {x: event.clientX, y: event.clientY},
            scale = floor.getBoundingClientRect().width / floor.offsetWidth;
          const group = [...floor.querySelectorAll('[data-built-in]')].filter(
            (n) => n.dataset.builtIn === id,
          );
          dragging = true;
          dragPreview = {id, dx: 0, dy: 0};
          const depths = new Map(group.map((node) => [node, node.style.zIndex]));
          floor.setPointerCapture(event.pointerId);
          let dx = 0,
            dy = 0;
          const move = (e) => {
            dx = (e.clientX - start.x) / scale;
            dy = (e.clientY - start.y) / scale;
            dragPreview = {id, dx, dy};
            for (const node of group) {
              node.style.transform = `translate(${dx}px,${dy}px)`;
              node.style.zIndex = String(Number(depths.get(node)) + Math.round(dy));
            }
          };
          const end = (e) => {
            floor.removeEventListener('pointermove', move);
            floor.removeEventListener('pointerup', end);
            floor.removeEventListener('pointercancel', end);
            for (const node of group) {
              node.style.transform = '';
              node.style.zIndex = depths.get(node);
            }
            dragPreview = null;
            if (floor.hasPointerCapture(event.pointerId)) floor.releasePointerCapture(event.pointerId);
            dragging = false;
            if (e.type === 'pointercancel') return;
            const x = Math.round(
                origin.x + (isometric ? (dx / (0.866 * TILE) + dy / (0.5 * TILE)) / 2 : dx / TILE),
              ),
              y = Math.round(
                origin.y + (isometric ? (dy / (0.5 * TILE) - dx / (0.866 * TILE)) / 2 : dy / TILE),
              );
            leisure.moveBuiltin(id, x, y);
          };
          floor.addEventListener('pointermove', move);
          floor.addEventListener('pointerup', end);
          floor.addEventListener('pointercancel', end);
          return;
        }
        if (leisure.isEditing()) return;
        if (event.button !== 0 || event.pointerType === 'touch' || event.target.closest('button,a')) return;
        const start = {x: event.clientX, y: event.clientY},
          prior = event.shiftKey ? new Set(selected) : new Set();
        const box = document.createElement('div');
        box.className = 'pixel-marquee';
        floor.append(box);
        floor.setPointerCapture(event.pointerId);
        const move = (e) => {
          const left = Math.min(start.x, e.clientX),
            top = Math.min(start.y, e.clientY),
            right = Math.max(start.x, e.clientX),
            bottom = Math.max(start.y, e.clientY);
          if (right - left + bottom - top < 6) return;
          dragging = true;
          const r = floor.getBoundingClientRect();
          Object.assign(box.style, {
            left: `${((left - r.left) * floor.offsetWidth) / r.width}px`,
            top: `${((top - r.top) * floor.offsetHeight) / r.height}px`,
            width: `${((right - left) * floor.offsetWidth) / r.width}px`,
            height: `${((bottom - top) * floor.offsetHeight) / r.height}px`,
          });
          selected.clear();
          for (const id of prior) selected.add(id);
          for (const node of floor.querySelectorAll('[data-pixel-person]')) {
            const n = node.getBoundingClientRect();
            if (n.right > left && n.left < right && n.bottom > top && n.top < bottom)
              selected.add(node.dataset.pixelPerson);
          }
          sync();
        };
        const end = () => {
          box.remove();
          floor.removeEventListener('pointermove', move);
          floor.removeEventListener('pointerup', end);
          floor.removeEventListener('pointercancel', end);
          floor.releasePointerCapture(event.pointerId);
          if (root.querySelector('.pixel-table'))
            root.querySelector('.pixel-table').disabled = !picked().some((e) => e.data.enabled !== false);
          // Pointer cancellation produces no click; do not swallow the next real command.
          setTimeout(() => {
            dragging = false;
          }, 0);
        };
        floor.addEventListener('pointermove', move);
        floor.addEventListener('pointerup', end);
        floor.addEventListener('pointercancel', end);
      });
    },
  };
}
