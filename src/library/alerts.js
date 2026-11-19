// Calendario «In arrivo» (funzione 2) e avvisi su rinnovi e cancellazioni (funzione 3). Funzioni pure.
import { calendarDays } from '../common/util.js';

// Serie che ti interessano: in corso, in pausa, da vedere, monitorate, nelle prossime 5, o completate con una nuova stagione.
export function cares(v) {
  return ['watching', 'hold', 'plan'].includes(v.status) || !!v.monitor || v.nextUp != null || (v.status === 'completed' && !!v.newSeason);
}

const dayTs = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return y && m && d ? new Date(y, m - 1, d).getTime() : null; };

// Prossime uscite: episodio successivo (TMDB) e stagioni con data futura. Solo serie che ti interessano, se onlyMine.
export function calendarItems(views, { now = Date.now(), days = 90, onlyMine = true } = {}) {
  const out = [];
  for (const v of views) {
    if (onlyMine && !cares(v) && v.status !== 'completed') continue;
    const seen = new Set();
    const add = (date, s, e, name, kind) => {
      const ts = dayTs(date);
      if (ts == null) return;
      const d = calendarDays(now, ts);
      if (d < -1 || d > days) return;
      const k = `${s}x${e}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ ck: v.ck, name: v.name, poster: v.poster, status: v.status, date: String(date).slice(0, 10), ts, inDays: d, s, e, epName: name || null, kind });
    };
    if (v.nextAir?.date) add(v.nextAir.date, v.nextAir.s, v.nextAir.e, v.nextAir.name, v.nextAir.e === 1 ? 'premiere' : 'episode');
    for (const se of v.seasonEpisodes || []) if (se.date) add(se.date, se.n, 1, null, 'premiere');
  }
  return out.sort((a, b) => a.ts - b.ts || a.name.localeCompare(b.name));
}

export const STATUS_IT = { Ended: 'Conclusa', 'Returning Series': 'Rinnovata / in corso', Canceled: 'Cancellata', 'In Production': 'In produzione', Planned: 'Annunciata', Pilot: 'Pilota' };

// Cambi di stato recenti delle serie che ti interessano. since: solo i cambi dopo questo istante (per le notifiche).
export function renewalAlerts(views, { since = 0 } = {}) {
  return views.filter((v) => v.statusChange && v.statusChange.date > since && (cares(v) || v.status === 'completed'))
    .map((v) => ({ ck: v.ck, name: v.name, from: v.statusChange.from, to: v.statusChange.to, date: v.statusChange.date, status: v.status,
      text: `${v.name}: ${STATUS_IT[v.statusChange.from] || v.statusChange.from} → ${STATUS_IT[v.statusChange.to] || v.statusChange.to}` }))
    .sort((a, b) => b.date - a.date);
}
