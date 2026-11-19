// Sincronizzazione tramite Google Drive dell'utente (punto 1): cartella nascosta appDataFolder,
// permesso drive.appdata (non sensibile). Nessun server BingeMap: i dati restano nel Drive dell'utente.
import { authFlow, redirectUrl, sessionKv, kv } from '../platform/platform.js';
import { getAll, atomic, getSetting, setSetting } from '../db/db.js';
import { loadSettings } from '../common/settings.js';
import { exportAll, PERSONAL, CATALOG } from '../backup/backup.js';
import { runMatching } from '../match/run.js';
import { log } from '../common/diag.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE = 'bingemap-sync.json';
const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3';

export async function getToken(interactive = true, clientId = null) {
  const cached = await sessionKv.get('gtoken');
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  if (!interactive) return null;
  const s = await loadSettings();
  const cid = clientId || s.googleClientId;
  if (!cid) throw new Error('Manca il Client ID Google: vedi Impostazioni › Sincronizzazione');
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', cid);
  u.searchParams.set('response_type', 'token');
  u.searchParams.set('redirect_uri', redirectUrl('google'));
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('prompt', 'select_account');
  const back = await authFlow(u.href);
  const hash = new URLSearchParams(String(back).split('#')[1] || '');
  const token = hash.get('access_token');
  if (!token) throw new Error(hash.get('error') ? `Accesso Google non riuscito: ${hash.get('error')}` : 'Accesso Google annullato');
  const exp = Date.now() + (Number(hash.get('expires_in')) || 3500) * 1000;
  await sessionKv.set('gtoken', { token, exp });
  await kv.set('googleConnected', true);
  return token;
}

export async function signOut() {
  const c = await sessionKv.get('gtoken');
  await sessionKv.set('gtoken', null);
  await kv.set('googleConnected', false);
  if (c?.token) { try { await fetch(`https://oauth2.googleapis.com/revoke?token=${c.token}`, { method: 'POST' }); } catch { /* offline */ } }
}

async function gfetch(token, url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${token}` } });
  if (r.status === 401) { await sessionKv.set('gtoken', null); throw new Error('Sessione Google scaduta: accedi di nuovo'); }
  if (!r.ok) throw new Error(`Google Drive HTTP ${r.status}`);
  return r;
}

export async function findFile(token) {
  const q = encodeURIComponent(`name='${FILE}'`);
  const r = await gfetch(token, `${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime,size)`);
  const d = await r.json();
  return d.files?.[0] || null;
}

export async function download(token, id) {
  const r = await gfetch(token, `${API}/files/${id}?alt=media`);
  return r.json();
}

export async function upload(token, obj, id = null) {
  const body = JSON.stringify(obj);
  if (id) {
    await gfetch(token, `${UP}/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body });
    return id;
  }
  const boundary = 'bm' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: FILE, parents: ['appDataFolder'], mimeType: 'application/json' });
  const multipart = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const r = await gfetch(token, `${UP}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body: multipart });
  return (await r.json()).id;
}

const KP = { catalog_titles: 'ck', catalog_snapshots: 'id', import_batches: 'id', library_raw: 'id', library_items: 'key', matches: 'key', match_rules: 'key', overlay: 'ck', tags: 'key', tag_aliases: 'key', tag_rules: 'id', saved_queries: 'id', tmdb_cache: 'tmdbId', diary: 'id', settings: 'key' };

// Unione: per ogni record vince quello con updatedAt più recente. Le cancellazioni viaggiano come «tombstones».
export function mergeStores(local, remote, tombLocal = [], tombRemote = []) {
  const tomb = new Map();
  for (const t of [...tombLocal, ...tombRemote]) { const k = `${t.store}|${t.key}`; if (!tomb.has(k) || tomb.get(k) < t.at) tomb.set(k, t.at); }
  const out = {}; let changedLocal = 0;
  for (const s of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const kp = KP[s];
    if (!kp) continue;
    const m = new Map();
    for (const r of local[s] || []) m.set(r[kp], { r, from: 'local' });
    for (const r of remote[s] || []) {
      const cur = m.get(r[kp]);
      if (!cur || (r.updatedAt || 0) > (cur.r.updatedAt || 0)) { m.set(r[kp], { r, from: 'remote' }); }
    }
    const rows = [];
    for (const [k, { r, from }] of m) {
      const ta = tomb.get(`${s}|${k}`);
      if (ta && ta >= (r.updatedAt || 0)) continue;
      if (from === 'remote') changedLocal++;
      rows.push(r);
    }
    out[s] = rows;
  }
  return { stores: out, changedLocal, tombstones: [...tomb.entries()].map(([k, at]) => { const [store, ...key] = k.split('|'); return { store, key: key.join('|'), at }; }) };
}

export async function recordTombstone(store, key) {
  const list = (await getSetting('tombstones', [])).filter((t) => !(t.store === store && t.key === key));
  list.push({ store, key, at: Date.now() });
  await setSetting('tombstones', list.slice(-500));
}

export async function syncNow({ interactive = false } = {}) {
  const s = await loadSettings();
  const token = await getToken(interactive);
  if (!token) return { skipped: true, reason: 'Non connesso a Google' };
  const file = await findFile(token);
  const localExport = await exportAll({ includeCatalog: s.syncIncludeCatalog, includeSecrets: false });
  const tombLocal = await getSetting('tombstones', []);
  let merged = localExport.stores; let changedLocal = 0; let tombstones = tombLocal;
  if (file) {
    const remote = await download(token, file.id);
    if (remote?.app === 'BingeMap' && remote.stores) {
      const res = mergeStores(localExport.stores, remote.stores, tombLocal, remote.tombstones || []);
      merged = res.stores; changedLocal = res.changedLocal; tombstones = res.tombstones;
      if (changedLocal || res.tombstones.length) await applyMerged(merged, res.tombstones);
    }
  }
  const payload = { ...localExport, stores: merged, tombstones, syncedAt: new Date().toISOString() };
  await upload(token, payload, file?.id || null);
  await setSetting('tombstones', tombstones);
  await setSetting('lastSyncAt', Date.now());
  await log('info', 'sync', 'ok', `ricevuti=${changedLocal}`);
  return { ok: true, received: changedLocal, at: Date.now() };
}

async function applyMerged(stores, tombstones = []) {
  const names = Object.keys(stores).filter((n) => [...PERSONAL, ...CATALOG].includes(n));
  const localApp = await getSetting('app', {});
  await atomic(names, async (tx) => {
    for (const n of names) {
      for (const r of stores[n]) {
        if (n === 'settings' && r.key === 'app') {
          const v = { ...r.value };
          for (const k of ['tmdbKey', 'simklClientId', 'googleClientId']) if (!v[k] && localApp?.[k]) v[k] = localApp[k];
          tx.put(n, { ...r, value: v });
        } else if (n === 'settings' && r.key === 'tombstones') {
          // gestite a parte
        } else tx.put(n, r);
      }
    }
    // Si cancella solo ciò che ha una tombstone: un record assente nel remoto ma presente in locale resta.
    for (const t of tombstones) {
      if (!names.includes(t.store)) continue;
      const alive = stores[t.store].some((r) => String(r[KP[t.store]]) === String(t.key));
      if (!alive) tx.del(t.store, t.key);
    }
  });
  await runMatching();
}

// Lettura del file di sincronizzazione (app web in sola lettura).
export async function readSyncFile(interactive = true) {
  const token = await getToken(interactive);
  if (!token) return null;
  const file = await findFile(token);
  if (!file) return null;
  return download(token, file.id);
}
