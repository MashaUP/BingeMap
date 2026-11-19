// Impostazioni: catalogo, servizi, sincronizzazione, scoperta, notifiche, profili, aspetto, avanzate, informazioni.
import { e, toast, confirmBox, promptBox, busy } from '../components.js';
import { icon } from '../icons.js';
import { saveSettings, DEFAULTS } from '../../common/settings.js';
import { testKey, providers as tmdbProviders } from '../../metadata/tmdb.js';
import { simklRedirect, disconnectSimkl, simklConnected } from '../../import/simkl.js';
import { getToken, signOut } from '../../sync/drive.js';
import { redirectUrl, isExtension, kv, send, openUrl } from '../../platform/platform.js';
import { SOURCES } from '../../import/sources.js';
import { VERSION } from '../../common/version.js';
import { getLinks } from '../../common/links.js';
import { deleteDb, dbName } from '../../db/db.js';
import { runMatching } from '../../match/run.js';

const SECS = [['catalogo', 'Catalogo'], ['servizi', 'Servizi'], ['sync', 'Sincronizzazione'], ['scoperta', 'Scoperta'], ['notifiche', 'Notifiche'], ['profili', 'Profili'], ['aspetto', 'Aspetto'], ['avanzate', 'Avanzate'], ['info', 'Informazioni']];

export async function render(root, { args }, ctx) {
  const sec = args[0] || 'catalogo';
  const s = ctx.ui.settings;
  root.innerHTML = `<header><h1>Impostazioni</h1></header>
    <div class="tabs">${SECS.map(([k, l]) => `<a class="btn sm" aria-selected="${k === sec}" href="#/impostazioni/${k}">${e(l)}</a>`).join('')}</div>
    <form class="panel col" data-form style="gap:16px"></form>`;
  const f = root.querySelector('[data-form]');
  const save = async (patch, msg = 'Salvato') => { ctx.ui.settings = await saveSettings(patch); toast(msg, 'ok'); if (isExtension) send('alarms.refresh').catch(() => {}); };

  if (sec === 'catalogo') {
    f.innerHTML = `<h2>Streaming Community</h2>
      ${isExtension ? (s.sc.origin ? `<div class="notice ok">${icon('check')}<div>Collegato a <b>${e(s.sc.origin)}</b>${s.sc.lang ? ` (lingua ${e(s.sc.lang)})` : ''}. Se il sito cambia indirizzo, apri il nuovo e usa «Usa questa scheda» dal popup.</div></div><button type="button" class="btn danger" style="align-self:flex-start" data-unlink>Scollega il sito</button>`
        : `<div class="notice">${icon('info')}<div>Apri il sito in una scheda, poi clicca l'icona di BingeMap e scegli «Usa questa scheda». BingeMap riconosce la pagina dalla sua struttura, non dal nome del dominio.</div></div>`)
        : `<div class="notice">${icon('info')}<div>Nell'app web Streaming Community non è disponibile: servono l'estensione e la scheda aperta.</div></div>`}
      <div class="notice warn">${icon('alert')}<div class="small">Streaming Community non è un servizio autorizzato: AGCOM lo blocca periodicamente e chi guarda contenuti pirata rischia sanzioni da 154 euro (fino a 5.000 se recidivo). BingeMap legge solo i dati del catalogo, non mostra video e non aggira blocchi.</div></div>
      <label class="field" style="max-width:360px">Catalogo attivo<select name="activeCatalog"><option value="all" ${s.activeCatalog === 'all' ? 'selected' : ''}>Tutti i cataloghi</option><option value="sc" ${s.activeCatalog === 'sc' ? 'selected' : ''}>Solo Streaming Community</option><option value="tmdbp" ${s.activeCatalog === 'tmdbp' ? 'selected' : ''}>Solo fornitori legali</option></select></label>
      <h2>Catalogo legale (fornitori)</h2>
      <p class="muted" style="margin:0">Serie disponibili sui servizi che scegli, dai dati TMDB forniti da JustWatch. Serve la chiave TMDB (sezione Servizi).</p>
      <div class="row"><label class="field">Paese<input name="region" value="${e(s.tmdbProviders.region)}" maxlength="2" style="width:80px"></label><label class="field">Pagine massime per fornitore (20 serie ognuna)<input name="maxPages" type="number" min="1" max="500" value="${s.tmdbProviders.maxPages}" style="width:120px"></label></div>
      <div data-prov class="row" style="gap:8px"><span class="muted small">${s.tmdbKey ? 'Carico i fornitori…' : 'Inserisci prima la chiave TMDB.'}</span></div>
      <button class="btn p" style="align-self:flex-start">Salva</button>`;
    if (s.tmdbKey) {
      tmdbProviders(s.tmdbKey, s.tmdbProviders.region).then((list) => {
        f.querySelector('[data-prov]').innerHTML = list.slice(0, 40).map((p) => `<label class="check chip" style="padding-right:12px"><input type="checkbox" name="prov" value="${p.id}" ${s.tmdbProviders.ids.includes(p.id) ? 'checked' : ''}> ${e(p.name)}</label>`).join('');
      }).catch((err) => { f.querySelector('[data-prov]').innerHTML = `<span class="s-drop small">${e(err.message)}</span>`; });
    }
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const ids = [...f.querySelectorAll('input[name=prov]:checked')].map((x) => Number(x.value));
      await save({ activeCatalog: f.activeCatalog.value, tmdbProviders: { region: f.region.value.toUpperCase() || 'IT', ids: f.querySelector('[data-prov] input') ? ids : s.tmdbProviders.ids, maxPages: Number(f.maxPages.value) || 40 } });
      await ctx.store.changed(true);
    });
    f.querySelector('[data-unlink]')?.addEventListener('click', async () => { if (await confirmBox('Scollegare il sito? Il catalogo salvato resta.', 'Scollega', true)) { await save({ sc: { origin: '' } }, 'Sito scollegato'); if (isExtension) send('site.register'); ctx.rerender(); } });
  }

  if (sec === 'servizi') {
    const sk = await simklConnected();
    f.innerHTML = `<h2>TMDB (metadati, facoltativo)</h2>
      <p class="muted" style="margin:0">Paese, lingua, stato della serie, episodi, durata, titoli alternativi. Crea una chiave gratuita su <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">themoviedb.org</a>: resta solo su questo dispositivo.</p>
      <div class="row"><input name="tmdbKey" type="password" value="${e(s.tmdbKey)}" placeholder="Chiave API v3 o token di lettura v4" style="flex:1;min-width:280px" autocomplete="off"><button type="button" class="btn" data-test>Prova</button></div>
      <h2>SIMKL</h2>
      <p class="muted" style="margin:0">Crea un'app gratuita su <a href="https://simkl.com/settings/developer/new" target="_blank" rel="noopener">simkl.com/settings/developer</a> con questo indirizzo di ritorno:</p>
      <code style="user-select:all">${e(simklRedirect())}</code>
      <div class="row"><input name="simklClientId" value="${e(s.simklClientId)}" placeholder="client_id SIMKL" style="flex:1;min-width:280px" autocomplete="off">${sk ? '<button type="button" class="btn danger" data-simkl-off>Scollega SIMKL</button>' : ''}</div>
      <h2>Google (sincronizzazione)</h2>
      <p class="muted" style="margin:0">Client ID OAuth di tipo «Applicazione web» creato su Google Cloud, con l'API Google Drive attiva e questo URI di reindirizzamento autorizzato:</p>
      <code style="user-select:all">${e(redirectUrl('google'))}</code>
      <input name="googleClientId" value="${e(s.googleClientId)}" placeholder="xxxx.apps.googleusercontent.com" autocomplete="off">
      <p class="muted small" style="margin:0">Le chiavi non vengono incluse nei backup (salvo scelta) né nella sincronizzazione.</p>
      <button class="btn p" style="align-self:flex-start">Salva</button>`;
    f.querySelector('[data-test]').addEventListener('click', async (ev) => { busy(ev.target, true, 'Provo…'); try { await testKey(f.tmdbKey.value.trim()); toast('Chiave TMDB valida', 'ok'); } catch (err) { toast(err.message, 'err'); } busy(ev.target, false); });
    f.querySelector('[data-simkl-off]')?.addEventListener('click', async () => { await disconnectSimkl(); toast('SIMKL scollegato', 'ok'); ctx.rerender(); });
    f.addEventListener('submit', async (ev) => { ev.preventDefault(); await save({ tmdbKey: f.tmdbKey.value.trim(), simklClientId: f.simklClientId.value.trim(), googleClientId: f.googleClientId.value.trim() }); });
  }

  if (sec === 'sync') {
    const connected = await kv.get('googleConnected', false);
    f.innerHTML = `<h2>Sincronizzazione con Google Drive</h2>
      <p class="muted" style="margin:0">Stessi dati su ogni computer dove accedi con il tuo account Google, e nulla si perde se togli l'estensione. I dati vanno in una cartella nascosta del tuo Drive (permesso «drive.appdata»): BingeMap non ha un server.</p>
      ${s.googleClientId ? '' : `<div class="notice warn">${icon('alert')}<div>Prima inserisci il Client ID Google in <a href="#/impostazioni/servizi">Servizi</a>.</div></div>`}
      <div class="row"><button type="button" class="btn p" data-login ${s.googleClientId ? '' : 'disabled'}>${icon('cloud')}${connected ? 'Accedi di nuovo' : 'Accedi con Google'}</button>${connected ? '<button type="button" class="btn" data-logout>Esci</button>' : ''}</div>
      <label class="check"><input type="checkbox" name="syncAuto" ${s.syncAuto ? 'checked' : ''}> Sincronizza in automatico ogni 30 minuti (se l'accesso è ancora valido)</label>
      <label class="check"><input type="checkbox" name="syncIncludeCatalog" ${s.syncIncludeCatalog ? 'checked' : ''}> Includi il catalogo (serve all'app web per mostrare le serie)</label>
      <button class="btn" style="align-self:flex-start">Salva</button>`;
    f.querySelector('[data-login]').addEventListener('click', async (ev) => { busy(ev.target, true, 'Accesso…'); try { await getToken(true); toast('Connesso a Google', 'ok'); ctx.rerender(); } catch (err) { toast(err.message, 'err'); busy(ev.target, false); } });
    f.querySelector('[data-logout]')?.addEventListener('click', async () => { await signOut(); toast('Disconnesso', 'ok'); ctx.rerender(); });
    f.addEventListener('submit', async (ev) => { ev.preventDefault(); await save({ syncAuto: f.syncAuto.checked, syncIncludeCatalog: f.syncIncludeCatalog.checked }); });
  }

  if (sec === 'scoperta') {
    const used = s.sourcePriority;
    f.innerHTML = `<h2>Cosa mostrare nella scoperta</h2>
      <p class="muted" style="margin:0">Le completate sono sempre escluse. Scegli se includere anche:</p>
      <label class="check"><input type="checkbox" name="includeWatching" ${s.discovery.includeWatching ? 'checked' : ''}> In corso</label>
      <label class="check"><input type="checkbox" name="includeHold" ${s.discovery.includeHold ? 'checked' : ''}> In pausa</label>
      <label class="check"><input type="checkbox" name="includeDropped" ${s.discovery.includeDropped ? 'checked' : ''}> Abbandonate</label>
      <h2>Stati diversi tra le fonti</h2>
      <label class="check"><input type="radio" name="conflictRule" value="recent" ${s.conflictRule === 'recent' ? 'checked' : ''}> Vince la fonte aggiornata più di recente</label>
      <label class="check"><input type="radio" name="conflictRule" value="priority" ${s.conflictRule === 'priority' ? 'checked' : ''}> Vince la fonte più in alto nell'elenco</label>
      <ol class="col" data-prio style="gap:6px;padding-left:20px">${used.map((k, i) => `<li class="row" style="gap:6px">${e(SOURCES[k] || k)} <button type="button" class="ibtn" data-up="${i}" aria-label="Su">${icon('arrowUp', 14)}</button><button type="button" class="ibtn" data-down="${i}" aria-label="Giù">${icon('arrowDown', 14)}</button></li>`).join('')}</ol>
      <label class="field" style="max-width:320px">«Riprendi o lascia» dopo (giorni senza attività)<input type="number" name="stalledDays" min="7" value="${s.stalledDays}"></label>
      <h2>Pesi dei consigli</h2>
      ${[['genre', 'Generi che ami'], ['tag', 'Tag importati (Must Watch, Preferiti…)'], ['similar', 'Somiglianza con le preferite'], ['quality', 'Voto del catalogo'], ['novelty', 'Novità']].map(([k, l]) => `<label class="field">${e(l)} <input type="range" name="w_${k}" min="0" max="2" step="0.1" value="${s.weights[k]}"></label>`).join('')}
      <button class="btn p" style="align-self:flex-start">Salva</button>`;
    let prio = [...used];
    f.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-up],[data-down]'); if (!b) return;
      const i = Number(b.dataset.up ?? b.dataset.down); const j = b.dataset.up != null ? i - 1 : i + 1;
      if (j < 0 || j >= prio.length) return;
      [prio[i], prio[j]] = [prio[j], prio[i]];
      f.querySelector('[data-prio]').innerHTML = prio.map((k, x) => `<li class="row" style="gap:6px">${e(SOURCES[k] || k)} <button type="button" class="ibtn" data-up="${x}" aria-label="Su">${icon('arrowUp', 14)}</button><button type="button" class="ibtn" data-down="${x}" aria-label="Giù">${icon('arrowDown', 14)}</button></li>`).join('');
    });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await save({ discovery: { includeWatching: f.includeWatching.checked, includeHold: f.includeHold.checked, includeDropped: f.includeDropped.checked }, conflictRule: f.querySelector('input[name=conflictRule]:checked').value, sourcePriority: prio, stalledDays: Number(f.stalledDays.value) || 60,
        weights: Object.fromEntries(['genre', 'tag', 'similar', 'quality', 'novelty'].map((k) => [k, Number(f[`w_${k}`].value)])) });
      await ctx.store.changed(true);
    });
  }

  if (sec === 'notifiche') {
    f.innerHTML = `<h2>Notifiche e automatismi</h2>
      <label class="check"><input type="checkbox" name="notifications" ${s.notifications ? 'checked' : ''}> Notifiche (novità nelle collezioni seguite, mancanti ora disponibili, aggiornamenti)</label>
      <label class="check"><input type="checkbox" name="updateCheck" ${s.updateCheck ? 'checked' : ''}> Controlla gli aggiornamenti ogni 12 ore</label>
      <label class="field" style="max-width:320px">Scansione programmata<select name="scheduledScan"><option value="off" ${s.scheduledScan === 'off' ? 'selected' : ''}>Mai (solo a mano)</option><option value="daily" ${s.scheduledScan === 'daily' ? 'selected' : ''}>Ogni giorno</option><option value="weekly" ${s.scheduledScan === 'weekly' ? 'selected' : ''}>Ogni settimana</option></select></label>
      <label class="check"><input type="checkbox" name="badgesOnSite" ${s.badgesOnSite ? 'checked' : ''}> Badge sulle copertine del sito</label>
      <label class="check"><input type="checkbox" name="hideCompletedOnSite" ${s.hideCompletedOnSite ? 'checked' : ''}> Attenua sul sito le serie già completate</label>
      <label class="field" style="max-width:320px">Promemoria di backup dopo (giorni)<input type="number" name="backupReminderDays" min="1" value="${s.backupReminderDays}"></label>
      <button class="btn p" style="align-self:flex-start">Salva</button>`;
    f.addEventListener('submit', async (ev) => { ev.preventDefault(); await save({ notifications: f.notifications.checked, updateCheck: f.updateCheck.checked, scheduledScan: f.scheduledScan.value, badgesOnSite: f.badgesOnSite.checked, hideCompletedOnSite: f.hideCompletedOnSite.checked, backupReminderDays: Number(f.backupReminderDays.value) || 14 }); });
  }

  if (sec === 'profili') {
    const profiles = await kv.get('profiles', [{ id: 'default', name: 'Principale' }]);
    const active = await kv.get('activeProfile', 'default');
    f.innerHTML = `<h2>Profili</h2><p class="muted" style="margin:0">Ogni profilo ha liste, stati e impostazioni separati sullo stesso computer. Servono anche per «Serata in due».</p>
      ${profiles.map((p) => `<div class="between card" style="padding:12px"><span><b>${e(p.name)}</b>${p.id === active ? ' · <span class="s-match">attivo</span>' : ''}</span><span class="row" style="gap:6px">${p.id !== active ? `<button type="button" class="btn sm" data-use="${e(p.id)}">Usa</button>` : ''}${p.id !== 'default' ? `<button type="button" class="btn sm danger" data-del="${e(p.id)}">Elimina</button>` : ''}</span></div>`).join('')}
      <button type="button" class="btn" style="align-self:flex-start" data-new>${icon('plus')}Nuovo profilo</button>`;
    f.addEventListener('click', async (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-new')) { const n = await promptBox('Nuovo profilo', '', 'Nome'); if (!n) return; profiles.push({ id: 'p' + Date.now().toString(36), name: n }); await kv.set('profiles', profiles); ctx.rerender(); }
      if (b.dataset.use) { await kv.set('activeProfile', b.dataset.use); location.reload(); }
      if (b.dataset.del && (await confirmBox('Eliminare il profilo e tutti i suoi dati?', 'Elimina', true))) { await deleteDb(dbName(b.dataset.del)); await kv.set('profiles', profiles.filter((p) => p.id !== b.dataset.del)); ctx.rerender(); }
    });
  }

  if (sec === 'aspetto') {
    f.innerHTML = `<h2>Aspetto</h2><label class="check"><input type="radio" name="theme" value="dark" ${s.theme !== 'light' ? 'checked' : ''}> Scuro</label><label class="check"><input type="radio" name="theme" value="light" ${s.theme === 'light' ? 'checked' : ''}> Chiaro</label><button class="btn p" style="align-self:flex-start">Salva</button>`;
    f.addEventListener('submit', async (ev) => { ev.preventDefault(); const t = f.querySelector('input[name=theme]:checked').value; await save({ theme: t }); document.documentElement.dataset.theme = t; });
  }

  if (sec === 'avanzate') {
    const sc = s.sc;
    f.innerHTML = `<h2>Struttura del sito (avanzate)</h2>
      <p class="muted" style="margin:0">Se il sito cambia struttura, qui si correggono i percorsi senza aggiornare l'estensione. Vedi docs/SITE_NOTES.md nel repository.</p>
      <div class="grid g3">
        <label class="field">Modo di lettura<select name="strategy">${['auto', 'api', 'page'].map((x) => `<option ${sc.strategy === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="field">Percorso elenco JSON<input name="apiPath" value="${e(sc.apiPath)}"></label>
        <label class="field">Percorso pagina archivio<input name="archivePath" value="${e(sc.archivePath)}"></label>
        <label class="field">Filtro serie<input name="typeParam" value="${e(sc.typeParam)}"></label>
        <label class="field">Parametro pagina<select name="pageParam">${['offset', 'page'].map((x) => `<option ${sc.pageParam === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="field">Titoli per pagina<input name="pageSize" type="number" min="1" value="${sc.pageSize}"></label>
        <label class="field">Percorso schede titolo<input name="titlePath" value="${e(sc.titlePath)}"></label>
        <label class="field">Lingua nel percorso<input name="lang" value="${e(sc.lang)}"></label>
        <label class="field">Pausa tra le richieste (ms, minimo 800)<input name="delayMs" type="number" min="800" value="${sc.delayMs}"></label>
      </div>
      <div class="row"><button class="btn p">Salva</button><button type="button" class="btn" data-reset>Valori predefiniti</button><button type="button" class="btn" data-rematch>Rifai il riconoscimento</button></div>`;
    f.addEventListener('submit', async (ev) => { ev.preventDefault(); await save({ sc: { strategy: f.strategy.value, apiPath: f.apiPath.value, archivePath: f.archivePath.value, typeParam: f.typeParam.value, pageParam: f.pageParam.value, pageSize: Number(f.pageSize.value) || 60, titlePath: f.titlePath.value, lang: f.lang.value, delayMs: Math.max(800, Number(f.delayMs.value) || 1500) } }); });
    f.querySelector('[data-reset]').addEventListener('click', async () => { const { origin, lang } = sc; await save({ sc: { ...DEFAULTS.sc, origin, lang } }, 'Valori predefiniti ripristinati'); ctx.rerender(); });
    f.querySelector('[data-rematch]').addEventListener('click', async (ev) => { busy(ev.target, true, 'Riconosco…'); const c = await runMatching(); busy(ev.target, false); toast(`Fatto: ${c.auto + c.manual} riconosciute, ${c.queue} da confermare`, 'ok'); await ctx.store.changed(true); });
  }

  if (sec === 'info') {
    const L = await getLinks();
    f.innerHTML = `<h2>BingeMap ${e(VERSION)}</h2>
      <p style="margin:0">Trova le serie del catalogo che non hai ancora visto, con le tue liste, i tuoi tag e i tuoi voti. Nessun account, nessun server: i dati restano sul tuo dispositivo (e, se lo scegli, nel tuo Google Drive).</p>
      <div class="row"><button type="button" class="btn" data-act="update">${icon('refresh')}Cerca aggiornamento</button><a class="btn" href="${e(L.kofi)}" target="_blank" rel="noopener">${icon('heart')}Supporta su Ko-fi</a><a class="btn" href="${e(L.discord)}" target="_blank" rel="noopener">${icon('chat')}Community Discord</a></div>
      <h2>Attribuzioni</h2>
      <p class="small" style="margin:0">Questo prodotto usa l'API TMDB ma non è approvato né certificato da TMDB. Dati e immagini dei metadati: <a href="https://www.themoviedb.org" target="_blank" rel="noopener">The Movie Database (TMDB)</a>.</p>
      <p class="small" style="margin:0">Dati su dove guardare (catalogo legale): <a href="https://www.justwatch.com" target="_blank" rel="noopener">JustWatch</a>.</p>
      <p class="small" style="margin:0">Font Inter e Sora (SIL Open Font License). Icone in stile Lucide (ISC).</p>
      <h2>Avvertenza</h2>
      <p class="small muted" style="margin:0">BingeMap non ospita, non trasmette e non collega flussi video. Legge solo metadati del catalogo dal browser dell'utente. L'uso di siti non autorizzati può comportare sanzioni: valuta il catalogo legale.</p>`;
  }
  void openUrl;
}
