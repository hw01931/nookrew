import {createOfficeMap, officePath, TILE, officeProjection} from './office-map.js';
import {esc} from '../core/dom.js';

export const decorCatalog = {
  plant: {w: 1, h: 1, solid: true, color: '#71977e'},
  stool: {w: 1, h: 1, solid: true, color: '#bd9574'},
  rug: {w: 2, h: 2, solid: false, color: '#c8a6a1'},
  humidifier: {w: 1, h: 1, solid: true, color: '#91c5ce'},
  television: {w: 2, h: 1, solid: true, color: '#485d70'},
  'massage-chair': {w: 1, h: 2, solid: true, color: '#9b9cc8'},
  whiteboard: {w: 2, h: 1, solid: true, color: '#dce9e6'},
  lamp: {w: 1, h: 1, solid: true, color: '#e6bc76'},
};
const storageKey = (root) => 'office-custom:v2:' + root;
export const worldDecorAssets = Object.keys(decorCatalog).filter((id) => id !== 'rug');
export function validatePack(pack) {
  if (JSON.stringify(pack).length > 2200000) throw Error('PACK_TOO_LARGE');
  if (pack?.schemaVersion !== 1 || !Array.isArray(pack.assets) || pack.assets.length > 12)
    throw Error('INVALID_PACK');
  const seen = new Set();
  const assets = pack.assets.map((a) => {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(a.id) || seen.has(a.id) || Object.hasOwn(decorCatalog, a.id))
      throw Error('INVALID_ASSET_ID');
    seen.add(a.id);
    if (
      !['character', 'furniture'].includes(a.kind) ||
      typeof a.name !== 'string' ||
      !a.name.trim() ||
      a.name.length > 40 ||
      typeof a.image !== 'string' ||
      a.image.length > 700000 ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(a.image)
    )
      throw Error('INVALID_ASSET');
    const result = {id: a.id, kind: a.kind, name: a.name.trim(), image: a.image};
    if (a.kind === 'character') {
      if (
        !Number.isInteger(a.width) ||
        !Number.isInteger(a.height) ||
        a.width < 64 ||
        a.width > 2048 ||
        a.height < 64 ||
        a.height > 2048 ||
        a.width % 4 ||
        a.height % 4
      )
        throw Error('INVALID_SPRITE');
      Object.assign(result, {width: a.width, height: a.height});
    } else {
      if (![1, 2, 3].includes(a.w) || ![1, 2, 3].includes(a.h) || typeof a.solid !== 'boolean')
        throw Error('INVALID_FURNITURE');
      Object.assign(result, {w: a.w, h: a.h, solid: a.solid});
    }
    return result;
  });
  return {schemaVersion: 1, assets};
}
export function readCustom(root) {
  try {
    const v = JSON.parse(
      localStorage.getItem(storageKey(root)) || localStorage.getItem('office-custom:v1:' + root),
    );
    const pack = validatePack(v?.pack || {schemaVersion: 1, assets: []});
    const catalog = {
      ...decorCatalog,
      ...Object.fromEntries(pack.assets.filter((a) => a.kind === 'furniture').map((a) => [a.id, a])),
    };
    const items = Array.isArray(v.items)
      ? v.items
          .filter(
            (a) =>
              typeof a.id === 'string' &&
              a.id.length < 80 &&
              Object.hasOwn(catalog, a.asset) &&
              Number.isInteger(a.x) &&
              Number.isInteger(a.y) &&
              [0, 1, 2, 3].includes(a.rotation),
          )
          .slice(0, 30)
      : [];
    const placements = Object.fromEntries(
      Object.entries(v.placements || {}).filter(
        ([id, p]) =>
          /^(desk-\d+|table|sofa|coffee|pantry|shelf)$/.test(id) &&
          p &&
          Number.isInteger(p.x) &&
          Number.isInteger(p.y) &&
          [0, 1, 2, 3].includes(p.rotation),
      ),
    );
    return {schemaVersion: 2, pack, items, placements};
  } catch {
    return {
      schemaVersion: 2,
      pack: {schemaVersion: 1, assets: []},
      items: [
        {id: 'welcome-whiteboard', asset: 'whiteboard', x: 18, y: 1, rotation: 0},
        {id: 'welcome-tv', asset: 'television', x: 16, y: 15, rotation: 0},
        {id: 'welcome-massage', asset: 'massage-chair', x: 22, y: 14, rotation: 0},
        {id: 'welcome-humidifier', asset: 'humidifier', x: 15, y: 12, rotation: 0},
        {id: 'welcome-lamp', asset: 'lamp', x: 22, y: 11, rotation: 0},
      ],
      placements: {},
    };
  }
}
export function saveCustom(root, v) {
  validatePack(v.pack);
  localStorage.setItem(storageKey(root), JSON.stringify({...v, schemaVersion: 2}));
}
export function furnitureCatalog(custom) {
  return {
    ...decorCatalog,
    ...Object.fromEntries(custom.pack.assets.filter((a) => a.kind === 'furniture').map((a) => [a.id, a])),
  };
}
export function itemRect(item, catalog) {
  const a = catalog[item.asset];
  return {x: item.x, y: item.y, w: item.rotation % 2 ? a.h : a.w, h: item.rotation % 2 ? a.w : a.h};
}
/** Reject blocked anchors and disconnected required seats; base geometry remains the owner. */
export function layoutError(base, custom) {
  base = createOfficeMap(base.desks.length, custom.placements);
  if (base.furnitureError) return base.furnitureError;
  const catalog = furnitureCatalog(custom),
    cells = new Set(),
    occupied = new Set(),
    ids = new Set(),
    anchors = [...base.desks, ...base.meeting, ...base.lounge, ...base.research];
  for (const item of custom.items) {
    const a = catalog[item.asset];
    if (ids.has(item.id)) return 'occupied';
    ids.add(item.id);
    if (!a) return 'asset';
    const r = itemRect(item, catalog);
    for (let x = r.x; x < r.x + r.w; x++)
      for (let y = r.y; y < r.y + r.h; y++) {
        const key = x + ',' + y;
        if (!base.walkable({x, y}) || occupied.has(key) || anchors.some((p) => p.x === x && p.y === y))
          return 'occupied';
        occupied.add(key);
        if (a.solid) cells.add(key);
      }
  }
  const map = {...base, walkable: (p) => base.walkable(p) && !cells.has(p.x + ',' + p.y)};
  const entrance = {x: 13, y: base.height - 2};
  if (anchors.some((p) => !officePath(map, entrance, p).length)) return 'path';
  return '';
}
export function customMap(base, custom) {
  if (layoutError(base, custom)) return base;
  base = createOfficeMap(base.desks.length, custom.placements);
  const catalog = furnitureCatalog(custom),
    cells = new Set();
  for (const item of custom.items)
    if (catalog[item.asset].solid) {
      const r = itemRect(item, catalog);
      for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) cells.add(x + ',' + y);
    }
  return {...base, walkable: (p) => base.walkable(p) && !cells.has(p.x + ',' + p.y)};
}
export function customScene(map, custom, iso) {
  const catalog = furnitureCatalog(custom),
    camera = officeProjection(map, iso);
  if (layoutError(map, custom)) return '';
  return custom.items
    .map((item) => {
      const a = catalog[item.asset],
        r = itemRect(item, catalog),
        p = camera.point((r.x + r.w / 2) * TILE, (r.y + r.h / 2) * TILE);
      if (iso && !a.image && worldDecorAssets.includes(item.asset)) return '';
      const width = (r.w + r.h) * TILE * (iso ? 0.866 : 0.5);
      const graphic = a.image
        ? `<img src="${a.image}" alt="">`
        : item.asset === 'plant'
          ? '<span class="decor-pot"></span><span class="decor-leaves"></span>'
          : decorGraphic(item.asset) || '<span class="decor-surface"></span>';
      return `<div class="office-decor decor-${esc(item.asset)}" data-decor-id="${esc(item.id)}" style="left:${p.x}px;top:${p.y}px;width:${width}px;--decor-color:${a.color || '#9db3a5'};z-index:${a.solid ? Math.floor(p.y) + 10 : 1};${a.solid ? '' : `height:${(r.w + r.h) * TILE * 0.5}px;transform:translate(-50%,-50%) ${iso ? 'scaleY(.5) rotate(45deg)' : ''}`}">${graphic}</div>`;
    })
    .join('');
}
function decorGraphic(asset) {
  const shapes = {
    humidifier:
      '<ellipse cx="48" cy="77" rx="22" ry="8" fill="#47677725"/><path d="M28 43Q48 32 68 43V70Q48 84 28 70Z" fill="#c3e5e7" stroke="#729fa5"/><ellipse cx="48" cy="43" rx="20" ry="8" fill="#f5ffff"/><path d="M40 32Q29 22 41 13M50 30Q63 20 51 7M58 34Q69 27 62 18" fill="none" stroke="#d7f5f8" stroke-width="4" stroke-linecap="round"/><circle cx="56" cy="65" r="3" fill="#5ab9bd"/>',
    television:
      '<path d="M18 62L66 77L85 65L39 51Z" fill="#bda37c"/><path d="M22 17L77 34V64L22 47Z" fill="#35465c"/><path d="M26 22L73 37V57L26 43Z" fill="#91c7d7"/><path d="M28 37L46 30L58 47L72 42V55L28 42Z" fill="#b3dfcf"/><path d="M48 54V66L60 70" fill="none" stroke="#475767" stroke-width="4"/>',
    'massage-chair':
      '<path d="M24 27Q24 9 45 15L69 23Q78 28 77 44L72 65L48 78L23 67Z" fill="#969cc5" stroke="#65708f"/><path d="M30 25L60 34L57 55L28 45Z" fill="#c9cbe3"/><path d="M28 47L57 56L70 52L71 68L48 78L23 67Z" fill="#aeb4d5"/><path d="M26 65L45 72L47 87L23 77Z" fill="#727d9e"/><path d="M30 26L29 43M43 29L42 47M56 34L54 51" stroke="#a3aacc" stroke-width="2"/>',
    whiteboard:
      '<path d="M20 12L78 30V64L20 46Z" fill="#f8fcf8" stroke="#a6bbb6" stroke-width="3"/><path d="M30 27L62 37M30 35L50 41" stroke="#78b1a3" stroke-width="3"/><path d="M56 47L68 51M31 42L44 46" stroke="#e4b575" stroke-width="3"/><path d="M27 48V73M70 62V85" stroke="#8da49e" stroke-width="4"/><path d="M19 75L35 80M62 85L80 90" stroke="#8da49e" stroke-width="4"/>',
    lamp: '<ellipse cx="48" cy="78" rx="19" ry="7" fill="#c8a66b"/><path d="M48 37V75" stroke="#baa77d" stroke-width="5"/><path d="M34 17L61 24L70 44Q48 55 25 40Z" fill="#f7ddb0" stroke="#d3b17c"/><ellipse cx="48" cy="42" rx="22" ry="9" fill="#fff0c9"/>',
  };
  return shapes[asset] ? `<svg viewBox="0 0 96 96" aria-hidden="true">${shapes[asset]}</svg>` : '';
}
