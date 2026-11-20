// Adattatore del catalogo Streaming Community.
// ATTENZIONE: il sito non ha un'API pubblica e cambia spesso. Questo adattatore legge i dati che le
// pagine del sito già caricano (JSON incorporato in stile Inertia: attributo data-page) e, se disponibile,
// l'elenco JSON dell'archivio. Struttura e percorsi sono impostabili in Impostazioni › Avanzate,
// così un cambiamento del sito si corregge senza nuovo codice. Vedi docs/SITE_NOTES.md.
import { toNumber, toYear } from '../../common/util.js';

export const SOURCE = 'sc';
export const LABEL = 'Streaming Community';

const ENT = { '&quot;': '"', '&#34;': '"', '&#039;': "'", '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' };
export function unescapeHtml(s) {
  return s.replace(/&(quot|#34|#039|#39|apos|lt|gt|amp);/g, (m) => ENT[m]).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// Estrae l'oggetto pagina JSON incorporato nell'HTML.
export function extractPageData(html) {
  if (!html) return null;
  const m = html.match(/data-page\s*=\s*"([^"]*)"/) || html.match(/data-page\s*=\s*'([^']*)'/);
  if (m) { try { return JSON.parse(unescapeHtml(m[1])); } catch { /* formato inatteso */ } }
  const s = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
  if (s) { try { return JSON.parse(s[1]); } catch { /* ignora */ } }
  return null;
}

const isTitleLike = (o) => o && typeof o === 'object' && o.id != null && (typeof o.name === 'string' || typeof o.title === 'string') &&
  ('slug' in o || 'seasons_count' in o || 'sub_ita' in o || 'score' in o || 'type' in o);

// Cerca, ovunque nell'oggetto, array di oggetti che sembrano titoli.
export function findTitleArrays(obj, depth = 0, out = []) {
  if (!obj || typeof obj !== 'object' || depth > 6) return out;
  if (Array.isArray(obj)) {
    if (obj.length && obj.filter(isTitleLike).length >= Math.max(1, Math.floor(obj.length * 0.6))) out.push(obj);
    else for (const x of obj) findTitleArrays(x, depth + 1, out);
    return out;
  }
  for (const v of Object.values(obj)) findTitleArrays(v, depth + 1, out);
  return out;
}

export function findSingleTitle(obj) {
  const p = obj?.props || obj;
  if (isTitleLike(p?.title)) return p.title;
  if (isTitleLike(p?.data?.title)) return p.data.title;
  return null;
}

export function findTotal(obj) {
  const p = obj?.props || obj || {};
  for (const k of ['total', 'totalCount', 'total_count', 'titles_count', 'count', 'totalTitles']) {
    const v = p[k] ?? p?.archive?.[k] ?? p?.meta?.[k] ?? p?.pagination?.[k];
    if (Number.isFinite(Number(v)) && Number(v) > 0) return Number(v);
  }
  return null;
}

function typeOf(t) {
  const s = String(t ?? '').toLowerCase();
  if (s === 'tv' || s.includes('series') || s.includes('serie') || s === 'tvseries') return 'tv';
  if (s.includes('movie') || s === 'film') return 'movie';
  return s || 'tv';
}

function imageUrl(raw, origin) {
  const imgs = raw.images || [];
  const pick = imgs.find((i) => /poster/i.test(i.type)) || imgs.find((i) => /cover/i.test(i.type)) || imgs[0];
  if (!pick) return raw.poster || null;
  if (pick.url) return pick.url;
  if (pick.filename && origin) {
    try { const u = new URL(origin); return `${u.protocol}//cdn.${u.hostname.replace(/^www\./, '')}/images/${pick.filename}`; } catch { return null; }
  }
  return null;
}

function genresOf(raw) {
  const g = raw.genres || raw.tags || raw.categories || [];
  return (Array.isArray(g) ? g : String(g).split(',')).map((x) => (typeof x === 'string' ? x : x?.name || x?.title)).filter(Boolean).map((x) => String(x).trim());
}

export function titleUrl(settings, id, slug) {
  const origin = settings.sc.origin;
  const lang = settings.sc.lang ? `/${settings.sc.lang}` : '';
  return `${origin}${lang}${settings.sc.titlePath || '/titles'}/${id}${slug ? '-' + slug : ''}`;
}

function namesOf(v) {
  // Solo elenchi o testo: un numero (es. created_by = ID di chi ha caricato il titolo sul sito) non è un nome.
  if (!v || (!Array.isArray(v) && typeof v !== 'string')) return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  return arr.map((x) => (typeof x === 'string' ? x : x?.name || x?.title || x?.keyword)).filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
}

function seasonsOf(raw) {
  if (!Array.isArray(raw.seasons)) return [];
  return raw.seasons.map((x) => ({ n: toNumber(x.number ?? x.season_number), episodes: toNumber(x.episodes_count ?? x.episode_count), date: x.release_date || null }))
    .filter((x) => x.n != null && x.n > 0).sort((a, b) => a.n - b.n);
}

// ID dei servizi legali presenti nella scheda del sito: indicano dove la serie esiste in modo legale.
export const PROVIDER_FIELDS = { netflix_id: 'Netflix', prime_id: 'Prime Video', disney_id: 'Disney+', now_id: 'NOW', apple_id: 'Apple TV+', paramount_id: 'Paramount+', hbo_id: 'HBO Max' };
function providerIdsOf(raw) {
  const out = [];
  for (const [k, name] of Object.entries(PROVIDER_FIELDS)) if (raw[k] != null && raw[k] !== '' && raw[k] !== 0) out.push(name);
  return out;
}

// Record del catalogo nel formato comune di BingeMap.
export function normalizeTitle(raw, settings) {
  const id = raw.id;
  const rec = {
    ck: `sc:${id}`, source: SOURCE, siteId: id, slug: raw.slug || null,
    name: String(raw.name || raw.title || '').trim(), originalName: raw.original_name || raw.original_title || null,
    altTitles: [], type: typeOf(raw.type),
    year: toYear(raw.year) ?? toYear(raw.release_date) ?? toYear(raw.first_air_date) ?? toYear(raw.last_air_date),
    score: toNumber(raw.score), subIta: raw.sub_ita === true || raw.sub_ita === 1 || raw.sub_ita === '1',
    lastAirDate: raw.last_air_date || null, seasonsCount: toNumber(raw.seasons_count ?? raw.seasons?.length),
    genres: genresOf(raw), plot: raw.plot || raw.description || null,
    duration: toNumber(raw.runtime ?? raw.duration),
    tmdbId: toNumber(raw.tmdb_id), imdbId: raw.imdb_id ? String(raw.imdb_id) : null,
    poster: imageUrl(raw, settings.sc.origin),
    url: titleUrl(settings, id, raw.slug),
    recommendations: (raw.recommendations || raw.related || []).map((r) => (typeof r === 'object' ? r.id : r)).filter((x) => x != null),
    trailerUrl: raw.trailers?.[0]?.youtube_id ? `https://www.youtube.com/watch?v=${raw.trailers[0].youtube_id}` : (raw.trailerUrl || null),
    seasonEpisodes: seasonsOf(raw), episodesCount: null,
    keywords: namesOf(raw.keywords), cast: namesOf(raw.main_actors).slice(0, 8), creators: namesOf(Array.isArray(raw.created_by) && raw.created_by.length ? raw.created_by : raw.main_directors).slice(0, 4),
    dubIta: raw.dub_ita == null ? null : raw.dub_ita === true || raw.dub_ita === 1 || raw.dub_ita === '1',
    originalLanguage: raw.original_language || null, siteStatus: raw.status || null,
    providerIds: providerIdsOf(raw),
  };
  rec.episodesCount = rec.seasonEpisodes.length ? rec.seasonEpisodes.reduce((a, x) => a + (x.episodes || 0), 0) || null : null;
  for (const k of Object.keys(rec)) if (rec[k] === undefined) rec[k] = null;
  return rec;
}

// Campi che arrivano solo dalla scheda del titolo (livello 2).
export function detailFields(raw, settings) {
  const r = normalizeTitle(raw, settings);
  const out = {};
  for (const k of ['tmdbId', 'imdbId', 'genres', 'plot', 'duration', 'recommendations', 'trailerUrl', 'year', 'seasonsCount', 'originalName', 'poster',
    'seasonEpisodes', 'episodesCount', 'keywords', 'cast', 'creators', 'dubIta', 'originalLanguage', 'siteStatus', 'providerIds']) {
    const v = r[k];
    if (v != null && !(Array.isArray(v) && !v.length)) out[k] = v;
  }
  return out;
}

// URL di una pagina dell'elenco (livello 1). n parte da 0; slice è un filtro aggiuntivo (es. 'year=2024').
// api: elenco JSON paginato (sul sito reale /{lang}/archive con intestazioni XHR, vedi docs/SITE_NOTES.md).
export function listUrl(settings, n, strategy, slice = '') {
  const s = settings.sc;
  const langPath = s.lang ? `/${s.lang}` : '';
  const pageVal = s.pageParam === 'page' ? n + 1 : n * s.pageSize;
  const filter = [s.typeParam, slice].filter(Boolean).join('&');
  if (strategy === 'api') {
    const path = String(s.apiPath || '/{lang}/archive').replace('/{lang}', langPath).replace('{lang}', s.lang || '');
    const lang = s.lang ? `lang=${encodeURIComponent(s.lang)}&` : '';
    return `${s.origin}${path}?${lang}${filter ? filter + '&' : ''}${s.pageParam}=${pageVal}`;
  }
  return `${s.origin}${langPath}${s.archivePath}?${filter ? filter + '&' : ''}${s.pageParam}=${pageVal}`;
}

// Fette dell'archivio. Il sito reale serve al massimo 20 pagine (1 200 titoli) per richiesta: oltre risponde
// 503 «Page limit reached (20)». Per leggere tutto si legge prima l'elenco senza filtri (le novità e il totale
// dichiarato), poi ogni anno con il filtro del sito: anni singoli dal 2000 a oggi, decenni prima
// (sono le voci del menu «Anno» del sito; verificato il 20/11/2026: la somma delle fette = il totale).
export function listSlices(scSettings, now = new Date()) {
  const p = scSettings.sliceParam;
  if (!p) return [''];
  const out = [''];
  for (let y = now.getFullYear(); y >= 2000; y--) out.push(`${p}=${y}`);
  for (let d = 1990; d >= 1910; d -= 10) out.push(`${p}=${d}`);
  out.push(''); // ultima fetta: di nuovo senza filtri, per i titoli che nessun anno raccoglie (letta solo se ne mancano)
  return out;
}

// Limite di pagine raggiunto: il sito lo dice con un 503 e un messaggio esplicito. Restituisce il limite (o null).
export function pageLimitReached(status, body = '') {
  if (status !== 503) return null;
  const m = String(body).slice(0, 300).match(/page limit reached\D*(\d+)?/i);
  return m ? Number(m[1]) || 0 : null;
}

// Intestazioni con cui il sito restituisce il JSON invece dell'HTML (come fa la pagina stessa con «carica altri»).
export const JSON_HEADERS = { 'X-Requested-With': 'XMLHttpRequest', accept: 'application/json' };

// Scheda di un titolo come la chiede l'app del sito quando si naviga (Inertia): solo i dati, senza HTML né script.
// Con «solo il titolo» sono circa 7 KB invece dei ~430 KB della pagina intera; con gli slider (titoli correlati) ~190 KB.
// Se la versione dell'app del sito è cambiata il sito risponde 409: si rilegge l'HTML e si impara la versione nuova.
export function inertiaHeaders(version, related = true) {
  return {
    'X-Requested-With': 'XMLHttpRequest', 'X-Inertia': 'true', 'X-Inertia-Version': String(version),
    'X-Inertia-Partial-Component': 'Titles/Title', 'X-Inertia-Partial-Data': related ? 'title,sliders' : 'title',
    accept: 'text/html, application/xhtml+xml',
  };
}

// Versione dell'app del sito (campo version dei dati della pagina).
export function pageVersion(body) {
  if (!body) return null;
  let d = null;
  if (/^\s*{/.test(body)) { try { d = JSON.parse(body); } catch { d = null; } } else d = extractPageData(body);
  return d && typeof d.version === 'string' && d.version ? d.version : null;
}

// Interpreta la risposta di una pagina dell'elenco (JSON o HTML).
export function parseList(body, contentType = '') {
  let data = null;
  if (/json/.test(contentType) || /^\s*[{[]/.test(body)) {
    try { data = JSON.parse(body); } catch { data = null; }
  }
  if (!data) data = extractPageData(body);
  if (!data) return { ok: false, titles: [], total: null, reason: 'nessun dato riconoscibile' };
  const arrays = findTitleArrays(data);
  arrays.sort((a, b) => b.length - a.length);
  const titles = arrays[0] || [];
  // Paginatore Laravel: current_page / last_page dicono quando l'elenco è finito.
  const page = Number(data.current_page) || null;
  const lastPage = Number(data.last_page) || null;
  return { ok: true, titles, total: findTotal(data), page, lastPage };
}

export function parseDetail(body) {
  const data = /^\s*{/.test(body) ? (() => { try { return JSON.parse(body); } catch { return null; } })() : extractPageData(body);
  if (!data) return null;
  const t = findSingleTitle(data) || findTitleArrays(data)[0]?.[0] || null;
  if (!t) return null;
  // Titoli correlati: sul sito reale stanno nello slider «related» della pagina, non dentro il titolo.
  const sliders = data.props?.sliders || [];
  const related = sliders.find((x) => /related|correlat|simil/i.test(x?.name || ''));
  if (related?.titles?.length && !t.recommendations && !t.related) return { ...t, related: related.titles.map((r) => r.id).filter((x) => x != null) };
  return t;
}

// Riconosce una pagina del catalogo dalla struttura, non dal dominio.
export function fingerprint(html) {
  const data = extractPageData(html);
  if (!data) return { ok: false, reason: 'La pagina non contiene i dati attesi del catalogo.' };
  const arrays = findTitleArrays(data);
  const single = findSingleTitle(data);
  if (!arrays.length && !single) return { ok: false, reason: 'Nessun elenco di titoli trovato nella pagina.' };
  return { ok: true, component: data.component || null, titles: arrays.reduce((s, a) => s + a.length, 0), hasDetail: !!single };
}

// Segnali di blocco: ci si ferma e si avvisa, senza aggirare nulla.
export function blockedReason(status, body = '') {
  if (status === 403) return 'Accesso negato dal sito (403)';
  if (status === 429) return 'Troppe richieste (429): il sito chiede di rallentare';
  if (status >= 500) return `Errore del sito (${status})`;
  // Le pagine di verifica sono HTML: un JSON di dati (trame, parole chiave) non va scambiato per una verifica.
  if (!/^\s*[{[]/.test(body) && /cf-chl|challenge-platform|captcha|g-recaptcha|hcaptcha/i.test(body.slice(0, 20000))) return 'Il sito chiede una verifica (CAPTCHA)';
  return null;
}
