// Costruisce le "viste" (una per serie del catalogo) unendo catalogo, libreria, match, strato personale e TMDB.
// Funzione pura: gira nel Web Worker, nella pagina e nei test.
import { effectiveStatus } from './status.js';
import { splitGenre, genreLabel, aliasName, computedTags, applyTagRules } from './tags.js';
import { normTitle } from '../match/normalize.js';
import { lowerKey } from '../common/util.js';

const DAY = 86400000;

export function buildViews(data, settings) {
  const { catalog = [], items = [], matches = [], overlay = [], aliases = [], tagRules = [], tmdbCache = [], batches = [] } = data;
  const activeCatalog = settings.activeCatalog || 'all';
  const aliasMap = new Map(aliases.map((a) => [a.key, a.name]));
  const ovMap = new Map(overlay.map((o) => [o.ck, o]));
  const tmdbMap = new Map(tmdbCache.map((t) => [t.tmdbId, t]));
  const undone = new Set(batches.filter((b) => b.status === 'undone').map((b) => b.id));
  const liveItems = items.filter((i) => !i.gone && !undone.has(i.batchId));
  const itemByKey = new Map(liveItems.map((i) => [i.key, i]));

  // Match confermati per ck, e candidati in coda per ck.
  const byCk = new Map(); const pendingCk = new Set();
  for (const m of matches) {
    const it = itemByKey.get(m.itemKey);
    if (!it) continue;
    if (m.ck && (m.state === 'auto' || m.state === 'manual')) {
      if (!byCk.has(m.ck)) byCk.set(m.ck, []);
      byCk.get(m.ck).push({ item: it, m });
    } else if (m.state === 'queue') {
      for (const c of m.candidates || []) pendingCk.add(c.ck);
      if (m.ck) pendingCk.add(m.ck);
    }
  }

  const cat = catalog.filter((c) => c.status !== 'gone' && (activeCatalog === 'all' || c.source === activeCatalog));
  // In modalità "tutti i cataloghi" i titoli con lo stesso ID TMDB diventano una sola vista.
  const groups = new Map();
  for (const c of cat) {
    const g = activeCatalog === 'all' && c.tmdbId ? `t${c.tmdbId}` : c.ck;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }

  const now = Date.now();
  const views = [];
  for (const list of groups.values()) {
    list.sort((a, b) => (a.source === 'sc' ? -1 : 1) - (b.source === 'sc' ? -1 : 1));
    const c = list[0];
    const cks = list.map((x) => x.ck);
    const tm = c.tmdbId ? tmdbMap.get(c.tmdbId) : null;
    const ov = ovMap.get(c.ck) || null;
    const linked = cks.flatMap((k) => byCk.get(k) || []);
    const sources = linked.map(({ item }) => ({ source: item.source, status: item.status, updatedAt: item.lastActivity || item.updatedAt }));
    const eff = effectiveStatus(ov?.status || null, sources, settings.conflictRule, settings.sourcePriority);
    let status = eff.status;
    const pending = status === 'none' && cks.some((k) => pendingCk.has(k));
    if (pending) status = 'unknown';

    const genres = new Set();
    for (const x of list) for (const gname of x.genres || []) for (const gk of splitGenre(gname)) genres.add(gk);
    for (const gname of tm?.genres || []) for (const gk of splitGenre(gname)) genres.add(gk);

    const impTags = {};
    const lists = new Set();
    let impRating = null; let seasonsWatched = null; let lastActivity = null;
    for (const { item } of linked) {
      if (item.tags?.length) {
        impTags[item.source] = impTags[item.source] || [];
        for (const t of item.tags) {
          const n = aliasName(aliasMap, item.source, t);
          if (!impTags[item.source].includes(n)) impTags[item.source].push(n);
        }
      }
      for (const l of item.lists || []) lists.add(`${item.source}:${l}`);
      if (item.rating != null) impRating = Math.max(impRating ?? 0, item.rating);
      if (item.seasonsWatched != null) seasonsWatched = Math.max(seasonsWatched ?? 0, item.seasonsWatched);
      const la = item.lastActivity || item.updatedAt;
      if (la) lastActivity = Math.max(lastActivity ?? 0, la);
    }

    const seasons = c.seasonsCount ?? tm?.seasons ?? null;
    const episodes = tm?.episodes ?? null;
    const epRuntime = tm?.epRuntime ?? c.duration ?? null;
    const hours = episodes && epRuntime ? Math.round((episodes * epRuntime) / 6) / 10 : null;
    const base = {
      seasons, tmdbStatus: tm?.status || null, hours,
    };
    const comp = computedTags(base);
    const userTags = ov?.tags || [];
    const ruleTags = applyTagRules(tagRules, impTags);
    const allTags = new Set();
    for (const [src, names] of Object.entries(impTags)) for (const n of names) { allTags.add(lowerKey(n)); allTags.add(`${src}:${lowerKey(n)}`); }
    for (const t of [...userTags, ...comp, ...ruleTags]) allTags.add(lowerKey(t));

    // Idea 1 / F49: nuova stagione per una serie completata.
    let newSeason = false;
    if (status === 'completed' && seasons != null) {
      if (seasonsWatched != null && seasons > seasonsWatched) newSeason = true;
      else if (lastActivity && (c.history || []).some((h) => h.date > lastActivity && h.seasonsCount > (h.prev ?? seasons))) newSeason = true;
    }
    // Idea 7: ora è conclusa.
    const endedNow = !!(tm?.endedAt && now - tm.endedAt < 45 * DAY && (status === 'plan' || status === 'hold' || status === 'none'));
    // Idea 23: riprendi o lascia.
    const stalled = (status === 'watching' || status === 'hold') && lastActivity != null && now - lastActivity > (settings.stalledDays || 60) * DAY;

    const matchBest = linked.reduce((m, { m: mm }) => (mm.confidence > (m?.confidence ?? -1) ? mm : m), null);
    views.push({
      ck: c.ck, cks, catalogs: [...new Set(list.map((x) => x.source))], providers: [...new Set(list.flatMap((x) => x.providers || []))],
      siteId: c.siteId, name: c.name, originalName: c.originalName || tm?.originalName || null,
      alt: [...new Set([...(c.altTitles || []), ...(tm?.altTitles || [])])],
      norm: normTitle(c.name), year: c.year ?? tm?.year ?? null,
      genres: [...genres], genreLabels: [...genres].map(genreLabel),
      score: c.score ?? tm?.voteAverage ?? null, seasons, subIta: !!c.subIta,
      firstSeen: c.firstSeen || null, lastSeen: c.lastSeen || null,
      url: c.url || null, poster: c.poster || (tm?.posterPath ? `https://image.tmdb.org/t/p/w342${tm.posterPath}` : null),
      plot: c.plot || tm?.overview || null, trailer: c.trailerUrl || tm?.trailer || null,
      recs: c.recommendations || [], tmdbRecs: tm?.recommendations || [],
      country: tm?.countries || [], lang: tm?.originalLanguage || null, tmdbStatus: tm?.status || null,
      episodes, epRuntime, hours, complete: seasons != null && tm?.seasons != null ? seasons >= tm.seasons : null,
      popularity: tm?.popularity ?? null, cast: tm?.cast || [], creators: tm?.creators || [],
      status, statusFrom: pending ? 'pending' : eff.from, conflict: eff.conflict, pendingMatch: pending,
      statusBySource: Object.fromEntries(linked.map(({ item }) => [item.source, item.status])),
      impTags, userTags, computedTags: comp, ruleTags, tags: [...allTags],
      lists: [...lists], rating: ov?.rating ?? impRating, impRating,
      matchConfidence: matchBest?.confidence ?? null, matchMethod: matchBest?.method ?? null,
      linkedKeys: linked.map(({ item }) => item.key),
      partial: !c.detailAt && c.source === 'sc', tmdbMissing: !!c.tmdbId && !tm,
      notInterested: ov?.notInterested || null, snoozedUntil: ov?.snoozeUntil || null,
      snoozed: !!(ov?.snoozeUntil && ov.snoozeUntil > now), skipCount: ov?.skipCount || 0,
      nextUp: ov?.nextUp ?? null, note: ov?.note || '', rewatch: ov?.rewatch || 0, monitor: !!ov?.monitor,
      newSeason, endedNow, stalled, lastActivity, seasonsWatched,
      history: c.history || [],
    });
  }

  // Mancanti: righe della libreria senza corrispondenza nel catalogo attivo.
  const matchedKeys = new Set(); const queueKeys = new Set(); const nowAvail = new Map();
  for (const m of matches) {
    if (activeCatalog !== 'all' && m.catalog !== activeCatalog) continue;
    if (m.ck && (m.state === 'auto' || m.state === 'manual')) { matchedKeys.add(m.itemKey); if (m.nowAvailableAt) nowAvail.set(m.itemKey, m); }
    if (m.state === 'queue') queueKeys.add(m.itemKey);
    if (m.state === 'ignored') matchedKeys.add(m.itemKey);
  }
  const missing = [];
  const seenMissing = new Set();
  for (const it of liveItems) {
    if (it.mediaType === 'movie') continue;
    if (matchedKeys.has(it.key) || queueKeys.has(it.key)) continue;
    // Stessa serie in due fonti: una riga sola (titolo + anno).
    const dk = `${normTitle(it.title)}|${it.year || ''}`;
    if (seenMissing.has(dk)) { const prev = missing.find((x) => x.dk === dk); prev.sources.push(it.source); continue; }
    seenMissing.add(dk);
    missing.push({ dk, key: it.key, title: it.title, year: it.year, source: it.source, sources: [it.source], status: it.status, tags: it.tags || [], lists: it.lists || [], ids: it.ids || {} });
  }
  const nowAvailable = [...nowAvail.values()].filter((m) => Date.now() - m.nowAvailableAt < 30 * DAY).map((m) => ({ itemKey: m.itemKey, ck: m.ck, at: m.nowAvailableAt }));

  return { views, missing, nowAvailable };
}
