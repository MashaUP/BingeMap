// La tua linea del tempo (funzione 10).
import { e } from '../components.js';
import { icon } from '../icons.js';
import { getAll } from '../../db/db.js';

const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

export async function render(root, _r, ctx) {
  const years = await ctx.store.timeline(await getAll('diary'));
  root.innerHTML = `<header><h1>La tua linea del tempo</h1><p class="muted" style="margin:4px 0 0">Anno per anno le serie che hai iniziato e finito. Dal diario di BingeMap e, per le completate prima, dalla data negli import.</p></header>
  ${years.length ? years.map((Y) => `<section class="panel col" style="gap:12px">
    <div class="between"><h2 style="font-size:22px">${Y.year}</h2><span class="muted">${Y.completed} finite · ${Y.started} iniziate${Y.best ? ` · la migliore: <a href="#/serie/${encodeURIComponent(Y.best.ck)}">${e(Y.best.name)}</a> (${Y.best.rating})` : ''}</span></div>
    ${Y.months.map((M) => `<div class="calday"><div><b>${MONTHS[M.month]}</b></div><div class="col" style="gap:2px">${M.events.map((ev) => `
      <a class="calitem" href="#/serie/${encodeURIComponent(ev.ck)}"><span class="thumb">${ev.poster ? `<img src="${e(ev.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>
      <span class="col" style="gap:2px"><b>${e(ev.name)}</b><span class="muted small">${ev.event === 'completed' ? 'Finita' : 'Iniziata'} il ${new Date(ev.date).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}${ev.from === 'import' ? ' (dagli import)' : ''}</span></span>
      ${ev.rating != null && ev.event === 'completed' ? `<span class="stars" style="margin-left:auto">★ ${e(ev.rating)}</span>` : ''}</a>`).join('')}</div></div>`).join('')}
  </section>`).join('') : `<div class="empty">${icon('activity', 28)}<div>Ancora niente: la linea del tempo si riempie quando segni serie come «In corso» o «Completata», o importi liste con le date.</div></div>`}`;
}
