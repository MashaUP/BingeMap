// 1.3.3: adeguamento agli standard comuni (links.json, version.json con SHA-256, «Cerca aggiornamento» verificato, XSS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { freshDb } from './_setup.js';
import { parseLinks, safeUrl, DEFAULT_LINKS, refreshLinks, getLinks } from '../../src/common/links.js';
import { parseVersionFile, checkUpdate, downloadUpdate, sha256Hex } from '../../src/common/update.js';
import { escapeHtml, httpUrl, safeColor } from '../../src/common/util.js';
import { VERSION } from '../../src/common/version.js';
import { kv } from '../../src/platform/platform.js';

const json = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const res = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('links.json del repository: formato comune e uguale ai valori di serie nel codice', () => {
  const lj = json('links.json');
  const p = parseLinks(lj);
  assert.equal(p.valid, true);
  assert.deepEqual(p.links, DEFAULT_LINKS);
});

test('links: ogni voce si valida da sola; host consentiti; host proprio per discord/kofi/github; enabled:false nasconde', () => {
  const p = parseLinks({ schemaVersion: 1, project: 'bingemap', revision: 5, links: {
    discord: { url: 'https://discord.gg/NUOVO', enabled: true, label: 'Server' },
    kofi: { url: 'https://evil.example/kofi', enabled: true, label: 'Ko-fi' },
    github: { url: 'https://discord.gg/x', enabled: true, label: 'GitHub' },
    documentation: { url: 'javascript:alert(1)', enabled: true, label: 'Guida' },
    changelog: { url: 'http://github.com/MashaUP/BingeMap', enabled: true, label: 'Novità' },
    ideas: { url: 'https://github.com/x', enabled: false, label: 'Idee' },
    bugs: { url: 'https://github.com/MashaUP/BingeMap/issues', enabled: true, label: '<img src=x onerror=alert(1)>' + 'x'.repeat(80) },
    'Bug-Report': { url: 'https://github.com/a', enabled: true, label: 'no' },
  } });
  assert.equal(p.revision, 5);
  assert.equal(p.links.discord.url, 'https://discord.gg/NUOVO');
  assert.equal(p.links.discord.label, 'Server');
  assert.equal(p.links.kofi.url, DEFAULT_LINKS.kofi.url, 'host non consentito: resta quello di serie');
  assert.equal(p.links.github.url, DEFAULT_LINKS.github.url, 'github deve stare su github.com');
  assert.equal(p.links.documentation.url, DEFAULT_LINKS.documentation.url);
  assert.equal(p.links.changelog.url, DEFAULT_LINKS.changelog.url, 'solo https');
  assert.equal(p.links.ideas, undefined, 'enabled:false nasconde');
  assert.equal(p.links.bugs.label.length, 40, 'etichetta accorciata (resta testo, l\'interfaccia la mostra con e())');
  assert.equal(p.links['Bug-Report'], undefined);
  assert.equal(parseLinks({ schemaVersion: 2, links: {} }).valid, false);
  assert.equal(parseLinks({ schemaVersion: 1, project: 'vintory', links: {} }).valid, false);
  assert.equal(safeUrl('https://user:pw@github.com/x', 'github'), null);
  assert.equal(safeUrl('https://github.com:8443/x', 'github'), null);
});

test('links: lettura dal repository, revisione più vecchia ignorata, rete assente = ultima configurazione valida', async () => {
  freshDb();
  await kv.set('linksCheckedAt', 0);
  const remote = (rev, url) => async () => res({ schemaVersion: 1, project: 'bingemap', revision: rev, links: { discord: { url, enabled: true, label: 'Discord' } } });
  let L = await refreshLinks(true, remote(4, 'https://discord.gg/QUATTRO'));
  assert.equal(L.discord.url, 'https://discord.gg/QUATTRO');
  await kv.set('linksCheckedAt', 0);
  L = await refreshLinks(true, remote(3, 'https://discord.gg/TRE'));
  assert.equal(L.discord.url, 'https://discord.gg/QUATTRO', 'revisione più vecchia ignorata');
  await kv.set('linksCheckedAt', 0);
  L = await refreshLinks(true, async () => { throw new TypeError('Failed to fetch'); });
  assert.equal(L.discord.url, 'https://discord.gg/QUATTRO');
  assert.equal((await getLinks()).kofi.url, DEFAULT_LINKS.kofi.url);
  // Dopo un controllo, entro un minuto non si richiede di nuovo nemmeno a mano.
  let calls = 0;
  await refreshLinks(true, async () => { calls++; return res({}); });
  assert.equal(calls, 0);
});

test('version.json del repository: formato comune; SHA-256 uguale allo zip nella radice', () => {
  const v = json('version.json');
  assert.equal(v.version, VERSION);
  assert.ok(Array.isArray(v.notes) && v.notes.length >= 1 && v.notes.length <= 12);
  assert.match(v.sha256, /^[a-f0-9]{64}$/);
  const zip = readFileSync(new URL(`../../${v.zip}`, import.meta.url));
  assert.equal(createHash('sha256').update(zip).digest('hex'), v.sha256);
});

test('parseVersionFile: notes come elenco, testo unico delle versioni vecchie, valori non validi', () => {
  const p = parseVersionFile({ version: '9.0.0', date: '2026-12-01', zip: 'BingeMap-9.0.0.zip', sha256: 'A'.repeat(64), notes: ['Uno', '', 3, 'x'.repeat(400), ...Array(20).fill('n')] }, '1.3.3');
  assert.equal(p.available, true);
  assert.equal(p.sha256, 'a'.repeat(64));
  assert.equal(p.notes[0], 'Uno');
  assert.equal(p.notes[1].length, 300);
  assert.equal(p.notes.length, 12);
  assert.deepEqual(parseVersionFile({ version: '1.3.2', notes: 'Vecchio testo' }, '1.3.3').notes, ['Vecchio testo']);
  assert.equal(parseVersionFile({ version: '1.3.2' }, '1.3.3').available, false);
  assert.equal(parseVersionFile({ version: '1.3' }).ok, false);
  assert.equal(parseVersionFile({ version: '2.0.0', zip: '../../evil.sh' }).zip, 'BingeMap-2.0.0.zip');
});

test('Cerca aggiornamento: messaggi chiari per 404, limite di GitHub e rete assente', async () => {
  freshDb();
  assert.match((await checkUpdate(async () => res('', 404))).error, /non trovato/);
  assert.match((await checkUpdate(async () => res('', 429))).error, /limitato/);
  assert.match((await checkUpdate(async () => { throw new TypeError('x'); })).error, /non è raggiungibile/);
  const u = await checkUpdate(async (url, opts) => { assert.equal(opts.credentials, 'omit'); assert.match(url, /raw\.githubusercontent\.com\/.*\/version\.json$/); return res({ version: '9.9.9', date: '2026-12-01', zip: 'BingeMap-9.9.9.zip', sha256: 'b'.repeat(64), notes: ['Novità'] }); });
  assert.equal(u.available, true);
  assert.match(u.zipUrl, /^https:\/\/raw\.githubusercontent\.com\/MashaUP\/BingeMap\/main\/BingeMap-9\.9\.9\.zip$/);
  assert.deepEqual(u.notes, ['Novità']);
});

test('download dell\'aggiornamento: salvato solo se lo SHA-256 coincide', async () => {
  const bytes = new TextEncoder().encode('zip finto');
  const good = await sha256Hex(bytes);
  const u = { zip: 'BingeMap-9.9.9.zip', zipUrl: 'https://raw.githubusercontent.com/MashaUP/BingeMap/main/BingeMap-9.9.9.zip', sha256: good };
  const ok = await downloadUpdate(u, async () => new Response(bytes));
  assert.equal(ok.verified, true); assert.equal(ok.hash, good); assert.equal(ok.name, 'BingeMap-9.9.9.zip');
  await assert.rejects(downloadUpdate({ ...u, sha256: 'c'.repeat(64) }, async () => new Response(bytes)), /non corrisponde all'impronta/);
  await assert.rejects(downloadUpdate(u, async () => new Response('', { status: 404 })), /non è ancora nel repository/);
  const noSha = await downloadUpdate({ ...u, sha256: null }, async () => new Response(bytes));
  assert.equal(noSha.verified, false);
});

test('XSS: escape dell\'HTML, indirizzi solo http(s), colori solo esadecimali', () => {
  assert.equal(escapeHtml('<img src=x onerror="a()">\'&'), '&lt;img src=x onerror=&quot;a()&quot;&gt;&#39;&amp;');
  assert.equal(httpUrl('javascript:alert(1)'), '');
  assert.equal(httpUrl(' JavaScript:alert(1)'), '');
  assert.equal(httpUrl('data:text/html,<script>'), '');
  assert.equal(httpUrl('https://www.themoviedb.org/tv/1'), 'https://www.themoviedb.org/tv/1');
  assert.equal(httpUrl(null), '');
  assert.equal(safeColor('#6D4AFF'), '#6D4AFF');
  assert.equal(safeColor('red;background:url(https://x)'), '#6D4AFF');
  assert.equal(safeColor('#12345'), '#6D4AFF');
});
