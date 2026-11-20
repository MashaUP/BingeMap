// Guscio dell'app: menu, router, palette dei comandi, azioni globali.
import * as store from './store.js';
import { icon, logo } from './icons.js';
import { e, toast, modal } from './components.js';
import { loadSettings } from '../common/settings.js';
import { getLinks, refreshLinks } from '../common/links.js';
import { checkUpdate, UPDATE_STEPS } from '../common/update.js';
import { VERSION } from '../common/version.js';
import { onEvent, isExtension, send, openUrl } from '../platform/platform.js';
import { setNextUp } from '../library/data.js';
import { log } from '../common/diag.js';
import { undo, canUndo } from '../library/undo.js';
import { staleKind, restartExtension } from '../common/update.js';
import { t, translateTree, setLang } from './i18n.js';

const ROUTES = {
  benvenuto: () => import('./views/benvenuto.js'),
  scopri: () => import('./views/scopri.js'),
  catalogo: () => import('./views/catalogo.js'),
  filtri: () => import('./views/filtri.js'),
  serie: () => import('./views/serie.js'),
  libreria: () => import('./views/libreria.js'),
  import: () => import('./views/importa.js'),
  mancanti: () => import('./views/mancanti.js'),
  ricerche: () => import('./views/ricerche.js'),
  ricerca: () => import('./views/risultati.js'),
  preset: () => import('./views/risultati.js'),
  statistiche: () => import('./views/statistiche.js'),
  attivita: () => import('./views/attivita.js'),
  impostazioni: () => import('./views/impostazioni.js'),
  coppia: () => import('./views/coppia.js'),
  calendario: () => import('./views/calendario.js'),
  maratona: () => import('./views/maratona.js'),
  mappa: () => import('./views/mappa.js'),
  scorri: () => import('./views/scorri.js'),
  stasera: () => import('./views/stasera.js'),
  wrapped: () => import('./views/wrapped.js'),
  esplora: () => import('./views/esplora.js'),
  universi: () => import('./views/universi.js'),
  classici: () => import('./views/classici.js'),
  cronologia: () => import('./views/cronologia.js'),
  persone: () => import('./views/persone.js'),
  mondo: () => import('./views/mondo.js'),
  anime: () => import('./views/anime.js'),
};

const NAV = [
  ['compass', 'Scopri', 'scopri'], ['layers', 'Esplora', 'esplora'], ['grid', 'Catalogo', 'catalogo'], ['map', 'Mappa', 'mappa'], ['calendar', 'In arrivo', 'calendario'], ['library', 'La mia libreria', 'libreria'], ['alert', 'Mancanti', 'mancanti'],
  null, ['bookmark', 'Ricerche salvate', 'ricerche'], ['chart', 'Statistiche', 'statistiche'], ['activity', 'Attività', 'attivita'], ['settings', 'Impostazioni', 'impostazioni'],
];

export const ui = {
  catalogQuery: null, catalogSort: 'score', catalogTab: 'all',
  settings: null, links: null,
};

let cleanup = null; let renderSeq = 0;
const root = () => document.getElementById('view');

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'scopri', args: parts.slice(1), params: new URLSearchParams(qs || '') };
}

export function nav(path) { location.hash = '#/' + path.replace(/^#?\/?/, ''); }

function sidebar(active) {
  const s = store.summary();
  const miss = s?.missing || 0;
  const items = NAV.map((n) => {
    if (!n) return '<div class="sep"></div>';
    const [ic, label, route] = n;
    const on = route === active || (route === 'catalogo' && active === 'filtri') || (route === 'ricerche' && (active === 'ricerca' || active === 'preset')) || (route === 'libreria' && active === 'import');
    const air = s?.counts?.airing || 0;
    const count = route === 'mancanti' && miss ? `<span class="count">${miss}</span>` : route === 'calendario' && air ? `<span class="count">${air}</span>` : '';
    return `<a href="#/${route}" class="${on ? 'on' : ''}" ${on ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${count}</a>`;
  }).join('');
  const L = ui.links || {};
  return `<a class="brand" href="#/scopri">${logo(34)}<b>Binge<span>Map</span></b></a>
    <nav class="nav" aria-label="Menu principale">${items}</nav>
    <div class="side-foot">
      <button class="btn sm" type="button" data-act="palette">${icon('command', 16)}Comandi <kbd>Ctrl K</kbd></button>
      <div class="row" style="gap:8px;flex-wrap:nowrap"><button class="btn sm" style="flex:1" type="button" data-act="update">${icon('refresh', 16)}Cerca aggiornamento</button>${isExtension ? `<button class="btn sm" type="button" data-act="restart" title="Riavvia BingeMap: dopo aver copiato la cartella della versione nuova" aria-label="Riavvia BingeMap">${icon('power', 16)}</button>` : ''}</div>
      <div class="row" style="gap:8px"><a class="btn sm" style="flex:1" href="${e(L.kofi)}" target="_blank" rel="noopener">${icon('heart', 16)}Ko-fi</a><a class="btn sm" style="flex:1" href="${e(L.discord)}" target="_blank" rel="noopener">${icon('chat', 16)}Discord</a></div>
      <div class="muted small" style="padding:0 4px">v${VERSION} · profilo «${e(store.getProfileName())}» · dati solo su questo dispositivo${isExtension ? '' : ' (app web)'}</div>
    </div>`;
}

async function route() {
  const my = ++renderSeq;
  const { name, args, params } = parseHash();
  const loader = ROUTES[name] || ROUTES.scopri;
  document.getElementById('side').innerHTML = sidebar(name);
  if (cleanup) { try { cleanup(); } catch { /* ignora */ } cleanup = null; }
  try {
    const mod = await loader();
    if (my !== renderSeq) return;
    ui.settings = await loadSettings();
    // Elemento nuovo a ogni pagina: gli ascoltatori della pagina precedente spariscono con il vecchio.
    const old = root(); const fresh = old.cloneNode(false); old.replaceWith(fresh);
    const ret = await mod.render(root(), { name, args, params }, ctx);
    if (my !== renderSeq) return;
    if (typeof ret === 'function') cleanup = ret;
    translateTree(document.getElementById('side')); translateTree(root());
    document.querySelector('.main')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (err) {
    root().innerHTML = `<div class="notice err">${icon('alert')}<div><b>Qualcosa non ha funzionato.</b><div class="muted">${e(err.message)}</div></div></div>`;
    log('error', 'ui', name, err.stack || err.message);
  }
}

// Tema ad alto contrasto e testo più grande (funzione 18).
export function applyLook(st) {
  const h = document.documentElement;
  h.dataset.contrast = st.contrast === 'high' ? 'high' : 'normal';
  const z = [100, 115, 130].includes(Number(st.textScale)) ? Number(st.textScale) : 100;
  h.style.zoom = z === 100 ? '' : String(z / 100);
}

// Annulla globale (funzione 14).
export async function doUndo() {
  if (!canUndo()) { toast(t('Niente da annullare'), ''); return; }
  const step = await undo();
  toast(`${t('Annullato')}: ${step.label}`, 'ok');
  await store.changed(true);
  if (isExtension) send('data.changed').catch(() => {});
  route();
}

// Dopo aver copiato la cartella della versione nuova: il motore in esecuzione è ancora quello vecchio finché non si riavvia.
async function checkStale() {
  if (!isExtension || document.querySelector('[data-stale]')) return;
  const w = await send('app.version').catch(() => 'old');
  const kind = staleKind(VERSION, w);
  if (!kind) return;
  const bar = document.createElement('div');
  bar.className = 'notice warn'; bar.dataset.stale = kind;
  bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:12px;z-index:60;max-width:620px;box-shadow:0 10px 30px rgba(0,0,0,.4)';
  bar.innerHTML = kind === 'restart'
    ? `<div>Hai copiato la versione <b>${VERSION}</b>: premi «Riavvia BingeMap» per completare l'aggiornamento.</div>`
    : `<div>BingeMap è stato aggiornato alla ${w}: ricarica la pagina per usare la nuova versione.</div>`;
  const b = document.createElement('button'); b.className = 'btn sm p'; b.dataset.restart = '1';
  b.textContent = kind === 'restart' ? 'Riavvia BingeMap' : 'Ricarica';
  b.addEventListener('click', () => (kind === 'restart' ? restartExtension() : location.reload()));
  bar.appendChild(b); document.body.appendChild(bar);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkStale(); });

export const ctx = { store, nav, toast, ui, rerender: () => route(), undo: doUndo, t };

// --- Azioni globali (delegazione)
document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('[data-act], [data-open]');
  if (!t) return;
  if (t.dataset.act === 'nextup') {
    ev.stopPropagation();
    const on = !t.classList.contains('on');
    try { await setNextUp(t.dataset.ck, on); t.classList.toggle('on', on); toast(on ? 'Aggiunta alle prossime 5' : 'Tolta dalle prossime 5', 'ok'); store.changed(); }
    catch (err) { toast(err.message, 'err'); }
    return;
  }
  if (t.dataset.act === 'palette') return palette();
  if (t.dataset.act === 'update') return updateDialog();
  if (t.dataset.act === 'restart') { toast('Riavvio BingeMap…', ''); setTimeout(() => restartExtension(), 300); return; }
  if (t.dataset.open && !ev.target.closest('button, a')) nav('serie/' + encodeURIComponent(t.dataset.open));
});
document.addEventListener('keydown', (ev) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); palette(); return; }
  if (ev.key === 'Enter' && document.activeElement?.dataset?.open) nav('serie/' + encodeURIComponent(document.activeElement.dataset.open));
  if (typing) return;
  if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'z' && !ev.defaultPrevented) { ev.preventDefault(); doUndo(); return; }
  if (ev.key === '/') { const s = document.querySelector('[data-search]'); if (s) { ev.preventDefault(); s.focus(); } }
});
// Immagini che non si caricano: resta il segnaposto.
document.addEventListener('error', (ev) => { if (ev.target?.tagName === 'IMG') ev.target.remove(); }, true);

async function updateDialog() {
  const m = modal(`<h2>Cerca aggiornamento</h2><div class="muted">Controllo in corso…</div>`);
  const [u] = await Promise.all([checkUpdate(), refreshLinks(true).then((l) => { ui.links = l; })]);
  if (u.error) { m.el.innerHTML = `<h2>Cerca aggiornamento</h2><div class="notice err">${icon('alert')}<div>${e(u.error)}</div></div><div class="row" style="justify-content:flex-end"><button class="btn" data-close>Chiudi</button></div>`; return; }
  if (!u.available) {
    m.el.innerHTML = `<h2>Sei aggiornato</h2><p class="muted">Hai la versione ${e(u.current)}, l'ultima disponibile. Link Ko-fi e Discord ricaricati.</p><p class="muted small">Hai appena copiato una cartella nuova? Premi «Riavvia BingeMap» per farla leggere.</p><div class="row" style="justify-content:flex-end">${isExtension ? `<button class="btn" data-restart>${icon('refresh', 16)}Riavvia BingeMap</button>` : ''}<button class="btn p" data-close>OK</button></div>`;
    m.el.querySelector('[data-restart]')?.addEventListener('click', () => restartExtension());
    return;
  }
  m.el.innerHTML = `<h2>Nuova versione ${e(u.latest)}</h2><p>${e(u.notes)}</p><ol>${UPDATE_STEPS.map((s) => `<li>${e(s)}</li>`).join('')}</ol>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Più tardi</button><a class="btn p" href="${e(u.zipUrl)}" target="_blank" rel="noopener">${icon('download', 16)}Scarica lo zip</a>${isExtension ? `<button class="btn p" data-restart>${icon('refresh', 16)}Riavvia BingeMap</button>` : ''}</div>`;
  m.el.querySelector('[data-restart]')?.addEventListener('click', () => restartExtension());
}

// --- Palette dei comandi (idea 19)
const COMMANDS = [
  ['Vai a Scopri', 'scopri'], ['Vai al Catalogo', 'catalogo'], ['Costruttore di filtri', 'filtri'], ['La mia libreria', 'libreria'],
  ['Da confermare', 'libreria/coda'], ['Importa liste', 'import'], ['Mancanti', 'mancanti'], ['Ricerche salvate', 'ricerche'],
  ['Statistiche', 'statistiche'], ['Attività e backup', 'attivita'], ['Impostazioni', 'impostazioni'], ['Serata in due', 'coppia'],
  ['Mappa delle serie', 'mappa'], ['In arrivo (calendario)', 'calendario'], ['Scorri (smista in fretta)', 'scorri'], ['Ho 40 minuti', 'stasera?min=40'],
  ['Pianifica la maratona', 'maratona'], ['Il tuo anno in serie (Wrapped)', 'wrapped'], ['Incolla una lista', 'import/paste'], ['Importa da Netflix', 'import/netflix'],
  ['Annulla l\'ultima modifica', '__undo'], ['Riavvia BingeMap (dopo aver copiato la cartella nuova)', '__restart'], ['Esplora', 'esplora'], ['Universi e spin-off', 'universi'], ['I grandi classici', 'classici'],
  ['La tua linea del tempo', 'cronologia'], ['Persone che segui', 'persone'], ['Il giro del mondo in serie', 'mondo'], ['Anime della stagione', 'anime'],
  ['Quasi finite', 'preset/p-almost'], ['Prova il pilota', 'preset/p-pilot'], ['Cancellate senza finale', 'preset/p-open'], ['Stagioni mancanti nel catalogo', 'preset/p-missing-seasons'],
  ['Importa da AniList', 'import/anilist'], ['Importa da MyAnimeList', 'import/mal'], ['Esporta verso altre app', 'attivita'],
  ['Nuove stagioni', 'preset/p-newseason'], ['Stasera ho 2 ore', 'preset/p-tonight'], ['Riprendi o lascia', 'preset/p-stalled'],
];
async function palette() {
  const m = modal(`<div class="palette col"><input type="search" placeholder="Cerca una serie o un comando" aria-label="Cerca"><div class="list col" style="gap:2px" role="listbox"></div></div>`);
  const inp = m.el.querySelector('input'); const list = m.el.querySelector('.list');
  let opts = []; let sel = 0;
  const draw = () => { list.innerHTML = opts.map((o, i) => `<div class="opt" role="option" aria-selected="${i === sel}" data-i="${i}">${icon(o.icon)}<span>${e(o.label)}</span><span class="muted small" style="margin-left:auto">${e(o.hint || '')}</span></div>`).join('') || '<div class="muted" style="padding:10px">Nessun risultato</div>'; };
  const update = async () => {
    const q = inp.value.trim().toLowerCase();
    const cmds = COMMANDS.filter(([l]) => !q || l.toLowerCase().includes(q) || t(l).toLowerCase().includes(q)).map(([label, path]) => ({ label: t(label), icon: 'command', hint: t('comando'), go: () => (path === '__undo' ? doUndo() : path === '__restart' ? restartExtension() : nav(path)) }));
    let titles = [];
    if (q.length >= 2) {
      const r = await store.query({ ast: { all: [{ field: 'text', q }] }, sort: 'score', limit: 8 });
      titles = r.items.map((v) => ({ label: `${v.name}${v.year ? ` (${v.year})` : ''}`, icon: 'film', hint: v.status === 'completed' ? 'completata' : 'serie', go: () => nav('serie/' + encodeURIComponent(v.ck)) }));
    }
    opts = [...titles, ...cmds].slice(0, 14); sel = 0; draw();
  };
  inp.addEventListener('input', update);
  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { sel = Math.min(opts.length - 1, sel + 1); draw(); ev.preventDefault(); }
    if (ev.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); ev.preventDefault(); }
    if (ev.key === 'Enter' && opts[sel]) { m.close(); opts[sel].go(); }
  });
  list.addEventListener('click', (ev) => { const o = ev.target.closest('[data-i]'); if (o) { m.close(); opts[Number(o.dataset.i)].go(); } });
  update();
}

// --- Avvio
async function boot() {
  const st = await loadSettings();
  document.documentElement.dataset.theme = st.theme === 'light' ? 'light' : 'dark';
  setLang(st.lang);
  applyLook(st);
  setTimeout(checkStale, 800);
  ui.links = await getLinks();
  refreshLinks().then((l) => { ui.links = l; });
  await store.init();
  window.addEventListener('hashchange', route);
  onEvent((evt) => {
    if (evt.kind === 'data') {
      // Modifica fatta in un'altra scheda (o dal sito): si ricaricano i dati, senza rimandare l'avviso (niente rimbalzi).
      if (evt.from && evt.from === location.href) return;
      store.refresh().then(() => {
        const name = parseHash().name;
        const busyUi = document.querySelector('.modal-bg') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
        if (!busyUi && !['impostazioni', 'import', 'filtri', 'scorri', 'mappa'].includes(name)) route();
      });
    }
    if (evt.kind === 'scan') {
      document.dispatchEvent(new CustomEvent('bm-scan', { detail: evt.job }));
      if (['done', 'partial', 'stopped', 'blocked', 'error'].includes(evt.job.status) && evt.job.endedAt && Date.now() - evt.job.endedAt < 5000) store.changed();
    }
  });
  if (isExtension) send('badge.clear').catch(() => {});
  route();
}

boot().catch((err) => {
  document.getElementById('view').innerHTML = `<div class="notice err"><div><b>BingeMap non si è avviato.</b><div class="muted">${e(err.message)}</div></div></div>`;
});

export { openUrl };
