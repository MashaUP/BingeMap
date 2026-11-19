import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './_setup.js';
import * as scanner from '../../src/scan/scanner.js';
import { saveSettings } from '../../src/common/settings.js';
import { getAll, get } from '../../src/db/db.js';
import { extractPageData, parseList, fingerprint, blockedReason, normalizeTitle } from '../../src/catalog/sc/adapter.js';
import { DEFAULTS } from '../../src/common/settings.js';

const T = (id, name, extra = {}) => ({ id, slug: name.toLowerCase().replace(/\W+/g, '-'), name, type: 'tv', score: '7.5', sub_ita: 0, seasons_count: 2, last_air_date: '2020-01-01', ...extra });

// Sito simulato: elenco JSON paginato per offset.
function fakeSite(pages, { status = {}, total = null } = {}) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const off = Number(u.searchParams.get('offset') || 0);
    const idx = off / 60;
    if (status[idx]) return new Response('no', { status: status[idx] });
    const titles = pages[idx] || [];
    return new Response(JSON.stringify({ titles, total }), { status: 200, headers: { 'content-type': 'application/json' } });
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
  scanner.setHooks({ fetch: async (u) => { await gate; return site.fetch(u); }, sleep: async () => {} });
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
