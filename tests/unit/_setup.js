// Ambiente di test: IndexedDB in memoria e un database nuovo per ogni test.
import 'fake-indexeddb/auto';
import { setProfile } from '../../src/db/db.js';

// localStorage e sessionStorage in memoria (le usa la piattaforma web per kv e token di sessione).
class MemStorage { constructor() { this.m = new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } clear() { this.m.clear(); } }
if (!globalThis.localStorage) globalThis.localStorage = new MemStorage();
if (!globalThis.sessionStorage) globalThis.sessionStorage = new MemStorage();

let n = 0;
export function freshDb() { setProfile(`test${Date.now()}${n++}`); }

// Record di catalogo minimo.
export function cat(id, name, extra = {}) {
  return { ck: `sc:${id}`, source: 'sc', siteId: id, name, type: 'tv', year: 2015, status: 'active', genres: [], firstSeen: Date.now(), ...extra };
}
