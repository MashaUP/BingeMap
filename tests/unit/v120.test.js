// Test della 1.2.0: cancellate senza finale, quasi finite, pilota, classici, universi, stagioni mancanti, persone seguite,
// anime (AniList, MyAnimeList, stagione), giro del mondo, linea del tempo, esportazioni verso altre app, alto contrasto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { freshDb, cat } from './_setup.js';
import { DEFAULTS, saveSettings, loadSettings } from '../../src/common/settings.js';
import { buildViews } from '../../src/library/view.js';
import { runQuery } from '../../src/query/engine.js';
import { presets } from '../../src/query/presets.js';
import { normTitle } from '../../src/match/normalize.js';
import { findUniverses, franchisePrefix } from '../../src/library/universes.js';
import { classics, listCoverage, weightedScore } from '../../src/library/classics.js';
import { timeline } from '../../src/library/timeline.js';
import { countryStats, countryName } from '../../src/library/world.js';
import { toggleFollow } from '../../src/library/data.js';
import { rowsFromAniList, fetchAniList, parseMalXml, readMalFile, fetchSeason, seasonOf } from '../../src/import/anime.js';
import { imdbRatingsCsv, imdbWatchlistCsv, fullCsv, malXml, malEntries } from '../../src/backup/exports.js';
import { parseCsv } from '../../src/import/csv.js';
import { parseMalXml as reparse } from '../../src/import/anime.js';
import { readFileSync } from 'node:fs';

const S = { ...DEFAULTS };
const P = (id) => presets({}).find((p) => p.id === id).query;
const item = (key, title, status, extra = {}) => ({ key, source: 'csv', title, status, tags: [], lists: [], updatedAt: 1, ...extra });
const auto = (itemKey, ck) => ({ key: `sc|${itemKey}`, itemKey, catalog: 'sc', ck, state: 'auto', confidence: 100 });

test('cancellate senza finale, chiuse bene, stagioni mancanti, quasi finite, pilota, doppiate', () => {
  const today = new Date();
  const past = (y) => `${today.getFullYear() - y}-01-01`;
  const future = `${today.getFullYear() + 1}-01-01`;
  const data = {
    catalog: [
      cat(1, 'Cancellata', { tmdbId: 1, score: 8 }), cat(2, 'Conclusa', { tmdbId: 2, score: 8 }),
      cat(3, 'Mancano stagioni', { tmdbId: 3, seasonsCount: 2, score: 8 }), cat(4, 'Quasi', { tmdbId: 4, score: 8 }),
      cat(5, 'Pilota', { score: 8.2, dubIta: true }), cat(6, 'Futura', { tmdbId: 6, seasonsCount: 1, score: 8 }),
    ],
    items: [item('a', 'Quasi', 'watching', { episodesWatched: 9 }), item('b', 'Mancano stagioni', 'watching')],
    matches: [auto('a', 'sc:4'), auto('b', 'sc:3')],
    tmdbCache: [
      { tmdbId: 1, status: 'Canceled', seasons: 1 }, { tmdbId: 2, status: 'Ended', seasons: 3 },
      { tmdbId: 3, status: 'Returning Series', seasons: 3, seasonEpisodes: [{ n: 1, episodes: 8, date: past(3) }, { n: 2, episodes: 8, date: past(2) }, { n: 3, episodes: 8, date: past(1) }] },
      { tmdbId: 4, status: 'Ended', seasons: 1, episodes: 10, epRuntime: 45, seasonEpisodes: [{ n: 1, episodes: 10, date: past(2) }] },
      { tmdbId: 6, status: 'Returning Series', seasons: 2, seasonEpisodes: [{ n: 1, episodes: 8, date: past(1) }, { n: 2, episodes: 8, date: future }] },
    ],
  };
  const { views } = buildViews(data, S);
  const by = (n) => views.find((v) => v.name === n);
  assert.deepEqual(by('Cancellata').openEnding, { seasons: 1 });
  assert.equal(by('Conclusa').openEnding, null);
  assert.deepEqual(by('Mancano stagioni').missingSeasons, { site: 2, aired: 3 });
  assert.equal(by('Futura').missingSeasons, null, 'una stagione non ancora uscita non conta');
  const names = (q) => runQuery(views, q).results.map((v) => v.name).sort();
  assert.deepEqual(names(P('p-open')), ['Cancellata']);
  assert.ok(names(P('p-closed')).includes('Conclusa') && !names(P('p-closed')).includes('Cancellata'));
  assert.deepEqual(names(P('p-missing-seasons')), ['Mancano stagioni']);
  assert.deepEqual(names(P('p-almost')), ['Quasi']);
  assert.equal(by('Quasi').progress.pct, 90);
  assert.ok(names(P('p-pilot')).includes('Pilota'), 'durata sconosciuta: il pilota resta tra i suggerimenti');
  assert.deepEqual(names(P('p-dub')), ['Pilota']);
});

test('universi e spin-off: prefisso di franchise, stessi autori con legame forte, ordine di uscita', () => {
  const v = (ck, name, year, extra = {}) => ({ ck, name, norm: normTitle(name), year, status: 'none', creators: [], keywords: [], recs: [], tmdbRecs: [], siteId: Number(ck.split(':')[1]), ...extra });
  const views = [
    v('sc:1', 'Star Trek: Discovery', 2017, { status: 'completed' }), v('sc:2', 'Star Trek: Picard', 2020), v('sc:3', 'Star Trek', 1966),
    v('sc:4', 'Breaking Bad', 2008, { creators: ['Vince Gilligan'], keywords: ['drug', 'new mexico', 'crime'], recs: [5], status: 'completed' }),
    v('sc:5', 'Better Call Saul', 2015, { creators: ['Vince Gilligan', 'Peter Gould'], keywords: ['lawyer', 'new mexico', 'crime'] }),
    v('sc:6', 'The Haunting of Hill House', 2018, { creators: ['Mike Flanagan'], keywords: ['ghost'] }),
    v('sc:7', 'Midnight Mass', 2021, { creators: ['Mike Flanagan'], keywords: ['religion'] }),
    v('sc:8', 'The Office', 2005), v('sc:9', 'The Crown', 2016),
  ];
  assert.equal(franchisePrefix('Star Trek: Discovery'), 'star trek');
  assert.equal(franchisePrefix('Dark'), null);
  assert.equal(franchisePrefix('The: Qualcosa'), null);
  const u = findUniverses(views);
  const trek = u.find((x) => x.members.some((m) => m.ck === 'sc:1'));
  assert.deepEqual(trek.members.map((m) => m.ck), ['sc:3', 'sc:1', 'sc:2']);
  assert.equal(trek.name, 'Star Trek'); assert.equal(trek.next, 'sc:3'); assert.equal(trek.seen, 1);
  const bb = u.find((x) => x.members.some((m) => m.ck === 'sc:4'));
  assert.deepEqual(bb.members.map((m) => m.ck), ['sc:4', 'sc:5']); assert.equal(bb.next, 'sc:5');
  assert.ok(!u.some((x) => x.members.some((m) => m.ck === 'sc:6')), 'stesso autore senza legame forte: non è un universo');
  assert.ok(!u.some((x) => x.members.some((m) => m.ck === 'sc:8')), '«The …» non è un franchise');
});

test('grandi classici: voto pesato, anni minimi, copertura e liste importate', () => {
  const now = new Date(2026, 10, 20);
  const views = [
    { ck: 'a', name: 'Molti voti', year: 2008, score: 9.0, voteCount: 15000, status: 'completed', lists: ['imdb:Top 250'] },
    { ck: 'b', name: 'Pochi voti', year: 2010, score: 9.6, voteCount: 12, status: 'none', lists: ['imdb:Top 250'] },
    { ck: 'c', name: 'Buona', year: 2012, score: 8.6, voteCount: 8000, status: 'none', lists: [] },
    { ck: 'd', name: 'Troppo recente', year: 2025, score: 9.5, voteCount: 9000, status: 'none', lists: [] },
    { ck: 'e', name: 'Senza voti TMDB', year: 2001, score: 8.8, voteCount: null, status: 'watching', lists: ['imdb:Top 250'] },
  ];
  assert.ok(weightedScore(views[1], 8) < weightedScore(views[2], 8), 'pochi voti pesano meno');
  const c = classics(views, { limit: 3, now });
  assert.deepEqual(c.list.map((x) => x.ck), ['a', 'c', 'e']);
  assert.equal(c.seen, 1); assert.equal(c.started, 1); assert.equal(c.pct, 33);
  const cov = listCoverage(views, 'imdb:Top 250');
  assert.equal(cov.total, 3); assert.equal(cov.seen, 1); assert.deepEqual(cov.missing.sort(), ['b', 'e']);
});

test('persone seguite: salvate nelle impostazioni, segnate sulle viste, filtrabili', async () => {
  freshDb();
  assert.equal(await toggleFollow('Phoebe Waller-Bridge', 'creator'), true);
  const s = await loadSettings();
  assert.equal(s.follows.length, 1);
  const { views } = buildViews({ catalog: [cat(1, 'Fleabag', { creators: ['Phoebe Waller-Bridge'] }), cat(2, 'Altro')] }, s);
  assert.deepEqual(views.find((v) => v.name === 'Fleabag').followedPeople, ['Phoebe Waller-Bridge']);
  assert.deepEqual(runQuery(views, { all: [{ field: 'followed', eq: true }] }).results.map((v) => v.name), ['Fleabag']);
  assert.equal(await toggleFollow('phoebe waller-bridge'), false, 'maiuscole e minuscole non contano');
  assert.equal((await loadSettings()).follows.length, 0);
});

test('AniList: stati, episodi, voti, titoli alternativi, film ignorati, profilo privato', async () => {
  const data = { MediaListCollection: { lists: [
    { name: 'Watching', isCustomList: false, entries: [
      { status: 'CURRENT', progress: 7, score: 8.5, updatedAt: 1763000000, media: { id: 154587, idMal: 52991, format: 'TV', episodes: 28, seasonYear: 2023, synonyms: ['Frieren'], title: { romaji: 'Sousou no Frieren', english: 'Frieren: Beyond Journey\'s End', native: '葬送のフリーレン' } } },
      { status: 'COMPLETED', progress: 1, score: 9, media: { id: 1, format: 'MOVIE', title: { romaji: 'Un film' } } },
    ] },
    { name: 'Preferiti', isCustomList: true, entries: [{ status: 'PAUSED', progress: 3, score: 0, media: { id: 21, idMal: 21, format: 'TV', seasonYear: 1999, title: { romaji: 'One Piece', english: 'ONE PIECE' } } }] },
  ] } };
  const r = rowsFromAniList(data);
  assert.equal(r.rows.length, 2); assert.equal(r.skippedMovies, 1);
  const fr = r.rows.find((x) => x.ids.anilist === 154587);
  assert.equal(fr.title, 'Frieren: Beyond Journey\'s End'); assert.ok(fr.altTitles.includes('Sousou no Frieren') && fr.altTitles.includes('葬送のフリーレン'));
  assert.equal(fr.status, 'watching'); assert.equal(fr.episodesWatched, 7); assert.equal(fr.rating, 8.5); assert.equal(fr.ids.mal, 52991); assert.equal(fr.year, 2023);
  const op = r.rows.find((x) => x.ids.anilist === 21);
  assert.equal(op.status, 'hold'); assert.equal(op.rating, null); assert.deepEqual(op.lists, ['Preferiti']);
  let sent = null;
  const ok = async (url, opts) => { sent = JSON.parse(opts.body); return new Response(JSON.stringify({ data }), { status: 200 }); };
  await fetchAniList('https://anilist.co/user/MashaUP/animelist', ok);
  assert.equal(sent.variables.user, 'MashaUP');
  await assert.rejects(() => fetchAniList('x', async () => new Response('{}', { status: 404 })), /privato/);
  await assert.rejects(() => fetchAniList('', ok), /nome del profilo/);
  // Abbinamento con il catalogo grazie ai titoli alternativi.
  const { views } = buildViews({ catalog: [cat(9, 'Frieren - Oltre la fine del viaggio', { altTitles: ['Sousou no Frieren'], year: 2023 })] }, S);
  assert.equal(views[0].alt.includes('Sousou no Frieren'), true);
});

test('MyAnimeList: XML dell\'esportazione, anche compresso, e ritorno in XML per altre app', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8" ?><myanimelist>
  <anime><series_animedb_id>5114</series_animedb_id><series_title><![CDATA[Fullmetal Alchemist: Brotherhood]]></series_title><series_type>TV</series_type><series_episodes>64</series_episodes>
  <my_watched_episodes>64</my_watched_episodes><my_finish_date>2024-05-02</my_finish_date><my_score>10</my_score><my_status>Completed</my_status><my_tags><![CDATA[classico, shonen]]></my_tags></anime>
  <anime><series_animedb_id>1</series_animedb_id><series_title>Cowboy Bebop &amp; Co</series_title><series_type>TV</series_type><my_watched_episodes>5</my_watched_episodes><my_score>0</my_score><my_status>On-Hold</my_status><my_finish_date>0000-00-00</my_finish_date></anime>
  <anime><series_animedb_id>199</series_animedb_id><series_title>Spirited Away</series_title><series_type>Movie</series_type><my_status>Completed</my_status></anime>
  </myanimelist>`;
  const r = parseMalXml(xml);
  assert.equal(r.rows.length, 2); assert.equal(r.skippedMovies, 1);
  const fma = r.rows[0];
  assert.equal(fma.title, 'Fullmetal Alchemist: Brotherhood'); assert.equal(fma.status, 'completed'); assert.equal(fma.rating, 10);
  assert.equal(fma.episodesWatched, 64); assert.deepEqual(fma.tags, ['classico', 'shonen']); assert.equal(fma.ids.mal, 5114);
  assert.equal(r.rows[1].title, 'Cowboy Bebop & Co'); assert.equal(r.rows[1].status, 'hold'); assert.equal(r.rows[1].lastActivity, null);
  const gz = await readMalFile(gzipSync(Buffer.from(xml)));
  assert.equal(gz.rows.length, 2);
  // Esportazione: l'XML prodotto si rilegge uguale.
  const items = r.rows.map((x, i) => ({ ...x, key: `mal:${i}` }));
  const out = malXml(malEntries(items, new Map([['mal:1', { name: 'Cowboy Bebop', status: 'watching', rating: 9, progress: { seen: 6 } }]])));
  const back = reparse(out);
  assert.equal(back.rows.length, 2);
  assert.equal(back.rows[1].status, 'watching'); assert.equal(back.rows[1].rating, 9); assert.equal(back.rows[1].episodesWatched, 6);
  assert.match(out, /<update_on_import>1<\/update_on_import>/);
});

test('anime della stagione: stagione giusta, pagine, prossimo episodio, film esclusi', async () => {
  assert.deepEqual(seasonOf(new Date(2026, 10, 20)), { season: 'FALL', year: 2026 });
  assert.deepEqual(seasonOf(new Date(2026, 0, 5)), { season: 'WINTER', year: 2026 });
  const calls = [];
  const fetchFn = async (url, opts) => {
    const v = JSON.parse(opts.body).variables; calls.push(v);
    const media = v.page === 1
      ? [{ id: 1, format: 'TV', averageScore: 86, genres: ['Action'], title: { romaji: 'A', english: 'A eng' }, nextAiringEpisode: { airingAt: 1764000000, episode: 8 } }, { id: 2, format: 'MOVIE', title: { romaji: 'Film' } }]
      : [{ id: 3, format: 'ONA', title: { romaji: 'C' } }];
    return new Response(JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: v.page === 1 }, media } } }), { status: 200 });
  };
  const list = await fetchSeason({ season: 'FALL', year: 2026 }, { pages: 3, fetchFn });
  assert.deepEqual(list.map((a) => a.anilistId), [1, 3]);
  assert.equal(list[0].score, 8.6); assert.equal(list[0].next.episode, 8); assert.equal(list[0].next.at, 1764000000000);
  assert.equal(calls.length, 2, 'si ferma quando non ci sono altre pagine');
  assert.equal(calls[0].season, 'FALL');
});

test('giro del mondo: paesi visitati, mai provati con il consiglio migliore, nomi in italiano', () => {
  const views = [
    { ck: 'a', name: 'Squid Game', country: ['KR'], status: 'completed', score: 8 },
    { ck: 'b', name: 'Kingdom', country: ['KR'], status: 'none', score: 8.3 },
    { ck: 'c', name: 'Dark', country: ['DE'], status: 'watching', score: 8.7 },
    { ck: 'd', name: 'Ertuğrul', country: ['TR'], status: 'none', score: 7.9 },
    { ck: 'e', name: 'Kuruluş', country: ['TR'], status: 'plan', score: 8.1 },
    { ck: 'f', name: 'Senza paese', country: [], status: 'completed' },
  ];
  const w = countryStats(views);
  assert.equal(w.visited, 2); assert.equal(w.available, 3); assert.equal(w.withData, 5);
  assert.deepEqual(w.neverTried.map((x) => x.code), ['TR']);
  assert.equal(w.neverTried[0].best.name, 'Kuruluş');
  assert.equal(w.countries.find((x) => x.code === 'KR').best.name, 'Kingdom');
  assert.equal(countryName('KR'), 'Corea del Sud');
  const geo = JSON.parse(readFileSync(new URL('../../assets/world.json', import.meta.url)));
  const codes = new Set(geo.countries.map((c) => c.c));
  for (const c of ['IT', 'KR', 'JP', 'US', 'TR', 'DE', 'BR', 'XK']) assert.ok(codes.has(c), c);
});

test('linea del tempo: anni e mesi dal diario, completate degli import, migliore dell\'anno', () => {
  const views = [
    { ck: 'a', name: 'Dark', rating: 10, status: 'completed', lastActivity: null },
    { ck: 'b', name: 'Ozark', rating: 8, status: 'completed', lastActivity: null },
    { ck: 'c', name: 'Vecchia', rating: 7, status: 'completed', lastActivity: new Date(2023, 4, 3).getTime() },
    { ck: 'd', name: 'In corso', status: 'watching' },
  ];
  const diary = [
    { ck: 'a', event: 'completed', date: new Date(2026, 2, 3).getTime() }, { ck: 'b', event: 'completed', date: new Date(2026, 6, 1).getTime() },
    { ck: 'd', event: 'started', date: new Date(2026, 6, 9).getTime() }, { ck: 'zz', event: 'completed', date: Date.now() },
  ];
  const t = timeline(views, diary);
  assert.deepEqual(t.map((y) => y.year), [2026, 2023]);
  assert.equal(t[0].completed, 2); assert.equal(t[0].started, 1); assert.equal(t[0].best.name, 'Dark');
  assert.deepEqual(t[0].months.map((m) => m.month), [6, 2]);
  assert.equal(t[1].months[0].events[0].from, 'import');
});

test('esporta verso altre app: CSV IMDb (voti e watchlist) e CSV completo leggibili', () => {
  const views = [
    { ck: 'a', name: 'Dark', year: 2017, imdbId: 'tt5753856', tmdbId: 70523, status: 'completed', rating: 9.4, lastActivity: Date.UTC(2024, 0, 2), impTags: { refract: ['Mind-blowing'] }, userTags: ['top'], lists: ['refract:Top'], note: 'wow', progress: null, originalName: 'Dark' },
    { ck: 'b', name: 'Silo', year: 2023, imdbId: 'tt14688458', tmdbId: 125988, status: 'plan', rating: null, impTags: {}, userTags: [], lists: [], progress: null },
    { ck: 'c', name: 'Senza IMDb', year: 2020, imdbId: null, status: 'completed', rating: 7, impTags: {}, userTags: [], lists: [], progress: { pos: { s: 2, e: 3 }, seen: 11 } },
    { ck: 'd', name: 'Mai vista', status: 'none', rating: null, impTags: {}, userTags: [], lists: [] },
  ];
  const r = parseCsv(imdbRatingsCsv(views));
  assert.deepEqual(r.headers.slice(0, 3), ['Const', 'Your Rating', 'Date Rated']);
  assert.equal(r.records.length, 1); assert.equal(r.records[0].Const, 'tt5753856'); assert.equal(r.records[0]['Your Rating'], '9'); assert.equal(r.records[0]['Date Rated'], '2024-01-02');
  const w = parseCsv(imdbWatchlistCsv(views));
  assert.deepEqual(w.records.map((x) => x.Const), ['tt14688458']);
  const f = parseCsv(fullCsv(views));
  assert.deepEqual(f.records.map((x) => x.title), ['Dark', 'Silo', 'Senza IMDb']);
  assert.equal(f.records[0].tags, 'Mind-blowing, top'); assert.equal(f.records[0].lists, 'Top'); assert.equal(f.records[2].progress, 'S2E3');
});

test('alto contrasto e testo più grande salvati nelle impostazioni', async () => {
  freshDb();
  assert.equal((await loadSettings()).contrast, 'normal');
  await saveSettings({ contrast: 'high', textScale: 130 });
  const s = await loadSettings();
  assert.equal(s.contrast, 'high'); assert.equal(s.textScale, 130);
  const css = readFileSync(new URL('../../src/ui/styles.css', import.meta.url), 'utf8');
  assert.match(css, /html\[data-contrast="high"\]\{--bg:#000/);
  assert.match(css, /html\[data-theme="light"\]\[data-contrast="high"\]/);
});
