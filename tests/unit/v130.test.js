// Test della 1.3.0: riavvio dopo aver copiato la cartella nuova e lettura automatica di tutto l'archivio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staleKind, restartExtension, UPDATE_STEPS } from '../../src/common/update.js';
import { nextAutoKind } from '../../src/scan/scanner.js';
import { DEFAULTS } from '../../src/common/settings.js';
import { readFileSync } from 'node:fs';

test('riavvio: cartella nuova con motore vecchio → Riavvia; motore più nuovo → ricarica la pagina', () => {
  assert.equal(staleKind('1.3.0', '1.2.0'), 'restart');
  assert.equal(staleKind('1.3.0', 'old'), 'restart', 'un motore della 1.0.0 non risponde alla domanda sulla versione');
  assert.equal(staleKind('1.2.0', '1.3.0'), 'reload');
  assert.equal(staleKind('1.3.0', '1.3.0'), null);
  assert.equal(staleKind('1.3.0', null), null);
  assert.ok(UPDATE_STEPS.some((s) => /Riavvia BingeMap/.test(s)));
  let called = false;
  globalThis.chrome = { runtime: { reload: () => { called = true; } } };
  assert.equal(restartExtension(), true); assert.equal(called, true);
  delete globalThis.chrome;
  assert.equal(restartExtension(), false);
});

test('lettura automatica: elenco → schede → TMDB solo se c\'è la chiave, mai dopo errori o blocchi', () => {
  const on = { ...DEFAULTS, autoFullScan: true };
  assert.equal(nextAutoKind({ kind: 'sc-list', status: 'done' }, on), 'sc-detail');
  assert.equal(nextAutoKind({ kind: 'sc-detail', status: 'done' }, on), null);
  assert.equal(nextAutoKind({ kind: 'sc-detail', status: 'done' }, { ...on, tmdbKey: 'k' }), 'tmdb-enrich');
  assert.equal(nextAutoKind({ kind: 'tmdb-enrich', status: 'done' }, { ...on, tmdbKey: 'k' }), null);
  for (const st of ['blocked', 'error', 'stopped', 'paused']) assert.equal(nextAutoKind({ kind: 'sc-list', status: st }, on), null, st);
  assert.equal(nextAutoKind({ kind: 'sc-list', status: 'done' }, { ...on, autoFullScan: false }), null);
  assert.equal(DEFAULTS.autoFullScan, true, 'attiva di serie');
});

test('icone: quadrato pieno senza margini vuoti, in tutte le misure del manifest', () => {
  const m = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url)));
  for (const [size, path] of Object.entries(m.icons)) {
    const buf = readFileSync(new URL('../../' + path, import.meta.url));
    assert.equal(buf.readUInt32BE(16), Number(size), `larghezza ${path}`);
    assert.equal(buf.readUInt32BE(20), Number(size), `altezza ${path}`);
  }
});
