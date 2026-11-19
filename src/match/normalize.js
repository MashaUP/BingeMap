// Normalizzazione dei titoli per il riconoscimento.
import { stripAccents } from '../common/util.js';

const ARTICLES = ['the', 'a', 'an', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'l', 'el', 'los', 'las', 'der', 'die', 'das'];
const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };

// Ritorna { norm, year } dove year è estratto da "(2019)" o "[2019]" in coda.
export function parseTitle(raw) {
  let s = String(raw ?? '').trim();
  let year = null;
  const m = s.match(/[([]\s*((?:18|19|20|21)\d{2})\s*[)\]]\s*$/);
  if (m) { year = Number(m[1]); s = s.slice(0, m.index).trim(); }
  return { norm: normTitle(s), year };
}

export function normTitle(raw) {
  let s = stripAccents(String(raw ?? '')).toLowerCase();
  s = s.replace(/[‘’‚‛`´]/g, "'");
  s = s.replace(/&/g, ' and ');
  s = s.replace(/[([]\s*(?:18|19|20|21)\d{2}\s*[)\]]\s*$/, ' ');
  s = s.replace(/'/g, ' ');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  let words = s.split(' ').filter(Boolean);
  while (words.length > 1 && ARTICLES.includes(words[0])) words = words.slice(1);
  words = words.map((w) => ROMAN[w] || w);
  return words.join(' ');
}

// Trigrammi con bordi, per la somiglianza (coefficiente di Dice).
export function trigrams(s) {
  const t = `  ${s} `;
  const set = new Set();
  for (let i = 0; i < t.length - 2; i++) set.add(t.slice(i, i + 3));
  return set;
}

export function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return (2 * inter) / (a.size + b.size);
}

export function similarity(s1, s2) {
  if (s1 === s2) return 1;
  return dice(trigrams(s1), trigrams(s2));
}

export function normImdb(v) {
  if (!v) return null;
  const m = String(v).match(/tt\d{5,10}/);
  return m ? m[0] : null;
}

export function normId(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}
