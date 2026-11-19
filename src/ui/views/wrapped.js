// Riepilogo annuale in stile «Wrapped» (funzione 13): un'immagine PNG da condividere.
import { e, download } from '../components.js';
import { icon } from '../icons.js';
import { getAll } from '../../db/db.js';
import { logo } from '../icons.js';

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

export async function render(root, { params }, ctx) {
  const diary = await getAll('diary');
  const years = [...new Set(diary.map((d) => new Date(d.date).getFullYear()))].sort((a, b) => b - a);
  const year = Number(params.get('anno')) || years[0] || new Date().getFullYear();
  const w = await ctx.store.wrapped(year, diary);
  root.innerHTML = `<header class="between"><div><h1>Il tuo ${year} in serie</h1><p class="muted" style="margin:4px 0 0">Dal diario di BingeMap: serie iniziate e completate quest'anno. Scarica l'immagine e condividila.</p></div>
    <div class="row" style="gap:6px">${(years.length ? years : [year]).map((y) => `<a class="chip ${y === year ? 'on' : ''}" href="#/wrapped?anno=${y}">${y}</a>`).join('')}</div></header>
    ${w.completed || w.started ? `<div class="split" style="align-items:flex-start">
      <div class="col" style="flex:0 0 auto;align-items:center"><canvas class="wrapped-preview" width="1080" height="1350" style="width:min(420px,100%)" data-c></canvas>
        <button class="btn p" data-dl>${icon('download', 16)}Scarica l'immagine</button></div>
      <div class="col grow">
        <div class="grid g3">${[['Serie completate', w.completed], ['Iniziate', w.started], ['Ore', w.hours], ['Episodi', w.episodes], ['Giorni di fila', w.days], ['Mese più intenso', w.busiestMonth != null ? MONTHS[w.busiestMonth] : '—']].map(([l, n]) => `<div class="card" style="padding:14px"><div class="lbl">${l}</div><div class="h" style="font-size:24px">${e(n)}</div></div>`).join('')}</div>
        ${w.top.length ? `<section class="panel col"><h2 style="font-size:16px">La tua top ${w.top.length}</h2><ol style="margin:0;padding-left:20px">${w.top.map((t) => `<li><a href="#/serie/${encodeURIComponent(t.ck)}">${e(t.name)}</a>${t.rating != null ? ` · <b>${t.rating}</b>` : ''}</li>`).join('')}</ol></section>` : ''}
        ${w.topGenres.length ? `<section class="panel"><h2 style="font-size:16px">Generi</h2><div class="row" style="gap:6px">${w.topGenres.map((g) => `<span class="tag">${e(g.label)} · ${g.n}</span>`).join('')}</div></section>` : ''}
      </div></div>`
    : `<div class="empty">${icon('gift', 28)}<div>Nessuna serie iniziata o completata nel ${year} nel diario. Il diario si riempie quando segni una serie come «In corso» o «Completata».</div></div>`}`;
  const c = root.querySelector('[data-c]');
  if (!c) return;
  await document.fonts?.ready;
  paint(c, w);
  root.querySelector('[data-dl]').addEventListener('click', () => c.toBlob((b) => download(`bingemap-${year}.png`, b, 'image/png'), 'image/png'));
}

function paint(c, w) {
  const g = c.getContext('2d');
  const W = c.width; const H = c.height;
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0B1020'); bg.addColorStop(0.55, '#1C1646'); bg.addColorStop(1, '#3A1E8A');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.18; g.fillStyle = '#6D4AFF'; g.beginPath(); g.arc(W * 0.85, H * 0.12, 260, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  const txt = (s, x, y, font, color = '#E8EAF6', align = 'left') => { g.font = font; g.fillStyle = color; g.textAlign = align; g.fillText(s, x, y); };
  txt('BingeMap', 80, 120, '700 44px Sora, sans-serif', '#A68CFF');
  txt(`Il mio ${w.year}`, 80, 230, '800 96px Sora, sans-serif');
  txt('in serie TV', 80, 320, '600 56px Sora, sans-serif', '#9AA3C0');
  const stats = [[w.completed, 'serie completate'], [w.hours, 'ore guardate'], [w.episodes, 'episodi']];
  stats.forEach(([n, l], i) => { const y = 470 + i * 130; txt(String(n), 80, y, '800 92px Sora, sans-serif', i === 0 ? '#2DD4BF' : '#E8EAF6'); txt(l, 80 + g.measureText(String(n)).width + 24, y, '500 38px Inter, sans-serif', '#9AA3C0'); });
  let y = 900;
  if (w.best) { txt('Serie dell\'anno', 80, y, '600 30px Inter, sans-serif', '#9AA3C0'); txt(trim(g, w.best.name, '800 54px Sora, sans-serif', W - 160), 80, y + 66, '800 54px Sora, sans-serif', '#FBBF24'); y += 140; }
  if (w.topGenres.length) { txt('Generi preferiti', 80, y, '600 30px Inter, sans-serif', '#9AA3C0'); txt(trim(g, w.topGenres.slice(0, 3).map((x) => x.label).join(' · '), '700 42px Sora, sans-serif', W - 160), 80, y + 56, '700 42px Sora, sans-serif'); y += 120; }
  if (w.top.length > 1) { txt('Top 5', 80, y, '600 30px Inter, sans-serif', '#9AA3C0'); w.top.slice(0, 5).forEach((t, i) => txt(trim(g, `${i + 1}. ${t.name}`, '600 30px Inter, sans-serif', W - 160), 80, y + 44 + i * 40, '600 30px Inter, sans-serif')); }
  txt('bingemap · ko-fi.com/mashaup', W - 80, H - 60, '500 26px Inter, sans-serif', '#7C86A6', 'right');
  void logo;
}

function trim(g, s, font, max) {
  g.font = font;
  if (g.measureText(s).width <= max) return s;
  let out = s;
  while (out.length > 3 && g.measureText(out + '…').width > max) out = out.slice(0, -1);
  return out + '…';
}
