let dispatch;

// These calls never leave this process or use a caller-controlled host.
export function configureInternalApi(handler) {
  dispatch = handler;
}

export async function internalFetch(path, options = {}) {
  if (!dispatch) throw new Error('Internal API is not initialized');
  if (!path.startsWith('/api/') || path.includes('\\') || path.includes('#')) {
    throw new Error('Invalid internal API path');
  }
  return dispatch(path, options);
}

export const internalApi = {
  async get(path) {
    const response = await internalFetch(path);
    if (!response.ok) throw new Error(`Internal API rejected request (${response.status})`);
    return { data: await response.json() };
  },
  async post(path, body) {
    const response = await internalFetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Internal API rejected request (${response.status})`);
    return { data: await response.json() };
  }
};
