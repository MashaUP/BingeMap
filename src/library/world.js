// Il giro del mondo in serie (funzione 9): per ogni paese quante serie hai visto e cosa c'è da scoprire.
// Il paese viene da TMDB (origin_country), quindi serve la chiave TMDB.
export function countryStats(views) {
  const by = new Map();
  for (const v of views) {
    for (const c of v.country || []) {
      if (!by.has(c)) by.set(c, { code: c, total: 0, completed: 0, active: 0, todo: [] });
      const x = by.get(c);
      x.total++;
      if (v.status === 'completed') x.completed++;
      else if (['watching', 'hold', 'dropped'].includes(v.status)) x.active++;
      else if (!v.notInterested) x.todo.push(v);
    }
  }
  const list = [...by.values()].map((x) => {
    const best = x.todo.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] || null;
    return { code: x.code, total: x.total, completed: x.completed, active: x.active, todo: x.todo.length, visited: x.completed + x.active > 0,
      best: best ? { ck: best.ck, name: best.name, score: best.score } : null };
  });
  const visited = list.filter((x) => x.visited);
  return {
    countries: list.sort((a, b) => b.completed - a.completed || b.total - a.total),
    visited: visited.length, available: list.length,
    neverTried: list.filter((x) => !x.visited && x.todo > 0).sort((a, b) => (b.best?.score ?? 0) - (a.best?.score ?? 0) || b.total - a.total),
    withData: views.filter((v) => v.country?.length).length,
  };
}

let names = null;
export function countryName(code) {
  try { names = names || new Intl.DisplayNames(['it'], { type: 'region' }); return names.of(code) || code; } catch { return code; }
}
