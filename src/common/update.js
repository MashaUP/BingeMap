// «Cerca aggiornamento»: legge version.json dal ramo main del repository.
// Un'estensione non pacchettizzata non può aggiornarsi da sola: si scarica lo zip dalla radice del repository.
import { kv } from '../platform/platform.js';
import { VERSION, RAW_BASE, APP_NAME } from './version.js';

export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

const ZIP_RE = /^[\w.-]{1,80}\.zip$/;

export function githubError(status) {
  if (status === 404) return 'version.json non trovato sul repository (repository privato o file mancante).';
  if (status === 403 || status === 429) return 'GitHub ha limitato le richieste da questa rete: riprova più tardi.';
  if (!status) return 'GitHub non è raggiungibile: controlla la connessione.';
  return `GitHub ha risposto con un errore (HTTP ${status}).`;
}

// version.json → dati dell'aggiornamento. notes è un elenco (accetta anche il testo unico delle versioni fino alla 1.3.2).
export function parseVersionFile(v, installed = VERSION) {
  const latest = String(v?.version || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(latest)) return { ok: false, error: 'version.json non contiene una versione valida (x.y.z).' };
  const zip = ZIP_RE.test(String(v.zip || '')) ? v.zip : `${APP_NAME}-${latest}.zip`;
  const sha256 = /^[a-f0-9]{64}$/i.test(String(v.sha256 || '')) ? v.sha256.toLowerCase() : null;
  const list = Array.isArray(v.notes) ? v.notes : typeof v.notes === 'string' && v.notes ? [v.notes] : [];
  const notes = list.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim().slice(0, 300)).slice(0, 12);
  return { ok: true, latest, available: compareVersions(latest, installed) > 0, zip, sha256, notes, date: typeof v.date === 'string' ? v.date.slice(0, 10) : null };
}

export async function checkUpdate(fetchFn = globalThis.fetch) {
  const result = { current: VERSION, latest: null, available: false, zip: null, zipUrl: null, sha256: null, notes: [], date: null, error: null };
  try {
    const r = await fetchFn(`${RAW_BASE}/version.json`, { cache: 'no-store', credentials: 'omit' });
    if (!r.ok) { result.error = githubError(r.status); return result; }
    const p = parseVersionFile(await r.json());
    if (!p.ok) { result.error = p.error; return result; }
    Object.assign(result, p, { zipUrl: `${RAW_BASE}/${encodeURIComponent(p.zip)}` });
    delete result.ok;
    await kv.set('updateInfo', { ...result, checkedAt: Date.now() });
  } catch (e) {
    result.error = githubError(0);
  }
  return result;
}

export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Scarica lo zip in memoria e ne controlla l'impronta SHA-256 prima di consegnarlo: se non coincide non si salva niente.
// Lo zip sta nella radice del repository (raw.githubusercontent.com permette la lettura da altre origini, nessun permesso in più).
export async function downloadUpdate(u, fetchFn = globalThis.fetch) {
  if (!u?.zipUrl) throw new Error('Nessuno zip indicato in version.json: scaricalo dalla pagina GitHub del progetto.');
  let r;
  try { r = await fetchFn(u.zipUrl, { cache: 'no-store', credentials: 'omit' }); } catch { throw new Error(githubError(0)); }
  if (!r.ok) throw new Error(r.status === 404 ? `${u.zip} non è ancora nel repository: riprova tra qualche minuto.` : `Download non riuscito: ${githubError(r.status)}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const hash = await sha256Hex(bytes);
  if (u.sha256 && u.sha256 !== hash) throw new Error('Lo zip scaricato non corrisponde all\'impronta dichiarata in version.json: non viene salvato. Riprova tra qualche minuto (GitHub può servire per poco una copia vecchia) oppure scaricalo dalla pagina delle release.');
  return { name: u.zip, blob: new Blob([bytes], { type: 'application/zip' }), hash, verified: !!u.sha256 };
}

// Una sola notifica per versione.
export async function shouldNotify(latest) {
  const notified = await kv.get('updateNotified');
  if (notified === latest) return false;
  await kv.set('updateNotified', latest);
  return true;
}

export const UPDATE_STEPS = [
  'Scarica lo zip della nuova versione.',
  'Estrai la cartella BingeMap e copiala al posto di quella vecchia (stessa posizione, sovrascrivi tutto).',
  'Torna qui e premi «Riavvia BingeMap»: l\'estensione rilegge i file nuovi. I tuoi dati restano dove sono.',
];

// Confronto tra la versione dei file sul disco (questa pagina) e quella del motore in esecuzione (service worker).
//  - 'restart': hai copiato una cartella nuova ma il motore è ancora quello vecchio → serve «Riavvia BingeMap»;
//  - 'reload': il motore è più nuovo della pagina aperta → basta ricaricare la pagina;
//  - null: tutto allineato.
export function staleKind(pageVersion, workerVersion) {
  // Il motore non conosce nemmeno la domanda (versione precedente alla 1.1.0): risponde con un errore o con niente.
  if (workerVersion === 'old' || workerVersion === undefined || workerVersion === null || workerVersion === '') return pageVersion ? 'restart' : null;
  if (!pageVersion) return null;
  const c = compareVersions(pageVersion, workerVersion);
  return c > 0 ? 'restart' : c < 0 ? 'reload' : null;
}

// Chiede al motore la sua versione. Errore, nessuna risposta o niente entro 3 secondi = motore vecchio.
export async function workerVersion(sendFn) {
  try {
    const v = await Promise.race([sendFn('app.version'), new Promise((r) => setTimeout(() => r('old'), 3000))]);
    return typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v) ? v : 'old';
  } catch { return 'old'; }
}

// Riavvia l'estensione (rilegge manifest e file dal disco). Funziona anche se il motore in esecuzione è vecchio.
export function restartExtension() {
  const c = globalThis.chrome;
  if (c?.runtime?.reload) { c.runtime.reload(); return true; }
  return false;
}

// Pagina aperta con il codice di prima di un aggiornamento: la versione del service worker è diversa da quella della pagina.
export function needsReload(pageVersion, workerVersion) {
  return !!workerVersion && !!pageVersion && compareVersions(workerVersion, pageVersion) !== 0;
}
