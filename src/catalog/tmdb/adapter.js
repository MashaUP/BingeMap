// Secondo catalogo, legale (F13): serie disponibili sui fornitori scelti, dai dati TMDB (fonte JustWatch).
// Non serve una scansione di siti: si interroga l'API TMDB con la chiave dell'utente.
import { toYear } from '../../common/util.js';

export const SOURCE = 'tmdbp';
export const LABEL = 'Fornitori legali (TMDB · JustWatch)';

export function normalizeDiscover(r, genreMap, providerName) {
  return {
    ck: `tmdbp:${r.id}`, source: SOURCE, siteId: r.id, slug: null,
    name: r.name, originalName: r.original_name || null, altTitles: [], type: 'tv',
    year: toYear(r.first_air_date), score: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null,
    subIta: false, lastAirDate: null, seasonsCount: null,
    genres: (r.genre_ids || []).map((id) => genreMap.get(id)).filter(Boolean),
    plot: r.overview || null, duration: null, tmdbId: r.id, imdbId: null,
    poster: r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : null,
    url: `https://www.themoviedb.org/tv/${r.id}/watch?locale=IT`,
    recommendations: [], trailerUrl: null, providers: providerName ? [providerName] : [],
    popularity: r.popularity ?? null,
  };
}
