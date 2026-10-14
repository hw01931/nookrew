import {officeAvatarOptions, officeAppearance, officeSpriteGrid} from './office-art.js';
/** Shared art frames for map, roster and profile; no employee/state creation. */
export function officeCharacter(id, project = '', selected) {
  const avatars = officeAvatarOptions(project);
  const avatar = Object.hasOwn(avatars, selected) ? selected : officeAppearance(id, project);
  const art = avatars[avatar];
  const grid = {
    width: art.width || officeSpriteGrid.width,
    height: art.height || officeSpriteGrid.height,
    columns: 4,
  };
  const frames = Object.entries(art.faces)
    .map(([face, row]) => {
      const [y, h] = art.rows[row];
      return [0, 1, 2, 3]
        .map(
          (col) =>
            `<svg class="avatar-frame avatar-facing-${face} avatar-pose-${col}" preserveAspectRatio="xMidYMid slice" viewBox="${(col * grid.width) / officeSpriteGrid.columns} ${y} ${grid.width / officeSpriteGrid.columns} ${h}" width="80" height="100" x="0" y="0"><image href="${art.url}" width="${grid.width}" height="${grid.height}"/></svg>`,
        )
        .join('');
    })
    .join('');
  return `<span class="pixel-sprite office-avatar" data-avatar="${avatar}" data-mirror-back="${!!art.mirrorBack}" aria-hidden="true"><svg viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg">${frames}</svg></span>`;
}
