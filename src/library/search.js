// Ricerca veloce per testo (menu del tasto destro, barra degli indirizzi). Funzione pura.
import { normTitle } from '../match/normalize.js';

// Prima il titolo esatto (o l'originale), poi i titoli che lo contengono, i più votati prima.
export function findByText(views, text, limit = 6) {
  const n = normTitle(text);
  if (!n) return [];
  const exact = views.filter((v) => v.norm === n || normTitle(v.originalName || '') === n);
  const part = views.filter((v) => !exact.includes(v) && (v.norm.includes(n) || (v.alt || []).some((a) => normTitle(a).includes(n))));
  return [...exact, ...part.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))].slice(0, limit);
}
