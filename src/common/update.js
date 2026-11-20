// «Cerca aggiornamento»: legge version.json dal ramo main del repository.
// Un'estensione non pacchettizzata non può aggiornarsi da sola: si scarica lo zip dalla radice del repository.
import { kv } from '../platform/platform.js';
import { VERSION, RAW_BASE, REPO_URL } from './version.js';

export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export async function checkUpdate(fetchFn = globalThis.fetch) {
  const result = { current: VERSION, latest: null, available: false, zipUrl: null, notes: '', error: null };
  try {
    const r = await fetchFn(`${RAW_BASE}/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const v = await r.json();
    result.latest = v.version;
    result.notes = v.notes || '';
    result.available = compareVersions(v.version, VERSION) > 0;
    result.zipUrl = `${REPO_URL}/raw/main/${v.zip || `BingeMap-${v.version}.zip`}`;
    await kv.set('updateInfo', { ...result, checkedAt: Date.now() });
  } catch (e) {
    result.error = 'Impossibile controllare gli aggiornamenti: ' + e.message;
  }
  return result;
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
