// Pipeline di import: anteprima con diff, salvataggio in un'unica transazione, annullamento.
// Le righe grezze restano immutabili in library_raw; le righe normalizzate in library_items.
import { getAll, atomic, get } from '../db/db.js';
import { uid } from '../common/util.js';
import { runMatching } from '../match/run.js';
import { log } from '../common/diag.js';

const itemKey = (source, rowKey) => `${source}:${rowKey}`;

const COMPARE = ['title', 'year', 'status', 'rating', 'tags', 'lists', 'seasonsWatched', 'episodesWatched'];
function changed(a, b) {
  return COMPARE.filter((f) => JSON.stringify(a[f] ?? null) !== JSON.stringify(b[f] ?? null));
}

// Anteprima: confronta con le righe della stessa fonte e dello stesso "ambito" (es. imdb:watchlist).
export async function previewImport(source, scope, rows) {
  const existing = (await getAll('library_items', 'source', source)).filter((i) => !i.gone);
  const byKey = new Map(existing.map((i) => [i.key, i]));
  const added = []; const updated = []; const same = [];
  const seen = new Set();
  for (const r of rows) {
    const k = itemKey(source, r.rowKey);
    seen.add(k);
    const prev = byKey.get(k);
    if (!prev) added.push(r);
    else {
      const diff = changed(prev, r);
      if (diff.length) updated.push({ row: r, prev, fields: diff }); else same.push(r);
    }
  }
  const removed = existing.filter((i) => (i.scopes || []).includes(scope) && !seen.has(i.key));
  return { source, scope, total: rows.length, added, updated, same, removed };
}

export async function commitImport({ source, scope, fileName, rows, mapping = null, applyRemovals = true, notes = [] }) {
  const batchId = uid('b_');
  const now = Date.now();
  const preview = await previewImport(source, scope, rows);
  await atomic(['import_batches', 'library_raw', 'library_items'], async (tx) => {
    const prev = {};
    for (const r of rows) {
      const k = itemKey(source, r.rowKey);
      const old = await tx.get('library_items', k);
      prev[k] = old || null;
      const item = {
        key: k, source, rowKey: r.rowKey, batchId, firstBatchId: old?.firstBatchId || batchId,
        title: r.title, originalTitle: r.originalTitle, altTitles: r.altTitles || [], year: r.year, ids: r.ids, mediaType: r.mediaType,
        status: r.status, rawStatus: r.rawStatus, rating: r.rating, tags: r.tags, lists: r.lists,
        seasonsWatched: r.seasonsWatched, episodesWatched: r.episodesWatched, lastActivity: r.lastActivity,
        scopes: [...new Set([...(old?.scopes || []), scope])],
        createdAt: old?.createdAt || now, updatedAt: now, gone: false,
      };
      tx.put('library_items', item);
      tx.put('library_raw', { id: `${batchId}:${r.rowKey}`, batchId, source, rowKey: r.rowKey, raw: r.raw ?? null, at: now });
    }
    if (applyRemovals) {
      for (const old of preview.removed) {
        prev[old.key] = old;
        tx.put('library_items', { ...old, gone: true, goneBatch: batchId, updatedAt: now });
      }
    }
    tx.put('import_batches', {
      id: batchId, source, scope, fileName: fileName || null, date: now, mapping, status: 'active', notes,
      counts: { rows: rows.length, added: preview.added.length, updated: preview.updated.length, same: preview.same.length, removed: applyRemovals ? preview.removed.length : 0 },
      prev,
    });
  });
  const match = await runMatching();
  await log('info', 'import', 'commit', `${source} righe=${rows.length}`);
  const batch = await get('import_batches', batchId);
  return { batchId, counts: batch.counts, match };
}

// Annulla un intero import (F34): ripristina lo stato precedente di ogni riga toccata.
export async function undoImport(batchId) {
  await atomic(['import_batches', 'library_items', 'library_raw'], async (tx) => {
    const b = await tx.get('import_batches', batchId);
    if (!b || b.status === 'undone') throw new Error('Import già annullato o inesistente');
    for (const [k, old] of Object.entries(b.prev || {})) {
      if (old) tx.put('library_items', old); else tx.del('library_items', k);
    }
    const raws = await tx.getAll('library_raw', 'batchId', batchId);
    for (const r of raws) tx.del('library_raw', r.id);
    b.status = 'undone'; b.undoneAt = Date.now();
    tx.put('import_batches', b);
  });
  await runMatching();
  await log('info', 'import', 'undo', batchId);
}

export async function lastImportFor(source) {
  const all = (await getAll('import_batches', 'source', source)).filter((b) => b.status === 'active');
  return all.sort((a, b) => b.date - a.date)[0] || null;
}
