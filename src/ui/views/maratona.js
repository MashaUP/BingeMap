// Pianificatore di maratona (funzione 4).
import { e, statusBadge } from '../components.js';
import { icon } from '../icons.js';
import { planMarathon } from '../../library/planner.js';
import { saveSettings } from '../../common/settings.js';
import { nextUpList } from '../../library/data.js';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

export async function render(root, { params }, ctx) {
  const { store, ui } = ctx;
  const hours = Number(params.get('ore')) || ui.settings.hoursPerWeek || 6;
  const wd = (params.get('giorni') || '0,1,2,3,4,5,6').split(',').map(Number).filter((n) => n >= 0 && n <= 6);
  const what = params.get('cosa') || 'prossime';
  const nu = await nextUpList();
  let cks = nu.map((o) => o.ck);
  if (what === 'corso' || !cks.length) {
    const r = await store.query({ ast: { all: [{ field: 'status', any: ['watching'] }] }, sort: 'reco', limit: 20 });
    cks = what === 'corso' ? r.allCks.slice(0, 20) : [...cks, ...r.allCks.filter((x) => !cks.includes(x))].slice(0, 10);
  }
  const views = await store.views(cks);
  const items = views.map((v) => ({ ck: v.ck, name: v.name, status: v.status, poster: v.poster, epRuntime: v.epRuntime,
    leftMin: v.progress?.leftMin ?? (v.hours != null ? Math.round(v.hours * 60) : null), pos: v.progress?.pos || null, leftEp: v.progress?.leftEp ?? v.episodes }));
  const plan = planMarathon(items, { hoursPerWeek: hours, weekdays: wd });
  const fd = (t) => new Date(t).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
  const href = (patch) => { const p = new URLSearchParams({ ore: hours, giorni: wd.join(','), cosa: what, ...patch }); return `#/maratona?${p}`; };
  root.innerHTML = `
  <header><h1>Pianifica la maratona</h1><p class="muted" style="margin:4px 0 0">Dimmi quanto tempo hai: ti dico quando finisci ${what === 'corso' ? 'le serie in corso' : 'le prossime 5'} e in che ordine.</p></header>
  <section class="panel row" style="gap:16px 28px">
    <label class="field" style="max-width:200px">Ore a settimana<input type="number" min="1" max="80" step="0.5" value="${hours}" data-h></label>
    <div class="col" style="gap:6px"><span class="lbl">Giorni in cui guardi</span><div class="row" style="gap:6px">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="chip ${wd.includes(d) ? 'on' : ''}"><input type="checkbox" value="${d}" ${wd.includes(d) ? 'checked' : ''} data-d hidden>${DAYS[d]}</label>`).join('')}</div></div>
    <div class="col" style="gap:6px"><span class="lbl">Cosa</span><div class="row" style="gap:6px"><a class="chip ${what === 'prossime' ? 'on' : ''}" href="${href({ cosa: 'prossime' })}">Le prossime 5</a><a class="chip ${what === 'corso' ? 'on' : ''}" href="${href({ cosa: 'corso' })}">In corso</a></div></div>
  </section>
  ${plan.items.length ? `<section class="panel col">
    <div class="between"><h2 style="font-size:18px">Finisci tutto ${plan.end ? `il <b>${fd(plan.end)}</b>` : ''}</h2><span class="muted">${Math.round(plan.totalMin / 60)} ore in tutto · circa ${plan.perDay} minuti nei giorni scelti</span></div>
    ${plan.items.map((it, i) => `<a class="calitem" href="#/serie/${encodeURIComponent(it.ck)}" style="border-top:1px solid var(--line);padding:10px 0">
      <span class="h" style="width:28px;font-size:20px">${i + 1}</span><span class="thumb">${it.poster ? `<img src="${e(it.poster)}" alt="" referrerpolicy="no-referrer">` : ''}</span>
      <span class="col" style="gap:2px;flex:1"><b>${e(it.name)}</b><span class="muted small">${it.pos ? `da S${it.pos.s}E${it.pos.e + 1} · ` : ''}${Math.round(it.leftMin / 60 * 10) / 10} ore${it.leftEp ? ` · ${it.leftEp} episodi` : ''}</span></span>
      <span class="col small" style="align-items:flex-end;gap:2px"><span>${fd(it.startAt)} → <b>${fd(it.endAt)}</b></span><span class="muted">${it.days} giorni</span></span></a>`).join('')}
    ${plan.unknown.length ? `<p class="muted small" style="margin:0">${plan.unknown.length} serie senza durata nota: inserisci la chiave TMDB o segna gli episodi visti.</p>` : ''}
  </section>` : `<div class="empty">${icon('route', 28)}<div>Aggiungi qualche serie alle prossime 5 (segnalibro sulle copertine) o segnane una come «In corso».</div></div>`}`;
  const go = async () => {
    const h = Number(root.querySelector('[data-h]').value) || 6;
    const days = [...root.querySelectorAll('[data-d]:checked')].map((x) => x.value).join(',') || '0,1,2,3,4,5,6';
    await saveSettings({ hoursPerWeek: h });
    ctx.nav(`maratona?ore=${h}&giorni=${days}&cosa=${what}`);
  };
  root.querySelector('[data-h]').addEventListener('change', go);
  root.querySelectorAll('[data-d]').forEach((x) => x.addEventListener('change', go));
  void statusBadge;
}
