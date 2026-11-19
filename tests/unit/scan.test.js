import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './_setup.js';
import * as scanner from '../../src/scan/scanner.js';
import { saveSettings } from '../../src/common/settings.js';
import { getAll, get } from '../../src/db/db.js';
import { extractPageData, parseList, fingerprint, blockedReason, normalizeTitle, parseDetail } from '../../src/catalog/sc/adapter.js';
import { DEFAULTS, migrateSettings } from '../../src/common/settings.js';

const T = (id, name, extra = {}) => ({ id, slug: name.toLowerCase().replace(/\W+/g, '-'), name, type: 'tv', score: '7.5', sub_ita: 0, seasons_count: 2, last_air_date: '2020-01-01', ...extra });

// Sito simulato con il formato reale: paginatore Laravel su /{lang}/archive?page=N con intestazioni XHR.
function fakeSite(pages, { status = {}, total = null, headers = {} } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push(url);
    const u = new URL(url);
    const idx = Number(u.searchParams.get('page') || 1) - 1;
    if (status[idx]) return new Response(status[idx] === 'captcha' ? '<div class="g-recaptcha"></div>' : 'no', { status: status[idx] === 'captcha' ? 200 : status[idx], headers: headers[idx] || {} });
    if (opts.headers?.['X-Requested-With'] !== 'XMLHttpRequest') return new Response('<html>senza dati</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    const data = pages[idx] || [];
    const body = { current_page: idx + 1, data, last_page: pages.length, per_page: 60, total };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}

async function waitJob(id) {
  for (let i = 0; i < 400; i++) {
    const j = await get('scan_jobs', id);
    if (j && !['running'].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timeout');
}

async function setup() {
  freshDb();
  await saveSettings({ sc: { origin: 'https://sito.test', lang: 'it', strategy: 'api' } });
}

test('adattatore: data-page, elenchi, impronta, blocchi', () => {
  const html = `<div id="app" data-page="${JSON.stringify({ component: 'Archive', props: { titles: [T(1, 'Dark')], total: 1 } }).replace(/"/g, '&quot;')}"></div>`;
  assert.equal(extractPageData(html).component, 'Archive');
  const p = parseList(html);
  assert.equal(p.titles.length, 1); assert.equal(p.total, 1);
  assert.equal(fingerprint(html).ok, true);
  assert.equal(fingerprint('<html>nulla</html>').ok, false);
  assert.match(blockedReason(429, ''), /429/);
  assert.match(blockedReason(200, '<div class="cf-chl-widget">'), /CAPTCHA/);
  const r = normalizeTitle(T(5, 'Silo', { tmdb_id: '125988', sub_ita: 1 }), { ...DEFAULTS, sc: { ...DEFAULTS.sc, origin: 'https://sito.test' } });
  assert.equal(r.ck, 'sc:5'); assert.equal(r.tmdbId, 125988); assert.equal(r.subIta, true); assert.equal(r.url, 'https://sito.test/it/titles/5-silo');
});

test('scansione completa: tutte le pagine, promozione, istantanea', async () => {
  await setup();
  const site = fakeSite([[...Array(60)].map((_, i) => T(i + 1, `Serie ${i + 1}`)), [T(61, 'Ultima'), T(62, 'Film', { type: 'movie' })]], { total: 62 });
  scanner.setHooks({ fetch: site.fetch, sleep: async () => {} });
  const j = await scanner.startJob('sc-list');
  const done = await waitJob(j.id);
  assert.equal(done.status, 'done'); assert.equal(done.complete, true);
  const cat = await getAll('catalog_titles');
  assert.equal(cat.length, 61);
  const snaps = await getAll('catalog_snapshots');
  assert.equal(snaps[0].added.length, 61);
  assert.equal((await getAll('scan_staging')).length, 0);
});

test('scansione interrotta o bloccata: nessun titolo segnato come sparito', async () => {
  await setup();
  scanner.setHooks({ fetch: fakeSite([[T(1, 'A'), T(2, 'B')]], { total: 2 }).fetch, sleep: async () => {} });
  await waitJob((await scanner.startJob('sc-list')).id);
  // Seconda scansione: il sito risponde 429 alla prima pagina.
  scanner.setHooks({ fetch: fakeSite([[]], { status: { 0: 429 } }).fetch });
  const j2 = await waitJob((await scanner.startJob('sc-list')).id);
  assert.equal(j2.status, 'blocked'); assert.equal(j2.complete, false);
  const cat = await getAll('catalog_titles');
  assert.ok(cat.every((c) => c.status === 'active' && !c.missCount));
});

test('«non più rilevato» solo dopo 2 scansioni complete; stagioni cambiate registrate', async () => {
  await setup();
  scanner.setHooks({ fetch: fakeSite([[T(1, 'A'), T(2, 'B')]]).fetch, sleep: async () => {} });
  await waitJob((await scanner.startJob('sc-list')).id);
  scanner.setHooks({ fetch: fakeSite([[T(1, 'A', { seasons_count: 3 })]]).fetch });
  await waitJob((await scanner.startJob('sc-list')).id);
  let b = await get('catalog_titles', 'sc:2');
  assert.equal(b.status, 'active'); assert.equal(b.missCount, 1);
  const a = await get('catalog_titles', 'sc:1');
  assert.equal(a.seasonsCount, 3); assert.equal(a.history.at(-1).prev, 2);
  await waitJob((await scanner.startJob('sc-list')).id);
  b = await get('catalog_titles', 'sc:2');
  assert.equal(b.status, 'gone');
  // Ritorno nel catalogo
  scanner.setHooks({ fetch: fakeSite([[T(1, 'A', { seasons_count: 3 }), T(2, 'B')]]).fetch });
  const j = await waitJob((await scanner.startJob('sc-list')).id);
  assert.equal((await get('catalog_titles', 'sc:2')).status, 'active');
  assert.ok(j.result.added === 0);
});

test('una sola operazione alla volta, pausa e ripresa', async () => {
  await setup();
  let release; const gate = new Promise((r) => { release = r; });
  const site = fakeSite([[T(1, 'A')], [T(2, 'B')]]);
  scanner.setHooks({ fetch: async (u, o) => { await gate; return site.fetch(u, o); }, sleep: async () => {} });
  const j = await scanner.startJob('sc-list');
  await assert.rejects(() => scanner.startJob('sc-list'), /già un'operazione/);
  await scanner.pauseJob(j.id);
  release();
  let paused;
  for (let i = 0; i < 200; i++) { paused = await get('scan_jobs', j.id); if (paused.status === 'paused') break; await new Promise((r) => setTimeout(r, 5)); }
  assert.equal(paused.status, 'paused');
  await scanner.resumeJob(j.id);
  const done = await waitJob(j.id);
  assert.equal(done.status, 'done');
  assert.equal((await getAll('catalog_titles')).length, 2);
});

// --- 1.1.0: struttura reale del sito e cambi del sito (test 9)

test('sito reale: elenco JSON con intestazioni XHR, fine con last_page, URL corretto', async () => {
  await setup();
  const site = fakeSite([[T(1, 'A'), T(2, 'B')], [T(3, 'C')]], { total: 3 });
  scanner.setHooks({ fetch: site.fetch, sleep: async () => {} });
  const done = await waitJob((await scanner.startJob('sc-list')).id);
  assert.equal(done.status, 'done'); assert.equal(done.complete, true);
  assert.equal(site.calls.length, 2, 'si ferma all\'ultima pagina senza chiederne una vuota');
  assert.match(site.calls[0], /^https:\/\/sito\.test\/it\/archive\?lang=it&type=tv&page=1$/);
});

test('sito reale: HTML con data-page e scheda con slider «related», episodi e servizi legali', () => {
  const page = { component: 'Titles/Title', props: { title: { ...T(9, 'Dark'), tmdb_id: 70523, seasons: [{ number: 1, episodes_count: 10 }, { number: 2, episodes_count: 8 }], keywords: [{ name: 'time travel' }], main_actors: [{ name: 'Louis Hofmann' }], netflix_id: 80100172, dub_ita: 1 },
    sliders: [{ name: 'related', titles: [T(10, 'Dark 2'), T(11, '1899')] }, { name: 'genre', titles: [] }] } };
  const html = `<div id="app" data-page="${JSON.stringify(page).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></div>`;
  const raw = parseDetail(html);
  assert.deepEqual(raw.related, [10, 11]);
  const r = normalizeTitle(raw, { ...DEFAULTS, sc: { ...DEFAULTS.sc, origin: 'https://sito.test' } });
  assert.equal(r.episodesCount, 18); assert.deepEqual(r.seasonEpisodes.map((x) => x.episodes), [10, 8]);
  assert.deepEqual(r.keywords, ['time travel']); assert.deepEqual(r.cast, ['Louis Hofmann']);
  assert.deepEqual(r.providerIds, ['Netflix']); assert.equal(r.dubIta, true);
});

test('impostazioni salvate dalla 1.0.0 aggiornate ai percorsi reali', () => {
  const old = { sc: { apiPath: '/api/archive', pageParam: 'offset', origin: 'https://x.test' } };
  const m = migrateSettings(old);
  assert.equal(m.sc.apiPath, '/{lang}/archive'); assert.equal(m.sc.pageParam, 'page'); assert.equal(m.sc.origin, 'https://x.test');
  const custom = migrateSettings({ settingsRev: 2, sc: { apiPath: '/api/archive' } });
  assert.equal(custom.sc.apiPath, '/api/archive', 'una scelta fatta dopo la migrazione resta');
});

test('sito cambiato: pagina senza dati, CAPTCHA, 429 con Retry-After → stop senza sporcare il catalogo', async () => {
  await setup();
  scanner.setHooks({ fetch: fakeSite([[T(1, 'A'), T(2, 'B')]], { total: 2 }).fetch, sleep: async () => {} });
  await waitJob((await scanner.startJob('sc-list')).id);
  const before = (await getAll('catalog_titles')).map((c) => c.ck).sort();
  // Struttura cambiata: risponde HTML senza dati alla richiesta JSON.
  scanner.setHooks({ fetch: async () => new Response('<html><body>nuovo sito</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }) });
  const j1 = await waitJob((await scanner.startJob('sc-list')).id);
  assert.notEqual(j1.status, 'done'); assert.equal(j1.complete, false);
  scanner.setHooks({ fetch: fakeSite([[]], { status: { 0: 'captcha' } }).fetch });
  const j2 = await waitJob((await scanner.startJob('sc-list')).id);
  assert.equal(j2.status, 'blocked'); assert.match(j2.error || j2.blockedReason || '', /CAPTCHA/i);
  scanner.setHooks({ fetch: fakeSite([[]], { status: { 0: 429 }, headers: { 0: { 'retry-after': '3600' } } }).fetch });
  const j3 = await waitJob((await scanner.startJob('sc-list')).id);
  assert.equal(j3.status, 'blocked');
  const after = await getAll('catalog_titles');
  assert.deepEqual(after.map((c) => c.ck).sort(), before);
  assert.ok(after.every((c) => c.status === 'active' && !c.missCount));
});

test('cambio di dominio: stessi titoli, nessun doppione, indirizzi aggiornati', async () => {
  await setup();
  scanner.setHooks({ fetch: fakeSite([[T(1, 'A'), T(2, 'B')]], { total: 2 }).fetch, sleep: async () => {} });
  await waitJob((await scanner.startJob('sc-list')).id);
  await saveSettings({ sc: { origin: 'https://nuovo-dominio.test' } });
  await waitJob((await scanner.startJob('sc-list')).id);
  const cat = await getAll('catalog_titles');
  assert.equal(cat.length, 2);
  assert.ok(cat.every((c) => c.url.startsWith('https://nuovo-dominio.test/')));
});
