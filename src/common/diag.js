// Centro diagnostica: registro degli errori tecnici SENZA dati personali.
// Mai titoli, tag, token, chiavi, URL completi con parametri o ID utente.
import { put, getAll, clear } from '../db/db.js';
import { VERSION } from './version.js';

const MAX = 300;
let counter = 0;

function scrub(v) {
  if (v == null) return v;
  let s = String(v);
  s = s.replace(/([?&](api_key|access_token|token|code|client_secret|key)=)[^&\s]+/gi, '$1***');
  s = s.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***');
  s = s.replace(/eyJ[A-Za-z0-9._-]{20,}/g, '***');
  return s.slice(0, 400);
}

export function originOnly(url) {
  try { const u = new URL(url); return u.origin + u.pathname.replace(/\/\d+[-\w]*/g, '/:id'); } catch { return '—'; }
}

export async function log(level, area, code, detail = '') {
  const entry = { id: `${Date.now().toString(36)}-${(counter++).toString(36)}`, t: Date.now(), level, area, code, detail: scrub(detail), v: VERSION };
  try {
    await put('diag', entry);
    if (counter % 25 === 0) await trim();
  } catch { /* il registro non deve mai rompere l'app */ }
  if (level === 'error' && globalThis.console) console.warn('[BingeMap]', area, code, entry.detail);
  return entry;
}

async function trim() {
  const all = await getAll('diag');
  if (all.length <= MAX) return;
  all.sort((a, b) => b.t - a.t);
  const keep = all.slice(0, MAX);
  await clear('diag');
  const { putMany } = await import('../db/db.js');
  await putMany('diag', keep);
}

export async function report() {
  const entries = (await getAll('diag')).sort((a, b) => b.t - a.t);
  return {
    app: 'BingeMap', version: VERSION, generatedAt: new Date().toISOString(),
    userAgent: globalThis.navigator ? scrub(globalThis.navigator.userAgent) : 'node',
    entries,
  };
}
