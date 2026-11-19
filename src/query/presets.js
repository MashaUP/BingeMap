// Ricerche predefinite, umori (idea 12) e «Stasera ho 2 ore» (idea 13). Tutte modificabili dall'utente.
import { discoveryStatuses } from '../library/status.js';

export function discoveryCond(opts = {}) {
  return { field: 'status', any: [...discoveryStatuses(opts)] };
}

export function presets(opts = {}) {
  const d = discoveryCond(opts);
  return [
    { id: 'p-discover', name: 'Non completate', icon: 'compass', color: '#6D4AFF', query: { all: [d] } },
    { id: 'p-ended', name: 'Concluse da recuperare', icon: 'check', color: '#6D4AFF', query: { all: [d, { field: 'tmdbStatus', any: ['Ended'] }, { field: 'score', min: 7.5 }] } },
    { id: 'p-weekend', name: 'Corte per il weekend', icon: 'clock', color: '#2DD4BF', query: { all: [d, { field: 'hours', max: 10 }] } },
    { id: 'p-must', name: 'Must Watch disponibili', icon: 'star', color: '#FB923C', query: { all: [{ field: 'tag', any: ['must watch', 'mustwatch', 'priority', 'priorita'] }, { field: 'status', none: ['completed'] }] } },
    { id: 'p-never', name: 'Mai viste in nessuna lista', icon: 'eye', color: '#60A5FA', query: { all: [{ field: 'status', any: ['none'] }, { field: 'score', min: 7 }] } },
    { id: 'p-new', name: 'Nuove nel catalogo', icon: 'sparkles', color: '#2DD4BF', query: { all: [d, { field: 'added', withinDays: 14 }] } },
    { id: 'p-tonight', name: 'Stasera ho 2 ore', icon: 'clock', color: '#A68CFF', query: { all: [d, { any: [{ field: 'epRuntime', max: 30 }, { field: 'hours', max: 2 }] }] } },
    { id: 'p-newseason', name: 'Nuove stagioni', icon: 'refresh', color: '#60A5FA', query: { all: [{ field: 'newSeason', eq: true }] } },
    { id: 'p-endednow', name: 'Ora è conclusa', icon: 'check', color: '#2DD4BF', query: { all: [{ field: 'endedNow', eq: true }] } },
    { id: 'p-stalled', name: 'Riprendi o lascia', icon: 'clock', color: '#FB923C', query: { all: [{ field: 'stalled', eq: true }] } },
    { id: 'p-complete', name: 'Complete nel catalogo', icon: 'check', color: '#2DD4BF', query: { all: [d, { field: 'complete', eq: true }, { field: 'tmdbStatus', any: ['Ended'] }] } },
  ];
}

export function moods(opts = {}) {
  const d = discoveryCond(opts);
  return [
    { id: 'm-light', name: 'Leggera', query: { all: [d, { field: 'genre', any: ['comedy', 'animation', 'family'] }, { field: 'epRuntime', max: 35 }] } },
    { id: 'm-think', name: 'Da pensare', query: { all: [d, { field: 'genre', any: ['drama', 'mystery', 'sci-fi'] }, { field: 'score', min: 7.5 }] } },
    { id: 'm-rush', name: 'Adrenalina', query: { all: [d, { field: 'genre', any: ['action', 'thriller', 'crime'] }] } },
    { id: 'm-dark', name: 'Cupa', query: { all: [d, { field: 'genre', any: ['horror', 'thriller', 'crime'] }, { field: 'score', min: 7 }] } },
    { id: 'm-epic', name: 'Epica', query: { all: [d, { field: 'genre', any: ['fantasy', 'history', 'war', 'adventure'] }, { field: 'seasons', min: 2 }] } },
  ];
}
