// Motore di filtri: un albero JSON valutato su viste in memoria.
// Nodo: {all:[...]} | {any:[...]} | {not: nodo} | condizione {field, any|all|none|range|min|max|eq|withinDays|q}
import { normTitle } from '../match/normalize.js';
import { lowerKey } from '../common/util.js';
import { STATUS_LABEL } from '../library/status.js';
import { genreLabel } from '../library/tags.js';

const DAY = 86400000;

// Definizione dei campi: come leggere il valore e come descriverlo.
export const FIELDS = {
  status: { label: 'Stato di visione', group: 'Personali', type: 'enum', get: (v) => v.status, valueLabel: (x) => STATUS_LABEL[x] || x },
  tag: { label: 'Tag', group: 'Personali', type: 'set', get: (v) => v.tags },
  impTag: { label: 'Tag importati', group: 'Personali', type: 'set', get: (v) => Object.entries(v.impTags).flatMap(([s, ns]) => ns.map((n) => `${s}:${lowerKey(n)}`)) },
  userTag: { label: 'Tag personali', group: 'Personali', type: 'set', get: (v) => v.userTags.map(lowerKey) },
  rating: { label: 'Voto personale', group: 'Personali', type: 'num', get: (v) => v.rating },
  list: { label: 'Liste', group: 'Personali', type: 'set', get: (v) => v.lists },
  nextUp: { label: 'Le prossime 5', group: 'Personali', type: 'bool', get: (v) => v.nextUp != null },
  genre: { label: 'Genere', group: 'Catalogo', type: 'set', get: (v) => v.genres, valueLabel: genreLabel },
  year: { label: 'Anno', group: 'Catalogo', type: 'num', get: (v) => v.year },
  score: { label: 'Voto del sito', group: 'Catalogo', type: 'num', get: (v) => v.score },
  seasons: { label: 'Stagioni', group: 'Catalogo', type: 'num', get: (v) => v.seasons },
  subIta: { label: 'Sub-ITA', group: 'Catalogo', type: 'bool', get: (v) => v.subIta },
  added: { label: 'Aggiunta al catalogo', group: 'Catalogo', type: 'date', get: (v) => v.firstSeen },
  catalog: { label: 'Catalogo', group: 'Catalogo', type: 'set', get: (v) => v.catalogs, valueLabel: (x) => (x === 'sc' ? 'Streaming Community' : 'Fornitori legali') },
  provider: { label: 'Fornitore', group: 'Catalogo', type: 'set', get: (v) => v.providers },
  newSeason: { label: 'Nuova stagione', group: 'Catalogo', type: 'bool', get: (v) => v.newSeason },
  complete: { label: 'Completa nel catalogo', group: 'Catalogo', type: 'bool', get: (v) => v.complete === true },
  tmdbStatus: { label: 'Stato serie', group: 'TMDB', type: 'enum', get: (v) => v.tmdbStatus, valueLabel: (x) => ({ Ended: 'Conclusa', 'Returning Series': 'In corso', Canceled: 'Cancellata', 'In Production': 'In produzione', Planned: 'Annunciata', Pilot: 'Pilota' }[x] || x) },
  country: { label: 'Paese', group: 'TMDB', type: 'set', get: (v) => v.country },
  lang: { label: 'Lingua originale', group: 'TMDB', type: 'enum', get: (v) => v.lang },
  episodes: { label: 'Episodi', group: 'TMDB', type: 'num', get: (v) => v.episodes },
  epRuntime: { label: 'Durata episodio (min)', group: 'TMDB', type: 'num', get: (v) => v.epRuntime },
  hours: { label: 'Ore totali', group: 'TMDB', type: 'num', get: (v) => v.hours },
  endedNow: { label: 'Appena conclusa', group: 'TMDB', type: 'bool', get: (v) => v.endedNow },
  cast: { label: 'Attori e creatori', group: 'TMDB', type: 'set', get: (v) => [...v.cast, ...v.creators].map(lowerKey) },
  matchConfidence: { label: 'Confidenza match', group: 'Sistema', type: 'num', get: (v) => v.matchConfidence },
  conflict: { label: 'Stati in conflitto', group: 'Sistema', type: 'bool', get: (v) => v.conflict },
  partial: { label: 'Dati parziali', group: 'Sistema', type: 'bool', get: (v) => v.partial },
  stalled: { label: 'Ferme da tempo', group: 'Sistema', type: 'bool', get: (v) => v.stalled },
  notInterested: { label: 'Non mi interessa', group: 'Sistema', type: 'bool', get: (v) => !!v.notInterested },
  snoozed: { label: 'Rimandate', group: 'Sistema', type: 'bool', get: (v) => v.snoozed },
  initial: { label: 'Iniziale', group: 'Catalogo', type: 'enum', get: (v) => (/[a-z]/.test(v.norm[0] || '') ? v.norm[0].toUpperCase() : '#') },
  text: { label: 'Testo', group: 'Sistema', type: 'text', get: (v) => v },
};

function matchText(v, q) {
  const n = normTitle(q);
  if (!n) return true;
  const hay = [v.norm, normTitle(v.originalName || ''), ...v.alt.map(normTitle)].join(' | ');
  return n.split(' ').every((tok) => hay.includes(tok));
}

// Valuta una condizione. Ritorna true / false / null (dato mancante).
export function evalCond(c, v, now = Date.now()) {
  const def = FIELDS[c.field];
  if (!def) return true;
  if (def.type === 'text') return matchText(v, c.q || '');
  const val = def.get(v);
  switch (def.type) {
    case 'set': {
      const arr = Array.isArray(val) ? val : [];
      if (c.none?.length && c.none.some((x) => arr.includes(x))) return false;
      if (c.all?.length && !c.all.every((x) => arr.includes(x))) return false;
      if (c.any?.length && !c.any.some((x) => arr.includes(x))) return false;
      return true;
    }
    case 'enum': {
      if (c.none?.length && c.none.includes(val)) return false;
      if (c.any?.length) { if (val == null) return null; return c.any.includes(val); }
      return true;
    }
    case 'num': {
      const lo = c.range ? c.range[0] : c.min; const hi = c.range ? c.range[1] : c.max;
      if (lo == null && hi == null) return true;
      if (val == null) return null;
      if (lo != null && val < lo) return false;
      if (hi != null && val > hi) return false;
      return true;
    }
    case 'bool': {
      if (c.eq == null) return true;
      return !!val === !!c.eq;
    }
    case 'date': {
      if (c.withinDays == null) return true;
      if (!val) return null;
      return now - val <= c.withinDays * DAY;
    }
    default: return true;
  }
}

// Un nodo con "field" è sempre una condizione (anche se ha any/all/none); altrimenti è un gruppo.
export function evalNode(node, v, opts = {}) {
  if (!node) return true;
  if (node.field) { const r = evalCond(node, v, opts.now); return r === null ? !!opts.includeMissing : r; }
  if (node.all) return node.all.every((n) => evalNode(n, v, opts));
  if (node.any) return node.any.length === 0 || node.any.some((n) => evalNode(n, v, opts));
  if (node.not) return !evalNode(node.not, v, opts);
  const r = evalCond(node, v, opts.now);
  if (r === null) return !!opts.includeMissing;
  return r;
}

export function runQuery(views, ast, opts = {}) {
  const out = []; let missingData = 0;
  for (const v of views) {
    if (!opts.showHidden && (v.notInterested || v.snoozed) && !mentions(ast, ['notInterested', 'snoozed'])) continue;
    if (evalNode(ast, v, opts)) out.push(v);
    else if (!opts.includeMissing && evalNode(ast, v, { ...opts, includeMissing: true })) missingData++;
  }
  return { results: out, missingData };
}

function mentions(node, fields) {
  if (!node) return false;
  if (node.field) return fields.includes(node.field);
  if (node.all) return node.all.some((n) => mentions(n, fields));
  if (node.any) return node.any.some((n) => mentions(n, fields));
  if (node.not) return mentions(node.not, fields);
  return fields.includes(node.field);
}

// Toglie dall'albero le condizioni su un campo (per i conteggi delle opzioni).
export function withoutField(node, field) {
  if (!node) return null;
  if (node.field) return node.field === field ? null : node;
  if (node.all) return { all: node.all.map((n) => withoutField(n, field)).filter(Boolean) };
  if (node.any) { const a = node.any.map((n) => withoutField(n, field)).filter(Boolean); return a.length ? { any: a } : null; }
  if (node.not) { const n = withoutField(node.not, field); return n ? { not: n } : null; }
  return node.field === field ? null : node;
}

// Conteggi per opzione (F60): quante viste avrebbero quel valore con gli altri filtri attivi.
export function facets(views, ast, fieldNames, opts = {}) {
  const res = {};
  for (const f of fieldNames) {
    const def = FIELDS[f];
    const base = withoutField(ast, f);
    const counts = new Map();
    for (const v of views) {
      if (!opts.showHidden && (v.notInterested || v.snoozed)) continue;
      if (!evalNode(base, v, opts)) continue;
      const val = def.get(v);
      const arr = Array.isArray(val) ? val : val == null ? [] : [val];
      for (const x of arr) counts.set(x, (counts.get(x) || 0) + 1);
    }
    res[f] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }
  return res;
}

// Ordinamenti.
export const SORTS = {
  reco: { label: 'Più adatte a te', fn: (a, b) => (b._reco ?? 0) - (a._reco ?? 0) },
  score: { label: 'Voto', fn: (a, b) => (b.score ?? -1) - (a.score ?? -1) },
  rating: { label: 'Voto personale', fn: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) },
  added: { label: 'Aggiunte di recente', fn: (a, b) => (b.firstSeen ?? 0) - (a.firstSeen ?? 0) },
  yearDesc: { label: 'Anno (recenti)', fn: (a, b) => (b.year ?? 0) - (a.year ?? 0) },
  yearAsc: { label: 'Anno (vecchie)', fn: (a, b) => (a.year ?? 9999) - (b.year ?? 9999) },
  name: { label: 'Titolo A–Z', fn: (a, b) => a.norm.localeCompare(b.norm) },
  seasons: { label: 'Meno stagioni', fn: (a, b) => (a.seasons ?? 99) - (b.seasons ?? 99) },
  hours: { label: 'Più brevi', fn: (a, b) => (a.hours ?? 1e9) - (b.hours ?? 1e9) },
  popularity: { label: 'Popolarità TMDB', fn: (a, b) => (b.popularity ?? -1) - (a.popularity ?? -1) },
};

export function sortViews(list, key = 'score') {
  const s = SORTS[key] || SORTS.score;
  return [...list].sort((a, b) => s.fn(a, b) || a.norm.localeCompare(b.norm));
}

// Frase leggibile della query (costruttore di filtri, ricerche salvate).
export function describe(node) {
  if (!node) return 'Tutte le serie';
  const parts = [];
  const walk = (n) => {
    if (!n) return '';
    if (n.field) return describeCond(n);
    if (n.all) return n.all.map(walk).filter(Boolean).join(', ');
    if (n.any) return '(' + n.any.map(walk).filter(Boolean).join(' oppure ') + ')';
    if (n.not) return 'non ' + walk(n.not);
    return describeCond(n);
  };
  parts.push(walk(node));
  const s = parts.join('').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Tutte le serie';
}

export function describeCond(c) {
  const def = FIELDS[c.field];
  if (!def) return '';
  const lab = (x) => (def.valueLabel ? def.valueLabel(x) : x.includes(':') ? x.split(':').slice(1).join(':') + ' (' + x.split(':')[0] + ')' : x);
  const L = def.label.toLowerCase();
  if (def.type === 'text') return c.q ? `con «${c.q}» nel titolo` : '';
  if (def.type === 'set' || def.type === 'enum') {
    const out = [];
    if (c.any?.length) out.push(`${L}: ${c.any.map(lab).join(' o ')}`);
    if (c.all?.length) out.push(`${L}: ${c.all.map(lab).join(' e ')}`);
    if (c.none?.length) out.push(`${L} esclusi: ${c.none.map(lab).join(', ')}`);
    return out.join(', ');
  }
  if (def.type === 'num') {
    const lo = c.range ? c.range[0] : c.min; const hi = c.range ? c.range[1] : c.max;
    if (lo != null && hi != null) return `${L} tra ${lo} e ${hi}`;
    if (lo != null) return `${L} almeno ${lo}`;
    if (hi != null) return `${L} al massimo ${hi}`;
    return '';
  }
  if (def.type === 'bool') return c.eq == null ? '' : (c.eq ? L : `non ${L}`);
  if (def.type === 'date') return c.withinDays ? `${L} negli ultimi ${c.withinDays} giorni` : '';
  return '';
}

// «Perché non la vedo?» (idea 6): condizioni che escludono una vista.
export function explain(v, ast, opts = {}) {
  const reasons = [];
  if ((v.notInterested || v.snoozed) && !opts.showHidden) reasons.push(v.notInterested ? 'L\'hai segnata «Non mi interessa»' : 'L\'hai rimandata');
  const conds = flatten(ast);
  for (const c of conds) {
    const r = evalCond(c, v, opts.now);
    if (r === false) reasons.push(`Non soddisfa: ${describeCond(c)}`);
    if (r === null) reasons.push(`Manca il dato per: ${describeCond(c)}`);
  }
  return reasons;
}

function flatten(node, out = []) {
  if (!node) return out;
  if (node.field) { out.push(node); return out; }
  if (node.all) node.all.forEach((n) => flatten(n, out));
  else if (node.any) node.any.forEach((n) => flatten(n, out));
  else if (node.not) flatten(node.not, out);
  else out.push(node);
  return out;
}

// Modifica comoda di una condizione semplice dentro {all:[...]}.
export function setCond(ast, field, patch) {
  const root = ast && ast.all ? { all: [...ast.all] } : { all: ast ? [ast] : [] };
  const i = root.all.findIndex((n) => n.field === field);
  const cur = i >= 0 ? root.all[i] : { field };
  const next = patch === null ? null : { ...cur, ...patch };
  const empty = !next || (!next.any?.length && !next.all?.length && !next.none?.length && next.range == null && next.min == null && next.max == null && next.eq == null && next.withinDays == null && !next.q);
  if (i >= 0) { if (empty) root.all.splice(i, 1); else root.all[i] = next; } else if (!empty) root.all.push(next);
  return root;
}

export function getCond(ast, field) {
  return ast?.all?.find((n) => n.field === field) || null;
}
