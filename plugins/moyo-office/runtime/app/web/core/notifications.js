import {$} from './dom.js';
import {model} from './state.js';
import {settings} from './config.js';
function notify(message, {error = false, undo = null} = {}) {
  $('#notice-text').textContent = message;
  $('#notice').hidden = false;
  $('#notice').classList.toggle('error', error);
  model.undoAction = undo;
  $('#undo').hidden = !undo;
  clearTimeout(model.toastTimer);
  if (!error && !undo)
    model.toastTimer = setTimeout(() => ($('#notice').hidden = true), settings.client.toastDurationMs);
}
export {notify};
