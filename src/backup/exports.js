// Esporta verso altre app (funzione 17): così non resti legato a BingeMap.
//  - CSV in formato IMDb (voti e watchlist): lo importano Trakt, SIMKL e altre app che accettano le liste IMDb.
//  - CSV completo con ID TMDB/IMDb, stato, voto, progresso, tag e liste (per qualsiasi foglio o app con mappatura colonne).
//  - XML in formato MyAnimeList per gli anime (lo importano MyAnimeList, AniList, Kitsu).
import { toCsv } from '../import/csv.js';
import { STATUS_LABEL } from '../library/status.js';

// I file IMDb originali non hanno il BOM: alcune app che li importano leggerebbero male la prima colonna.
const noBom = (s) => s.replace(/^\uFEFF/, '');
const ymd = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '');

// IMDb «ratings.csv»: Const, Your Rating, Date Rated, Title, URL, Title Type, Year. Solo serie con ID IMDb.
export function imdbRatingsCsv(views) {
  const rows = views.filter((v) => v.imdbId && (v.rating != null || v.status === 'completed')).map((v) => ({
    Const: v.imdbId, 'Your Rating': v.rating != null ? Math.max(1, Math.min(10, Math.round(v.rating))) : '', 'Date Rated': ymd(v.lastActivity || Date.now()),
    Title: v.name, URL: `https://www.imdb.com/title/${v.imdbId}/`, 'Title Type': 'TV Series', Year: v.year ?? '',
  }));
  return noBom(toCsv(rows, ['Const', 'Your Rating', 'Date Rated', 'Title', 'URL', 'Title Type', 'Year']));
}

// IMDb «watchlist.csv»: le serie da vedere.
export function imdbWatchlistCsv(views) {
  const rows = views.filter((v) => v.imdbId && v.status === 'plan').map((v, i) => ({
    Position: i + 1, Const: v.imdbId, Created: ymd(Date.now()), Title: v.name, URL: `https://www.imdb.com/title/${v.imdbId}/`, 'Title Type': 'TV Series', Year: v.year ?? '',
  }));
  return noBom(toCsv(rows, ['Position', 'Const', 'Created', 'Title', 'URL', 'Title Type', 'Year']));
}

export function fullCsv(views) {
  const rows = views.filter((v) => v.status !== 'none' || v.rating != null || v.userTags.length).map((v) => ({
    title: v.name, original_title: v.originalName || '', year: v.year ?? '', tmdb_id: v.tmdbId ?? '', imdb_id: v.imdbId || '',
    status: v.status, status_it: STATUS_LABEL[v.status], rating: v.rating ?? '',
    progress: v.progress?.pos ? `S${v.progress.pos.s}E${v.progress.pos.e}` : '', episodes_watched: v.progress?.seen ?? '',
    tags: [...Object.values(v.impTags).flat(), ...v.userTags].join(', '), lists: v.lists.map((l) => l.split(':').slice(1).join(':')).join(', '),
    notes: v.note || '', last_activity: ymd(v.lastActivity),
  }));
  return toCsv(rows, ['title', 'original_title', 'year', 'tmdb_id', 'imdb_id', 'status', 'status_it', 'rating', 'progress', 'episodes_watched', 'tags', 'lists', 'notes', 'last_activity']);
}

const MAL_OUT = { watching: 'Watching', completed: 'Completed', hold: 'On-Hold', dropped: 'Dropped', plan: 'Plan to Watch' };

// entries: [{ malId, title, status, rating, episodes, episodesWatched }]
export function malXml(entries) {
  const list = entries.filter((e) => e.malId && MAL_OUT[e.status]);
  const body = list.map((e) => `  <anime>
    <series_animedb_id>${Number(e.malId)}</series_animedb_id>
    <series_title><![CDATA[${String(e.title || '').replace(/]]>/g, ']]]]><![CDATA[>')}]]></series_title>
    <series_type>TV</series_type>
    <series_episodes>${Number(e.episodes) || 0}</series_episodes>
    <my_watched_episodes>${Number(e.episodesWatched) || (e.status === 'completed' ? Number(e.episodes) || 0 : 0)}</my_watched_episodes>
    <my_score>${e.rating != null ? Math.max(0, Math.min(10, Math.round(e.rating))) : 0}</my_score>
    <my_status>${MAL_OUT[e.status]}</my_status>
    <update_on_import>1</update_on_import>
  </anime>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo>
    <user_export_type>1</user_export_type>
    <user_total_anime>${list.length}</user_total_anime>
  </myinfo>
${body}
</myanimelist>
`;
}

// Dalle righe della libreria (con ID MyAnimeList) e dalle viste (stato e voto attuali in BingeMap).
export function malEntries(items, viewByItemKey) {
  return items.filter((it) => it.ids?.mal).map((it) => {
    const v = viewByItemKey.get(it.key);
    return { malId: it.ids.mal, title: v?.name || it.title, status: v?.status || it.status, rating: v?.rating ?? it.rating, episodes: it.raw?.episodes ?? v?.episodes ?? null, episodesWatched: v?.progress?.seen ?? it.episodesWatched };
  });
}
