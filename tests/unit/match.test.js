import { test } from 'node:test';
import assert from 'node:assert/strict';
import './_setup.js';
import { normTitle, parseTitle, similarity } from '../../src/match/normalize.js';
import { matchAll, matchItem, buildIndex } from '../../src/match/matcher.js';

test('normalizzazione dei titoli', () => {
  assert.equal(normTitle('The Office'), 'office');
  assert.equal(normTitle('La Casa di Carta'), 'casa di carta');
  assert.equal(normTitle('Shōgun'), 'shogun');
  assert.equal(normTitle('Law & Order'), 'law and order');
  assert.equal(normTitle("L'amica geniale"), 'amica geniale');
  assert.equal(normTitle('Rocky II'), 'rocky 2');
  assert.equal(normTitle('Dark (2017)'), 'dark');
  assert.deepEqual(parseTitle('Dark (2017)'), { norm: 'dark', year: 2017 });
  assert.ok(similarity('stranger things', 'stranger thing') > 0.8);
});

const catalog = [
  { ck: 'sc:1', name: 'Dark', year: 2017, tmdbId: 70523, imdbId: 'tt5753856', type: 'tv' },
  { ck: 'sc:2', name: 'Shōgun', year: 2024, type: 'tv' },
  { ck: 'sc:3', name: 'Shōgun', year: 1980, type: 'tv' },
  { ck: 'sc:4', name: 'La casa di carta', year: 2017, type: 'tv', originalName: 'La casa de papel' },
  { ck: 'sc:5', name: 'The Office', year: 2005, type: 'tv' },
  { ck: 'sc:6', name: 'Stranger Things', year: 2016, type: 'tv' },
];

test('match per ID TMDB e IMDb', () => {
  const [a, b] = matchAll([{ key: 'a', title: 'Qualsiasi', ids: { tmdb: 70523 } }, { key: 'b', title: 'x', ids: { imdb: 'tt5753856' } }], catalog);
  assert.equal(a.ck, 'sc:1'); assert.equal(a.confidence, 100); assert.equal(a.state, 'auto');
  assert.equal(b.ck, 'sc:1'); assert.equal(b.confidence, 98);
});

test('titolo + anno: automatico; senza anno con più candidati: in coda', () => {
  const [a, b, c] = matchAll([
    { key: 'a', title: 'Shogun', year: 2024 },
    { key: 'b', title: 'Shogun' },
    { key: 'c', title: 'Dark', year: 2017 },
  ], catalog);
  assert.equal(a.ck, 'sc:2'); assert.equal(a.state, 'auto'); assert.equal(a.confidence, 90);
  assert.equal(b.state, 'queue'); assert.equal(b.candidates.length, 2);
  assert.equal(c.ck, 'sc:1');
});

test('titolo originale e somiglianza', () => {
  const [a, b] = matchAll([{ key: 'a', title: 'La casa de papel', year: 2017 }, { key: 'b', title: 'Stranger Thing', year: 2016 }], catalog);
  assert.equal(a.ck, 'sc:4'); assert.equal(a.method, 'alt_year'); assert.equal(a.confidence, 85);
  assert.equal(b.ck, 'sc:6'); assert.equal(b.state, 'queue');
});

test('nessun candidato e film esclusi', () => {
  const [a, b] = matchAll([{ key: 'a', title: 'Serie inesistente', year: 2020 }, { key: 'b', title: 'Dark', year: 2017, mediaType: 'movie' }], catalog);
  assert.equal(a.state, 'none'); assert.equal(b.state, 'none');
});

test('regole manuali: accetta e rifiuta', () => {
  const idx = buildIndex(catalog);
  assert.equal(matchItem({ key: 'x', title: 'Dark', year: 2017 }, idx, { accept: 'sc:5' }).ck, 'sc:5');
  const r = matchItem({ key: 'x', title: 'Dark', year: 2017 }, idx, { reject: ['sc:1'] });
  assert.notEqual(r.ck, 'sc:1');
});
