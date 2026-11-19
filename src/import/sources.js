// Lettori delle fonti di import. Ognuno produce righe normalizzate:
// {rowKey, source, title, originalTitle, year, ids, mediaType, status, rawStatus, rating, tags, lists,
//  seasonsWatched, episodesWatched, lastActivity, raw}
import { parseCsv } from './csv.js';
import { readZip } from './zip.js';
import { parseXlsx } from './xlsx.js';
import { mapStatus } from '../library/status.js';
import { normTitle, normImdb, normId, parseTitle } from '../match/normalize.js';
import { hash, toNumber, toYear, toDate, splitList, uniq } from '../common/util.js';

export const SOURCES = {
  csv: 'CSV', json: 'JSON', xlsx: 'Excel', imdb: 'IMDb', trakt: 'Trakt', refract: 'Refract', simkl: 'SIMKL',
  tvtime: 'TV Time', showly: 'Showly', seriesguide: 'SeriesGuide', sofa: 'Sofa Time', manual: 'Lista manuale',
};

const SYN = {
  title: ['title', 'name', 'titolo', 'show', 'series', 'serie', 'showtitle', 'seriesname', 'seriestitle', 'primarytitle', 'nome', 'showname'],
  originalTitle: ['originaltitle', 'originalname', 'titolooriginale', 'original'],
  year: ['year', 'anno', 'releaseyear', 'firstairyear', 'startyear', 'firstairdate', 'releasedate', 'released', 'premiered'],
  tmdb: ['tmdb', 'tmdbid', 'themoviedb', 'themoviedbid', 'idtmdb'],
  imdb: ['imdb', 'imdbid', 'const', 'tconst', 'idimdb'],
  tvdb: ['tvdb', 'tvdbid', 'thetvdb', 'idtvdb'],
  status: ['status', 'stato', 'watchstatus', 'state', 'liststatus', 'progress', 'userstatus', 'trackingstatus'],
  rating: ['rating', 'yourrating', 'voto', 'myrating', 'userrating', 'personalrating', 'stars', 'score'],
  tags: ['tags', 'tag', 'moodtags', 'moods', 'mood', 'labels', 'etichette', 'genresuser', 'customtags'],
  lists: ['list', 'lists', 'lista', 'liste', 'collection', 'collections', 'shelf', 'section', 'folder'],
  type: ['type', 'titletype', 'mediatype', 'kind', 'category', 'tipo', 'media'],
  date: ['date', 'watchedat', 'lastwatched', 'lastwatchedat', 'updated', 'updatedat', 'daterated', 'modified', 'lastactivity', 'watcheddate', 'dateadded', 'created', 'createdat', 'addedat'],
  episodesWatched: ['episodeswatched', 'watchedepisodes', 'episodivisti', 'watchedepisodescount', 'plays'],
  seasonsWatched: ['seasonswatched', 'watchedseasons', 'stagioniviste'],
};

const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

export function suggestMapping(headers) {
  const map = {};
  const used = new Set();
  for (const [field, words] of Object.entries(SYN)) {
    const h = headers.find((x) => !used.has(x) && words.includes(key(x)));
    if (h) { map[field] = h; used.add(h); }
  }
  return map;
}

export function mediaTypeOf(v) {
  if (v == null || v === '') return 'unknown';
  const s = String(v).toLowerCase();
  if (/movie|film|feature|video$|short/.test(s) && !/tv ?movie/.test(s)) return 'movie';
  if (/tv ?movie|tv special|episode/.test(s)) return 'movie';
  if (/tv|series|serie|show|anime|mini|season/.test(s)) return 'tv';
  return 'unknown';
}

function normRating(v, scale) {
  const n = toNumber(v);
  if (n == null || n <= 0) return null;
  if (scale === 100 || n > 10) return Math.round(n) / 10;
  if (scale === 5) return Math.round(n * 20) / 10;
  return Math.round(n * 10) / 10;
}

function detectScale(values) {
  const nums = values.map(toNumber).filter((n) => n != null && n > 0);
  if (!nums.length) return 10;
  const max = Math.max(...nums);
  if (max > 10) return 100;
  if (max <= 5 && nums.some((n) => n % 1 !== 0)) return 5;
  return 10;
}

export function makeRowKey(source, r) {
  if (r.ids?.tmdb) return `tmdb:${r.ids.tmdb}`;
  if (r.ids?.imdb) return `imdb:${r.ids.imdb}`;
  if (r.ids?.tvdb) return `tvdb:${r.ids.tvdb}`;
  if (r.ids?.simkl) return `simkl:${r.ids.simkl}`;
  if (r.ids?.trakt) return `trakt:${r.ids.trakt}`;
  return `t:${hash(`${normTitle(r.title)}|${r.year ?? ''}`)}`;
}

const RANK = { completed: 6, watching: 5, hold: 4, dropped: 3, plan: 2, unknown: 1, none: 0 };

// Unisce righe con la stessa chiave (stessa serie in più file della stessa fonte).
export function mergeRows(rows) {
  const m = new Map();
  for (const r of rows) {
    const prev = m.get(r.rowKey);
    if (!prev) { m.set(r.rowKey, r); continue; }
    if (RANK[r.status] > RANK[prev.status]) { prev.status = r.status; prev.rawStatus = r.rawStatus; }
    prev.rating = prev.rating ?? r.rating;
    prev.tags = uniq([...prev.tags, ...r.tags]);
    prev.lists = uniq([...prev.lists, ...r.lists]);
    prev.year = prev.year ?? r.year;
    prev.originalTitle = prev.originalTitle || r.originalTitle;
    prev.ids = { ...r.ids, ...prev.ids };
    prev.seasonsWatched = Math.max(prev.seasonsWatched ?? 0, r.seasonsWatched ?? 0) || prev.seasonsWatched;
    prev.episodesWatched = Math.max(prev.episodesWatched ?? 0, r.episodesWatched ?? 0) || prev.episodesWatched;
    prev.lastActivity = Math.max(prev.lastActivity ?? 0, r.lastActivity ?? 0) || null;
    if (prev.mediaType === 'unknown') prev.mediaType = r.mediaType;
  }
  return [...m.values()];
}

function finalize(source, r) {
  const pt = parseTitle(r.title);
  const out = {
    source,
    title: String(r.title || '').replace(/\s*[([]\s*(18|19|20|21)\d{2}\s*[)\]]\s*$/, '').trim(),
    originalTitle: r.originalTitle || null,
    altTitles: r.altTitles || [],
    year: r.year ?? pt.year ?? null,
    ids: { tmdb: normId(r.ids?.tmdb), imdb: normImdb(r.ids?.imdb), tvdb: normId(r.ids?.tvdb), simkl: normId(r.ids?.simkl), trakt: normId(r.ids?.trakt) },
    mediaType: r.mediaType || 'unknown',
    rawStatus: r.rawStatus ?? null,
    status: r.status || mapStatus(r.rawStatus),
    rating: r.rating ?? null,
    tags: uniq(r.tags || []),
    lists: uniq(r.lists || []),
    seasonsWatched: r.seasonsWatched ?? null,
    episodesWatched: r.episodesWatched ?? null,
    lastActivity: r.lastActivity ?? null,
    raw: r.raw ?? null,
  };
  for (const k of Object.keys(out.ids)) if (out.ids[k] == null) delete out.ids[k];
  out.rowKey = makeRowKey(source, out);
  return out;
}

// --- CSV / Excel / JSON generico con mappatura
export function rowsFromRecords(records, mapping, source, opts = {}) {
  const get = (rec, f) => (mapping[f] ? rec[mapping[f]] : undefined);
  const scale = opts.scale || detectScale(records.map((r) => get(r, 'rating')));
  const rows = [];
  for (const rec of records) {
    const title = get(rec, 'title');
    if (!title || !String(title).trim()) continue;
    const typeVal = get(rec, 'type');
    rows.push(finalize(source, {
      title: String(title).trim(),
      originalTitle: get(rec, 'originalTitle') || null,
      year: toYear(get(rec, 'year')),
      ids: { tmdb: get(rec, 'tmdb'), imdb: get(rec, 'imdb'), tvdb: get(rec, 'tvdb') },
      mediaType: typeVal != null ? mediaTypeOf(typeVal) : (opts.defaultType || 'unknown'),
      rawStatus: get(rec, 'status') ?? opts.defaultStatus ?? null,
      status: get(rec, 'status') != null && String(get(rec, 'status')).trim() !== '' ? mapStatus(get(rec, 'status')) : (opts.defaultStatus ? mapStatus(opts.defaultStatus) : 'unknown'),
      rating: normRating(get(rec, 'rating'), scale),
      tags: splitList(get(rec, 'tags')),
      lists: [...splitList(get(rec, 'lists')), ...(opts.listName ? [opts.listName] : [])],
      episodesWatched: toNumber(get(rec, 'episodesWatched')),
      seasonsWatched: toNumber(get(rec, 'seasonsWatched')),
      lastActivity: toDate(get(rec, 'date')),
      raw: rec,
    }));
  }
  return mergeRows(rows);
}

export function readCsvText(text) { return parseCsv(text); }

// --- IMDb: watchlist, voti, liste (CSV ufficiale)
export function parseImdb(text, fileName = '') {
  const { headers, records } = parseCsv(text);
  const hk = headers.map(key);
  const isRatings = hk.includes('yourrating') && !hk.includes('position');
  const isWatchlist = /watchlist/i.test(fileName) || (!isRatings && hk.includes('position') && !/list/i.test(fileName.replace(/watchlist/i, '')));
  const listName = !isRatings && !isWatchlist ? fileName.replace(/\.csv$/i, '') : null;
  const mapping = suggestMapping(headers);
  mapping.imdb = headers.find((h) => key(h) === 'const') || mapping.imdb;
  mapping.type = headers.find((h) => key(h) === 'titletype') || mapping.type;
  mapping.rating = headers.find((h) => key(h) === 'yourrating');
  mapping.date = headers.find((h) => ['daterated', 'modified', 'created'].includes(key(h)));
  delete mapping.status;
  const rows = rowsFromRecords(records, mapping, 'imdb', {
    scale: 10,
    defaultStatus: isWatchlist ? 'plan' : null,
    listName: isWatchlist ? 'Watchlist' : listName,
  });
  return { rows: rows.filter((r) => r.mediaType !== 'movie'), skippedMovies: rows.filter((r) => r.mediaType === 'movie').length, kind: isRatings ? 'ratings' : isWatchlist ? 'watchlist' : 'list' };
}

// --- Estrattore "intelligente" per JSON di altre app (Trakt, Refract, TV Time, Showly, SeriesGuide)
function flat(obj, prefix = '', out = {}, depth = 0) {
  if (obj == null || typeof obj !== 'object' || depth > 3) return out;
  for (const [k, v] of Object.entries(obj)) {
    const kk = key(k);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (['ids', 'externalids', 'external'].includes(kk)) { for (const [ik, iv] of Object.entries(v)) out[key(ik)] = out[key(ik)] ?? iv; }
      else flat(v, prefix + kk + '.', out, depth + 1);
    } else if (out[kk] === undefined || prefix === '') out[kk] = v;
    out[prefix + kk] = v;
  }
  return out;
}

function pick(f, names) {
  for (const n of names) if (f[n] != null && f[n] !== '') return f[n];
  return undefined;
}

function countEpisodes(rec) {
  const seasons = rec.seasons || rec.show?.seasons || rec.watched_seasons;
  if (!Array.isArray(seasons)) return null;
  let eps = 0; let full = 0;
  for (const s of seasons) {
    const list = s.episodes || [];
    const watched = list.filter((e) => e.watched === true || e.watched === 1 || (e.plays ?? 0) > 0 || e.watched_at || e.watchedAt).length;
    eps += watched;
    if (list.length && watched === list.length && (s.number ?? s.season ?? 1) > 0) full++;
  }
  return { episodes: eps, seasons: full };
}

export function smartExtract(rec, source, ctx = {}) {
  const base = rec.show || rec.series || rec.item || rec.media || rec.title_info || rec;
  const f = { ...flat(base), ...flat(rec) };
  const title = pick(f, ['title', 'name', 'showtitle', 'seriesname', 'showname', 'show.title', 'series.title', 'originalname', 'titolo']);
  if (!title || typeof title !== 'string') return null;
  const typeV = pick(f, ['type', 'mediatype', 'kind', 'category', 'contenttype']);
  const ep = countEpisodes(rec);
  const rawStatus = pick(f, ['status', 'watchstatus', 'liststatus', 'state', 'userstatus', 'trackingstatus']) ?? ctx.defaultStatus ?? null;
  let status = mapStatus(rawStatus);
  if (status === 'unknown' && ep && ep.episodes > 0) status = 'watching';
  if (status === 'unknown' && ctx.defaultStatus) status = mapStatus(ctx.defaultStatus);
  const tagsV = pick(f, ['tags', 'moodtags', 'moods', 'mood', 'labels', 'customtags']);
  return finalize(source, {
    title,
    originalTitle: pick(f, ['originaltitle', 'originalname']) || null,
    year: toYear(pick(f, ['year', 'releaseyear', 'firstaired', 'firstairdate', 'releasedate', 'released', 'show.year'])),
    ids: { tmdb: pick(f, ['tmdb', 'tmdbid', 'themoviedb']), imdb: pick(f, ['imdb', 'imdbid']), tvdb: pick(f, ['tvdb', 'tvdbid']), simkl: pick(f, ['simkl', 'simklid']), trakt: pick(f, ['trakt', 'traktid']) },
    mediaType: ctx.mediaType || (typeV != null ? mediaTypeOf(typeV) : (rec.show || rec.seasons ? 'tv' : 'unknown')),
    rawStatus, status,
    rating: normRating(pick(f, ['rating', 'userrating', 'myrating', 'yourrating', 'personalrating', 'score']), ctx.scale || 10),
    tags: splitList(tagsV),
    lists: [...splitList(pick(f, ['list', 'lists', 'listname', 'collection'])), ...(ctx.listName ? [ctx.listName] : [])],
    episodesWatched: ep ? ep.episodes : toNumber(pick(f, ['episodeswatched', 'watchedepisodes', 'watchedepisodescount', 'plays'])),
    seasonsWatched: ep ? ep.seasons : toNumber(pick(f, ['seasonswatched'])),
    lastActivity: toDate(pick(f, ['lastwatchedat', 'watchedat', 'lastactivity', 'updatedat', 'updated', 'listedat', 'ratedat', 'date', 'createdat'])),
    raw: ctx.keepRaw === false ? null : rec,
  });
}

function arraysIn(json) {
  if (Array.isArray(json)) return [json];
  if (json && typeof json === 'object') {
    const out = [];
    for (const v of Object.values(json)) if (Array.isArray(v) && v.length && typeof v[0] === 'object') out.push(v);
    return out;
  }
  return [];
}

function ctxFromFileName(name) {
  const n = name.toLowerCase();
  const ctx = {};
  if (/watchlist|plan|to[-_ ]?watch|towatch|wishlist/.test(n)) ctx.defaultStatus = 'plan';
  if (/dropped|abbandon/.test(n)) ctx.defaultStatus = 'dropped';
  if (/hold|pausa/.test(n)) ctx.defaultStatus = 'hold';
  if (/completed|finished/.test(n)) ctx.defaultStatus = 'completed';
  if (/movie|film/.test(n) && !/show|tv|series/.test(n)) ctx.mediaType = 'movie';
  if (/show|series|tv|episode/.test(n)) ctx.mediaType = 'tv';
  const lm = n.match(/lists?[-_/]([^/]+?)\.(json|csv)$/);
  if (lm && !/watchlist/.test(lm[1])) ctx.listName = lm[1].replace(/[-_]/g, ' ');
  return ctx;
}

// File multipli (contenuto di uno ZIP o più file scelti insieme).
export async function parseFiles(files, source) {
  const rows = []; const notes = [];
  for (const f of files) {
    const name = f.name || '';
    if (/__macosx|\.ds_store/i.test(name)) continue;
    const ctx = ctxFromFileName(name);
    if (source === 'trakt') {
      if (/ratings[-_]episodes|ratings[-_]seasons|history|comments|likes|network|user|hidden[-_](calendar|recommendations)|collection[-_]movies|watched[-_]movies|ratings[-_]movies/i.test(name)) continue;
      if (/watched[-_]shows/i.test(name)) ctx.watched = true;
      if (/hidden[-_]dropped|dropped/i.test(name)) ctx.defaultStatus = 'dropped';
    }
    try {
      if (/\.json$/i.test(name)) {
        const json = JSON.parse(await f.text());
        for (const arr of arraysIn(json)) {
          for (const rec of arr) {
            const r = smartExtract(rec, source, ctx);
            if (r) {
              if (source === 'trakt' && ctx.watched && r.status === 'unknown') r.status = 'watching';
              rows.push(r);
            }
          }
        }
      } else if (/\.csv$/i.test(name)) {
        const { headers, records } = parseCsv(await f.text());
        if (source === 'imdb' || headers.map(key).includes('const')) { rows.push(...parseImdb(await f.text(), name).rows); continue; }
        const mapping = suggestMapping(headers);
        if (!mapping.title) { notes.push(`${name}: nessuna colonna titolo`); continue; }
        rows.push(...rowsFromRecords(records, mapping, source, { defaultStatus: ctx.defaultStatus, listName: ctx.listName, defaultType: ctx.mediaType }));
      } else if (/\.xlsx$/i.test(name)) {
        const { headers, records } = await parseXlsx(await f.bytes());
        rows.push(...rowsFromRecords(records, suggestMapping(headers), source, {}));
      }
    } catch (e) {
      notes.push(`${name}: ${e.message}`);
    }
  }
  const merged = mergeRows(rows);
  return { rows: merged.filter((r) => r.mediaType !== 'movie'), skippedMovies: merged.filter((r) => r.mediaType === 'movie').length, notes };
}

export async function parseZip(buffer, source) {
  const files = await readZip(buffer);
  return parseFiles(files, source);
}

// Lista manuale (F37): un titolo per riga, anno facoltativo tra parentesi.
export function parseManual(text, status = 'plan') {
  const rows = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const pt = parseTitle(line);
    return finalize('manual', { title: line, year: pt.year, mediaType: 'tv', status, rawStatus: status });
  });
  return { rows: mergeRows(rows), skippedMovies: 0, notes: [] };
}

// SIMKL: risposta di /sync/all-items.
export function fromSimkl(json) {
  const rows = [];
  for (const group of ['shows', 'anime']) {
    for (const it of json?.[group] || []) {
      const show = it.show || it.anime || {};
      const ids = show.ids || {};
      rows.push(finalize('simkl', {
        title: show.title, year: toYear(show.year), ids: { tmdb: ids.tmdb, imdb: ids.imdb, tvdb: ids.tvdb, simkl: ids.simkl },
        mediaType: 'tv', rawStatus: it.status, status: mapStatus(it.status), rating: normRating(it.user_rating, 10),
        episodesWatched: toNumber(it.watched_episodes_count), lastActivity: toDate(it.last_watched_at || it.added_to_watchlist_at),
        tags: group === 'anime' ? ['Anime'] : [], lists: [], raw: { status: it.status, user_rating: it.user_rating, title: show.title, ids },
      }));
    }
  }
  return { rows: mergeRows(rows), skippedMovies: (json?.movies || []).length, notes: [] };
}

export { parseCsv, parseXlsx, readZip };
