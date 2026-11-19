// Costruttore di filtri (F61): condizioni E, gruppi O, esclusioni NON, conteggio dal vivo.
import { e, chip, toast, promptBox } from '../components.js';
import { icon } from '../icons.js';
import { FIELDS, describe, facets as _f } from '../../query/engine.js';
import { encodeObj, fmtNum, debounce } from '../../common/util.js';
import { saveQuery } from '../../library/data.js';
import { parseNatural } from '../../query/nlp.js';

void _f;

export async function render(root, _p, ctx) {
  const { store, ui, nav } = ctx;
  let ast = structuredClone(ui.catalogQuery || { all: [] });
  if (!ast.all) ast = { all: [ast] };
  let facetCache = {};

  const groups = {};
  for (const [k, d] of Object.entries(FIELDS)) { if (k === 'text' || k === 'initial') continue; (groups[d.group] ||= []).push([k, d]); }

  root.innerHTML = `
    <header class="between"><div><h1>Costruttore di filtri</h1><p class="muted" style="margin:4px 0 0">Tra condizioni diverse vale E. Dentro un campo scegli «almeno uno» o «tutti». Alt + clic su un valore per escluderlo. I gruppi O valgono se almeno una condizione è vera.</p></div>
      <a class="btn" href="#/catalogo">${icon('x', 16)}Chiudi</a></header>
    <form class="search" data-nlp>${icon('wand')}<input name="q" placeholder="Oppure scrivi: «mystery coreane concluse voto almeno 8»" aria-label="Filtri a parole"><button class="btn sm">Applica testo</button></form>
    <div class="panel row" style="border-color:var(--primary);align-items:flex-start">${icon('filter', 20, 's-watch')}<p style="margin:0;font-size:16px;line-height:1.5" data-sentence></p></div>
    <div class="split">
      <nav class="panel col" style="flex:1 1 240px;max-width:290px;gap:14px" aria-label="Campi">${Object.entries(groups).map(([g, fs]) => `<div class="col" style="gap:2px"><div class="lbl">${e(g)}</div>${fs.map(([k, d]) => `<button type="button" class="btn sm ghost" style="justify-content:space-between" data-add="${k}">${e(d.label)}${icon('plus', 14)}</button>`).join('')}</div>`).join('')}</nav>
      <div class="grow" data-conds></div>
      <aside class="aside" style="max-width:300px">
        <div class="panel col"><div class="lbl">Risultato</div><div class="h" style="font-size:44px;line-height:1" data-count>…</div><p class="muted small" style="margin:0" data-missing></p>
          <button class="btn p" data-apply>Applica</button><button class="btn" data-save>${icon('bookmark', 16)}Salva come ricerca</button><button class="btn" data-group>${icon('plus', 16)}Aggiungi un gruppo O</button><button class="btn" data-reset>Azzera</button></div>
      </aside>
    </div>`;
  const $ = (s) => root.querySelector(s);

  const refreshCount = debounce(async () => {
    const r = await store.query({ ast, limit: 0, facetFields: ['genre', 'tag', 'impTag', 'userTag', 'country', 'lang', 'tmdbStatus', 'status', 'list', 'provider', 'catalog'] });
    facetCache = r.facets;
    $('[data-count]').innerHTML = `${fmtNum(r.total)} <span style="font-size:18px">serie</span>`;
    $('[data-missing]').textContent = r.missingData ? `${fmtNum(r.missingData)} titoli esclusi per dati mancanti.` : '';
  }, 200);

  function condEditor(c, path) {
    const neg = !!c.not; const cond = c.not || c; const d = FIELDS[cond.field];
    if (!d) return '';
    let body = '';
    if (d.type === 'set' || d.type === 'enum') {
      const vals = (facetCache[cond.field] || []).slice(0, 40);
      const label = (x) => (d.valueLabel ? d.valueLabel(x) : x);
      const known = new Set(vals.map(([x]) => x));
      const extra = [...(cond.any || []), ...(cond.all || []), ...(cond.none || [])].filter((x) => !known.has(x)).map((x) => [x, 0]);
      body = `<div class="row" style="gap:6px">${[...vals, ...extra].map(([x, n]) => chip(label(x), { on: (cond.any || []).includes(x) || (cond.all || []).includes(x), ex: (cond.none || []).includes(x), act: 'val', data: { p: path, v: x }, n })).join('') || '<span class="muted small">Nessun valore disponibile con i dati attuali.</span>'}</div>
        <div class="row small"><label class="row" style="gap:6px"><input type="text" placeholder="Aggiungi valore" data-addval="${path}" style="min-height:34px"></label></div>`;
    } else if (d.type === 'num') {
      const lo = cond.range ? cond.range[0] : cond.min; const hi = cond.range ? cond.range[1] : cond.max;
      body = `<div class="row"><label class="row" style="gap:6px">da <input type="number" step="any" value="${lo ?? ''}" data-num="${path}" data-k="min" style="width:110px"></label><label class="row" style="gap:6px">a <input type="number" step="any" value="${hi ?? ''}" data-num="${path}" data-k="max" style="width:110px"></label></div>`;
    } else if (d.type === 'bool') {
      body = `<select data-bool="${path}"><option value="">Indifferente</option><option value="1" ${cond.eq === true ? 'selected' : ''}>Sì</option><option value="0" ${cond.eq === false ? 'selected' : ''}>No</option></select>`;
    } else if (d.type === 'date') {
      body = `<label class="row" style="gap:6px">negli ultimi <input type="number" min="1" value="${cond.withinDays ?? ''}" data-days="${path}" style="width:90px"> giorni</label>`;
    }
    const mode = d.type === 'set' ? `<span class="row" style="gap:4px">${chip('almeno uno', { on: !cond.all?.length, act: 'mode', data: { p: path, m: 'any' } })}${chip('tutti', { on: !!cond.all?.length, act: 'mode', data: { p: path, m: 'all' } })}</span>` : '';
    return `<div class="panel col" style="gap:10px;${neg ? 'border-color:var(--danger)' : ''}">
      <div class="between"><b>${neg ? 'NON · ' : ''}${e(d.label)}</b><span class="row" style="gap:6px">${mode}<button type="button" class="btn sm ghost" data-act="neg" data-p="${path}">${neg ? 'Includi' : 'Escludi (NON)'}</button><button type="button" class="ibtn" data-act="del" data-p="${path}" aria-label="Rimuovi la condizione ${e(d.label)}">${icon('x', 16)}</button></span></div>${body}</div>`;
  }

  function draw() {
    $('[data-sentence]').textContent = describe(ast);
    const parts = ast.all.map((c, i) => {
      if (!c.field && c.any) return `<div class="panel col" style="border-style:dashed;gap:10px"><div class="between"><b>Gruppo O: basta una condizione</b><span class="row"><select data-gadd="${i}" aria-label="Aggiungi al gruppo"><option value="">+ condizione</option>${Object.entries(FIELDS).filter(([k]) => k !== 'text' && k !== 'initial').map(([k, d]) => `<option value="${k}">${e(d.label)}</option>`).join('')}</select><button class="ibtn" data-act="del" data-p="${i}" aria-label="Rimuovi il gruppo">${icon('x', 16)}</button></span></div>${c.any.map((g, j) => condEditor(g, `${i}.${j}`)).join('') || '<span class="muted small">Gruppo vuoto</span>'}</div>`;
      if (c.field === 'text') return `<div class="panel row"><b>Testo:</b> «${e(c.q || '')}» <button class="ibtn" data-act="del" data-p="${i}" aria-label="Rimuovi">${icon('x', 16)}</button></div>`;
      return condEditor(c, String(i));
    });
    $('[data-conds]').innerHTML = parts.join('') || `<div class="empty">${icon('filter', 28)}<div>Nessuna condizione: aggiungi un campo dalla colonna a sinistra.</div></div>`;
    refreshCount();
  }

  const at = (path) => {
    const [a, b] = path.split('.').map(Number);
    if (b == null) return { get: () => ast.all[a], set: (v) => { if (v == null) ast.all.splice(a, 1); else ast.all[a] = v; } };
    return { get: () => ast.all[a].any[b], set: (v) => { if (v == null) ast.all[a].any.splice(b, 1); else ast.all[a].any[b] = v; } };
  };
  const inner = (c) => c.not || c;
  const rewrap = (orig, cond) => (orig.not ? { not: cond } : cond);

  root.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button, [data-add]');
    if (!t) return;
    if (t.dataset.add) { ast.all.push({ field: t.dataset.add }); draw(); return; }
    if (t.hasAttribute('data-group')) { ast.all.push({ any: [] }); draw(); return; }
    if (t.hasAttribute('data-reset')) { ast = { all: [] }; draw(); return; }
    if (t.hasAttribute('data-apply')) { ui.catalogQuery = clean(ast); nav('catalogo?q=' + encodeObj(ui.catalogQuery)); return; }
    if (t.hasAttribute('data-save')) { const name = await promptBox('Salva ricerca', '', 'Nome'); if (!name) return; await saveQuery({ name, query: clean(ast) }); toast('Ricerca salvata', 'ok'); return; }
    const act = t.dataset.act; const p = t.dataset.p;
    if (!act || p == null) return;
    const ref = at(p); const orig = ref.get(); const c = inner(orig);
    if (act === 'del') ref.set(null);
    if (act === 'neg') ref.set(orig.not ? orig.not : { not: orig });
    if (act === 'mode') { const vals = [...(c.any || []), ...(c.all || [])]; ref.set(rewrap(orig, { ...c, any: t.dataset.m === 'any' ? vals : [], all: t.dataset.m === 'all' ? vals : [] })); }
    if (act === 'val') {
      const v = t.dataset.v; const key = c.all?.length ? 'all' : 'any';
      const inc = new Set(c[key] || []); const none = new Set(c.none || []);
      if (ev.altKey) { inc.delete(v); none.has(v) ? none.delete(v) : none.add(v); } else { none.delete(v); inc.has(v) ? inc.delete(v) : inc.add(v); }
      ref.set(rewrap(orig, { ...c, [key]: [...inc], none: [...none] }));
    }
    draw();
  });
  root.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.gadd !== undefined && t.value) { ast.all[Number(t.dataset.gadd)].any.push({ field: t.value }); draw(); return; }
    const p = t.dataset.num ?? t.dataset.bool ?? t.dataset.days ?? t.dataset.addval;
    if (p == null) return;
    const ref = at(p); const orig = ref.get(); const c = { ...inner(orig) };
    if (t.dataset.num != null) { const v = t.value === '' ? undefined : Number(t.value); delete c.range; c[t.dataset.k] = v; }
    if (t.dataset.bool != null) c.eq = t.value === '' ? undefined : t.value === '1';
    if (t.dataset.days != null) c.withinDays = t.value === '' ? undefined : Number(t.value);
    if (t.dataset.addval != null && t.value.trim()) { const key = c.all?.length ? 'all' : 'any'; c[key] = [...new Set([...(c[key] || []), t.value.trim().toLowerCase()])]; }
    ref.set(rewrap(orig, c));
    draw();
  });
  root.querySelector('[data-nlp]').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const { query, understood } = parseNatural(ev.target.q.value);
    if (!query.all.length) { toast('Non ho riconosciuto filtri in quel testo', 'err'); return; }
    ast = { all: [...ast.all, ...query.all] };
    toast(`Aggiunti: ${understood.join(', ')}`, 'ok');
    draw();
  });

  // Prima i conteggi (per i valori dei campi), poi il disegno.
  await (async () => { const r = await store.query({ ast, limit: 0, facetFields: ['genre', 'tag', 'impTag', 'userTag', 'country', 'lang', 'tmdbStatus', 'status', 'list', 'provider', 'catalog'] }); facetCache = r.facets; })();
  draw();
}

function clean(ast) {
  const ok = (c) => (c.field ? true : c.any ? c.any.length > 0 : c.not ? ok(c.not) : true);
  return { all: (ast.all || []).filter(ok) };
}
