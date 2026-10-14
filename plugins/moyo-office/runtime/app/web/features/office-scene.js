/* i18n: all text from catalogs */
import {customMap, customScene, layoutError} from './office-custom.js';
import {isometricOffice} from './office-isometric.js';
import {esc} from '../core/dom.js';
import {t} from '../core/i18n.js';
import {createOfficeMap, officeProjection, TILE} from './office-map.js';

/** Furniture is decorative; people, status and deliveries come only from project records. */
export function officeScene({state, people, employee, status, canMeet, isometric = false, custom}) {
  const meetingPeople = people.filter((e) => status(e.id)?.status === 'MEETING');
  const artifacts = state.entities
    .filter((e) => e.kind === 'artifact')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  const author = (id) => people.find((p) => p.id === id)?.data.name || t('pixel.owner');
  const base = createOfficeMap(isometric ? Math.max(6, people.length) : people.length);
  const map = custom ? customMap(base, custom) : base;
  const projection = officeProjection(map, isometric);
  const rect = (r) =>
    'left:' +
    r.x * TILE +
    'px;top:' +
    r.y * TILE +
    'px;width:' +
    r.w * TILE +
    'px;height:' +
    r.h * TILE +
    'px';
  return `<div class="office-map-viewport" tabindex="0" aria-label="${t('pixel.mapHint')}"><div class="pixel-floor ${isometric ? 'office-isometric' : ''}" style="width:${projection.width}px;height:${projection.height}px">${
    isometric
      ? isometricOffice(
          map,
          people,
          canMeet,
          !state.officeCompanion,
          custom && !layoutError(base, custom) ? custom : null,
        )
      : `<div class="office-plane" style="width:${map.width * TILE}px;height:${map.height * TILE}px;${isometric ? `transform:matrix(.866,.5,-.866,.5,${projection.offsetX},60)` : ''}">
    <div class="office-wall" aria-hidden="true"><div class="pixel-window"><i></i><i></i><i></i></div><div class="office-clock"></div></div>
    <div class="map-work-rug" style="height:${Math.ceil(people.length / 3) * 200}px" aria-hidden="true"></div><div class="map-rug map-meeting-rug" aria-hidden="true"></div><div class="map-rug map-lounge-rug" aria-hidden="true"></div>
    <span class="map-label map-work-label">${t('pixel.workspace')}</span><span class="map-label map-meeting-label">${t('pixel.meetingRoom')}</span><span class="map-label map-lounge-label">${t('pixel.lounge')}</span>
    ${map.walls.map((r) => `<div class="map-partition" style="${rect(r)}" aria-hidden="true"></div>`).join('')}
    ${map.desks.map((p, index) => `<div class="map-desk" style="${rect({x: p.x - 1, y: p.y - 2, w: 3, h: 2})}" ><div class="pixel-desk"><a class="office-computer" href="#office/files" aria-label="${esc(t('pixel.computer', {name: people[index].data.name}))}"><i></i></a><b class="desk-notebook"></b><b class="desk-lamp"></b></div><div class="map-desk-chair"></div></div>`).join('')}
    <div class="office-whiteboard" aria-hidden="true"><i></i><i></i><i></i></div>
    <button type="button" class="pixel-table" style="${rect(map.obstacles.find((r) => r.kind === 'table'))}" data-pixel-command="meeting" ${canMeet ? '' : 'disabled'}><span>${t('pixel.table')}</span><small>${t('pixel.tableHint')}</small></button>
    <div class="office-sofa" style="${rect(map.obstacles.find((r) => r.kind === 'sofa'))}" aria-hidden="true"></div><div class="office-coffee" style="${rect(map.obstacles.find((r) => r.kind === 'coffee'))}" aria-hidden="true"><i></i></div>
    <div class="office-plant map-plant-one" aria-hidden="true"></div><div class="office-plant map-plant-two" aria-hidden="true"></div><div class="map-pantry" style="${rect(map.obstacles.find((r) => r.kind === 'pantry'))}" aria-hidden="true"><i></i><b></b><span></span></div><div class="map-bookshelf" style="${rect(map.obstacles.find((r) => r.kind === 'shelf'))}" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
    <a class="map-chat" href="#office/rooms">${t('pixel.teamConversation')} ↗</a><a class="map-archive" href="#office/artifacts">${t('pixel.archive')} ↗</a><span class="map-entrance">${t('pixel.entrance')}</span>
    </div>`
  }${custom ? customScene(base, custom, isometric) : ''}<div class="pixel-desks" role="group" aria-label="${t('pixel.employees')}">${people
    .filter((e) => status(e.id)?.status !== 'MEETING')
    .map((e) => employee(e, people.indexOf(e)))
    .join(
      '',
    )}</div><div class="pixel-meeting-seats">${meetingPeople.map((e) => employee(e, people.indexOf(e))).join('')}</div>
    ${people.length ? '' : `<div class="pixel-empty">${t('pixel.empty')} <a href="#office/people">${t('nav.people')} →</a></div>`}
  </div></div><section class="office-deliveries"><header><h3>${t('pixel.deliveries')}</h3><a href="#office/artifacts">${t('pixel.allArtifacts')} ↗</a></header><div class="office-delivery-list">${artifacts.map((a) => `<button type="button" data-office="open-linked" data-id="${esc(a.id)}"><span class="office-document-icon" aria-hidden="true">▤</span><span><strong>${esc(a.data.title)}</strong><small>${esc(author(a.actor))} · ${esc(a.data.status)} · v${a.version}</small></span><span aria-hidden="true">↗</span></button>`).join('') || `<p>${t('pixel.noDeliveries')}</p>`}</div></section>`;
}
