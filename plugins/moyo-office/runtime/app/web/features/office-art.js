import {readCustom} from './office-custom.js';
/** One asset contract for every office surface; theme art never grants permissions. */
export const officeSpriteGrid = {width: 1254, height: 1254, columns: 4};
export const officeAvatars = {
  mint: {
    url: '/assets/office/colleague-v2.png',
    rows: [
      [0, 330],
      [330, 315],
      [645, 300],
      [945, 309],
    ],
    faces: {se: 0, sw: 1, ne: 2, nw: 2},
    mirrorBack: true,
  },
  lavender: {
    url: '/assets/office/colleague-lavender.png',
    rows: [
      [0, 330],
      [330, 315],
      [645, 300],
      [945, 309],
    ],
    faces: {se: 0, sw: 1, ne: 2, nw: 3},
  },
  blue: {
    url: '/assets/office/colleague-blue.png',
    rows: [
      [0, 330],
      [330, 315],
      [645, 300],
      [945, 309],
    ],
    faces: {se: 0, sw: 1, ne: 3, nw: 2},
  },
  peach: {
    url: '/assets/office/colleague-peach.png',
    rows: [
      [0, 330],
      [330, 315],
      [645, 300],
      [945, 309],
    ],
    faces: {se: 0, sw: 1, ne: 2, nw: 3},
  },
};
export function officeAvatarOptions(project = '') {
  return {
    ...officeAvatars,
    ...Object.fromEntries(
      readCustom(project)
        .pack.assets.filter((a) => a.kind === 'character')
        .map((a) => [
          'user-' + a.id,
          {
            url: a.image,
            width: a.width,
            height: a.height,
            rows: [0, 1, 2, 3].map((i) => [(i * a.height) / 4, a.height / 4]),
            faces: {se: 0, sw: 1, ne: 2, nw: 3},
          },
        ]),
    ),
  };
}
const key = (project, id) => 'office-appearance:v1:' + project + ':' + id;
export function officeAppearance(id, project = '') {
  try {
    const selected = localStorage.getItem(key(project, id));
    if (Object.hasOwn(officeAvatarOptions(project), selected)) return selected;
  } catch {
    /* default artwork remains available */
  }
  let hash = 0;
  for (const letter of id) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
  return Object.keys(officeAvatars)[hash % Object.keys(officeAvatars).length];
}
export function saveOfficeAppearance(id, project, avatar) {
  if (!Object.hasOwn(officeAvatarOptions(project), avatar)) throw Error('INVALID_OFFICE_AVATAR');
  localStorage.setItem(key(project, id), avatar);
}
