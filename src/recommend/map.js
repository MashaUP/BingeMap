// La «mappa» di BingeMap (funzione 5): serie vicine = serie simili per generi, parole chiave, cast, paese, lingua, decennio.
// Calcolata in locale, senza servizi esterni:
//   1. vettori TF-IDF dei tratti di ogni serie;
//   2. i k vicini più simili (coseno) tramite indice invertito;
//   3. disposizione 2D con un layout a forze (molle tra vicini, repulsione locale a griglia), deterministico;
//   4. zone (k-means sulle coordinate) con un nome dai tratti più caratteristici e quanto le hai esplorate.
import { genreLabel } from '../library/tags.js';
import { lowerKey } from '../common/util.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const W = { g: 1, k: 1.3, c: 0.7, cr: 1, co: 0.5, l: 0.5, d: 0.35 };

export function traits(v) {
  const t = [];
  for (const g of v.genres || []) t.push(`g:${g}`);
  for (const k of (v.keywords || []).slice(0, 20)) t.push(`k:${lowerKey(k)}`);
  for (const c of (v.cast || []).slice(0, 6)) t.push(`c:${lowerKey(c)}`);
  for (const c of (v.creators || []).slice(0, 3)) t.push(`cr:${lowerKey(c)}`);
  for (const c of (v.country || []).slice(0, 2)) t.push(`co:${c}`);
  if (v.lang) t.push(`l:${v.lang}`);
  if (v.year) t.push(`d:${Math.floor(v.year / 10) * 10}`);
  return [...new Set(t)];
}

export function traitLabel(t) {
  const [ns, ...rest] = t.split(':'); const x = rest.join(':');
  if (ns === 'g') return genreLabel(x);
  if (ns === 'd') return `anni ${String(x).slice(2)}`;
  if (ns === 'l') return `lingua ${x.toUpperCase()}`;
  if (ns === 'co') return x;
  return x;
}

export function vectors(views) {
  const N = views.length;
  const toks = views.map(traits);
  const df = new Map();
  for (const ts of toks) for (const t of ts) df.set(t, (df.get(t) || 0) + 1);
  const vecs = toks.map((ts) => {
    const m = new Map(); let norm = 0;
    for (const t of ts) {
      const d = df.get(t);
      if (d < 2 && !t.startsWith('g:')) continue; // un tratto unico non avvicina nessuno
      const w = (W[t.split(':')[0]] || 1) * (Math.log((N + 1) / (d + 0.5)) + 0.2);
      m.set(t, w); norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of m) m.set(t, w / norm);
    return m;
  });
  return { vecs, df };
}

export function knn(vecs, k = 8, maxPostings = 400) {
  const inv = new Map();
  vecs.forEach((m, i) => { for (const t of m.keys()) { if (!inv.has(t)) inv.set(t, []); inv.get(t).push(i); } });
  const out = new Array(vecs.length);
  const acc = new Float64Array(vecs.length); const touched = [];
  for (let i = 0; i < vecs.length; i++) {
    for (const [t, w] of vecs[i]) {
      const post = inv.get(t);
      const step = post.length > maxPostings ? post.length / maxPostings : 1;
      for (let p = (i % 7) * (step > 1 ? 1 : 0); p < post.length; p += step) {
        const j = post[Math.floor(p)];
        if (j === i) continue;
        if (acc[j] === 0) touched.push(j);
        acc[j] += w * vecs[j].get(t);
      }
    }
    // I k migliori con una sola passata (niente ordinamento di tutti i candidati).
    const top = [];
    for (const j of touched) {
      const v = acc[j];
      if (v <= 0.05 || (top.length === k && v <= top[k - 1][1])) continue;
      let p = top.length < k ? top.length : k - 1;
      if (top.length < k) top.push(null);
      while (p > 0 && top[p - 1][1] < v) { top[p] = top[p - 1]; p--; }
      top[p] = [j, v];
    }
    out[i] = top;
    for (const j of touched) acc[j] = 0;
    touched.length = 0;
  }
  return out;
}

export function layout(neigh, { iterations = 160, seed = 7 } = {}) {
  const n = neigh.length;
  const r = rng(seed);
  const x = new Float64Array(n); const y = new Float64Array(n);
  for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2; const d = Math.sqrt(r()); x[i] = Math.cos(a) * d; y[i] = Math.sin(a) * d; }
  if (n < 2) return { x, y };
  const ideal = 1.2 / Math.sqrt(n);
  const cell = ideal * 2.5;
  for (let it = 0; it < iterations; it++) {
    const temp = 0.08 * (1 - it / iterations) + 0.002;
    const dx = new Float64Array(n); const dy = new Float64Array(n);
    // Molle tra vicini simili: più simili = più vicini.
    for (let i = 0; i < n; i++) {
      for (const [j, s] of neigh[i]) {
        const ex = x[j] - x[i]; const ey = y[j] - y[i];
        const d = Math.sqrt(ex * ex + ey * ey) || 1e-6;
        const f = (d - ideal) * 0.6 * s;
        dx[i] += (ex / d) * f; dy[i] += (ey / d) * f;
        dx[j] -= (ex / d) * f; dy[j] -= (ey / d) * f;
      }
    }
    // Repulsione solo tra punti nella stessa cella o in quelle accanto; nelle celle affollate si campiona.
    const grid = new Map();
    const K = 1 << 16;
    for (let i = 0; i < n; i++) { const key = (Math.floor(x[i] / cell) + 32768) * K + (Math.floor(y[i] / cell) + 32768); let l = grid.get(key); if (!l) { l = []; grid.set(key, l); } l.push(i); }
    for (const [key, list] of grid) {
      const gx = Math.floor(key / K); const gy = key % K;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const other = grid.get((gx + ox) * K + (gy + oy));
        if (!other) continue;
        const stride = Math.max(1, Math.floor(other.length / 24));
        for (const i of list) for (let q = (i + it) % stride; q < other.length; q += stride) {
          const j = other[q];
          if (j <= i && stride === 1) continue;
          if (j === i) continue;
          const ex = x[i] - x[j]; const ey = y[i] - y[j];
          const d2 = ex * ex + ey * ey + 1e-9;
          if (d2 > cell * cell) continue;
          const f = ((ideal * ideal) / d2) * 0.02 * stride;
          if (stride === 1) { dx[i] += ex * f; dy[i] += ey * f; dx[j] -= ex * f; dy[j] -= ey * f; } else { dx[i] += ex * f; dy[i] += ey * f; }
        }
      }
    }
    // Leggera gravità verso il centro: le isole senza vicini non scappano.
    for (let i = 0; i < n; i++) {
      dx[i] -= x[i] * 0.01; dy[i] -= y[i] * 0.01;
      const m = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      if (m > temp) { dx[i] = (dx[i] / m) * temp; dy[i] = (dy[i] / m) * temp; }
      x[i] += dx[i]; y[i] += dy[i];
    }
  }
  return { x, y };
}

function kmeans(pts, k, seed = 3) {
  const r = rng(seed);
  const n = pts.length;
  if (n <= k) return { assign: pts.map((_, i) => i), centers: pts.map((p) => [...p]) };
  let centers = [];
  // Inizializzazione k-means++.
  centers.push([...pts[Math.floor(r() * n)]]);
  while (centers.length < k) {
    const d = pts.map((p) => Math.min(...centers.map((c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2)));
    const sum = d.reduce((a, b) => a + b, 0);
    let t = r() * sum; let idx = 0;
    while (t > d[idx] && idx < n - 1) { t -= d[idx]; idx++; }
    centers.push([...pts[idx]]);
  }
  const assign = new Int32Array(n);
  for (let it = 0; it < 25; it++) {
    for (let i = 0; i < n; i++) {
      let best = 0; let bd = Infinity;
      for (let c = 0; c < k; c++) { const d = (pts[i][0] - centers[c][0]) ** 2 + (pts[i][1] - centers[c][1]) ** 2; if (d < bd) { bd = d; best = c; } }
      assign[i] = best;
    }
    const sx = new Float64Array(k); const sy = new Float64Array(k); const cnt = new Int32Array(k);
    for (let i = 0; i < n; i++) { sx[assign[i]] += pts[i][0]; sy[assign[i]] += pts[i][1]; cnt[assign[i]]++; }
    centers = centers.map((c, j) => (cnt[j] ? [sx[j] / cnt[j], sy[j] / cnt[j]] : c));
  }
  return { assign: [...assign], centers };
}

export function buildMap(views, opts = {}) {
  const list = views.filter((v) => (v.genres?.length || v.keywords?.length));
  const { vecs, df } = vectors(list);
  const neigh = knn(vecs, opts.k || 8);
  const { x, y } = layout(neigh, opts);
  // Coordinate tra 0 e 1, con un margine.
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (let i = 0; i < list.length; i++) { minX = Math.min(minX, x[i]); maxX = Math.max(maxX, x[i]); minY = Math.min(minY, y[i]); maxY = Math.max(maxY, y[i]); }
  const sx = maxX - minX || 1; const sy = maxY - minY || 1;
  const pts = list.map((_, i) => [0.04 + ((x[i] - minX) / sx) * 0.92, 0.04 + ((y[i] - minY) / sy) * 0.92]);
  const k = Math.max(3, Math.min(16, Math.round(Math.sqrt(list.length / 18))));
  const { assign, centers } = kmeans(pts, Math.min(k, list.length || 1));
  const clusters = centers.map((c, id) => ({ id, x: c[0], y: c[1], total: 0, completed: 0, active: 0, good: 0, weights: new Map(), cks: [] }));
  list.forEach((v, i) => {
    const cl = clusters[assign[i]];
    if (!cl) return;
    cl.total++;
    if (v.status === 'completed') cl.completed++;
    else if (['watching', 'hold', 'dropped'].includes(v.status)) cl.active++;
    else if ((v.score ?? 0) >= 7.5 && !v.notInterested) { cl.good++; cl.cks.push(v.ck); }
    for (const [t, w] of vecs[i]) if (!t.startsWith('c:')) cl.weights.set(t, (cl.weights.get(t) || 0) + w);
  });
  const N = list.length;
  const out = clusters.filter((c) => c.total).map((c) => {
    // Nome della zona: tratti frequenti nella zona e rari altrove.
    const ranked = [...c.weights.entries()].map(([t, w]) => [t, (w / c.total) * Math.log((N + 1) / (df.get(t) + 1))]).sort((a, b) => b[1] - a[1]);
    const label = ranked.slice(0, 3).map(([t]) => traitLabel(t)).join(' · ');
    const seenShare = (c.completed + c.active) / c.total;
    return { id: c.id, x: c.x, y: c.y, label, total: c.total, completed: c.completed, active: c.active, good: c.good, explored: Math.round(seenShare * 100),
      unexplored: c.good >= 3 && seenShare < 0.1, topCks: c.cks.slice(0, 12) };
  });
  const nodes = list.map((v, i) => ({ ck: v.ck, name: v.name, year: v.year, status: v.status, score: v.score, x: pts[i][0], y: pts[i][1], c: assign[i] }));
  return { nodes, clusters: out.sort((a, b) => Number(b.unexplored) - Number(a.unexplored) || b.good - a.good), count: N };
}
