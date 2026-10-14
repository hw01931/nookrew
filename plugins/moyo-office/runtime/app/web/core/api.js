import {model} from './state.js';
import {settings} from './config.js';
import {requestJson} from './http.js';
import {language} from './i18n.js';
export function api(path, payload) {
  return requestJson(path, {
    ...(payload
      ? {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': model.state?.token || '',
            'X-AIO-Language': language(),
          },
          body: JSON.stringify({key: crypto.randomUUID(), version: 0, ...payload}),
        }
      : // The server seeds new projects and words what it writes in this language (ADR 0062).
        {headers: {'X-AIO-Language': language()}}),
    signal: AbortSignal.timeout(settings.client.requestTimeoutMs),
  });
}
