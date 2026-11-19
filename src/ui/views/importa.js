// Import guidato: fonte → file o accesso → mappatura (se serve) → anteprima con diff → report.
import { e, toast, pickFiles, fileWrap, busy, statusBadge } from '../components.js';
import { icon } from '../icons.js';
import { SOURCES, parseImdb, parseFiles, parseZip, parseManual, rowsFromRecords, suggestMapping, parseCsv, parseXlsx } from '../../import/sources.js';
import { previewImport, commitImport } from '../../import/pipeline.js';
import { connectSimkl, fetchSimklLibrary, simklConnected, simklRedirect } from '../../import/simkl.js';
import { getSetting, setSetting } from '../../db/db.js';
import { hash, fmtNum } from '../../common/util.js';
import { STATUS_LABEL } from '../../library/status.js';
import { isExtension } from '../../platform/platform.js';
import { writeFolderBackup } from '../folder.js';

const CARDS = [
  ['simkl', 'SIMKL', 'Accesso diretto: tutta la libreria con stati, voti e ID.', 'link'],
  ['refract', 'Refract', 'ZIP da Impostazioni › Export & Backup.', 'upload'],
  ['trakt', 'Trakt', 'ZIP del backup (cartelle JSON).', 'upload'],
  ['imdb', 'IMDb', 'CSV di watchlist, voti o liste (Esporta).', 'upload'],
  ['tvtime', 'TV Time', 'File salvati prima della chiusura (GDPR o TV Time Out).', 'upload'],
  ['showly', 'Showly', 'Backup JSON.', 'upload'],
  ['seriesguide', 'SeriesGuide', 'Export JSON.', 'upload'],
  ['sofa', 'Sofa Time', 'ZIP «Export All Data» (items.csv con tag).', 'upload'],
  ['csv', 'CSV, JSON o Excel', 'Qualsiasi file: scegli tu le colonne.', 'list'],
  ['manual', 'Lista manuale', 'Incolla i titoli, uno per riga.', 'plus'],
];
const MAP_FIELDS = [['title', 'Titolo *'], ['originalTitle', 'Titolo originale'], ['year', 'Anno'], ['tmdb', 'ID TMDB'], ['imdb', 'ID IMDb'], ['tvdb', 'ID TVDB'], ['type', 'Tipo (film/serie)'], ['status', 'Stato'], ['rating', 'Voto'], ['tags', 'Tag'], ['lists', 'Lista'], ['date', 'Data'], ['episodesWatched', 'Episodi visti']];

export async function render(root, { args }, ctx) {
  const source = args[0];
  if (!source) {
    root.innerHTML = `<header><h1>Importa liste</h1><p class="muted" style="margin:4px 0 0">Le righe originali restano conservate così come sono. Reimportare lo stesso file non crea doppioni.</p></header>
      <div class="grid g3">${CARDS.map(([k, n, d, ic]) => `<a class="panel col" href="#/import/${k}" style="text-decoration:none;color:var(--text);gap:6px"><div class="row">${icon(ic)}<b style="font-size:16px">${e(n)}</b></div><span class="muted small">${e(d)}</span></a>`).join('')}</div>
      <div class="notice">${icon('info')}<div class="small">Serializd e JustWatch non offrono un export utilizzabile: passa da Trakt o da un CSV. Per Trakt l'accesso diretto non è disponibile: da agosto 2026 Trakt ha rimosso le app create da account gratuiti.</div></div>`;
    return;
  }
  const name = SOURCES[source] || source;
  root.innerHTML = `<header class="between"><div><a href="#/import">← Fonti</a><h1 style="margin-top:6px">Importa da ${e(name)}</h1></div></header><div data-step class="col"></div>`;
  const step = root.querySelector('[data-step]');
  const state = { source, rows: null, scope: source, fileName: null, mapping: null, notes: [], skippedMovies: 0, records: null, headers: null };

  const afterParse = async (res) => {
    state.rows = res.rows; state.notes = res.notes || []; state.skippedMovies = res.skippedMovies || 0;
    if (!state.rows.length) { step.innerHTML += `<div class="notice err">${icon('alert')}<div>Nessuna serie trovata nel file. ${state.notes.map(e).join(' ')}</div></div>`; return; }
    await showPreview();
  };

  async function chooseFiles(accept, multiple = true) {
    const files = await pickFiles({ accept, multiple });
    if (!files.length) return null;
    state.fileName = files.map((f) => f.name).join(', ');
    return files;
  }

  if (source === 'simkl') {
    const s = ctx.ui.settings;
    const connected = await simklConnected();
    step.innerHTML = `<div class="panel col">
      ${!s.simklClientId ? `<div class="notice warn">${icon('alert')}<div>Serve un <b>client_id</b> SIMKL gratuito: crea un'app su <a href="https://simkl.com/settings/developer/new" target="_blank" rel="noopener">simkl.com/settings/developer</a> con redirect <code>${e(simklRedirect())}</code>, poi incollalo in <a href="#/impostazioni/servizi">Impostazioni › Servizi</a>.</div></div>` : ''}
      <div class="row"><button class="btn p" data-connect ${s.simklClientId ? '' : 'disabled'}>${icon('link')}${connected ? 'Ricollega SIMKL' : 'Collega SIMKL'}</button><button class="btn" data-fetch ${connected ? '' : 'disabled'}>${icon('download')}Scarica la libreria</button></div>
      <p class="muted small" style="margin:0">Accesso con PKCE: nessuna password passa da BingeMap. Il token resta solo su questo dispositivo.</p></div>`;
    step.querySelector('[data-connect]').addEventListener('click', async (ev) => { busy(ev.target, true, 'Accesso…'); try { await connectSimkl(s.simklClientId); toast('SIMKL collegato', 'ok'); ctx.rerender(); } catch (err) { toast(err.message, 'err'); busy(ev.target, false); } });
    step.querySelector('[data-fetch]').addEventListener('click', async (ev) => { busy(ev.target, true, 'Scarico…'); try { state.scope = 'simkl:api'; state.fileName = 'SIMKL (API)'; await afterParse(await fetchSimklLibrary(s.simklClientId)); } catch (err) { toast(err.message, 'err'); } busy(ev.target, false); });
    return;
  }

  if (source === 'manual') {
    step.innerHTML = `<div class="panel col"><label class="field">Titoli, uno per riga (l'anno tra parentesi aiuta: «Dark (2017)»)<textarea data-text rows="10"></textarea></label>
      <label class="field" style="max-width:320px">Stato di tutte queste serie<select data-st>${['plan', 'completed', 'watching', 'hold', 'dropped'].map((s) => `<option value="${s}">${e(STATUS_LABEL[s])}</option>`).join('')}</select></label>
      <button class="btn p" style="align-self:flex-start" data-go>Continua</button></div>`;
    step.querySelector('[data-go]').addEventListener('click', async () => { state.scope = `manual:${Date.now()}`; state.fileName = 'Lista manuale'; await afterParse(parseManual(step.querySelector('[data-text]').value, step.querySelector('[data-st]').value)); });
    return;
  }

  const ACCEPT = { refract: '.zip,.json,.csv', trakt: '.zip,.json', imdb: '.csv', tvtime: '.zip,.json,.csv', showly: '.json,.zip', seriesguide: '.json,.zip', sofa: '.zip,.csv', csv: '.csv,.json,.xlsx,.txt,.tsv' };
  const NOTE = {
    refract: 'Il formato dello ZIP di Refract non è documentato: BingeMap riconosce titoli, anni, ID, stati, voti, tag e liste dai nomi delle colonne. Controlla l\'anteprima.',
    trakt: 'Va bene lo ZIP del backup di Trakt (cartelle watched, ratings, lists). I film vengono ignorati.',
    imdb: 'Puoi scegliere più file insieme: watchlist, voti e liste. Il voto da solo non dice se l\'hai finita: quelle righe restano «Incerte».',
    tvtime: 'TV Time ha chiuso il 15 luglio 2026: servono i file salvati prima (export GDPR o TV Time Out).',
    sofa: 'Liste e sezioni di Sofa diventano liste; i tag restano tag.',
  };
  step.innerHTML = `<div class="panel col">${NOTE[source] ? `<p class="muted" style="margin:0">${e(NOTE[source])}</p>` : ''}<button class="btn p" style="align-self:flex-start" data-pick>${icon('upload')}Scegli i file</button></div>`;
  step.querySelector('[data-pick]').addEventListener('click', async (ev) => {
    const files = await chooseFiles(ACCEPT[source] || '');
    if (!files) return;
    busy(ev.target, true, 'Leggo…');
    try {
      if (source === 'imdb') {
        const rows = []; let skipped = 0; const kinds = [];
        for (const f of files) { const r = parseImdb(await f.text(), f.name); rows.push(...r.rows); skipped += r.skippedMovies; kinds.push(r.kind); }
        state.scope = `imdb:${[...new Set(kinds)].sort().join('+')}`;
        await afterParse({ rows, skippedMovies: skipped });
      } else if (source === 'csv') {
        const f = files[0];
        if (/\.json$/i.test(f.name)) { state.scope = `json:${f.name}`; state.source = 'json'; await afterParse(await parseFiles([fileWrap(f)], 'json')); }
        else {
          const parsed = /\.xlsx$/i.test(f.name) ? await parseXlsx(new Uint8Array(await f.arrayBuffer())) : parseCsv(await f.text());
          state.source = /\.xlsx$/i.test(f.name) ? 'xlsx' : 'csv'; state.scope = `${state.source}:${f.name}`;
          state.headers = parsed.headers; state.records = parsed.records;
          const sig = 'map:' + hash(parsed.headers.join('|'));
          state.mapSig = sig;
          state.mapping = (await getSetting(sig)) || suggestMapping(parsed.headers);
          showMapping();
        }
      } else if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
        state.scope = `${source}:zip`;
        await afterParse(await parseZip(new Uint8Array(await files[0].arrayBuffer()), source));
      } else {
        state.scope = `${source}:files`;
        await afterParse(await parseFiles(files.map(fileWrap), source));
      }
    } catch (err) { toast('File non leggibile: ' + err.message, 'err'); }
    busy(ev.target, false);
  });

  function showMapping() {
    const opts = (sel) => `<option value="">—</option>${state.headers.map((h) => `<option ${h === sel ? 'selected' : ''}>${e(h)}</option>`).join('')}`;
    const parsed = () => rowsFromRecords(state.records, state.mapping, state.source, { defaultStatus: state.defaultStatus || null });
    const draw = () => {
      const rows = state.mapping.title ? parsed() : [];
      step.innerHTML = `<div class="panel col"><h2>Collega le colonne</h2><p class="muted small" style="margin:0">BingeMap ha proposto una mappatura: correggila se serve. Verrà ricordata per i prossimi file con le stesse colonne.</p>
        <div class="grid g3">${MAP_FIELDS.map(([k, l]) => `<label class="field">${e(l)}<select data-map="${k}">${opts(state.mapping[k])}</select></label>`).join('')}
        <label class="field">Se lo stato manca<select data-def><option value="">Incerto</option>${['plan', 'completed', 'watching', 'hold', 'dropped'].map((s) => `<option value="${s}" ${state.defaultStatus === s ? 'selected' : ''}>${e(STATUS_LABEL[s])}</option>`).join('')}</select></label></div>
        <h3>Anteprima (prime 10 righe)</h3>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Titolo</th><th>Anno</th><th>Tipo</th><th>Stato</th><th>Voto</th><th>Tag</th><th>ID</th></tr></thead><tbody>${rows.slice(0, 10).map((r) => `<tr><td>${e(r.title)}</td><td>${r.year ?? ''}</td><td>${r.mediaType}</td><td>${statusBadge(r.status)}</td><td>${r.rating ?? ''}</td><td>${e(r.tags.join(', '))}</td><td class="small">${e(Object.entries(r.ids).map(([k, v]) => `${k}:${v}`).join(' '))}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Scegli almeno la colonna del titolo.</td></tr>'}</tbody></table></div>
        <button class="btn p" style="align-self:flex-start" data-next ${rows.length ? '' : 'disabled'}>Continua con ${fmtNum(rows.filter((r) => r.mediaType !== 'movie').length)} serie</button></div>`;
    };
    draw();
    step.onchange = (ev) => {
      const t = ev.target;
      if (t.dataset.map) { state.mapping[t.dataset.map] = t.value || undefined; draw(); }
      if (t.hasAttribute('data-def')) { state.defaultStatus = t.value || null; draw(); }
    };
    step.onclick = async (ev) => {
      if (!ev.target.closest('[data-next]')) return;
      await setSetting(state.mapSig, state.mapping);
      const rows = parsed();
      step.onchange = null; step.onclick = null;
      await afterParse({ rows: rows.filter((r) => r.mediaType !== 'movie'), skippedMovies: rows.filter((r) => r.mediaType === 'movie').length });
    };
  }

  async function showPreview() {
    const p = await previewImport(state.source, state.scope, state.rows);
    const tagSet = new Set(state.rows.flatMap((r) => r.tags));
    const statusCount = {}; for (const r of state.rows) statusCount[r.status] = (statusCount[r.status] || 0) + 1;
    step.innerHTML = `<div class="panel col"><h2>Anteprima</h2>
      <div class="grid g4">${[['Righe', p.total], ['Nuove', p.added.length], ['Cambiate', p.updated.length], ['Uguali', p.same.length]].map(([l, n]) => `<div class="card" style="padding:14px"><div class="lbl">${l}</div><div class="h" style="font-size:26px">${fmtNum(n)}</div></div>`).join('')}</div>
      <div class="row small">${Object.entries(statusCount).map(([s, n]) => `${statusBadge(s)} <span class="num">${n}</span>`).join(' &nbsp; ')}</div>
      ${tagSet.size ? `<div class="col" style="gap:6px"><span class="lbl">Tag trovati (nomi originali conservati)</span><div class="row" style="gap:6px">${[...tagSet].slice(0, 60).map((t) => `<span class="tag imp">${e(t)}</span>`).join('')}</div></div>` : ''}
      ${state.skippedMovies ? `<p class="muted small" style="margin:0">${fmtNum(state.skippedMovies)} film ignorati: BingeMap si occupa di serie.</p>` : ''}
      ${state.notes.length ? `<div class="notice warn">${icon('alert')}<div class="small">${state.notes.map(e).join('<br>')}</div></div>` : ''}
      ${p.updated.length ? `<details><summary>Righe cambiate (${p.updated.length})</summary><div class="small col" style="gap:4px;margin-top:8px">${p.updated.slice(0, 50).map((u) => `<div>${e(u.row.title)}: ${e(u.fields.join(', '))}</div>`).join('')}</div></details>` : ''}
      ${p.removed.length ? `<label class="check"><input type="checkbox" data-rem checked> Segna come tolte ${fmtNum(p.removed.length)} righe che non ci sono più in questo file</label>` : ''}
      <div class="row"><button class="btn p" data-commit>${icon('check')}Importa</button><a class="btn" href="#/import">Annulla</a></div></div>`;
    step.querySelector('[data-commit]').addEventListener('click', async (ev) => {
      busy(ev.target, true, 'Importo…');
      try {
        const res = await commitImport({ source: state.source, scope: state.scope, fileName: state.fileName, rows: state.rows, mapping: state.mapping, applyRemovals: !!step.querySelector('[data-rem]')?.checked, notes: state.notes });
        await ctx.store.changed(true);
        showReport(res);
      } catch (err) { toast('Import non riuscito: ' + err.message, 'err'); busy(ev.target, false); }
    });
  }

  function showReport(res) {
    const m = res.match;
    step.innerHTML = `<div class="panel col"><h2>Import completato</h2>
      <p style="margin:0;font-size:16px">${fmtNum(res.counts.rows)} righe: <b class="s-match">${fmtNum((m.auto || 0) + (m.manual || 0))} riconosciute</b> nel catalogo, <b class="s-unk">${fmtNum(m.queue || 0)} da confermare</b>, ${fmtNum(m.none || 0)} non nel catalogo.</p>
      <p class="muted small" style="margin:0">I conteggi del riconoscimento comprendono tutte le righe della libreria, per ogni catalogo attivo.</p>
      <div class="row"><a class="btn p" href="#/scopri">${icon('compass')}Scopri</a>${m.queue ? `<a class="btn" href="#/libreria/coda">Conferma i dubbi</a>` : ''}${m.none ? '<a class="btn" href="#/mancanti">Vedi le mancanti</a>' : ''}<a class="btn" href="#/libreria/storico">Storico</a></div></div>`;
    toast('Import completato', 'ok');
    writeFolderBackup(false).catch(() => {});
  }
  void isExtension;
}
