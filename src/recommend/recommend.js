// Consigli spiegabili (F64, F65, idee 9, 11, 21, 30): regole trasparenti, nessun modello opaco.
// Ogni contributo al punteggio porta con sé la frase che lo spiega.
import { genreLabel } from '../library/tags.js';
import { lowerKey, seededRandom } from '../common/util.js';

const FAV_TAGS = ['favorites', 'favorite', 'preferiti', 'preferita', 'preferite', 'must watch', 'mustwatch', 'priority', 'priorita', 'mind-blowing', 'capolavoro', 'top'];
const DAY = 86400000;

// Profilo dei gusti dalle serie viste o votate.
export function tasteProfile(views) {
  const genre = new Map(); const genreCount = new Map(); const favByGenre = new Map();
  const loved = []; const disliked = new Map();
  for (const v of views) {
    const fav = v.tags.some((t) => FAV_TAGS.includes(t.split(':').pop()));
    const r = v.rating;
    let w = 0;
    if (r != null) w = (r - 6) / 4; // 10 → +1, 6 → 0, 2 → −1
    else if (v.status === 'completed') w = 0.3;
    else if (v.status === 'dropped') w = -0.5;
    if (fav) w += 0.6;
    if (v.notInterested) {
      for (const g of v.genres) disliked.set(g, (disliked.get(g) || 0) + 1);
      continue;
    }
    if (!w) continue;
    for (const g of v.genres) {
      genre.set(g, (genre.get(g) || 0) + w);
      genreCount.set(g, (genreCount.get(g) || 0) + 1);
      if (fav) favByGenre.set(g, (favByGenre.get(g) || 0) + 1);
    }
    if ((r != null && r >= 8) || fav) loved.push(v);
  }
  // Media per genere, smorzata per pochi dati.
  const aff = new Map();
  for (const [g, s] of genre) aff.set(g, s / (genreCount.get(g) + 2));
  return { aff, genreCount, favByGenre, loved, disliked };
}

export function scoreView(v, profile, weights, byCk, now = Date.now()) {
  const reasons = [];
  let score = 0;
  // Generi
  if (v.genres.length) {
    const vals = v.genres.map((g) => ({ g, a: profile.aff.get(g) || 0 })).sort((a, b) => b.a - a.a);
    const gScore = vals.reduce((s, x) => s + x.a, 0) / Math.sqrt(vals.length);
    score += gScore * 3 * weights.genre;
    const top = vals[0];
    if (top && top.a > 0.15) {
      const fav = profile.favByGenre.get(top.g);
      reasons.push({ w: gScore * weights.genre, text: fav ? `${fav} serie ${genreLabel(top.g)} tra i tuoi preferiti` : `Ti piace il genere ${genreLabel(top.g)} (${profile.genreCount.get(top.g)} serie votate o viste)` });
    }
  }
  // Tag importati che segnalano interesse diretto
  const strong = v.tags.filter((t) => !t.includes(':') && FAV_TAGS.includes(t));
  if (strong.length) {
    score += 2 * weights.tag;
    reasons.push({ w: 2 * weights.tag, text: `Hai il tag «${strong[0]}» su questa serie` });
  }
  if (v.status === 'plan') { score += 0.8 * weights.tag; reasons.push({ w: 0.8 * weights.tag, text: 'È già tra le tue da vedere' }); }
  // Somiglianza con le serie amate (idea 30)
  let simHit = null;
  for (const l of profile.loved) {
    if (l.ck === v.ck) continue;
    const viaSite = (l.recs || []).some((id) => v.siteId != null && String(id) === String(v.siteId));
    const viaTmdb = (l.tmdbRecs || []).some((id) => v.cks.some((ck) => byCk.get(ck)?.tmdbId === id));
    if (viaSite || viaTmdb) { simHit = l; break; }
  }
  if (simHit) {
    score += 2.2 * weights.similar;
    reasons.push({ w: 2.2 * weights.similar, text: simHit.rating ? `Simile a ${simHit.name}, che hai votato ${simHit.rating}` : `Simile a ${simHit.name}, tra le tue preferite` });
  }
  // Qualità
  if (v.score != null) {
    const q = (v.score - 6.5) / 2;
    score += q * weights.quality;
    if (v.score >= 8.3) reasons.push({ w: q * weights.quality, text: `Voto alto nel catalogo (${String(v.score).replace('.', ',')})` });
  }
  // Novità
  if (v.firstSeen && now - v.firstSeen < 14 * DAY) {
    score += 0.8 * weights.novelty;
    reasons.push({ w: 0.8 * weights.novelty, text: 'Appena arrivata nel catalogo' });
  }
  // Penalità: generi segnati "non mi interessa", titoli saltati spesso
  for (const g of v.genres) {
    const d = profile.disliked.get(g);
    if (d) score -= Math.min(1.5, d * 0.4);
  }
  if (v.skipCount >= 3) { score -= 1.5; reasons.push({ w: -1, text: `Saltata ${v.skipCount} volte in «Sorprendimi»` }); }
  reasons.sort((a, b) => b.w - a.w);
  return { score, reasons: reasons.filter((r) => r.w > 0).slice(0, 2).map((r) => r.text) };
}

export function recommend(candidates, allViews, weights, catalogByCk = new Map()) {
  const profile = tasteProfile(allViews);
  const enough = profile.aff.size > 0;
  const out = candidates.map((v) => {
    const r = scoreView(v, profile, weights, catalogByCk);
    return { ...v, _reco: r.score, _why: r.reasons };
  });
  out.sort((a, b) => b._reco - a._reco);
  return { items: out, enoughData: enough, profile };
}

// Sorprendimi (F66, idea 11): estrazione pesata tra i migliori, evitando i saltati.
export function surprise(scored, seed = Date.now()) {
  const pool = scored.filter((v) => v.skipCount < 3).slice(0, 40);
  if (!pool.length) return null;
  const rnd = seededRandom(seed);
  const min = Math.min(...pool.map((v) => v._reco ?? 0));
  const weightsArr = pool.map((v) => (v._reco ?? 0) - min + 0.5);
  const total = weightsArr.reduce((a, b) => a + b, 0);
  let x = rnd() * total;
  for (let i = 0; i < pool.length; i++) { x -= weightsArr[i]; if (x <= 0) return pool[i]; }
  return pool[pool.length - 1];
}

export function tagIsFavorite(t) { return FAV_TAGS.includes(lowerKey(t)); }
