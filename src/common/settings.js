// Impostazioni dell'app (nel database del profilo). Le chiavi API restano solo in locale.
import { getSetting, atomic } from '../db/db.js';

export const DEFAULTS = {
  tmdbKey: '',
  simklClientId: '',
  googleClientId: '',
  sc: {
    origin: '',
    lang: 'it',
    strategy: 'auto', // auto | api | page
    apiPath: '/{lang}/archive', // elenco JSON paginato (intestazioni XHR); {lang} = lingua del sito
    archivePath: '/archive',
    typeParam: 'type=tv',
    pageParam: 'page', // page | offset
    pageSize: 60,
    titlePath: '/titles',
    delayMs: 1500,
    detailDelayMs: 1500,
    sliceParam: 'year', // filtro con cui si divide l'archivio in fette (il sito serve al massimo pageLimit pagine per richiesta); '' = nessuna fetta
    pageLimit: 20, // pagine massime per richiesta dichiarate dal sito («Page limit reached (20)»)
    detailVia: 'inertia', // inertia (solo i dati della scheda) | html (pagina intera)
    detailRelated: true, // con i titoli correlati (più pesante: ~190 KB invece di ~7 KB per scheda)
    inertiaVersion: '', // versione dell'app del sito, imparata da sola
  },
  tmdbProviders: { region: 'IT', ids: [], maxPages: 40 },
  activeCatalog: 'all', // sc | tmdbp | all
  conflictRule: 'recent', // recent | priority
  sourcePriority: ['manual', 'simkl', 'refract', 'trakt', 'tvtime', 'seriesguide', 'showly', 'sofa', 'imdb', 'csv', 'json', 'xlsx'],
  discovery: { includeWatching: false, includeHold: false, includeDropped: false },
  weights: { genre: 1, tag: 1, similar: 1, quality: 0.6, novelty: 0.3 },
  notifications: true,
  updateCheck: true,
  scheduledScan: 'off', // off | daily | weekly
  syncAuto: true,
  syncIncludeCatalog: true,
  backupReminderDays: 14,
  folderBackup: false,
  theme: 'dark',
  hideCompletedOnSite: false,
  badgesOnSite: true,
  stalledDays: 60,
  spoilerFree: false,
  myServices: [], // nomi dei fornitori legali a cui sei abbonato
  hoursPerWeek: 6,
  lang: 'it', // it | en (interfaccia)
  follows: [], // persone seguite: [{ name, kind: 'cast'|'creator', at }]
  contrast: 'normal', // normal | high
  textScale: 100, // 100 | 115 | 130
  anilistUser: '',
  autoFullScan: true, // dopo il collegamento: elenco completo, poi le schede di tutte le serie, poi TMDB
  settingsRev: 2,
};

// Impostazioni salvate da versioni precedenti: valori predefiniti superati che vanno aggiornati.
function migrate(stored) {
  if (!stored || typeof stored !== 'object') return stored;
  const out = { ...stored };
  if ((out.settingsRev || 1) < 2 && out.sc) {
    out.sc = { ...out.sc };
    if (out.sc.apiPath === '/api/archive') out.sc.apiPath = '/{lang}/archive';
    if (out.sc.pageParam === 'offset') out.sc.pageParam = 'page';
    out.settingsRev = 2;
  }
  return out;
}

function merge(base, over) {
  if (!over || typeof over !== 'object') return structuredClone(base);
  const out = Array.isArray(base) ? [...(over || base)] : { ...base };
  if (Array.isArray(base)) return out;
  for (const k of Object.keys(over)) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = merge(base[k], over[k]);
    else out[k] = over[k];
  }
  return out;
}

export async function loadSettings() {
  return merge(DEFAULTS, migrate(await getSetting('app', {})));
}

// Lettura e scrittura nella stessa transazione: due salvataggi contemporanei (popup, motore, dashboard) non si cancellano a vicenda.
export async function saveSettings(patch) {
  return atomic(['settings'], async (tx) => {
    const row = await tx.get('settings', 'app');
    const next = merge(merge(DEFAULTS, migrate(row ? row.value : {})), patch);
    tx.put('settings', { key: 'app', value: next, updatedAt: Date.now() });
    return next;
  });
}

export { merge as mergeSettings, migrate as migrateSettings };
