// Utilità condivise, senza dipendenze dall'ambiente (girano in pagina, worker, service worker e Node).

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function uid(prefix = '') {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${rnd}`;
}

export function debounce(fn, ms = 350) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

// FNV-1a 32 bit: chiavi stabili per le righe importate senza ID.
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function stripAccents(s) {
  // Solo i diacritici latini; NFC alla fine ricompone hangul, kana e gli altri sistemi di scrittura.
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
}

export function lowerKey(s) {
  return stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const NF = new Intl.NumberFormat('it-IT');
export const fmtNum = (n) => (n == null || Number.isNaN(n) ? '—' : NF.format(n));
export const fmtDec = (n, d = 1) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }));

export function fmtDate(ts, withTime = false) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const opts = { day: 'numeric', month: 'short', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('it-IT', opts);
}

// Giorni di calendario (ora locale) tra due istanti: non sbaglia a cavallo del cambio dell'ora legale.
export function calendarDays(from, to = Date.now()) {
  const a = new Date(from); const b = new Date(to);
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / 86400000);
}

// Collazione italiana per gli ordinamenti A–Z (À, È, ecc. al posto giusto).
export const collator = new Intl.Collator('it', { sensitivity: 'base', numeric: true });

export function daysBetween(a, b = Date.now()) {
  return Math.floor((b - a) / 86400000);
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function uniq(arr) {
  return [...new Set(arr.filter((x) => x != null && x !== ''))];
}

export function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function toYear(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 1800 && v < 2200 ? Math.trunc(v) : null;
  const m = String(v).match(/(18|19|20|21)\d{2}/);
  return m ? Number(m[0]) : null;
}

export function toDate(v) {
  if (!v) return null;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

export function splitList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(splitList);
  if (typeof v === 'object') return [v.name ?? v.title ?? v.label ?? ''].filter(Boolean);
  return String(v).split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
}

// Codifica/decodifica di oggetti in stringhe sicure per URL (ricerche condivise, idea 24).
export function encodeObj(obj) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeObj(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// Nomi dei servizi a confronto: «Disney Plus» = «Disney+», «Apple TV+» ≈ «Apple TV Plus», «Amazon Prime Video» ≈ «Prime Video».
export function provKey(name) { return String(name || '').toLowerCase().replace(/\+/g, 'plus').replace(/amazon/g, '').replace(/[^a-z0-9]/g, ''); }
export function sameProvider(a, b) { const x = provKey(a); const y = provKey(b); return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x)); }
