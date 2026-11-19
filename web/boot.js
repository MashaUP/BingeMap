// App web (PWA): stessa interfaccia dell'estensione, con il catalogo legale e la sincronizzazione Google Drive.
// Streaming Community non è disponibile sul web: servono l'estensione e la scheda aperta.
import { setWebHandler, broadcast } from '../src/platform/platform.js';
import * as scanner from '../src/scan/scanner.js';
import { syncNow } from '../src/sync/drive.js';
import { checkUpdate } from '../src/common/update.js';
import { openDb } from '../src/db/db.js';

scanner.setHooks({ emit: (evt) => broadcast(evt), keepAlive: () => () => {}, fetch: (...a) => fetch(...a) });

const handlers = {
  'ping': () => ({ version: 'web' }),
  'scan.start': ({ kind, mode, opts }) => {
    if (kind.startsWith('sc-')) throw new Error('Streaming Community è disponibile solo nell\'estensione');
    return scanner.startJob(kind, { ...(opts || {}), mode });
  },
  'scan.pause': ({ id }) => scanner.pauseJob(id),
  'scan.resume': ({ id }) => scanner.resumeJob(id),
  'scan.stop': ({ id }) => scanner.stopJob(id),
  'scan.active': async () => { const j = await scanner.activeJob(); return j ? scanner.publicJob(j) : null; },
  'badge.clear': () => true,
  'data.changed': () => true,
  'alarms.refresh': () => true,
  'site.register': () => true,
  'sync.now': ({ interactive }) => syncNow({ interactive: !!interactive }),
  'update.check': () => checkUpdate(),
};

setWebHandler(async (msg) => {
  const fn = handlers[msg.type];
  if (!fn) throw new Error('Funzione non disponibile nell\'app web');
  return fn(msg);
});

// Il workflow di GitHub Pages copia web/sw.js nella radice del sito, così copre anche src/ e assets/.
if ('serviceWorker' in navigator) fetch('../sw.js', { method: 'HEAD' }).then((r) => r.ok && navigator.serviceWorker.register('../sw.js', { scope: '../' })).catch(() => {});

await openDb();
await scanner.resumeInterrupted();
// Sincronizzazione all'avvio se l'accesso Google è ancora valido (nessuna finestra).
syncNow({ interactive: false }).catch(() => {});
await import('../src/ui/app.js');
