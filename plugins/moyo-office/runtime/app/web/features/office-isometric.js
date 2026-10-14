import {esc} from '../core/dom.js';
import {t} from '../core/i18n.js';
import {officeProjection, TILE, furniturePoint} from './office-map.js';
import {furnitureCatalog, worldDecorAssets} from './office-custom.js';

/** Furniture is built in world space, with separate vertical faces and ground-depth ordering. */
export function isometricOffice(map, people, canMeet, showMeetingAction = true, custom = null) {
  const camera = officeProjection(map, true);
  const objects = [];
  let activeFurniture;
  const worldPoint = (x, y) => {
    const q = activeFurniture ? activeFurniture.project({x, y}) : {x, y};
    return camera.point(q.x * TILE, q.y * TILE);
  };
  const placed = (id, draw) => {
    const before = activeFurniture;
    activeFurniture = map.byId(id);
    draw();
    activeFurniture = before;
  };
  function object(depthX, depthY, draw, link = '', attributes = '', foreground) {
    const owner = activeFurniture && !activeFurniture.decor ? `data-built-in="${activeFurniture.id}"` : '';
    const shapes = [],
      points = [];
    const point = (x, y, z = 0) => {
      const p = worldPoint(x, y);
      const result = [p.x, p.y - z];
      points.push(result);
      return result;
    };
    const polygon = (vertices, fill, stroke = '#394b5026') => {
      const p = vertices.map((v) => point(...v));
      shapes.push(
        `<polygon points="${p.map((v) => v.join(',')).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round"/>`,
      );
    };
    const box = (x, y, w, d, z, h, top = '#f2d8a8', front = '#caa777', side = '#dfbc88') => {
      const faces = [
        {
          nx: 1,
          ny: 0,
          vertices: [
            [x + w, y, z],
            [x + w, y + d, z],
            [x + w, y + d, z + h],
            [x + w, y, z + h],
          ],
        },
        {
          nx: 0,
          ny: 1,
          vertices: [
            [x, y + d, z],
            [x + w, y + d, z],
            [x + w, y + d, z + h],
            [x, y + d, z + h],
          ],
        },
        {
          nx: -1,
          ny: 0,
          vertices: [
            [x, y, z],
            [x, y + d, z],
            [x, y + d, z + h],
            [x, y, z + h],
          ],
        },
        {
          nx: 0,
          ny: -1,
          vertices: [
            [x, y, z],
            [x + w, y, z],
            [x + w, y, z + h],
            [x, y, z + h],
          ],
        },
      ]
        .map((face) => {
          let nx = face.nx,
            ny = face.ny;
          for (let i = 0; i < (activeFurniture?.rotation || 0); i++) [nx, ny] = [-ny, nx];
          return {...face, nx, ny};
        })
        .filter((face) => face.nx > 0 || face.ny > 0)
        .sort((a, b) => b.nx - a.nx);
      for (const face of faces) polygon(face.vertices, face.nx > 0 ? side : front);
      polygon(
        [
          [x, y, z + h],
          [x + w, y, z + h],
          [x + w, y + d, z + h],
          [x, y + d, z + h],
        ],
        top,
      );
    };
    const ellipse = (x, y, z, rx, ry, fill) => {
      const p = point(x, y, z);
      points.push([p[0] - rx, p[1] - ry], [p[0] + rx, p[1] + ry]);
      shapes.push(`<ellipse cx="${p[0]}" cy="${p[1]}" rx="${rx}" ry="${ry}" fill="${fill}"/>`);
    };
    draw({box, polygon, ellipse});
    const left = Math.min(...points.map((p) => p[0])) - 3,
      top = Math.min(...points.map((p) => p[1])) - 3;
    const width = Math.max(...points.map((p) => p[0])) - left + 3,
      height = Math.max(...points.map((p) => p[1])) - top + 3;
    const depth = Math.floor(worldPoint(depthX, depthY).y) + 10;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">${shapes.join('')}</svg>`;
    objects.push(
      `<div class="iso-object" ${attributes} ${owner} style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;z-index:${depth}">${link ? `<a class="iso-object-action" href="#office/files" aria-label="${esc(link)}">${svg}</a>` : svg}</div>`,
    );
    if (foreground) {
      const anchor = worldPoint(foreground.x, foreground.y);
      objects.push(
        `<div class="iso-object iso-furniture-foreground" ${owner} data-furniture="desk-front" data-seat="${foreground.seat}" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;z-index:${Math.floor(anchor.y) + 12};clip-path:inset(${Math.max(0, anchor.y - 22 - top)}px 0 0 0);pointer-events:none">${svg}</div>`,
      );
    }
  }
  // Floor and architectural shell: vertical back walls, open front, wood boards.
  object(-10, -10, ({box, polygon}) => {
    box(0, 0, map.width, map.height, -14, 14, 'var(--office-floor,#ead6b5)', '#acbabb', '#c6d4d0');
    for (let x = 1; x < map.width; x++)
      polygon(
        [
          [x, 0, 0],
          [x + 0.025, 0, 0],
          [x + 0.025, map.height, 0],
          [x, map.height, 0],
        ],
        '#d9c9aa55',
        'none',
      );
    box(0, 0, map.width, 0.22, 0, 95, '#f6f5ed', 'var(--office-wall,#dddccc)', '#bfcbd0');
    box(0, 0, 0.22, map.height, 0, 95, '#f6f5ed', '#b8c9c6', 'var(--office-wall,#dddccc)');
    for (let x = 2; x < map.width - 2; x += 4) {
      box(x, 0.24, 3, 0.1, 35, 47, '#fffdf6', '#98cbd9', '#d3e7e8');
      box(x + 1.45, 0.36, 0.09, 0.06, 35, 47, '#fff', '#f9ffff', '#f9ffff');
      box(x, 0.36, 3, 0.08, 54, 2, '#fff', '#fff', '#fff');
    }
    polygon(
      [
        [1, 2, 0.5],
        [13, 2, 0.5],
        [13, map.height - 5, 0.5],
        [1, map.height - 5, 0.5],
      ],
      'var(--office-rug,#cbdccf)',
      'none',
    );
    polygon(
      [
        [16, 2, 0.5],
        [23, 2, 0.5],
        [23, 9, 0.5],
        [16, 9, 0.5],
      ],
      '#c4dbe0',
      'none',
    );
    polygon(
      [
        [16, 11, 0.5],
        [23, 11, 0.5],
        [23, 18, 0.5],
        [16, 18, 0.5],
      ],
      '#e6c7b8',
      'none',
    );
  });
  for (const [i, p] of map.defaultDesks.entries()) {
    placed('desk-' + i, () => {
      object(
        p.x + 0.5,
        p.y - 0.1,
        ({box, ellipse, polygon}) => {
          const x = p.x - 1,
            y = p.y - 2;
          ellipse(x + 1.5, y + 1.1, 0, 65, 24, '#53676518');
          for (const dx of [0.15, 2.55])
            for (const dy of [0.15, 1.55])
              box(x + dx, y + dy, 0.12, 0.12, 0, 31, '#e2e7e3', '#8b9e9d', '#b5c4bf');
          box(x, y, 3, 2, 31, 6, '#f5d7a2', '#c49a67', '#deb985');
          box(x + 0.18, y + 0.2, 0.55, 1.2, 0, 29, '#f1f3ed', '#c0cfcc', '#dae2d9');
          for (const z of [8, 17, 25])
            box(x + 0.19, y + 1.4, 0.48, 0.03, z, 1, '#8fa4a1', '#8fa4a1', '#8fa4a1');
          box(x + 1.2, y + 0.65, 0.55, 0.4, 37, 2, '#586874', '#35434d', '#475863');
          box(x + 1.45, y + 0.8, 0.12, 0.1, 39, 12, '#657882', '#3b4e57', '#61747a');
          box(x + 0.9, y + 0.72, 1.25, 0.14, 47, 30, '#455960', '#283b44', '#667c80');
          if (![1, 2].includes(activeFurniture?.rotation)) {
            polygon(
              [
                [x + 0.98, y + 0.87, 50],
                [x + 2.08, y + 0.87, 50],
                [x + 2.08, y + 0.87, 73],
                [x + 0.98, y + 0.87, 73],
              ],
              '#79b9c7',
            );
            for (let l = 0; l < 4; l++)
              box(x + 1.08, y + 0.885, 0.35 + l * 0.1, 0.005, 54 + l * 4, 1, '#cee8e8', '#cee8e8', '#cee8e8');
          }
          box(x + 1, y + 1.25, 1.2, 0.45, 37, 2, '#e9edef', '#c0cacc', '#d9e0e1');
          box(x + 2.45, y + 0.45, 0.3, 0.5, 37, 2, '#c78975', '#a66b58', '#dea08d');
          box(x + 0.35, y + 1.6, 0.22, 0.22, 37, 9, '#fff7e6', '#d4b080', '#ecd8b8');
        },
        people[i] ? t('pixel.computer', {name: people[i].data.name}) : '',
        `data-furniture="desk" data-seat="${i}"`,
        {x: p.x + 0.5, y: p.y + 0.5, seat: i},
      );
      object(
        p.x + 0.5,
        p.y + 0.3,
        ({box, ellipse}) => {
          ellipse(p.x + 0.5, p.y + 0.4, 0, 20, 8, '#59676725');
          box(p.x + 0.4, p.y + 0.25, 0.13, 0.15, 0, 18, '#899da2', '#556b75', '#6d818b');
          box(p.x + 0.05, p.y, 0.85, 0.8, 18, 5, '#789694', '#496c6d', '#618384');
          box(p.x + 0.05, p.y + 0.7, 0.85, 0.12, 20, 25, '#9bb4aa', '#628483', '#7f9c92');
        },
        '',
        `data-furniture="chair" data-seat="${i}"`,
      );
    });
  }
  for (const r of map.walls)
    object(r.x + r.w / 2, r.y + r.h / 2, ({box}) => {
      box(r.x + 0.35, r.y, 0.15, r.h, 0, 18, '#f8f5e8', '#c5d5d3', '#dfebe7');
      box(r.x + 0.38, r.y, 0.07, r.h, 18, 27, '#f0fcfc', '#b8dbdf99', '#d1e9e999');
    });
  placed('table', () => {
    object(20, 6, ({box}) => {
      box(18.3, 4.3, 0.18, 1.4, 0, 29, '#a7b3b2', '#6e8084', '#879697');
      box(21.5, 4.3, 0.18, 1.4, 0, 29, '#a7b3b2', '#6e8084', '#879697');
      box(18, 4, 4, 2, 29, 6, '#eed4ab', '#b39067', '#d3ad7e');
      box(19.4, 4.6, 0.8, 0.5, 35, 2, '#ffffff', '#d1dcd8', '#e1e8e1');
    });
    for (const seat of map.defaultMeeting) {
      const x = seat.x + 0.1,
        y = seat.y + 0.1;
      object(x + 0.4, y + 0.6, ({box}) => {
        box(x, y, 0.8, 0.7, 0, 17, '#89a7ac', '#496c79', '#648991');
        box(x, y + 0.6, 0.8, 0.12, 17, 16, '#9ab9bb', '#688c96', '#7c9ea6');
      });
    }
  });
  placed('sofa', () => {
    object(20, 13, ({box}) => {
      box(17, 12, 5, 1, 0, 19, '#deaa88', '#b68065', '#cb977a');
      box(17, 12, 5, 0.25, 19, 29, '#edc1a1', '#d4a384', '#dfb698');
      for (const x of [17.2, 18.8, 20.4]) box(x, 12.28, 1.4, 0.7, 19, 7, '#f3cdb0', '#dcad8d', '#e9bd9c');
      box(17, 12, 0.22, 1, 19, 14, '#e7bb99', '#cb977a', '#dca988');
      box(21.78, 12, 0.22, 1, 19, 14, '#e7bb99', '#cb977a', '#dca988');
    });
  });
  placed('coffee', () => {
    object(21, 16, ({box}) => {
      box(20.8, 15.8, 0.4, 0.4, 0, 19, '#cbac7b', '#a38660', '#b89a6b');
      box(20, 15, 2, 2, 19, 5, '#f4dfaf', '#c6a674', '#dec18d');
      box(20.6, 15.6, 0.4, 0.65, 24, 2, '#9daeb9', '#7c919e', '#8da1ad');
    });
  });
  placed('pantry', () => {
    object(4, map.height - 3, ({box}) => {
      box(2, map.height - 4, 4, 1, 0, 36, '#fbf6e9', '#c0cfc9', '#e1e7dc');
      box(2.3, map.height - 3.85, 0.8, 0.6, 36, 20, '#526570', '#394b57', '#697d83');
      box(4.7, map.height - 3.8, 0.8, 0.65, 36, 6, '#93b9bc', '#789c9f', '#b8d3d0');
    });
  });
  placed('shelf', () => {
    object(10.5, map.height - 3, ({box}) => {
      box(9, map.height - 4, 3, 1, 0, 65, '#e8d2ad', '#bc9e77', '#dac199');
      if (![1, 2].includes(activeFurniture?.rotation))
        for (const z of [7, 27, 47])
          for (let i = 0; i < 9; i++)
            box(
              9.15 + i * 0.3,
              map.height - 3.2,
              0.19,
              0.18,
              z,
              14 + (i % 3) * 2,
              ['#80a6a3', '#d79b7f', '#e5d5a4'][i % 3],
              '#849aa1',
              '#b3c5be',
            );
    });
  });
  for (const [x, y] of [
    [1, 1],
    [1, map.height - 2],
    [22, 1],
    [15, 10],
    [22, 17],
  ])
    object(x + 0.4, y + 0.4, ({box, ellipse}) => {
      box(x, y, 0.65, 0.65, 0, 17, '#eee6d7', '#bea98b', '#d8c8b0');
      for (const [dx, dy, z] of [
        [0.2, 0.2, 29],
        [0.5, 0.3, 35],
        [0.2, 0.5, 41],
        [0.4, 0.3, 48],
      ])
        ellipse(x + dx, y + dy, z, 13, 11, z % 2 ? '#668e6e' : '#8bae83');
    });
  // Keep the established meeting command available as a real control, not painted text.
  if (custom) {
    const catalog = furnitureCatalog(custom);
    for (const item of custom.items) {
      const a = catalog[item.asset];
      if (a.image || !worldDecorAssets.includes(item.asset)) continue;
      const source = {x: item.x, y: item.y, w: a.w, h: a.h};
      activeFurniture = {decor: true, project: (p) => furniturePoint(source, item, p)};
      const x = item.x,
        y = item.y;
      object(
        x + a.w / 2,
        y + a.h / 2,
        ({box, ellipse, polygon}) => {
          if (item.asset === 'plant') {
            box(x + 0.18, y + 0.18, 0.64, 0.64, 0, 17, '#eee6d7', '#bea98b', '#d8c8b0');
            for (const [dx, dy, z] of [
              [0.3, 0.3, 30],
              [0.65, 0.45, 37],
              [0.35, 0.65, 43],
              [0.5, 0.4, 48],
            ])
              ellipse(x + dx, y + dy, z, 13, 10, z % 2 ? '#668e6e' : '#8bae83');
          } else if (item.asset === 'stool') {
            box(x + 0.24, y + 0.24, 0.52, 0.52, 0, 19, '#c7b396', '#ac947a', '#bca88e');
            box(x + 0.12, y + 0.12, 0.76, 0.76, 19, 7, '#ead6b5', '#c7ad8a', '#d8bf9a');
          } else if (item.asset === 'humidifier') {
            box(x + 0.18, y + 0.18, 0.64, 0.64, 0, 24, '#f1f1e6', '#b7cdca', '#d6e2da');
            box(x + 0.22, y + 0.22, 0.56, 0.56, 24, 3, '#eef5ee', '#bbcfc6', '#d5e4da');
            ellipse(x + 0.5, y + 0.5, 28, 5, 2, '#91aba5');
            for (const [z, rx] of [
              [35, 6],
              [42, 8],
              [49, 10],
            ])
              ellipse(x + 0.48, y + 0.5, z, rx, 4, '#e5f0efbb');
          } else if (item.asset === 'television') {
            box(x + 0.1, y + 0.12, 1.8, 0.7, 0, 19, '#e3ceb0', '#b8a58c', '#caba9f');
            box(x + 0.9, y + 0.4, 0.2, 0.12, 19, 7, '#8ea2a1', '#677e7d', '#7c9190');
            box(x + 0.18, y + 0.3, 1.64, 0.12, 26, 43, '#718888', '#3d555a', '#5c7376');
            polygon(
              [
                [x + 0.26, y + 0.43, 31],
                [x + 1.74, y + 0.43, 31],
                [x + 1.74, y + 0.43, 64],
                [x + 0.26, y + 0.43, 64],
              ],
              '#a1c7ce',
            );
            polygon(
              [
                [x + 0.26, y + 0.44, 31],
                [x + 0.26, y + 0.44, 46],
                [x + 0.75, y + 0.44, 52],
                [x + 1.2, y + 0.44, 37],
                [x + 1.74, y + 0.44, 48],
                [x + 1.74, y + 0.44, 31],
              ],
              '#bfd5bf',
              'none',
            );
          } else if (item.asset === 'whiteboard') {
            for (const dx of [0.25, 1.55]) {
              box(x + dx, y + 0.15, 0.12, 0.65, 0, 5, '#c9d4cf', '#a0b3ac', '#b7c7be');
              box(x + dx, y + 0.38, 0.1, 0.1, 5, 63, '#d8e1da', '#a9bcb2', '#bdcfc2');
            }
            box(x + 0.08, y + 0.32, 1.84, 0.12, 32, 44, '#e7eee5', '#f6f6ec', '#c5d1c6');
            for (const [dx, z, w] of [
              [0.24, 65, 1.12],
              [0.24, 57, 0.72],
              [0.9, 45, 0.62],
            ])
              polygon(
                [
                  [x + dx, y + 0.45, z],
                  [x + dx + w, y + 0.45, z],
                  [x + dx + w, y + 0.45, z + 2],
                  [x + dx, y + 0.45, z + 2],
                ],
                z === 45 ? '#d2b48e' : '#96b2a1',
                'none',
              );
          } else if (item.asset === 'massage-chair') {
            box(x + 0.12, y + 0.12, 0.76, 1.65, 0, 15, '#b3bcb2', '#82958c', '#9eafa3');
            box(x + 0.17, y + 0.18, 0.66, 0.35, 15, 43, '#c4ccbc', '#94a995', '#afbea8');
            box(x + 0.23, y + 0.57, 0.54, 0.72, 15, 15, '#d1d6c5', '#aabc9f', '#bac9ae');
            for (const dx of [0.1, 0.76])
              box(x + dx, y + 0.5, 0.16, 0.82, 15, 20, '#bec8b5', '#8fa389', '#a6b89b');
            box(x + 0.22, y + 1.3, 0.56, 0.5, 8, 16, '#bec9b5', '#93a78c', '#aabc9e');
          } else if (item.asset === 'lamp') {
            ellipse(x + 0.5, y + 0.5, 2, 16, 8, '#c9b28c');
            box(x + 0.47, y + 0.47, 0.06, 0.06, 0, 62, '#e8dac0', '#b4a187', '#c9b69a');
            box(x + 0.18, y + 0.18, 0.64, 0.64, 55, 19, '#f1e4c4', '#d5bf95', '#e6d2aa');
            ellipse(x + 0.5, y + 0.5, 55, 12, 6, '#f9ecd0');
          }
        },
        '',
        `data-decor-id="${esc(item.id)}"`,
      );
      activeFurniture = undefined;
    }
  }
  const meetingPoint = map.byId('table').project({x: 20, y: 7});
  const p = camera.point(meetingPoint.x * TILE, meetingPoint.y * TILE);
  if (showMeetingAction)
    objects.push(
      `<button type="button" class="pixel-table iso-meeting-action" style="left:${p.x}px;top:${p.y}px" data-pixel-command="meeting" ${canMeet ? '' : 'disabled'}>${t('pixel.meetingRoom')}</button>`,
    );
  return objects.join('');
}
