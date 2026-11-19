// Attività: scansioni, cronologia del catalogo, backup e ripristino, pacchetto catalogo, sincronizzazione, diagnostica.
import { e, toast, download, pickFiles, confirmBox, modal, busy } from '../components.js';
import { icon } from '../icons.js';
import { getAll, getSetting, put, get } from '../../db/db.js';
import { send, isExtension, setWebHandler } from '../../platform/platform.js';
import { exportAll, validateBackup, restore, exportCatalogPackage, importCatalogPackage, downloadName } from '../../backup/backup.js';
import { pickBackupFolder, folderStatus, writeFolderBackup } from '../folder.js';
import { syncNow } from '../../sync/drive.js';
import { report } from '../../common/diag.js';
import { fmtDate, fmtNum, daysBetween } from '../../common/util.js';
import { KIND_LABEL } from '../../scan/scanner.js';

const ST = { running: ['In corso', 's-watch'], paused: ['In pausa', 's-hold'], done: ['Completa', 's-match'], partial: ['Parziale', 's-unk'], stopped: ['Fermata', 's-hold'], blocked: ['Bloccata dal sito', 's-drop'], error: ['Errore', 's-drop'] };

export async function render(root, _p, ctx) {
  const { store, ui } = ctx;
  const [jobs, snaps, lastBackup, lastSync, diagRep, fs] = await Promise.all([getAll('scan_jobs'), getAll('catalog_snapshots'), getSetting('lastBackupAt', 0), getSetting('lastSyncAt', 0), report(), folderStatus()]);
  const active = jobs.find((j) => j.status === 'running' || j.status === 'paused');
  const s = ui.settings;
  const scReady = isExtension && !!s.sc.origin;

  root.innerHTML = `<header><h1>Attività</h1><p class="muted" style="margin:4px 0 0">Scansioni, backup, sincronizzazione e diagnostica.</p></header>
  <section class="panel col" data-scan>
    <div class="between"><h2>Scansioni</h2><span class="muted small">${scReady ? `Sito collegato: ${e(s.sc.origin)}` : isExtension ? 'Nessun sito collegato: apri il sito e usa «Usa questa scheda» dal popup' : 'Nell\'app web è disponibile solo il catalogo legale'}</span></div>
    <div data-active></div>
    <div class="row">
      <button class="btn p" data-start="sc-list|full" ${scReady && !active ? '' : 'disabled'}>${icon('refresh', 16)}Scansione completa</button>
      <button class="btn" data-start="sc-detail|full" ${scReady && !active ? '' : 'disabled'}>Dettagli dei titoli nuovi</button>
      <button class="btn" data-start="tmdb-enrich|full" ${s.tmdbKey && !active ? '' : 'disabled'}>Metadati TMDB</button>
      <button class="btn" data-start="tmdbp-catalog|full" ${s.tmdbKey && s.tmdbProviders.ids.length && !active ? '' : 'disabled'}>Catalogo legale</button>
    </div>
    <p class="muted small" style="margin:0">Una richiesta alla volta, con pause. Se il sito risponde 403, 429 o chiede una verifica, la scansione si ferma da sola. Una scansione interrotta non segna mai titoli come spariti.</p>
    <details><summary>Cronologia delle scansioni (${jobs.length})</summary><div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Inizio</th><th>Tipo</th><th>Esito</th><th>Pagine</th><th>Titoli</th><th>Risultato</th></tr></thead><tbody>${jobs.sort((a, b) => b.startedAt - a.startedAt).slice(0, 40).map((j) => `<tr><td>${fmtDate(j.startedAt, true)}</td><td>${e(KIND_LABEL[j.kind] || j.kind)}</td><td><span class="${ST[j.status]?.[1] || ''}">${e(ST[j.status]?.[0] || j.status)}</span>${j.error ? `<div class="muted small">${e(j.error)}</div>` : ''}</td><td>${j.pagesDone || '—'}</td><td>${fmtNum(j.titlesFound || j.done || 0)}</td><td class="small">${j.result ? `+${j.result.added} · −${j.result.removed} · stagioni ${j.result.seasonChanges}` : ''}</td></tr>`).join('')}</tbody></table></div></details>
    <details><summary>Istantanee del catalogo (${snaps.length})</summary><div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Data</th><th>Fonte</th><th>Completa</th><th>Titoli</th><th>Nuovi</th><th>Non più rilevati</th><th>Stagioni cambiate</th></tr></thead><tbody>${snaps.sort((a, b) => b.date - a.date).slice(0, 40).map((x) => `<tr><td>${fmtDate(x.date, true)}</td><td>${e(x.source)}</td><td>${x.complete ? 'Sì' : 'No'}</td><td>${fmtNum(x.count)}</td><td>${x.added.length}</td><td>${x.removed.length}</td><td>${x.seasonChanges.length}</td></tr>`).join('')}</tbody></table></div></details>
  </section>
  <section class="panel col">
    <div class="between"><h2>Backup e ripristino</h2><span class="muted small">Ultimo backup: ${lastBackup ? `${fmtDate(lastBackup, true)} (${daysBetween(lastBackup)} giorni fa)` : 'mai'}</span></div>
    ${!lastBackup || daysBetween(lastBackup) > s.backupReminderDays ? `<div class="notice warn">${icon('alert')}<div>Togliere l'estensione cancella i dati locali. Fai un backup o attiva la sincronizzazione con Google Drive.</div></div>` : ''}
    <div class="row"><button class="btn p" data-backup="1">${icon('download', 16)}Backup completo</button><button class="btn" data-backup="0">Backup senza catalogo</button><button class="btn" data-restore>${icon('upload', 16)}Ripristina</button></div>
    <div class="row"><button class="btn" data-folder>${icon('download', 16)}${fs.name ? `Cartella: ${e(fs.name)}` : 'Scegli una cartella per i backup automatici'}</button>${fs.name ? '<button class="btn" data-folder-now>Salva ora nella cartella</button>' : ''}<span class="muted small">Dopo ogni import BingeMap salva una copia nella cartella scelta.</span></div>
  </section>
  <section class="panel col">
    <h2>Pacchetto catalogo</h2>
    <p class="muted" style="margin:0">Una persona fa la scansione e condivide un file con i soli dati del catalogo, senza nulla di personale. Chi lo importa evita la prima scansione. Pensato per pochi amici: non è un servizio pubblico.</p>
    <div class="row"><button class="btn" data-pkg="sc">Esporta catalogo Streaming Community</button><button class="btn" data-pkg="tmdbp">Esporta catalogo legale</button><button class="btn" data-pkg-in>${icon('upload', 16)}Importa un pacchetto</button></div>
  </section>
  <section class="panel col">
    <div class="between"><h2>Sincronizzazione Google Drive</h2><span class="muted small">Ultima: ${lastSync ? fmtDate(lastSync, true) : 'mai'}</span></div>
    <p class="muted" style="margin:0">I dati vanno in una cartella nascosta del tuo Drive, visibile solo a BingeMap. Nessun server di BingeMap.</p>
    <div class="row"><button class="btn p" data-sync ${s.googleClientId ? '' : 'disabled'}>${icon('cloud', 16)}Sincronizza ora</button><a class="btn" href="#/impostazioni/sync">Impostazioni</a></div>
  </section>
  <section class="panel col">
    <div class="between"><h2>Diagnostica</h2><button class="btn sm" data-diag>${icon('download', 14)}Scarica il report</button></div>
    <p class="muted small" style="margin:0">Il report non contiene titoli, tag, token, chiavi o indirizzi completi.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Quando</th><th>Livello</th><th>Area</th><th>Codice</th><th>Dettaglio</th></tr></thead><tbody>${diagRep.entries.slice(0, 15).map((d) => `<tr><td>${fmtDate(d.t, true)}</td><td>${e(d.level)}</td><td>${e(d.area)}</td><td>${e(d.code)}</td><td class="small">${e(d.detail)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nessun evento registrato.</td></tr>'}</tbody></table></div>
  </section>`;

  const activeBox = root.querySelector('[data-active]');
  const drawJob = (j) => {
    if (!j || !['running', 'paused'].includes(j.status)) { activeBox.innerHTML = j ? `<div class="notice ${j.status === 'done' ? 'ok' : 'warn'}">${icon(j.status === 'done' ? 'check' : 'alert')}<div><b>${e(KIND_LABEL[j.kind])}: ${e(ST[j.status]?.[0] || j.status)}</b><div class="muted small">${e(j.error || (j.log || []).slice(-1)[0]?.text || '')}</div></div></div>` : ''; return; }
    const pct = j.todo ? Math.round((j.done / j.todo) * 100) : j.totalReported ? Math.round((j.titlesFound / j.totalReported) * 100) : null;
    activeBox.innerHTML = `<div class="card col" style="padding:14px;gap:10px"><div class="between"><b>${e(KIND_LABEL[j.kind])} · ${e(ST[j.status][0])}</b><span class="row" style="gap:6px">${j.status === 'running' ? `<button class="btn sm" data-job="pause">${icon('pause', 14)}Pausa</button>` : `<button class="btn sm" data-job="resume">${icon('play', 14)}Riprendi</button>`}<button class="btn sm danger" data-job="stop">${icon('stop', 14)}Ferma</button></span></div>
      <div class="progress"><span style="width:${pct ?? 5}%"></span></div>
      <div class="muted small">${j.kind === 'sc-list' || j.kind === 'tmdbp-catalog' ? `${fmtNum(j.pagesDone)} pagine · ${fmtNum(j.titlesFound)} serie${j.totalReported ? ` su ${fmtNum(j.totalReported)} dichiarate` : ''}` : `${fmtNum(j.done)} di ${fmtNum(j.todo)}`} · errori ${j.errors || 0} · ${e((j.log || []).slice(-1)[0]?.text || '')}</div>
      <div class="muted small">Puoi chiudere questa pagina: l'operazione continua e riprende da sola se il browser si chiude.</div></div>`;
    activeBox.dataset.id = j.id;
  };
  drawJob(active || jobs.sort((a, b) => b.startedAt - a.startedAt)[0]);
  const onScan = (ev) => drawJob(ev.detail);
  document.addEventListener('bm-scan', onScan);

  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.start) { const [kind, mode] = b.dataset.start.split('|'); const j = await send('scan.start', { kind, mode }); drawJob(j); toast('Operazione avviata', 'ok'); ctx.rerender(); }
      if (b.dataset.job) { const id = activeBox.dataset.id; await send(`scan.${b.dataset.job}`, { id }); if (b.dataset.job !== 'pause') setTimeout(() => ctx.rerender(), 600); }
      if (b.dataset.backup) { busy(b, true, 'Preparo…'); const data = await exportAll({ includeCatalog: b.dataset.backup === '1' }); download(downloadName('bingemap-backup', 'json'), JSON.stringify(data)); busy(b, false); toast('Backup scaricato', 'ok'); }
      if (b.hasAttribute('data-restore')) {
        const [f] = await pickFiles({ accept: '.json' }); if (!f) return;
        const obj = JSON.parse(await f.text()); const info = validateBackup(obj);
        const m = modal(`<h2>Ripristina backup</h2><p class="muted">Backup della versione ${e(info.version)} del ${e(fmtDate(Date.parse(info.exportedAt), true))}.</p>
          <div class="small">${Object.entries(info.counts).filter(([, n]) => n).map(([k, n]) => `${e(k)}: ${fmtNum(n)}`).join(' · ')}</div>
          <label class="check"><input type="radio" name="mode" value="replace" checked> Sostituisci i dati attuali con quelli del backup</label>
          <label class="check"><input type="radio" name="mode" value="merge"> Unisci: per ogni record vince il più recente</label>
          <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Annulla</button><button class="btn p" data-go>Ripristina</button></div>`);
        m.el.querySelector('[data-go]').addEventListener('click', async () => {
          const mode = m.el.querySelector('input[name=mode]:checked').value;
          if (mode === 'replace' && !(await confirmBox('Sostituire i dati attuali? Conviene fare prima un backup.', 'Sostituisci', true))) return;
          await restore(obj, mode); m.close(); toast('Ripristino completato', 'ok'); await store.changed(true); ctx.rerender();
        });
      }
      if (b.hasAttribute('data-folder')) { await pickBackupFolder(); toast('Cartella scelta', 'ok'); ctx.rerender(); }
      if (b.hasAttribute('data-folder-now')) { const n = await writeFolderBackup(true); toast(`Salvato ${n}`, 'ok'); }
      if (b.dataset.pkg) { const p = await exportCatalogPackage(b.dataset.pkg); if (!p.count) { toast('Catalogo vuoto', 'err'); return; } download(downloadName(`bingemap-catalogo-${b.dataset.pkg}`, 'json'), JSON.stringify(p)); toast(`Pacchetto con ${fmtNum(p.count)} serie`, 'ok'); }
      if (b.hasAttribute('data-pkg-in')) { const [f] = await pickFiles({ accept: '.json' }); if (!f) return; const r = await importCatalogPackage(JSON.parse(await f.text())); toast(`Pacchetto importato: +${r.added} nuove, ${r.updated} aggiornate`, 'ok'); await store.changed(true); ctx.rerender(); }
      if (b.hasAttribute('data-sync')) { busy(b, true, 'Sincronizzo…'); const r = isExtension ? await syncNow({ interactive: true }) : await syncNow({ interactive: true }); busy(b, false); toast(r.ok ? `Sincronizzato (${r.received} record ricevuti)` : r.reason, r.ok ? 'ok' : 'err'); if (r.received) await store.changed(true); ctx.rerender(); }
      if (b.hasAttribute('data-diag')) download(downloadName('bingemap-diagnostica', 'json'), JSON.stringify(await report(), null, 2));
    } catch (err) { busy(b, false); toast(err.message, 'err'); }
  });
  void put; void get; void setWebHandler;
  return () => document.removeEventListener('bm-scan', onScan);
}
