// Universi e spin-off (funzione 5): serie collegate e ordine di visione consigliato.
// Due serie sono collegate se:
//  - condividono il «prefisso di franchise» del titolo (Star Trek: Discovery / Star Trek: Picard, oppure Dark / Dark: …);
//  - oppure hanno almeno un creatore in comune E si citano a vicenda tra i titoli correlati o hanno ≥ 2 parole chiave in comune.
// I gruppi da 2 a 15 serie diventano universi, ordinati per anno di uscita.
import { normTitle } from '../match/normalize.js';
import { lowerKey } from '../common/util.js';

const STOP = new Set(['the', 'il', 'la', 'lo', 'le', 'i', 'gli', 'un', 'una', 'serie', 'season', 'stagione', 'tv', 'show', 'love', 'my', 'una storia']);

// «Star Trek: Discovery» → «star trek». Solo titoli con «:» o « - »; prefisso di almeno 4 lettere e non una parola vuota.
export function franchisePrefix(name) {
  const m = String(name || '').match(/^(.{3,40}?)\s*(?::|\s[-–—]\s)\s*\S/);
  if (!m) return null;
  const p = normTitle(m[1]);
  if (!p || p.replace(/\s/g, '').length < 4 || STOP.has(p)) return null;
  return p;
}

export function findUniverses(views, { maxSize = 15 } = {}) {
  const n = views.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[rb] = ra; };
  const why = new Map(); // coppia → motivo
  const link = (a, b, reason) => { union(a, b); const k = a < b ? `${a}|${b}` : `${b}|${a}`; if (!why.has(k)) why.set(k, reason); };

  // 1. Prefisso di franchise (anche quando una serie è esattamente il prefisso di un'altra).
  const byPrefix = new Map();
  const byNorm = new Map();
  views.forEach((v, i) => {
    const p = franchisePrefix(v.name);
    if (p) { if (!byPrefix.has(p)) byPrefix.set(p, []); byPrefix.get(p).push(i); }
    if (!byNorm.has(v.norm)) byNorm.set(v.norm, []); byNorm.get(v.norm).push(i);
  });
  for (const [p, idx] of byPrefix) {
    const all = [...idx, ...(byNorm.get(p) || [])];
    if (all.length < 2 || all.length > maxSize) continue;
    for (let k = 1; k < all.length; k++) link(all[0], all[k], 'stesso titolo di franchise');
  }

  // 2. Creatori in comune + legame forte (correlati reciproci o parole chiave).
  const bySite = new Map(views.map((v, i) => [v.siteId, i]).filter(([s]) => s != null));
  const byTmdb = new Map(views.map((v, i) => [v.tmdbId, i]).filter(([t]) => t != null));
  const related = views.map((v) => new Set([...(v.recs || []).map((r) => bySite.get(r)), ...(v.tmdbRecs || []).map((r) => byTmdb.get(r))].filter((x) => x != null)));
  const byCreator = new Map();
  views.forEach((v, i) => { for (const c of v.creators || []) { const k = lowerKey(c); if (!byCreator.has(k)) byCreator.set(k, []); byCreator.get(k).push(i); } });
  for (const [, idx] of byCreator) {
    if (idx.length < 2 || idx.length > 25) continue;
    for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) {
      const i = idx[a]; const j = idx[b];
      const mutual = related[i].has(j) || related[j].has(i);
      const ka = new Set(views[i].keywords || []); const common = (views[j].keywords || []).filter((k) => ka.has(k)).length;
      if (mutual || common >= 2) link(i, j, mutual ? 'stessi autori, collegate tra loro' : 'stessi autori e temi');
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  const out = [];
  for (const idx of groups.values()) {
    if (idx.length < 2 || idx.length > maxSize) continue;
    const members = idx.map((i) => views[i]).sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.name.localeCompare(b.name));
    const prefixes = idx.map((i) => franchisePrefix(views[i].name)).filter(Boolean);
    const common = prefixes.length >= 2 && prefixes.every((p) => p === prefixes[0]) ? prefixes[0] : null;
    const first = members[0];
    const label = common ? (members.find((m) => m.norm === common)?.name || first.name.split(/\s*[:–—-]\s*/)[0]) : `${first.name} e collegate`;
    const reasons = [...new Set(idx.flatMap((i) => idx.map((j) => why.get(i < j ? `${i}|${j}` : `${j}|${i}`)).filter(Boolean)))];
    const next = members.find((m) => !['completed', 'dropped'].includes(m.status)) || null;
    out.push({
      id: `u:${first.ck}`, name: label, reasons,
      members: members.map((m) => ({ ck: m.ck, name: m.name, year: m.year, status: m.status, poster: m.poster, score: m.score })),
      next: next ? next.ck : null, seen: members.filter((m) => m.status === 'completed').length,
    });
  }
  return out.sort((a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name));
}
