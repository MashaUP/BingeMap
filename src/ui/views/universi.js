// Universi e spin-off (funzione 5).
import { e, statusBadge } from '../components.js';
import { icon } from '../icons.js';

export async function render(root, _r, ctx) {
  const list = await ctx.store.universes();
  root.innerHTML = `<header><h1>Universi e spin-off</h1><p class="muted" style="margin:4px 0 0">Serie collegate tra loro: stesso titolo di franchise, oppure stessi autori e serie che si richiamano. In ordine di uscita, con la prossima da guardare.</p></header>
  ${list.length ? `<section class="col" style="gap:14px">${list.map((u) => {
    const next = u.members.find((m) => m.ck === u.next);
    return `<article class="panel col" style="gap:10px">
      <div class="between"><h2 style="font-size:18px">${e(u.name)}</h2><span class="muted small">${u.seen} di ${u.members.length} viste · ${e(u.reasons.join(', '))}</span></div>
      ${next ? `<div class="notice ok">${icon('play')}<div>Prossima da guardare: <a href="#/serie/${encodeURIComponent(next.ck)}"><b>${e(next.name)}</b></a>${next.year ? ` (${next.year})` : ''}</div></div>` : `<div class="notice ok">${icon('check')}<div>Le hai viste tutte.</div></div>`}
      <ol class="col" style="gap:6px;margin:0;padding-left:22px">${u.members.map((m) => `<li><a class="between" href="#/serie/${encodeURIComponent(m.ck)}" style="color:var(--text);text-decoration:none"><span>${e(m.name)}${m.year ? ` <span class="muted">(${m.year})</span>` : ''}</span>${statusBadge(m.status)}</a></li>`).join('')}</ol>
    </article>`; }).join('')}</section>`
  : `<div class="empty">${icon('layers', 28)}<div>Nessun universo trovato. Servono i dettagli dei titoli (autori, titoli correlati) o i metadati TMDB.</div></div>`}`;
}
