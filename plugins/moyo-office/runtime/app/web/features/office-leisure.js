import {api} from '../core/api.js';
import {officeThemeControl} from './office-theme.js';
import {notify} from '../core/notifications.js';
import {officeCardArt} from './office-card-art.js';
import {createOfficeMap} from './office-map.js';
/* i18n: all text from catalogs */
import {esc} from '../core/dom.js';
import {t} from '../core/i18n.js';
import {
  readCustom,
  saveCustom,
  validatePack,
  furnitureCatalog,
  layoutError,
  itemRect,
} from './office-custom.js';
import {
  memoryGame,
  memoryFlip,
  memoryResolve,
  memoryChoice,
  gameMove,
  gameWinner,
  computerMove,
  gamePaused,
} from './office-game.js';
import {officeCharacter} from './office-character.js';

export function createOfficeLeisure() {
  let project,
    custom,
    draft,
    mode = '',
    selected = '',
    asset = 'plant',
    rotation = 0,
    undo = [],
    message = '',
    importText = '',
    game,
    gameType = 'memory',
    gameTimer,
    decorateSection = 'furniture';
  let people = [],
    map,
    repaint,
    native = false;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const label = (id, catalog) => catalog[id]?.name || t('leisure.' + id);
  function setDraft(next) {
    const error = layoutError(map, next);
    if (error) {
      message = t('leisure.' + error);
      repaint();
      return;
    }
    undo.push(clone(draft));
    draft = next;
    message = '';
    repaint();
  }
  function start(opponent = '') {
    if (opponent && !people.some((p) => p.id === opponent && p.status === 'IDLE')) return;
    clearTimeout(gameTimer);
    gameTimer = null;
    game =
      gameType === 'memory'
        ? {...memoryGame(opponent), name: people.find((p) => p.id === opponent)?.name || t('leisure.solo')}
        : {
            type: 'tic',
            opponent,
            board: Array(9).fill(''),
            name: people.find((p) => p.id === opponent)?.name || t('leisure.computer'),
          };
    mode = 'game';
    message = '';
    repaint();
  }
  function advanceGame() {
    if (
      mode !== 'game' ||
      gameTimer ||
      !game ||
      game.type !== 'memory' ||
      gamePaused(game, people) ||
      game.found.length === 16
    )
      return;
    if (!game.waiting && game.actor !== 'computer') return;
    const current = game;
    gameTimer = setTimeout(
      () => {
        gameTimer = null;
        if (mode !== 'game' || current !== game || gamePaused(game, people)) return;
        if (game.waiting) game = memoryResolve(game);
        else {
          const index = memoryChoice(game);
          if (index >= 0) game = memoryFlip(game, index, 'computer');
        }
        repaint();
        advanceGame();
      },
      game.waiting ? 850 : 650,
    );
  }
  return {
    play: start,
    isEditing: () => mode === 'decorate',
    selectBuiltin(id) {
      if (mode !== 'decorate') return;
      const f = createOfficeMap(map.desks.length, draft.placements).byId(id);
      if (f) {
        selected = 'builtin:' + id;
        rotation = f.rotation;
        repaint();
      }
    },
    moveBuiltin(id, x, y) {
      if (mode !== 'decorate') return;
      const f = createOfficeMap(map.desks.length, draft.placements).byId(id);
      if (!f) return;
      selected = 'builtin:' + id;
      rotation = f.rotation;
      const next = clone(draft);
      next.placements ||= {};
      next.placements[id] = {x, y, rotation};
      setDraft(next);
    },
    update(root, nextPeople, base, redraw, isCompanion = false) {
      native = isCompanion;
      repaint = redraw;
      map = base;
      people = nextPeople;
      advanceGame();
      if (project !== root) {
        project = root;
        custom = readCustom(root);
        draft = null;
        mode = '';
        game = null;
      }
    },
    custom: () => draft || custom,
    toolbar() {
      return `<button type="button" class="secondary leisure-launch" data-leisure="decorate">${t('leisure.decorate')}</button><button type="button" class="secondary leisure-launch" data-leisure="play">${t('leisure.play')}</button>${native ? `<button type="button" class="text-button" data-leisure="shutdown">${t('leisure.shutdown')}</button>` : ''}${layoutError(map, custom) ? `<span role="status" class="leisure-layout-warning">${t('leisure.layoutChanged')}</span>` : ''}`;
    },
    render() {
      if (!mode) return '';
      const close = `<button type="button" class="text-button" data-leisure="close">${t(mode === 'decorate' ? 'leisure.cancel' : 'common.close')}</button>`;
      let body;
      if (mode === 'decorate') {
        const placedMap = createOfficeMap(map.desks.length, draft.placements);
        const builtin = selected.startsWith('builtin:') ? placedMap.byId(selected.slice(8)) : null;
        const catalog = furnitureCatalog(draft),
          current = draft.items.find((i) => i.id === selected);
        body = `<nav class="leisure-sections" aria-label="${t('leisure.sections')}">${['furniture', 'appearance', 'assets'].map((section) => `<button type="button" data-leisure="section" data-section="${section}" aria-pressed="${decorateSection === section}">${t('leisure.section.' + section)}</button>`).join('')}</nav><section class="leisure-section" ${decorateSection === 'appearance' ? '' : 'hidden'}>${officeThemeControl(project)}</section><section class="leisure-section" ${decorateSection === 'furniture' ? '' : 'hidden'}><p class="leisure-caption">${t('leisure.decorateHint')}</p><h4>${t('leisure.existingFurniture')}</h4><div class="leisure-builtins">${placedMap.furniture.map((f) => `<button type="button" data-leisure="builtin" data-id="${f.id}" aria-pressed="${builtin?.id === f.id}">${t('leisure.builtin.' + f.kind)}${f.kind === 'desk' ? ' ' + (Number(f.id.slice(5)) + 1) : ''}</button>`).join('')}</div><h4>${t('leisure.addFurniture')}</h4><div class="leisure-palette">${Object.keys(
          catalog,
        )
          .map(
            (id) =>
              `<button type="button" data-leisure="asset" data-asset="${esc(id)}" aria-pressed="${asset === id}">${esc(label(id, catalog))}</button>`,
          )
          .join(
            '',
          )}</div><div class="leisure-editor-actions"><button type="button" data-leisure="rotate">${t('leisure.rotate')} · ${rotation * 90}°</button><button type="button" data-leisure="remove" ${current ? '' : 'disabled'}>${t('leisure.remove')}</button><button type="button" data-leisure="undo" ${undo.length ? '' : 'disabled'}>${t('leisure.undo')}</button><button type="button" data-leisure="reset">${t('leisure.reset')}</button></div><p class="leisure-caption">${t('leisure.gridHint')}</p><div class="leisure-grid" style="--grid-columns:${map.width}" role="group" aria-label="${t('leisure.layout')}">${Array.from(
          {length: map.width * map.height},
          (_, n) => {
            const x = n % map.width,
              y = Math.floor(n / map.width),
              item = draft.items.find((i) => {
                const r = itemRect(i, catalog);
                return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
              });
            const core = placedMap.furniture.find(
              (r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h,
            );
            const anchor = [
              ...placedMap.desks,
              ...placedMap.meeting,
              ...placedMap.lounge,
              ...placedMap.research,
            ].some((p) => p.x === x && p.y === y);
            return `<button type="button" data-leisure="tile" data-x="${x}" data-y="${y}" ${(!placedMap.walkable({x, y}) || anchor) && !core ? 'disabled' : ''} class="${item || core ? 'occupied' : ''} ${item?.id === selected || (core?.id === builtin?.id && core) ? 'selected' : ''}" tabindex="${x === 13 && y === map.height - 2 ? 0 : -1}" aria-label="${x}, ${y}${item ? ': ' + esc(label(item.asset, catalog)) : core ? ': ' + t('leisure.builtin.' + core.kind) : ''}">${item ? (item.asset === 'plant' ? '♣' : '▧') : core ? (core.kind === 'desk' ? '▣' : '▰') : anchor ? '•' : ''}</button>`;
          },
        ).join(
          '',
        )}</div><div class="leisure-editor-actions"><button type="button" class="primary" data-leisure="save">${t('leisure.save')}</button><button type="button" data-leisure="deselect">${t('leisure.newPlacement')}</button></div></section><section class="leisure-section" ${decorateSection === 'assets' ? '' : 'hidden'}><section class="leisure-import"><h4>${t('leisure.import')}</h4><p>${t('leisure.packHint')}</p><a href="/office-assets.example.json" download>${t('leisure.example')}</a><label>${t('leisure.packFile')}<input type="file" accept="application/json,.json" data-leisure-file></label><label>${t('leisure.packJSON')}<textarea data-leisure-json rows="4" maxlength="2200000">${esc(importText)}</textarea></label><button type="button" data-leisure="import">${t('leisure.importApply')}</button><p>${t('leisure.localOnly')}</p></section></section>`;
      } else if (mode === 'choose') {
        const idle = people.filter((p) => p.status === 'IDLE');
        body = `<p class="leisure-intro">${t('leisure.breakIntro')}</p><h4>${t('leisure.pickGame')}</h4><div class="leisure-game-picker"><button data-leisure="game-type" data-type="memory" aria-pressed="${gameType === 'memory'}">${officeCardArt(0)}<strong>${t('leisure.memory')}</strong><small>${t('leisure.memoryHint')}</small></button><button data-leisure="game-type" data-type="tic" aria-pressed="${gameType === 'tic'}"><span class="tic-preview">× ○</span><strong>${t('leisure.tictactoe')}</strong><small>${t('leisure.ticHint')}</small></button></div><p class="leisure-caption">${t('leisure.gameHint')}</p><button class="leisure-opponent" type="button" data-leisure="start">${t('leisure.solo')}<span>↗</span></button><h4>${t('leisure.idlePeople')}</h4>${idle.map((p) => `<button class="leisure-opponent" type="button" data-leisure="start" data-id="${esc(p.id)}"><span class="leisure-portrait">${officeCharacter(p.id, project)}</span><span>${esc(p.name)}<small>${t('leisure.localOpponent')}</small></span><span>↗</span></button>`).join('') || `<p>${t('leisure.noIdle')}</p>`}`;
      } else if (game.type === 'memory') {
        const paused = gamePaused(game, people),
          complete = game.found.length === 16;
        body = `<div class="leisure-match-header"><div class="leisure-portrait">${officeCharacter('owner', project, 'mint')}</div><div><strong>${t('leisure.memory')}</strong><small>${game.opponent ? esc(game.name) : t('leisure.solo')}</small></div>${game.opponent ? `<div class="leisure-portrait">${officeCharacter(game.opponent, project)}</div>` : ''}</div><div class="leisure-scoreboard"><span>${t('leisure.myPairs')}<strong>${game.scores.user}</strong></span><span>${game.opponent ? t('leisure.theirPairs') : t('leisure.attempts')}<strong>${game.opponent ? game.scores.computer : game.attempts}</strong></span><span>${t('leisure.remaining')}<strong>${8 - game.found.length / 2}</strong></span></div><p role="status" class="leisure-turn" tabindex="-1">${t(paused ? 'leisure.paused' : complete ? (!game.opponent ? 'leisure.memoryDone' : game.scores.user === game.scores.computer ? 'leisure.draw' : game.scores.user > game.scores.computer ? 'leisure.win' : 'leisure.lose') : game.actor === 'computer' ? 'leisure.opponentTurn' : 'leisure.memoryTurn')}</p><div class="leisure-memory-board" role="group" aria-label="${t('leisure.memory')}">${game.cards
          .map((value, i) => {
            const face = game.revealed.includes(i) || game.found.includes(i),
              found = game.found.includes(i);
            return `<button type="button" data-leisure="memory-flip" data-index="${i}" data-revealed="${face}" data-found="${found}" aria-label="${t('leisure.card', {n: i + 1})}${face ? ': ' + t('leisure.cardName.' + value) : ''}" ${paused || game.waiting || game.actor !== 'user' || face ? 'disabled' : ''}><span class="memory-card-back"><i></i></span><span class="memory-card-front">${face ? officeCardArt(value) : ''}</span></button>`;
          })
          .join(
            '',
          )}</div><p class="leisure-caption">${t('leisure.memoryRule')}</p><div class="leisure-editor-actions"><button data-leisure="restart" ${paused ? 'disabled' : ''}>${t('leisure.restart')}</button><button data-leisure="play">${t('leisure.changeOpponent')}</button></div><small>${t('leisure.localOpponent')}</small>`;
      } else {
        const paused = gamePaused(game, people),
          winner = gameWinner(game.board);
        body = `<div class="leisure-game-partner">${game.opponent ? `<span class="leisure-portrait">${officeCharacter(game.opponent, project)}</span>` : ''}<strong>${esc(game.name)}</strong></div><p role="status">${t(paused ? 'leisure.paused' : winner === 'draw' ? 'leisure.draw' : winner === 'X' ? 'leisure.win' : winner === 'O' ? 'leisure.lose' : 'leisure.yourTurn')}</p><div class="leisure-board" role="group" aria-label="${t('leisure.tictactoe')}">${game.board.map((v, i) => `<button type="button" data-leisure="move" data-index="${i}" aria-label="${t('leisure.cell', {n: i + 1})}${v ? ': ' + v : ''}" ${paused || winner || v ? 'disabled' : ''}>${v}</button>`).join('')}</div><p class="leisure-caption">${t('leisure.rule')}</p><div class="leisure-editor-actions"><button type="button" data-leisure="restart" ${paused ? 'disabled' : ''}>${t('leisure.restart')}</button><button type="button" data-leisure="play">${t('leisure.changeOpponent')}</button></div><small>${t('leisure.localOpponent')}</small>`;
      }
      return `<aside class="office-leisure" data-mode="${mode}" aria-label="${t('leisure.' + (mode === 'decorate' ? 'decorate' : 'play'))}"><header><div><small class="leisure-eyebrow">${t(mode === 'decorate' ? 'leisure.studioEyebrow' : 'leisure.breakEyebrow')}</small><h3>${t('leisure.' + (mode === 'decorate' ? 'decorate' : 'play'))}</h3></div>${close}</header>${body}<p role="status" class="leisure-message">${esc(message)}</p></aside>`;
    },
    bind(host) {
      host.addEventListener('input', (e) => {
        if (e.target.matches('[data-leisure-json]')) importText = e.target.value;
      });
      host.addEventListener('change', async (e) => {
        if (!e.target.matches('[data-leisure-file]')) return;
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2200000) {
          message = t('leisure.packFailed');
          repaint();
          return;
        }
        importText = await file.text();
        repaint();
      });
      host.addEventListener('keydown', (e) => {
        const tile = e.target.closest('[data-leisure="tile"]');
        if (!tile || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0,
          dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        for (let n = 1; n < Math.max(map.width, map.height); n++) {
          const next = host.querySelector(
            `[data-leisure="tile"][data-x="${+tile.dataset.x + dx * n}"][data-y="${+tile.dataset.y + dy * n}"]`,
          );
          if (!next) break;
          if (!next.disabled) {
            tile.tabIndex = -1;
            next.tabIndex = 0;
            next.focus();
            break;
          }
        }
      });
      host.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-leisure]');
        if (!b) return;
        const action = b.dataset.leisure;
        if (action === 'shutdown') {
          if (!confirm(t('leisure.shutdownConfirm'))) return;
          try {
            await api('/api/office/companion-stop', {});
            notify(t('leisure.stopped'));
          } catch {
            notify(t('leisure.stopFailed'), {error: true});
          }
          return;
        }
        if (action === 'section') {
          if (!['furniture', 'appearance', 'assets'].includes(b.dataset.section)) return;
          decorateSection = b.dataset.section;
          repaint();
        } else if (action === 'decorate') {
          decorateSection = 'furniture';
          mode = 'decorate';
          draft = clone(custom);
          undo = [];
          selected = '';
          message = '';
          repaint();
        } else if (action === 'play') {
          draft = null;
          mode = 'choose';
          message = '';
          repaint();
        } else if (action === 'close') {
          mode = '';
          draft = null;
          message = '';
          repaint();
        } else if (action === 'start') start(b.dataset.id);
        else if (action === 'restart') {
          if (!gamePaused(game, people)) start(game.opponent);
        } else if (action === 'game-type') {
          gameType = b.dataset.type === 'tic' ? 'tic' : 'memory';
          repaint();
        } else if (action === 'memory-flip') {
          if (gamePaused(game, people)) return;
          try {
            game = memoryFlip(game, +b.dataset.index);
            repaint();
            advanceGame();
          } catch {
            /* stale input remains a no-op */
          }
        } else if (action === 'move') {
          if (gamePaused(game, people)) return;
          try {
            game.board = gameMove(game.board, +b.dataset.index, 'X');
            const at = computerMove(game.board);
            if (at >= 0) game.board = gameMove(game.board, at, 'O');
            repaint();
          } catch {
            /* stale click does not change board */
          }
        } else if (action === 'asset') {
          asset = b.dataset.asset;
          selected = '';
          rotation = 0;
          repaint();
        } else if (action === 'deselect') {
          selected = '';
          repaint();
        } else if (action === 'builtin') {
          selected = 'builtin:' + b.dataset.id;
          rotation = createOfficeMap(map.desks.length, draft.placements).byId(b.dataset.id).rotation;
          repaint();
        } else if (action === 'rotate') {
          rotation = (rotation + 1) % 4;
          if (selected.startsWith('builtin:')) {
            const id = selected.slice(8),
              f = createOfficeMap(map.desks.length, draft.placements).byId(id),
              next = clone(draft);
            next.placements ||= {};
            next.placements[id] = {x: f.x, y: f.y, rotation};
            setDraft(next);
          } else if (selected) {
            const next = clone(draft);
            next.items.find((i) => i.id === selected).rotation = rotation;
            setDraft(next);
          } else repaint();
        } else if (action === 'tile') {
          const x = +b.dataset.x,
            y = +b.dataset.y,
            catalog = furnitureCatalog(draft),
            hit = draft.items.find((i) => {
              const r = itemRect(i, catalog);
              return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
            });
          if (hit) {
            selected = hit.id;
            asset = hit.asset;
            rotation = hit.rotation;
            repaint();
            return;
          }
          const core = createOfficeMap(map.desks.length, draft.placements).furniture.find(
            (r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h,
          );
          if (core) {
            selected = 'builtin:' + core.id;
            rotation = core.rotation;
            repaint();
            return;
          }
          const next = clone(draft);
          if (selected.startsWith('builtin:')) {
            next.placements ||= {};
            next.placements[selected.slice(8)] = {x, y, rotation};
          } else if (selected)
            Object.assign(
              next.items.find((i) => i.id === selected),
              {x, y},
            );
          else {
            if (next.items.length >= 30) {
              message = t('leisure.limit');
              repaint();
              return;
            }
            next.items.push({id: crypto.randomUUID(), asset, x, y, rotation});
          }
          setDraft(next);
        } else if (action === 'remove') {
          setDraft({...clone(draft), items: draft.items.filter((i) => i.id !== selected)});
          selected = '';
        } else if (action === 'undo') {
          if (undo.length) {
            draft = undo.pop();
            selected = '';
            message = '';
            repaint();
          }
        } else if (action === 'reset') {
          setDraft({...clone(draft), items: [], placements: {}});
          selected = '';
        } else if (action === 'save') {
          try {
            if (layoutError(map, draft)) throw Error('INVALID_LAYOUT');
            saveCustom(project, draft);
            custom = clone(draft);
            draft = null;
            mode = '';
            message = '';
            repaint();
          } catch {
            message = t('leisure.saveFailed');
            repaint();
          }
        } else if (action === 'import') {
          try {
            const pack = validatePack(JSON.parse(importText));
            for (const a of pack.assets)
              await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () =>
                  image.naturalWidth <= 2048 &&
                  image.naturalHeight <= 2048 &&
                  (a.kind !== 'character' ||
                    (image.naturalWidth === a.width && image.naturalHeight === a.height))
                    ? resolve()
                    : reject(Error('INVALID_IMAGE'));
                image.onerror = reject;
                image.src = a.image;
              });
            if (mode !== 'decorate') return;
            const next = {...clone(draft), pack};
            if (next.items.some((i) => !Object.hasOwn(furnitureCatalog(next), i.asset)))
              throw Error('USED_ASSET');
            setDraft(next);
            message = t('leisure.imported');
            decorateSection = 'furniture';
            repaint();
          } catch {
            message = t('leisure.packFailed');
            repaint();
          }
        }
      });
    },
  };
}
