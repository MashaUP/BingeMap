// Modalità «Scorri» (funzione 6): un mazzo di carte da smistare in fretta.
// ← Non mi interessa · → Da vedere · ↑ Già vista · ↓ Salta. Funziona con frecce, pulsanti e trascinando la carta.
import { e, statusBadge, toast } from '../components.js';
import { icon } from '../icons.js';
import { setOverlay, notInterested, bumpSkip } from '../../library/data.js';
import { undo } from '../../library/undo.js';

const DECKS = {
  none: { label: 'Non nelle liste', ast: { all: [{ field: 'status', any: ['none', 'unknown'] }, { field: 'notInterested', eq: false }] } },
  plan: { label: 'Da vedere', ast: { all: [{ field: 'status', any: ['plan'] }] } },
  all: { label: 'Tutte le non completate', ast: { all: [{ field: 'status', none: ['completed', 'dropped'] }, { field: 'notInterested', eq: false }] } },
};

export async function render(root, { params }, ctx) {
  const deckKey = DECKS[params.get('mazzo')] ? params.get('mazzo') : 'none';
  const deck = DECKS[deckKey];
  const done = new Set(); let queue = []; let counts = { plan: 0, completed: 0, no: 0, skip: 0 };
  root.innerHTML = `<header class="between"><div><h1>Scorri</h1><p class="muted" style="margin:4px 0 0">Smista in fretta: <kbd>←</kbd> non mi interessa · <kbd>→</kbd> da vedere · <kbd>↑</kbd> già vista · <kbd>↓</kbd> salta · <kbd>Ctrl Z</kbd> annulla.</p></div>
    <div class="row" style="gap:6px">${Object.entries(DECKS).map(([k, d]) => `<a class="chip ${k === deckKey ? 'on' : ''}" href="#/scorri?mazzo=${k}">${e(d.label)}</a>`).join('')}</div></header>
    <div class="deck" data-deck></div>
    <div class="row" style="justify-content:center;gap:10px">
      <button class="btn" data-act-s="no" aria-label="Non mi interessa">${icon('x', 18)}Non mi interessa</button>
      <button class="btn" data-act-s="skip" aria-label="Salta">${icon('arrowDown', 18)}Salta</button>
      <button class="btn" data-act-s="seen" aria-label="Già vista">${icon('check', 18)}Già vista</button>
      <button class="btn p" data-act-s="plan" aria-label="Da vedere">${icon('bookmark', 18)}Da vedere</button>
      <button class="btn ghost" data-act-s="undo" aria-label="Annulla">${icon('undo', 18)}</button>
    </div><p class="muted small" style="text-align:center;margin:0" data-count></p>`;
  const box = root.querySelector('[data-deck]');
  const spoiler = !!ctx.ui.settings.spoilerFree;

  async function refill() {
    if (queue.length > 4) return;
    const more = await ctx.store.deck(deck.ast, [...done, ...queue.map((v) => v.ck)], 30);
    queue.push(...more);
  }
  function counter() { root.querySelector('[data-count]').textContent = `Da vedere ${counts.plan} · già viste ${counts.completed} · non mi interessa ${counts.no} · saltate ${counts.skip}`; }
  function drawTop() {
    const v = queue[0];
    if (!v) { box.innerHTML = `<div class="empty" style="height:100%">${icon('check', 28)}<div>Mazzo finito. Bel lavoro!</div></div>`; return; }
    box.innerHTML = `<article class="dcard" data-card tabindex="0" aria-label="${e(v.name)}">
      <div class="poster">${icon('film', 40)}${v.poster ? `<span style="position:absolute;inset:0"><img src="${e(v.poster)}" alt="" referrerpolicy="no-referrer"></span>` : ''}</div>
      <span class="stamp l">NO</span><span class="stamp r">DA VEDERE</span><span class="stamp u">GIÀ VISTA</span>
      <div class="info"><div class="between"><b style="font-size:18px">${e(v.name)}</b>${v.score ? `<span class="stars">★ ${e(v.score)}</span>` : ''}</div>
        <span class="muted small">${e([v.year, (v.genreLabels || []).join(', '), v.seasons ? `${v.seasons} stagioni` : '', v.hours ? `circa ${Math.round(v.hours)} ore` : ''].filter(Boolean).join(' · '))}</span>
        ${v.why?.[0] ? `<span class="why s-match small">${e(v.why[0])}</span>` : ''}
        ${v.plot && !(spoiler && v.spoiler) ? `<span class="muted small" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${e(v.plot)}</span>` : ''}
        <div>${statusBadge(v.status)}</div></div></article>`;
    bindDrag(box.querySelector('[data-card]'));
  }
  async function act(kind) {
    const v = queue[0];
    if (!v && kind !== 'undo') return;
    if (kind === 'undo') {
      const step = await undo();
      if (!step) { toast('Niente da annullare', ''); return; }
      const ck = step.changes[0]?.key;
      await ctx.store.changed(true);
      if (ck && done.has(ck)) { done.delete(ck); counts = { plan: 0, completed: 0, no: 0, skip: 0, ...counts }; const [back] = await ctx.store.views([ck]); if (back) queue.unshift({ ...back, genreLabels: back.genreLabels }); }
      toast('Annullato', 'ok'); drawTop(); return;
    }
    const card = box.querySelector('[data-card]');
    if (card) { card.style.transform = { no: 'translateX(-130%) rotate(-12deg)', plan: 'translateX(130%) rotate(12deg)', seen: 'translateY(-130%)', skip: 'translateY(130%)' }[kind]; card.style.opacity = '0'; }
    queue.shift(); done.add(v.ck);
    if (kind === 'plan') { await setOverlay(v.ck, { status: 'plan' }, { label: 'Da vedere' }); counts.plan++; }
    if (kind === 'seen') { await setOverlay(v.ck, { status: 'completed' }, { label: 'Già vista' }); counts.completed++; }
    if (kind === 'no') { await notInterested(v.ck, 'Scorri'); counts.no++; }
    if (kind === 'skip') { await bumpSkip(v.ck); counts.skip++; }
    counter(); ctx.store.changed();
    setTimeout(async () => { await refill(); drawTop(); }, 180);
  }
  function bindDrag(card) {
    let sx = 0; let sy = 0; let on = false;
    card.addEventListener('pointerdown', (ev) => { on = true; sx = ev.clientX; sy = ev.clientY; card.setPointerCapture(ev.pointerId); card.style.transition = 'none'; });
    card.addEventListener('pointermove', (ev) => {
      if (!on) return;
      const dx = ev.clientX - sx; const dy = ev.clientY - sy;
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 20}deg)`;
      card.querySelector('.stamp.l').style.opacity = String(Math.max(0, -dx / 120));
      card.querySelector('.stamp.r').style.opacity = String(Math.max(0, dx / 120));
      card.querySelector('.stamp.u').style.opacity = String(Math.max(0, -dy / 120));
    });
    card.addEventListener('pointerup', (ev) => {
      if (!on) return; on = false; card.style.transition = '';
      const dx = ev.clientX - sx; const dy = ev.clientY - sy;
      if (dx > 110) return act('plan');
      if (dx < -110) return act('no');
      if (dy < -110) return act('seen');
      if (dy > 110) return act('skip');
      card.style.transform = ''; card.querySelectorAll('.stamp').forEach((s) => { s.style.opacity = '0'; });
      if (Math.abs(dx) + Math.abs(dy) < 5) ctx.nav('serie/' + encodeURIComponent(queue[0].ck));
    });
  }
  const onKey = (ev) => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.querySelector('.modal-bg')) return;
    const k = { ArrowLeft: 'no', ArrowRight: 'plan', ArrowUp: 'seen', ArrowDown: 'skip' }[ev.key];
    if (k) { ev.preventDefault(); act(k); }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.stopImmediatePropagation(); act('undo'); }
  };
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('click', (ev) => { const b = ev.target.closest('[data-act-s]'); if (b) act(b.dataset.actS); });
  await refill(); drawTop(); counter();
  return () => document.removeEventListener('keydown', onKey, true);
}
