// Link del progetto (Discord, Ko-fi, guida, segnalazioni…) centralizzati in links.json nella radice del repository,
// nel formato comune dei progetti (schemaVersion 1). Per cambiare un link: modifica links.json su GitHub e aumenta
// "revision". L'app lo rilegge al massimo ogni 12 ore e a ogni «Cerca aggiornamento»; nessuna versione nuova.
//
// Il file remoto è un dato non attendibile: solo indirizzi, etichette e interruttori. Ogni voce si valida da sola
// (https, host consentiti, host proprio per github/discord/kofi): una voce non valida resta al valore di serie.
import { kv } from '../platform/platform.js';
import { RAW_BASE } from './version.js';

export const SCHEMA = 1;
export const PROJECT = 'bingemap';
export const ALLOWED_HOSTS = ['github.com', 'discord.gg', 'discord.com', 'ko-fi.com', 'mashaup.github.io'];
const OWN_HOSTS = { github: ['github.com'], discord: ['discord.gg', 'discord.com'], kofi: ['ko-fi.com'] };
const TTL = 12 * 3600 * 1000;
const MIN_FORCED = 60 * 1000;

// Valori di serie: devono coincidere con links.json (lo controlla scripts/check.mjs).
export const DEFAULT_LINKS = {
  github: { url: 'https://github.com/MashaUP/BingeMap', label: 'GitHub' },
  discord: { url: 'https://discord.gg/EPsbQCuAkx', label: 'Discord' },
  kofi: { url: 'https://ko-fi.com/mashaup', label: 'Ko-fi' },
  documentation: { url: 'https://github.com/MashaUP/BingeMap#readme', label: 'Guida' },
  changelog: { url: 'https://github.com/MashaUP/BingeMap/blob/main/CHANGELOG.md', label: 'Novità' },
  bugs: { url: 'https://github.com/MashaUP/BingeMap/issues/new?template=bug.yml', label: 'Segnala un problema' },
  ideas: { url: 'https://github.com/MashaUP/BingeMap/issues/new?template=idea.yml', label: "Proponi un'idea" },
};

// Indirizzo apribile per la voce `key`, oppure null.
export function safeUrl(value, key) {
  // eslint-disable-next-line no-control-regex -- i caratteri di controllo vanno proprio scartati
  if (typeof value !== 'string' || value.length > 500 || /[\u0000-\u001f\u007f\s]/.test(value)) return null;
  let u;
  try { u = new URL(value); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.includes(host)) return null;
  const own = Object.prototype.hasOwnProperty.call(OWN_HOSTS, key) ? OWN_HOSTS[key] : null;
  if (own && !own.includes(host)) return null;
  return u.href;
}

// eslint-disable-next-line no-control-regex -- i caratteri di controllo vanno proprio tolti
const shortText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');

// links.json → { revision, links }. Voci non valide: restano quelle di serie; enabled:false nasconde il link.
export function parseLinks(json, base = DEFAULT_LINKS) {
  const links = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, { ...v }]));
  if (!json || typeof json !== 'object' || json.schemaVersion !== SCHEMA || (json.project && json.project !== PROJECT)) return { revision: 0, links, valid: false };
  const entries = json.links && typeof json.links === 'object' ? Object.entries(json.links).slice(0, 30) : [];
  for (const [key, v] of entries) {
    if (!/^[a-z]{2,32}$/.test(key) || !v || typeof v !== 'object') continue;
    if (v.enabled === false) { delete links[key]; continue; }
    const url = safeUrl(v.url, key);
    if (!url) continue;
    links[key] = { url, label: shortText(v.label, 40) || links[key]?.label || key };
    const d = shortText(v.description, 120); if (d) links[key].description = d;
  }
  return { revision: Number.isInteger(json.revision) && json.revision >= 0 ? json.revision : 0, links, valid: true };
}

export async function getLinks() {
  const cached = await kv.get('linksV1');
  return cached?.links && typeof cached.links === 'object' ? cached.links : DEFAULT_LINKS;
}

// Rilegge links.json dal repository. Errore di rete o file non valido: resta l'ultima configurazione valida.
export async function refreshLinks(force = false, fetchFn = globalThis.fetch) {
  const last = (await kv.get('linksCheckedAt')) || 0;
  const age = Date.now() - last;
  if ((!force && age < TTL) || (force && age < MIN_FORCED)) return getLinks();
  try {
    const r = await fetchFn(`${RAW_BASE}/links.json`, { cache: 'no-store', credentials: 'omit' });
    if (r.ok) {
      const parsed = parseLinks(await r.json());
      const cached = await kv.get('linksV1');
      if (parsed.valid && parsed.revision >= (cached?.revision || 0)) await kv.set('linksV1', { revision: parsed.revision, links: parsed.links });
    }
  } catch { /* offline: restano i link salvati */ }
  await kv.set('linksCheckedAt', Date.now());
  return getLinks();
}
