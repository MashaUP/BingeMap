// Accesso ai dati per interfaccia e service worker: carica tutto, costruisce le viste, scrive lo strato personale.
import { getAll, get, put, del, atomic } from '../db/db.js';
import { loadSettings } from '../common/settings.js';
import { buildViews } from './view.js';
import { runQuery } from '../query/engine.js';
import { uid } from '../common/util.js';
import { recordTombstone } from '../sync/drive.js';

export async function loadAll() {
  const [catalog, items, matches, overlay, aliases, tagRules, tmdbCache, batches, settings] = await Promise.all([
    getAll('catalog_titles'), getAll('library_items'), getAll('matches'), getAll('overlay'), getAll('tag_aliases'),
    getAll('tag_rules'), getAll('tmdb_cache'), getAll('import_batches'), loadSettings(),
  ]);
  return { data: { catalog, items, matches, overlay, aliases, tagRules, tmdbCache, batches }, settings };
}

export async function computeViews(settingsOverride = null) {
  const { data, settings } = await loadAll();
  const s = settingsOverride ? { ...settings, ...settingsOverride } : settings;
  return { ...buildViews(data, s), settings: s, data };
}

// --- Strato personale (F46, F47, idee 9, 10, 11, 27)
export async function setOverlay(ck, patch, event = null) {
  let out;
  await atomic(['overlay', 'diary'], async (tx) => {
    const cur = (await tx.get('overlay', ck)) || { ck, tags: [] };
    const prevStatus = cur.status;
    out = { ...cur, ...patch, ck, updatedAt: Date.now() };
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    tx.put('overlay', out);
    // Diario delle scoperte (idea 22): inizio e fine di una serie.
    if (patch.status && patch.status !== prevStatus && (patch.status === 'watching' || patch.status === 'completed')) {
      tx.put('diary', { id: uid('d_'), ck, date: Date.now(), event: patch.status === 'watching' ? 'started' : 'completed', fromQuery: event?.fromQuery || null, updatedAt: Date.now() });
    }
  });
  return out;
}

export async function getOverlay(ck) { return get('overlay', ck); }

export async function toggleUserTag(ck, tag, on) {
  const cur = (await get('overlay', ck)) || { ck, tags: [] };
  const tags = new Set(cur.tags || []);
  if (on) tags.add(tag); else tags.delete(tag);
  await setOverlay(ck, { tags: [...tags] });
  if (on) await put('tags', { key: `user:${tag}`, ns: 'user', name: tag, updatedAt: Date.now() });
}

export async function notInterested(ck, reason = '') { return setOverlay(ck, { notInterested: { reason, at: Date.now() } }); }
export async function snooze(ck, days = 30) { return setOverlay(ck, { snoozeUntil: Date.now() + days * 86400000 }); }
export async function bumpSkip(ck) { const cur = await get('overlay', ck); return setOverlay(ck, { skipCount: (cur?.skipCount || 0) + 1 }); }

// Le prossime 5 (idea 27)
export async function nextUpList() {
  return (await getAll('overlay')).filter((o) => o.nextUp != null).sort((a, b) => a.nextUp - b.nextUp);
}
export async function setNextUp(ck, on) {
  const list = (await nextUpList()).filter((o) => o.ck !== ck);
  if (on) {
    if (list.length >= 5) throw new Error('Le prossime 5 sono già piene: togline una');
    list.push({ ck });
  }
  await atomic(['overlay'], async (tx) => {
    for (let i = 0; i < list.length; i++) {
      const cur = (await tx.get('overlay', list[i].ck)) || { ck: list[i].ck, tags: [] };
      tx.put('overlay', { ...cur, nextUp: i, updatedAt: Date.now() });
    }
    if (!on) { const cur = await tx.get('overlay', ck); if (cur) { delete cur.nextUp; cur.updatedAt = Date.now(); tx.put('overlay', cur); } }
  });
}
export async function reorderNextUp(cks) {
  await atomic(['overlay'], async (tx) => {
    for (let i = 0; i < cks.length; i++) {
      const cur = (await tx.get('overlay', cks[i])) || { ck: cks[i], tags: [] };
      tx.put('overlay', { ...cur, nextUp: i, updatedAt: Date.now() });
    }
  });
}

// --- Ricerche salvate (F69, F70)
export async function listQueries() { return (await getAll('saved_queries')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt); }
export async function saveQuery(q) {
  const rec = { id: q.id || uid('q_'), name: q.name || 'Ricerca senza nome', icon: q.icon || 'bookmark', color: q.color || '#6D4AFF', query: q.query, sort: q.sort || 'reco', pinned: !!q.pinned, follow: q.follow !== false, seenIds: q.seenIds || null, createdAt: q.createdAt || Date.now(), updatedAt: Date.now(), order: q.order ?? 0 };
  await put('saved_queries', rec);
  return rec;
}
export async function deleteQuery(id) { await del('saved_queries', id); await recordTombstone('saved_queries', id); }
export async function markQuerySeen(id, ids) { const q = await get('saved_queries', id); if (q) await put('saved_queries', { ...q, seenIds: ids, seenAt: Date.now(), updatedAt: Date.now() }); }

// Novità per le collezioni seguite: titoli nei risultati non presenti l'ultima volta.
export function followUpdates(queries, views) {
  const out = [];
  for (const q of queries) {
    if (!q.follow) continue;
    const { results } = runQuery(views, q.query);
    const ids = results.map((v) => v.ck);
    if (!q.seenIds) { out.push({ q, newIds: [], ids, init: true }); continue; }
    const seen = new Set(q.seenIds);
    out.push({ q, newIds: ids.filter((id) => !seen.has(id)), ids });
  }
  return out;
}

// --- Tag: alias, unioni, regole
export async function setAlias(source, name, canonical) {
  const key = `imp:${source}:${name.toLowerCase()}`;
  if (!canonical) { await del('tag_aliases', key); await recordTombstone('tag_aliases', key); return; }
  await put('tag_aliases', { key, source, from: name, name: canonical, updatedAt: Date.now() });
}
export async function addTagRule(rule) { const r = { id: uid('r_'), ...rule, updatedAt: Date.now() }; await put('tag_rules', r); return r; }
export async function deleteTagRule(id) { await del('tag_rules', id); await recordTombstone('tag_rules', id); }
