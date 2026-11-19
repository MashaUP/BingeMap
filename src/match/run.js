// Esegue il riconoscimento su tutta la libreria per ogni catalogo e salva i risultati.
import { getAll, atomic } from '../db/db.js';
import { matchAll } from './matcher.js';

export async function runMatching() {
  const [catalog, items, rules, old, tmdb] = await Promise.all([
    getAll('catalog_titles'), getAll('library_items'), getAll('match_rules'), getAll('matches'), getAll('tmdb_cache'),
  ]);
  const tmdbMap = new Map(tmdb.map((t) => [t.tmdbId, t]));
  const active = catalog.filter((c) => c.status !== 'gone').map((c) => ({ ...c, tmdb: c.tmdbId ? tmdbMap.get(c.tmdbId) : null }));
  const live = items.filter((i) => !i.gone);
  const oldMap = new Map(old.map((m) => [m.key, m]));
  const now = Date.now();
  const bySource = new Map();
  for (const c of active) { if (!bySource.has(c.source)) bySource.set(c.source, []); bySource.get(c.source).push(c); }
  const out = [];
  const counts = { auto: 0, manual: 0, queue: 0, none: 0, ignored: 0 };
  for (const [source, list] of bySource) {
    const rulesFor = new Map(rules.filter((r) => !r.catalog || r.catalog === source).map((r) => [r.itemKey, r]));
    const res = matchAll(live, list, rulesFor);
    for (const m of res) {
      const rule = rulesFor.get(m.key);
      const k = `${source}|${m.key}`;
      const prev = oldMap.get(k);
      const rec = { ...m, key: k, itemKey: m.key, catalog: source, updatedAt: now };
      if (rule?.ignore) rec.state = 'ignored';
      if (prev) {
        rec.firstMatchedAt = prev.firstMatchedAt || null;
        rec.wasMissing = prev.wasMissing || prev.state === 'none';
        rec.nowAvailableAt = prev.nowAvailableAt || null;
      }
      if (rec.state === 'none') rec.wasMissing = true;
      if ((rec.state === 'auto' || rec.state === 'manual') && !rec.firstMatchedAt) {
        rec.firstMatchedAt = now;
        if (prev && prev.state === 'none') rec.nowAvailableAt = now;
      }
      counts[rec.state] = (counts[rec.state] || 0) + 1;
      out.push(rec);
    }
  }
  await atomic(['matches'], async (tx) => {
    const keep = new Set(out.map((m) => m.key));
    for (const m of old) if (!keep.has(m.key)) tx.del('matches', m.key);
    for (const m of out) tx.put('matches', m);
  });
  return counts;
}

// Correzione manuale (F42): «È questa» / «Non è questa» / «Ignora».
export async function setRule(itemKey, catalog, patch) {
  const key = `${catalog}|${itemKey}`;
  await atomic(['match_rules'], async (tx) => {
    const cur = (await tx.get('match_rules', key)) || { key, itemKey, catalog, reject: [] };
    if (patch.accept !== undefined) cur.accept = patch.accept;
    if (patch.reject) cur.reject = [...new Set([...(cur.reject || []), ...patch.reject])];
    if (patch.ignore !== undefined) cur.ignore = patch.ignore;
    if (patch.reset) { delete cur.accept; cur.reject = []; delete cur.ignore; }
    cur.updatedAt = Date.now();
    tx.put('match_rules', cur);
  });
}
