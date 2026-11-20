// Scopri (dashboard): la scoperta prima di tutto.
import { e, cards, card, toast, modal, statusBadge } from '../components.js';
import { icon } from '../icons.js';
import { presets, moods, discoveryCond } from '../../query/presets.js';
import { listQueries } from '../../library/data.js';
import { parseNatural } from '../../query/nlp.js';
import { describe } from '../../query/engine.js';
import { encodeObj, fmtNum, fmtDate, daysBetween, safeColor } from '../../common/util.js';
import { getAll, getSetting } from '../../db/db.js';
import { bumpSkip } from '../../library/data.js';

export async function render(root, _p, ctx) {
  const { store, ui, nav } = ctx;
  const s = store.summary();
  const disc = { all: [discoveryCond(ui.settings.discovery)] };
  const [discRes, reco, fresh, nextUp, queries, snaps, lastBackup, lastSync] = await Promise.all([
    store.query({ ast: disc, limit: 0 }), store.recommend(disc, 12),
    store.query({ ast: { all: [discoveryCond(ui.settings.discovery), { field: 'added', withinDays: 14 }] }, sort: 'reco', limit: 12 }),
    store.query({ ast: { all: [{ field: 'nextUp', eq: true }] }, limit: 5 }),
    listQueries(), getAll('catalog_snapshots'), getSetting('lastBackupAt', 0), getSetting('lastSyncAt', 0),
  ]);
  const counts = s?.counts || {};
  const total = counts.total || 0;
  if (!total) { root.innerHTML = emptyState(); return; }
  const pinned = queries.filter((q) => q.pinned);
  const cols = pinned.length ? pinned : presets(ui.settings.discovery).filter((p) => ['p-ended', 'p-weekend', 'p-must', 'p-never'].includes(p.id));
  const colCounts = await Promise.all(cols.map((q) => store.query({ ast: q.query, limit: 0 })));
  const lastSnap = snaps.filter((x) => x.kind !== 'package').sort((a, b) => b.date - a.date)[0];
  const backupAge = Math.max(lastBackup || 0, lastSync || 0);
  const alerts = [
    counts.almost ? ['check', `${counts.almost} serie quasi finite: ti mancano pochi episodi`, 'preset/p-almost'] : null,
    counts.missingSeasons ? ['alert', `${counts.missingSeasons} serie che segui hanno stagioni uscite che il catalogo non ha ancora`, 'preset/p-missing-seasons'] : null,
    counts.followedNew ? ['users', `${counts.followedNew} serie nuove con persone che segui`, 'persone'] : null,
    counts.renewal ? ['refresh', `${counts.renewal} serie che segui sono state rinnovate, concluse o cancellate`, 'calendario'] : null,
    counts.airing ? ['calendar', `${counts.airing} serie che segui hanno episodi in arrivo`, 'calendario'] : null,
    counts.newSeason ? ['refresh', `${counts.newSeason} serie completate hanno una nuova stagione`, 'preset/p-newseason'] : null,
    counts.endedNow ? ['check', `${counts.endedNow} serie che aspettavi ora sono concluse`, 'preset/p-endednow'] : null,
    counts.stalled ? ['clock', `${counts.stalled} serie ferme da tempo: riprendi o lascia`, 'preset/p-stalled'] : null,
    counts.pending ? ['alert', `${counts.pending} possibili corrispondenze da confermare`, 'libreria/coda'] : null,
    counts.conflict ? ['info', `${counts.conflict} serie con stati diversi tra le fonti`, 'libreria/conflitti'] : null,
  ].filter(Boolean);

  root.innerHTML = `
  <header class="between">
    <div><div class="muted">Ciao</div><h1>Cosa iniziamo stasera?</h1></div>
    <form class="search" style="flex:0 1 460px" data-nlp>${icon('wand')}<input data-search name="q" placeholder="Scrivi cosa cerchi: «fantasy concluse dopo il 2018 non viste»" aria-label="Cerca a parole"></form>
  </header>
  <section class="hero" aria-labelledby="hero-t">
    <div class="col" style="flex:1 1 420px;gap:10px">
      <div class="lbl">Disponibili e non completate</div>
      <h2 id="hero-t" class="big"><b>${fmtNum(discRes.total)}</b> serie nel catalogo che non hai completato</h2>
      <p class="muted" style="margin:0">Su ${fmtNum(total)} serie: ${fmtNum(counts.completed)} completate, ${fmtNum(counts.plan)} già nelle tue liste da vedere. «Non nelle liste» non vuol dire mai viste: correggi con «L'ho già vista».</p>
      <div class="row" style="gap:8px">${[['Concluse', 'p-ended'], ['Weekend (≤ 10 ore)', 'p-weekend'], ['Stasera ho 2 ore', 'p-tonight'], ['Nuove', 'p-new'], ['Complete nel catalogo', 'p-complete']].map(([l, id]) => `<a class="chip" href="#/preset/${id}">${e(l)}</a>`).join('')}</div>
    </div>
    <div class="col" style="flex:0 1 260px;gap:10px">
      <button class="btn p lg" type="button" data-surprise>${icon('dice', 20)}Sorprendimi</button>
      <a class="btn" href="#/catalogo?q=${encodeObj(disc)}">${icon('grid')}Esplora il catalogo</a>
      <form class="row" data-tonight style="gap:6px;flex-wrap:nowrap;white-space:nowrap"><span class="muted">Ho</span><input type="number" name="min" min="10" max="240" value="40" style="width:76px" aria-label="Minuti a disposizione"><span class="muted">minuti</span><button class="btn sm" type="submit">${icon('clock', 14)}Cosa guardo</button></form>
    </div>
  </section>
  ${alerts.length ? `<section class="col" style="gap:8px">${alerts.map(([ic, t, href]) => `<a class="notice" href="#/${href}" style="text-decoration:none;color:var(--text)">${icon(ic)}<span>${e(t)}</span><span style="margin-left:auto">${icon('chev')}</span></a>`).join('')}</section>` : ''}
  ${nextUp.total ? `<section class="col"><div class="between"><h2>Le prossime ${nextUp.total}</h2><span class="muted small">La tua coda corta: aggiungi con il segnalibro</span></div><div class="cards">${nextUp.items.map((v) => card(v)).join('')}</div></section>` : ''}
  <section class="col" aria-labelledby="col-t">
    <div class="between"><h2 id="col-t">${pinned.length ? 'Le tue collezioni' : 'Collezioni consigliate'}</h2><a href="#/ricerche">Tutte le ricerche</a></div>
    <div class="grid g4">${cols.map((q, i) => `<a class="card" href="#/${String(q.id).startsWith('p-') ? 'preset' : 'ricerca'}/${encodeURIComponent(q.id)}" style="padding:18px;display:flex;flex-direction:column;gap:8px;text-decoration:none;color:var(--text);border-top:3px solid ${safeColor(q.color)}">
      <div class="between"><b>${e(q.name)}</b>${q.newIds?.length ? `<span class="s-match small" style="font-weight:600">+${q.newIds.length} nuove</span>` : ''}</div>
      <span class="muted small">${e(describe(q.query))}</span><span class="h" style="font-size:22px;margin-top:auto">${fmtNum(colCounts[i].total)} serie</span></a>`).join('')}</div>
  </section>
  <section class="col" aria-labelledby="rec-t">
    <div class="between"><h2 id="rec-t">Consigliate per te</h2><span class="muted small">Regole trasparenti: generi, tag, voti, somiglianze</span></div>
    ${reco.length && reco.some((v) => v.why.length) ? cards(reco, { why: true }) : `<div class="notice">${icon('info')}<div>Importa le tue liste (con voti o tag) per avere consigli spiegati. Intanto ecco le più votate tra le non completate.</div></div>${cards(reco)}`}
  </section>
  <section class="grid g4">${[['map', 'La mappa', 'Le zone che non hai ancora esplorato', 'mappa'], ['layers', 'Scorri', 'Smista in fretta le serie mai viste', 'scorri'], ['calendar', 'In arrivo', 'Episodi e stagioni delle tue serie', 'calendario'], ['route', 'Maratona', 'Quando finisci le prossime 5', 'maratona'], ['globe', 'Il giro del mondo', 'I paesi che non hai mai provato', 'mondo'], ['star', 'I grandi classici', 'Le più votate che ti mancano', 'classici'], ['layers', 'Universi', 'Serie collegate e ordine di visione', 'universi'], ['compass', 'Tutto in Esplora', 'Anime, persone, linea del tempo…', 'esplora']].map(([ic, t, d, r]) => `<a class="card" href="#/${r}" style="padding:16px;display:flex;gap:12px;align-items:center;text-decoration:none;color:var(--text)">${icon(ic, 22)}<span class="col" style="gap:2px"><b>${e(t)}</b><span class="muted small">${e(d)}</span></span></a>`).join('')}</section>
  <section class="col">
    <div class="between"><h2>Umore</h2></div>
    <div class="row" style="gap:8px">${moods(ui.settings.discovery).map((m) => `<a class="chip" href="#/catalogo?q=${encodeObj(m.query)}">${e(m.name)}</a>`).join('')}<a class="chip" href="#/coppia">${icon('users', 14)}Serata in due</a></div>
  </section>
  <section class="col" aria-labelledby="new-t">
    <div class="between"><h2 id="new-t">Nuove nel catalogo per i tuoi gusti</h2><span class="muted small">Ultimi 14 giorni</span></div>
    ${cards(fresh.items, { why: true, empty: 'Nessuna novità nelle ultime due settimane.' })}
  </section>
  <footer class="card row" style="padding:14px 18px;gap:12px 28px;font-size:13px">
    <span class="row" style="gap:8px">${icon('check', 16, 's-match')}${lastSnap ? `Ultima scansione ${lastSnap.complete ? 'completa' : 'parziale'}: ${fmtDate(lastSnap.date, true)} · ${fmtNum(lastSnap.count)} serie` : 'Nessuna scansione ancora'}</span>
    ${s.missing ? `<a href="#/mancanti" class="row s-unk" style="gap:8px;text-decoration:none">${icon('alert', 16)}${fmtNum(s.missing)} serie delle tue liste non sono nel catalogo${s.nowAvailable ? ` (${s.nowAvailable} ora disponibili)` : ''}</a>` : ''}
    <span class="row muted" style="gap:8px">${icon('clock', 16)}${backupAge ? `Ultimo backup o sincronizzazione: ${daysBetween(backupAge)} giorni fa` : 'Nessun backup ancora'} · <a href="#/attivita">Backup</a></span>
  </footer>`;

  root.querySelector('[data-nlp]').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const q = ev.target.q.value.trim();
    if (!q) return;
    // Prima i titoli: se il testo è il nome di una serie («Fantasy Island», «Dark») si cerca quella, non i filtri.
    const byTitle = await ctx.store.query({ ast: { all: [{ field: 'text', q }] }, limit: 1, showHidden: true });
    const { query, understood } = parseNatural(q);
    if (byTitle.total && (!understood.length || byTitle.total <= 30)) { ctx.toast(`Titoli che contengono «${q}»`, 'ok'); nav('catalogo?q=' + encodeObj({ all: [{ field: 'text', q }] })); return; }
    if (!counts.total) { ctx.toast('Il catalogo è vuoto: collega il sito dal popup di BingeMap e la scansione parte da sola', 'err'); return; }
    if (!query.all.length) { query.all.push({ field: 'text', q }); }
    ctx.toast(understood.length ? `Capito: ${understood.join(', ')}` : 'Cerco il testo nei titoli', 'ok');
    nav('catalogo?q=' + encodeObj(query));
  });
  root.querySelector('[data-surprise]').addEventListener('click', () => surpriseDialog(ctx, disc));
  root.querySelector('[data-tonight]').addEventListener('submit', (ev) => { ev.preventDefault(); nav(`stasera?min=${ev.target.min.value || 40}`); });
}

export async function surpriseDialog(ctx, ast) {
  const v = await ctx.store.surprise(ast);
  if (!v) { toast('Nessuna serie da proporre con questi filtri', 'err'); return; }
  const m = modal(`<div class="between"><h2>Sorprendimi</h2><button class="ibtn" data-close aria-label="Chiudi">${icon('x', 16)}</button></div>
    <div class="row" style="align-items:flex-start;gap:18px">
      <div style="width:160px">${card(v, { hideTitle: true })}</div>
      <div class="col" style="flex:1;gap:10px">
        <p class="muted" style="margin:0">Il titolo resta nascosto finché non decidi di scoprirlo.</p>
        <div class="why s-match">${v.why?.[0] ? e('Perché: ' + v.why[0]) : ''}</div>
        <div class="muted small">${e([v.year, v.genreLabels.join(', '), v.seasons ? v.seasons + ' stagioni' : '', v.hours ? `circa ${Math.round(v.hours)} ore` : ''].filter(Boolean).join(' · '))}</div>
        ${statusBadge(v.status)}
        <div class="row"><button class="btn p" data-reveal>${icon('eye')}Rivela</button><button class="btn" data-skip>${icon('dice')}Un'altra</button></div>
      </div>
    </div>`);
  m.el.querySelector('[data-reveal]').addEventListener('click', () => { m.el.querySelectorAll('.reveal').forEach((x) => x.classList.remove('reveal')); const a = document.createElement('a'); a.className = 'btn p'; a.href = `#/serie/${encodeURIComponent(v.ck)}`; a.innerHTML = `${icon('external')}Apri la scheda`; m.el.querySelector('[data-reveal]').replaceWith(a); });
  m.el.querySelector('[data-skip]').addEventListener('click', async () => { await bumpSkip(v.ck); ctx.store.changed(); m.close(); setTimeout(() => surpriseDialog(ctx, ast), 250); });
}

function emptyState() {
  return `<section class="hero"><div class="col" style="gap:10px;flex:1 1 400px"><div class="lbl">Benvenuto</div><h1 class="big">Il catalogo è vuoto</h1>
    <p class="muted" style="margin:0">Apri Streaming Community, clicca l'icona di BingeMap e scegli «Usa questa scheda»: BingeMap legge da solo tutto l'archivio delle serie (prima l'elenco, poi le schede). In alternativa, il catalogo legale dei fornitori italiani. Poi importa le tue liste.</p></div>
    <div class="col" style="flex:0 1 280px"><a class="btn p lg" href="#/benvenuto">${icon('compass')}Inizia</a><a class="btn" href="#/import">${icon('upload')}Importa liste</a></div></section>`;
}
