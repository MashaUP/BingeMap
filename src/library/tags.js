// Tag: importati (con fonte e nome originali), personali, calcolati; alias e regole.
// I tag importati non vengono mai rinominati alla fonte: alias e unioni vivono solo in BingeMap.
import { lowerKey } from '../common/util.js';

// Sinonimi IT/EN per generi e tag comuni (usati per unire generi del sito e di TMDB e per i suggerimenti).
const SYN = [
  ['fantasy', 'fantastico', 'fantasia'],
  ['sci-fi', 'science fiction', 'fantascienza', 'scifi', 'sci-fi & fantasy'],
  ['comedy', 'commedia', 'comico'],
  ['drama', 'dramma', 'drammatico'],
  ['mystery', 'mistero', 'giallo'],
  ['thriller'],
  ['horror'],
  ['crime', 'crimine', 'poliziesco'],
  ['animation', 'animazione', 'anime'],
  ['action', 'azione', 'action & adventure'],
  ['adventure', 'avventura'],
  ['documentary', 'documentario', 'documentari'],
  ['romance', 'romantico', 'sentimentale'],
  ['family', 'famiglia', 'per famiglie'],
  ['history', 'storico', 'storia'],
  ['war', 'guerra', 'war & politics'],
  ['western'],
  ['reality', 'reality show'],
  ['kids', 'bambini', 'ragazzi'],
  ['music', 'musica', 'musical'],
  ['soap', 'soap opera'],
  ['talk', 'talk show'],
  ['news', 'notizie'],
  ['biography', 'biografico'],
  ['sport'],
];
const SYN_MAP = new Map();
for (const group of SYN) for (const w of group) SYN_MAP.set(w, group[0]);

// Nome visualizzato di un genere canonico.
const GENRE_LABEL = {
  fantasy: 'Fantasy', 'sci-fi': 'Sci-Fi', comedy: 'Commedia', drama: 'Drama', mystery: 'Mystery', thriller: 'Thriller',
  horror: 'Horror', crime: 'Crime', animation: 'Animazione', action: 'Azione', adventure: 'Avventura',
  documentary: 'Documentario', romance: 'Romantico', family: 'Famiglia', history: 'Storico', war: 'Guerra',
  western: 'Western', reality: 'Reality', kids: 'Ragazzi', music: 'Musica', soap: 'Soap', talk: 'Talk show',
  news: 'Notizie', biography: 'Biografico', sport: 'Sport',
};

export function canonicalGenre(name) {
  const k = lowerKey(name);
  if (!k) return null;
  // "Action & Adventure" di TMDB → due generi.
  return SYN_MAP.get(k) || k;
}

export function splitGenre(name) {
  const k = lowerKey(name);
  if (k === 'action & adventure') return ['action', 'adventure'];
  if (k === 'sci-fi & fantasy') return ['sci-fi', 'fantasy'];
  if (k === 'war & politics') return ['war'];
  return [canonicalGenre(name)].filter(Boolean);
}

export function genreLabel(key) {
  return GENRE_LABEL[key] || key.replace(/\b\w/g, (c) => c.toUpperCase());
}

export const tagKey = (ns, name) => `${ns}:${name}`;

// Applica gli alias: { 'imp:refract:fantasy' → 'Fantasy' }.
export function aliasName(aliases, source, name) {
  return aliases.get(`imp:${source}:${lowerKey(name)}`) || aliases.get(`any:${lowerKey(name)}`) || name;
}

// Distanza di Levenshtein (piccola, per nomi di tag).
export function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// Suggerimenti di unione (idea 16): gruppi di nomi simili, da confermare a mano.
export function mergeSuggestions(names) {
  const items = [...new Set(names)].map((n) => ({ n, k: lowerKey(n), s: SYN_MAP.get(lowerKey(n)) }));
  const groups = [];
  const used = new Set();
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const g = [items[i].n];
    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;
      const a = items[i], b = items[j];
      const same = a.k === b.k || (a.s && a.s === b.s) || (a.k.length > 3 && lev(a.k, b.k) <= 1);
      if (same) { g.push(b.n); used.add(j); }
    }
    if (g.length > 1) groups.push(g);
  }
  return groups;
}

// Tag calcolati (F55).
export function computedTags(v) {
  const out = [];
  if (v.seasons != null && v.seasons <= 2) out.push('Corta');
  if (v.seasons === 1 && v.tmdbStatus === 'Ended') out.push('Mini-serie');
  if (v.hours != null && v.hours <= 10) out.push('Weekend');
  if (v.seasons != null && v.seasons >= 6) out.push('Lunga corsa');
  return out;
}

// Regole automatiche (F56, idea 15): { ifSource, ifTag, thenTag }.
export function applyTagRules(rules, impTags) {
  const out = new Set();
  for (const r of rules) {
    for (const [src, names] of Object.entries(impTags)) {
      if (r.ifSource && r.ifSource !== '*' && r.ifSource !== src) continue;
      if (names.some((n) => lowerKey(n) === lowerKey(r.ifTag))) out.add(r.thenTag);
    }
  }
  return [...out];
}
