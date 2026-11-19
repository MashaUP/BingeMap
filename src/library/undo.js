// Annulla globale (funzione 14): ogni modifica dello strato personale salva lo stato precedente del record.
// Ctrl+Z ripristina l'ultima. Pila in memoria per la pagina aperta (massimo 50 passi).
import { atomic } from '../db/db.js';

const stack = [];
const MAX = 50;
const subs = new Set();

export function pushUndo(label, changes) {
  // changes: [{store, key, prev}] con prev = record precedente oppure null (il record non esisteva).
  stack.push({ label, changes, at: Date.now() });
  if (stack.length > MAX) stack.shift();
  for (const fn of subs) { try { fn(stack.length); } catch { /* ignora */ } }
}

export function canUndo() { return stack.length > 0; }
export function peekUndo() { return stack[stack.length - 1] || null; }
export function onUndoChange(fn) { subs.add(fn); return () => subs.delete(fn); }
export function clearUndo() { stack.length = 0; }

export async function undo() {
  const step = stack.pop();
  if (!step) return null;
  const stores = [...new Set(step.changes.map((c) => c.store))];
  await atomic(stores, async (tx) => {
    for (const c of [...step.changes].reverse()) {
      if (c.prev == null) tx.del(c.store, c.key); else tx.put(c.store, { ...c.prev, updatedAt: Date.now() });
    }
  });
  for (const fn of subs) { try { fn(stack.length); } catch { /* ignora */ } }
  return step;
}
