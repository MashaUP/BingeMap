// Client TMDB (facoltativo, chiave personale dell'utente). Attribuzione TMDB in «Informazioni».
// I dati su dove guardare vengono da JustWatch e vanno attribuiti a JustWatch.
import { sleep, toYear } from '../common/util.js';

const BASE = 'https://api.themoviedb.org/3';
let lastCall = 0;
const GAP = 260; // ~4 richieste al secondo, ben sotto i limiti

export class TmdbError extends Error {}

export async function tmdbFetch(path, key, params = {}, fetchFn = globalThis.fetch) {
  if (!key) throw new TmdbError('Chiave TMDB mancante');
  const wait = lastCall + GAP - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  const headers = { accept: 'application/json' };
  if (/^eyJ/.test(key)) headers.authorization = `Bearer ${key}`; else u.searchParams.set('api_key', key);
  const r = await fetchFn(u.href, { headers });
  if (r.status === 401) throw new TmdbError('Chiave TMDB non valida');
  if (r.status === 404) return null;
  if (r.status === 429) { await sleep(2000); return tmdbFetch(path, key, params, fetchFn); }
  if (!r.ok) throw new TmdbError(`TMDB HTTP ${r.status}`);
  return r.json();
}

export function mapTv(d, prev = null) {
  if (!d) return null;
  const runtimes = d.episode_run_time?.length ? d.episode_run_time : [d.last_episode_to_air?.runtime].filter(Boolean);
  const epRuntime = runtimes.length ? Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length) : null;
  const vid = (d.videos?.results || []).find((v) => v.site === 'YouTube' && /trailer|teaser/i.test(v.type));
  const now = Date.now();
  const statusHistory = [...(prev?.statusHistory || [])];
  if (!prev || prev.status !== d.status) statusHistory.push({ date: now, status: d.status });
  const endedAt = d.status === 'Ended' && prev && prev.status && prev.status !== 'Ended' ? now : prev?.endedAt || null;
  return {
    tmdbId: d.id, name: d.name, originalName: d.original_name || null, overview: d.overview || null,
    year: toYear(d.first_air_date), genres: (d.genres || []).map((g) => g.name),
    countries: d.origin_country || [], originalLanguage: d.original_language || null,
    status: d.status || null, seasons: d.number_of_seasons ?? null, episodes: d.number_of_episodes ?? null, epRuntime,
    altTitles: [...new Set([...(d.alternative_titles?.results || []).map((a) => a.title), d.original_name].filter(Boolean))].slice(0, 20),
    tvdbId: d.external_ids?.tvdb_id || null, imdbId: d.external_ids?.imdb_id || null,
    popularity: d.popularity ?? null, voteAverage: d.vote_average ?? null, posterPath: d.poster_path || null,
    recommendations: (d.recommendations?.results || []).slice(0, 20).map((r) => r.id),
    trailer: vid ? `https://www.youtube.com/watch?v=${vid.key}` : null,
    cast: (d.credits?.cast || []).slice(0, 8).map((c) => c.name),
    creators: (d.created_by || []).map((c) => c.name),
    statusHistory: statusHistory.slice(-10), endedAt, updatedAt: now,
  };
}

export async function getTv(id, key, prev = null, fetchFn) {
  const d = await tmdbFetch(`/tv/${id}`, key, { language: 'it-IT', append_to_response: 'external_ids,alternative_titles,recommendations,videos,credits', include_video_language: 'it,en' }, fetchFn);
  return mapTv(d, prev);
}

export async function findByImdb(imdbId, key, fetchFn) {
  const d = await tmdbFetch(`/find/${imdbId}`, key, { external_source: 'imdb_id' }, fetchFn);
  return d?.tv_results?.[0]?.id || null;
}

export async function testKey(key, fetchFn) {
  const d = await tmdbFetch('/configuration', key, {}, fetchFn);
  return !!d;
}

export async function tvGenres(key, fetchFn) {
  const d = await tmdbFetch('/genre/tv/list', key, { language: 'it-IT' }, fetchFn);
  return new Map((d?.genres || []).map((g) => [g.id, g.name]));
}

export async function providers(key, region = 'IT', fetchFn) {
  const d = await tmdbFetch('/watch/providers/tv', key, { watch_region: region, language: 'it-IT' }, fetchFn);
  return (d?.results || []).map((p) => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path, priority: p.display_priorities?.[region] ?? p.display_priority ?? 99 }))
    .sort((a, b) => a.priority - b.priority);
}

export async function discoverPage(key, { region, providerId, page }, fetchFn) {
  return tmdbFetch('/discover/tv', key, {
    language: 'it-IT', watch_region: region, with_watch_providers: providerId,
    with_watch_monetization_types: 'flatrate|free|ads', sort_by: 'popularity.desc', page,
  }, fetchFn);
}
