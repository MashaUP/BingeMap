// Filtri scritti a parole (idea 20): analizzatore locale con vocabolario fisso, nessuna IA.
// Esempio: «fantasy concluse dopo il 2018 non viste voto almeno 8 corte sub ita»
import { stripAccents } from '../common/util.js';
import { canonicalGenre } from '../library/tags.js';

const GENRE_WORDS = ['fantasy', 'fantastico', 'fantascienza', 'sci-fi', 'scifi', 'commedia', 'comedy', 'drama', 'drammatico', 'mystery',
  'mistero', 'giallo', 'thriller', 'horror', 'crime', 'poliziesco', 'animazione', 'anime', 'azione', 'action', 'avventura', 'documentario',
  'romantico', 'romance', 'famiglia', 'storico', 'guerra', 'western', 'reality', 'sport', 'musica'];

const COUNTRY = { coreane: 'KR', coreana: 'KR', coreani: 'KR', giapponesi: 'JP', giapponese: 'JP', americane: 'US', americana: 'US', britanniche: 'GB', inglesi: 'GB', italiane: 'IT', italiana: 'IT', spagnole: 'ES', spagnola: 'ES', tedesche: 'DE', francesi: 'FR', danesi: 'DK', svedesi: 'SE', norvegesi: 'NO', turche: 'TR', indiane: 'IN' };

export function parseNatural(text) {
  const s = ' ' + stripAccents(String(text || '')).toLowerCase().replace(/[.,;!?]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const all = [];
  const understood = [];
  const genres = [];
  const excl = [...s.matchAll(/\bsenza ([a-z-]+)/g)].map((x) => canonicalGenre(x[1]));
  const sNoExcl = s.replace(/\bsenza [a-z-]+/g, ' ');
  for (const w of GENRE_WORDS) if (new RegExp(`\\b${w.replace('-', '\\-')}\\b`).test(sNoExcl)) genres.push(canonicalGenre(w));
  if (genres.length) { all.push({ field: 'genre', any: [...new Set(genres)] }); understood.push('genere'); }

  let m;
  if ((m = s.match(/\btra (?:il )?((?:19|20)\d{2}) e (?:il )?((?:19|20)\d{2})\b/))) { all.push({ field: 'year', range: [Number(m[1]), Number(m[2])] }); understood.push('anni'); }
  else {
    if ((m = s.match(/\b(?:dopo il|dal|dopo|successive al|dal|from|since) ((?:19|20)\d{2})\b/))) { all.push({ field: 'year', min: Number(m[1]) + (/dopo/.test(m[0]) ? 1 : 0) }); understood.push('anno minimo'); }
    if ((m = s.match(/\b(?:prima del|fino al|entro il|before) ((?:19|20)\d{2})\b/))) { all.push({ field: 'year', max: Number(m[1]) - (/prima/.test(m[0]) ? 1 : 0) }); understood.push('anno massimo'); }
    if ((m = s.match(/\banni (\d)0\b/))) { const base = Number(m[1]) >= 5 ? 1900 + Number(m[1]) * 10 : 2000 + Number(m[1]) * 10; all.push({ field: 'year', range: [base, base + 9] }); understood.push('decennio'); }
  }
  if (/\b(concluse|conclusa|finite|terminate|complete)\b/.test(s)) { all.push({ field: 'tmdbStatus', any: ['Ended'] }); understood.push('concluse'); }
  if (/\bin corso\b/.test(s) && !/\bnon (?:le )?(?:sto )?guardando\b/.test(s)) { all.push({ field: 'tmdbStatus', any: ['Returning Series'] }); understood.push('in corso'); }
  if (/\bmai viste\b|\bin nessuna lista\b/.test(s)) { all.push({ field: 'status', any: ['none'] }); understood.push('mai viste'); }
  else if (/\bnon (viste|completate|finite|guardate)\b|\bda vedere\b|\bnon vista\b/.test(s)) { all.push({ field: 'status', any: ['plan', 'none', 'unknown'] }); understood.push('non completate'); }
  if ((m = s.match(/\bvoto (?:almeno |minimo |sopra |superiore a |>= ?)?(\d+(?:[.,]\d)?)/))) { all.push({ field: 'score', min: Number(m[1].replace(',', '.')) }); understood.push('voto'); }
  if (/\b(corte|brevi|poche stagioni)\b/.test(s)) { all.push({ field: 'seasons', max: 2 }); understood.push('corte'); }
  if ((m = s.match(/\b(?:max|massimo|al massimo|fino a) (\d+) stagion/))) { all.push({ field: 'seasons', max: Number(m[1]) }); understood.push('stagioni'); }
  if (/\bweekend\b/.test(s)) { all.push({ field: 'hours', max: 10 }); understood.push('weekend'); }
  if (/\bsub ?ita\b|\bsottotitolat/.test(s)) { all.push({ field: 'subIta', eq: true }); understood.push('Sub-ITA'); }
  if (/\bdoppiat/.test(s)) { all.push({ field: 'subIta', eq: false }); understood.push('doppiate'); }
  if (/\bnuove\b|\baggiunte di recente\b/.test(s)) { all.push({ field: 'added', withinDays: 14 }); understood.push('nuove'); }
  const countries = Object.entries(COUNTRY).filter(([w]) => new RegExp(`\\b${w}\\b`).test(s)).map(([, c]) => c);
  if (countries.length) { all.push({ field: 'country', any: [...new Set(countries)] }); understood.push('paese'); }
  if (excl.length) { all.push({ field: 'genre', none: [...new Set(excl)] }); understood.push('esclusione'); }
  return { query: { all }, understood };
}
