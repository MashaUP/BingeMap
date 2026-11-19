import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, cat } from './_setup.js';
import { buildViews } from '../../src/library/view.js';
import { DEFAULTS } from '../../src/common/settings.js';
import { recommend, surprise } from '../../src/recommend/recommend.js';
import { putMany, getAll, put } from '../../src/db/db.js';
import { commitImport } from '../../src/import/pipeline.js';
import { parseManual, rowsFromRecords } from '../../src/import/sources.js';
import { exportAll, validateBackup, restore, exportCatalogPackage, importCatalogPackage } from '../../src/backup/backup.js';
import { mergeStores } from '../../src/sync/drive.js';
import { setOverlay, followUpdates, saveQuery } from '../../src/library/data.js';
import { runQuery } from '../../src/query/engine.js';

const S = { ...DEFAULTS };

test('viste: stato dalle liste, conflitti, corrispondenze da confermare, mancanti', () => {
  const data = {
    catalog: [cat(1, 'Dark', { genres: ['Fantascienza'] }), cat(2, 'Silo'), cat(3, 'Shōgun', { year: 2024 }), cat(4, 'Shōgun', { year: 1980 })],
    items: [
      { key: 'simkl:a', source: 'simkl', title: 'Dark', status: 'completed', updatedAt: 1, tags: [], lists: [] },
      { key: 'refract:a', source: 'refract', title: 'Dark', status: 'hold', updatedAt: 2, tags: ['Mind-blowing'], lists: ['Top'] },
      { key: 'csv:x', source: 'csv', title: 'Introvabile', status: 'plan', tags: ['Must Watch'], lists: [] },
      { key: 'csv:y', source: 'csv', title: 'Shogun', status: 'completed', tags: [], lists: [] },
    ],
    matches: [
      { key: 'sc|simkl:a', itemKey: 'simkl:a', catalog: 'sc', ck: 'sc:1', state: 'auto', confidence: 100, method: 'tmdb' },
      { key: 'sc|refract:a', itemKey: 'refract:a', catalog: 'sc', ck: 'sc:1', state: 'auto', confidence: 90, method: 'title_year' },
      { key: 'sc|csv:x', itemKey: 'csv:x', catalog: 'sc', ck: null, state: 'none', confidence: 0 },
      { key: 'sc|csv:y', itemKey: 'csv:y', catalog: 'sc', ck: 'sc:3', state: 'queue', confidence: 65, candidates: [{ ck: 'sc:3' }, { ck: 'sc:4' }] },
    ],
  };
  const { views, missing } = buildViews(data, S);
  const dark = views.find((v) => v.ck === 'sc:1');
  assert.equal(dark.status, 'hold'); assert.equal(dark.conflict, true);
  assert.deepEqual(dark.genres, ['sci-fi']); assert.deepEqual(dark.impTags.refract, ['Mind-blowing']);
  assert.ok(dark.tags.includes('mind-blowing') && dark.tags.includes('refract:mind-blowing'));
  assert.equal(views.find((v) => v.ck === 'sc:3').status, 'unknown');
  assert.equal(views.find((v) => v.ck === 'sc:2').status, 'none');
  assert.deepEqual(missing.map((m) => m.title), ['Introvabile']);
  // Lo stato personale vince.
  const v2 = buildViews({ ...data, overlay: [{ ck: 'sc:1', status: 'completed' }] }, S).views.find((v) => v.ck === 'sc:1');
  assert.equal(v2.status, 'completed'); assert.equal(v2.statusFrom, 'manual');
});

test('consigli spiegati e Sorprendimi', () => {
  const mk = (ck, name, genres, o = {}) => ({ ck, cks: [ck], name, norm: name.toLowerCase(), genres, tags: [], impTags: {}, userTags: [], recs: [], tmdbRecs: [], score: 7, status: 'none', skipCount: 0, rating: null, siteId: ck, ...o });
  const all = [
    mk('a', 'Dark', ['sci-fi'], { status: 'completed', rating: 10, recs: ['c'] }),
    mk('b', 'Westworld', ['sci-fi'], { status: 'completed', rating: 9 }),
    mk('c', 'Silo', ['sci-fi'], { siteId: 'c' }),
    mk('d', 'Commedia X', ['comedy']),
  ];
  const { items } = recommend(all.slice(2), all, S.weights);
  assert.equal(items[0].ck, 'c');
  assert.ok(items[0]._why.some((w) => /Dark/.test(w)));
  assert.ok(surprise(items, 42));
});

test('backup, ripristino e pacchetto catalogo', async () => {
  freshDb();
  await putMany('catalog_titles', [cat(1, 'Dark', { tmdbId: 1 }), cat(2, 'Silo')]);
  await commitImport({ source: 'manual', scope: 'm', rows: parseManual('Dark (2015)', 'completed').rows });
  await setOverlay('sc:2', { status: 'plan', tags: ['Weekend'] });
  const b = await exportAll({ includeCatalog: false });
  assert.equal(b.stores.catalog_titles, undefined);
  assert.equal(validateBackup(b).counts.library_items, 1);
  const pkg = await exportCatalogPackage('sc');
  assert.equal(pkg.count, 2); assert.equal(pkg.titles[0].missCount, undefined);
  freshDb();
  await importCatalogPackage(pkg);
  await restore(b, 'replace');
  assert.equal((await getAll('library_items')).length, 1);
  assert.equal((await getAll('catalog_titles')).length, 2);
  const m = await getAll('matches');
  assert.equal(m.filter((x) => x.state === 'auto').length, 1);
});

test('sincronizzazione: vince il più recente, le tombstones cancellano', () => {
  const local = { overlay: [{ ck: 'a', status: 'plan', updatedAt: 1 }, { ck: 'b', status: 'plan', updatedAt: 5 }], saved_queries: [{ id: 'q1', updatedAt: 1 }] };
  const remote = { overlay: [{ ck: 'a', status: 'completed', updatedAt: 3 }, { ck: 'c', status: 'hold', updatedAt: 2 }], saved_queries: [] };
  const r = mergeStores(local, remote, [], [{ store: 'saved_queries', key: 'q1', at: 4 }]);
  const ov = new Map(r.stores.overlay.map((x) => [x.ck, x.status]));
  assert.equal(ov.get('a'), 'completed'); assert.equal(ov.get('b'), 'plan'); assert.equal(ov.get('c'), 'hold');
  assert.equal(r.stores.saved_queries.length, 0);
  assert.equal(r.changedLocal, 2);
});

test('collezioni seguite: novità dopo un cambiamento', async () => {
  freshDb();
  const q = await saveQuery({ name: 'Sci-Fi', query: { all: [{ field: 'genre', any: ['sci-fi'] }] } });
  const v = (ck) => ({ ck, name: ck, norm: ck, alt: [], genres: ['sci-fi'], tags: [], impTags: {}, userTags: [], status: 'none' });
  let ups = followUpdates([q], [v('a')]);
  assert.equal(ups[0].init, true);
  ups = followUpdates([{ ...q, seenIds: ['a'] }], [v('a'), v('b')]);
  assert.deepEqual(ups[0].newIds, ['b']);
  assert.equal(runQuery([v('a')], q.query).results.length, 1);
  void put; void rowsFromRecords;
});
