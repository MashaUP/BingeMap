// Test della 1.1.0: nuove funzioni e i controlli che mancavano (migrazioni, segreti, aggiornamenti, prestazioni,
// codifiche, filtri casuali, ora legale, alfabeti, sincronizzazione tra due dispositivi, accessi OAuth).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { freshDb, cat } from './_setup.js';
import { openDb, closeDb, dbName, setProfile, get, STORES } from '../../src/db/db.js';
import { DEFAULTS, saveSettings } from '../../src/common/settings.js';
import { buildViews } from '../../src/library/view.js';
import { runQuery, evalNode, FIELDS } from '../../src/query/engine.js';
import { normTitle } from '../../src/match/normalize.js';
import { buildIndex, matchItem } from '../../src/match/matcher.js';
import { collator, calendarDays, sameProvider } from '../../src/common/util.js';
import { decodeBytes, parseCsv } from '../../src/import/csv.js';
import { rowsFromRecords, suggestMapping, parseNetflix, splitNetflixTitle, isNetflixCsv } from '../../src/import/sources.js';
import { extractTitles } from '../../src/import/paste.js';
import { computeProgress, episodesUpTo, nextEpisode } from '../../src/library/progress.js';
import { calendarItems, renewalAlerts } from '../../src/library/alerts.js';
import { toIcs } from '../../src/common/ics.js';
import { planMarathon } from '../../src/library/planner.js';
import { tonight } from '../../src/recommend/tonight.js';
import { buildMap } from '../../src/recommend/map.js';
import { computeWrapped } from '../../src/library/wrapped.js';
import { setOverlay, saveQuery, deleteQuery, listQueries } from '../../src/library/data.js';
import { undo, canUndo, clearUndo } from '../../src/library/undo.js';
import { findByText } from '../../src/library/search.js';
import { mapTv, watchOf } from '../../src/metadata/tmdb.js';
import { checkUpdate, shouldNotify, needsReload } from '../../src/common/update.js';
import { getLinks, refreshLinks } from '../../src/common/links.js';
import { log, report } from '../../src/common/diag.js';
import { exportAll } from '../../src/backup/backup.js';
import { syncNow, getToken } from '../../src/sync/drive.js';
import { connectSimkl } from '../../src/import/simkl.js';
import { kv, sessionKv, setAuthFlowForTests } from '../../src/platform/platform.js';

const S = { ...DEFAULTS };
const DAY = 86400000;

// ---------- Test 2: migrazioni del database
test('migrazioni: un database della versione 1 con dati arriva all\'ultima versione senza perdere niente', async () => {
  const profile = `mig${Date.now()}`;
  const name = dbName(profile);
  await new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of ['catalog_titles', 'catalog_snapshots', 'scan_jobs', 'scan_staging', 'import_batches', 'library_raw', 'library_items', 'matches', 'match_rules', 'overlay', 'tags', 'tag_aliases', 'saved_queries', 'tmdb_cache', 'settings']) {
        const os = db.createObjectStore(s, { keyPath: STORES[s].keyPath });
        for (const [idx, path] of STORES[s].indexes || []) os.createIndex(idx, path);
      }
      const tx = r.transaction;
      tx.objectStore('catalog_titles').put(cat(1, 'Dark'));
      tx.objectStore('overlay').put({ ck: 'sc:1', status: 'completed', rating: 9, tags: ['top'] });
      tx.objectStore('saved_queries').put({ id: 'q1', name: 'Mie', query: { all: [] } });
    };
    r.onsuccess = () => { r.result.close(); resolve(); };
    r.onerror = () => reject(r.error);
  });
  setProfile(profile);
  const db = await openDb();
  assert.equal(db.version, 3);
  for (const s of ['tag_rules', 'diary', 'diag', 'handles']) assert.ok(db.objectStoreNames.contains(s), s);
  assert.equal((await get('overlay', 'sc:1')).rating, 9);
  assert.equal((await get('catalog_titles', 'sc:1')).name, 'Dark');
  assert.equal((await get('saved_queries', 'q1')).name, 'Mie');
  await closeDb();
});

// ---------- Test 3: i segreti non escono mai
test('segreti: diagnostica, backup e dati sincronizzati non contengono chiavi né token', async () => {
  freshDb();
  const SECRETS = ['tmdb-SEGRETO-123456', 'simkl-CLIENT-abcdef', 'google-CID.apps.googleusercontent.com', 'ya29.TOKEN-GOOGLE', 'simkl-TOKEN-999'];
  await saveSettings({ tmdbKey: SECRETS[0], simklClientId: SECRETS[1], googleClientId: SECRETS[2] });
  await sessionKv.set('gtoken', { token: SECRETS[3], exp: Date.now() + 3600000 });
  await kv.set('simklToken', SECRETS[4]);
  await log('error', 'tmdb', 'http', `https://api.themoviedb.org/3/tv/1?api_key=${SECRETS[0]}`);
  await log('error', 'sync', 'http', `Bearer ${SECRETS[3]} access_token=${SECRETS[3]}`);
  const diag = JSON.stringify(await report());
  const backup = JSON.stringify(await exportAll({ includeCatalog: true }));
  for (const s of SECRETS) {
    assert.ok(!diag.includes(s), `diagnostica contiene ${s}`);
    assert.ok(!backup.includes(s), `backup contiene ${s}`);
  }
  // Sincronizzazione: il file caricato su Drive non contiene segreti.
  const drive = fakeDrive();
  globalThis.fetch = drive.fetch;
  await syncNow();
  const uploaded = JSON.stringify(drive.file);
  for (const s of SECRETS) assert.ok(!uploaded.includes(s), `sync contiene ${s}`);
});

// ---------- Test 5: «Cerca aggiornamento», links.json, pagine vecchie
test('aggiornamenti: versione nuova, una notifica per versione, link Discord da links.json, ricarica', async () => {
  const json = (o) => async () => new Response(JSON.stringify(o), { status: 200 });
  const u = await checkUpdate(json({ version: '9.9.9', notes: 'x' }));
  assert.equal(u.available, true); assert.equal(u.latest, '9.9.9'); assert.match(u.zipUrl, /BingeMap-9\.9\.9\.zip$/);
  assert.equal((await checkUpdate(json({ version: '0.0.1' }))).available, false);
  const fail = await checkUpdate(async () => new Response('no', { status: 500 }));
  assert.ok(fail.error);
  assert.equal(await shouldNotify('9.9.9'), true);
  assert.equal(await shouldNotify('9.9.9'), false);
  assert.equal(await shouldNotify('9.9.10'), true);
  // Dalla 1.3.3 links.json è nel formato comune (schemaVersion 1, voci in «links»): vedi anche v133.test.js.
  const lj = (revision, discord) => json({ schemaVersion: 1, project: 'bingemap', revision, links: { discord: { url: discord, enabled: true, label: 'Discord' } } });
  await kv.set('linksCheckedAt', 0);
  await refreshLinks(true, lj(10, 'https://discord.gg/NUOVO'));
  assert.equal((await getLinks()).discord.url, 'https://discord.gg/NUOVO');
  await kv.set('linksCheckedAt', 0);
  await refreshLinks(true, lj(0, 'https://discord.gg/VECCHIO'));
  assert.equal((await getLinks()).discord.url, 'https://discord.gg/NUOVO', 'una revisione più vecchia non sovrascrive');
  assert.equal(needsReload('1.0.0', '1.1.0'), true);
  assert.equal(needsReload('1.1.0', '1.1.0'), false);
  assert.equal(needsReload('1.1.0', null), false);
});

// ---------- Test 6: prestazioni
function bigData(nCat = 3000, nItems = 2000) {
  const G = ['Dramma', 'Commedia', 'Crime', 'Fantascienza', 'Animazione', 'Mistero', 'Documentario', 'Azione'];
  const catalog = Array.from({ length: nCat }, (_, i) => cat(i + 1, `Serie numero ${i + 1}`, { year: 1990 + (i % 35), genres: [G[i % 8], G[(i * 7) % 8]], score: 5 + (i % 50) / 10, subIta: i % 3 === 0, seasonsCount: 1 + (i % 6) }));
  const items = Array.from({ length: nItems }, (_, i) => ({ key: `csv:${i}`, source: 'csv', title: `Serie numero ${i + 1}`, status: ['completed', 'watching', 'plan', 'hold'][i % 4], tags: i % 5 ? ['Mind-blowing'] : ['Cozy'], lists: ['Lista'], updatedAt: i }));
  const matches = items.map((it, i) => ({ key: `sc|${it.key}`, itemKey: it.key, catalog: 'sc', ck: `sc:${i + 1}`, state: 'auto', confidence: 90, method: 'title_year' }));
  return { catalog, items, matches };
}

test('prestazioni: 3.000 titoli e 2.000 righe, un filtro con 5 condizioni in meno di 100 ms', () => {
  const t0 = performance.now();
  const { views } = buildViews(bigData(), S);
  const build = performance.now() - t0;
  const ast = { all: [{ field: 'status', none: ['completed'] }, { field: 'genre', any: ['drama', 'crime'] }, { field: 'year', range: [2000, 2020] }, { field: 'score', min: 6 }, { field: 'tag', any: ['mind-blowing'] }] };
  runQuery(views, ast); // riscaldamento
  const t1 = performance.now();
  const { results } = runQuery(views, ast);
  const q = performance.now() - t1;
  assert.ok(results.length > 0);
  assert.ok(results.every((v) => v.status !== 'completed' && v.score >= 6));
  assert.ok(q < 100, `filtro in ${q.toFixed(1)} ms`);
  assert.ok(build < 3000, `viste in ${build.toFixed(0)} ms`);
});

test('prestazioni: la mappa di 3.000 serie si calcola in pochi secondi', () => {
  const { views } = buildViews(bigData(3000, 500), S);
  const t0 = performance.now();
  const m = buildMap(views);
  const ms = performance.now() - t0;
  assert.equal(m.nodes.length, 3000);
  assert.ok(m.nodes.every((n) => n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1));
  assert.ok(m.clusters.length >= 3 && m.clusters.every((c) => c.label));
  assert.ok(ms < 8000, `mappa in ${ms.toFixed(0)} ms`);
});

// ---------- Test 7: codifiche dei file
test('codifiche: Windows-1252 con «;» e virgola decimale, UTF-16 con e senza BOM, UTF-8 con BOM', () => {
  const text = 'Titolo;Stato;Voto\nLa casa di carta;Completata;8,5\nCità;In corso;7\n';
  const cp1252 = Uint8Array.from([...text].map((ch) => ({ à: 0xe0 })[ch] ?? ch.charCodeAt(0)));
  const utf16 = (bom) => { const b = []; if (bom) b.push(0xff, 0xfe); for (const ch of text) { const c = ch.charCodeAt(0); b.push(c & 255, c >> 8); } return Uint8Array.from(b); };
  const utf8bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
  for (const bytes of [cp1252, utf16(true), utf16(false), utf8bom]) {
    const decoded = decodeBytes(bytes);
    assert.equal(decoded, text);
    const { headers, records } = parseCsv(decoded);
    assert.deepEqual(headers, ['Titolo', 'Stato', 'Voto']);
    const map = suggestMapping(headers);
    const rows = rowsFromRecords(records, map, 'csv');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].rating, 8.5);
    assert.equal(rows[1].title, 'Cità');
    assert.equal(rows[0].status, 'completed');
  }
});

// ---------- Test 8: filtri casuali contro un valutatore di riferimento
function rng(seed) { let a = seed; return () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; }; }
const POOL = { status: ['completed', 'watching', 'plan', 'none', 'hold'], genre: ['drama', 'crime', 'sci-fi', 'comedy'], tag: ['mind-blowing', 'cozy', 'x'] };
function naiveCond(c, v) {
  if (c.field === 'year') { const y = v.year; if (y == null) return null; return y >= c.range[0] && y <= c.range[1]; }
  if (c.field === 'score') { const s = v.score; if (s == null) return null; return s >= c.min; }
  const val = c.field === 'status' ? [v.status] : c.field === 'genre' ? v.genres : v.tags;
  if (c.any) return c.any.some((x) => val.includes(x));
  if (c.all) return c.all.every((x) => val.includes(x));
  if (c.none) return !c.none.some((x) => val.includes(x));
  return true;
}
function naive(node, v) {
  if (node.field) { const r = naiveCond(node, v); return r === null ? false : r; }
  if (node.all) return node.all.every((n) => naive(n, v));
  if (node.any) return node.any.length === 0 ? true : node.any.some((n) => naive(n, v));
  if (node.not) return !naive(node.not, v);
  return true;
}
function randCond(r) {
  const f = ['status', 'genre', 'tag', 'year', 'score'][Math.floor(r() * 5)];
  if (f === 'year') { const a = 1995 + Math.floor(r() * 25); return { field: 'year', range: [a, a + Math.floor(r() * 10)] }; }
  if (f === 'score') return { field: 'score', min: 5 + Math.floor(r() * 4) };
  const vals = POOL[f].filter(() => r() < 0.5); if (!vals.length) vals.push(POOL[f][0]);
  const op = f === 'status' ? (r() < 0.5 ? 'any' : 'none') : ['any', 'all', 'none'][Math.floor(r() * 3)];
  return { field: f, [op]: vals };
}
function randNode(r, depth) {
  if (depth <= 0 || r() < 0.35) return randCond(r);
  const k = r();
  const kids = Array.from({ length: 1 + Math.floor(r() * 3) }, () => randNode(r, depth - 1));
  if (k < 0.45) return { all: kids };
  if (k < 0.85) return { any: kids };
  return { not: kids[0] };
}

test('filtri casuali: 2.000 combinazioni E/O/NON danno lo stesso risultato del valutatore di riferimento', () => {
  const r = rng(42);
  const views = Array.from({ length: 120 }, (_, i) => ({
    ck: `sc:${i}`, status: POOL.status[i % 5], genres: POOL.genre.filter((_, j) => (i >> j) & 1), tags: POOL.tag.filter((_, j) => (i >> (j + 2)) & 1),
    year: i % 11 === 0 ? null : 1995 + (i % 30), score: i % 13 === 0 ? null : 5 + (i % 40) / 10,
  }));
  const asView = views.map((v) => ({ ...v, impTags: {}, userTags: [], cks: [v.ck], sources: [], lists: [], name: v.ck, norm: v.ck, alt: [] }));
  for (let n = 0; n < 2000; n++) {
    const ast = randNode(r, 3);
    for (const v of asView) {
      const a = evalNode(ast, v, { now: Date.now() });
      const b = naive(ast, v);
      if (a !== b) assert.fail(`differenza su ${v.ck} con ${JSON.stringify(ast)}: motore=${a} riferimento=${b}`);
    }
  }
  assert.ok(FIELDS.status && FIELDS.genre && FIELDS.tag);
});

// ---------- Test 10: ora legale
test('ora legale: «negli ultimi 7 giorni» e date del calendario giusti a cavallo del cambio dell\'ora', () => {
  const prev = process.env.TZ;
  process.env.TZ = 'Europe/Rome';
  try {
    const added = new Date(2026, 9, 18, 0, 30).getTime(); // 18 ottobre, prima del cambio del 25
    const now = new Date(2026, 9, 25, 0, 10).getTime(); // 25 ottobre, dopo il cambio: 7 giorni e 23 ore e 40 minuti dopo... di calendario 7
    assert.equal(calendarDays(added, now), 7);
    const v = { firstSeen: added };
    assert.equal(evalNode({ field: 'firstSeen', withinDays: 7 }, v, { now }), true);
    const marchA = new Date(2026, 2, 28, 23, 30).getTime(); const marchB = new Date(2026, 2, 29, 23, 30).getTime(); // cambio del 29 marzo
    assert.equal(calendarDays(marchA, marchB), 1);
    const p = planMarathon([{ ck: 'a', name: 'A', leftMin: 60 * 3 }], { hoursPerWeek: 7, start: new Date(2026, 9, 24, 20).getTime() });
    assert.equal(new Date(p.items[0].endAt).getDate(), 26, 'tre ore a un\'ora al giorno: 24, 25, 26 ottobre');
  } finally { process.env.TZ = prev; }
});

// ---------- Test 11: alfabeti diversi e ordinamento italiano
test('titoli coreani, giapponesi, cirillici e accentati: normalizzazione, abbinamento, ordinamento', () => {
  assert.equal(normTitle('오징어 게임'), '오징어 게임');
  assert.equal(normTitle('進撃の巨人'), '進撃の巨人');
  assert.equal(normTitle('Слово пацана'), 'слово пацана');
  assert.equal(normTitle('Él, Ça & Così'), normTitle('el ca and cosi'));
  const index = buildIndex([cat(1, 'Squid Game', { originalName: '오징어 게임', year: 2021 }), cat(2, '進撃の巨人', { year: 2013 })]);
  assert.equal(matchItem({ key: 'k1', title: '오징어 게임', year: 2021, mediaType: 'tv', ids: {} }, index).ck, 'sc:1');
  assert.equal(matchItem({ key: 'k2', title: '進撃の巨人', year: 2013, mediaType: 'tv', ids: {} }, index).ck, 'sc:2');
  const names = ['Zorro', 'Èlite', 'Arcane', 'élite minore', 'Ozark', 'Àlbum'];
  assert.deepEqual([...names].sort(collator.compare), ['Àlbum', 'Arcane', 'Èlite', 'élite minore', 'Ozark', 'Zorro']);
});

// ---------- Test 12: due dispositivi e Google Drive
function fakeDrive() {
  const d = { file: null, id: 'f1', calls: 0 };
  d.fetch = async (url, opts = {}) => {
    d.calls++;
    const u = String(url);
    if (u.includes('/files?spaces=appDataFolder')) return new Response(JSON.stringify({ files: d.file ? [{ id: d.id }] : [] }), { status: 200 });
    if (u.includes(`/files/${d.id}?alt=media`)) return new Response(JSON.stringify(d.file), { status: 200 });
    if (u.includes('uploadType=multipart')) { const body = String(opts.body); const part = body.split('\r\n\r\n')[2].split('\r\n--')[0]; d.file = JSON.parse(part); return new Response(JSON.stringify({ id: d.id }), { status: 200 }); }
    if (u.includes(`/files/${d.id}?uploadType=media`)) { d.file = JSON.parse(opts.body); return new Response('{}', { status: 200 }); }
    return new Response('no', { status: 404 });
  };
  return d;
}

test('sincronizzazione: due dispositivi convergono, le cancellazioni viaggiano, le modifiche offline si risolvono', async () => {
  const drive = fakeDrive();
  globalThis.fetch = drive.fetch;
  await sessionKv.set('gtoken', { token: 'tok', exp: Date.now() + 3600000 });
  const A = `devA${Date.now()}`; const B = `devB${Date.now()}`;
  setProfile(A);
  await setOverlay('sc:1', { status: 'completed', rating: 9 });
  const q = await saveQuery({ name: 'Coreane', query: { all: [{ field: 'country', any: ['KR'] }] } });
  await syncNow();
  setProfile(B);
  await syncNow();
  assert.equal((await get('overlay', 'sc:1')).rating, 9);
  assert.equal((await listQueries()).length, 1);
  // B cancella la ricerca: la cancellazione arriva anche ad A.
  await deleteQuery(q.id);
  await syncNow();
  setProfile(A);
  await syncNow();
  assert.equal((await listQueries()).length, 0);
  // Modifiche fatte senza rete su entrambi: vince la più recente.
  await setOverlay('sc:2', { status: 'plan' });
  await new Promise((r) => setTimeout(r, 5));
  setProfile(B);
  await setOverlay('sc:2', { status: 'watching' });
  setProfile(A); await syncNow();
  setProfile(B); await syncNow();
  setProfile(A); await syncNow();
  assert.equal((await get('overlay', 'sc:2')).status, 'watching');
  setProfile(B);
  assert.equal((await get('overlay', 'sc:2')).status, 'watching');
  // Sessione Google scaduta: errore chiaro e token tolto.
  globalThis.fetch = async () => new Response('', { status: 401 });
  await assert.rejects(() => syncNow(), /scaduta/);
  assert.equal(await sessionKv.get('gtoken'), null);
});

// ---------- Test 13: accessi SIMKL e Google simulati
test('SIMKL PKCE: challenge = SHA-256 del verifier, state controllato, accesso annullato', async () => {
  freshDb();
  let authUrl = null; let tokenBody = null;
  globalThis.fetch = async (url, opts) => { tokenBody = JSON.parse(opts.body); return new Response(JSON.stringify({ access_token: 'simkl-tok' }), { status: 200 }); };
  setAuthFlowForTests(async (url) => { authUrl = new URL(url); return `https://redirect.test/simkl?code=ABC&state=${authUrl.searchParams.get('state')}`; });
  assert.equal(await connectSimkl('cid'), true);
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  const expected = createHash('sha256').update(tokenBody.code_verifier).digest('base64url');
  assert.equal(authUrl.searchParams.get('code_challenge'), expected);
  assert.equal(tokenBody.code, 'ABC'); assert.equal(tokenBody.grant_type, 'authorization_code');
  assert.equal(await kv.get('simklToken'), 'simkl-tok');
  setAuthFlowForTests(async () => 'https://redirect.test/simkl?code=ABC&state=ALTRO');
  await assert.rejects(() => connectSimkl('cid'), /non valida/);
  setAuthFlowForTests(async (url) => `https://redirect.test/simkl?error=access_denied&state=${new URL(url).searchParams.get('state')}`);
  await assert.rejects(() => connectSimkl('cid'), /annullato/);
  await assert.rejects(() => connectSimkl(''), /client_id/);
  // Google: token dal frammento, errore e annullamento.
  await sessionKv.set('gtoken', null);
  setAuthFlowForTests(async () => 'https://redirect.test/google#access_token=G-TOK&expires_in=3600');
  assert.equal(await getToken(true, 'cid.apps.googleusercontent.com'), 'G-TOK');
  await sessionKv.set('gtoken', null);
  setAuthFlowForTests(async () => 'https://redirect.test/google#error=access_denied');
  await assert.rejects(() => getToken(true, 'cid'), /access_denied/);
  setAuthFlowForTests(async () => { throw new Error('Accesso annullato'); });
  await assert.rejects(() => getToken(true, 'cid'), /annullato/);
  setAuthFlowForTests(null);
});

// ---------- Funzioni nuove
test('progresso per episodio: posizione, percentuale, prossimo episodio e minuti che mancano', () => {
  const seasons = [{ n: 1, episodes: 10 }, { n: 2, episodes: 8 }];
  assert.equal(episodesUpTo(seasons, 2, 4), 14);
  assert.deepEqual(nextEpisode(seasons, 1, 10), { s: 2, e: 1 });
  assert.equal(nextEpisode(seasons, 2, 8), null);
  const p = computeProgress({ status: 'watching', seasons, epRuntime: 50, override: { s: 2, e: 4 } });
  assert.equal(p.seen, 14); assert.equal(p.total, 18); assert.equal(p.pct, 78); assert.equal(p.leftMin, 200); assert.deepEqual(p.next, { s: 2, e: 5 });
  const imp = computeProgress({ status: 'watching', seasons, importedEpisodes: 12 });
  assert.deepEqual(imp.pos, { s: 2, e: 2 }); assert.equal(imp.from, 'import');
  assert.equal(computeProgress({ status: 'completed', seasons }).pct, 100);
  assert.equal(computeProgress({ status: 'plan', seasons }), null);
});

test('calendario e .ics: solo le serie che segui, date di un giorno intero, righe lunghe spezzate', () => {
  const now = new Date(2026, 10, 19, 12).getTime();
  const views = [
    { ck: 'sc:1', name: 'Severance', status: 'watching', nextAir: { date: '2026-11-21', s: 2, e: 3, name: 'Un episodio dal titolo molto lungo, con virgole; e punti e virgola, per provare la piegatura delle righe' }, seasonEpisodes: [] },
    { ck: 'sc:2', name: 'Altra', status: 'none', nextAir: { date: '2026-11-22', s: 1, e: 2 }, seasonEpisodes: [] },
    { ck: 'sc:3', name: 'Silo', status: 'completed', newSeason: true, seasonEpisodes: [{ n: 3, episodes: 10, date: '2026-12-05' }] },
  ];
  const items = calendarItems(views, { now });
  assert.deepEqual(items.map((x) => x.ck), ['sc:1', 'sc:3']);
  assert.equal(items[1].kind, 'premiere'); assert.equal(items[0].inDays, 2);
  assert.equal(calendarItems(views, { now, onlyMine: false }).length, 3);
  const ics = toIcs(items, { now: new Date(now) });
  assert.match(ics, /BEGIN:VCALENDAR\r\n/); assert.match(ics, /DTSTART;VALUE=DATE:20261121\r\nDTEND;VALUE=DATE:20261122/);
  assert.match(ics, /SUMMARY:Severance S02E03/); assert.match(ics, /virgole\\; e/);
  assert.ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
});

test('rinnovi e cancellazioni: avvisi solo per le serie che ti interessano e dopo l\'ultimo controllo', () => {
  const tm = (from, to, date) => ({ tmdbId: 1, statusHistory: [{ status: from, date: date - 10 * DAY }, { status: to, date }] });
  const now = Date.now();
  const data = { catalog: [cat(1, 'Segui', { tmdbId: 1 }), cat(2, 'Ignota', { tmdbId: 2 })], items: [{ key: 'csv:1', source: 'csv', title: 'Segui', status: 'watching', tags: [], lists: [] }],
    matches: [{ key: 'sc|csv:1', itemKey: 'csv:1', catalog: 'sc', ck: 'sc:1', state: 'auto', confidence: 100 }],
    tmdbCache: [tm('Returning Series', 'Canceled', now - DAY), { ...tm('Returning Series', 'Ended', now - DAY), tmdbId: 2 }] };
  const { views } = buildViews(data, S);
  const al = renewalAlerts(views);
  assert.equal(al.length, 1); assert.equal(al[0].to, 'Canceled'); assert.match(al[0].text, /Cancellata/);
  assert.equal(renewalAlerts(views, { since: now }).length, 0);
  assert.ok(runQuery(views, { all: [{ field: 'statusChanged', eq: true }] }).results.length === 2);
});

test('pianificatore: ore a settimana, giorni scelti, una serie dopo l\'altra', () => {
  const start = new Date(2026, 10, 16, 18).getTime(); // lunedì
  const p = planMarathon([{ ck: 'a', name: 'A', leftMin: 120 }, { ck: 'b', name: 'B', leftMin: 240 }, { ck: 'c', name: 'C', leftMin: null }], { hoursPerWeek: 4, start, weekdays: [6, 0] });
  assert.equal(p.perDay, 120);
  assert.equal(new Date(p.items[0].startAt).getDay(), 6); // sabato
  assert.equal(new Date(p.items[0].endAt).getDate(), 21);
  assert.equal(new Date(p.items[1].endAt).getDate(), 28, 'B: domenica 22 e sabato 28');
  assert.deepEqual(p.unknown, ['c']);
});

test('«Ho 40 minuti»: prima il prossimo episodio delle serie in corso, poi serie con episodi brevi nei generi preferiti', () => {
  const views = [
    { ck: 'a', name: 'Lunga', status: 'plan', epRuntime: 60, genres: ['drama'], score: 9 },
    { ck: 'b', name: 'In corso', status: 'watching', epRuntime: 30, genres: ['comedy'], progress: { next: { s: 1, e: 4 }, leftEp: 6 } },
    { ck: 'c', name: 'Breve', status: 'none', epRuntime: 20, genres: ['comedy'], score: 7, hours: 3 },
    { ck: 'd', name: 'Vista', status: 'completed', epRuntime: 20, genres: ['comedy'], rating: 9 },
    { ck: 'e', name: 'Corta crime', status: 'none', epRuntime: 25, genres: ['crime'], score: 7.2 },
  ];
  const r = tonight(views, 40);
  assert.deepEqual(r.map((x) => x.v.ck), ['b', 'c', 'e']);
  assert.match(r[0].reason, /S1E4/); assert.equal(r[0].episodes, 1);
});

test('mappa: serie simili vicine, zone con nome e quota esplorata', () => {
  const mk = (i, genres, keywords, status = 'none') => ({ ck: `sc:${i}`, name: `S${i}`, genres, keywords, cast: [], creators: [], country: [], status, score: 8 });
  const views = [
    ...Array.from({ length: 30 }, (_, i) => mk(i, ['sci-fi'], ['time travel', 'dystopia'], i < 20 ? 'completed' : 'none')),
    ...Array.from({ length: 30 }, (_, i) => mk(100 + i, ['comedy'], ['sitcom', 'workplace'], 'none')),
  ];
  const m = buildMap(views, { k: 6 });
  const pos = new Map(m.nodes.map((n) => [n.ck, n]));
  const d = (a, b) => Math.hypot(pos.get(a).x - pos.get(b).x, pos.get(a).y - pos.get(b).y);
  assert.ok(d('sc:0', 'sc:1') < d('sc:0', 'sc:100'), 'due fantascienza più vicine di fantascienza e commedia');
  const comedy = m.clusters.find((c) => /sitcom|workplace|Commedia/i.test(c.label));
  assert.ok(comedy, JSON.stringify(m.clusters.map((c) => c.label)));
  assert.equal(comedy.explored, 0); assert.equal(comedy.unexplored, true);
});

test('Wrapped: completate, ore, generi e top dell\'anno dal diario', () => {
  const views = [{ ck: 'a', name: 'Dark', genres: ['sci-fi'], hours: 20, episodes: 26, rating: 10 }, { ck: 'b', name: 'Ozark', genres: ['crime', 'drama'], hours: 30, episodes: 44, rating: 8 }, { ck: 'c', name: 'Vecchia', genres: ['drama'], hours: 5 }];
  const diary = [{ ck: 'a', event: 'completed', date: new Date(2026, 2, 3).getTime() }, { ck: 'b', event: 'completed', date: new Date(2026, 2, 20).getTime() }, { ck: 'b', event: 'started', date: new Date(2026, 1, 1).getTime() }, { ck: 'c', event: 'completed', date: new Date(2025, 5, 1).getTime() }];
  const w = computeWrapped(views, diary, 2026);
  assert.equal(w.completed, 2); assert.equal(w.started, 1); assert.equal(w.hours, 50); assert.equal(w.episodes, 70);
  assert.equal(w.best.name, 'Dark'); assert.equal(w.busiestMonth, 2); assert.equal(w.longest.name, 'Ozark');
});

test('Netflix: stagioni in più lingue, miniserie, film ignorati, profili, ultima visione', () => {
  assert.deepEqual(splitNetflixTitle('Stranger Things: Stagione 4: Capitolo uno: Il club Hellfire'), { show: 'Stranger Things', season: 4, episode: 'Capitolo uno: Il club Hellfire', marker: true });
  assert.equal(splitNetflixTitle('La casa di carta: Parte 3: Episodio 1').season, 3);
  assert.equal(splitNetflixTitle('Wednesday: Season 1: Wednesday\'s Child Is Full of Woe').show, 'Wednesday');
  assert.equal(splitNetflixTitle('Baby Reindeer: Serie limitata: Episodio 1').season, 1);
  const now = new Date(2026, 10, 19).getTime();
  const hist = 'Title,Date\n"Dark: Stagione 1: Segreti","3/11/26"\n"Dark: Stagione 2: Inizi e fini","15/11/26"\n"Glass Onion: Knives Out","1/2/25"\n"Arcane: Benvenuti al parco giochi","4/2/25"\n"Arcane: Alcune cose mistiche","5/2/25"\n';
  assert.ok(isNetflixCsv(['Title', 'Date']));
  const r = parseNetflix(hist, { now });
  const dark = r.rows.find((x) => x.title === 'Dark');
  assert.equal(dark.status, 'watching'); assert.equal(dark.episodesWatched, 2); assert.equal(dark.seasonsWatched, 2);
  assert.equal(new Date(dark.lastActivity).getDate(), 15, 'date in formato italiano giorno/mese');
  assert.equal(r.rows.find((x) => x.title === 'Arcane').status, 'hold');
  assert.equal(r.skippedMovies, 1);
  const full = 'Profile Name,Start Time,Duration,Attributes,Title,Supplemental Video Type,Device Type,Bookmark,Latest Bookmark,Country\n' +
    'Andrea,2026-11-10 21:00:00,00:45:00,,"Dark: Season 1: Secrets",,TV,00:45:00,00:45:00,IT (Italy)\n' +
    'Andrea,2026-11-10 20:58:00,00:01:30,,"Dark: Season 1: Secrets",TRAILER,TV,,,IT (Italy)\n' +
    'Sara,2026-11-11 21:00:00,00:40:00,,"Bridgerton: Season 1: Diamond of the First Water",,TV,,,IT (Italy)\n';
  const all = parseNetflix(full, { now });
  assert.deepEqual(all.profiles.sort(), ['Andrea', 'Sara']);
  const mine = parseNetflix(full, { now, profile: 'Andrea' });
  assert.deepEqual(mine.rows.map((x) => x.title), ['Dark']);
  assert.equal(mine.rows[0].episodesWatched, 1, 'il trailer non conta');
});

test('«Incolla una lista»: numerazioni, anni, piattaforme e descrizioni tolti, frasi dell\'articolo ignorate', () => {
  const text = `Le 5 serie da non perdere quest'anno secondo la redazione, scelte con cura.
1. Dark (2017)
2) Severance – un thriller aziendale che fa venire i brividi
#3 Silo su Apple TV+
• «Shōgun»
Leggi anche: le migliori serie del 2025
10 - The Bear: la cucina più stressante della televisione moderna, una serie da vedere
Dark (2017)`;
  const t = extractTitles(text);
  assert.deepEqual(t.map((x) => x.title), ['Dark', 'Severance', 'Silo', 'Shōgun', 'The Bear']);
  assert.equal(t[0].year, 2017);
});

test('annulla globale: ripristina lo stato precedente, anche quando il record non esisteva', async () => {
  freshDb(); clearUndo();
  await setOverlay('sc:1', { status: 'plan' });
  await setOverlay('sc:1', { status: 'completed' });
  assert.equal((await get('overlay', 'sc:1')).status, 'completed');
  await undo();
  assert.equal((await get('overlay', 'sc:1')).status, 'plan');
  await undo();
  assert.equal(await get('overlay', 'sc:1'), undefined);
  assert.equal(canUndo(), false);
  assert.equal(await undo(), null);
});

test('ricerca dal tasto destro e dalla barra: titolo esatto prima, poi quelli che lo contengono', () => {
  const views = [{ ck: 'a', name: 'Dark Matter', norm: normTitle('Dark Matter'), alt: [], score: 9 }, { ck: 'b', name: 'Dark', norm: normTitle('Dark'), alt: [], score: 8 }, { ck: 'c', name: 'Altro', norm: 'altro', alt: ['Dark Secrets'], score: 5 }];
  assert.deepEqual(findByText(views, 'dark').map((v) => v.ck), ['b', 'a', 'c']);
  assert.deepEqual(findByText(views, '  '), []);
});

test('TMDB: prossimo episodio, stagioni, parole chiave e dove guardarla in Italia', () => {
  const d = { id: 1, name: 'X', status: 'Returning Series', in_production: true, next_episode_to_air: { air_date: '2026-12-01', season_number: 2, episode_number: 5, name: 'Ep', runtime: 48 },
    seasons: [{ season_number: 0, episode_count: 3 }, { season_number: 1, episode_count: 9, air_date: '2025-01-01' }], keywords: { results: [{ name: 'heist' }] },
    'watch/providers': { results: { IT: { link: 'https://www.themoviedb.org/tv/1/watch', flatrate: [{ provider_id: 8, provider_name: 'Netflix', display_priority: 1, logo_path: '/n.jpg' }], rent: [{ provider_id: 2, provider_name: 'Apple TV' }] } } } };
  const t = mapTv(d);
  assert.deepEqual(t.nextEp, { date: '2026-12-01', s: 2, e: 5, name: 'Ep', runtime: 48 });
  assert.deepEqual(t.seasonEpisodes.map((x) => x.n), [1]); assert.deepEqual(t.keywords, ['heist']);
  assert.equal(t.watch.flatrate[0].name, 'Netflix'); assert.equal(t.watch.rent[0].name, 'Apple TV');
  assert.equal(watchOf(d['watch/providers'], 'FR'), null);
  assert.ok(sameProvider('Disney Plus', 'Disney+')); assert.ok(sameProvider('Amazon Prime Video', 'Prime Video')); assert.ok(!sameProvider('Netflix', 'NOW'));
});
