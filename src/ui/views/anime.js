// Anime della stagione (funzione 8): dati di AniList, confrontati con il catalogo e le tue liste.
import { e, statusBadge, toast } from '../components.js';
import { icon } from '../icons.js';
import { fetchSeason, seasonOf, SEASON_IT, ANILIST_API } from '../../import/anime.js';
import { isExtension, hasOrigin, requestOrigin, sessionKv } from '../../platform/platform.js';
import { setOverlay } from '../../library/data.js';
import { httpUrl } from '../../common/util.js';

export async function render(root, { params }, ctx) {
  const now = seasonOf();
  const season = params.get('stagione') || now.season; const year = Number(params.get('anno')) || now.year;
  const order = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
  const shift = (d) => { let i = order.indexOf(season) + d; let y = year; if (i < 0) { i = 3; y--; } if (i > 3) { i = 0; y++; } return `anime?stagione=${order[i]}&anno=${y}`; };
  root.innerHTML = `<header class="between"><div><h1>Anime della stagione</h1><p class="muted" style="margin:4px 0 0">${SEASON_IT[season]} ${year}: i più seguiti su AniList, con il prossimo episodio e se sono nel catalogo o nelle tue liste.</p></div>
    <div class="row" style="gap:6px"><a class="btn sm" href="#/${shift(-1)}">← Stagione prima</a><a class="btn sm" href="#/${shift(1)}">Stagione dopo →</a><a class="btn sm" href="#/import/anilist">${icon('upload', 14)}Importa la tua lista</a></div></header>
    <div data-body class="col"><div class="empty">${icon('sparkles', 28)}<div>Carico da AniList…</div></div></div>`;
  const body = root.querySelector('[data-body]');
  const load = async () => {
    const key = `anime:${season}:${year}`;
    let list = await sessionKv.get(key);
    if (!list || Date.now() - list.at > 6 * 3600000) { list = { at: Date.now(), items: await fetchSeason({ season, year }) }; await sessionKv.set(key, list); }
    const matched = await ctx.store.animeMatch(list.items.map((a) => ({ title: a.title, altTitles: a.altTitles })));
    body.innerHTML = `<div class="cards">${list.items.map((a, i) => { const v = matched[i];
      return `<article class="tcard"><div class="poster">${icon('film', 30)}${a.cover ? `<span style="position:absolute;inset:0"><img src="${e(a.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>` : ''}${v ? `<span style="position:absolute;left:8px;top:8px">${statusBadge(v.status)}</span>` : ''}</div>
        <div class="t">${v ? `<a href="#/serie/${encodeURIComponent(v.ck)}">${e(a.title)}</a>` : e(a.title)}</div>
        <div class="m">${e([a.score ? `★ ${a.score.toFixed(1)}` : '', a.episodes ? `${a.episodes} ep.` : '', a.genres.slice(0, 2).join(', ')].filter(Boolean).join(' · '))}</div>
        ${a.next ? `<div class="why s-match small">Ep. ${a.next.episode} ${new Date(a.next.at).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })}</div>` : ''}
        <div class="row small" style="gap:6px">${v ? (['none', 'unknown'].includes(v.status) ? `<button class="btn sm" data-plan="${e(v.ck)}">${icon('bookmark', 12)}Da vedere</button>` : '') : '<span class="muted">Non nel catalogo</span>'}${httpUrl(a.url) ? `<a class="small" href="${e(httpUrl(a.url))}" target="_blank" rel="noopener">AniList</a>` : ''}</div></article>`; }).join('')}</div>
      <p class="muted small">Dati di AniList (anilist.co).</p>`;
  };
  const start = async () => {
    try { await load(); } catch (err) { body.innerHTML = `<div class="notice err">${icon('alert')}<div>${e(err.message)}</div></div>`; }
  };
  if (isExtension && !(await hasOrigin(ANILIST_API))) {
    body.innerHTML = `<div class="notice">${icon('info')}<div>Per leggere gli anime della stagione BingeMap deve poter contattare AniList (graphql.anilist.co). Serve solo per questo.</div><button class="btn p" data-perm>Consenti e carica</button></div>`;
    body.querySelector('[data-perm]').addEventListener('click', async () => { if (await requestOrigin(ANILIST_API)) start(); else toast('Permesso non concesso', 'err'); });
  } else start();
  body.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-plan]'); if (!b) return;
    await setOverlay(b.dataset.plan, { status: 'plan' }, { label: 'Da vedere' });
    toast('Aggiunta a Da vedere', 'ok', { label: 'Annulla', run: ctx.undo }); await ctx.store.changed(true); b.remove();
  });
}
