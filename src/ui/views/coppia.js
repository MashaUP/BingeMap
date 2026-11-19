// Serata in due (idea 8): serie che nessuno dei due ha visto, incrociando due profili.
import { e, cards, toast } from '../components.js';
import { icon } from '../icons.js';
import { kv } from '../../platform/platform.js';
import { dbName, getAll, req } from '../../db/db.js';
import { matchAll } from '../../match/matcher.js';
import { discoveryCond } from '../../query/presets.js';

async function readOther(name, store) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name);
    r.onsuccess = async () => {
      const db = r.result;
      try {
        if (!db.objectStoreNames.contains(store)) { db.close(); return resolve([]); }
        const rows = await req(db.transaction(store).objectStore(store).getAll());
        db.close(); resolve(rows);
      } catch (err) { db.close(); reject(err); }
    };
    r.onerror = () => reject(r.error);
  });
}

export async function render(root, { params }, ctx) {
  const { store, ui } = ctx;
  const profiles = await kv.get('profiles', [{ id: 'default', name: 'Principale' }]);
  const active = await kv.get('activeProfile', 'default');
  const others = profiles.filter((p) => p.id !== active);
  const pick = params.get('con') || others[0]?.id;
  root.innerHTML = `<header><h1 class="row">${icon('users', 24)}Serata in due</h1><p class="muted" style="margin:4px 0 0">Serie del catalogo che non avete completato né tu né l'altro profilo.</p></header>
    ${others.length ? `<div class="row"><span class="lbl">Con</span>${others.map((p) => `<a class="chip ${p.id === pick ? 'on' : ''}" href="#/coppia?con=${e(p.id)}">${e(p.name)}</a>`).join('')}</div><div data-out><div class="muted">Calcolo…</div></div>`
      : `<div class="notice">${icon('info')}<div>Serve un secondo profilo con le liste dell'altra persona: crealo in <a href="#/impostazioni/profili">Impostazioni › Profili</a>, attivalo, importa le sue liste e torna qui dal tuo profilo.</div></div>`}`;
  if (!others.length) return;
  try {
    const [items, catalog] = await Promise.all([readOther(dbName(pick), 'library_items'), getAll('catalog_titles')]);
    const done = new Set();
    const live = items.filter((i) => !i.gone && ['completed', 'dropped'].includes(i.status));
    const res = matchAll(live, catalog.filter((c) => c.status !== 'gone'));
    for (const m of res) if (m.ck && m.state === 'auto') done.add(m.ck);
    const r = await store.query({ ast: { all: [discoveryCond(ui.settings.discovery)] }, sort: 'reco', limit: 400, withReco: true });
    const both = r.items.filter((v) => !done.has(v.ck)).slice(0, 48);
    root.querySelector('[data-out]').innerHTML = `<p class="muted" style="margin:0">L'altro profilo ha ${live.length} serie completate o abbandonate, ${done.size} riconosciute in questo catalogo.</p>${cards(both, { why: true, empty: 'Nessuna serie in comune da scoprire.' })}`;
  } catch (err) { toast(err.message, 'err'); }
}
