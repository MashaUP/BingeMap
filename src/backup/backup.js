// Backup completo, ripristino, esportazioni CSV, pacchetto catalogo (punto 2).
import { getAll, atomic, getSetting, setSetting } from '../db/db.js';
import { VERSION } from '../common/version.js';
import { SCHEMA_VERSION } from '../db/db.js';
import { toCsv } from '../import/csv.js';
import { STATUS_LABEL } from '../library/status.js';
import { runMatching } from '../match/run.js';

export const PERSONAL = ['import_batches', 'library_raw', 'library_items', 'matches', 'match_rules', 'overlay', 'tags', 'tag_aliases', 'tag_rules', 'saved_queries', 'diary', 'settings'];
export const CATALOG = ['catalog_titles', 'catalog_snapshots', 'tmdb_cache'];
const SECRET_KEYS = ['tmdbKey', 'simklClientId', 'googleClientId'];

function stripSecrets(rows) {
  return rows.map((r) => {
    if (r.key !== 'app' || !r.value) return r;
    const v = { ...r.value };
    for (const k of SECRET_KEYS) if (v[k]) v[k] = '';
    return { ...r, value: v };
  });
}

export async function exportAll({ includeCatalog = true, includeSecrets = false } = {}) {
  const stores = {};
  for (const s of [...PERSONAL, ...(includeCatalog ? CATALOG : [])]) {
    let rows = await getAll(s);
    if (s === 'settings' && !includeSecrets) rows = stripSecrets(rows);
    stores[s] = rows;
  }
  await setSetting('lastBackupAt', Date.now());
  return { app: 'BingeMap', kind: 'bingemap-backup', version: VERSION, schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), includeCatalog, stores };
}

export function validateBackup(obj) {
  if (!obj || obj.app !== 'BingeMap' || !obj.stores) throw new Error('Il file non è un backup di BingeMap');
  if (obj.schema > SCHEMA_VERSION) throw new Error('Il backup viene da una versione più recente di BingeMap: aggiorna prima l\'estensione');
  const counts = {};
  for (const [s, rows] of Object.entries(obj.stores)) counts[s] = Array.isArray(rows) ? rows.length : 0;
  return { version: obj.version, exportedAt: obj.exportedAt, counts, includeCatalog: !!obj.includeCatalog };
}

// mode 'replace': sostituisce gli archivi presenti nel backup. mode 'merge': vince il record più recente.
export async function restore(obj, mode = 'replace') {
  validateBackup(obj);
  const names = Object.keys(obj.stores).filter((s) => [...PERSONAL, ...CATALOG].includes(s));
  // I segreti non presenti nel backup restano quelli locali.
  const localApp = await getSetting('app', {});
  await atomic(names, async (tx) => {
    for (const s of names) {
      const rows = obj.stores[s] || [];
      if (mode === 'replace') {
        const cur = await tx.getAll(s);
        const kp = keyPathOf(s);
        for (const r of cur) tx.del(s, r[kp]);
        for (const r of rows) tx.put(s, fixSecrets(s, r, localApp));
      } else {
        const cur = await tx.getAll(s);
        const kp = keyPathOf(s);
        const m = new Map(cur.map((r) => [r[kp], r]));
        for (const r of rows) {
          const old = m.get(r[kp]);
          if (!old || (r.updatedAt || 0) >= (old.updatedAt || 0)) tx.put(s, fixSecrets(s, r, localApp));
        }
      }
    }
  });
  await runMatching();
}

function fixSecrets(store, r, localApp) {
  if (store !== 'settings' || r.key !== 'app') return r;
  const v = { ...r.value };
  for (const k of SECRET_KEYS) if (!v[k] && localApp?.[k]) v[k] = localApp[k];
  return { ...r, value: v };
}

const KP = { catalog_titles: 'ck', catalog_snapshots: 'id', import_batches: 'id', library_raw: 'id', library_items: 'key', matches: 'key', match_rules: 'key', overlay: 'ck', tags: 'key', tag_aliases: 'key', tag_rules: 'id', saved_queries: 'id', tmdb_cache: 'tmdbId', diary: 'id', settings: 'key' };
const keyPathOf = (s) => KP[s];

export function downloadName(prefix, ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.${ext}`;
}

// --- Esportazioni CSV
export function resultsCsv(views) {
  const rows = views.map((v) => ({
    titolo: v.name, anno: v.year ?? '', generi: v.genreLabels.join(', '), voto: v.score ?? '', stagioni: v.seasons ?? '',
    stato: STATUS_LABEL[v.status], tag: [...Object.values(v.impTags).flat(), ...v.userTags].join(', '), ore: v.hours ?? '',
    catalogo: v.catalogs.join(', '), fornitori: v.providers.join(', '), link: v.url || '',
  }));
  return toCsv(rows, ['titolo', 'anno', 'generi', 'voto', 'stagioni', 'stato', 'tag', 'ore', 'catalogo', 'fornitori', 'link']);
}

// Idea 3: «Rimanda a Refract». Colonne descritte dalla guida di Refract (title, year, type, status, date, rating):
// confrontale con il modello scaricabile da Refract (Impostazioni › Import › Spreadsheet / CSV template).
export function refractCsv(views) {
  const rows = views.map((v) => ({ title: v.name, year: v.year ?? '', type: 'tv', status: v.status === 'completed' ? 'completed' : 'planned', date: '', rating: v.rating ?? '' }));
  return toCsv(rows, ['title', 'year', 'type', 'status', 'date', 'rating']);
}

export function missingCsv(missing) {
  const rows = missing.map((m) => ({ titolo: m.title, anno: m.year ?? '', fonti: m.sources.join(', '), stato: STATUS_LABEL[m.status], tag: m.tags.join(', '), imdb: m.ids.imdb || '', tmdb: m.ids.tmdb || '' }));
  return toCsv(rows, ['titolo', 'anno', 'fonti', 'stato', 'tag', 'imdb', 'tmdb']);
}

// --- Pacchetto catalogo (punto 2): solo dati del catalogo, nessun dato personale.
export async function exportCatalogPackage(source = 'sc') {
  const titles = (await getAll('catalog_titles', 'source', source)).filter((c) => c.status !== 'gone');
  const ids = new Set(titles.map((t) => t.tmdbId).filter(Boolean));
  const tmdb = (await getAll('tmdb_cache')).filter((t) => ids.has(t.tmdbId));
  const clean = titles.map(({ missCount, ...t }) => t);
  return { app: 'BingeMap', kind: 'bingemap-catalog', version: VERSION, source, createdAt: new Date().toISOString(), count: clean.length, titles: clean, tmdb };
}

export async function importCatalogPackage(pkg) {
  if (!pkg || pkg.kind !== 'bingemap-catalog' || !Array.isArray(pkg.titles)) throw new Error('Il file non è un pacchetto catalogo di BingeMap');
  const now = Date.now();
  let added = 0; let updated = 0;
  await atomic(['catalog_titles', 'tmdb_cache', 'catalog_snapshots'], async (tx) => {
    for (const t of pkg.titles) {
      if (!t.ck || !t.name) continue;
      const old = await tx.get('catalog_titles', t.ck);
      if (!old) { added++; tx.put('catalog_titles', { ...t, firstSeen: t.firstSeen || now, status: 'active', missCount: 0, fromPackage: true }); }
      else { updated++; tx.put('catalog_titles', { ...old, ...t, firstSeen: old.firstSeen || t.firstSeen || now, status: 'active', missCount: 0 }); }
    }
    for (const t of pkg.tmdb || []) {
      const old = await tx.get('tmdb_cache', t.tmdbId);
      if (!old || (t.updatedAt || 0) > (old.updatedAt || 0)) tx.put('tmdb_cache', t);
    }
    // Un pacchetto non segna mai titoli come spariti: equivale a una scansione parziale.
    tx.put('catalog_snapshots', { id: `pkg_${now}`, source: pkg.source, kind: 'package', date: now, complete: false, count: pkg.titles.length, added: [], removed: [], seasonChanges: [], note: `Pacchetto del ${pkg.createdAt}` });
  });
  await runMatching();
  return { added, updated };
}
