// Ambiente di test: IndexedDB in memoria e un database nuovo per ogni test.
import 'fake-indexeddb/auto';
import { setProfile } from '../../src/db/db.js';

let n = 0;
export function freshDb() { setProfile(`test${Date.now()}${n++}`); }

// Record di catalogo minimo.
export function cat(id, name, extra = {}) {
  return { ck: `sc:${id}`, source: 'sc', siteId: id, name, type: 'tv', year: 2015, status: 'active', genres: [], firstSeen: Date.now(), ...extra };
}
