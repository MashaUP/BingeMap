// La mappa (funzione 5): ogni punto è una serie, le serie vicine si somigliano. Trascina per muoverti, rotella o pizzico per lo zoom.
import { e, cards } from '../components.js';
import { icon } from '../icons.js';

const COLORS = { completed: '#60A5FA', watching: '#2DD4BF', hold: '#A68CFF', dropped: '#F87171', plan: '#FBBF24', none: '#7C86A6', unknown: '#FB923C' };
const LABELS = { completed: 'Completate', watching: 'In corso', plan: 'Da vedere', none: 'Non nelle liste', hold: 'In pausa', dropped: 'Abbandonate', unknown: 'Incerte' };

export async function render(root, { params }, ctx) {
  root.innerHTML = `<header class="between"><div><h1>La mappa delle serie</h1><p class="muted" style="margin:4px 0 0">Serie vicine = serie simili per generi, parole chiave, cast, paese e decennio. Le zone senza punti blu sono quelle che non hai ancora esplorato.</p></div>
    <div class="row" style="gap:6px" data-mode>${[['all', 'Tutte'], ['todo', 'Non viste'], ['mine', 'Le mie']].map(([k, l]) => `<button class="chip ${k === 'all' ? 'on' : ''}" data-m="${k}">${l}</button>`).join('')}</div></header>
    <div class="split" style="align-items:flex-start"><div class="grow col">
      <div class="mapwrap" data-wrap><div class="empty" style="height:100%">${icon('map', 28)}<div>Disegno la mappa…</div></div></div>
    </div><aside class="col" style="flex:0 0 320px;width:320px" data-side></aside></div>
    <section class="col" data-zone></section>`;
  const t0 = performance.now();
  const data = await ctx.store.map();
  const wrap = root.querySelector('[data-wrap]');
  const side = root.querySelector('[data-side]');
  if (!data.nodes.length) {
    wrap.innerHTML = `<div class="empty" style="height:100%">${icon('map', 28)}<div>Servono serie con generi o parole chiave: fai una scansione del catalogo e, se puoi, leggi i dettagli dei titoli.</div></div>`;
    return;
  }
  wrap.innerHTML = `<canvas aria-label="Mappa di ${data.count} serie" role="img"></canvas><div class="maptip" hidden></div>
    <div class="maplegend">${Object.entries(LABELS).slice(0, 4).map(([k, l]) => `<span><i style="background:${COLORS[k]}"></i>${l}</span>`).join('')}</div>`;
  const canvas = wrap.querySelector('canvas'); const tip = wrap.querySelector('.maptip');
  const g = canvas.getContext('2d');
  let W = 0; let H = 0; let dpr = 1;
  const view = { s: 1, x: 0, y: 0 };
  let mode = 'all'; let focus = Number(params.get('zona'));
  if (!Number.isFinite(focus)) focus = null;
  let hover = null;
  const fade = (n) => (mode === 'todo' && ['completed', 'dropped'].includes(n.status)) || (mode === 'mine' && ['none', 'unknown'].includes(n.status)) || (focus != null && n.c !== focus);
  const sx = (x) => (x * W) * view.s + view.x; const sy = (y) => (y * H) * view.s + view.y;

  function resize() {
    const r = wrap.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1; W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  function draw() {
    g.clearRect(0, 0, W, H);
    const rad = Math.max(1.6, Math.min(5, 2.2 * Math.sqrt(view.s)));
    for (const pass of [true, false]) {
      for (const n of data.nodes) {
        const f = fade(n);
        if (f !== pass) continue;
        const x = sx(n.x); const y = sy(n.y);
        if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
        g.globalAlpha = f ? 0.12 : 0.9;
        g.fillStyle = COLORS[n.status] || COLORS.none;
        g.beginPath(); g.arc(x, y, rad * (n.score >= 8 ? 1.25 : 1), 0, Math.PI * 2); g.fill();
      }
    }
    g.globalAlpha = 1;
    // Nomi delle zone.
    g.font = '600 12px Inter, sans-serif'; g.textAlign = 'center';
    for (const c of data.clusters) {
      if (focus != null && c.id !== focus) continue;
      const x = sx(c.x); const y = sy(c.y);
      const label = c.label || 'Zona';
      const w = g.measureText(label).width + 14;
      g.fillStyle = c.unexplored ? 'rgba(109,74,255,.92)' : 'rgba(11,16,32,.78)';
      g.beginPath(); g.roundRect ? g.roundRect(x - w / 2, y - 11, w, 22, 11) : g.rect(x - w / 2, y - 11, w, 22); g.fill();
      g.fillStyle = '#fff'; g.fillText(label, x, y + 4);
    }
    if (hover) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(sx(hover.x), sy(hover.y), rad + 4, 0, Math.PI * 2); g.stroke(); }
  }
  function nearest(px, py) {
    let best = null; let bd = 14 * 14;
    for (const n of data.nodes) {
      if (fade(n)) continue;
      const dx = sx(n.x) - px; const dy = sy(n.y) - py; const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  // Trascinamento, zoom con rotella e pizzico.
  const ptrs = new Map(); let dragged = false; let pinch = null;
  canvas.addEventListener('pointerdown', (ev) => { canvas.setPointerCapture(ev.pointerId); ptrs.set(ev.pointerId, { x: ev.offsetX, y: ev.offsetY }); dragged = false; canvas.classList.add('drag'); });
  canvas.addEventListener('pointermove', (ev) => {
    const p = ptrs.get(ev.pointerId);
    if (p) {
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()]; const d0 = Math.hypot(a.x - b.x, a.y - b.y);
        ptrs.set(ev.pointerId, { x: ev.offsetX, y: ev.offsetY });
        const [a2, b2] = [...ptrs.values()]; const d1 = Math.hypot(a2.x - b2.x, a2.y - b2.y);
        if (pinch == null) pinch = d0;
        zoomAt((a2.x + b2.x) / 2, (a2.y + b2.y) / 2, d1 / (d0 || d1));
        dragged = true; return;
      }
      const dx = ev.offsetX - p.x; const dy = ev.offsetY - p.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
      view.x += dx; view.y += dy; p.x = ev.offsetX; p.y = ev.offsetY; draw(); return;
    }
    const n = nearest(ev.offsetX, ev.offsetY);
    if (n !== hover) { hover = n; draw(); }
    if (n) { tip.hidden = false; tip.style.left = `${Math.min(W - 270, ev.offsetX + 14)}px`; tip.style.top = `${Math.min(H - 70, ev.offsetY + 14)}px`; tip.innerHTML = `<b>${e(n.name)}</b>${n.year ? ` (${n.year})` : ''}<div class="muted small">${e(LABELS[n.status] || '')}${n.score ? ` · ★ ${n.score}` : ''}</div>`; }
    else tip.hidden = true;
  });
  const up = (ev) => { ptrs.delete(ev.pointerId); if (ptrs.size < 2) pinch = null; canvas.classList.remove('drag'); };
  canvas.addEventListener('pointerup', (ev) => { const wasDrag = dragged; up(ev); if (!wasDrag) { const n = nearest(ev.offsetX, ev.offsetY); if (n) ctx.nav('serie/' + encodeURIComponent(n.ck)); } });
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { tip.hidden = true; if (hover) { hover = null; draw(); } });
  function zoomAt(px, py, f) {
    const ns = Math.max(0.6, Math.min(30, view.s * f)); const k = ns / view.s;
    view.x = px - (px - view.x) * k; view.y = py - (py - view.y) * k; view.s = ns; draw();
  }
  canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); zoomAt(ev.offsetX, ev.offsetY, ev.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
  const ro = new ResizeObserver(resize); ro.observe(wrap);

  const zones = data.clusters;
  const drawSide = () => {
    side.innerHTML = `<div class="panel col" style="gap:10px"><h2 style="font-size:16px">${icon('compass', 16)} Zone da esplorare</h2>
      ${zones.filter((z) => z.unexplored).map((z) => zoneBtn(z)).join('') || '<span class="muted small">Hai già esplorato un po\' tutte le zone: guarda quelle con la percentuale più bassa.</span>'}
      <h3 style="margin:6px 0 0;font-size:14px">Tutte le zone</h3>${zones.filter((z) => !z.unexplored).map((z) => zoneBtn(z)).join('')}
      ${focus != null ? '<button class="btn sm" data-z="">Mostra tutta la mappa</button>' : ''}
      <span class="muted small">${data.count} serie disegnate in ${Math.round(performance.now() - t0)} ms, tutto in locale.</span></div>`;
  };
  const zoneBtn = (z) => `<button class="btn sm ${focus === z.id ? 'p' : ''}" style="justify-content:space-between;text-align:left" data-z="${z.id}"><span>${e(z.label)}</span><span class="muted small">${z.explored}% · ${z.total}</span></button>`;
  const showZone = async () => {
    const box = root.querySelector('[data-zone]');
    const z = zones.find((x) => x.id === focus);
    if (!z) { box.innerHTML = ''; return; }
    const list = await ctx.store.views(z.topCks);
    box.innerHTML = `<h2>${e(z.label)}: le più votate che non hai visto</h2>${cards(list.map((v) => ({ ...v, tags: [] })), { empty: 'Nessuna serie molto votata da scoprire in questa zona.' })}`;
  };
  side.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-z]'); if (!b) return;
    focus = b.dataset.z === '' ? null : Number(b.dataset.z);
    const z = zones.find((x) => x.id === focus);
    if (z) { view.s = 2.6; view.x = W / 2 - z.x * W * view.s; view.y = H / 2 - z.y * H * view.s; } else { view.s = 1; view.x = 0; view.y = 0; }
    drawSide(); draw(); showZone();
  });
  root.querySelector('[data-mode]').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-m]'); if (!b) return;
    mode = b.dataset.m; root.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); draw();
  });
  drawSide(); resize(); showZone();
  return () => ro.disconnect();
}
