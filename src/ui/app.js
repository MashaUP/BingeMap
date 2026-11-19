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
};

const NAV = [
  ['compass', 'Scopri', 'scopri'], ['grid', 'Catalogo', 'catalogo'], ['library', 'La mia libreria', 'libreria'], ['alert', 'Mancanti', 'mancanti'],
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
    const count = route === 'mancanti' && miss ? `<span class="count">${miss}</span>` : '';
    return `<a href="#/${route}" class="${on ? 'on' : ''}" ${on ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${count}</a>`;
  }).join('');
  const L = ui.links || {};
  return `<a class="brand" href="#/scopri">${logo(34)}<b>Binge<span>Map</span></b></a>
    <nav class="nav" aria-label="Menu principale">${items}</nav>
    <div class="side-foot">
      <button class="btn sm" type="button" data-act="palette">${icon('command', 16)}Comandi <kbd>Ctrl K</kbd></button>
      <button class="btn sm" type="button" data-act="update">${icon('refresh', 16)}Cerca aggiornamento</button>
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
    document.querySelector('.main')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (err) {
    root().innerHTML = `<div class="notice err">${icon('alert')}<div><b>Qualcosa non ha funzionato.</b><div class="muted">${e(err.message)}</div></div></div>`;
    log('error', 'ui', name, err.stack || err.message);
  }
}

export const ctx = { store, nav, toast, ui, rerender: () => route() };

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
  if (t.dataset.open && !ev.target.closest('button, a')) nav('serie/' + encodeURIComponent(t.dataset.open));
});
document.addEventListener('keydown', (ev) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); palette(); return; }
  if (ev.key === 'Enter' && document.activeElement?.dataset?.open) nav('serie/' + encodeURIComponent(document.activeElement.dataset.open));
  if (typing) return;
  if (ev.key === '/') { const s = document.querySelector('[data-search]'); if (s) { ev.preventDefault(); s.focus(); } }
});
// Immagini che non si caricano: resta il segnaposto.
document.addEventListener('error', (ev) => { if (ev.target?.tagName === 'IMG') ev.target.remove(); }, true);

async function updateDialog() {
  const m = modal(`<h2>Cerca aggiornamento</h2><div class="muted">Controllo in corso…</div>`);
  const [u] = await Promise.all([checkUpdate(), refreshLinks(true).then((l) => { ui.links = l; })]);
  if (u.error) { m.el.innerHTML = `<h2>Cerca aggiornamento</h2><div class="notice err">${icon('alert')}<div>${e(u.error)}</div></div><div class="row" style="justify-content:flex-end"><button class="btn" data-close>Chiudi</button></div>`; return; }
  if (!u.available) { m.el.innerHTML = `<h2>Sei aggiornato</h2><p class="muted">Hai la versione ${e(u.current)}, l'ultima disponibile. Link Ko-fi e Discord ricaricati.</p><div class="row" style="justify-content:flex-end"><button class="btn p" data-close>OK</button></div>`; return; }
  m.el.innerHTML = `<h2>Nuova versione ${e(u.latest)}</h2><p>${e(u.notes)}</p><ol>${UPDATE_STEPS.map((s) => `<li>${e(s)}</li>`).join('')}</ol>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Più tardi</button><a class="btn p" href="${e(u.zipUrl)}" target="_blank" rel="noopener">${icon('download', 16)}Scarica e installa</a></div>`;
}

// --- Palette dei comandi (idea 19)
const COMMANDS = [
  ['Vai a Scopri', 'scopri'], ['Vai al Catalogo', 'catalogo'], ['Costruttore di filtri', 'filtri'], ['La mia libreria', 'libreria'],
  ['Da confermare', 'libreria/coda'], ['Importa liste', 'import'], ['Mancanti', 'mancanti'], ['Ricerche salvate', 'ricerche'],
  ['Statistiche', 'statistiche'], ['Attività e backup', 'attivita'], ['Impostazioni', 'impostazioni'], ['Serata in due', 'coppia'],
  ['Nuove stagioni', 'preset/p-newseason'], ['Stasera ho 2 ore', 'preset/p-tonight'], ['Riprendi o lascia', 'preset/p-stalled'],
];
async function palette() {
  const m = modal(`<div class="palette col"><input type="search" placeholder="Cerca una serie o un comando" aria-label="Cerca"><div class="list col" style="gap:2px" role="listbox"></div></div>`);
  const inp = m.el.querySelector('input'); const list = m.el.querySelector('.list');
  let opts = []; let sel = 0;
  const draw = () => { list.innerHTML = opts.map((o, i) => `<div class="opt" role="option" aria-selected="${i === sel}" data-i="${i}">${icon(o.icon)}<span>${e(o.label)}</span><span class="muted small" style="margin-left:auto">${e(o.hint || '')}</span></div>`).join('') || '<div class="muted" style="padding:10px">Nessun risultato</div>'; };
  const update = async () => {
    const q = inp.value.trim().toLowerCase();
    const cmds = COMMANDS.filter(([l]) => !q || l.toLowerCase().includes(q)).map(([label, path]) => ({ label, icon: 'command', hint: 'comando', go: () => nav(path) }));
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
  const theme = (await loadSettings()).theme;
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  ui.links = await getLinks();
  refreshLinks().then((l) => { ui.links = l; });
  await store.init();
  window.addEventListener('hashchange', route);
  onEvent((evt) => {
    if (evt.kind === 'data') store.changed();
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
