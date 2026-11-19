// Stati di visione: sette valori. «Non nelle liste» non significa «mai vista».
export const STATUSES = ['completed', 'watching', 'hold', 'dropped', 'plan', 'none', 'unknown'];

export const STATUS_LABEL = {
  completed: 'Completata', watching: 'In corso', hold: 'In pausa', dropped: 'Abbandonata',
  plan: 'Da vedere', none: 'Non nelle liste', unknown: 'Incerto',
};
export const STATUS_CLASS = {
  completed: 's-done', watching: 's-watch', hold: 's-hold', dropped: 's-drop', plan: 's-plan', none: 's-none', unknown: 's-unk',
};
// Ordine «più avanzato» per gli spareggi.
const RANK = { completed: 6, watching: 5, hold: 4, dropped: 3, plan: 2, unknown: 1, none: 0 };

const MAP = [
  [/^(completed|complete|completata|completato|finished|finito|finita|watched all|visto|vista|seen|done|ended watching)$/, 'completed'],
  [/^(watching|in corso|guardando|currently watching|in progress|continuing|started|iniziata|sto guardando|current)$/, 'watching'],
  [/^(hold|on hold|onhold|in pausa|paused|pausa|sospesa|on-hold)$/, 'hold'],
  [/^(dropped|abbandonata|abbandonato|stopped|droppato|lasciata|not interested anymore)$/, 'dropped'],
  [/^(plantowatch|plan to watch|planned|plan|da vedere|watchlist|to watch|want to watch|da guardare|wishlist|ptw|planning|towatch|queued|up next)$/, 'plan'],
];

export function mapStatus(raw) {
  if (raw == null || raw === '') return 'unknown';
  const s = String(raw).toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, st] of MAP) if (re.test(s)) return st;
  if (STATUSES.includes(s)) return s;
  return 'unknown';
}

// Stato effettivo di un titolo: personale > fonte più recente (o priorità) > più avanzato.
// sources: [{source, status, updatedAt}]
export function effectiveStatus(overlayStatus, sources, rule = 'recent', priority = []) {
  const list = (sources || []).filter((s) => s.status && s.status !== 'none');
  const distinct = new Set(list.map((s) => s.status));
  const conflict = distinct.size > 1;
  if (overlayStatus) return { status: overlayStatus, conflict, from: 'manual' };
  if (!list.length) return { status: 'none', conflict: false, from: null };
  const sorted = [...list].sort((a, b) => {
    if (rule === 'priority') {
      const pa = priority.indexOf(a.source); const pb = priority.indexOf(b.source);
      const ra = pa < 0 ? 99 : pa; const rb = pb < 0 ? 99 : pb;
      if (ra !== rb) return ra - rb;
    } else if ((b.updatedAt || 0) !== (a.updatedAt || 0)) {
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    }
    return RANK[b.status] - RANK[a.status];
  });
  // Un valore "unknown" non vince su uno noto.
  const known = sorted.find((s) => s.status !== 'unknown') || sorted[0];
  return { status: known.status, conflict, from: known.source };
}

// Stati inclusi nella scoperta predefinita (F44, F45).
export function discoveryStatuses(opts = {}) {
  const set = new Set(['plan', 'none', 'unknown']);
  if (opts.includeWatching) set.add('watching');
  if (opts.includeHold) set.add('hold');
  if (opts.includeDropped) set.add('dropped');
  return set;
}
