import { test } from 'node:test';
import assert from 'node:assert/strict';
import './_setup.js';
import { runQuery, facets, describe, explain, setCond, evalNode } from '../../src/query/engine.js';
import { parseNatural } from '../../src/query/nlp.js';
import { mapStatus, effectiveStatus } from '../../src/library/status.js';
import { mergeSuggestions, canonicalGenre, splitGenre } from '../../src/library/tags.js';

const v = (o) => ({ ck: o.ck, name: o.name, norm: o.name.toLowerCase(), originalName: null, alt: [], genres: [], year: 2020, score: 7, seasons: 2, status: 'none', tags: [], impTags: {}, userTags: [], lists: [], catalogs: ['sc'], providers: [], cast: [], creators: [], country: [], subIta: false, tmdbStatus: null, hours: null, notInterested: null, snoozed: false, ...o });
const views = [
  v({ ck: 'a', name: 'Dark', genres: ['sci-fi', 'mystery'], year: 2017, score: 8.8, status: 'completed', tmdbStatus: 'Ended' }),
  v({ ck: 'b', name: 'Arcane', genres: ['animation', 'fantasy'], year: 2021, score: 9, tmdbStatus: 'Ended', tags: ['must watch', 'refract:must watch'] }),
  v({ ck: 'c', name: 'Silo', genres: ['sci-fi', 'drama'], year: 2023, score: 8.1, status: 'plan', tmdbStatus: 'Returning Series' }),
  v({ ck: 'd', name: 'Foundation', genres: ['sci-fi'], year: 2021, score: 7.4 }),
  v({ ck: 'e', name: 'Lost', genres: ['mystery'], year: 2004, score: 8.4, status: 'dropped', notInterested: { reason: '' } }),
];

test('mappatura degli stati', () => {
  assert.equal(mapStatus('Plan to Watch'), 'plan');
  assert.equal(mapStatus('plantowatch'), 'plan');
  assert.equal(mapStatus('On Hold'), 'hold');
  assert.equal(mapStatus('Completata'), 'completed');
  assert.equal(mapStatus('boh'), 'unknown');
});

test('stato effettivo: personale, recente, più avanzato, conflitto', () => {
  assert.equal(effectiveStatus('plan', [{ source: 'simkl', status: 'completed' }]).status, 'plan');
  const r = effectiveStatus(null, [{ source: 'simkl', status: 'completed', updatedAt: 1 }, { source: 'refract', status: 'hold', updatedAt: 2 }]);
  assert.equal(r.status, 'hold'); assert.equal(r.conflict, true);
  assert.equal(effectiveStatus(null, [{ source: 'a', status: 'plan' }, { source: 'b', status: 'completed' }]).status, 'completed');
  assert.equal(effectiveStatus(null, [{ source: 'imdb', status: 'unknown', updatedAt: 9 }, { source: 'simkl', status: 'plan', updatedAt: 1 }]).status, 'plan');
  assert.equal(effectiveStatus(null, [{ source: 'refract', status: 'hold', updatedAt: 2 }, { source: 'simkl', status: 'completed', updatedAt: 1 }], 'priority', ['simkl', 'refract']).status, 'completed');
});

test('esempio della richiesta: E tra campi, O nel campo, esclusione, voto minimo', () => {
  const ast = { all: [{ field: 'genre', any: ['fantasy', 'sci-fi'] }, { field: 'year', range: [2015, 2026] }, { field: 'tmdbStatus', any: ['Ended'] }, { field: 'status', none: ['completed'] }, { field: 'score', min: 7.5 }] };
  const { results } = runQuery(views, ast);
  assert.deepEqual(results.map((x) => x.ck), ['b']);
});

test('dato mancante escluso e conteggiato; nascosti esclusi', () => {
  const r = runQuery(views, { all: [{ field: 'tmdbStatus', any: ['Ended', 'Returning Series'] }] });
  assert.equal(r.results.length, 3); assert.equal(r.missingData, 1);
  assert.ok(!runQuery(views, { all: [] }).results.some((x) => x.ck === 'e'));
});

test('gruppi O e NON', () => {
  const ast = { all: [{ any: [{ field: 'genre', any: ['animation'] }, { field: 'status', any: ['plan'] }] }, { not: { field: 'year', min: 2023 } }] };
  assert.deepEqual(runQuery(views, ast).results.map((x) => x.ck), ['b']);
  assert.equal(evalNode({ any: [] }, views[0]), true);
});

test('conteggi per opzione ignorano il proprio campo', () => {
  const f = facets(views, { all: [{ field: 'genre', any: ['fantasy'] }, { field: 'year', min: 2020 }] }, ['genre']);
  const m = new Map(f.genre);
  assert.equal(m.get('sci-fi'), 2); assert.equal(m.get('fantasy'), 1);
});

test('frase leggibile, perché non la vedo, setCond', () => {
  const ast = setCond({ all: [] }, 'score', { min: 8 });
  assert.match(describe(ast), /Voto del sito almeno 8/);
  assert.ok(explain(views[3], ast)[0].includes('Non soddisfa'));
  assert.deepEqual(setCond(ast, 'score', null), { all: [] });
});

test('filtri scritti a parole', () => {
  const { query } = parseNatural('fantasy concluse dopo il 2018 non viste voto almeno 8 corte senza horror');
  const f = Object.fromEntries(query.all.map((c) => [c.field + (c.none ? '-' : ''), c]));
  assert.deepEqual(f.genre.any, ['fantasy']);
  assert.equal(f.year.min, 2019);
  assert.deepEqual(f.tmdbStatus.any, ['Ended']);
  assert.equal(f.score.min, 8);
  assert.equal(f.seasons.max, 2);
  assert.deepEqual(f['genre-'].none, ['horror']);
});

test('tag: generi canonici e unioni suggerite', () => {
  assert.equal(canonicalGenre('Fantascienza'), 'sci-fi');
  assert.deepEqual(splitGenre('Action & Adventure'), ['action', 'adventure']);
  const g = mergeSuggestions(['Fantasy', 'fantasy', 'Fantastico', 'Dark', 'Weekend', 'Weekends']);
  assert.ok(g.some((x) => x.includes('Fantasy') && x.includes('Fantastico')));
  assert.ok(g.some((x) => x.includes('Weekend') && x.includes('Weekends')));
});
