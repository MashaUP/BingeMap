// Livello dati dell'interfaccia: un Web Worker per viste e query, scritture dirette su IndexedDB.
import { kv, send, isExtension } from '../platform/platform.js';
import { setProfile } from '../db/db.js';

let worker = null; let seq = 0; const pending = new Map();
let built = null; let profile = 'default';
const subs = new Set();

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    e.data.ok ? p.resolve(e.data.r) : p.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'Errore del worker')); pending.clear(); };
  return worker;
}

export function call(method, args) {
  ensureWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, method, args }); });
}

export async function init() {
  profile = await kv.get('activeProfile', 'default');
  setProfile(profile);
  return refresh();
}

export function getProfileName() { return profile; }

export async function refresh() {
  built = await call('build', { profile });
  for (const fn of subs) { try { fn(built); } catch { /* ignora */ } }
  return built;
}

// Dopo una scrittura: ricostruisce le viste e avvisa il service worker (badge del sito).
let t = null;
export function changed(immediate = false) {
  clearTimeout(t);
  const go = async () => { await refresh(); if (isExtension) send('data.changed').catch(() => {}); };
  if (immediate) return go();
  t = setTimeout(go, 150);
  return null;
}

export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
export function summary() { return built; }

export const query = (a) => call('query', a);
export const view = (ck) => call('view', { ck });
export const views = (cks) => call('views', { cks });
export const missing = () => call('missing');
export const explain = (ck, ast) => call('explain', { ck, ast });
export const surprise = (ast) => call('surprise', { ast, seed: Date.now() });
export const recommend = (ast, limit) => call('recommend', { ast, limit });
export const similar = (ck) => call('similar', { ck });
export const conflicts = () => call('conflicts');
export const tagIndex = () => call('tagIndex');
export const allViews = () => call('allViews');
