let token = '';
export const setToken = (t) => { token = t; };
const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o || {})) if (v !== '' && v != null) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
export async function api(method, path, body, query) {
  let res;
  try {
    res = await fetch(path + qs(query), {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Wallet-Token': token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Não foi possível falar com o servidor local do Wallet.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.locked) window.dispatchEvent(new Event('wallet-locked'));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}
export const get = (p, q) => api('GET', p, undefined, q);
export const post = (p, b) => api('POST', p, b ?? {});
export const put = (p, b) => api('PUT', p, b ?? {});
export const del = (p, q) => api('DELETE', p, undefined, q);
