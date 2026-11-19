// Service worker: scansioni in background, aggiornamenti, sincronizzazione, notifiche, badge, messaggi.
import { openDb } from '../db/db.js';
import { loadSettings, saveSettings } from '../common/settings.js';
import { VERSION } from '../common/version.js';
import { checkUpdate, shouldNotify } from '../common/update.js';
import { refreshLinks } from '../common/links.js';
import { log } from '../common/diag.js';
import { broadcast, kv, notify, originPattern } from '../platform/platform.js';
import * as scanner from '../scan/scanner.js';
import * as sc from '../catalog/sc/adapter.js';
import { computeViews, followUpdates, listQueries, setOverlay, setNextUp, markQuerySeen } from '../library/data.js';
import { atomic, getSetting } from '../db/db.js';
import { syncNow } from '../sync/drive.js';
import { STATUS_LABEL } from '../library/status.js';
import { setProfile } from '../db/db.js';

const CONTENT_ID = 'bm-site';

// Mantiene vivo il service worker durante le operazioni lunghe (ogni chiamata API azzera il timer di inattività).
function keepAlive() {
  const t = setInterval(() => { chrome.runtime.getPlatformInfo(() => {}); }, 20000);
  return () => clearInterval(t);
}

scanner.setHooks({
  emit: (evt) => broadcast(evt),
  keepAlive,
  fetch: (...a) => fetch(...a),
  afterPromote: async (snap, job) => { await afterCatalogChange(snap, job); },
});

async function init() {
  const p = await kv.get('activeProfile', 'default');
  setProfile(p);
  await openDb();
  await ensureAlarms();
  await registerSiteScript();
  await scanner.resumeInterrupted();
}

async function ensureAlarms() {
  const s = await loadSettings();
  const want = [['update', 12 * 60], ['links', 12 * 60], ['resume', 2], ['backup-reminder', 24 * 60]];
  if (s.syncAuto) want.push(['sync', 30]);
  if (s.scheduledScan === 'daily') want.push(['scan', 24 * 60]);
  if (s.scheduledScan === 'weekly') want.push(['scan', 7 * 24 * 60]);
  const existing = new Set((await chrome.alarms.getAll()).map((a) => a.name));
  for (const [name, period] of want) if (!existing.has(name)) chrome.alarms.create(name, { periodInMinutes: period, delayInMinutes: name === 'resume' ? 1 : Math.min(period, 5) });
  for (const name of existing) if (!want.some(([n]) => n === name)) chrome.alarms.clear(name);
}

async function registerSiteScript() {
  const s = await loadSettings();
  try { await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_ID] }); } catch { /* non registrato */ }
  if (!s.sc.origin) return;
  const ok = await chrome.permissions.contains({ origins: [originPattern(s.sc.origin)] });
  if (!ok) return;
  await chrome.scripting.registerContentScripts([{ id: CONTENT_ID, matches: [originPattern(s.sc.origin)], js: ['src/content/site.js'], css: ['src/content/badges.css'], runAt: 'document_idle', persistAcrossSessions: true }]);
}

chrome.runtime.onInstalled.addListener(async (d) => {
  await init();
  if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/app.html#/benvenuto') });
});
chrome.runtime.onStartup.addListener(() => { init(); });
init();

chrome.alarms.onAlarm.addListener(async (a) => {
  const s = await loadSettings();
  try {
    if (a.name === 'update' && s.updateCheck) {
      const u = await checkUpdate();
      if (u.available && (await shouldNotify(u.latest)) && s.notifications) notify('bm-update', 'BingeMap: nuova versione', `Disponibile la versione ${u.latest}. Apri BingeMap e premi «Cerca aggiornamento».`);
    }
    if (a.name === 'links') await refreshLinks();
    if (a.name === 'resume') await scanner.resumeInterrupted();
    if (a.name === 'sync' && s.syncAuto) await syncNow({ interactive: false });
    if (a.name === 'scan' && s.sc.origin && (await chrome.permissions.contains({ origins: [originPattern(s.sc.origin)] }))) {
      const act = await scanner.activeJob();
      if (!act) await scanner.startJob('sc-list', { mode: 'update' });
    }
    if (a.name === 'backup-reminder') {
      const last = (await getSetting('lastBackupAt', 0)) || 0;
      const lastSync = (await getSetting('lastSyncAt', 0)) || 0;
      const days = (Date.now() - Math.max(last, lastSync)) / 86400000;
      const notified = await kv.get('backupNotifiedAt', 0);
      if (days > s.backupReminderDays && Date.now() - notified > 3 * 86400000 && s.notifications) {
        await kv.set('backupNotifiedAt', Date.now());
        notify('bm-backup', 'BingeMap: fai un backup', 'Non fai un backup da più di ' + s.backupReminderDays + ' giorni. Togliere l\'estensione cancella i dati locali.');
      }
    }
  } catch (e) { await log('warn', 'alarm', a.name, e.message); }
});

chrome.notifications?.onClicked.addListener((id) => {
  const hash = id.startsWith('bm-q-') ? `/ricerca/${id.slice(5)}` : id === 'bm-missing' ? '/mancanti' : id === 'bm-update' ? '/impostazioni' : id === 'bm-backup' ? '/attivita' : '/scopri';
  chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/app.html#' + hash) });
});

// Dopo una scansione: collezioni seguite, mancanti ora disponibili, titoli monitorati, badge.
async function afterCatalogChange(snap) {
  const s = await loadSettings();
  const { views, nowAvailable } = await computeViews();
  const queries = await listQueries();
  const ups = followUpdates(queries, views);
  let totalNew = 0;
  for (const u of ups) {
    if (u.init) { await markQuerySeen(u.q.id, u.ids); continue; }
    if (u.newIds.length) {
      totalNew += u.newIds.length;
      await atomic(['saved_queries'], async (tx) => { const q = await tx.get('saved_queries', u.q.id); if (q) tx.put('saved_queries', { ...q, newIds: u.newIds, updatedAt: Date.now() }); });
      if (s.notifications) notify(`bm-q-${u.q.id}`, `«${u.q.name}»: ${u.newIds.length} nuove`, views.filter((v) => u.newIds.includes(v.ck)).slice(0, 3).map((v) => v.name).join(', '));
    }
  }
  const fresh = nowAvailable.filter((n) => Date.now() - n.at < 3600000);
  if (fresh.length && s.notifications) notify('bm-missing', `${fresh.length} serie mancanti ora disponibili`, 'Erano nelle tue liste e ora sono nel catalogo.');
  // Titoli monitorati (F12): cambi di stagioni o ritorno nel catalogo.
  const changed = new Set([...(snap.seasonChanges || []), ...(snap.back || [])]);
  for (const v of views) if (v.monitor && v.cks.some((ck) => changed.has(ck)) && s.notifications) notify(`bm-t-${v.ck}`, `${v.name}: novità`, 'Il titolo che monitori è cambiato nel catalogo.');
  const newCount = (snap.added || []).length;
  if (newCount || totalNew) await kv.set('badgeNew', (await kv.get('badgeNew', 0)) + newCount);
  await updateBadge();
}

async function updateBadge() {
  const n = await kv.get('badgeNew', 0);
  await chrome.action.setBadgeBackgroundColor({ color: '#6D4AFF' });
  await chrome.action.setBadgeText({ text: n ? (n > 99 ? '99+' : `+${n}`) : '' });
}

// Cache delle viste per i badge del sito (60 secondi).
let viewCache = { at: 0, bySite: null, views: null };
async function viewsBySite() {
  if (viewCache.bySite && Date.now() - viewCache.at < 60000) return viewCache;
  const { views } = await computeViews({ activeCatalog: 'all' });
  const bySite = new Map();
  for (const v of views) for (const ck of v.cks) if (ck.startsWith('sc:')) bySite.set(ck.slice(3), v);
  viewCache = { at: Date.now(), bySite, views };
  return viewCache;
}
function invalidate() { viewCache = { at: 0, bySite: null, views: null }; }

const handlers = {
  async 'ping'() { return { version: VERSION }; },
  async 'scan.start'({ kind, mode, opts }) { return scanner.startJob(kind, { ...(opts || {}), mode }); },
  async 'scan.pause'({ id }) { await scanner.pauseJob(id); return true; },
  async 'scan.resume'({ id }) { return scanner.resumeJob(id); },
  async 'scan.stop'({ id }) { await scanner.stopJob(id); return true; },
  async 'scan.active'() { const j = await scanner.activeJob(); return j ? scanner.publicJob(j) : null; },
  async 'badge.clear'() { await kv.set('badgeNew', 0); await updateBadge(); return true; },
  async 'alarms.refresh'() { await ensureAlarms(); return true; },
  async 'site.register'() { await registerSiteScript(); return true; },

  // Collega il sito dalla scheda aperta: verifica dell'impronta della pagina, non del dominio.
  async 'site.connect'({ tabId, url }) {
    const u = new URL(url);
    const origin = u.origin;
    if (!(await chrome.permissions.contains({ origins: [originPattern(origin)] }))) throw new Error('Permesso per il sito non concesso');
    const [{ result: html }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.documentElement.outerHTML });
    const fp = sc.fingerprint(html);
    if (!fp.ok) throw new Error(fp.reason + ' Apri la pagina dell\'archivio o della ricerca delle serie e riprova.');
    const seg = u.pathname.split('/').filter(Boolean);
    const lang = seg[0] && /^[a-z]{2}$/.test(seg[0]) ? seg[0] : '';
    const patch = { sc: { origin, lang } };
    const archiveSeg = seg.find((x) => /archiv/i.test(x));
    if (archiveSeg) patch.sc.archivePath = '/' + archiveSeg;
    await saveSettings(patch);
    await registerSiteScript();
    await log('info', 'site', 'connect', `titoli=${fp.titles}`);
    // Raccolta passiva della pagina attuale.
    const parsed = sc.parseList(html);
    if (parsed.titles.length) await harvest(parsed.titles);
    return { ok: true, origin, lang, found: fp.titles };
  },

  // Il content script manda i titoli delle pagine visitate: si aggiungono senza mai segnare spariti.
  async 'site.harvest'({ titles }) { return harvest(titles || []); },

  async 'site.status'({ ids }) {
    const { bySite } = await viewsBySite();
    const s = await loadSettings();
    const out = {};
    for (const id of ids) {
      const v = bySite.get(String(id));
      if (!v) continue;
      const tags = [...Object.values(v.impTags).flat(), ...v.userTags].slice(0, 2);
      out[id] = { ck: v.ck, status: v.status, label: STATUS_LABEL[v.status], tags, nextUp: v.nextUp != null };
    }
    return { map: out, hideCompleted: s.hideCompletedOnSite, badges: s.badgesOnSite, version: VERSION };
  },
  async 'site.title'({ siteId }) {
    const { bySite } = await viewsBySite();
    const v = bySite.get(String(siteId));
    if (!v) return null;
    return { ck: v.ck, name: v.name, year: v.year, genres: v.genreLabels, seasons: v.seasons, status: v.status, statusBySource: v.statusBySource, tags: [...Object.values(v.impTags).flat(), ...v.userTags], poster: v.poster, nextUp: v.nextUp != null };
  },
  async 'overlay.set'({ ck, patch }) { await setOverlay(ck, patch); invalidate(); broadcast({ kind: 'data' }); return true; },
  async 'nextup.set'({ ck, on }) { await setNextUp(ck, on); invalidate(); broadcast({ kind: 'data' }); return true; },
  async 'data.changed'() { invalidate(); return true; },
  async 'open.detail'({ ck }) { await chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/app.html#/serie/' + encodeURIComponent(ck)) }); return true; },
  async 'sync.now'({ interactive }) { return syncNow({ interactive: !!interactive }); },
  async 'update.check'() { return checkUpdate(); },
};

async function harvest(rawTitles) {
  const s = await loadSettings();
  const recs = rawTitles.map((t) => sc.normalizeTitle(t, s)).filter((r) => r.type === 'tv' && r.name);
  if (!recs.length) return { added: 0 };
  const now = Date.now();
  let added = 0;
  await atomic(['catalog_titles'], async (tx) => {
    for (const r of recs) {
      const old = await tx.get('catalog_titles', r.ck);
      if (!old) { added++; tx.put('catalog_titles', { ...r, firstSeen: now, lastSeen: now, status: 'active', missCount: 0, history: [{ date: now, seasonsCount: r.seasonsCount }], harvested: true }); continue; }
      const merged = { ...old };
      for (const [k, v] of Object.entries(r)) if (v != null && !(Array.isArray(v) && !v.length)) merged[k] = v;
      merged.lastSeen = now;
      if (old.status === 'gone') { merged.status = 'active'; merged.missCount = 0; }
      tx.put('catalog_titles', merged);
    }
  });
  if (added) { invalidate(); broadcast({ kind: 'data' }); }
  return { added };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.__event) return false;
  const fn = handlers[msg.type];
  if (!fn) return false;
  Promise.resolve().then(() => fn(msg, sender)).then((r) => sendResponse(r ?? null)).catch(async (e) => {
    await log('error', 'sw', msg.type, e.message);
    sendResponse({ __error: e.message });
  });
  return true;
});

// Cambio profilo dalla dashboard.
chrome.storage.onChanged.addListener((ch) => {
  if (ch.activeProfile) { setProfile(ch.activeProfile.newValue || 'default'); invalidate(); }
});
