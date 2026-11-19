// IndexedDB: unico database dell'app (uno per profilo).
// Schema versionato: ogni versione aggiunge archivi o indici in una migrazione numerata.

export const SCHEMA_VERSION = 3;

export const STORES = {
  catalog_titles: { keyPath: 'ck', indexes: [['source', 'source'], ['tmdbId', 'tmdbId'], ['imdbId', 'imdbId'], ['status', 'status']] },
  catalog_snapshots: { keyPath: 'id', indexes: [['source', 'source'], ['date', 'date']] },
  scan_jobs: { keyPath: 'id', indexes: [['status', 'status']] },
  scan_staging: { keyPath: 'sk', indexes: [['jobId', 'jobId']] },
  import_batches: { keyPath: 'id', indexes: [['source', 'source']] },
  library_raw: { keyPath: 'id', indexes: [['batchId', 'batchId']] },
  library_items: { keyPath: 'key', indexes: [['source', 'source'], ['batchId', 'batchId']] },
  matches: { keyPath: 'key', indexes: [['ck', 'ck'], ['state', 'state']] },
  match_rules: { keyPath: 'key' },
  overlay: { keyPath: 'ck' },
  tags: { keyPath: 'key' },
  tag_aliases: { keyPath: 'key' },
  tag_rules: { keyPath: 'id' },
  saved_queries: { keyPath: 'id' },
  tmdb_cache: { keyPath: 'tmdbId' },
  diary: { keyPath: 'id', indexes: [['ck', 'ck']] },
  diag: { keyPath: 'id' },
  settings: { keyPath: 'key' },
  handles: { keyPath: 'key' },
};

// Migrazioni: la funzione n porta lo schema dalla versione n-1 alla n.
const MIGRATIONS = {
  1(db) {
    for (const name of ['catalog_titles', 'catalog_snapshots', 'scan_jobs', 'scan_staging', 'import_batches', 'library_raw',
      'library_items', 'matches', 'match_rules', 'overlay', 'tags', 'tag_aliases', 'saved_queries', 'tmdb_cache', 'settings']) {
      createStore(db, name);
    }
  },
  2(db) {
    for (const name of ['tag_rules', 'diary', 'diag']) createStore(db, name);
  },
  3(db) {
    createStore(db, 'handles');
  },
};

function createStore(db, name) {
  if (db.objectStoreNames.contains(name)) return;
  const def = STORES[name];
  const os = db.createObjectStore(name, { keyPath: def.keyPath });
  for (const [idx, path] of def.indexes || []) os.createIndex(idx, path, { unique: false });
}

function idb() {
  const f = globalThis.indexedDB;
  if (!f) throw new Error('IndexedDB non disponibile');
  return f;
}

export function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const cache = new Map();

export function dbName(profile = 'default') {
  return profile === 'default' ? 'bingemap' : `bingemap_${profile}`;
}

let currentProfile = 'default';
export function setProfile(p) { currentProfile = p || 'default'; }
export function getProfile() { return currentProfile; }

export function openDb(name = dbName(currentProfile)) {
  if (cache.has(name)) return cache.get(name);
  const p = new Promise((resolve, reject) => {
    const r = idb().open(name, SCHEMA_VERSION);
    r.onupgradeneeded = (e) => {
      const db = r.result;
      for (let v = (e.oldVersion || 0) + 1; v <= SCHEMA_VERSION; v++) MIGRATIONS[v](db, r.transaction);
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); cache.delete(name); };
      resolve(db);
    };
    r.onerror = () => { cache.delete(name); reject(r.error); };
    r.onblocked = () => reject(new Error('Database bloccato da un\'altra scheda: chiudi le altre schede di BingeMap'));
  });
  cache.set(name, p);
  return p;
}

export async function closeDb(name = dbName(currentProfile)) {
  if (!cache.has(name)) return;
  const db = await cache.get(name);
  db.close();
  cache.delete(name);
}

export async function deleteDb(name) {
  await closeDb(name);
  return req(idb().deleteDatabase(name));
}

export async function get(store, key) {
  const db = await openDb();
  return req(db.transaction(store).objectStore(store).get(key));
}

export async function getAll(store, index = null, query = undefined) {
  const db = await openDb();
  const os = db.transaction(store).objectStore(store);
  return req(index ? os.index(index).getAll(query) : os.getAll(query));
}

export async function count(store, index = null, query = undefined) {
  const db = await openDb();
  const os = db.transaction(store).objectStore(store);
  return req(index ? os.index(index).count(query) : os.count(query));
}

export async function put(store, value) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}

export async function putMany(store, values) {
  if (!values.length) return;
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of values) os.put(v);
  return done(tx);
}

export async function del(store, key) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return done(tx);
}

export async function clear(store) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  return done(tx);
}

export async function deleteByIndex(store, index, value) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  const keys = await req(os.index(index).getAllKeys(value));
  for (const k of keys) os.delete(k);
  return done(tx);
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transazione annullata'));
  });
}

// Transazione unica su più archivi: o va tutto o niente (import, promozione delle scansioni).
// fn riceve un oggetto con put/del/get/getAll legati alla transazione.
export async function atomic(stores, fn) {
  const db = await openDb();
  const tx = db.transaction(stores, 'readwrite');
  const api = {
    put: (s, v) => tx.objectStore(s).put(v),
    del: (s, k) => tx.objectStore(s).delete(k),
    get: (s, k) => req(tx.objectStore(s).get(k)),
    getAll: (s, index = null, q = undefined) => req(index ? tx.objectStore(s).index(index).getAll(q) : tx.objectStore(s).getAll(q)),
    abort: () => tx.abort(),
  };
  let result;
  try {
    result = await fn(api);
  } catch (e) {
    try { tx.abort(); } catch { /* già chiusa */ }
    throw e;
  }
  await done(tx);
  return result;
}

// Impostazioni grandi o di dominio (diverse da kv): archivio settings.
export async function getSetting(key, fallback = null) {
  const r = await get('settings', key);
  return r ? r.value : fallback;
}
export async function setSetting(key, value) {
  return put('settings', { key, value, updatedAt: Date.now() });
}
