// Ricerche salvate e collezioni intelligenti (F69, F70, idea 24).
import { e, toast, modal, confirmBox, promptBox } from '../components.js';
import { icon } from '../icons.js';
import { listQueries, saveQuery, deleteQuery } from '../../library/data.js';
import { presets } from '../../query/presets.js';
import { describe } from '../../query/engine.js';
import { encodeObj, decodeObj, fmtNum } from '../../common/util.js';
import { appUrl } from '../../platform/platform.js';

const COLORS = ['#6D4AFF', '#2DD4BF', '#FB923C', '#60A5FA', '#F87171', '#A68CFF', '#FBBF24'];
const ICONS = ['bookmark', 'star', 'sparkles', 'clock', 'eye', 'heart', 'film', 'compass'];

export async function render(root, { params }, ctx) {
  const { store, ui } = ctx;
  // Ricerca condivisa via link: #/ricerche?import=<codice>
  if (params.get('import')) await importCode(params.get('import'), ctx);
  const qs = await listQueries();
  const counts = await Promise.all(qs.map((q) => store.query({ ast: q.query, limit: 0 })));
  const pre = presets(ui.settings.discovery);
  const preCounts = await Promise.all(pre.map((q) => store.query({ ast: q.query, limit: 0 })));

  root.innerHTML = `<header class="between"><div><h1>Ricerche salvate</h1><p class="muted" style="margin:4px 0 0">Si aggiornano da sole dopo ogni scansione e ogni import. Con «Segui» attivo segnalano le novità.</p></div>
    <div class="row"><button class="btn" data-import>${icon('link')}Importa una ricerca</button><a class="btn p" href="#/filtri">${icon('plus')}Nuova ricerca</a></div></header>
    ${qs.length ? `<div class="grid g3">${qs.map((q, i) => `<article class="panel col" style="gap:10px;border-top:3px solid ${e(q.color)}">
      <div class="between"><a href="#/ricerca/${e(q.id)}" style="font:600 17px Inter,sans-serif;color:var(--text);text-decoration:none" class="row">${icon(q.icon)}${e(q.name)}</a>${q.newIds?.length ? `<span class="s-match small" style="font-weight:600">+${q.newIds.length} nuove</span>` : ''}</div>
      <p class="muted small" style="margin:0">${e(describe(q.query))}</p>
      <div class="row" style="align-items:baseline;gap:8px"><span class="h" style="font-size:30px">${fmtNum(counts[i].total)}</span><span class="muted small">serie</span></div>
      <div class="row small"><label class="check"><input type="checkbox" data-pin="${e(q.id)}" ${q.pinned ? 'checked' : ''}> Fissa in Scopri</label><label class="check"><input type="checkbox" data-follow="${e(q.id)}" ${q.follow ? 'checked' : ''}> Segui</label></div>
      <div class="row" style="gap:6px;margin-top:auto"><button class="btn sm" data-edit="${e(q.id)}">Modifica</button><button class="btn sm" data-filters="${e(q.id)}">Filtri</button><button class="btn sm" data-dup="${e(q.id)}">Duplica</button><button class="btn sm" data-share="${e(q.id)}">Condividi</button><button class="btn sm danger" data-del="${e(q.id)}">Elimina</button></div></article>`).join('')}</div>`
      : `<div class="empty">${icon('bookmark', 28)}<div>Nessuna ricerca salvata: crea i filtri nel catalogo e premi «Salva ricerca», oppure parti da una predefinita qui sotto.</div></div>`}
    <h2>Predefinite</h2>
    <div class="grid g4">${pre.map((p, i) => `<div class="panel col" style="gap:8px"><a href="#/preset/${p.id}" class="row" style="color:var(--text);text-decoration:none;font-weight:600">${icon(p.icon)}${e(p.name)}</a><span class="muted small">${e(describe(p.query))}</span><div class="between"><span class="h" style="font-size:20px">${fmtNum(preCounts[i].total)}</span><button class="btn sm" data-adopt="${i}">Salva come mia</button></div></div>`).join('')}</div>`;

  const byId = new Map(qs.map((q) => [q.id, q]));
  root.addEventListener('change', async (ev) => {
    const t = ev.target;
    if (t.dataset.pin) { await saveQuery({ ...byId.get(t.dataset.pin), pinned: t.checked }); toast(t.checked ? 'Fissata in Scopri' : 'Tolta da Scopri', 'ok'); }
    if (t.dataset.follow) { await saveQuery({ ...byId.get(t.dataset.follow), follow: t.checked }); }
  });
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    const q = byId.get(b.dataset.edit || b.dataset.dup || b.dataset.share || b.dataset.del || b.dataset.filters);
    if (b.dataset.edit) editMeta(q, ctx);
    if (b.dataset.filters) { ui.catalogQuery = q.query; ctx.nav('filtri'); }
    if (b.dataset.dup) { await saveQuery({ ...q, id: undefined, name: q.name + ' (copia)', createdAt: undefined }); ctx.rerender(); }
    if (b.dataset.del && (await confirmBox(`Eliminare «${q.name}»?`, 'Elimina', true))) { await deleteQuery(q.id); ctx.rerender(); }
    if (b.dataset.share) share(q);
    if (b.dataset.adopt) { const p = pre[Number(b.dataset.adopt)]; await saveQuery({ name: p.name, query: p.query, icon: p.icon, color: p.color, pinned: true }); toast('Salvata e fissata in Scopri', 'ok'); ctx.rerender(); }
    if (b.hasAttribute('data-import')) { const code = await promptBox('Importa una ricerca', '', 'Incolla il link o il codice ricevuto'); if (code) { await importCode(code, ctx); ctx.rerender(); } }
  });
}

function share(q) {
  const code = encodeObj({ n: q.name, q: q.query, i: q.icon, c: q.color });
  const link = appUrl('/ricerche?import=' + code);
  const m = modal(`<h2>Condividi «${e(q.name)}»</h2><p class="muted" style="margin:0">Il codice contiene solo i filtri, nessun dato personale. Chi lo apre li applica alla propria libreria.</p>
    <label class="field">Codice<textarea readonly rows="3">${e(code)}</textarea></label><label class="field">Link (funziona dove BingeMap è installato, o nell'app web)<textarea readonly rows="2">${e(link)}</textarea></label>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-copy>Copia codice</button><button class="btn p" data-close>Fatto</button></div>`);
  m.el.querySelector('[data-copy]').addEventListener('click', async () => { await navigator.clipboard.writeText(code); toast('Codice copiato', 'ok'); });
}

async function importCode(raw, ctx) {
  try {
    const code = String(raw).includes('import=') ? String(raw).split('import=')[1].split('&')[0] : String(raw).trim();
    const o = decodeObj(code);
    if (!o.q) throw new Error('Codice non valido');
    await saveQuery({ name: o.n || 'Ricerca importata', query: o.q, icon: o.i, color: o.c });
    ctx.toast(`Ricerca «${o.n}» importata`, 'ok');
    history.replaceState(null, '', '#/ricerche');
  } catch (err) { ctx.toast('Codice non riconosciuto: ' + err.message, 'err'); }
}

function editMeta(q, ctx) {
  const m = modal(`<h2>Modifica ricerca</h2><label class="field">Nome<input data-n value="${e(q.name)}"></label>
    <div class="col" style="gap:6px"><span class="lbl">Icona</span><div class="row" style="gap:6px">${ICONS.map((i) => `<button class="ibtn ${i === q.icon ? 'on' : ''}" data-i="${i}" aria-pressed="${i === q.icon}" aria-label="${i}">${icon(i)}</button>`).join('')}</div></div>
    <div class="col" style="gap:6px"><span class="lbl">Colore</span><div class="row" style="gap:6px">${COLORS.map((c) => `<button class="ibtn" data-c="${c}" aria-pressed="${c === q.color}" aria-label="Colore ${c}" style="background:${c}"></button>`).join('')}</div></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Annulla</button><button class="btn p" data-save>Salva</button></div>`);
  let ic = q.icon; let col = q.color;
  m.el.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.i) { ic = b.dataset.i; m.el.querySelectorAll('[data-i]').forEach((x) => x.setAttribute('aria-pressed', x === b)); m.el.querySelectorAll('[data-i]').forEach((x) => { x.style.borderColor = x === b ? 'var(--primary)' : ''; }); }
    if (b.dataset.c) { col = b.dataset.c; m.el.querySelectorAll('[data-c]').forEach((x) => { x.style.outline = x === b ? '2px solid var(--text)' : ''; }); }
    if (b.hasAttribute('data-save')) { await saveQuery({ ...q, name: m.el.querySelector('[data-n]').value.trim() || q.name, icon: ic, color: col }); m.close(); ctx.rerender(); }
  });
}
