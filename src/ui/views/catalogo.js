// Catalogo: esploratore con sezioni, ricerca, filtri combinabili e conteggi.
import { e, cards, chip, toast, download, promptBox } from '../components.js';
import { icon } from '../icons.js';
import { describeCond, setCond, getCond, SORTS, FIELDS } from '../../query/engine.js';
import { discoveryCond } from '../../query/presets.js';
import { encodeObj, decodeObj, fmtNum, debounce } from '../../common/util.js';
import { saveQuery } from '../../library/data.js';
import { resultsCsv, refractCsv, downloadName } from '../../backup/backup.js';
import { genreLabel } from '../../library/tags.js';

const PAGE = 60;

export async function render(root, { params }, ctx) {
  const { store, ui, nav } = ctx;
  let ast = null;
  if (params.get('q')) { try { ast = decodeObj(params.get('q')); } catch { ast = null; } }
  ast = ast || ui.catalogQuery || { all: [] };
  ui.catalogQuery = ast;
  let sort = params.get('sort') || ui.catalogSort || 'score';
  let tab = params.get('tab') || ui.catalogTab || 'all';
  let limit = PAGE; let drawSeq = 0;
  const lastSnap = store.summary();

  root.innerHTML = `
    <header class="between"><div><h1>Catalogo</h1><p class="muted" style="margin:4px 0 0" data-sub></p></div>
      <div class="row"><button class="btn" data-save>${icon('bookmark')}Salva ricerca</button><button class="btn" data-export>${icon('download')}Esporta</button></div></header>
    <div class="row">
      <label class="search" style="flex:1 1 420px">${icon('search')}<input data-search type="search" placeholder="Cerca per titolo, originale o alternativo" aria-label="Cerca nel catalogo"></label>
      <a class="btn" href="#/filtri" data-filters>${icon('filter')}Filtri</a>
      <label class="row" style="gap:6px"><span class="sr">Ordina</span><select data-sort aria-label="Ordina">${Object.entries(SORTS).map(([k, s]) => `<option value="${k}" ${k === sort ? 'selected' : ''}>${e(s.label)}</option>`).join('')}</select></label>
    </div>
    <div class="tabs" role="tablist" aria-label="Sezioni del catalogo" data-tabs></div>
    <div data-section></div>
    <div class="row" style="gap:8px" data-quick></div>
    <div class="split">
      <div class="grow">
        <div class="between"><div class="row" style="gap:8px" data-active></div><b data-count></b></div>
        <div data-grid></div>
        <div class="row" style="justify-content:center" data-more></div>
      </div>
      <aside class="aside" data-aside></aside>
    </div>`;

  const $ = (s) => root.querySelector(s);
  const searchInp = $('[data-search]');
  searchInp.value = getCond(ast, 'text')?.q || '';

  const TABS = [['all', 'Tutte'], ['new', 'Novità'], ['genre', 'Generi'], ['az', 'A–Z'], ['year', 'Per anno'], ['country', 'Paese e lingua'], ['sub', 'Sub-ITA'], ['catalog', 'Cataloghi']];
  const QUICK = [
    ['Non completate', () => toggleStatusDiscovery()], ['Sub-ITA', () => toggleBool('subIta')], ['Concluse', () => toggleEnum('tmdbStatus', 'Ended')],
    ['≤ 2 stagioni', () => toggleNum('seasons', { max: 2 })], ['Voto ≥ 7', () => toggleNum('score', { min: 7 })], ['Weekend', () => toggleNum('hours', { max: 10 })],
  ];

  function apply(next, push = true) {
    ast = next; ui.catalogQuery = ast; limit = PAGE;
    if (push) history.replaceState(null, '', `#/catalogo?q=${encodeObj(ast)}&sort=${sort}&tab=${tab}`);
    draw();
  }
  const toggleStatusDiscovery = () => { const c = getCond(ast, 'status'); apply(setCond(ast, 'status', c ? null : { any: discoveryCond(ui.settings.discovery).any })); };
  const toggleBool = (f) => { const c = getCond(ast, f); apply(setCond(ast, f, c ? null : { eq: true })); };
  const toggleEnum = (f, val) => { const c = getCond(ast, f); apply(setCond(ast, f, c?.any?.includes(val) ? null : { any: [val] })); };
  const toggleNum = (f, patch) => { const c = getCond(ast, f); apply(setCond(ast, f, c ? null : patch)); };

  function quickOn(label) {
    if (label === 'Non completate') return !!getCond(ast, 'status');
    if (label === 'Sub-ITA') return getCond(ast, 'subIta')?.eq === true;
    if (label === 'Concluse') return !!getCond(ast, 'tmdbStatus')?.any?.includes('Ended');
    if (label === '≤ 2 stagioni') return getCond(ast, 'seasons')?.max === 2;
    if (label === 'Voto ≥ 7') return getCond(ast, 'score')?.min === 7;
    if (label === 'Weekend') return getCond(ast, 'hours')?.max === 10;
    return false;
  }

  async function draw() {
    const my = ++drawSeq;
    const facetFields = ['genre', 'initial', 'country', 'lang', 'catalog', 'provider', 'subIta'];
    let effective = ast;
    if (tab === 'new') effective = setCond(ast, 'added', { withinDays: 30 });
    if (tab === 'sub') effective = setCond(ast, 'subIta', { eq: true });
    const res = await store.query({ ast: effective, sort: tab === 'new' && sort === 'score' ? 'added' : sort, limit, facetFields, withReco: true });
    if (my !== drawSeq) return;
    const tot = store.summary()?.counts?.total || 0;
    $('[data-sub]').textContent = `${fmtNum(tot)} serie nel catalogo attivo${ui.settings.activeCatalog === 'all' ? ' (tutti i cataloghi)' : ui.settings.activeCatalog === 'sc' ? ' (Streaming Community)' : ' (fornitori legali)'}`;
    $('[data-tabs]').innerHTML = TABS.map(([k, l]) => `<button role="tab" class="btn sm" aria-selected="${k === tab}" data-tab="${k}">${e(l)}</button>`).join('');
    $('[data-quick]').innerHTML = QUICK.map(([l], i) => chip(l, { on: quickOn(l), act: 'quick', data: { i } })).join('');
    $('[data-section]').innerHTML = section(res.facets);
    $('[data-active]').innerHTML = activeChips();
    $('[data-count]').textContent = `${fmtNum(res.total)} serie`;
    $('[data-grid]').innerHTML = cards(res.items, { why: sort === 'reco' });
    $('[data-more]').innerHTML = res.total > limit ? `<button class="btn" data-more-btn>Mostra altre ${Math.min(PAGE, res.total - limit)}</button>` : '';
    $('[data-aside]').innerHTML = aside(res);
  }

  function section(f) {
    if (tab === 'genre') return `<div class="row" style="gap:8px">${(f.genre || []).map(([g, n]) => { const c = getCond(ast, 'genre'); return chip(genreLabel(g), { on: c?.any?.includes(g), ex: c?.none?.includes(g), act: 'genre', data: { v: g }, n }); }).join('')}</div><p class="muted small">Clic per includere, Alt + clic per escludere.</p>`;
    if (tab === 'az') { const c = getCond(ast, 'initial'); const counts = new Map(f.initial || []); return `<div class="row" style="gap:6px">${['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((l) => chip(l, { on: c?.any?.includes(l), act: 'letter', data: { v: l }, n: counts.get(l) || 0 })).join('')}</div>`; }
    if (tab === 'year') { const c = getCond(ast, 'year'); const decs = [1970, 1980, 1990, 2000, 2010, 2020]; return `<div class="row" style="gap:6px">${decs.map((d) => chip(`Anni ${String(d).slice(2)}`, { on: c?.range?.[0] === d && c?.range?.[1] === d + 9, act: 'decade', data: { v: d } })).join('')}${chip('Dal 2015', { on: c?.min === 2015 && !c.range, act: 'since', data: { v: 2015 } })}${chip('Ultimi 3 anni', { on: c?.min === new Date().getFullYear() - 2, act: 'since', data: { v: new Date().getFullYear() - 2 } })}</div>`; }
    if (tab === 'country') { const cc = getCond(ast, 'country'); const lc = getCond(ast, 'lang'); return `<div class="col" style="gap:8px"><div class="row" style="gap:6px"><span class="lbl">Paese</span>${(f.country || []).slice(0, 24).map(([c, n]) => chip(c, { on: cc?.any?.includes(c), act: 'country', data: { v: c }, n })).join('') || '<span class="muted small">Servono i metadati TMDB (Impostazioni › TMDB).</span>'}</div><div class="row" style="gap:6px"><span class="lbl">Lingua</span>${(f.lang || []).slice(0, 16).map(([c, n]) => chip(c.toUpperCase(), { on: lc?.any?.includes(c), act: 'lang', data: { v: c }, n })).join('')}</div></div>`; }
    if (tab === 'catalog') { const c = getCond(ast, 'catalog'); const p = getCond(ast, 'provider'); return `<div class="col" style="gap:8px"><div class="row" style="gap:6px">${(f.catalog || []).map(([k, n]) => chip(FIELDS.catalog.valueLabel(k), { on: c?.any?.includes(k), act: 'catalog', data: { v: k }, n })).join('')}</div><div class="row" style="gap:6px">${(f.provider || []).map(([k, n]) => chip(k, { on: p?.any?.includes(k), act: 'provider', data: { v: k }, n })).join('')}</div></div>`; }
    if (tab === 'new') return '<p class="muted small" style="margin:0">Serie viste per la prima volta da BingeMap negli ultimi 30 giorni.</p>';
    if (tab === 'sub') return '<p class="muted small" style="margin:0">Serie segnalate dal sito come sottotitolate in italiano.</p>';
    return '';
  }

  function activeChips() {
    const conds = (ast.all || []).filter((c) => c.field);
    const groups = (ast.all || []).filter((c) => !c.field);
    if (!conds.length && !groups.length) return '<span class="muted small">Nessun filtro attivo</span>';
    return '<span class="lbl">Filtri attivi</span>' + conds.map((c, i) => `<button type="button" class="chip on" data-act="rm" data-i="${(ast.all || []).indexOf(c)}" aria-label="Rimuovi ${e(describeCond(c))}">${e(describeCond(c))} ${icon('x', 12)}</button>`).join('') +
      (groups.length ? `<a class="chip on" href="#/filtri">${groups.length} gruppi avanzati</a>` : '') + '<button type="button" class="btn sm ghost" data-act="clear">Azzera</button>';
  }

  function aside(res) {
    const b = res.breakdown; const tot = res.total || 1;
    return `<div class="panel col"><h2 style="font-size:16px">Questi ${fmtNum(res.total)} risultati</h2>
      <div class="bar" aria-hidden="true"><span style="flex:${b.completed};background:var(--done)"></span><span style="flex:${b.plan};background:#C4B5FF"></span><span style="flex:${b.active};background:var(--primary-text)"></span><span style="flex:${b.none};background:var(--neutral)"></span><span style="flex:${b.unknown};background:var(--warn)"></span></div>
      <div class="legend small">
        ${[['s-done', 'Completate', b.completed], ['s-plan', 'Da vedere', b.plan], ['s-watch', 'In corso, in pausa, abbandonate', b.active], ['s-none', 'Non nelle liste', b.none], ['s-unk', 'Incerte', b.unknown]].map(([c, l, n]) => `<div class="between"><span class="${c}"><span class="dot"></span><span style="color:var(--text)">${l}</span></span><span class="num">${fmtNum(n)} · ${Math.round((n / tot) * 100)}%</span></div>`).join('')}
      </div>
      ${res.missingData ? `<p class="muted small" style="margin:0">${fmtNum(res.missingData)} titoli esclusi per dati mancanti.</p>` : ''}
      <button class="btn sm" data-act="hidecompleted">${getCond(ast, 'status')?.none?.includes('completed') ? 'Mostra anche le completate' : 'Nascondi le completate'}</button>
    </div>
    <div class="panel col"><h2 style="font-size:16px">Perché non la vedo?</h2>
      <form class="col" data-why style="gap:8px"><input name="t" placeholder="Scrivi un titolo" aria-label="Titolo da cercare"><button class="btn sm">Controlla</button></form><div data-why-out class="small"></div></div>`;
  }

  root.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-tab],[data-act],[data-more-btn],[data-save],[data-export]');
    if (!t) return;
    if (t.dataset.tab) { tab = t.dataset.tab; ui.catalogTab = tab; apply(ast); return; }
    if (t.hasAttribute('data-more-btn')) { limit += PAGE; draw(); return; }
    if (t.hasAttribute('data-save')) {
      const name = await promptBox('Salva ricerca', '', 'Nome');
      if (!name) return;
      const q = await saveQuery({ name, query: ast, sort, pinned: false });
      toast(`Ricerca «${q.name}» salvata`, 'ok');
      return;
    }
    if (t.hasAttribute('data-export')) {
      const res = await store.query({ ast, sort, limit: 100000 });
      const full = await store.views(res.allCks);
      download(downloadName('bingemap-risultati', 'csv'), resultsCsv(full), 'text/csv');
      if (ev.shiftKey) download(downloadName('bingemap-per-refract', 'csv'), refractCsv(full), 'text/csv');
      toast('Esportazione CSV pronta (Maiusc + clic: anche il formato per Refract)', 'ok');
      return;
    }
    const act = t.dataset.act; const v = t.dataset.v;
    const toggleIn = (field, val, exclude = false) => {
      const c = getCond(ast, field) || {};
      const any = new Set(c.any || []); const none = new Set(c.none || []);
      if (exclude) { any.delete(val); none.has(val) ? none.delete(val) : none.add(val); } else { none.delete(val); any.has(val) ? any.delete(val) : any.add(val); }
      apply(setCond(ast, field, { any: [...any], none: [...none] }));
    };
    if (act === 'quick') QUICK[Number(t.dataset.i)][1]();
    if (act === 'genre') toggleIn('genre', v, ev.altKey);
    if (act === 'letter') { const c = getCond(ast, 'initial'); apply(setCond(ast, 'initial', c?.any?.includes(v) ? null : { any: [v] })); }
    if (act === 'decade') { const d = Number(v); const c = getCond(ast, 'year'); apply(setCond(ast, 'year', c?.range?.[0] === d ? null : { range: [d, d + 9], min: undefined, max: undefined })); }
    if (act === 'since') { const c = getCond(ast, 'year'); apply(setCond(ast, 'year', c?.min === Number(v) ? null : { min: Number(v), range: undefined })); }
    if (act === 'country') toggleIn('country', v);
    if (act === 'lang') toggleIn('lang', v);
    if (act === 'catalog') toggleIn('catalog', v);
    if (act === 'provider') toggleIn('provider', v);
    if (act === 'rm') { const all = [...ast.all]; all.splice(Number(t.dataset.i), 1); apply({ all }); }
    if (act === 'clear') { searchInp.value = ''; apply({ all: [] }); }
    if (act === 'hidecompleted') { const c = getCond(ast, 'status') || {}; const none = new Set(c.none || []); none.has('completed') ? none.delete('completed') : none.add('completed'); apply(setCond(ast, 'status', { any: c.any, none: [...none] })); }
  });
  root.addEventListener('submit', async (ev) => {
    if (!ev.target.matches('[data-why]')) return;
    ev.preventDefault();
    const q = ev.target.t.value.trim(); if (!q) return;
    const out = root.querySelector('[data-why-out]');
    const r = await store.query({ ast: { all: [{ field: 'text', q }] }, limit: 3, showHidden: true });
    if (!r.items.length) { out.innerHTML = '<span class="s-unk">Non è nel catalogo attivo. Guarda in Mancanti o cambia catalogo nelle impostazioni.</span>'; return; }
    const parts = await Promise.all(r.items.map(async (v) => { const reasons = await store.explain(v.ck, ast); return `<div><b>${e(v.name)}</b>: ${reasons.length ? reasons.map(e).join('; ') : '<span class="s-match">soddisfa tutti i filtri</span>'}</div>`; }));
    out.innerHTML = parts.join('');
  });
  $('[data-sort]').addEventListener('change', (ev) => { sort = ev.target.value; ui.catalogSort = sort; apply(ast); });
  searchInp.addEventListener('input', debounce(() => apply(setCond(ast, 'text', { q: searchInp.value.trim() || undefined })), 350));
  void lastSnap; void nav;
  await draw();
}
