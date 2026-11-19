// Web Worker: costruisce le viste e risponde alle query, così l'interfaccia resta fluida.
import { setProfile, getAll } from '../db/db.js';
import { loadSettings } from '../common/settings.js';
import { buildViews } from '../library/view.js';
import { runQuery, sortViews, facets, explain } from '../query/engine.js';
import { recommend, surprise } from '../recommend/recommend.js';
import { cares, calendarItems, renewalAlerts } from '../library/alerts.js';
import { tonight } from '../recommend/tonight.js';
import { buildMap } from '../recommend/map.js';
import { computeWrapped } from '../library/wrapped.js';
import { findUniverses } from '../library/universes.js';
import { classics, listCoverage } from '../library/classics.js';
import { timeline } from '../library/timeline.js';
import { countryStats } from '../library/world.js';
import { normTitle } from '../match/normalize.js';

let state = { views: [], byCk: new Map(), missing: [], nowAvailable: [], settings: null, catalogByCk: new Map(), recoCache: null };

async function build(profile, override) {
  setProfile(profile || 'default');
  const [catalog, items, matches, overlay, aliases, tagRules, tmdbCache, batches] = await Promise.all([
    getAll('catalog_titles'), getAll('library_items'), getAll('matches'), getAll('overlay'), getAll('tag_aliases'),
    getAll('tag_rules'), getAll('tmdb_cache'), getAll('import_batches'),
  ]);
  const settings = { ...(await loadSettings()), ...(override || {}) };
  const res = buildViews({ catalog, items, matches, overlay, aliases, tagRules, tmdbCache, batches }, settings);
  state = { views: res.views, byCk: new Map(res.views.map((v) => [v.ck, v])), missing: res.missing, nowAvailable: res.nowAvailable, settings,
    catalogByCk: new Map(catalog.map((c) => [c.ck, c])), recoCache: null, mapCache: null, uniCache: null };
  return summary();
}

function summary() {
  const counts = { total: state.views.length, completed: 0, watching: 0, hold: 0, dropped: 0, plan: 0, none: 0, unknown: 0, conflict: 0, pending: 0, newSeason: 0, endedNow: 0, stalled: 0, renewal: 0, airing: 0, almost: 0, missingSeasons: 0, followedNew: 0 };
  for (const v of state.views) {
    counts[v.status]++; if (v.conflict) counts.conflict++; if (v.pendingMatch) counts.pending++; if (v.newSeason) counts.newSeason++; if (v.endedNow) counts.endedNow++; if (v.stalled) counts.stalled++;
    if (v.statusChange && cares(v)) counts.renewal++;
    if (v.nextAir?.date && cares(v)) counts.airing++;
    if ((v.status === 'watching' || v.status === 'hold') && v.progress?.pct >= 80 && v.progress.pct < 100) counts.almost++;
    if (v.missingSeasons && cares(v)) counts.missingSeasons++;
    if (v.followedPeople?.length && v.firstSeen && Date.now() - v.firstSeen < 14 * 86400000 && !['completed', 'dropped'].includes(v.status)) counts.followedNew++;
  }
  return { counts, missing: state.missing.length, nowAvailable: state.nowAvailable.length };
}

export function slim(v) {
  const tags = [...Object.values(v.impTags).flat(), ...v.userTags];
  return { ck: v.ck, name: v.name, year: v.year, genreLabels: v.genreLabels.slice(0, 2), score: v.score, status: v.status, poster: v.poster,
    tags: tags.slice(0, 2), seasons: v.seasons, hours: v.hours, subIta: v.subIta, catalogs: v.catalogs, providers: v.providers.slice(0, 3),
    conflict: v.conflict, pendingMatch: v.pendingMatch, newSeason: v.newSeason, endedNow: v.endedNow, stalled: v.stalled, why: v._why || [],
    nextUp: v.nextUp != null, rating: v.rating, firstSeen: v.firstSeen, url: v.url,
    progress: v.progress ? { pct: v.progress.pct, pos: v.progress.pos, leftMin: v.progress.leftMin } : null, nextAir: v.nextAir, statusChange: v.statusChange,
    epRuntime: v.epRuntime, legal: v.legal?.slice(0, 3) || [], plot: v.plot, spoiler: v.status === 'watching' || v.status === 'hold',
    openEnding: v.openEnding, missingSeasons: v.missingSeasons, country: v.country };
}

function reco(list) {
  return recommend(list, state.views, state.settings.weights, state.catalogByCk).items;
}

function query({ ast, sort = 'score', offset = 0, limit = 60, facetFields = [], includeMissing = false, showHidden = false, withReco = false }) {
  const { results, missingData } = runQuery(state.views, ast, { includeMissing, showHidden });
  let list = results;
  if (sort === 'reco' || withReco) list = reco(list);
  if (sort !== 'reco') list = sortViews(list, sort);
  const fac = facetFields.length ? facets(state.views, ast, facetFields, { includeMissing, showHidden }) : {};
  const breakdown = { completed: 0, plan: 0, active: 0, none: 0, unknown: 0 };
  for (const v of list) {
    if (v.status === 'completed') breakdown.completed++; else if (v.status === 'plan') breakdown.plan++;
    else if (['watching', 'hold', 'dropped'].includes(v.status)) breakdown.active++; else if (v.status === 'none') breakdown.none++; else breakdown.unknown++;
  }
  return { total: list.length, missingData, items: list.slice(offset, offset + limit).map(slim), allCks: list.map((v) => v.ck), facets: fac, breakdown };
}

const api = {
  build: ({ profile, override }) => build(profile, override),
  summary: () => summary(),
  query,
  view: ({ ck }) => state.byCk.get(ck) || null,
  views: ({ cks }) => cks.map((ck) => state.byCk.get(ck)).filter(Boolean),
  allViews: () => state.views,
  missing: () => ({ missing: state.missing, nowAvailable: state.nowAvailable.map((n) => ({ ...n, view: state.byCk.get(n.ck) ? slim(state.byCk.get(n.ck)) : null })) }),
  explain: ({ ck, ast }) => { const v = state.byCk.get(ck); return v ? explain(v, ast) : ['Titolo non trovato nel catalogo attivo']; },
  surprise: ({ ast, seed }) => { const { results } = runQuery(state.views, ast); const s = surprise(reco(results), seed); return s ? slim(s) : null; },
  recommend: ({ ast, limit = 12 }) => { const { results } = runQuery(state.views, ast); return reco(results).slice(0, limit).map(slim); },
  similar: ({ ck, limit = 8 }) => {
    const v = state.byCk.get(ck); if (!v) return [];
    const cat = state.catalogByCk;
    const siteRecs = new Set((v.recs || []).map(String));
    const tmdbRecs = new Set(v.tmdbRecs || []);
    return state.views.filter((x) => x.ck !== ck && (siteRecs.has(String(x.siteId)) || x.cks.some((k) => tmdbRecs.has(cat.get(k)?.tmdbId)))).slice(0, limit).map(slim);
  },
  calendar: ({ days = 90, onlyMine = true }) => calendarItems(state.views, { days, onlyMine }),
  renewals: () => renewalAlerts(state.views),
  tonight: ({ minutes = 40 }) => tonight(state.views, minutes, { discovery: [...new Set(['plan', 'none', 'unknown', ...(state.settings.discovery?.includeWatching ? ['watching'] : [])])] }).map((x) => ({ ...x, v: slim(x.v), progress: x.v.progress })),
  map: () => { if (!state.mapCache) state.mapCache = buildMap(state.views); return state.mapCache; },
  wrapped: ({ year, diary }) => computeWrapped(state.views, diary, year),
  deck: ({ ast, limit = 40, exclude = [] }) => {
    const { results } = runQuery(state.views, ast);
    const ex = new Set(exclude);
    return reco(results).filter((v) => !ex.has(v.ck)).slice(0, limit).map((v) => ({ ...slim(v), genreLabels: v.genreLabels, seasons: v.seasons, hours: v.hours }));
  },
  universes: () => { if (!state.uniCache) state.uniCache = findUniverses(state.views); return state.uniCache; },
  universeOf: ({ ck }) => { if (!state.uniCache) state.uniCache = findUniverses(state.views); return state.uniCache.find((u) => u.members.some((m) => m.ck === ck)) || null; },
  classics: ({ limit = 100 }) => classics(state.views, { limit }),
  listCoverage: ({ listKey }) => listCoverage(state.views, listKey),
  allLists: () => [...new Set(state.views.flatMap((v) => v.lists))].sort(),
  timeline: ({ diary }) => timeline(state.views, diary),
  world: () => countryStats(state.views),
  people: () => {
    const follows = state.settings.follows || [];
    return follows.map((f) => {
      const k = f.name.toLowerCase();
      const list = state.views.filter((v) => [...v.cast, ...v.creators].some((n) => n.toLowerCase() === k));
      return { ...f, total: list.length, seen: list.filter((v) => v.status === 'completed').length,
        todo: reco(list.filter((v) => !['completed', 'dropped'].includes(v.status))).slice(0, 12).map(slim),
        recent: list.filter((v) => v.firstSeen && Date.now() - v.firstSeen < 30 * 86400000).map((v) => v.ck) };
    });
  },
  animeMatch: ({ items }) => {
    const byNorm = new Map();
    for (const v of state.views) { for (const t of [v.name, v.originalName, ...v.alt]) { const n = normTitle(t || ''); if (n && !byNorm.has(n)) byNorm.set(n, v); } }
    return items.map((it) => { const v = [it.title, ...(it.altTitles || [])].map((t) => byNorm.get(normTitle(t || ''))).find(Boolean); return v ? slim(v) : null; });
  },
  conflicts: () => state.views.filter((v) => v.conflict).map((v) => ({ ...slim(v), statusBySource: v.statusBySource })),
  tagIndex: () => {
    const m = new Map();
    for (const v of state.views) {
      for (const [src, names] of Object.entries(v.impTags)) for (const n of names) { const k = `${src}|${n}`; m.set(k, { source: src, name: n, count: (m.get(k)?.count || 0) + 1 }); }
      for (const n of v.userTags) { const k = `user|${n}`; m.set(k, { source: 'user', name: n, count: (m.get(k)?.count || 0) + 1 }); }
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  },
};

self.onmessage = async (e) => {
  const { id, method, args } = e.data;
  try { const r = await api[method](args || {}); self.postMessage({ id, ok: true, r }); }
  catch (err) { self.postMessage({ id, ok: false, error: err.message }); }
};
