// La mia libreria: fonti, righe importate, coda «Da confermare», tag, conflitti, storico.
import { e, statusBadge, toast, confirmBox, promptBox } from '../components.js';
import { icon } from '../icons.js';
import { getAll, get } from '../../db/db.js';
import { SOURCES } from '../../import/sources.js';
import { undoImport } from '../../import/pipeline.js';
import { setRule, runMatching } from '../../match/run.js';
import { METHOD_LABEL } from '../../match/matcher.js';
import { setAlias, addTagRule, deleteTagRule, setOverlay } from '../../library/data.js';
import { mergeSuggestions } from '../../library/tags.js';
import { fmtDate, fmtNum, encodeObj, lowerKey } from '../../common/util.js';
import { STATUS_LABEL } from '../../library/status.js';

const TABS = [['fonti', 'Fonti'], ['righe', 'Righe importate'], ['coda', 'Da confermare'], ['tag', 'Tag'], ['conflitti', 'Conflitti'], ['storico', 'Storico import']];

export async function render(root, { args }, ctx) {
  const { store } = ctx;
  const tab = args[0] || 'fonti';
  const [items, batches, matches, catalog] = await Promise.all([getAll('library_items'), getAll('import_batches'), getAll('matches'), getAll('catalog_titles')]);
  const live = items.filter((i) => !i.gone && batches.find((b) => b.id === i.batchId)?.status !== 'undone');
  const queue = matches.filter((m) => m.state === 'queue');
  const catMap = new Map(catalog.map((c) => [c.ck, c]));
  const itemMap = new Map(live.map((i) => [i.key, i]));
  const conflicts = await store.conflicts();
  const counts = { righe: live.length, coda: new Set(queue.map((q) => q.itemKey)).size, conflitti: conflicts.length };
  const sourcesUsed = [...new Set(live.map((i) => i.source))];

  root.innerHTML = `<header class="between"><div><h1>La mia libreria</h1><p class="muted" style="margin:4px 0 0">${fmtNum(live.length)} righe da ${sourcesUsed.length} fonti · i dati originali non vengono mai modificati</p></div>
    <a class="btn p" href="#/import">${icon('upload')}Importa liste</a></header>
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<a role="tab" class="btn sm" aria-selected="${k === tab}" href="#/libreria/${k}">${e(l)}${counts[k] != null ? ` · ${fmtNum(counts[k])}` : ''}</a>`).join('')}</div>
    <div data-body></div>`;
  const body = root.querySelector('[data-body]');

  if (tab === 'fonti') {
    const bySource = new Map();
    for (const i of live) { if (!bySource.has(i.source)) bySource.set(i.source, []); bySource.get(i.source).push(i); }
    const matched = new Set(matches.filter((m) => m.state === 'auto' || m.state === 'manual').map((m) => m.itemKey));
    body.innerHTML = bySource.size ? `<div class="grid g3">${[...bySource].map(([s, list]) => {
      const last = batches.filter((b) => b.source === s && b.status === 'active').sort((a, b) => b.date - a.date)[0];
      const ok = list.filter((i) => matched.has(i.key)).length;
      return `<div class="panel col" style="gap:8px"><div class="between"><b style="font-size:17px">${e(SOURCES[s] || s)}</b><a class="btn sm" href="#/import/${s}">Reimporta</a></div>
        <div class="row small"><span>${fmtNum(list.length)} righe</span><span class="s-match">${fmtNum(ok)} riconosciute</span></div>
        <span class="muted small">Ultimo import: ${last ? fmtDate(last.date, true) : '—'}</span></div>`;
    }).join('')}</div>` : `<div class="empty">${icon('library', 28)}<div>Nessuna lista importata.</div><a class="btn p" href="#/import">Importa la prima lista</a></div>`;
  }

  if (tab === 'righe') {
    const mm = new Map(); for (const m of matches) { const prev = mm.get(m.itemKey); if (!prev || rank(m.state) > rank(prev.state)) mm.set(m.itemKey, m); }
    body.innerHTML = `<div class="row"><label class="search" style="flex:1">${icon('search')}<input data-filter placeholder="Filtra righe" aria-label="Filtra righe"></label>
      <select data-src aria-label="Fonte"><option value="">Tutte le fonti</option>${sourcesUsed.map((s) => `<option value="${s}">${e(SOURCES[s] || s)}</option>`).join('')}</select></div>
      <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Titolo</th><th>Anno</th><th>Fonte</th><th>Stato</th><th>Voto</th><th>Tag</th><th>Riconoscimento</th></tr></thead><tbody data-rows></tbody></table></div>`;
    const draw = () => {
      const q = body.querySelector('[data-filter]').value.toLowerCase(); const src = body.querySelector('[data-src]').value;
      const rows = live.filter((i) => (!src || i.source === src) && (!q || i.title.toLowerCase().includes(q))).slice(0, 500);
      body.querySelector('[data-rows]').innerHTML = rows.map((i) => {
        const m = mm.get(i.key); const c = m?.ck ? catMap.get(m.ck) : null;
        const rec = !m ? '<span class="muted">—</span>' : m.state === 'queue' ? '<a href="#/libreria/coda" class="s-unk">Da confermare</a>' : m.state === 'none' ? '<span class="s-unk">Non nel catalogo</span>' : m.state === 'ignored' ? '<span class="muted">Ignorata</span>' : `<a href="#/serie/${encodeURIComponent(m.ck)}" class="s-match">${e(c?.name || m.ck)} · ${m.confidence}</a>`;
        return `<tr><td>${e(i.title)}</td><td>${i.year ?? ''}</td><td>${e(SOURCES[i.source] || i.source)}</td><td>${statusBadge(i.status)}</td><td>${i.rating ?? ''}</td><td>${(i.tags || []).map((t) => `<span class="tag imp">${e(t)}</span>`).join(' ')}</td><td>${rec}</td></tr>`;
      }).join('');
    };
    body.addEventListener('input', draw); body.addEventListener('change', draw); draw();
  }

  if (tab === 'coda') {
    const groups = new Map(); for (const q of queue) if (!groups.has(q.itemKey)) groups.set(q.itemKey, q);
    const list = [...groups.values()].filter((q) => itemMap.has(q.itemKey));
    body.innerHTML = list.length ? `<p class="muted small" style="margin:0">Scorciatoie sulla prima riga: <kbd>Invio</kbd> conferma · <kbd>A</kbd> alternativa · <kbd>N</kbd> nessuna · <kbd>→</kbd> salta. Ogni scelta resta valida anche nei prossimi import.</p>
      <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Riga importata</th><th>Candidato migliore</th><th>Alternativa</th><th>Azioni</th></tr></thead><tbody>${list.map((q, i) => {
        const it = itemMap.get(q.itemKey); const c1 = q.candidates?.[0]; const c2 = q.candidates?.[1];
        const name = (c) => { const x = catMap.get(c.ck); return x ? `${e(x.name)}${x.year ? ` (${x.year})` : ''}` : e(c.ck); };
        return `<tr data-row="${i}"><td><b>«${e(it.title)}»</b>${it.year ? ` · ${it.year}` : ' · senza anno'} · ${e(SOURCES[it.source] || it.source)}</td>
          <td>${c1 ? `${name(c1)} <span class="s-unk small" style="font-weight:600">${c1.score}</span><div class="muted small">${e(METHOD_LABEL[c1.method] || '')}</div>` : '—'}</td>
          <td class="muted">${c2 ? `${name(c2)} <span class="small">${c2.score}</span>` : '—'}</td>
          <td><span class="row" style="gap:6px"><button class="btn sm p" data-ok="${i}">Conferma</button>${c2 ? `<button class="btn sm" data-alt="${i}">Alternativa</button>` : ''}<button class="btn sm" data-none="${i}">Nessuna</button></span></td></tr>`;
      }).join('')}</tbody></table></div>` : `<div class="empty">${icon('check', 28)}<div>Nessuna corrispondenza da confermare.</div></div>`;
    const decide = async (i, kind) => {
      const q = list[i]; if (!q) return;
      if (kind === 'ok') await setRule(q.itemKey, q.catalog, { accept: q.candidates[0].ck });
      if (kind === 'alt') await setRule(q.itemKey, q.catalog, { accept: q.candidates[1].ck });
      if (kind === 'none') await setRule(q.itemKey, q.catalog, { reject: q.candidates.map((c) => c.ck), accept: null });
      await runMatching(); await store.changed(true); ctx.rerender();
    };
    body.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; for (const k of ['ok', 'alt', 'none']) if (b.dataset[k] != null) decide(Number(b.dataset[k]), k); });
    const onKey = (ev) => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || !list.length) return;
      if (ev.key === 'Enter') decide(0, 'ok'); if (ev.key.toLowerCase() === 'a' && list[0].candidates?.[1]) decide(0, 'alt'); if (ev.key.toLowerCase() === 'n') decide(0, 'none');
      if (ev.key === 'ArrowRight') { list.push(list.shift()); body.querySelector('tbody')?.appendChild(body.querySelector('tbody tr')); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }

  if (tab === 'tag') {
    const tags = await store.tagIndex();
    const [aliases, rules] = await Promise.all([getAll('tag_aliases'), getAll('tag_rules')]);
    const sugg = mergeSuggestions(tags.filter((t) => t.source !== 'user').map((t) => t.name));
    body.innerHTML = `<div class="split"><div class="grow"><div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Tag</th><th>Fonte</th><th>Serie</th><th>Azioni</th></tr></thead><tbody>${tags.map((t) => `<tr><td><span class="tag ${t.source !== 'user' ? 'imp' : ''}">${e(t.name)}</span></td><td>${e(t.source === 'user' ? 'Personale' : SOURCES[t.source] || t.source)}</td><td>${t.count}</td>
        <td>${t.source !== 'user' ? `<button class="btn sm" data-rename="${e(t.source)}|${e(t.name)}">Rinomina in BingeMap</button>` : ''} <a class="btn sm" href="#/catalogo?q=${encodeObj({ all: [{ field: 'tag', any: [(t.source === 'user' ? '' : t.source + ':') + lowerKey(t.name)] }] })}">Filtra</a></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nessun tag.</td></tr>'}</tbody></table></div></div>
      <aside class="aside">
        <div class="panel col"><h2 style="font-size:16px">Unioni suggerite</h2>${sugg.length ? sugg.map((g) => `<div class="col" style="gap:6px"><div class="row" style="gap:6px">${g.map((n) => `<span class="tag imp">${e(n)}</span>`).join('')}</div><button class="btn sm" data-merge="${e(JSON.stringify(g))}">Unisci come «${e(g[0])}»</button></div>`).join('') : '<span class="muted small">Nessun tag simile da unire.</span>'}</div>
        <div class="panel col"><h2 style="font-size:16px">Alias attivi</h2>${aliases.map((a) => `<div class="between small"><span>${e(SOURCES[a.source] || a.source)}: ${e(a.from)} → <b>${e(a.name)}</b></span><button class="ibtn" data-unalias="${e(a.source)}|${e(a.from)}" aria-label="Togli alias">${icon('x', 14)}</button></div>`).join('') || '<span class="muted small">Nessun alias. I nomi originali restano sempre nella fonte.</span>'}</div>
        <div class="panel col"><h2 style="font-size:16px">Regole automatiche</h2>${rules.map((r) => `<div class="between small"><span>Se ${e(r.ifSource === '*' ? 'una fonte' : SOURCES[r.ifSource] || r.ifSource)} ha «${e(r.ifTag)}» → «${e(r.thenTag)}»</span><button class="ibtn" data-delrule="${e(r.id)}" aria-label="Elimina regola">${icon('x', 14)}</button></div>`).join('') || '<span class="muted small">Nessuna regola.</span>'}
          <form class="col" data-rule style="gap:6px"><select name="src"><option value="*">Qualsiasi fonte</option>${sourcesUsed.map((s) => `<option value="${s}">${e(SOURCES[s] || s)}</option>`).join('')}</select><input name="if" placeholder="Se ha il tag…" required><input name="then" placeholder="…aggiungi il tag" required><button class="btn sm">Aggiungi regola</button></form></div>
      </aside></div>`;
    body.addEventListener('click', async (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.rename) { const [src, name] = b.dataset.rename.split('|'); const nn = await promptBox(`Nome in BingeMap per «${name}»`, name, 'Il nome originale nella fonte non cambia'); if (nn) { await setAlias(src, name, nn); await store.changed(true); ctx.rerender(); } }
      if (b.dataset.merge) { const g = JSON.parse(b.dataset.merge); for (const t of tags.filter((x) => g.includes(x.name) && x.source !== 'user')) if (t.name !== g[0]) await setAlias(t.source, t.name, g[0]); toast('Tag uniti in BingeMap', 'ok'); await store.changed(true); ctx.rerender(); }
      if (b.dataset.unalias) { const [src, name] = b.dataset.unalias.split('|'); await setAlias(src, name, null); await store.changed(true); ctx.rerender(); }
      if (b.dataset.delrule) { await deleteTagRule(b.dataset.delrule); await store.changed(true); ctx.rerender(); }
    });
    body.querySelector('[data-rule]').addEventListener('submit', async (ev) => { ev.preventDefault(); const f = ev.target; await addTagRule({ ifSource: f.src.value, ifTag: f.if.value.trim(), thenTag: f.then.value.trim() }); toast('Regola aggiunta', 'ok'); await store.changed(true); ctx.rerender(); });
  }

  if (tab === 'conflitti') {
    body.innerHTML = conflicts.length ? `<p class="muted small" style="margin:0">Le fonti dicono cose diverse. Scegli lo stato giusto: diventa lo stato di BingeMap e le fonti restano come sono.</p>
      <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Serie</th><th>Per fonte</th><th>Mostrato ora</th><th>Scegli</th></tr></thead><tbody>${conflicts.map((c) => `<tr><td><a href="#/serie/${encodeURIComponent(c.ck)}">${e(c.name)}</a></td>
        <td>${Object.entries(c.statusBySource).map(([s, st]) => `<div>${e(SOURCES[s] || s)}: ${statusBadge(st)}</div>`).join('')}</td><td>${statusBadge(c.status)}</td>
        <td><span class="row" style="gap:6px">${[...new Set(Object.values(c.statusBySource))].map((st) => `<button class="btn sm" data-pick="${e(c.ck)}|${st}">${e(STATUS_LABEL[st])}</button>`).join('')}</span></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${icon('check', 28)}<div>Nessun conflitto tra le fonti.</div></div>`;
    body.addEventListener('click', async (ev) => { const b = ev.target.closest('[data-pick]'); if (!b) return; const [ck, st] = b.dataset.pick.split('|'); await setOverlay(ck, { status: st }); toast('Stato scelto', 'ok'); await store.changed(true); ctx.rerender(); });
  }

  if (tab === 'storico') {
    const list = [...batches].sort((a, b) => b.date - a.date);
    body.innerHTML = `<div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Fonte</th><th>File</th><th>Righe</th><th>Nuove</th><th>Cambiate</th><th>Tolte</th><th>Stato</th><th></th></tr></thead><tbody>${list.map((b) => `<tr><td>${fmtDate(b.date, true)}</td><td>${e(SOURCES[b.source] || b.source)}</td><td>${e(b.fileName || '—')}</td><td>${b.counts.rows}</td><td>${b.counts.added}</td><td>${b.counts.updated}</td><td>${b.counts.removed}</td><td>${b.status === 'undone' ? '<span class="muted">Annullato</span>' : '<span class="s-match">Attivo</span>'}</td>
      <td>${b.status === 'active' ? `<button class="btn sm danger" data-undo="${e(b.id)}">Annulla import</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Nessun import.</td></tr>'}</tbody></table></div>`;
    body.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-undo]'); if (!b) return;
      const newer = list.some((x) => x.status === 'active' && x.date > (batches.find((y) => y.id === b.dataset.undo)?.date || 0) && x.source === batches.find((y) => y.id === b.dataset.undo)?.source);
      if (!(await confirmBox(newer ? 'Ci sono import più recenti della stessa fonte: annullare questo ripristina lo stato di prima anche per quelle righe. Continuare?' : 'Annullare questo import? Le righe tornano com\'erano prima.', 'Annulla import', true))) return;
      try { await undoImport(b.dataset.undo); toast('Import annullato', 'ok'); await store.changed(true); ctx.rerender(); } catch (err) { toast(err.message, 'err'); }
    });
  }
  void get;
}

const rank = (s) => ({ manual: 4, auto: 3, queue: 2, ignored: 1, none: 0 }[s] ?? 0);
