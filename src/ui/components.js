// Componenti dell'interfaccia (HTML con escape) e piccole utilità DOM.
import { escapeHtml as e, fmtDec } from '../common/util.js';
import { icon } from './icons.js';
import { STATUS_LABEL, STATUS_CLASS } from '../library/status.js';

export { e };

export function statusBadge(st, extra = '') {
  return `<span class="st ${STATUS_CLASS[st] || ''}"><span class="dot"></span>${e(STATUS_LABEL[st] || st)}${extra}</span>`;
}

export function stars(score) {
  if (score == null) return '';
  return `<span class="stars">${icon('star', 12)}${fmtDec(score, 1)}</span>`;
}

export function poster(v, size = '') {
  const img = v.poster ? `<img src="${e(v.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
  return `<div class="poster ${size}">${icon('film', 28)}${img ? `<span style="position:absolute;inset:0">${img}</span>` : ''}</div>`;
}

export function card(v, opts = {}) {
  const meta = [v.year, v.genreLabels.join(', '), v.seasons ? `${v.seasons} st.` : null].filter(Boolean).join(' · ');
  const flag = v.newSeason ? 'Nuova stagione' : v.endedNow ? 'Ora conclusa' : v.pendingMatch ? 'Da confermare' : v.conflict ? 'Conflitto' : '';
  const tags = (v.tags || []).map((t) => `<span class="tag">${e(t)}</span>`).join('');
  const why = opts.why && v.why?.length ? `<div class="why">${icon('sparkles', 14)}<span>${e(v.why[0])}</span></div>` : '';
  const hidden = opts.hideTitle;
  return `<article class="card tcard" data-open="${e(v.ck)}" tabindex="0" aria-label="${hidden ? 'Titolo nascosto' : e(v.name)}">
    <div class="poster ${hidden ? 'reveal' : ''}">${icon('film', 28)}${v.poster ? `<span style="position:absolute;inset:0"><img src="${e(v.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>` : ''}
      <span class="badge ${STATUS_CLASS[v.status]}"><span class="dot"></span>${e(STATUS_LABEL[v.status])}</span>
      ${flag ? `<span class="flag">${e(flag)}</span>` : ''}
    </div>
    <button class="mark ${v.nextUp ? 'on' : ''}" type="button" data-act="nextup" data-ck="${e(v.ck)}" aria-label="${v.nextUp ? 'Togli dalle prossime 5' : 'Aggiungi alle prossime 5'}">${icon('bookmark', 16)}</button>
    <div style="padding:0 4px 4px;display:flex;flex-direction:column;gap:4px">
      <div class="t ${hidden ? 'reveal' : ''}">${e(v.name)}</div>
      <div class="m">${e(meta)}</div>
      ${why}
      <div class="between" style="gap:6px"><div class="row" style="gap:4px">${tags}${v.subIta ? '<span class="tag">Sub-ITA</span>' : ''}</div>${stars(v.score)}</div>
    </div>
  </article>`;
}

export function cards(list, opts = {}) {
  if (!list.length) return `<div class="empty">${icon('search', 28)}<div>${e(opts.empty || 'Nessuna serie trovata con questi filtri.')}</div></div>`;
  return `<div class="cards">${list.map((v) => card(v, opts)).join('')}</div>`;
}

export function chip(label, { on = false, ex = false, act = '', data = {}, n = null, pressed = null } = {}) {
  const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${e(v)}"`).join(' ');
  return `<button type="button" class="chip ${on ? 'on' : ''} ${ex ? 'ex' : ''}" ${act ? `data-act="${act}"` : ''} ${attrs} aria-pressed="${pressed ?? (on || ex)}">${e(label)}${n != null ? ` <span class="n">${n}</span>` : ''}</button>`;
}

// --- Notifiche a comparsa
export function toast(msg, kind = '') {
  let box = document.querySelector('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 8000 : 4000);
}

// --- Finestre
export function modal(html, { onClose, wide = false } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="${wide ? 'width:min(980px,100%)' : ''}">${html}</div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = (ev) => { if (ev.key === 'Escape') close(); };
  bg.addEventListener('click', (ev) => { if (ev.target === bg || ev.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', esc);
  document.body.appendChild(bg);
  setTimeout(() => bg.querySelector('input,button,select,textarea')?.focus(), 30);
  return { el: bg.querySelector('.modal'), close };
}

export function confirmBox(text, okLabel = 'Conferma', danger = false) {
  return new Promise((resolve) => {
    const m = modal(`<h2>${e(text)}</h2><div class="row" style="justify-content:flex-end"><button class="btn" data-close>Annulla</button><button class="btn ${danger ? 'danger' : 'p'}" data-ok>${e(okLabel)}</button></div>`, { onClose: () => resolve(false) });
    m.el.querySelector('[data-ok]').addEventListener('click', () => { resolve(true); m.close(); });
  });
}

export function promptBox(title, value = '', label = '') {
  return new Promise((resolve) => {
    const m = modal(`<h2>${e(title)}</h2><label class="field">${e(label)}<input type="text" value="${e(value)}"></label><div class="row" style="justify-content:flex-end"><button class="btn" data-close>Annulla</button><button class="btn p" data-ok>OK</button></div>`, { onClose: () => resolve(null) });
    const inp = m.el.querySelector('input');
    const ok = () => { const v = inp.value.trim(); resolve(v || null); m.close(); };
    m.el.querySelector('[data-ok]').addEventListener('click', ok);
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ok(); });
  });
}

// --- File
export function download(name, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.onchange = () => resolve([...inp.files]);
    inp.click();
  });
}

export function fileWrap(f) {
  return { name: f.webkitRelativePath || f.name, text: () => f.text(), bytes: async () => new Uint8Array(await f.arrayBuffer()) };
}

export function busy(btn, on, label = null) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; if (label) btn.textContent = label; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}
