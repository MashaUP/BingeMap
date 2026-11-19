// I grandi classici che ti mancano (funzione 4).
import { e, card } from '../components.js';
import { icon } from '../icons.js';

export async function render(root, { params }, ctx) {
  const limit = Number(params.get('n')) || 100;
  const listKey = params.get('lista') || '';
  const [c, lists] = await Promise.all([ctx.store.classics(limit), ctx.store.allLists()]);
  const cov = listKey ? await ctx.store.listCoverage(listKey) : null;
  const missing = c.list.filter((x) => x.status !== 'completed');
  root.innerHTML = `<header class="between"><div><h1>I grandi classici che ti mancano</h1><p class="muted" style="margin:4px 0 0">Le ${c.total} serie più votate di sempre nel catalogo (voto pesato sul numero di voti TMDB, uscite da almeno 3 anni).</p></div>
    <div class="row" style="gap:6px">${[50, 100, 250].map((n) => `<a class="chip ${n === limit ? 'on' : ''}" href="#/classici?n=${n}">Top ${n}</a>`).join('')}</div></header>
  <section class="panel col" style="gap:10px">
    <div class="between"><h2 style="font-size:18px">Ne hai viste <span class="s-match">${c.seen}</span> su ${c.total}</h2><span class="muted">${c.pct}%${c.started ? ` · ${c.started} iniziate` : ''}</span></div>
    <div class="prog" role="progressbar" aria-valuenow="${c.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Classici visti"><span style="width:${c.pct}%"></span></div>
    <label class="row small" style="gap:8px">Oppure misura una tua lista importata (ad esempio la top 250 di IMDb salvata come lista)
      <select data-list><option value="">—</option>${lists.map((l) => `<option value="${e(l)}" ${l === listKey ? 'selected' : ''}>${e(l.split(':').slice(1).join(':'))} (${e(l.split(':')[0])})</option>`).join('')}</select></label>
    ${cov ? `<div class="notice">${icon('list')}<div>Lista «${e(listKey.split(':').slice(1).join(':'))}»: ne hai completate <b>${cov.seen}</b> su ${cov.total} (${cov.pct}%).</div></div>` : ''}
  </section>
  ${missing.length ? `<section class="col"><h2>Da recuperare</h2><div class="cards">${missing.slice(0, 48).map((x) => card({ ...x, genreLabels: [], tags: [], why: [`N° ${x.rank} della classifica · voto pesato ${x.score}`] }, { why: true })).join('')}</div></section>` : `<div class="empty">${icon('star', 28)}<div>${c.total ? 'Li hai visti tutti. Complimenti!' : 'Servono voti e anni: fai una scansione e inserisci la chiave TMDB.'}</div></div>`}`;
  root.querySelector('[data-list]').addEventListener('change', (ev) => ctx.nav(`classici?n=${limit}${ev.target.value ? `&lista=${encodeURIComponent(ev.target.value)}` : ''}`));
}
