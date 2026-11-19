// Popup dell'estensione: stato della pagina aperta, collegamento del sito, scansione, prossime 5.
import { icon, logo } from './icons.js';
import { e, statusBadge } from './components.js';
import { loadSettings } from '../common/settings.js';
import { getLinks } from '../common/links.js';
import { checkUpdate } from '../common/update.js';
import { send, kv, originPattern } from '../platform/platform.js';
import { setProfile, getAll, get } from '../db/db.js';
import { fmtDate, fmtNum } from '../common/util.js';
import { SOURCES } from '../import/sources.js';
import { setLang, translateTree } from './i18n.js';

const pop = document.getElementById('pop');
const app = (hash = '') => chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/app.html' + (hash ? '#' + hash : '')) });

async function main() {
  setProfile(await kv.get('activeProfile', 'default'));
  const [s, L, [tab]] = await Promise.all([loadSettings(), getLinks(), chrome.tabs.query({ active: true, currentWindow: true })]);
  document.documentElement.dataset.theme = s.theme === 'light' ? 'light' : 'dark';
  setLang(s.lang);
  document.documentElement.dataset.contrast = s.contrast === 'high' ? 'high' : 'normal';
  const url = tab?.url || '';
  let origin = null; try { const u = new URL(url); if (/^https?:$/.test(u.protocol)) origin = u.origin; } catch { /* pagina interna */ }
  const onSite = origin && s.sc.origin === origin;
  const idMatch = url.match(/\/titles\/(\d+)/);
  const [job, snaps, overlay, badgeNew] = await Promise.all([send('scan.active').catch(() => null), getAll('catalog_snapshots'), getAll('overlay'), kv.get('badgeNew', 0)]);
  const last = snaps.filter((x) => x.kind !== 'package').sort((a, b) => b.date - a.date)[0];
  const next = overlay.filter((o) => o.nextUp != null).sort((a, b) => a.nextUp - b.nextUp);
  const nextNames = await Promise.all(next.map(async (o) => (await get('catalog_titles', o.ck))?.name || o.ck));

  let pageBlock = '';
  if (onSite && idMatch) {
    const t = await send('site.title', { siteId: idMatch[1] }).catch(() => null);
    pageBlock = t ? `<div class="lbl">Su questa pagina</div>
      <div class="card row" style="padding:12px;align-items:flex-start;gap:12px">
        <div style="width:64px">${t.poster ? `<div class="poster"><img src="${e(t.poster)}" alt="" referrerpolicy="no-referrer"></div>` : `<div class="poster">${icon('film', 18)}</div>`}</div>
        <div class="col" style="gap:5px;min-width:0"><b>${e(t.name)}</b><span class="muted small">${e([t.year, t.genres.slice(0, 2).join(', '), t.seasons ? `${t.seasons} stagioni` : ''].filter(Boolean).join(' · '))}</span>
          ${statusBadge(t.status, Object.keys(t.statusBySource).length ? ' · ' + Object.keys(t.statusBySource).map((x) => SOURCES[x] || x).join(' e ') : '')}
          <div class="row" style="gap:4px">${t.tags.slice(0, 3).map((x) => `<span class="tag imp">${e(x)}</span>`).join('')}</div></div></div>
      <div class="grid g2" style="gap:8px"><button class="btn sm" data-watched="${e(t.ck)}" data-st="${e(t.status)}">${icon(t.status === 'completed' ? 'eye' : 'check', 14)}${t.status === 'completed' ? 'Segna non vista' : 'Segna vista'}</button>
        <button class="btn sm" data-next="${e(t.ck)}" data-on="${t.nextUp ? 1 : 0}">${icon('bookmark', 14)}${t.nextUp ? 'Togli dalle 5' : 'Prossime 5'}</button></div>
      <button class="btn sm" data-detail="${e(t.ck)}">${icon('external', 14)}Apri in BingeMap</button>`
      : '<div class="muted small">Questo titolo non è ancora nel catalogo di BingeMap: avvia una scansione o sfoglia il sito.</div>';
  } else if (origin && !onSite) {
    pageBlock = `<div class="lbl">Questa scheda</div><p class="muted small" style="margin:0">${s.sc.origin ? `Il sito collegato è ${e(s.sc.origin)}. Se ha cambiato indirizzo, collega questo.` : 'Se questa è la pagina dell\'archivio di Streaming Community, collegala.'}</p>
      <button class="btn p" data-connect>${icon('link', 16)}Usa questa scheda</button><div class="small" data-msg></div>`;
  }

  pop.innerHTML = `<header><span class="row" style="gap:10px">${logo(28)}<b class="h" style="font-size:18px">Binge<span style="color:var(--primary-text)">Map</span></b></span><button class="btn sm" data-open>Apri ${icon('external', 14)}</button></header>
    <section>
      ${pageBlock}
      ${pageBlock ? '<div style="height:1px;background:var(--line)"></div>' : ''}
      <div class="col small" style="gap:8px">
        <div class="between"><span class="muted">Catalogo</span><span class="${last?.complete ? 's-match' : 's-unk'}">${job ? `${job.status === 'paused' ? 'In pausa' : 'Scansione in corso'} · ${fmtNum(job.titlesFound || job.done || 0)}` : last ? `${last.complete ? 'Completo' : 'Parziale'} · ${fmtDate(last.date, true)}` : 'Nessuna scansione'}</span></div>
        <div class="between"><span class="muted">Novità</span><span>${badgeNew ? `+${fmtNum(badgeNew)} serie` : 'Nessuna'}</span></div>
        <div class="between"><span class="muted">Le prossime 5</span><span style="text-align:right">${nextNames.length ? e(nextNames.slice(0, 2).join(', ')) + (nextNames.length > 2 ? ` +${nextNames.length - 2}` : '') : '—'}</span></div>
      </div>
      <button class="btn" data-scan ${s.sc.origin && !job ? '' : 'disabled'}>${icon('refresh', 16)}Aggiorna il catalogo</button>
      <div class="row" style="gap:6px"><button class="btn sm" style="flex:1" data-go="/stasera?min=40">${icon('clock', 14)}Ho 40 minuti</button><button class="btn sm" style="flex:1" data-go="/calendario">${icon('calendar', 14)}In arrivo</button></div>
    </section>
    <footer><button class="btn sm" style="flex:1" data-update>${icon('refresh', 14)}Cerca aggiornamento</button><a class="ibtn" href="${e(L.kofi)}" target="_blank" rel="noopener" aria-label="Ko-fi">${icon('heart', 16)}</a><a class="ibtn" href="${e(L.discord)}" target="_blank" rel="noopener" aria-label="Discord">${icon('chat', 16)}</a></footer>`;

  cur = { tab, url, origin };
  translateTree(pop);
}

let cur = {};
pop.addEventListener('click', async (ev) => {
    const { tab, url, origin } = cur;
    const b = ev.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-open')) return app('/scopri');
    if (b.dataset.go) return app(b.dataset.go);
    if (b.dataset.detail) return app('/serie/' + encodeURIComponent(b.dataset.detail));
    if (b.hasAttribute('data-scan')) { await send('scan.start', { kind: 'sc-list', mode: 'update' }); return app('/attivita'); }
    if (b.hasAttribute('data-update')) { const u = await checkUpdate(); b.textContent = u.error ? 'Controllo non riuscito' : u.available ? `Nuova versione ${u.latest}` : 'Sei aggiornato'; if (u.available) app('/impostazioni/info'); return; }
    if (b.dataset.watched) { await send('overlay.set', { ck: b.dataset.watched, patch: { status: b.dataset.st === 'completed' ? 'none' : 'completed' } }); return main(); }
    if (b.dataset.next) { try { await send('nextup.set', { ck: b.dataset.next, on: b.dataset.on !== '1' }); } catch (err) { alertMsg(err.message); } return main(); }
    if (b.hasAttribute('data-connect')) {
      // La richiesta di permesso deve partire dal clic dell'utente.
      const ok = await chrome.permissions.request({ origins: [originPattern(origin)] });
      const msg = pop.querySelector('[data-msg]');
      if (!ok) { msg.innerHTML = '<span class="s-drop">Permesso non concesso.</span>'; return; }
      try {
        const r = await send('site.connect', { tabId: tab.id, url });
        msg.innerHTML = `<span class="s-match">Collegato: trovate ${fmtNum(r.found)} serie in questa pagina. Ora avvia la scansione completa da Attività.</span>`;
        setTimeout(() => app('/attivita'), 1400);
      } catch (err) { msg.innerHTML = `<span class="s-drop">${e(err.message)}</span>`; }
    }
});

function alertMsg(t) { const d = document.createElement('div'); d.className = 'notice err small'; d.style.margin = '0 16px 12px'; d.textContent = t; pop.appendChild(d); }

main().catch((err) => { pop.innerHTML = `<section><div class="notice err">${e(err.message)}</div></section>`; });
