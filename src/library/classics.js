// I grandi classici che ti mancano (funzione 4): le serie più votate di sempre e quante ne hai viste.
// Voto pesato (come le classifiche di IMDb): con pochi voti TMDB il punteggio si avvicina alla media.
const M = 400;

export function weightedScore(v, mean) {
  if (v.voteCount != null && v.voteCount > 0 && v.score != null) {
    const n = v.voteCount;
    return (n / (n + M)) * v.score + (M / (n + M)) * mean;
  }
  return v.score != null ? v.score - 0.4 : null; // solo il voto del sito: un po' meno affidabile
}

export function classics(views, { limit = 100, minAge = 3, now = new Date() } = {}) {
  // Media di riferimento: quella del catalogo, ma mai sopra 7 (con pochi titoli molto votati gonfierebbe chi ha pochi voti).
  const withScore = views.filter((v) => v.score != null);
  const mean = Math.min(7, withScore.length ? withScore.reduce((a, v) => a + v.score, 0) / withScore.length : 7);
  const year = now.getFullYear();
  const ranked = views
    .filter((v) => v.year != null && v.year <= year - minAge)
    .map((v) => ({ v, w: weightedScore(v, mean) }))
    .filter((x) => x.w != null)
    .sort((a, b) => b.w - a.w || (b.v.voteCount ?? 0) - (a.v.voteCount ?? 0))
    .slice(0, limit);
  const seen = ranked.filter((x) => x.v.status === 'completed').length;
  const started = ranked.filter((x) => ['watching', 'hold'].includes(x.v.status)).length;
  return {
    list: ranked.map((x, i) => ({ rank: i + 1, ck: x.v.ck, name: x.v.name, year: x.v.year, status: x.v.status, score: Math.round(x.w * 10) / 10, poster: x.v.poster })),
    total: ranked.length, seen, started, pct: ranked.length ? Math.round((seen / ranked.length) * 100) : 0,
  };
}

// Copertura di una tua lista importata (ad esempio la top 250 di IMDb salvata come lista): quante serie hai completato.
export function listCoverage(views, listKey) {
  const inList = views.filter((v) => v.lists.includes(listKey));
  const seen = inList.filter((v) => v.status === 'completed').length;
  return { listKey, total: inList.length, seen, pct: inList.length ? Math.round((seen / inList.length) * 100) : 0,
    missing: inList.filter((v) => v.status !== 'completed').map((v) => v.ck) };
}
