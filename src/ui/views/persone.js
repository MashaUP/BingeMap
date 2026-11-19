// Persone che segui (funzione 7): attori e autori.
import { e, card, toast } from '../components.js';
import { icon } from '../icons.js';
import { toggleFollow } from '../../library/data.js';
import { loadSettings } from '../../common/settings.js';

export async function render(root, _r, ctx) {
  const people = await ctx.store.people();
  root.innerHTML = `<header><h1>Persone che segui</h1><p class="muted" style="margin:4px 0 0">Segui un attore o un autore dalla scheda di una serie (tocca il suo nome): qui trovi le sue serie che non hai visto e ti avviso quando ne arriva una nuova.</p></header>
  ${people.length ? people.map((p) => `<section class="panel col" style="gap:10px">
    <div class="between"><h2 style="font-size:18px">${icon(p.kind === 'creator' ? 'wand' : 'users', 18)} ${e(p.name)}</h2>
      <span class="row" style="gap:10px"><span class="muted small">${p.seen} viste su ${p.total} nel catalogo${p.recent.length ? ` · <b class="s-match">${p.recent.length} nuove</b>` : ''}</span><button class="btn sm" data-unf="${e(p.name)}">Non seguire più</button></span></div>
    ${p.todo.length ? `<div class="cards">${p.todo.map((v) => card(v)).join('')}</div>` : '<span class="muted">Hai visto tutte le sue serie presenti nel catalogo.</span>'}
  </section>`).join('') : `<div class="empty">${icon('users', 28)}<div>Non segui ancora nessuno. Apri una serie e tocca il nome di un attore o di un autore.</div></div>`}`;
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-unf]'); if (!b) return;
    await toggleFollow(b.dataset.unf); ctx.ui.settings = await loadSettings();
    toast(`Non segui più ${b.dataset.unf}`, 'ok'); await ctx.store.changed(true); ctx.rerender();
  });
}
