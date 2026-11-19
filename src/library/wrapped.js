// Riepilogo annuale in stile «Wrapped» (funzione 13). Dal diario (inizi e fini) e dalle viste.
import { genreLabel } from './tags.js';

export function computeWrapped(views, diary = [], year = new Date().getFullYear()) {
  const byCk = new Map(views.map((v) => [v.ck, v]));
  const inYear = (t) => new Date(t).getFullYear() === year;
  const completedCks = [...new Set(diary.filter((d) => d.event === 'completed' && inYear(d.date)).map((d) => d.ck))];
  const startedCks = [...new Set(diary.filter((d) => d.event === 'started' && inYear(d.date)).map((d) => d.ck))];
  const completed = completedCks.map((ck) => byCk.get(ck)).filter(Boolean);
  const hours = Math.round(completed.reduce((a, v) => a + (v.hours || 0), 0));
  const episodes = completed.reduce((a, v) => a + (v.episodes || 0), 0);
  const gcount = new Map();
  for (const v of completed) for (const g of v.genres || []) gcount.set(g, (gcount.get(g) || 0) + 1);
  const topGenres = [...gcount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g, n]) => ({ key: g, label: genreLabel(g), n }));
  const ranked = [...completed].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.score ?? -1) - (a.score ?? -1));
  const top = ranked.slice(0, 10).map((v) => ({ ck: v.ck, name: v.name, year: v.year, rating: v.rating, poster: v.poster }));
  const longest = [...completed].sort((a, b) => (b.hours || 0) - (a.hours || 0))[0] || null;
  const countries = new Map();
  for (const v of completed) for (const c of v.country || []) countries.set(c, (countries.get(c) || 0) + 1);
  const months = new Array(12).fill(0);
  for (const d of diary) if (d.event === 'completed' && inYear(d.date)) months[new Date(d.date).getMonth()]++;
  return {
    year, completed: completed.length, started: startedCks.length, hours, episodes, days: Math.round((hours / 24) * 10) / 10,
    topGenres, top, best: top[0] || null, longest: longest ? { name: longest.name, hours: longest.hours } : null,
    countries: [...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => ({ c, n })), months,
    busiestMonth: months.some((m) => m) ? months.indexOf(Math.max(...months)) : null,
  };
}
