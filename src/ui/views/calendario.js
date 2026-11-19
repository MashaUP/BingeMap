// Calendario «In arrivo» (funzione 2) con esportazione .ics, e rinnovi/cancellazioni recenti (funzione 3).
import { e, download, statusBadge } from '../components.js';
import { icon } from '../icons.js';
import { toIcs } from '../../common/ics.js';
import { STATUS_IT } from '../../library/alerts.js';
import { fmtDate } from '../../common/util.js';

export async function render(root, { params }, ctx) {
  const { store, ui } = ctx;
  const all = params.get('tutte') === '1';
  const days = Number(params.get('giorni')) || 90;
  const [items, renewals] = await Promise.all([store.calendar({ days, onlyMine: !all }), store.renewals()]);
  const byDay = new Map();
  for (const it of items) { if (!byDay.has(it.date)) byDay.set(it.date, []); byDay.get(it.date).push(it); }
  const dayLabel = (iso, inDays) => {
    const d = new Date(iso + 'T12:00:00');
    const rel = inDays === 0 ? 'Oggi' : inDays === 1 ? 'Domani' : inDays === -1 ? 'Ieri' : null;
    return `<b>${rel || d.toLocaleDateString('it-IT', { weekday: 'long' })}</b><div class="muted small">${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}</div>`;
  };
  root.innerHTML = `
  <header class="between"><div><h1>In arrivo</h1><p class="muted" style="margin:4px 0 0">Prossimi episodi e nuove stagioni ${all ? 'di tutto il catalogo' : 'delle serie che segui: in corso, in pausa, da vedere, monitorate'}.</p></div>
    <div class="row"><a class="chip ${all ? '' : 'on'}" href="#/calendario">Le mie serie</a><a class="chip ${all ? 'on' : ''}" href="#/calendario?tutte=1">Tutto il catalogo</a>
    <button class="btn" data-ics ${items.length ? '' : 'disabled'}>${icon('download', 16)}Esporta nel calendario (.ics)</button></div></header>
  ${!ui.settings.tmdbKey ? `<div class="notice warn">${icon('alert')}<div>Date ed episodi vengono da TMDB: inserisci la tua chiave in <a href="#/impostazioni/servizi">Impostazioni › Servizi</a> e aggiorna i metadati da <a href="#/attivita">Attività</a>.</div></div>` : ''}
  ${renewals.length ? `<section class="panel col"><h2 style="font-size:16px">${icon('refresh', 16)} Rinnovi, conclusioni e cancellazioni</h2>
    ${renewals.map((r) => `<a class="between" href="#/serie/${encodeURIComponent(r.ck)}" style="color:var(--text);text-decoration:none"><span><b>${e(r.name)}</b> <span class="muted">${e(STATUS_IT[r.from] || r.from)} → </span><b style="color:${r.to === 'Canceled' ? 'var(--danger)' : 'var(--match)'}">${e(STATUS_IT[r.to] || r.to)}</b></span><span class="row small muted" style="gap:8px">${statusBadge(r.status)} ${fmtDate(r.date)}</span></a>`).join('')}</section>` : ''}
  <section class="panel">${items.length ? [...byDay.entries()].map(([d, list]) => `<div class="calday"><div>${dayLabel(d, list[0].inDays)}</div><div class="col" style="gap:2px">${list.map((it) => `
      <a class="calitem" href="#/serie/${encodeURIComponent(it.ck)}"><span class="thumb">${it.poster ? `<img src="${e(it.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>
      <span class="col" style="gap:2px"><b>${e(it.name)}</b><span class="muted small">${it.s != null ? `Stagione ${it.s}${it.e != null ? `, episodio ${it.e}` : ''}` : ''}${it.kind === 'premiere' ? ' · <span class="s-match">nuova stagione</span>' : ''}${it.epName ? ` · ${e(it.epName)}` : ''}</span></span>
      <span style="margin-left:auto">${statusBadge(it.status)}</span></a>`).join('')}</div></div>`).join('')
    : `<div class="empty">${icon('calendar', 28)}<div>Nessuna uscita nei prossimi ${days} giorni${all ? '' : ' per le serie che segui'}.</div></div>`}</section>`;
  root.querySelector('[data-ics]')?.addEventListener('click', () => {
    download(`bingemap-in-arrivo-${new Date().toISOString().slice(0, 10)}.ics`, toIcs(items), 'text/calendar');
    ctx.toast('Calendario esportato: aprilo con Google Calendar, Apple Calendario o Outlook', 'ok');
  });
}
