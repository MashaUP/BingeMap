// Scheda della serie: dati, stato personale, tag, perché del match, cronologia, simili.
import { e, statusBadge, cards, toast, promptBox, stars } from '../components.js';
import { icon } from '../icons.js';
import { STATUSES, STATUS_LABEL } from '../../library/status.js';
import { setOverlay, toggleUserTag, notInterested, snooze, setNextUp, setProgress, toggleFollow } from '../../library/data.js';
import { loadSettings } from '../../common/settings.js';
import { episodesUpTo } from '../../library/progress.js';
import { STATUS_IT } from '../../library/alerts.js';
import { setRule, runMatching } from '../../match/run.js';
import { METHOD_LABEL } from '../../match/matcher.js';
import { fmtDate, fmtNum, fmtDec, sameProvider } from '../../common/util.js';
import { get, getAll } from '../../db/db.js';
import { SOURCES } from '../../import/sources.js';
import { FIELDS } from '../../query/engine.js';

export async function render(root, { args }, ctx) {
  const { store } = ctx;
  const ck = args[0];
  const v = await store.view(ck);
  if (!v) { root.innerHTML = `<div class="notice warn">${icon('alert')}<div>Serie non trovata nel catalogo attivo. <a href="#/catalogo">Torna al catalogo</a></div></div>`; return; }
  const [ov, similar, linkedItems] = await Promise.all([get('overlay', ck), store.similar(ck), Promise.all(v.linkedKeys.map((k) => get('library_items', k)))]);
  const matchRecs = (await getAll('matches')).filter((m) => v.cks.includes(m.ck) && (m.state === 'auto' || m.state === 'manual'));
  const tmdbSt = v.tmdbStatus ? FIELDS.tmdbStatus.valueLabel(v.tmdbStatus) : '—';
  const spoiler = !!ctx.ui.settings.spoilerFree && (v.status === 'watching' || v.status === 'hold');
  const follows = new Set((ctx.ui.settings.follows || []).map((f) => f.name.toLowerCase()));

  root.innerHTML = `
  <button class="btn sm ghost" style="align-self:flex-start" data-back>← Indietro</button>
  <div class="split">
    <div style="flex:0 0 240px;width:240px">${v.poster ? `<div class="poster"><img src="${e(v.poster)}" alt="" referrerpolicy="no-referrer"></div>` : `<div class="poster">${icon('film', 48)}</div>`}</div>
    <div class="grow">
      <div><h1 style="font-size:36px">${e(v.name)}</h1><p class="muted" style="margin:6px 0 0">${e([v.originalName && v.originalName !== v.name ? `Titolo originale: ${v.originalName}` : null, v.year, v.genreLabels.join(', ')].filter(Boolean).join(' · '))}</p>
      ${v.alt.length ? `<p class="muted small" style="margin:4px 0 0">Anche: ${e(v.alt.slice(0, 6).join(', '))}</p>` : ''}</div>
      <div class="row">${statusBadge(v.status, v.statusFrom === 'manual' ? ' · scelto da te' : v.pendingMatch ? ' · corrispondenza da confermare' : '')}${stars(v.score)}${v.conflict ? '<span class="tag" style="color:var(--warn)">Stati diversi tra le fonti</span>' : ''}${v.newSeason ? '<span class="tag s-match">Nuova stagione</span>' : ''}${v.endedNow ? '<span class="tag s-match">Ora conclusa</span>' : ''}${v.statusChange ? `<span class="tag" style="color:var(--warn)">${e(STATUS_IT[v.statusChange.to] || v.statusChange.to)} da poco</span>` : ''}${v.nextAir?.date ? `<span class="tag s-match">${icon('calendar', 12)} ${e(airLabel(v.nextAir))}</span>` : ''}</div>
      <div class="row">
        ${v.url ? `<a class="btn p" href="${e(v.url)}" target="_blank" rel="noopener">${icon('external', 16)}${v.catalogs.includes('sc') ? 'Apri sul sito' : 'Dove guardarla'}</a>` : ''}
        <button class="btn" data-a="watched">${icon('check', 16)}${v.status === 'completed' ? 'Segna non vista' : 'Segna come vista'}</button>
        <button class="btn" data-a="nextup">${icon('bookmark', 16)}${v.nextUp != null ? 'Togli dalle prossime 5' : 'Aggiungi alle prossime 5'}</button>
        <button class="btn" data-a="snooze">${icon('clock', 16)}Rimanda 30 giorni</button>
        <button class="btn" data-a="noint">${icon('ban', 16)}${v.notInterested ? 'Mi interessa di nuovo' : 'Non mi interessa'}</button>
        ${v.trailer ? `<a class="btn" href="${e(v.trailer)}" target="_blank" rel="noopener">${icon('play', 16)}Trailer</a>` : ''}
      </div>
      ${v.plot ? (spoiler ? `<div class="row"><span class="muted">${icon('eye', 16)} Trama nascosta: stai guardando questa serie.</span><button class="btn sm" data-a="spoiler">Mostra la trama</button></div><p class="muted" data-plot hidden style="margin:0;max-width:75ch;line-height:1.6">${e(v.plot)}</p>` : `<p class="muted" style="margin:0;max-width:75ch;line-height:1.6">${e(v.plot)}</p>`) : ''}
      ${v.openEnding && v.status !== 'completed' ? `<div class="notice warn">${icon('alert')}<div><b>Cancellata senza finale</b>: è stata interrotta dopo ${v.openEnding.seasons ?? '?'} ${v.openEnding.seasons === 1 ? 'stagione' : 'stagioni'}, la storia potrebbe restare in sospeso.</div></div>` : ''}
      ${v.missingSeasons ? `<div class="notice warn">${icon('alert')}<div>Sul catalogo ci sono <b>${v.missingSeasons.site}</b> ${v.missingSeasons.site === 1 ? 'stagione' : 'stagioni'}, ma ne sono uscite <b>${v.missingSeasons.aired}</b> (TMDB). L'ultima potrebbe arrivare più avanti.</div></div>` : ''}
      ${v.progress?.pct >= 80 && v.progress.pct < 100 && ['watching', 'hold'].includes(v.status) ? `<div class="notice ok">${icon('check')}<div>Quasi finita: ti ${v.progress.leftEp === 1 ? 'manca un episodio' : `mancano ${v.progress.leftEp} episodi`}.</div></div>` : ''}
      <div data-universe></div>
      ${progressPanel(v)}
      ${legalPanel(v, ctx.ui.settings)}
      <div class="panel kv">
        ${kv('Stagioni', v.seasons != null ? `${v.seasons}${v.complete === false ? ' (non tutte nel catalogo)' : v.complete ? ' · complete' : ''}` : '—')}
        ${kv('Episodi', v.episodes != null ? `${v.episodes}${v.epRuntime ? ` · circa ${v.epRuntime} min` : ''}` : '—')}
        ${kv('Ore totali', v.hours != null ? `circa ${fmtDec(v.hours, 0)}` : '—')}
        ${kv('Stato serie', tmdbSt)}
        ${kv('Paese', v.country.join(', ') || '—')}${kv('Lingua originale', v.lang ? v.lang.toUpperCase() : '—')}
        ${kv('Audio', v.catalogs.includes('sc') ? (v.subIta ? 'Sottotitolata (Sub-ITA)' : 'Doppiata') : '—')}
        ${kv('Nel catalogo dal', fmtDate(v.firstSeen))}${kv('Cataloghi', v.catalogs.map((c) => FIELDS.catalog.valueLabel(c)).join(', '))}
        ${v.providers.length ? kv('Fornitori', v.providers.join(', ')) : ''}
        ${v.creators.length ? `<div><span class="lbl">Creatori</span><span class="row" style="gap:4px">${v.creators.map((n) => personChip(n, 'creator', follows)).join('')}</span></div>` : ''}
        ${v.cast.length ? `<div><span class="lbl">Interpreti</span><span class="row" style="gap:4px">${v.cast.slice(0, 6).map((n) => personChip(n, 'cast', follows)).join('')}</span></div>` : ''}
        ${v.keywords?.length ? kv('Parole chiave', v.keywords.slice(0, 8).join(', ')) : ''}
      </div>
      <div class="grid g2">
        <section class="panel col">
          <h2 style="font-size:16px">Nella tua libreria</h2>
          ${Object.keys(v.statusBySource).length ? Object.entries(v.statusBySource).map(([s, st]) => `<div class="between"><span>${e(SOURCES[s] || s)}</span>${statusBadge(st)}</div>`).join('') : '<span class="muted">Non è in nessuna lista importata.</span>'}
          <label class="between">Stato in BingeMap <select data-status><option value="">Automatico (dalle liste)</option>${STATUSES.filter((x) => x !== 'none').map((s) => `<option value="${s}" ${ov?.status === s ? 'selected' : ''}>${e(STATUS_LABEL[s])}</option>`).join('')}</select></label>
          <label class="between">Voto personale <input type="number" min="0" max="10" step="0.5" value="${ov?.rating ?? ''}" placeholder="${v.impRating ?? ''}" data-rating style="width:90px"></label>
          ${Object.entries(v.impTags).map(([s, ts]) => `<div class="col" style="gap:6px"><span class="lbl">Tag importati · ${e(SOURCES[s] || s)}</span><div class="row" style="gap:6px">${ts.map((t) => `<span class="tag imp">${e(t)}</span>`).join('')}</div></div>`).join('')}
          ${v.lists.length ? `<div class="col" style="gap:6px"><span class="lbl">Liste</span><div class="row" style="gap:6px">${v.lists.map((l) => `<span class="tag">${e(l.split(':').slice(1).join(':'))}</span>`).join('')}</div></div>` : ''}
          <div class="col" style="gap:6px"><span class="lbl">Tag personali</span><div class="row" style="gap:6px">${v.userTags.map((t) => `<button class="tag" data-rmtag="${e(t)}" title="Togli">${e(t)} ×</button>`).join('')}<button class="chip" data-a="addtag">${icon('plus', 12)}Tag</button></div>
            ${v.computedTags.length || v.ruleTags.length ? `<div class="muted small">Calcolati: ${e([...v.computedTags, ...v.ruleTags].join(', '))}</div>` : ''}</div>
          <label class="field">Note<textarea data-note placeholder="Note personali">${e(ov?.note || '')}</textarea></label>
          <div class="row"><label class="check"><input type="checkbox" data-monitor ${ov?.monitor ? 'checked' : ''}> Monitora questo titolo</label><button class="btn sm" data-a="rewatch">Rivista (${ov?.rewatch || 0})</button></div>
        </section>
        <section class="panel col">
          <h2 style="font-size:16px">Perché è questa serie</h2>
          ${matchRecs.length ? matchRecs.map((m) => { const it = linkedItems.find((x) => x?.key === m.itemKey); return `<div class="col" style="gap:4px"><div class="row s-match">${icon('check', 16)}<b>${e(METHOD_LABEL[m.method] || m.method)} · confidenza ${m.confidence}</b></div>
            <div class="muted small">Riga ${e(SOURCES[it?.source] || it?.source || '')}: «${e(it?.title || '')}»${it?.year ? ` (${it.year})` : ''}${it?.ids?.tmdb ? ` · TMDB ${it.ids.tmdb}` : ''}${it?.ids?.imdb ? ` · ${it.ids.imdb}` : ''}</div>
            <button class="btn sm" style="align-self:flex-start" data-reject="${e(m.itemKey)}" data-cat="${e(m.catalog)}" data-ck="${e(m.ck)}">Non è questa serie</button></div>`; }).join('') : '<span class="muted">Nessuna riga delle tue liste è collegata a questa serie.</span>'}
          <h2 style="font-size:16px;margin-top:8px">Cronologia nel catalogo</h2>
          <div class="small col" style="gap:4px">${(v.history || []).slice(-8).reverse().map((h) => `<div class="between"><span>${fmtDate(h.date)}</span><span>${h.prev != null ? `stagioni ${h.prev} → ${h.seasonsCount}` : `vista con ${h.seasonsCount ?? '?'} stagioni`}</span></div>`).join('') || '<span class="muted">Nessun cambiamento registrato.</span>'}
          <div class="between"><span>Ultima volta vista nel catalogo</span><span>${fmtDate(v.lastSeen)}</span></div></div>
        </section>
      </div>
      ${similar.length ? `<section class="col"><h2>Simili</h2>${cards(similar)}</section>` : ''}
    </div>
  </div>`;

  const save = async (patch, msg) => { await setOverlay(ck, patch); if (msg) toast(msg, 'ok', { label: 'Annulla', run: ctx.undo }); await store.changed(true); ctx.rerender(); };
  // Universo di cui fa parte (funzione 5).
  store.universeOf(ck).then((u) => {
    const box = root.querySelector('[data-universe]');
    if (!u || !box) return;
    const i = u.members.findIndex((m) => m.ck === ck);
    const next = u.members.find((m) => m.ck === u.next);
    box.innerHTML = `<section class="panel col" style="gap:8px"><div class="between"><h2 style="font-size:16px">${icon('layers', 16)} Universo: ${e(u.name)}</h2><a class="small" href="#/universi">Tutti gli universi</a></div>
      <div class="row small" style="gap:6px">${u.members.map((m, j) => `${j ? '<span class="muted">→</span>' : ''}<a class="chip ${m.ck === ck ? 'on' : ''}" href="#/serie/${encodeURIComponent(m.ck)}">${e(m.name)}${m.year ? ` (${m.year})` : ''}${m.status === 'completed' ? ' ✓' : ''}</a>`).join('')}</div>
      <span class="muted small">Ordine di uscita: questa è la ${i + 1}ª di ${u.members.length}.${next && next.ck !== ck ? ` Prossima da guardare: <a href="#/serie/${encodeURIComponent(next.ck)}">${e(next.name)}</a>.` : ''}</span></section>`;
  }).catch(() => {});
  root.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-back')) { history.length > 1 ? history.back() : ctx.nav('catalogo'); return; }
    const a = t.dataset.a;
    if (a === 'watched') return save({ status: v.status === 'completed' ? 'none' : 'completed' }, v.status === 'completed' ? 'Segnata come non vista' : 'Segnata come vista');
    if (a === 'nextup') { try { await setNextUp(ck, v.nextUp == null); await store.changed(true); ctx.rerender(); } catch (err) { toast(err.message, 'err'); } return; }
    if (a === 'snooze') { await snooze(ck, 30); toast('Rimandata di 30 giorni', 'ok'); await store.changed(true); ctx.rerender(); return; }
    if (a === 'noint') {
      if (v.notInterested) return save({ notInterested: null }, 'Di nuovo tra i suggerimenti');
      const reason = await promptBox('Perché non ti interessa?', '', 'Facoltativo: genere, tono, già vista altrove…');
      await notInterested(ck, reason || ''); toast('Non verrà più proposta', 'ok'); await store.changed(true); ctx.rerender(); return;
    }
    if (a === 'addtag') { const tag = await promptBox('Nuovo tag personale', '', 'Nome del tag'); if (tag) { await toggleUserTag(ck, tag, true); await store.changed(true); ctx.rerender(); } return; }
    if (a === 'rewatch') return save({ rewatch: (ov?.rewatch || 0) + 1 }, 'Rewatch registrato');
    if (t.dataset.follow) {
      const on = await toggleFollow(t.dataset.follow, t.dataset.kind);
      ctx.ui.settings = await loadSettings();
      toast(on ? `Segui ${t.dataset.follow}: ti avviso quando arriva una sua serie` : `Non segui più ${t.dataset.follow}`, 'ok');
      await store.changed(true); ctx.rerender(); return;
    }
    if (a === 'spoiler') { root.querySelector('[data-plot]').hidden = false; t.parentElement.remove(); return; }
    if (a === 'ep-next' || a === 'ep-save' || a === 'ep-reset') {
      const box = root.querySelector('[data-progress]');
      let sN = Number(box.querySelector('[data-ps]').value) || 1; let eN = Number(box.querySelector('[data-pe]').value) || 0;
      if (a === 'ep-next') {
        if (v.progress?.next) { sN = v.progress.next.s; eN = v.progress.next.e; } else eN += 1;
      }
      if (a === 'ep-reset') { await setProgress(ck, null, null); toast('Progresso azzerato', 'ok'); await store.changed(true); ctx.rerender(); return; }
      const seen = episodesUpTo(v.seasonEpisodes, sN, eN);
      await setProgress(ck, sN, eN, { total: v.progress?.total ?? v.episodes, seen });
      toast(`Sei a S${sN}E${eN}`, 'ok'); await store.changed(true); ctx.rerender(); return;
    }
    if (t.dataset.rmtag) { await toggleUserTag(ck, t.dataset.rmtag, false); await store.changed(true); ctx.rerender(); return; }
    if (t.dataset.reject) { await setRule(t.dataset.reject, t.dataset.cat, { reject: [t.dataset.ck], accept: null }); await runMatching(); toast('Collegamento rimosso: la riga torna da confermare o in Mancanti', 'ok'); await store.changed(true); ctx.rerender(); }
  });
  root.querySelector('[data-status]').addEventListener('change', (ev) => save({ status: ev.target.value || null }, 'Stato aggiornato'));
  root.querySelector('[data-rating]').addEventListener('change', (ev) => save({ rating: ev.target.value === '' ? null : Number(ev.target.value) }, 'Voto salvato'));
  root.querySelector('[data-note]').addEventListener('change', (ev) => save({ note: ev.target.value }, 'Nota salvata'));
  root.querySelector('[data-monitor]').addEventListener('change', (ev) => save({ monitor: ev.target.checked }, ev.target.checked ? 'Ti avviso quando cambia' : 'Monitoraggio tolto'));
  void fmtNum;
}

const kv = (k, v) => `<div><span class="lbl">${e(k)}</span><span>${e(v)}</span></div>`;
const personChip = (n, kind, follows) => `<button type="button" class="chip ${follows.has(n.toLowerCase()) ? 'on' : ''}" data-follow="${e(n)}" data-kind="${kind}" aria-pressed="${follows.has(n.toLowerCase())}" title="${follows.has(n.toLowerCase()) ? 'Smetti di seguire' : 'Segui'}">${e(n)}</button>`;

export function airLabel(a) {
  if (!a?.date) return '';
  const d = new Date(a.date + 'T12:00:00');
  const se = a.s != null ? `S${a.s}E${a.e ?? '?'}` : 'Nuovo episodio';
  return `${se} il ${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}`;
}

function progressPanel(v) {
  const p = v.progress;
  const seasons = v.seasonEpisodes?.length ? v.seasonEpisodes : Array.from({ length: v.seasons || 1 }, (_, i) => ({ n: i + 1, episodes: null }));
  const cur = p?.pos || { s: seasons[0]?.n || 1, e: 0 };
  const left = p?.leftMin != null ? ` · circa ${p.leftMin >= 90 ? `${Math.round(p.leftMin / 60)} ore` : `${p.leftMin} minuti`}` : '';
  return `<section class="panel col" data-progress style="gap:10px">
    <div class="between"><h2 style="font-size:16px">Dove sei arrivato</h2>${p?.from === 'import' ? '<span class="muted small">dagli import</span>' : p?.from === 'status' ? '<span class="muted small">serie completata</span>' : ''}</div>
    ${p ? `<div class="row" style="gap:12px"><b>${p.pos ? `S${p.pos.s}E${p.pos.e}` : `${p.seen} episodi`}</b><span class="muted">${p.total ? `${p.seen} di ${p.total} episodi` : `${p.seen} episodi visti`}${p.leftEp ? ` · mancano ${p.leftEp}${left}` : p.leftEp === 0 ? ' · finita' : ''}</span></div>
      ${p.pct != null ? `<div class="prog" role="progressbar" aria-valuenow="${p.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progresso"><span style="width:${p.pct}%"></span></div>` : ''}` : '<span class="muted">Segna l\'ultimo episodio visto: BingeMap calcola quanto manca.</span>'}
    <div class="row">
      <label class="row small" style="gap:6px">Stagione <select data-ps>${seasons.map((x) => `<option value="${x.n}" ${x.n === cur.s ? 'selected' : ''}>${x.n}${x.episodes ? ` (${x.episodes} ep.)` : ''}</option>`).join('')}</select></label>
      <label class="row small" style="gap:6px">Episodio <input type="number" min="0" max="999" value="${cur.e}" data-pe style="width:80px"></label>
      <button class="btn sm" data-a="ep-save">Salva</button>
      <button class="btn sm p" data-a="ep-next">${icon('plus', 14)}${p?.next ? `Ho visto S${p.next.s}E${p.next.e}` : 'Un episodio in più'}</button>
      ${p?.from === 'manual' ? '<button class="btn sm ghost" data-a="ep-reset">Azzera</button>' : ''}
    </div></section>`;
}

const LOGO = (p) => (p.logo ? `<img src="https://image.tmdb.org/t/p/w45${e(p.logo)}" alt="" width="22" height="22" style="border-radius:5px" referrerpolicy="no-referrer">` : '');
function legalPanel(v, settings) {
  const w = v.watch;
  const isMine = (n) => (settings.myServices || []).some((m) => sameProvider(n, m));
  const group = (label, list) => (list?.length ? `<div class="col" style="gap:6px"><span class="lbl">${e(label)}</span><div class="row" style="gap:6px">${list.map((p) => `<span class="tag ${isMine(p.name) ? 's-match' : ''}" style="display:inline-flex;gap:6px;align-items:center">${LOGO(p)}${e(p.name)}${isMine(p.name) ? ' · tuo' : ''}</span>`).join('')}</div></div>` : '');
  if (!w && !v.siteProviders?.length) return '';
  const onMine = w && [...w.flatrate, ...w.free].some((p) => isMine(p.name));
  return `<section class="panel col" style="gap:10px" data-legal>
    <div class="between"><h2 style="font-size:16px">Dove guardarla legalmente</h2>${onMine ? `<span class="tag s-match">${icon('check', 12)} Nel tuo abbonamento</span>` : ''}</div>
    ${w ? `${group('In abbonamento', w.flatrate)}${group('Gratis', w.free)}${group('Noleggio', w.rent)}${group('Acquisto', w.buy)}
      ${!w.flatrate.length && !w.free.length && !w.rent.length && !w.buy.length ? '<span class="muted">Nessun servizio in Italia secondo JustWatch.</span>' : ''}
      <div class="row small muted" style="gap:10px">Dati di JustWatch tramite TMDB, Italia, aggiornati il ${fmtDate(w.at)}.${w.link ? ` <a href="${e(w.link)}" target="_blank" rel="noopener">Apri su TMDB</a>` : ''}</div>`
    : `<span class="muted">Il catalogo indica che esiste anche su: <b>${e(v.siteProviders.join(', '))}</b>. Inserisci la chiave TMDB per vedere servizi e prezzi aggiornati.</span>`}
  </section>`;
}
