// Anime (funzione 8): import da AniList (profilo pubblico, interfaccia GraphQL gratuita) e da MyAnimeList (file XML
// dell'esportazione, anche .xml.gz), più gli anime della stagione in corso con il prossimo episodio.
import { finalizeRow, mergeRowsPublic } from './sources.js';

export const ANILIST_API = 'https://graphql.anilist.co';

const LIST_QUERY = `query ($user: String) {
  MediaListCollection(userName: $user, type: ANIME) {
    lists { name isCustomList entries {
      status progress repeat updatedAt score(format: POINT_10_DECIMAL)
      media { id idMal format episodes seasonYear synonyms title { romaji english native } nextAiringEpisode { airingAt episode } }
    } }
  }
}`;

const SEASON_QUERY = `query ($season: MediaSeason, $year: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
      id idMal format episodes averageScore genres siteUrl synonyms
      title { romaji english native } coverImage { large } nextAiringEpisode { airingAt episode }
    }
  }
}`;

async function gql(query, variables, fetchFn = globalThis.fetch) {
  const r = await fetchFn(ANILIST_API, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (r.status === 404) throw new Error('Profilo AniList non trovato o privato');
  if (r.status === 429) throw new Error('AniList: troppe richieste, riprova tra un minuto');
  if (!r.ok) throw new Error(`AniList HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors?.length) throw new Error('AniList: ' + j.errors.map((e) => e.message).join('; '));
  return j.data;
}

const AL_STATUS = { CURRENT: 'watching', REPEATING: 'watching', PLANNING: 'plan', COMPLETED: 'completed', DROPPED: 'dropped', PAUSED: 'hold' };
const TV_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA', 'OVA', 'SPECIAL']);

export function titlesOf(t = {}, synonyms = []) {
  const main = t.english || t.romaji || t.native;
  return { title: main, altTitles: [...new Set([t.romaji, t.english, t.native, ...(synonyms || [])].filter((x) => x && x !== main))] };
}

export function rowsFromAniList(data) {
  const rows = []; let movies = 0;
  for (const list of data?.MediaListCollection?.lists || []) {
    for (const e of list.entries || []) {
      const m = e.media || {};
      if (m.format === 'MOVIE' || (m.format && !TV_FORMATS.has(m.format))) { movies++; continue; }
      const { title, altTitles } = titlesOf(m.title, m.synonyms);
      rows.push(finalizeRow('anilist', {
        title, altTitles, year: m.seasonYear ?? null, mediaType: 'tv', ids: { anilist: m.id, mal: m.idMal },
        rawStatus: e.status, status: AL_STATUS[e.status] || 'unknown', rating: e.score ? Number(e.score) : null,
        episodesWatched: e.progress ?? null, lastActivity: e.updatedAt ? e.updatedAt * 1000 : null,
        lists: list.isCustomList ? [list.name] : [], tags: [],
        raw: { anilistId: m.id, malId: m.idMal, episodes: m.episodes, next: m.nextAiringEpisode || null },
      }));
    }
  }
  return { rows: mergeRowsPublic(rows), skippedMovies: movies, notes: [] };
}

export async function fetchAniList(user, fetchFn) {
  const name = String(user || '').trim().replace(/^https?:\/\/anilist\.co\/user\//i, '').replace(/\/.*$/, '');
  if (!name) throw new Error('Scrivi il nome del profilo AniList');
  return rowsFromAniList(await gql(LIST_QUERY, { user: name }, fetchFn));
}

// --- MyAnimeList: file XML dell'esportazione (Profilo › Impostazioni › Export).
const MAL_STATUS = { watching: 'watching', completed: 'completed', 'on-hold': 'hold', dropped: 'dropped', 'plan to watch': 'plan', 1: 'watching', 2: 'completed', 3: 'hold', 4: 'dropped', 6: 'plan' };
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${name}>`));
  if (!m) return null;
  const v = (m[1] ?? m[2] ?? '').trim();
  return v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'");
};

export function parseMalXml(xml) {
  const rows = []; let movies = 0;
  for (const m of String(xml).matchAll(/<anime>([\s\S]*?)<\/anime>/g)) {
    const b = m[1];
    const type = (tag(b, 'series_type') || '').toLowerCase();
    if (type === 'movie') { movies++; continue; }
    const st = (tag(b, 'my_status') || '').toLowerCase();
    const finish = tag(b, 'my_finish_date');
    const score = Number(tag(b, 'my_score')) || null;
    rows.push(finalizeRow('mal', {
      title: tag(b, 'series_title'), mediaType: 'tv', ids: { mal: Number(tag(b, 'series_animedb_id')) || null },
      rawStatus: tag(b, 'my_status'), status: MAL_STATUS[st] || 'unknown', rating: score,
      episodesWatched: Number(tag(b, 'my_watched_episodes')) || null,
      lastActivity: finish && !finish.startsWith('0000') ? Date.parse(finish) || null : null, tags: (tag(b, 'my_tags') || '').split(',').map((x) => x.trim()).filter(Boolean), lists: [],
      raw: { malId: Number(tag(b, 'series_animedb_id')) || null, episodes: Number(tag(b, 'series_episodes')) || null },
    }));
  }
  return { rows: mergeRowsPublic(rows), skippedMovies: movies, notes: rows.length ? [] : ['Nessun anime trovato: serve il file XML dell\'esportazione di MyAnimeList'] };
}

export async function readMalFile(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0x1f && b[1] === 0x8b) {
    const ds = new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));
    return parseMalXml(await new Response(ds).text());
  }
  return parseMalXml(new TextDecoder().decode(b));
}

// --- Anime della stagione in corso.
export function seasonOf(date = new Date()) {
  const m = date.getMonth();
  return { season: m < 3 ? 'WINTER' : m < 6 ? 'SPRING' : m < 9 ? 'SUMMER' : 'FALL', year: date.getFullYear() };
}
export const SEASON_IT = { WINTER: 'Inverno', SPRING: 'Primavera', SUMMER: 'Estate', FALL: 'Autunno' };

export async function fetchSeason({ season, year } = seasonOf(), { pages = 2, fetchFn } = {}) {
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const d = await gql(SEASON_QUERY, { season, year, page }, fetchFn);
    for (const m of d.Page?.media || []) {
      if (m.format === 'MOVIE') continue;
      const { title, altTitles } = titlesOf(m.title, m.synonyms);
      out.push({ anilistId: m.id, malId: m.idMal, title, altTitles, episodes: m.episodes, score: m.averageScore != null ? m.averageScore / 10 : null,
        genres: m.genres || [], cover: m.coverImage?.large || null, url: m.siteUrl || null,
        next: m.nextAiringEpisode ? { at: m.nextAiringEpisode.airingAt * 1000, episode: m.nextAiringEpisode.episode } : null });
    }
    if (!d.Page?.pageInfo?.hasNextPage) break;
  }
  return out;
}
