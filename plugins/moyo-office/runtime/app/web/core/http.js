/** Authentication is supplied by each caller; this module never retains credentials. */
export async function requestJson(path, options = {}) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw Error('NETWORK_ERROR');
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw Error('REQUEST_FAILED');
  }
  if (!response.ok) throw Error(result?.error || 'REQUEST_FAILED');
  return result;
}
