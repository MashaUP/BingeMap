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
  };
  for (const k of Object.keys(rec)) if (rec[k] === undefined) rec[k] = null;
  return rec;
}

// Campi che arrivano solo dalla scheda del titolo (livello 2).
export function detailFields(raw, settings) {
  const r = normalizeTitle(raw, settings);
  const out = {};
  for (const k of ['tmdbId', 'imdbId', 'genres', 'plot', 'duration', 'recommendations', 'trailerUrl', 'year', 'seasonsCount', 'originalName', 'poster']) {
    const v = r[k];
    if (v != null && !(Array.isArray(v) && !v.length)) out[k] = v;
  }
  return out;
}

// URL di una pagina dell'elenco (livello 1).
export function listUrl(settings, n, strategy) {
  const s = settings.sc;
  const lang = s.lang ? `lang=${encodeURIComponent(s.lang)}&` : '';
  const pageVal = s.pageParam === 'page' ? n + 1 : n * s.pageSize;
  if (strategy === 'api') return `${s.origin}${s.apiPath}?${lang}${s.typeParam}&${s.pageParam}=${pageVal}`;
  const langPath = s.lang ? `/${s.lang}` : '';
  return `${s.origin}${langPath}${s.archivePath}?${s.typeParam}&${s.pageParam}=${pageVal}`;
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
  return { ok: true, titles, total: findTotal(data) };
}

export function parseDetail(body) {
  const data = /^\s*{/.test(body) ? (() => { try { return JSON.parse(body); } catch { return null; } })() : extractPageData(body);
  if (!data) return null;
  return findSingleTitle(data) || findTitleArrays(data)[0]?.[0] || null;
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
  if (/cf-chl|challenge-platform|captcha|g-recaptcha|hcaptcha/i.test(body.slice(0, 20000))) return 'Il sito chiede una verifica (CAPTCHA)';
  return null;
}
