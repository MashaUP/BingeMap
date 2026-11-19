// Benvenuto: tre passi per partire.
import { e } from '../components.js';
import { icon, logo } from '../icons.js';
import { isExtension } from '../../platform/platform.js';

export async function render(root, _p, ctx) {
  const s = ctx.ui.settings;
  const sum = ctx.store.summary();
  const step = (n, title, body, done) => `<div class="panel col" style="gap:10px;${done ? 'border-color:var(--match)' : ''}"><div class="row"><span class="h" style="font-size:22px;color:var(--primary-text)">${n}</span><b style="font-size:17px">${e(title)}</b>${done ? `<span class="s-match row" style="margin-left:auto;gap:4px">${icon('check', 16)}fatto</span>` : ''}</div>${body}</div>`;
  root.innerHTML = `<div class="row">${logo(56)}<div><h1>Benvenuto in BingeMap</h1><p class="muted" style="margin:4px 0 0">Trova le serie del catalogo che non hai ancora visto, con le tue liste, i tuoi tag e i tuoi voti.</p></div></div>
    <div class="grid g3">
      ${step(1, 'Collega il catalogo', isExtension ? `<p class="muted" style="margin:0">Apri Streaming Community in un'altra scheda, clicca l'icona di BingeMap nella barra del browser e scegli «Usa questa scheda». Poi avvia la scansione da Attività.</p><p class="muted small" style="margin:0">In alternativa, o in aggiunta, usa il catalogo legale dei fornitori italiani.</p><div class="row"><a class="btn" href="#/attivita">Attività</a><a class="btn" href="#/impostazioni/catalogo">Catalogo legale</a></div>`
        : `<p class="muted" style="margin:0">Nell'app web si usa il catalogo legale: inserisci la chiave TMDB e scegli i fornitori.</p><a class="btn" href="#/impostazioni/catalogo">Scegli i fornitori</a>`, (sum?.counts?.total || 0) > 0)}
      ${step(2, 'Importa le tue liste', `<p class="muted" style="margin:0">SIMKL, Refract, Trakt, IMDb, TV Time, Showly, SeriesGuide, Sofa Time, CSV, Excel o una lista scritta a mano.</p><a class="btn" href="#/import">${icon('upload', 16)}Importa</a>`, false)}
      ${step(3, 'Scopri', `<p class="muted" style="margin:0">Le completate spariscono da sole. Combina generi, anni, tag e voti, salva le ricerche e lascia che si aggiornino.</p><a class="btn p" href="#/scopri">${icon('compass', 16)}Vai a Scopri</a>`, false)}
    </div>
    <div class="grid g2">
      <div class="panel col"><h2>Facoltativo: metadati TMDB</h2><p class="muted" style="margin:0">Paese, lingua, stato della serie, episodi e durata. Chiave gratuita, resta sul tuo dispositivo.</p><a class="btn" style="align-self:flex-start" href="#/impostazioni/servizi">${s.tmdbKey ? 'Chiave inserita' : 'Inserisci la chiave'}</a></div>
      <div class="panel col"><h2>Consigliato: non perdere i dati</h2><p class="muted" style="margin:0">Togliere l'estensione cancella i dati locali. Attiva la sincronizzazione con Google Drive o fai backup regolari.</p><div class="row"><a class="btn" href="#/impostazioni/sync">${icon('cloud', 16)}Sincronizzazione</a><a class="btn" href="#/attivita">Backup</a></div></div>
    </div>`;
}
