// Link Ko-fi e Discord centralizzati in links.json sul repository.
// Per cambiare l'invito Discord: modifica links.json su GitHub e aumenta "revision".
// L'app lo rilegge entro 12 ore o subito con «Cerca aggiornamento».
import { kv } from '../platform/platform.js';
import { RAW_BASE } from './version.js';

export const DEFAULT_LINKS = { revision: 1, kofi: 'https://ko-fi.com/mashaup', discord: 'https://discord.gg/EPsbQCuAkx' };
const TTL = 12 * 3600 * 1000;

function valid(l) {
  const ok = (u) => typeof u === 'string' && /^https:\/\//.test(u);
  return l && Number.isFinite(l.revision) && ok(l.kofi) && ok(l.discord);
}

export async function getLinks() {
  const cached = await kv.get('links');
  return valid(cached) ? cached : DEFAULT_LINKS;
}

export async function refreshLinks(force = false, fetchFn = globalThis.fetch) {
  const last = (await kv.get('linksCheckedAt')) || 0;
  if (!force && Date.now() - last < TTL) return getLinks();
  try {
    const r = await fetchFn(`${RAW_BASE}/links.json?t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) {
      const remote = await r.json();
      const current = await getLinks();
      if (valid(remote) && remote.revision >= current.revision) await kv.set('links', remote);
    }
  } catch { /* offline: restano i link salvati */ }
  await kv.set('linksCheckedAt', Date.now());
  return getLinks();
}
