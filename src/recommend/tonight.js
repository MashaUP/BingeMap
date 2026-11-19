// «Ho 40 minuti» (funzione 7): cosa guardare stasera nel tempo che hai.
// Prima le serie che stai già guardando (il prossimo episodio entra nel tempo), poi serie nuove con episodi brevi
// nei generi che voti meglio.

export function genreAffinity(views) {
  const sum = new Map(); const cnt = new Map();
  for (const v of views) {
    if (v.rating == null && v.status !== 'completed') continue;
    const r = v.rating ?? 7;
    for (const g of v.genres || []) { sum.set(g, (sum.get(g) || 0) + r); cnt.set(g, (cnt.get(g) || 0) + 1); }
  }
  const out = new Map();
  for (const [g, s] of sum) out.set(g, s / cnt.get(g));
  return out;
}

export function tonight(views, minutes, { discovery = ['plan', 'none', 'unknown'], limit = 12 } = {}) {
  const aff = genreAffinity(views);
  const affOf = (v) => { const xs = (v.genres || []).map((g) => aff.get(g)).filter((x) => x != null); return xs.length ? Math.max(...xs) : 6; };
  const out = [];
  for (const v of views) {
    if (v.notInterested || v.snoozed) continue;
    const rt = v.nextAir?.runtime || v.epRuntime;
    if (!rt || rt > minutes) continue;
    const fit = Math.max(1, Math.floor(minutes / rt));
    if ((v.status === 'watching' || v.status === 'hold') && v.progress?.next) {
      const n = v.progress.leftEp != null ? Math.min(fit, v.progress.leftEp) : fit;
      out.push({ v, kind: 'continue', episodes: n, score: 100 + (v.status === 'watching' ? 10 : 0) + affOf(v),
        reason: `Continua da S${v.progress.next.s}E${v.progress.next.e}: ${n === 1 ? 'un episodio' : `${n} episodi`} da circa ${rt} minuti` });
    } else if (discovery.includes(v.status)) {
      const short = v.hours != null && v.hours * 60 <= minutes;
      out.push({ v, kind: short ? 'whole' : 'start', episodes: fit, score: affOf(v) * 1.5 + (v.score ?? 6) + (short ? 2 : 0) + (v.nextUp != null ? 5 : 0),
        reason: short ? `La finisci stasera: circa ${Math.round(v.hours * 60)} minuti in tutto` : `Episodi da circa ${rt} minuti: ne entrano ${fit}` });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
