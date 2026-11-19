// Il giro del mondo in serie (funzione 9). Mappa: Natural Earth 1:110m (pubblico dominio) tramite world-atlas.
import { e } from '../components.js';
import { icon } from '../icons.js';
import { countryName } from '../../library/world.js';
import { encodeObj } from '../../common/util.js';

let geo = null;
async function loadGeo() {
  if (!geo) geo = await (await fetch(new URL('../../../assets/world.json', import.meta.url))).json();
  return geo;
}

const viste = (n) => `${n} ${n === 1 ? 'vista' : 'viste'}`;
const detail = (x) => [viste(x.completed), x.active ? `${x.active} in corso` : '', `${x.todo} da scoprire`].filter(Boolean).join(' · ');

const shade = (x) => {
  if (!x) return 'var(--surface-2)';
  if (x.completed >= 10) return '#0F9F8C';
  if (x.completed >= 5) return '#14B8A6';
  if (x.completed >= 2) return '#2DD4BF';
  if (x.completed >= 1 || x.active) return '#5EEAD4';
  return 'color-mix(in srgb, var(--primary) 30%, var(--surface-2))';
};

export async function render(root, _r, ctx) {
  const [st, g] = await Promise.all([ctx.store.world(), loadGeo()]);
  const by = new Map(st.countries.map((c) => [c.code, c]));
  const href = (code) => `#/catalogo?q=${encodeObj({ all: [{ field: 'country', any: [code] }] })}`;
  root.innerHTML = `<header><h1>Il giro del mondo in serie</h1><p class="muted" style="margin:4px 0 0">Più il verde è scuro, più serie di quel paese hai visto. In viola i paesi presenti nel catalogo che non hai mai provato.</p></header>
  ${!st.withData ? `<div class="notice warn">${icon('alert')}<div>Il paese di una serie arriva da TMDB: inserisci la chiave in <a href="#/impostazioni/servizi">Impostazioni › Servizi</a> e aggiorna i metadati da <a href="#/attivita">Attività</a>.</div></div>` : ''}
  <div class="split" style="align-items:flex-start">
    <section class="panel grow" style="padding:10px">
      <svg viewBox="0 0 ${g.w} ${g.h}" role="group" aria-label="Mappa del mondo: hai visto serie di ${st.visited} paesi su ${st.available}" style="width:100%;height:auto;display:block">
        ${g.countries.map((c) => { const x = c.c ? by.get(c.c) : null; const label = c.c ? countryName(c.c) : c.n;
          const tip = x ? `${label}: ${detail(x)}` : label;
          return x ? `<a href="${href(c.c)}" aria-label="${e(tip)}"><path d="${c.d}" fill="${shade(x)}" stroke="var(--bg)" stroke-width="0.5"><title>${e(tip)}</title></path></a>` : `<path d="${c.d}" fill="var(--surface-2)" stroke="var(--bg)" stroke-width="0.5"><title>${e(label)}</title></path>`; }).join('')}
      </svg>
      <div class="row small muted" style="gap:14px;padding:6px 8px">${[['#5EEAD4', '1 vista o in corso'], ['#2DD4BF', '2–4 viste'], ['#14B8A6', '5–9 viste'], ['#0F9F8C', '10+ viste']].map(([c, l]) => `<span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${c};margin-right:5px"></i>${l}</span>`).join('')}<span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:color-mix(in srgb, var(--primary) 30%, var(--surface-2));margin-right:5px"></i>mai provato</span></div>
    </section>
    <aside class="col" style="flex:0 0 320px;width:320px">
      <div class="panel col" style="gap:6px"><div class="lbl">Paesi visitati</div><div class="h" style="font-size:34px"><span class="s-match">${st.visited}</span> <span class="muted" style="font-size:18px">su ${st.available}</span></div></div>
      ${st.neverTried.length ? `<div class="panel col" style="gap:8px"><h2 style="font-size:16px">${icon('compass', 16)} Mai provati</h2>
        ${st.neverTried.slice(0, 10).map((x) => `<div class="between small"><a href="${href(x.code)}">${e(countryName(x.code))}</a><span class="muted">${x.best ? `prova <a href="#/serie/${encodeURIComponent(x.best.ck)}">${e(x.best.name)}</a>` : `${x.todo} serie`}</span></div>`).join('')}</div>` : ''}
      ${st.countries.filter((x) => x.visited).length ? `<div class="panel col" style="gap:6px"><h2 style="font-size:16px">I tuoi paesi</h2>
        ${st.countries.filter((x) => x.visited).slice(0, 12).map((x) => `<div class="between small"><a href="${href(x.code)}">${e(countryName(x.code))}</a><span class="muted">${detail(x)}</span></div>`).join('')}</div>` : ''}
    </aside>
  </div>`;
}
