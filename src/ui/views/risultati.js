// Risultati di una ricerca salvata o predefinita, con il perché di ogni consiglio.
import { e, statusBadge, stars, toast, download, poster } from '../components.js';
import { icon } from '../icons.js';
import { get } from '../../db/db.js';
import { presets, moods } from '../../query/presets.js';
import { describe, SORTS } from '../../query/engine.js';
import { notInterested, snooze, setOverlay, markQuerySeen } from '../../library/data.js';
import { resultsCsv, refractCsv, downloadName } from '../../backup/backup.js';
import { fmtNum, fmtDec, encodeObj } from '../../common/util.js';
import { surpriseDialog } from './scopri.js';

export async function render(root, { name, args, params }, ctx) {
  const { store, ui } = ctx;
  const id = args[0];
  let q = null;
  if (name === 'preset') q = [...presets(ui.settings.discovery), ...moods(ui.settings.discovery)].find((p) => p.id === id);
  else q = await get('saved_queries', id);
  if (!q) { root.innerHTML = `<div class="notice warn">${icon('alert')}<div>Ricerca non trovata. <a href="#/ricerche">Torna alle ricerche</a></div></div>`; return; }
  let sort = params.get('sort') || q.sort || 'reco';
  let limit = 40;
  const newIds = new Set(q.newIds || []);

  const draw = async () => {
    const res = await store.query({ ast: q.query, sort, limit, withReco: true });
    const full = await store.views(res.items.map((x) => x.ck));
    const why = new Map(res.items.map((x) => [x.ck, x.why]));
    root.innerHTML = `<header class="between"><div><div class="lbl">${name === 'preset' ? 'Ricerca predefinita' : 'Ricerca salvata'}</div><h1 style="margin-top:6px" class="row">${icon(q.icon || 'bookmark', 22)}${e(q.name)}</h1>
      <p class="muted" style="margin:6px 0 0">${e(describe(q.query))} · ${fmtNum(res.total)} serie${newIds.size ? ` · <span class="s-match">${newIds.size} nuove dall'ultima volta</span>` : ''}</p></div>
      <div class="row"><select data-sort aria-label="Ordina">${Object.entries(SORTS).map(([k, s]) => `<option value="${k}" ${k === sort ? 'selected' : ''}>${e(s.label)}</option>`).join('')}</select>
      <button class="btn" data-filters>${icon('filter', 16)}Modifica filtri</button><button class="btn p" data-surprise>${icon('dice', 16)}Sorprendimi da qui</button>
      ${newIds.size && name !== 'preset' ? '<button class="btn" data-seen>Segna le novità come viste</button>' : ''}<button class="btn" data-export>${icon('download', 16)}CSV</button><button class="btn" data-refract title="Formato per l\'import CSV di Refract">${icon('download', 16)}Per Refract</button></div></header>
      <ol class="col" style="list-style:none;margin:0;padding:0;gap:12px">${full.map((v) => {
        const w = why.get(v.ck) || [];
        return `<li class="card row" style="padding:14px;gap:18px;align-items:center" data-open="${e(v.ck)}">
          <div style="width:84px;flex:0 0 84px">${poster(v)}</div>
          <div class="col" style="flex:1 1 360px;min-width:0;gap:6px">
            <div class="row" style="gap:10px"><a href="#/serie/${encodeURIComponent(v.ck)}" style="font:600 18px Inter,sans-serif;color:var(--text);text-decoration:none">${e(v.name)}</a>${statusBadge(v.status)}${newIds.has(v.ck) ? '<span class="tag s-match">Nuova</span>' : ''}${[...Object.values(v.impTags).flat(), ...v.userTags].slice(0, 3).map((t) => `<span class="tag">${e(t)}</span>`).join('')}</div>
            <div class="muted small">${e([v.year, v.genreLabels.join(', '), v.seasons ? `${v.seasons} stagioni` : '', v.episodes ? `${v.episodes} episodi` : '', v.hours ? `circa ${fmtDec(v.hours, 0)} ore` : ''].filter(Boolean).join(' · '))}</div>
            ${w.length ? `<div class="row s-match small" style="gap:8px">${icon('sparkles', 16)}<span>Perché: ${e(w.join('; '))}</span></div>` : ''}
          </div>
          ${stars(v.score)}
          <div class="row" style="gap:6px"><button class="btn sm" data-noint="${e(v.ck)}">${icon('ban', 14)}Non mi interessa</button><button class="btn sm" data-snooze="${e(v.ck)}">${icon('clock', 14)}Rimanda 30 giorni</button><button class="btn sm" data-seenit="${e(v.ck)}">${icon('check', 14)}L'ho già vista</button><a class="btn sm p" href="#/serie/${encodeURIComponent(v.ck)}">Apri</a></div></li>`;
      }).join('') || `<li class="empty">${icon('search', 28)}<div>Nessuna serie per questa ricerca.</div></li>`}</ol>
      ${res.total > limit ? '<div class="row" style="justify-content:center"><button class="btn" data-more>Mostra altre</button></div>' : ''}`;
  };
  await draw();

  root.addEventListener('change', (ev) => { if (ev.target.matches('[data-sort]')) { sort = ev.target.value; draw(); } });
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    ev.stopPropagation();
    if (b.hasAttribute('data-more')) { limit += 40; return draw(); }
    if (b.hasAttribute('data-filters')) { ui.catalogQuery = q.query; return ctx.nav('catalogo?q=' + encodeObj(q.query)); }
    if (b.hasAttribute('data-surprise')) return surpriseDialog(ctx, q.query);
    if (b.hasAttribute('data-seen')) { const r = await store.query({ ast: q.query, limit: 0 }); await markQuerySeen(q.id, r.allCks); const cur = await get('saved_queries', q.id); delete cur.newIds; const { put } = await import('../../db/db.js'); await put('saved_queries', cur); newIds.clear(); toast('Novità segnate come viste', 'ok'); return draw(); }
    if (b.hasAttribute('data-export') || b.hasAttribute('data-refract')) {
      const r = await store.query({ ast: q.query, sort, limit: 100000 }); const full = await store.views(r.allCks);
      if (b.hasAttribute('data-refract')) download(downloadName('bingemap-per-refract', 'csv'), refractCsv(full), 'text/csv');
      else download(downloadName('bingemap-' + q.name.toLowerCase().replace(/\W+/g, '-'), 'csv'), resultsCsv(full), 'text/csv');
      return;
    }
    if (b.dataset.noint) { await notInterested(b.dataset.noint); toast('Non verrà più proposta', 'ok'); }
    if (b.dataset.snooze) { await snooze(b.dataset.snooze, 30); toast('Rimandata di 30 giorni', 'ok'); }
    if (b.dataset.seenit) { await setOverlay(b.dataset.seenit, { status: 'completed' }); toast('Segnata come vista', 'ok'); }
    await store.changed(true); draw();
  });
}
