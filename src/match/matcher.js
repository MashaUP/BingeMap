// Riconoscimento delle righe importate nel catalogo.
// Ordine: regole manuali > ID (TMDB, IMDb, TVDB) > titolo normalizzato + anno > titolo simile.
// Soglie: >= 85 automatico, 60–84 coda «Da confermare», < 60 non riconosciuto (Mancanti).
import { normTitle, trigrams, dice } from './normalize.js';

export const AUTO = 85;
export const QUEUE = 60;

export const METHOD_LABEL = {
  manual: 'Scelta manuale',
  tmdb: 'ID TMDB',
  imdb: 'ID IMDb',
  tvdb: 'ID TVDB (tramite TMDB)',
  title_year: 'Titolo esatto + anno',
  alt_year: 'Titolo alternativo o originale + anno',
  fuzzy_year: 'Titolo simile + anno',
  title_only: 'Titolo esatto senza anno',
  title_many: 'Titolo esatto, più candidati',
  none: 'Nessun candidato',
};

export function buildIndex(catalog) {
  const byTmdb = new Map(); const byImdb = new Map(); const byTvdb = new Map();
  const byNorm = new Map(); const byAlt = new Map();
  const tri = new Map(); const norms = [];
  const push = (m, k, v) => { if (k == null || k === '') return; if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  catalog.forEach((c, i) => {
    if (c.type && c.type !== 'tv') return;
    push(byTmdb, c.tmdbId, c);
    push(byImdb, c.imdbId, c);
    push(byTvdb, c.tmdb?.tvdbId, c);
    const n = normTitle(c.name);
    push(byNorm, n, c);
    const alts = new Set([c.originalName, ...(c.altTitles || []), ...(c.tmdb?.altTitles || []), c.tmdb?.originalName].filter(Boolean).map(normTitle));
    alts.delete(n);
    for (const a of alts) push(byAlt, a, c);
    norms[i] = { c, n, t: trigrams(n) };
    for (const g of norms[i].t) push(tri, g, i);
  });
  return { byTmdb, byImdb, byTvdb, byNorm, byAlt, tri, norms };
}

const yearOk = (a, b) => a != null && b != null && Math.abs(a - b) <= 1;

function scoreTitleCandidates(item, list, isAlt, rejected) {
  const out = [];
  for (const c of list) {
    if (rejected.has(c.ck)) continue;
    if (item.year != null && c.year != null) {
      if (yearOk(item.year, c.year)) out.push({ ck: c.ck, score: isAlt ? 85 : 90, method: isAlt ? 'alt_year' : 'title_year' });
      else out.push({ ck: c.ck, score: 50, method: 'title_many' });
    } else {
      out.push({ ck: c.ck, score: 70, method: 'title_only' });
    }
  }
  return out;
}

export function matchItem(item, index, rule = null) {
  const rejected = new Set(rule?.reject || []);
  const key = item.key;
  if (rule?.accept) return { key, ck: rule.accept, method: 'manual', confidence: 100, state: 'manual', candidates: [] };
  if (item.mediaType === 'movie') return { key, ck: null, method: 'none', confidence: 0, state: 'none', candidates: [], skipped: 'movie' };

  const ids = item.ids || {};
  for (const [field, map, conf] of [['tmdb', index.byTmdb, 100], ['imdb', index.byImdb, 98], ['tvdb', index.byTvdb, 98]]) {
    const hits = (ids[field] != null ? map.get(ids[field]) : null)?.filter((c) => !rejected.has(c.ck));
    if (hits && hits.length) return { key, ck: hits[0].ck, method: field, confidence: conf, state: 'auto', candidates: [] };
  }

  const titles = [item.title, item.originalTitle, ...(item.altTitles || [])].filter(Boolean).map(normTitle).filter(Boolean);
  let cands = [];
  for (const n of new Set(titles)) {
    cands.push(...scoreTitleCandidates(item, index.byNorm.get(n) || [], false, rejected));
    cands.push(...scoreTitleCandidates(item, index.byAlt.get(n) || [], true, rejected));
  }
  // Fuzzy solo se non c'è un candidato esatto con anno.
  if (!cands.some((c) => c.score >= 85) && titles[0]) {
    const t = trigrams(titles[0]);
    const counts = new Map();
    for (const g of t) for (const i of index.tri.get(g) || []) counts.set(i, (counts.get(i) || 0) + 1);
    for (const [i, shared] of counts) {
      if (shared < t.size * 0.6) continue;
      const nn = index.norms[i];
      if (rejected.has(nn.c.ck)) continue;
      const sim = dice(t, nn.t);
      if (sim >= 0.86 && sim < 1) {
        const sc = yearOk(item.year, nn.c.year) ? 75 : (item.year == null ? 62 : 45);
        cands.push({ ck: nn.c.ck, score: sc, method: 'fuzzy_year', sim });
      }
    }
  }
  // Un candidato compare una volta, con il punteggio migliore.
  const best = new Map();
  for (const c of cands) if (!best.has(c.ck) || best.get(c.ck).score < c.score) best.set(c.ck, c);
  cands = [...best.values()].sort((a, b) => b.score - a.score);

  // Titolo esatto senza anno con più candidati: sempre da confermare.
  const noYear = cands.filter((c) => c.method === 'title_only');
  if (noYear.length > 1) for (const c of noYear) { c.score = 65; c.method = 'title_many'; }
  // Pari merito tra i primi due sopra soglia automatica: da confermare.
  if (cands.length > 1 && cands[0].score >= AUTO && cands[1].score === cands[0].score) cands[0] = { ...cands[0], score: AUTO - 1, method: 'title_many' };

  const top = cands[0];
  if (!top || top.score < QUEUE) return { key, ck: null, method: top ? top.method : 'none', confidence: top ? top.score : 0, state: 'none', candidates: cands.slice(0, 3) };
  return { key, ck: top.ck, method: top.method, confidence: top.score, state: top.score >= AUTO ? 'auto' : 'queue', candidates: cands.slice(0, 3) };
}

export function matchAll(items, catalog, rules = new Map()) {
  const index = buildIndex(catalog);
  return items.map((it) => matchItem(it, index, rules.get(it.key)));
}
