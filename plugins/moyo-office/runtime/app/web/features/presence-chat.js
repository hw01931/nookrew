import {api} from '../core/api.js';
import {notify} from '../core/notifications.js';
import {t} from '../core/i18n.js';
export async function openPresenceChat(id) {
  try {
    const result = await api('/api/office/presence-chat', {id});
    notify(t(result.requested ? 'pixel.chatRequested' : 'pixel.chatUnknown'));
    return result;
  } catch (error) {
    notify(t('pixel.chatFailed'), {error: true});
    return {requested: false, error: error.message};
  }
}
