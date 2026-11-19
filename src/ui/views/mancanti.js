// Mancanti (F67, F68, idea 25): serie delle liste non trovate nel catalogo, e quelle ora disponibili.
import { e, statusBadge, toast, download, modal, cards } from '../components.js';
import { icon } from '../icons.js';
import { SOURCES } from '../../import/sources.js';
import { setRule, runMatching } from '../../match/run.js';
import { missingCsv, downloadName } from '../../backup/backup.js';
import { fmtNum } from '../../common/util.js';

export async function render(root, _p, ctx) {
  const { store, ui } = ctx;
  const { missing, nowAvailable } = await store.missing();
  let src = ''; let tag = ''; let q = '';
  const sources = [...new Set(missing.flatMap((m) => m.sources))];
  const tagCounts = new Map(); for (const m of missing) for (const t of m.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  const catLabel = ui.settings.activeCatalog === 'sc' ? 'Streaming Community' : ui.settings.activeCatalog === 'tmdbp' ? 'fornitori legali' : 'cataloghi attivi';

  root.innerHTML = `<header class="between"><div><h1>Mancanti</h1><p class="muted" style="margin:4px 0 0">${fmtNum(missing.length)} serie delle tue liste non sono nei ${e(catLabel)} · ricontrollate a ogni scansione completa</p></div>
    <button class="btn" data-export>${icon('download')}Esporta elenco</button></header>
    ${nowAvailable.length ? `<section class="panel col" style="border-color:var(--match)"><div class="row">${icon('sparkles', 22, 's-match')}<h2 style="font-size:16px">${nowAvailable.length} ora disponibili</h2></div>${cards(nowAvailable.map((n) => n.view).filter(Boolean))}</section>` : ''}
    <div class="row"><label class="search" style="flex:1 1 300px">${icon('search')}<input data-q placeholder="Filtra per titolo" aria-label="Filtra"></label>
      <div class="row" style="gap:6px"><span class="lbl">Fonte</span><button class="chip on" data-src="">Tutte</button>${sources.map((s) => `<button class="chip" data-src="${e(s)}">${e(SOURCES[s] || s)} <span class="n">${missing.filter((m) => m.sources.includes(s)).length}</span></button>`).join('')}</div></div>
    ${tagCounts.size ? `<div class="row" style="gap:6px"><span class="lbl">Tag</span>${[...tagCounts].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t, n]) => `<button class="chip" data-tag="${e(t)}">${e(t)} <span class="n">${n}</span></button>`).join('')}</div>` : ''}
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Titolo</th><th>Anno</th><th>Fonti</th><th>Stato</th><th>Tag</th><th>Azioni</th></tr></thead><tbody data-rows></tbody></table></div>`;

  const draw = () => {
    const rows = missing.filter((m) => (!src || m.sources.includes(src)) && (!tag || m.tags.includes(tag)) && (!q || m.title.toLowerCase().includes(q)));
    root.querySelector('[data-rows]').innerHTML = rows.slice(0, 600).map((m) => `<tr><td><b>${e(m.title)}</b></td><td>${m.year ?? ''}</td><td>${e(m.sources.map((s) => SOURCES[s] || s).join(', '))}</td><td>${statusBadge(m.status)}</td><td>${m.tags.map((t) => `<span class="tag imp">${e(t)}</span>`).join(' ')}</td>
      <td><span class="row" style="gap:6px"><button class="btn sm" data-search="${e(m.key)}">${icon('search', 14)}Cerca a mano</button><button class="btn sm" data-ignore="${e(m.key)}">Ignora</button></span></td></tr>`).join('') || `<tr><td colspan="6"><div class="empty">${icon('check', 24)}<div>Nessuna serie mancante con questi filtri.</div></div></td></tr>`;
    root.querySelectorAll('[data-src]').forEach((b) => b.classList.toggle('on', b.dataset.src === src));
    root.querySelectorAll('[data-tag]').forEach((b) => b.classList.toggle('on', b.dataset.tag === tag));
  };
  draw();

  root.addEventListener('input', (ev) => { if (ev.target.matches('[data-q]')) { q = ev.target.value.toLowerCase(); draw(); } });
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.src != null) { src = b.dataset.src; draw(); }
    if (b.dataset.tag != null) { tag = tag === b.dataset.tag ? '' : b.dataset.tag; draw(); }
    if (b.hasAttribute('data-export')) { download(downloadName('bingemap-mancanti', 'csv'), missingCsv(missing), 'text/csv'); toast('Elenco esportato', 'ok'); }
    if (b.dataset.ignore) {
      const cats = ui.settings.activeCatalog === 'all' ? ['sc', 'tmdbp'] : [ui.settings.activeCatalog];
      for (const c of cats) await setRule(b.dataset.ignore, c, { ignore: true });
      await runMatching(); await store.changed(true); ctx.rerender();
    }
    if (b.dataset.search) manual(b.dataset.search);
  });

  async function manual(key) {
    const m = missing.find((x) => x.key === key);
    const md = modal(`<div class="between"><h2>Abbina «${e(m.title)}»</h2><button class="ibtn" data-close aria-label="Chiudi">${icon('x', 16)}</button></div>
      <label class="search">${icon('search')}<input data-mq value="${e(m.title)}" aria-label="Cerca nel catalogo"></label><div data-res class="col" style="gap:6px"></div>`, { wide: true });
    const inp = md.el.querySelector('[data-mq]'); const out = md.el.querySelector('[data-res]');
    const go = async () => {
      const r = await store.query({ ast: { all: [{ field: 'text', q: inp.value }] }, limit: 12, showHidden: true });
      out.innerHTML = r.items.map((v) => `<div class="between card" style="padding:10px"><span><b>${e(v.name)}</b> ${v.year ?? ''} <span class="muted small">${e(v.genreLabels.join(', '))}</span></span><button class="btn sm p" data-pick="${e(v.ck)}">È questa</button></div>`).join('') || '<span class="muted">Nessun titolo con questo nome.</span>';
    };
    inp.addEventListener('input', go); go();
    out.addEventListener('click', async (ev) => {
      const p = ev.target.closest('[data-pick]'); if (!p) return;
      const ck = p.dataset.pick; const cat = ck.split(':')[0];
      await setRule(key, cat, { accept: ck });
      await runMatching(); md.close(); toast('Abbinata', 'ok'); await store.changed(true); ctx.rerender();
    });
  }
}
