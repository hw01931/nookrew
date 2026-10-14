/** Shared scene geometry. Coordinates are walkable tile centers, never business state. */
export const TILE = 40;
export function furniturePoint(source, placement, p) {
  const dx = p.x - source.x,
    dy = p.y - source.y;
  const {x, y, rotation} = placement;
  return rotation === 1
    ? {x: x + source.h - dy, y: y + dx}
    : rotation === 2
      ? {x: x + source.w - dx, y: y + source.h - dy}
      : rotation === 3
        ? {x: x + dy, y: y + source.w - dx}
        : {x: x + dx, y: y + dy};
}
export function officeProjection(map, isometric = false) {
  const w = map.width * TILE,
    h = map.height * TILE;
  return {
    width: isometric ? (w + h) * 0.866 + 80 : w,
    height: isometric ? (w + h) * 0.5 + 100 : h,
    offsetX: h * 0.866 + 40,
    point: (x, y, z = 0) =>
      isometric ? {x: (x - y) * 0.866 + h * 0.866 + 40, y: (x + y) * 0.5 + 60 - z} : {x, y: y - z},
  };
}
export function createOfficeMap(count, placements = {}) {
  const rows = Math.max(2, Math.ceil(count / 3));
  const height = Math.max(19, rows * 5 + 7);
  const defaultDesks = Array.from({length: count}, (_, i) => ({
    x: 3 + (i % 3) * 4,
    y: 5 + Math.floor(i / 3) * 5,
  }));
  const defaults = [
    ...defaultDesks.map((p, i) => ({id: 'desk-' + i, x: p.x - 1, y: p.y - 2, w: 3, h: 2, kind: 'desk'})),
    {id: 'table', x: 18, y: 4, w: 4, h: 2, kind: 'table'},
    {id: 'sofa', x: 17, y: 12, w: 5, h: 1, kind: 'sofa'},
    {id: 'coffee', x: 20, y: 15, w: 2, h: 2, kind: 'coffee'},
    {id: 'pantry', x: 2, y: height - 4, w: 4, h: 1, kind: 'pantry'},
    {id: 'shelf', x: 9, y: height - 4, w: 3, h: 1, kind: 'shelf'},
  ];
  const furniture = defaults.map((source) => {
    const edit = placements[source.id];
    const valid =
      edit && Number.isInteger(edit.x) && Number.isInteger(edit.y) && [0, 1, 2, 3].includes(edit.rotation);
    const x = valid ? edit.x : source.x,
      y = valid ? edit.y : source.y,
      rotation = valid ? edit.rotation : 0;
    const project = (p) => furniturePoint(source, {x, y, rotation}, p);
    const tile = (p) => {
      const q = project({x: p.x + 0.5, y: p.y + 0.5});
      return {x: Math.round(q.x - 0.5), y: Math.round(q.y - 0.5)};
    };
    const facing = (face) =>
      ['se', 'sw', 'nw', 'ne'][(['se', 'sw', 'nw', 'ne'].indexOf(face) + rotation) % 4];
    return {
      ...source,
      x,
      y,
      w: rotation % 2 ? source.h : source.w,
      h: rotation % 2 ? source.w : source.h,
      rotation,
      source,
      project,
      tile,
      facing,
    };
  });
  const byId = (id) => furniture.find((r) => r.id === id);
  const obstacles = furniture.map(({id, x, y, w, h, kind}) => ({id, x, y, w, h, kind}));
  const walls = [
    {x: 14, y: 1, w: 1, h: 6},
    {x: 14, y: 9, w: 1, h: 5},
    {x: 14, y: 16, w: 1, h: height - 17},
    {x: 15, y: 10, w: 4, h: 1},
    {x: 21, y: 10, w: 2, h: 1},
  ];
  const blocked = new Set(),
    occupied = new Set();
  let furnitureError = '';
  for (const r of walls)
    for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) blocked.add(x + ',' + y);
  for (const r of obstacles)
    for (let x = r.x; x < r.x + r.w; x++)
      for (let y = r.y; y < r.y + r.h; y++) {
        const key = x + ',' + y;
        if (x < 1 || x >= 23 || y < 1 || y >= height - 1 || blocked.has(key) || occupied.has(key))
          furnitureError = 'occupied';
        occupied.add(key);
      }
  for (const key of occupied) blocked.add(key);
  const walkable = (p) =>
    p.x >= 1 && p.x < 23 && p.y >= 1 && p.y < height - 1 && !blocked.has(p.x + ',' + p.y);
  const defaultMeeting = [
    {x: 17, y: 4},
    {x: 22, y: 4},
    {x: 17, y: 7},
    {x: 22, y: 7},
    {x: 19, y: 7},
    {x: 20, y: 3},
  ];
  const defaultLounge = [
    {x: 17, y: 13},
    {x: 19, y: 13},
    {x: 21, y: 13},
    {x: 17, y: 17},
    {x: 19, y: 17},
    {x: 22, y: 17},
  ];
  const desks = defaultDesks.map((p, i) => byId('desk-' + i).tile(p));
  const meeting = defaultMeeting.map((p) => byId('table').tile(p));
  const lounge = defaultLounge.map((p, i) => (i < 3 ? byId('sofa').tile(p) : p));
  const research = [9, 10, 11].map((x) => byId('shelf').tile({x, y: height - 3}));
  const sofaSeats = defaultLounge.slice(0, 3).map((p) => ({
    ...byId('sofa').tile(p),
    visual: byId('sofa').project({x: p.x + 0.5, y: p.y + 0.5 - 0.9}),
    facing: byId('sofa').facing('se'),
  }));
  return {
    width: 24,
    height,
    count,
    defaultDesks,
    defaultMeeting,
    furniture,
    byId,
    furnitureError,
    desks,
    obstacles,
    walls,
    walkable,
    meeting,
    lounge,
    research,
    sofaSeats,
    sofaDepth: byId('sofa').project({x: 20, y: 13}),
    researchDepth: byId('shelf').project({x: 10.5, y: height - 3}),
    deskFacing: desks.map((_, i) => byId('desk-' + i).facing('ne')),
    meetingFacing: defaultMeeting.map((p) => byId('table').facing(p.x > 19 ? 'nw' : 'se')),
  };
}
export function officePath(map, from, to) {
  const start = {x: Math.round(from.x), y: Math.round(from.y)},
    key = (p) => p.x + ',' + p.y;
  if (!map.walkable(start) || !map.walkable(to)) return [];
  const queue = [start],
    seen = new Map([[key(start), null]]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (key(p) === key(to)) {
      const path = [];
      let at = p;
      while (at) {
        path.unshift(at);
        at = seen.get(key(at));
      }
      return path;
    }
    for (const d of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const next = {x: p.x + d[0], y: p.y + d[1]};
      if (map.walkable(next) && !seen.has(key(next))) {
        seen.set(key(next), p);
        queue.push(next);
      }
    }
  }
  return [];
}
export function officeDestination(map, index, status, stop = 0, reserved = new Set(), activity = 'WORK') {
  const pool =
    status === 'RUNNING' && ['SEARCH', 'READ'].includes(activity)
      ? map.research
      : status === 'MEETING'
        ? map.meeting
        : status === 'IDLE'
          ? map.lounge
          : [];
  for (let offset = 0; offset < pool.length; offset++) {
    const point = pool[(index + stop + offset) % pool.length];
    if (!reserved.has(point.x + ',' + point.y)) return point;
  }
  return map.desks[index];
}
