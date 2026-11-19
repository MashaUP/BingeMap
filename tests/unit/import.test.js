import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, cat } from './_setup.js';
import { parseCsv, toCsv } from '../../src/import/csv.js';
import { readZip, writeZip } from '../../src/import/zip.js';
import { parseXlsx } from '../../src/import/xlsx.js';
import { parseImdb, rowsFromRecords, suggestMapping, parseFiles, parseManual, fromSimkl } from '../../src/import/sources.js';
import { previewImport, commitImport, undoImport } from '../../src/import/pipeline.js';
import { putMany, getAll } from '../../src/db/db.js';

test('CSV: separatori, virgolette, BOM, commenti', () => {
  const { headers, records } = parseCsv('﻿title;year;tags\n"Dark, la serie";2017;"a, b"\n# commento\nSilo;2023;');
  assert.deepEqual(headers, ['title', 'year', 'tags']);
  assert.equal(records.length, 2);
  assert.equal(records[0].title, 'Dark, la serie');
  assert.match(toCsv([{ a: 'x,y' }], ['a']), /"x,y"/);
});

test('ZIP: scrittura e lettura', async () => {
  const blob = writeZip([{ name: 'a/b.json', data: '{"ok":1}' }, { name: 'c.txt', data: 'ciao' }]);
  const files = await readZip(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(files.map((f) => f.name), ['a/b.json', 'c.txt']);
  assert.equal(await files[1].text(), 'ciao');
});

test('Excel: primo foglio con stringhe condivise', async () => {
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>2019</v></c></row></sheetData></worksheet>';
  const shared = '<sst><si><t>Titolo</t></si><si><t>Anno</t></si><si><t>Chernobyl &amp; altro</t></si></sst>';
  const blob = writeZip([{ name: 'xl/worksheets/sheet1.xml', data: sheet }, { name: 'xl/sharedStrings.xml', data: shared }]);
  const { headers, records } = await parseXlsx(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(headers, ['Titolo', 'Anno']);
  assert.equal(records[0].Titolo, 'Chernobyl & altro');
  assert.equal(records[0].Anno, '2019');
});

test('IMDb: watchlist e voti, film esclusi', () => {
  const wl = parseImdb('Position,Const,Created,Modified,Description,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres\n1,tt5753856,2024-01-01,,,Dark,Dark,,TV Series,8.7,60,2017,Drama\n2,tt0111161,2024-01-01,,,Le ali della libertà,,,Movie,9.3,142,1994,Drama', 'watchlist.csv');
  assert.equal(wl.kind, 'watchlist'); assert.equal(wl.rows.length, 1); assert.equal(wl.skippedMovies, 1);
  assert.equal(wl.rows[0].status, 'plan'); assert.equal(wl.rows[0].ids.imdb, 'tt5753856'); assert.equal(wl.rows[0].rowKey, 'imdb:tt5753856');
  const rt = parseImdb('Const,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Year\ntt5753856,9,2024-02-02,Dark,,TV Series,8.7,2017', 'ratings.csv');
  assert.equal(rt.kind, 'ratings'); assert.equal(rt.rows[0].rating, 9); assert.equal(rt.rows[0].status, 'unknown');
});

test('CSV generico: mappatura suggerita, tag e scala dei voti', () => {
  const { headers, records } = parseCsv('Nome,Anno,Stato,Voto,Etichette,Tipo\nDark,2017,Completed,4.5,"Mind-blowing, Dark",TV\nUp,2009,Completed,4,,Movie');
  const m = suggestMapping(headers);
  assert.equal(m.title, 'Nome'); assert.equal(m.tags, 'Etichette');
  const rows = rowsFromRecords(records, m, 'csv');
  const dark = rows.find((r) => r.title === 'Dark');
  assert.equal(dark.status, 'completed'); assert.equal(dark.rating, 9); assert.deepEqual(dark.tags, ['Mind-blowing', 'Dark']);
  assert.equal(rows.find((r) => r.title === 'Up').mediaType, 'movie');
});

test('JSON in stile Trakt e Refract: estrazione e unione delle righe', async () => {
  const files = [
    { name: 'watched/watched-shows.json', text: async () => JSON.stringify([{ plays: 10, last_watched_at: '2025-01-01T00:00:00Z', show: { title: 'Dark', year: 2017, ids: { trakt: 1, tmdb: 70523, imdb: 'tt5753856' } }, seasons: [{ number: 1, episodes: [{ number: 1, plays: 1 }, { number: 2, plays: 1 }] }] }]) },
    { name: 'lists/lists-watchlist.json', text: async () => JSON.stringify([{ type: 'show', show: { title: 'Silo', year: 2023, ids: { tmdb: 125988 } } }, { type: 'movie', movie: { title: 'Dune', year: 2021, ids: { tmdb: 438631 } } }]) },
    { name: 'ratings/ratings-shows.json', text: async () => JSON.stringify([{ rating: 9, type: 'show', show: { title: 'Dark', year: 2017, ids: { tmdb: 70523 } } }]) },
  ];
  const { rows } = await parseFiles(files, 'trakt');
  const dark = rows.find((r) => r.title === 'Dark');
  assert.equal(dark.status, 'watching'); assert.equal(dark.rating, 9); assert.equal(dark.episodesWatched, 2); assert.equal(dark.seasonsWatched, 1);
  assert.equal(rows.find((r) => r.title === 'Silo').status, 'plan');
  assert.ok(!rows.some((r) => r.title === 'Dune'));
  const refract = await parseFiles([{ name: 'library.json', text: async () => JSON.stringify({ items: [{ title: 'Arcane', media_type: 'tv', status: 'Plan to Watch', rating: 8, mood_tags: ['Epic', 'Must Watch'], tmdb_id: 94605 }] }) }], 'refract');
  assert.equal(refract.rows[0].status, 'plan'); assert.deepEqual(refract.rows[0].tags, ['Epic', 'Must Watch']); assert.equal(refract.rows[0].ids.tmdb, 94605);
});

test('lista manuale e SIMKL', () => {
  const m = parseManual('Dark (2017)\nSilo\n\n', 'completed');
  assert.equal(m.rows.length, 2); assert.equal(m.rows[0].year, 2017); assert.equal(m.rows[0].status, 'completed');
  const s = fromSimkl({ shows: [{ status: 'hold', user_rating: 7, watched_episodes_count: 5, show: { title: 'Westworld', year: 2016, ids: { simkl: 1, tmdb: 63247 } } }], anime: [] });
  assert.equal(s.rows[0].status, 'hold'); assert.equal(s.rows[0].rowKey, 'tmdb:63247');
});

test('pipeline: anteprima, commit, reimport senza doppioni, righe tolte, annullamento', async () => {
  freshDb();
  await putMany('catalog_titles', [cat(1, 'Dark', { year: 2017, tmdbId: 70523 }), cat(2, 'Silo', { year: 2023 })]);
  const rows1 = parseManual('Dark (2017)\nSilo (2023)\nSerie inesistente (2020)', 'plan').rows;
  const p1 = await previewImport('manual', 'manual:x', rows1);
  assert.equal(p1.added.length, 3);
  const r1 = await commitImport({ source: 'manual', scope: 'manual:x', rows: rows1 });
  assert.equal(r1.counts.added, 3);
  let matches = await getAll('matches');
  assert.equal(matches.filter((m) => m.state === 'auto').length, 2);
  const rows2 = parseManual('Dark (2017)\nSilo (2023)', 'completed').rows;
  const r2 = await commitImport({ source: 'manual', scope: 'manual:x', rows: rows2 });
  assert.equal(r2.counts.added, 0); assert.equal(r2.counts.updated, 2); assert.equal(r2.counts.removed, 1);
  let items = await getAll('library_items');
  assert.equal(items.length, 3); assert.equal(items.filter((i) => i.gone).length, 1);
  assert.ok(items.filter((i) => !i.gone).every((i) => i.status === 'completed'));
  await undoImport(r2.batchId);
  items = await getAll('library_items');
  assert.equal(items.filter((i) => i.gone).length, 0);
  assert.ok(items.every((i) => i.status === 'plan'));
  matches = await getAll('matches');
  assert.equal(matches.length, 3);
});
