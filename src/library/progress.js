// Progresso per episodio (funzione 1): da dove sei arrivato a quanto manca.
// Fonti, in ordine: progresso scelto da te (S/E) > episodi visti dagli import (SIMKL, Netflix…) > stato Completata.

// seasons: [{n, episodes}] ordinate. Ritorna il numero di episodi visti fino a S{s}E{e} incluso.
export function episodesUpTo(seasons, s, e) {
  if (!seasons?.length || s == null || e == null) return null;
  let n = 0;
  for (const x of seasons) {
    if (x.n < s) n += x.episodes || 0;
    else if (x.n === s) { n += Math.min(e, x.episodes || e); break; }
  }
  return n;
}

// Episodio successivo a S{s}E{e}: nella stessa stagione o primo della successiva.
export function nextEpisode(seasons, s, e) {
  if (s == null) return seasons?.length ? { s: seasons[0].n, e: 1 } : { s: 1, e: 1 };
  const cur = seasons?.find((x) => x.n === s);
  if (!cur || cur.episodes == null || e < cur.episodes) return { s, e: (e || 0) + 1 };
  const nx = seasons.find((x) => x.n > s);
  return nx ? { s: nx.n, e: 1 } : null;
}

// Da un numero di episodi visti alla posizione S/E (per mostrare «sei a S2E4»).
export function positionOf(seasons, seen) {
  if (!seasons?.length || seen == null) return null;
  let left = seen;
  for (const x of seasons) {
    const n = x.episodes || 0;
    if (left <= n) return { s: x.n, e: left };
    left -= n;
  }
  const last = seasons[seasons.length - 1];
  return { s: last.n, e: last.episodes || 0 };
}

export function computeProgress({ status, seasons = [], total = null, epRuntime = null, override = null, importedEpisodes = null }) {
  const tot = total ?? (seasons.length ? seasons.reduce((a, x) => a + (x.episodes || 0), 0) || null : null);
  let seen = null; let from = null;
  if (override && override.s != null) { seen = episodesUpTo(seasons, override.s, override.e ?? 0) ?? null; from = 'manual'; }
  if (seen == null && importedEpisodes != null) { seen = importedEpisodes; from = 'import'; }
  if (seen == null && status === 'completed' && tot) { seen = tot; from = 'status'; }
  if (seen == null) return null;
  if (tot) seen = Math.min(seen, tot);
  const pos = override && override.s != null ? { s: override.s, e: override.e ?? 0 } : positionOf(seasons, seen);
  const pct = tot ? Math.round((seen / tot) * 100) : null;
  const leftEp = tot != null ? Math.max(0, tot - seen) : null;
  const leftMin = leftEp != null && epRuntime ? leftEp * epRuntime : null;
  const next = pos ? nextEpisode(seasons, pos.s, pos.e) : null;
  return { seen, total: tot, pct, leftEp, leftMin, pos, next: leftEp === 0 ? null : next, from };
}
