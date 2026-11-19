// Linea del tempo personale (funzione 10): anno per anno le serie iniziate e finite, con i voti.
// Fonti: il diario di BingeMap e, per le serie completate negli import senza diario, la data dell'ultima attività.
export function timeline(views, diary = []) {
  const byCk = new Map(views.map((v) => [v.ck, v]));
  const events = [];
  const withDiary = new Set();
  for (const d of diary) {
    const v = byCk.get(d.ck) || views.find((x) => x.cks?.includes(d.ck));
    if (!v || !d.date) continue;
    if (d.event === 'completed') withDiary.add(v.ck);
    events.push({ ck: v.ck, name: v.name, poster: v.poster, rating: v.rating, event: d.event === 'completed' ? 'completed' : 'started', date: d.date, from: 'diary' });
  }
  for (const v of views) {
    if (v.status === 'completed' && !withDiary.has(v.ck) && v.lastActivity) events.push({ ck: v.ck, name: v.name, poster: v.poster, rating: v.rating, event: 'completed', date: v.lastActivity, from: 'import' });
  }
  events.sort((a, b) => b.date - a.date);
  const years = new Map();
  for (const ev of events) {
    const d = new Date(ev.date); const y = d.getFullYear(); const m = d.getMonth();
    if (!years.has(y)) years.set(y, { year: y, completed: 0, started: 0, months: new Map() });
    const Y = years.get(y);
    if (ev.event === 'completed') Y.completed++; else Y.started++;
    if (!Y.months.has(m)) Y.months.set(m, []);
    Y.months.get(m).push(ev);
  }
  return [...years.values()].sort((a, b) => b.year - a.year).map((Y) => {
    const rated = Y.months.size ? [...Y.months.values()].flat().filter((e) => e.event === 'completed' && e.rating != null) : [];
    const best = rated.sort((a, b) => b.rating - a.rating)[0] || null;
    return { year: Y.year, completed: Y.completed, started: Y.started, best: best ? { ck: best.ck, name: best.name, rating: best.rating } : null,
      months: [...Y.months.entries()].sort((a, b) => b[0] - a[0]).map(([month, evs]) => ({ month, events: evs })) };
  });
}
