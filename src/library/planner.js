// Pianificatore di maratona (funzione 4): dato il tempo a settimana, quando finisci ogni serie e in che ordine.
// Il tempo si distribuisce in modo uniforme sui giorni scelti; le serie si guardano una dopo l'altra.
import { calendarDays } from '../common/util.js';

const DAY = 86400000;

export function planMarathon(items, { hoursPerWeek = 6, start = Date.now(), weekdays = [0, 1, 2, 3, 4, 5, 6] } = {}) {
  const days = [...new Set(weekdays)].filter((d) => d >= 0 && d <= 6);
  if (!days.length || !(hoursPerWeek > 0)) return { items: [], perDay: 0, totalMin: 0, end: null, unknown: items.filter((x) => x.leftMin == null).map((x) => x.ck) };
  const perDay = (hoursPerWeek * 60) / days.length;
  const out = []; const unknown = [];
  // Cursore: giorno corrente e minuti già usati in quel giorno.
  let cursor = new Date(start); cursor.setHours(12, 0, 0, 0);
  while (!days.includes(cursor.getDay())) cursor = new Date(cursor.getTime() + DAY);
  let used = 0; let totalMin = 0;
  const advance = () => { do { cursor = new Date(cursor.getTime() + DAY); cursor.setHours(12, 0, 0, 0); } while (!days.includes(cursor.getDay())); used = 0; };
  for (const it of items) {
    if (it.leftMin == null) { unknown.push(it.ck); continue; }
    let left = Math.max(0, it.leftMin);
    if (used >= perDay - 0.01) advance();
    const startAt = cursor.getTime();
    totalMin += left;
    while (left > 0) {
      const free = perDay - used;
      if (left <= free + 0.01) { used += left; left = 0; } else { left -= free; advance(); }
    }
    out.push({ ...it, startAt, endAt: cursor.getTime(), days: calendarDays(startAt, cursor.getTime()) + 1 });
  }
  return { items: out, perDay: Math.round(perDay), totalMin, end: out.length ? out[out.length - 1].endAt : null, unknown };
}
