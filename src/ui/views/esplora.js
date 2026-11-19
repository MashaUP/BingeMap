// Esplora: tutte le pagine per scoprire e guardare i propri gusti in un posto solo.
import { e } from '../components.js';
import { icon } from '../icons.js';

const PAGES = [
  ['map', 'La mappa', 'Serie simili vicine e le zone che non hai esplorato', 'mappa'],
  ['globe', 'Il giro del mondo', 'I paesi di cui hai visto serie e quelli mai provati', 'mondo'],
  ['layers', 'Universi e spin-off', 'Serie collegate e l\'ordine in cui guardarle', 'universi'],
  ['star', 'I grandi classici', 'Le più votate di sempre che ti mancano', 'classici'],
  ['users', 'Persone che segui', 'Attori e autori: le loro serie nel catalogo', 'persone'],
  ['sparkles', 'Anime della stagione', 'In onda adesso, con il prossimo episodio', 'anime'],
  ['activity', 'La tua linea del tempo', 'Anno per anno le serie iniziate e finite', 'cronologia'],
  ['check', 'Quasi finite', 'Ti mancano pochi episodi', 'preset/p-almost'],
  ['play', 'Prova il pilota', 'Primi episodi brevi da assaggiare', 'preset/p-pilot'],
  ['alert', 'Cancellate senza finale', 'Da sapere prima di iniziarle', 'preset/p-open'],
  ['refresh', 'Stagioni mancanti', 'Sul catalogo manca l\'ultima stagione uscita', 'preset/p-missing-seasons'],
  ['layers', 'Scorri', 'Smista in fretta le serie mai viste', 'scorri'],
  ['clock', 'Ho 40 minuti', 'Cosa guardare nel tempo che hai', 'stasera?min=40'],
  ['route', 'Maratona', 'Quando finisci le prossime 5', 'maratona'],
  ['gift', 'Il tuo anno in serie', 'Un\'immagine da condividere', 'wrapped'],
];

export async function render(root) {
  root.innerHTML = `<header><h1>Esplora</h1><p class="muted" style="margin:4px 0 0">Modi diversi di guardare il catalogo e i tuoi gusti.</p></header>
    <section class="grid g3">${PAGES.map(([ic, t, d, r]) => `<a class="card" href="#/${r}" style="padding:18px;display:flex;gap:14px;align-items:center;text-decoration:none;color:var(--text)">${icon(ic, 24)}<span class="col" style="gap:3px"><b>${e(t)}</b><span class="muted small">${e(d)}</span></span></a>`).join('')}</section>`;
}
