// Astrazione dell'ambiente: la stessa app gira come estensione (chrome.*) e come sito web/PWA.
// Nell'estensione il catalogo di Streaming Community è disponibile; sul web solo il catalogo legale (TMDB).

const g = globalThis;
export const isExtension = !!(g.chrome && g.chrome.runtime && g.chrome.runtime.id);
export const host = isExtension ? 'extension' : 'web';

// --- Archivio chiave/valore piccolo (impostazioni, token). Mai dati grandi: quelli vanno in IndexedDB.
export const kv = {
  async get(key, fallback = null) {
    if (isExtension) {
      const r = await g.chrome.storage.local.get(key);
      return r[key] ?? fallback;
    }
    try {
      const v = g.localStorage?.getItem('bm:' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  async set(key, value) {
    if (isExtension) return g.chrome.storage.local.set({ [key]: value });
    try { g.localStorage?.setItem('bm:' + key, JSON.stringify(value)); } catch { /* spazio pieno o modalità privata */ }
  },
  async remove(key) {
    if (isExtension) return g.chrome.storage.local.remove(key);
    try { g.localStorage?.removeItem('bm:' + key); } catch { /* ignora */ }
  },
};

// Dati di sessione (token di accesso): chrome.storage.session nell'estensione, sessionStorage sul web.
export const sessionKv = {
  async get(key) {
    if (isExtension && g.chrome.storage.session) {
      const r = await g.chrome.storage.session.get(key);
      return r[key] ?? null;
    }
    try { const v = g.sessionStorage?.getItem('bm:' + key); return v ? JSON.parse(v) : null; } catch { return null; }
  },
  async set(key, value) {
    if (isExtension && g.chrome.storage.session) return g.chrome.storage.session.set({ [key]: value });
    try { g.sessionStorage?.setItem('bm:' + key, JSON.stringify(value)); } catch { /* ignora */ }
  },
};

// --- Messaggi verso il "motore" in background.
// Estensione: service worker. Web: un gestore registrato nella pagina (web/boot.js).
let webHandler = null;
export function setWebHandler(fn) { webHandler = fn; }

export async function send(type, payload = {}) {
  if (isExtension) {
    const res = await g.chrome.runtime.sendMessage({ type, ...payload });
    if (res && res.__error) throw new Error(res.__error);
    return res;
  }
  if (!webHandler) throw new Error('Motore non disponibile');
  return webHandler({ type, ...payload });
}

// Eventi dal motore (avanzamento scansioni, aggiornamenti dati).
const listeners = new Set();
export function onEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emitLocal(evt) { for (const fn of listeners) { try { fn(evt); } catch { /* ignora */ } } }

if (isExtension && g.chrome.runtime.onMessage && typeof g.document !== 'undefined') {
  g.chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.__event) emitLocal(msg);
  });
}

// Il motore pubblica eventi a tutte le pagine aperte.
export function broadcast(evt) {
  const msg = { __event: true, ...evt };
  if (isExtension) {
    try { g.chrome.runtime.sendMessage(msg).catch(() => {}); } catch { /* nessuna pagina aperta */ }
  }
  emitLocal(msg);
}

// --- Apertura di schede e notifiche
export function openUrl(url) {
  if (isExtension && g.chrome.tabs) return g.chrome.tabs.create({ url });
  g.open?.(url, '_blank', 'noopener');
}

export function appUrl(hash = '') {
  if (isExtension) return g.chrome.runtime.getURL('src/ui/app.html') + (hash ? '#' + hash : '');
  return new URL('index.html' + (hash ? '#' + hash : ''), g.location.href).href;
}

export async function notify(id, title, message) {
  if (isExtension && g.chrome.notifications) {
    return g.chrome.notifications.create(id, {
      type: 'basic', iconUrl: g.chrome.runtime.getURL('assets/icons/icon128.png'), title, message, priority: 0,
    });
  }
  if (g.Notification && g.Notification.permission === 'granted') new g.Notification(title, { body: message, icon: 'icons/icon128.png' });
}

// --- OAuth: URL di ritorno e flusso nel browser
export function redirectUrl(path) {
  if (isExtension && g.chrome.identity) return g.chrome.identity.getRedirectURL(path);
  return new URL('oauth.html', g.location.href).href;
}

export async function authFlow(url) {
  if (isExtension && g.chrome.identity) {
    return g.chrome.identity.launchWebAuthFlow({ url, interactive: true });
  }
  // Web: finestra popup che torna su oauth.html, che rimanda l'URL con postMessage.
  return new Promise((resolve, reject) => {
    const w = g.open(url, 'bm-oauth', 'width=520,height=680');
    if (!w) return reject(new Error('Popup bloccato: consenti i popup per questo sito'));
    const onMsg = (e) => {
      if (e.origin !== g.location.origin || !e.data || e.data.type !== 'bm-oauth') return;
      g.removeEventListener('message', onMsg);
      clearInterval(timer);
      resolve(e.data.url);
    };
    g.addEventListener('message', onMsg);
    const timer = setInterval(() => {
      if (w.closed) { clearInterval(timer); g.removeEventListener('message', onMsg); reject(new Error('Accesso annullato')); }
    }, 500);
  });
}

// --- Permessi di host (solo estensione). Il pattern non contiene la porta: vale per tutte.
export function originPattern(origin) {
  try { const u = new URL(origin); return `${u.protocol}//${u.hostname}/*`; } catch { return origin + '/*'; }
}
export async function hasOrigin(origin) {
  if (!isExtension) return false;
  return g.chrome.permissions.contains({ origins: [originPattern(origin)] });
}
export async function requestOrigin(origin) {
  if (!isExtension) return false;
  return g.chrome.permissions.request({ origins: [originPattern(origin)] });
}
