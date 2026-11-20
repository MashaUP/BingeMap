// Motore delle scansioni: coda persistente, ritmo prudente, area temporanea, promozione sicura.
// Regole: una scansione diventa catalogo solo se completa; una parziale aggiunge e aggiorna ma non
// segna mai titoli come spariti; «non più rilevato» solo dopo 2 scansioni complete consecutive.
import { get, put, getAll, atomic, deleteByIndex } from '../db/db.js';
import { loadSettings, saveSettings } from '../common/settings.js';
import { uid, sleep } from '../common/util.js';
import { log, originOnly } from '../common/diag.js';
import * as sc from '../catalog/sc/adapter.js';
import * as tp from '../catalog/tmdb/adapter.js';
import * as tmdb from '../metadata/tmdb.js';
import { runMatching } from '../match/run.js';

const running = new Map(); // jobId -> { stop: bool, pause: bool } — prenotato in modo sincrono prima di ogni attesa
let startLock = Promise.resolve(); // gli avvii passano uno alla volta (doppio clic, avvio automatico + programmato)
const BUSY = 'C\'è già un\'operazione in corso: aspetta che finisca o mettila in pausa';
let hooks = { emit: () => {}, keepAlive: () => () => {}, afterPromote: async () => {}, afterJob: async () => {}, fetch: (...a) => globalThis.fetch(...a), sleep };
export function setHooks(h) { hooks = { ...hooks, ...h }; }

export const KIND_LABEL = {
  'sc-list': 'Scansione del catalogo', 'sc-detail': 'Dettagli dei titoli', 'tmdb-enrich': 'Metadati TMDB', 'tmdbp-catalog': 'Catalogo legale',
};

async function saveJob(job) { job.updatedAt = Date.now(); await put('scan_jobs', job); hooks.emit({ kind: 'scan', job: publicJob(job) }); }
export function publicJob(j) { const { cursor: _cursor, ...rest } = j; return { ...rest, log: (j.log || []).slice(-30) }; }
function note(job, text) { job.log = [...(job.log || []), { t: Date.now(), text }].slice(-80); }

export async function activeJob() {
  const jobs = await getAll('scan_jobs');
  return jobs.find((j) => j.status === 'running' || j.status === 'paused') || null;
}

export function startJob(kind, opts = {}) {
  const p = startLock.then(() => startJobNow(kind, opts));
  startLock = p.catch(() => {});
  return p;
}

async function startJobNow(kind, opts) {
  if (running.size) throw new Error(BUSY);
  const act = await activeJob();
  if (act && act.status === 'running') throw new Error(BUSY);
  // Un'operazione in pausa non resta «attiva» accanto a una nuova: si chiude salvando i dati raccolti come parziali.
  if (act && act.status === 'paused') await stopJob(act.id);
  const job = {
    id: uid('j_'), kind, mode: opts.mode || 'full', status: 'running', startedAt: Date.now(), endedAt: null,
    pagesDone: 0, titlesFound: 0, totalReported: null, done: 0, todo: null, errors: 0, strategy: null,
    cursor: { page: 0, index: 0, provider: 0, seen: [] }, complete: false, result: null, log: [], opts,
  };
  note(job, `${KIND_LABEL[kind]} avviata`);
  const ctl = claim(job.id);
  try { await saveJob(job); } catch (e) { running.delete(job.id); throw e; }
  launch(job, ctl);
  return publicJob(job);
}

function claim(id) { const ctl = { stop: false, pause: false }; running.set(id, ctl); return ctl; }
function launch(job, ctl) {
  run(job, ctl).catch(async (e) => { job.status = 'error'; job.error = e.message; job.endedAt = Date.now(); note(job, 'Errore: ' + e.message); await saveJob(job); await log('error', 'scan', job.kind, e.message); });
}

// Passo successivo della scansione automatica di tutto l'archivio (elenco → schede → TMDB), oppure null.
export function nextAutoKind(job, settings) {
  if (!settings.autoFullScan || !job || job.status !== 'done') return null;
  if (job.kind === 'sc-list') return 'sc-detail';
  if (job.kind === 'sc-detail' && settings.tmdbKey) return 'tmdb-enrich';
  return null;
}

export async function pauseJob(id) { const r = running.get(id); if (r) r.pause = true; }
export async function stopJob(id) {
  const r = running.get(id);
  if (r) r.stop = true;
  else {
    const job = await get('scan_jobs', id);
    if (job && (job.status === 'paused' || job.status === 'running')) {
      job.status = 'stopped'; job.endedAt = Date.now(); note(job, 'Fermata: i dati raccolti sono stati salvati come parziali');
      await promote(job, false); await saveJob(job);
    }
  }
}
// La prenotazione avviene prima di qualsiasi attesa: due riprese contemporanee (avvio del browser, allarme, clic)
// non possono far girare la stessa operazione due volte.
export async function resumeJob(id, why = 'Ripresa') {
  if (running.has(id)) { const j = await get('scan_jobs', id); return j ? publicJob(j) : null; }
  if (running.size) throw new Error(BUSY);
  const ctl = claim(id);
  let job;
  try {
    job = await get('scan_jobs', id);
    if (!job || (job.status !== 'paused' && job.status !== 'running')) { running.delete(id); return null; }
    job.status = 'running'; note(job, why); await saveJob(job);
  } catch (e) { running.delete(id); throw e; }
  launch(job, ctl);
  return publicJob(job);
}

// Riprende le operazioni rimaste "in corso" (es. browser chiuso a metà).
export async function resumeInterrupted() {
  const jobs = await getAll('scan_jobs');
  for (const j of jobs) {
    if (j.status !== 'running' || running.has(j.id)) continue;
    try { await resumeJob(j.id, 'Ripresa automatica dopo un\'interruzione'); } catch (e) { await log('warn', 'scan', 'resume', e.message); }
  }
}

async function run(job, ctl) {
  running.set(job.id, ctl);
  const release = hooks.keepAlive();
  try {
    const settings = await loadSettings();
    if (job.kind === 'sc-list') await runScList(job, ctl, settings);
    else if (job.kind === 'sc-detail') await runScDetail(job, ctl, settings);
    else if (job.kind === 'tmdb-enrich') await runTmdbEnrich(job, ctl, settings);
    else if (job.kind === 'tmdbp-catalog') await runTmdbProviders(job, ctl, settings);
  } finally {
    running.delete(job.id);
    release();
  }
  // Operazione finita (non in pausa): chi l'ha avviata può far partire il passo successivo.
  if (job.status !== 'paused' && job.status !== 'running') { try { await hooks.afterJob(publicJob(job)); } catch (e) { await log('warn', 'scan', 'afterJob', e.message); } }
}

async function checkCtl(job, ctl) {
  if (ctl.pause) { job.status = 'paused'; note(job, 'In pausa'); await saveJob(job); return 'pause'; }
  if (ctl.stop) { job.status = 'stopped'; job.endedAt = Date.now(); note(job, 'Fermata dall\'utente: dati salvati come parziali'); return 'stop'; }
  return null;
}

async function fetchText(url, headers = null) {
  const opts = { credentials: 'include', redirect: 'follow', cache: 'no-store' };
  if (headers) opts.headers = headers;
  const r = await hooks.fetch(url, opts);
  const body = await r.text();
  return { status: r.status, ok: r.ok, body, type: r.headers.get('content-type') || '' };
}

async function stage(job, recs) {
  await atomic(['scan_staging'], async (tx) => {
    for (const r of recs) tx.put('scan_staging', { sk: `${job.id}:${r.ck}`, jobId: job.id, ck: r.ck, rec: r });
  });
}

// --- Livello 1: elenco di tutte le serie
// Il sito serve al massimo `pageLimit` pagine per richiesta: l'elenco si legge a fette (vedi sc.listSlices).
// Fetta 0: elenco senza filtri, solo la prima pagina (totale dichiarato e novità). Poi una fetta per anno.
// Ultima fetta: di nuovo senza filtri, dalla seconda pagina, solo se mancano ancora titoli (es. senza anno).
async function runScList(job, ctl, settings) {
  if (!settings.sc.origin) throw new Error('Nessun sito collegato: apri il sito e usa «Usa questa scheda»');
  const seen = new Set(job.cursor.seen || []);
  if (!job.strategy) {
    job.strategy = await detectStrategy(settings);
    note(job, `Struttura riconosciuta: ${job.strategy === 'api' ? 'elenco JSON' : 'pagine dell\'archivio'}`);
    await saveJob(job);
  }
  const cur = job.cursor;
  if (!cur.slices) {
    cur.slices = job.strategy === 'api' ? sc.listSlices(settings.sc) : [''];
    // Operazione iniziata da una versione precedente (elenco unico, senza fette): le pagine già lette valgono per l'elenco senza filtri.
    if (cur.slice == null && cur.page > 0 && cur.slices.length > 1) { cur.tailFrom = cur.page; cur.slice = 1; cur.page = 0; }
  }
  if (cur.slice == null) cur.slice = 0;
  const slices = cur.slices;
  const sliced = slices.length > 1;
  let limit = job.pageLimit || settings.sc.pageLimit || 0;
  let stopped = false;
  const reached = () => job.totalReported && seen.size >= job.totalReported;
  while (cur.slice < slices.length && !stopped) {
    const slice = slices[cur.slice];
    // Se l'elenco senza filtri sta tutto entro il limite di pagine, si legge così e le fette non servono.
    const probe = sliced && cur.slice === 0 && !cur.unsliced;
    const tail = sliced && cur.slice === slices.length - 1;
    if (tail && cur.page === 0) cur.page = Math.max(1, cur.tailFrom || 1);
    const skip = tail && reached();
    while (!skip) {
      const c = await checkCtl(job, ctl);
      if (c === 'pause') return;
      if (c === 'stop') { stopped = true; break; }
      if (limit && cur.page >= limit) break; // oltre il limite il sito risponde solo 503
      const url = sc.listUrl(settings, cur.page, job.strategy, slice);
      let res;
      try { res = await fetchText(url, job.strategy === 'api' ? sc.JSON_HEADERS : null); } catch (e) {
        job.errors++; note(job, `Rete non raggiungibile (${e.message}). Il sito potrebbe aver cambiato indirizzo.`);
        job.status = 'error'; job.error = 'Il sito non risponde: se ha cambiato indirizzo, apri il nuovo e ripeti «Usa questa scheda».';
        stopped = true; break;
      }
      const lim = sc.pageLimitReached(res.status, res.body);
      if (lim != null) {
        limit = lim || cur.page; job.pageLimit = limit;
        cur.unsliced = false; // il limite è più basso del previsto: servono le fette
        note(job, `Il sito mostra al massimo ${limit} pagine per elenco: continuo con la fetta successiva`);
        break;
      }
      if (res.status === 422 && slice) { note(job, `Filtro «${slice}» non accettato dal sito: fetta saltata`); break; }
      const blocked = sc.blockedReason(res.status, res.body);
      if (blocked) { job.status = 'blocked'; job.error = blocked + '. Scansione fermata senza tentativi di aggiramento.'; note(job, job.error); await log('warn', 'scan', 'blocked', `${res.status} ${originOnly(url)}`); stopped = true; break; }
      if (!res.ok) { job.status = 'error'; job.error = `Risposta inattesa (${res.status})`; stopped = true; break; }
      const parsed = sc.parseList(res.body, res.type);
      if (!parsed.ok) { job.status = 'error'; job.error = 'Pagina non riconosciuta: la struttura del sito potrebbe essere cambiata (vedi Impostazioni › Avanzate).'; await log('error', 'scan', 'parse', originOnly(url)); stopped = true; break; }
      // Il totale vale solo dall'elenco senza filtri; quello di una fetta serve a capire se la fetta supera il limite.
      if (parsed.total && !slice) job.totalReported = parsed.total;
      if (sliced && cur.slice === 0 && cur.page === 0 && parsed.lastPage && limit && parsed.lastPage <= limit) cur.unsliced = true;
      // Filtro ignorato dal sito: la fetta dichiara lo stesso totale dell'elenco intero. Rileggere l'elenco per ogni anno
      // sarebbe solo carico inutile sul sito: si abbandonano le fette e si passa all'ultima (elenco senza filtri).
      if (slice && cur.page === 0 && job.totalReported && parsed.total === job.totalReported && !tail) {
        note(job, `Il sito ignora il filtro «${slice.split('=')[0]}»: lettura senza fette, fino al limite di pagine`);
        cur.slice = slices.length - 2; // dopo l'incremento di fine fetta si arriva all'ultima
        break;
      }
      const perPage = parsed.titles.length || settings.sc.pageSize || 60;
      if (slice && cur.page === 0 && parsed.total && limit && parsed.total > limit * perPage) {
        job.overflow = [...(job.overflow || []), slice];
        note(job, `«${slice}»: ${parsed.total} serie, ma il sito ne mostra al massimo ${limit * perPage}: alcune potrebbero mancare`);
      }
      const recs = parsed.titles.map((t) => sc.normalizeTitle(t, settings)).filter((r) => r.type === 'tv' && r.name);
      const fresh = recs.filter((r) => !seen.has(r.ck));
      for (const r of fresh) seen.add(r.ck);
      await stage(job, fresh);
      job.pagesDone++; job.titlesFound = seen.size; cur.page++; cur.seen = [...seen];
      note(job, `${slice ? sliceLabel(slice) + ', p' : 'P'}agina ${cur.page}: ${fresh.length} serie nuove`);
      await saveJob(job);
      if (parsed.titles.length === 0) break;
      if (parsed.page && parsed.lastPage && parsed.page >= parsed.lastPage) break;
      if (!parsed.lastPage && fresh.length === 0) break; // nessuna paginazione dichiarata: ci si ferma quando non arriva niente di nuovo
      if ((probe && !cur.unsliced) || reached()) break;
      if (cur.page > 2000) { note(job, 'Limite di sicurezza di 2000 pagine raggiunto'); break; }
      await hooks.sleep(Math.max(800, settings.sc.delayMs));
    }
    if (stopped) break;
    cur.slice = cur.unsliced ? slices.length : cur.slice + 1; cur.page = 0;
    await saveJob(job);
    if (reached()) { cur.slice = slices.length; break; }
    if (cur.slice < slices.length) await hooks.sleep(Math.max(800, settings.sc.delayMs));
  }
  const finished = !stopped && cur.slice >= slices.length;
  // Completa solo se l'elenco è finito senza errori e, se il sito dichiara un totale, il conteggio torna.
  const totalOk = job.totalReported == null || job.titlesFound >= job.totalReported * 0.98;
  const complete = job.status === 'running' && finished && totalOk && job.titlesFound > 0;
  if (job.status === 'running') job.status = complete ? 'done' : 'partial';
  job.complete = complete;
  job.endedAt = Date.now();
  if (!complete && job.status === 'partial') note(job, job.totalReported ? `Trovate ${job.titlesFound} serie su ${job.totalReported} dichiarate: scansione parziale` : 'Scansione parziale');
  await promote(job, complete);
  await saveJob(job);
}

const sliceLabel = (slice) => { const m = slice.match(/=(\d{4})$/); return m ? (Number(m[1]) < 2000 ? `Anni ${m[1].slice(0, 3)}0` : `Anno ${m[1]}`) : slice; };

export async function detectStrategy(settings) {
  const pref = settings.sc.strategy;
  const tryOne = async (s) => {
    try {
      const r = await fetchText(sc.listUrl(settings, 0, s), s === 'api' ? sc.JSON_HEADERS : null);
      if (sc.blockedReason(r.status, r.body)) return false;
      if (s === 'api' && !(/json/.test(r.type) || /^\s*[{[]/.test(r.body))) return false;
      const p = sc.parseList(r.body, r.type);
      return r.ok && p.ok && p.titles.length > 0;
    } catch { return false; }
  };
  if (pref === 'api' || pref === 'page') return pref;
  if (await tryOne('api')) return 'api';
  if (await tryOne('page')) return 'page';
  throw new Error('Non riesco a leggere l\'archivio del sito: controlla Impostazioni › Avanzate (percorsi) o apri la pagina dell\'archivio e usa «Usa questa scheda»');
}

// Promozione dall'area temporanea al catalogo.
export async function promote(job, complete) {
  const source = job.kind === 'tmdbp-catalog' ? tp.SOURCE : sc.SOURCE;
  if (job.kind !== 'sc-list' && job.kind !== 'tmdbp-catalog') return;
  const staged = await getAll('scan_staging', 'jobId', job.id);
  const now = Date.now();
  const result = await atomic(['catalog_titles', 'catalog_snapshots', 'scan_staging'], async (tx) => {
    const existing = await tx.getAll('catalog_titles', 'source', source);
    // Prima scansione completa di questa fonte: i titoli trovati non sono «novità» (badge, popup).
    const first = !(await tx.getAll('catalog_snapshots', 'source', source)).some((x) => x.complete && x.kind === job.kind);
    const exMap = new Map(existing.map((c) => [c.ck, c]));
    const added = []; const removed = []; const seasonChanges = []; const back = [];
    const stagedCks = new Set();
    for (const s of staged) {
      const r = s.rec; stagedCks.add(r.ck);
      const old = exMap.get(r.ck);
      if (!old) { added.push(r.ck); tx.put('catalog_titles', { ...r, firstSeen: now, lastSeen: now, status: 'active', missCount: 0, history: [{ date: now, seasonsCount: r.seasonsCount }] }); continue; }
      const merged = { ...old };
      for (const [k, v] of Object.entries(r)) if (v != null && !(Array.isArray(v) && !v.length)) merged[k] = v;
      if (old.providers || r.providers) merged.providers = [...new Set([...(old.providers || []), ...(r.providers || [])])];
      if (old.status === 'gone') back.push(r.ck);
      merged.status = 'active'; merged.missCount = 0; merged.lastSeen = now; merged.firstSeen = old.firstSeen || now;
      if (r.seasonsCount != null && old.seasonsCount != null && r.seasonsCount !== old.seasonsCount) {
        seasonChanges.push(r.ck);
        merged.history = [...(old.history || []), { date: now, seasonsCount: r.seasonsCount, prev: old.seasonsCount }].slice(-20);
        merged.seasonsChangedAt = now;
      }
      tx.put('catalog_titles', merged);
    }
    if (complete) {
      for (const old of existing) {
        if (stagedCks.has(old.ck) || old.status === 'gone') continue;
        const missCount = (old.missCount || 0) + 1;
        const upd = { ...old, missCount };
        if (missCount >= 2) { upd.status = 'gone'; upd.goneAt = now; removed.push(old.ck); }
        tx.put('catalog_titles', upd);
      }
    }
    for (const s of staged) tx.del('scan_staging', s.sk);
    const snap = { id: job.id, source, kind: job.kind, date: now, complete, first, count: stagedCks.size, added, removed, seasonChanges, back };
    tx.put('catalog_snapshots', snap);
    return snap;
  });
  job.result = { added: result.added.length, removed: result.removed.length, seasonChanges: result.seasonChanges.length, count: result.count };
  note(job, `Catalogo aggiornato: +${result.added.length} nuove, ${result.removed.length} non più rilevate, ${result.seasonChanges.length} con stagioni cambiate`);
  await runMatching();
  try { await hooks.afterPromote(result, job); } catch (e) { await log('warn', 'scan', 'afterPromote', e.message); }
}

// --- Livello 2: dettagli dei titoli nuovi o cambiati
// L'elenco da leggere si fissa al primo avvio e si salva nel cursore: alla ripresa si continua dallo stesso punto
// dello stesso elenco (ricalcolarlo lo accorciava, perché i titoli già letti non ne fanno più parte, e si saltavano schede).
async function runScDetail(job, ctl, settings) {
  const cur = job.cursor;
  if (!cur.cks) {
    const all = (await getAll('catalog_titles', 'source', sc.SOURCE)).filter((c) => c.status !== 'gone');
    const todo = job.opts.cks?.length ? all.filter((c) => job.opts.cks.includes(c.ck))
      : all.filter((c) => !c.detailAt || (c.seasonsChangedAt && c.seasonsChangedAt > c.detailAt) || job.opts.force);
    cur.cks = todo.map((c) => c.ck); cur.index = 0;
    await saveJob(job);
  }
  const cks = cur.cks;
  job.todo = cks.length;
  const viaJson = settings.sc.detailVia !== 'html';
  let version = viaJson ? (settings.sc.inertiaVersion || null) : null;
  const learn = async (body) => {
    if (!viaJson) return;
    const v = sc.pageVersion(body);
    if (v && v !== version) { version = v; await saveSettings({ sc: { inertiaVersion: v } }); }
  };
  let consecutiveErrors = 0;
  for (let i = cur.index || 0; i < cks.length; i++) {
    const c = await checkCtl(job, ctl);
    if (c === 'pause') return;
    if (c === 'stop') break;
    const t = await get('catalog_titles', cks[i]);
    if (t && t.status !== 'gone') {
      // Indirizzo dal sito collegato ora: quello salvato può avere il dominio vecchio.
      const url = sc.titleUrl(settings, t.siteId, t.slug);
      try {
        let res = null;
        if (version) {
          res = await fetchText(url, sc.inertiaHeaders(version, settings.sc.detailRelated !== false));
          if (res.status === 409) { res = null; version = null; await hooks.sleep(Math.max(800, settings.sc.detailDelayMs)); }
        }
        if (!res) res = await fetchText(url);
        const blocked = sc.blockedReason(res.status, res.body);
        if (blocked) { job.status = 'blocked'; job.error = blocked + '. Fermata senza tentativi di aggiramento.'; note(job, job.error); break; }
        const raw = res.ok ? sc.parseDetail(res.body) : null;
        if (raw) {
          await learn(res.body);
          const fields = sc.detailFields(raw, settings);
          await atomic(['catalog_titles'], async (tx) => {
            const now = await tx.get('catalog_titles', t.ck);
            if (now) tx.put('catalog_titles', { ...now, ...fields, url, detailAt: Date.now() });
          });
          consecutiveErrors = 0;
        } else { job.errors++; if (res.status !== 404) consecutiveErrors++; } // una scheda tolta dal sito non indica un sito cambiato
      } catch (e) { job.errors++; consecutiveErrors++; }
    }
    job.done = i + 1; cur.index = i + 1;
    if ((i + 1) % 10 === 0 || i + 1 === cks.length) await saveJob(job);
    if (consecutiveErrors >= 8) { job.status = 'error'; job.error = 'Troppe schede non lette di fila: il sito potrebbe essere cambiato'; break; }
    if (i + 1 < cks.length) await hooks.sleep(Math.max(800, settings.sc.detailDelayMs));
  }
  if (job.status === 'running') job.status = 'done';
  job.complete = job.status === 'done'; job.endedAt = Date.now();
  note(job, `Dettagli letti: ${job.done}/${job.todo}, errori ${job.errors}`);
  await saveJob(job);
  await runMatching();
}

// --- Livello 3: metadati TMDB
async function runTmdbEnrich(job, ctl, settings) {
  if (!settings.tmdbKey) throw new Error('Inserisci la tua chiave TMDB nelle impostazioni');
  const catalog = (await getAll('catalog_titles')).filter((c) => c.status !== 'gone');
  const cache = new Map((await getAll('tmdb_cache')).map((t) => [t.tmdbId, t]));
  // Le serie ancora in onda si aggiornano più spesso (calendario, rinnovi, cancellazioni).
  const staleFor = (t) => (t && (t.status === 'Returning Series' || t.status === 'In Production' || t.nextEp) ? 3 : 30) * 86400000;
  const todo = catalog.filter((c) => (c.tmdbId && (!cache.has(c.tmdbId) || job.opts.force || Date.now() - cache.get(c.tmdbId).updatedAt > staleFor(cache.get(c.tmdbId)))) || (!c.tmdbId && c.imdbId && !c.tmdbLookupAt));
  // Elenco fissato al primo avvio (come per le schede): la ripresa non salta titoli.
  if (!job.cursor.cks) {
    const unique = []; const seenIds = new Set();
    for (const c of todo) { const k = c.tmdbId || c.imdbId; if (!seenIds.has(k)) { seenIds.add(k); unique.push(c.ck); } }
    job.cursor.cks = unique; job.cursor.index = 0;
    await saveJob(job);
  }
  const byCk = new Map(catalog.map((c) => [c.ck, c]));
  const unique = job.cursor.cks;
  job.todo = unique.length;
  for (let i = job.cursor.index || 0; i < unique.length; i++) {
    const c = await checkCtl(job, ctl);
    if (c === 'pause') return;
    if (c === 'stop') break;
    const t = byCk.get(unique[i]);
    if (!t) { job.done = i + 1; job.cursor.index = i + 1; continue; }
    try {
      let id = t.tmdbId;
      if (!id && t.imdbId) {
        id = await tmdb.findByImdb(t.imdbId, settings.tmdbKey, hooks.fetch);
        await atomic(['catalog_titles'], async (tx) => { const cur = await tx.get('catalog_titles', t.ck); if (cur) tx.put('catalog_titles', { ...cur, tmdbId: id || null, tmdbLookupAt: Date.now() }); });
      }
      if (id) {
        const rec = await tmdb.getTv(id, settings.tmdbKey, cache.get(id) || null, hooks.fetch);
        if (rec) { await put('tmdb_cache', rec); cache.set(id, rec); }
      }
    } catch (e) {
      job.errors++;
      if (/non valida/.test(e.message)) { job.status = 'error'; job.error = e.message; break; }
    }
    job.done = i + 1; job.cursor.index = i + 1;
    if ((i + 1) % 10 === 0 || i + 1 === unique.length) await saveJob(job);
  }
  if (job.status === 'running') job.status = 'done';
  job.complete = job.status === 'done'; job.endedAt = Date.now();
  note(job, `Metadati aggiornati: ${job.done}/${job.todo}`);
  await saveJob(job);
  await runMatching();
  try { await hooks.afterPromote({ added: [], removed: [], seasonChanges: [], tmdb: true, since: job.startedAt }, job); } catch { /* ignora */ }
}

// --- Catalogo legale dai fornitori scelti
async function runTmdbProviders(job, ctl, settings) {
  if (!settings.tmdbKey) throw new Error('Inserisci la tua chiave TMDB nelle impostazioni');
  const ids = settings.tmdbProviders.ids || [];
  if (!ids.length) throw new Error('Scegli almeno un fornitore nelle impostazioni del catalogo legale');
  const region = settings.tmdbProviders.region || 'IT';
  const maxPages = settings.tmdbProviders.maxPages || 40;
  const genreMap = await tmdb.tvGenres(settings.tmdbKey, hooks.fetch);
  const provList = await tmdb.providers(settings.tmdbKey, region, hooks.fetch);
  const nameOf = new Map(provList.map((p) => [p.id, p.name]));
  let allComplete = true;
  const seen = new Map((await getAll('scan_staging', 'jobId', job.id)).map((s) => [s.ck, s.rec]));
  for (let p = job.cursor.provider; p < ids.length; p++) {
    const pid = ids[p];
    let page = job.cursor.page || 1; let totalPages = null;
    for (;;) {
      const c = await checkCtl(job, ctl);
      if (c === 'pause') return;
      if (c === 'stop') { allComplete = false; break; }
      const d = await tmdb.discoverPage(settings.tmdbKey, { region, providerId: pid, page }, hooks.fetch);
      totalPages = d?.total_pages ?? 0;
      const recs = (d?.results || []).map((r) => tp.normalizeDiscover(r, genreMap, nameOf.get(pid) || `#${pid}`));
      const toStage = recs.map((r) => {
        const prev = seen.get(r.ck);
        const merged = prev ? { ...prev, providers: [...new Set([...prev.providers, ...r.providers])] } : r;
        seen.set(r.ck, merged);
        return merged;
      });
      await stage(job, toStage);
      job.pagesDone++; job.titlesFound = seen.size; job.cursor.page = page + 1;
      await saveJob(job);
      if (page >= totalPages || page >= maxPages || page >= 500) break;
      page++;
    }
    if (totalPages != null && totalPages > maxPages) { allComplete = false; note(job, `${nameOf.get(pid)}: lette ${maxPages} pagine su ${totalPages} (limite impostato)`); }
    job.cursor.provider = p + 1; job.cursor.page = 1;
    if (job.status === 'stopped') break;
  }
  if (job.status === 'running') job.status = allComplete ? 'done' : 'partial';
  job.complete = job.status === 'done'; job.endedAt = Date.now();
  await promote(job, job.complete);
  await saveJob(job);
}

export async function clearJobs() {
  const jobs = await getAll('scan_jobs');
  for (const j of jobs) if (j.status !== 'running' && j.status !== 'paused') await deleteByIndex('scan_staging', 'jobId', j.id);
}
