// Statistiche al servizio della scoperta (F71, F72, idea 22).
import { e, download } from '../components.js';
import { icon } from '../icons.js';
import { getAll } from '../../db/db.js';
import { fmtNum, fmtDate } from '../../common/util.js';
import { genreLabel } from '../../library/tags.js';

export async function render(root, _p, ctx) {
  const { store } = ctx;
  const s = store.summary();
  const [views, diary, items, snaps] = await Promise.all([store.allViews(), getAll('diary'), getAll('library_items'), getAll('catalog_snapshots')]);
  const c = s.counts;
  const live = items.filter((i) => !i.gone);
  const available = views.filter((v) => v.status !== 'none');
  const notDone = views.filter((v) => !['completed', 'none'].includes(v.status) || v.status === 'plan');
  const genre = count(views.flatMap((v) => v.genres));
  const genreAvail = count(views.filter((v) => v.status !== 'completed').flatMap((v) => v.genres));
  const years = count(views.map((v) => (v.year ? Math.floor(v.year / 5) * 5 : null)).filter(Boolean));
  const tags = count(views.flatMap((v) => [...Object.values(v.impTags).flat(), ...v.userTags]));
  const year = new Date().getFullYear();
  const yDiary = diary.filter((d) => new Date(d.date).getFullYear() === year);
  const byCk = new Map(views.map((v) => [v.ck, v]));
  const started = yDiary.filter((d) => d.event === 'started'); const completed = yDiary.filter((d) => d.event === 'completed');
  const yGenres = count(completed.flatMap((d) => byCk.get(d.ck)?.genres || []));
  const newByMonth = new Map();
  for (const v of views) if (v.firstSeen) { const k = new Date(v.firstSeen).toISOString().slice(0, 7); newByMonth.set(k, (newByMonth.get(k) || 0) + 1); }

  root.innerHTML = `<header class="between"><div><h1>Statistiche</h1><p class="muted" style="margin:4px 0 0">Numeri che servono a scegliere, non a fare classifiche.</p></div><a class="btn p" href="#/wrapped">${icon('gift', 16)}Il tuo anno in serie</a></header>
    <div class="grid g4">${[
      ['Serie nel catalogo', c.total], ['Righe importate', live.length], ['Completate', c.completed], ['Disponibili e non completate', c.plan + c.none + c.unknown],
      ['Disponibili e già completate', c.completed], ['Delle tue liste, mancanti', s.missing], ['Non presenti nelle tue liste', c.none], ['Scoperte iniziate quest\'anno', started.length],
    ].map(([l, n]) => `<div class="panel"><div class="lbl">${e(l)}</div><div class="h" style="font-size:28px">${fmtNum(n)}</div></div>`).join('')}</div>
    <div class="grid g2">
      <section class="panel col"><h2>Generi nel catalogo (non completate)</h2>${histo(genreAvail.slice(0, 12).map(([g, n]) => [genreLabel(g), n]))}</section>
      <section class="panel col"><h2>Anni di uscita</h2>${histo(years.sort((a, b) => a[0] - b[0]).map(([y, n]) => [`${y}–${y + 4}`, n]))}</section>
      <section class="panel col"><h2>Tag più usati</h2>${tags.length ? histo(tags.slice(0, 12)) : '<span class="muted">Nessun tag importato o personale.</span>'}</section>
      <section class="panel col"><h2>Nuove nel catalogo per mese</h2>${histo([...newByMonth].sort().slice(-12).map(([k, n]) => [k, n]))}</section>
    </div>
    <section class="wrapped col" data-wrapped>
      <div class="between"><div class="lbl" style="color:#C4B5FF">BingeMap Wrapped ${year}</div><button class="btn sm" data-png>${icon('download', 14)}Scarica immagine</button></div>
      <div class="h" style="font-size:34px;color:#fff">${fmtNum(started.length)} serie iniziate, ${fmtNum(completed.length)} finite</div>
      <div style="color:#C9CEE3">${yGenres.length ? `Generi dell'anno: ${e(yGenres.slice(0, 3).map(([g]) => genreLabel(g)).join(', '))}` : 'Segna «In corso» e «Completata» in BingeMap per riempire il tuo anno.'}</div>
      <div style="color:#C9CEE3">${fmtNum(diary.filter((d) => d.fromQuery).length)} scoperte arrivate da una ricerca salvata</div>
    </section>
    <section class="panel col"><h2>Diario delle scoperte</h2>
      ${diary.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Serie</th><th>Evento</th></tr></thead><tbody>${diary.sort((a, b) => b.date - a.date).slice(0, 50).map((d) => `<tr><td>${fmtDate(d.date)}</td><td><a href="#/serie/${encodeURIComponent(d.ck)}">${e(byCk.get(d.ck)?.name || d.ck)}</a></td><td>${d.event === 'started' ? 'Iniziata' : 'Completata'}</td></tr>`).join('')}</tbody></table></div>` : '<span class="muted">Il diario si riempie quando segni una serie come «In corso» o «Completata» in BingeMap.</span>'}
    </section>
    <p class="muted small">Scansioni registrate: ${fmtNum(snaps.length)}. Disponibili con stato personale: ${fmtNum(available.length)}. In lista ma non finite: ${fmtNum(notDone.length)}. Totale generi: ${genre.length}.</p>`;

  root.querySelector('[data-png]').addEventListener('click', () => {
    const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1080;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 1080, 1080); grad.addColorStop(0, '#2A2160'); grad.addColorStop(1, '#0B1020');
    g.fillStyle = grad; g.fillRect(0, 0, 1080, 1080);
    g.fillStyle = '#C4B5FF'; g.font = '600 40px Sora, Inter, sans-serif'; g.fillText(`BingeMap Wrapped ${year}`, 80, 160);
    g.fillStyle = '#FFFFFF'; g.font = '700 96px Sora, Inter, sans-serif'; g.fillText(`${started.length} iniziate`, 80, 380); g.fillText(`${completed.length} finite`, 80, 500);
    g.fillStyle = '#C9CEE3'; g.font = '500 40px Inter, sans-serif';
    g.fillText(yGenres.length ? `Generi: ${yGenres.slice(0, 3).map(([x]) => genreLabel(x)).join(', ')}` : 'Il tuo anno di serie', 80, 640);
    g.fillText(`${diary.filter((d) => d.fromQuery).length} scoperte dalle ricerche salvate`, 80, 720);
    g.fillStyle = '#6D4AFF'; g.font = '700 44px Sora, Inter, sans-serif'; g.fillText('BingeMap', 80, 980);
    cv.toBlob((b) => download(`bingemap-wrapped-${year}.png`, b, 'image/png'));
  });
}

function count(arr) { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); }
function histo(rows) {
  if (!rows.length) return '<span class="muted">Nessun dato.</span>';
  const max = Math.max(...rows.map((r) => r[1]));
  return `<div class="histo">${rows.map(([l, n]) => `<div class="r"><span>${e(l)}</span><div class="b" style="width:${Math.max(2, (n / max) * 100)}%"></div><span class="num muted">${fmtNum(n)}</span></div>`).join('')}</div>`;
}
