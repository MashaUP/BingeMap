// Audit 1.3.2: test di regressione per i guasti trovati sul sito reale e nel codice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, cat } from './_setup.js';
import * as scanner from '../../src/scan/scanner.js';
import { saveSettings, loadSettings, DEFAULTS } from '../../src/common/settings.js';
import { getAll, get, put, putMany } from '../../src/db/db.js';
import * as sc from '../../src/catalog/sc/adapter.js';

const YEAR = new Date().getFullYear();
const T = (id, y) => ({ id, slug: `serie-${id}`, name: `Serie ${id}`, type: 'tv', score: '7', sub_ita: 0, seasons_count: 1, last_air_date: `${y}-05-01`, _y: y });

// Il sito reale (20/11/2026): l'elenco JSON si ferma a 20 pagine per richiesta («Page limit reached (20)», HTTP 503)
// e accetta il filtro year: anni singoli dal 2000, decenni prima (year=1990 = 1990–1999); valori fuori elenco → 422.
function realisticSite(titles, { limit = 20, perPage = 60 } = {}) {
  const calls = [];
  const validYear = (y) => (y >= 2000 && y <= YEAR) || (y >= 1910 && y < 2000 && y % 10 === 0);
  const fetch = async (url, opts = {}) => {
    calls.push(url);
    const u = new URL(url);
    if (opts.headers?.['X-Requested-With'] !== 'XMLHttpRequest') return new Response('<html>senza dati</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    const n = Number(u.searchParams.get('page') || 1);
    const yq = u.searchParams.get('year');
    let pool = titles;
    if (yq != null) {
      const y = Number(yq);
      if (!validYear(y)) return new Response(JSON.stringify({ message: 'The selected year is invalid.' }), { status: 422, headers: { 'content-type': 'application/json' } });
      pool = titles.filter((t) => (y >= 2000 ? t._y === y : t._y >= y && t._y < y + 10));
    }
    if (n > limit) return new Response(JSON.stringify(`Page limit reached (${limit})`), { status: 503, headers: { 'content-type': 'application/json' } });
    const data = pool.slice((n - 1) * perPage, n * perPage).map(({ _y, ...t }) => t);
    return new Response(JSON.stringify({ current_page: n, data, last_page: Math.max(1, Math.ceil(pool.length / perPage)), per_page: perPage, total: pool.length }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}

async function waitJob(id, until = (j) => j.status !== 'running') {
  for (let i = 0; i < 2000; i++) {
    const j = await get('scan_jobs', id);
    if (j && until(j)) return j;
    await new Promise((r) => setTimeout(r, 3));
  }
  throw new Error('timeout');
}

async function setup(extra = {}) {
  freshDb();
  await saveSettings({ sc: { origin: 'https://sito.test', lang: 'it', strategy: 'api', ...extra } });
}

// 1 600 serie: l'elenco senza filtri arriva solo a 20 × 60 = 1 200.
function bigCatalog() {
  const out = []; let id = 1;
  const years = []; for (let y = 2000; y <= YEAR; y++) years.push(y); years.push(1955, 1987, 1999);
  while (out.length < 1600) out.push(T(id++, years[id % years.length]));
  return out;
}

test('C2: oltre 20 pagine il sito risponde 503 «Page limit»: la scansione completa legge tutto, anno per anno', async () => {
  await setup();
  const titles = bigCatalog();
  const site = realisticSite(titles);
  scanner.setHooks({ fetch: site.fetch, sleep: async () => {} });
  const j = await scanner.startJob('sc-list');
  const done = await waitJob(j.id);
  assert.equal(done.status, 'done', done.error || '');
  assert.equal(done.complete, true);
  assert.equal(done.titlesFound, 1600);
  assert.equal((await getAll('catalog_titles')).length, 1600);
  // Mai più di una richiesta oltre il limite per fetta, e nessuna «pagina 21» dopo aver imparato il limite.
  const over = site.calls.filter((u) => Number(new URL(u).searchParams.get('page')) > 20);
  assert.ok(over.length <= 1, `richieste oltre il limite: ${over.length}`);
});

test('C2: un 503 «Page limit» non è un blocco del sito; un 503 qualsiasi sì', () => {
  assert.equal(sc.pageLimitReached(503, '"Page limit reached (20)"'), 20);
  assert.equal(sc.pageLimitReached(503, '<html>Service Unavailable</html>'), null);
  assert.equal(sc.pageLimitReached(200, '"Page limit reached (20)"'), null);
  assert.match(sc.blockedReason(503, '<html>Service Unavailable</html>'), /503/);
});

test('C2: fette dell\'archivio: prima senza filtro, poi ogni anno, poi i decenni', () => {
  const s = sc.listSlices({ ...DEFAULTS.sc, sliceParam: 'year' }, new Date('2026-11-20'));
  assert.equal(s[0], '');
  assert.equal(s[1], 'year=2026');
  assert.ok(s.includes('year=2000') && s.includes('year=1990') && s.includes('year=1910'));
  assert.ok(!s.includes('year=1999'));
  assert.deepEqual(sc.listSlices({ ...DEFAULTS.sc, sliceParam: '' }, new Date()), ['']);
  const url = sc.listUrl({ sc: { ...DEFAULTS.sc, origin: 'https://x.test' } }, 2, 'api', 'year=2024');
  assert.equal(url, 'https://x.test/it/archive?lang=it&type=tv&year=2024&page=3');
});

test('C2: un valore del filtro rifiutato (422) salta solo quella fetta', async () => {
  await setup();
  const titles = bigCatalog();
  const base = realisticSite(titles);
  const fetch = async (url, opts) => (new URL(url).searchParams.get('year') === '2010' ? new Response('{"message":"invalid"}', { status: 422, headers: { 'content-type': 'application/json' } }) : base.fetch(url, opts));
  scanner.setHooks({ fetch, sleep: async () => {} });
  const done = await waitJob((await scanner.startJob('sc-list')).id);
  assert.notEqual(done.status, 'error');
  assert.notEqual(done.status, 'blocked');
  assert.ok(done.log.some((l) => /2010/.test(l.text)));
});

test('C2: scansione ripresa dopo una pausa a metà delle fette: nessuna fetta persa', async () => {
  await setup();
  const titles = bigCatalog();
  const site = realisticSite(titles);
  let n = 0; let jobId = null;
  scanner.setHooks({ fetch: async (u, o) => { if (++n === 25 && jobId) await scanner.pauseJob(jobId); return site.fetch(u, o); }, sleep: async () => {} });
  jobId = (await scanner.startJob('sc-list')).id;
  const paused = await waitJob(jobId);
  assert.equal(paused.status, 'paused');
  await scanner.resumeJob(jobId);
  const done = await waitJob(jobId);
  assert.equal(done.status, 'done');
  assert.equal(done.titlesFound, 1600);
});

test('H1: dettagli ripresi dopo una pausa: nessun titolo saltato', async () => {
  await setup();
  await putMany('catalog_titles', [...Array(30)].map((_, i) => cat(i + 1, `Serie ${i + 1}`, { slug: `serie-${i + 1}` })));
  let jobId = null; let calls = 0;
  const html = (id) => `<div id="app" data-page="${JSON.stringify({ component: 'Titles/Title', version: 'v1', props: { title: { id, name: `Serie ${id}`, slug: `serie-${id}`, type: 'tv', plot: 'Trama', seasons: [{ number: 1, episodes_count: 8 }] } } }).replace(/"/g, '&quot;')}"></div>`;
  scanner.setHooks({
    fetch: async (url) => { calls++; if (calls === 10 && jobId) await scanner.pauseJob(jobId); const id = Number(url.match(/titles\/(\d+)/)[1]); return new Response(html(id), { status: 200, headers: { 'content-type': 'text/html' } }); },
    sleep: async () => {},
  });
  await saveSettings({ sc: { detailVia: 'html' } });
  jobId = (await scanner.startJob('sc-detail')).id;
  assert.equal((await waitJob(jobId)).status, 'paused');
  await scanner.resumeJob(jobId);
  const done = await waitJob(jobId);
  assert.equal(done.status, 'done');
  const all = await getAll('catalog_titles');
  assert.equal(all.filter((c) => c.detailAt).length, 30, 'tutte le schede lette');
  assert.equal(done.done, 30);
});

test('H2: due riprese contemporanee della stessa operazione (avvio del browser) la eseguono una volta sola', async () => {
  await setup();
  const titles = bigCatalog().slice(0, 200);
  const site = realisticSite(titles);
  scanner.setHooks({ fetch: site.fetch, sleep: async () => { await new Promise((r) => setTimeout(r, 1)); } });
  await put('scan_jobs', { id: 'j_int', kind: 'sc-list', mode: 'full', status: 'running', startedAt: Date.now(), pagesDone: 0, titlesFound: 0, errors: 0, strategy: 'api', cursor: { page: 0, seen: [] }, log: [], opts: {} });
  await Promise.all([scanner.resumeInterrupted(), scanner.resumeInterrupted(), scanner.resumeJob('j_int')]);
  const done = await waitJob('j_int');
  assert.equal(done.status, 'done');
  const first = site.calls.filter((u) => !new URL(u).searchParams.get('year') && new URL(u).searchParams.get('page') === '1');
  assert.equal(first.length, 1, `pagina 1 chiesta ${first.length} volte`);
});

test('H2: due avvii contemporanei: parte una sola operazione', async () => {
  await setup();
  const site = realisticSite(bigCatalog().slice(0, 100));
  scanner.setHooks({ fetch: site.fetch, sleep: async () => {} });
  const r = await Promise.allSettled([scanner.startJob('sc-list'), scanner.startJob('sc-list')]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  assert.match(r.find((x) => x.status === 'rejected').reason.message, /già un'operazione/);
  await waitJob(r.find((x) => x.status === 'fulfilled').value.id);
});

test('M2: schede lette come dati della pagina (Inertia, solo il titolo), con ritorno all\'HTML se la versione cambia', async () => {
  await setup({ inertiaVersion: 'vecchia' });
  await putMany('catalog_titles', [1, 2, 3].map((i) => cat(i, `Serie ${i}`, { slug: `serie-${i}`, url: `https://dominio-vecchio.test/it/titles/${i}-serie-${i}` })));
  const seen = [];
  const title = (id) => ({ id, name: `Serie ${id}`, slug: `serie-${id}`, type: 'tv', plot: 'Trama', tmdb_id: 100 + id, seasons: [{ number: 1, episodes_count: 6 }] });
  scanner.setHooks({
    sleep: async () => {},
    fetch: async (url, opts = {}) => {
      const h = opts.headers || {};
      seen.push({ url, inertia: h['X-Inertia'], version: h['X-Inertia-Version'], partial: h['X-Inertia-Partial-Data'] });
      const id = Number(url.match(/titles\/(\d+)/)[1]);
      if (h['X-Inertia']) {
        if (h['X-Inertia-Version'] !== 'nuova') return new Response('', { status: 409, headers: { 'x-inertia-location': url } });
        return new Response(JSON.stringify({ component: 'Titles/Title', version: 'nuova', props: { title: title(id), sliders: [{ name: 'related', titles: [{ id: 9 }] }] } }), { status: 200, headers: { 'content-type': 'application/json', 'x-inertia': 'true' } });
      }
      return new Response(`<div id="app" data-page="${JSON.stringify({ component: 'Titles/Title', version: 'nuova', props: { title: title(id) } }).replace(/"/g, '&quot;')}"></div>`, { status: 200, headers: { 'content-type': 'text/html' } });
    },
  });
  const done = await waitJob((await scanner.startJob('sc-detail')).id);
  assert.equal(done.status, 'done', done.error || '');
  // Indirizzo sempre dal sito collegato ora, non quello salvato con il dominio vecchio.
  assert.ok(seen.every((s) => s.url.startsWith('https://sito.test/')), seen.map((s) => s.url).join(' '));
  // Primo tentativo con la versione vecchia (409) → HTML → versione nuova imparata → le altre via JSON.
  assert.equal(seen[0].version, 'vecchia');
  assert.equal(seen[1].inertia, undefined);
  assert.ok(seen.slice(2).every((s) => s.inertia === 'true' && s.version === 'nuova'));
  assert.equal(seen[2].partial, 'title,sliders');
  assert.equal((await loadSettings()).sc.inertiaVersion, 'nuova');
  const c2 = await get('catalog_titles', 'sc:2');
  assert.equal(c2.tmdbId, 102); assert.deepEqual(c2.recommendations, [9]); assert.equal(c2.episodesCount, 6);
});

test('M3: due salvataggi contemporanei delle impostazioni non si cancellano a vicenda', async () => {
  freshDb();
  await Promise.all([saveSettings({ tmdbKey: 'abc' }), saveSettings({ sc: { origin: 'https://sito.test' } }), saveSettings({ hoursPerWeek: 9 })]);
  const s = await loadSettings();
  assert.equal(s.tmdbKey, 'abc'); assert.equal(s.sc.origin, 'https://sito.test'); assert.equal(s.hoursPerWeek, 9);
});

test('regressione: il primo avvio di una scansione vecchia (cursore senza fette) riparte dalla sua pagina', async () => {
  await setup();
  const titles = bigCatalog().slice(0, 300);
  const site = realisticSite(titles);
  scanner.setHooks({ fetch: site.fetch, sleep: async () => {} });
  await put('scan_jobs', { id: 'j_old', kind: 'sc-list', mode: 'full', status: 'paused', startedAt: Date.now(), pagesDone: 2, titlesFound: 0, errors: 0, strategy: 'api', cursor: { page: 2, seen: [] }, log: [], opts: {} });
  await scanner.resumeJob('j_old');
  const done = await waitJob('j_old');
  assert.equal(done.status, 'done');
  assert.ok(!site.calls.some((u) => !new URL(u).searchParams.get('year') && new URL(u).searchParams.get('page') === '1'), 'pagine già fatte non richieste');
  assert.equal(done.titlesFound, 300);
});

test('C2: archivio piccolo (entro il limite di pagine): niente fette, nessuna richiesta in più', async () => {
  await setup();
  const site = realisticSite(bigCatalog().slice(0, 150));
  scanner.setHooks({ fetch: site.fetch, sleep: async () => {} });
  const done = await waitJob((await scanner.startJob('sc-list')).id);
  assert.equal(done.status, 'done'); assert.equal(done.titlesFound, 150);
  assert.equal(site.calls.length, 3);
  assert.ok(site.calls.every((u) => !new URL(u).searchParams.get('year')));
});

test('C2: se il sito ignora il filtro per anno non rilegge l\'elenco per ogni anno', async () => {
  await setup();
  const titles = bigCatalog();
  const base = realisticSite(titles);
  const fetch = async (url, opts) => { const u = new URL(url); u.searchParams.delete('year'); return base.fetch(u.href, opts); };
  scanner.setHooks({ fetch, sleep: async () => {} });
  const done = await waitJob((await scanner.startJob('sc-list')).id);
  assert.ok(base.calls.length <= 22, `${base.calls.length} richieste`);
  assert.equal(done.status, 'partial'); // il sito mostra solo 1 200 serie su 1 600: parziale, onesta
  assert.equal(done.titlesFound, 1200);
  assert.ok(done.log.some((l) => /ignora il filtro/.test(l.text)));
});

test('M5: la prima scansione completa non conta come «novità»; la seconda conta solo i titoli nuovi', async () => {
  await setup();
  const titles = bigCatalog().slice(0, 100);
  scanner.setHooks({ fetch: realisticSite(titles).fetch, sleep: async () => {} });
  await waitJob((await scanner.startJob('sc-list')).id);
  scanner.setHooks({ fetch: realisticSite([...titles, T(5001, 2024), T(5002, 2025)]).fetch });
  await waitJob((await scanner.startJob('sc-list')).id);
  const snaps = (await getAll('catalog_snapshots')).sort((a, b) => a.date - b.date);
  assert.equal(snaps[0].first, true); assert.equal(snaps[0].added.length, 100);
  assert.equal(snaps[1].first, false); assert.equal(snaps[1].added.length, 2);
});

test('dati veri della scheda (forma Inertia del 20/11/2026): created_by è un numero, gli autori sono main_directors', () => {
  const pivot = (job, i) => ({ pivot: { title_id: 66633, credit_id: i, job, order: 0 }, created_at: '2023-05-18T13:37:05.000000Z' });
  const body = JSON.stringify({ component: 'Titles/Title', version: 'be455088', props: {
    title: { id: 66633, name: 'Miniserie', slug: 'miniserie', type: 'tv', plot: 'Trama', original_name: 'The Altruists', original_language: 'en', status: 'Returning Series',
      runtime: null, score: null, tmdb_id: 308007, imdb_id: 'tt36786185', netflix_id: 81681911, prime_id: null, release_date: '2026-11-19', last_air_date: '2026-11-19',
      sub_ita: 0, dub_ita: 1, created_by: 7, seasons_count: 1, seasons: [{ id: 30074, number: 1, name: 'Stagione 1', release_date: '2026-11-19', episodes_count: 8 }],
      main_directors: [{ id: 71649, name: 'Kyle Patrick Alvarez', ...pivot('director', 71649) }, { id: 101055, name: 'Silver Tree', ...pivot('director', 101055) }],
      main_actors: [{ id: 1353, name: 'Julia Garner', ...pivot('actor', 1353) }, { id: 9566, name: 'Anthony Boyle', ...pivot('actor', 9566) }],
      keywords: [{ id: 608, name: 'miniseries', pivot: { title_id: 66633, keyword_id: 608 } }], genres: [{ id: 1, name: 'Dramma', type: 'all' }] },
    sliders: [{ name: 'related', titles: [{ id: 101, name: 'A', slug: 'a', type: 'tv' }, { id: 102, name: 'B', slug: 'b', type: 'tv' }] }, { name: 'genre', titles: [] }] } });
  assert.equal(sc.pageVersion(body), 'be455088');
  const raw = sc.parseDetail(body);
  const f = sc.detailFields(raw, { sc: { ...DEFAULTS.sc, origin: 'https://sito.test' } });
  assert.deepEqual(f.creators, ['Kyle Patrick Alvarez', 'Silver Tree']);
  assert.deepEqual(f.cast, ['Julia Garner', 'Anthony Boyle']);
  assert.deepEqual(f.recommendations, [101, 102]);
  assert.equal(f.tmdbId, 308007); assert.equal(f.episodesCount, 8); assert.equal(f.dubIta, true);
  assert.deepEqual(f.providerIds, ['Netflix']); assert.equal(f.siteStatus, 'Returning Series'); assert.deepEqual(f.genres, ['Dramma']);
});
