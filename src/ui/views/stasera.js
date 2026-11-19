// «Ho 40 minuti» (funzione 7).
import { e, card } from '../components.js';
import { icon } from '../icons.js';

export async function render(root, { params }, ctx) {
  const minutes = Math.max(10, Math.min(240, Number(params.get('min')) || 40));
  const list = await ctx.store.tonight(minutes);
  root.innerHTML = `
  <header class="between"><div><h1>Ho <span class="s-match">${minutes}</span> minuti</h1><p class="muted" style="margin:4px 0 0">Prima quello che stai già guardando, poi serie nuove con episodi che entrano nel tempo, nei generi che voti meglio.</p></div>
  <div class="row" style="gap:6px">${[20, 30, 40, 60, 90, 120].map((m) => `<a class="chip ${m === minutes ? 'on' : ''}" href="#/stasera?min=${m}">${m} min</a>`).join('')}
    <label class="row small" style="gap:6px">Altro <input type="number" min="10" max="240" value="${minutes}" data-min style="width:80px"></label></div></header>
  ${list.length ? `
    <section class="hero" style="align-items:center"><div style="width:180px">${card(list[0].v)}</div>
      <div class="col" style="gap:10px;flex:1"><div class="lbl">${list[0].kind === 'continue' ? 'Continua' : 'Ti consiglio'}</div><h2 class="big" style="font-size:30px">${e(list[0].v.name)}</h2><p class="s-match" style="margin:0">${e(list[0].reason)}</p>
      <div class="row"><a class="btn p" href="#/serie/${encodeURIComponent(list[0].v.ck)}">${icon('external', 16)}Apri la scheda</a></div></div></section>
    <section class="col"><h2>Altre idee</h2><div class="cards">${list.slice(1).map((x) => card({ ...x.v, why: [x.reason] }, { why: true })).join('')}</div></section>`
    : `<div class="empty">${icon('clock', 28)}<div>Nessuna serie con episodi da ${minutes} minuti o meno. Servono le durate degli episodi: inserisci la chiave TMDB e aggiorna i metadati.</div></div>`}`;
  root.querySelector('[data-min]').addEventListener('change', (ev) => ctx.nav(`stasera?min=${ev.target.value}`));
}
