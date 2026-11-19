// Impostazioni dell'app (nel database del profilo). Le chiavi API restano solo in locale.
import { getSetting, setSetting } from '../db/db.js';

export const DEFAULTS = {
  tmdbKey: '',
  simklClientId: '',
  googleClientId: '',
  sc: {
    origin: '',
    lang: 'it',
    strategy: 'auto', // auto | api | page
    apiPath: '/api/archive',
    archivePath: '/archive',
    typeParam: 'type=tv',
    pageParam: 'offset', // offset | page
    pageSize: 60,
    titlePath: '/titles',
    delayMs: 1500,
    detailDelayMs: 1500,
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
};

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
  return merge(DEFAULTS, await getSetting('app', {}));
}

export async function saveSettings(patch) {
  const cur = await loadSettings();
  const next = merge(cur, patch);
  await setSetting('app', next);
  return next;
}

export { merge as mergeSettings };
