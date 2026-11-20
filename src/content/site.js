// Content script sul sito del catalogo (solo sull'origine autorizzata dall'utente).
// 1) Raccoglie passivamente i titoli che la pagina ha già caricato. 2) Mostra i badge sulle copertine.
// Sola lettura: non clicca, non invia moduli, non modifica nulla sul sito.
(() => {
  if (window.__bingemapLoaded) return;
  window.__bingemapLoaded = true;
  const VERSION = chrome.runtime.getManifest().version;

  const ENT = { '&quot;': '"', '&#039;': "'", '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' };
  // Dati passati dal ponte nel mondo della pagina (src/content/bridge.js).
  let bridged = null;
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__bingemap !== 'page') return;
    bridged = e.data.data;
    harvest();
  });
  window.postMessage({ __bingemap: 'ask' }, location.origin);
  function pageData() {
    if (bridged) return bridged;
    const el = document.querySelector('[data-page]');
    if (el) { try { return JSON.parse(el.getAttribute('data-page')); } catch (e) { /* formato inatteso */ } }
    const m = document.documentElement.innerHTML.match(/data-page="([^"]*)"/);
    if (m) { try { return JSON.parse(m[1].replace(/&(quot|#039|#39|lt|gt|amp);/g, (x) => ENT[x])); } catch (e) { /* ignora */ } }
    return null;
  }
  const isTitle = (o) => o && typeof o === 'object' && o.id != null && (typeof o.name === 'string' || typeof o.title === 'string') && ('slug' in o || 'seasons_count' in o || 'sub_ita' in o || 'score' in o);
  function collect(obj, depth = 0, out = []) {
    if (!obj || typeof obj !== 'object' || depth > 6) return out;
    if (Array.isArray(obj)) {
      const t = obj.filter(isTitle);
      if (t.length && t.length >= obj.length * 0.6) out.push(...t); else obj.forEach((x) => collect(x, depth + 1, out));
      return out;
    }
    if (isTitle(obj.title)) out.push(obj.title);
    Object.values(obj).forEach((v) => collect(v, depth + 1, out));
    return out;
  }

  let lastHarvest = '';
  function harvest() {
    const data = pageData();
    if (!data) return;
    const titles = collect(data);
    const sig = titles.map((t) => t.id).join(',');
    if (!titles.length || sig === lastHarvest) return;
    lastHarvest = sig;
    const slim = titles.slice(0, 500).map((t) => ({ id: t.id, slug: t.slug, name: t.name, title: t.title, type: t.type, score: t.score, sub_ita: t.sub_ita, last_air_date: t.last_air_date, seasons_count: t.seasons_count, release_date: t.release_date, images: t.images, genres: t.genres, tmdb_id: t.tmdb_id, imdb_id: t.imdb_id }));
    chrome.runtime.sendMessage({ type: 'site.harvest', titles: slim }).catch(() => {});
  }

  // Riconoscimento rigoroso delle card: link a /titles/<id>, con un'immagine, fuori da menu e intestazioni.
  function cards() {
    const out = new Map();
    for (const a of document.querySelectorAll('a[href*="/titles/"]')) {
      const m = a.getAttribute('href').match(/\/titles\/(\d+)/);
      if (!m) continue;
      if (a.closest('nav, header, footer, [role="dialog"], [role="menu"]')) continue;
      const img = a.querySelector('img') || a.parentElement?.querySelector('img');
      if (!img) continue;
      const r = img.getBoundingClientRect();
      if (r.width < 60 || r.height < 60) continue;
      // Il badge va su un contenitore a blocchi: un link "inline" non ha l'altezza della copertina.
      const box = getComputedStyle(a).display === 'inline' ? a.parentElement : a;
      if (!box) continue;
      if (!out.has(m[1])) out.set(m[1], []);
      out.get(m[1]).push(box);
    }
    return out;
  }

  async function badges() {
    const found = cards();
    if (!found.size) return;
    let res;
    try { res = await chrome.runtime.sendMessage({ type: 'site.status', ids: [...found.keys()] }); } catch (e) { return; }
    if (!res || res.__error) return;
    if (res.version && res.version !== VERSION) return outdated();
    if (!res.badges) return;
    for (const [id, boxes] of found) {
      const info = res.map[id];
      for (const box of boxes) {
        box.querySelectorAll(':scope > .bm-badge').forEach((b) => b.remove());
        box.classList.remove('bm-dim');
        if (!info) continue;
        if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `bm-badge bm-${info.status}`;
        b.title = 'Apri in BingeMap';
        b.textContent = info.label + (info.tags.length ? ' · ' + info.tags[0] : '') + (info.nextUp ? ' · ★' : '');
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); chrome.runtime.sendMessage({ type: 'open.detail', ck: info.ck }); });
        box.appendChild(b);
        if (res.hideCompleted && info.status === 'completed') box.classList.add('bm-dim');
      }
    }
  }

  function outdated() {
    if (document.getElementById('bm-outdated')) return;
    const d = document.createElement('div');
    d.id = 'bm-outdated';
    d.className = 'bm-toast';
    d.textContent = 'BingeMap è stato aggiornato: ricarica la pagina per vedere i badge.';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 8000);
  }

  // Dopo un riavvio o un aggiornamento di BingeMap questo script resta nella pagina ma non può più parlare con
  // l'estensione (chrome.runtime.sendMessage lancia «Extension context invalidated»): si spegne invece di dare errori.
  const alive = () => { try { return !!chrome.runtime?.id; } catch (e) { return false; } };
  let t = null; let obs = null;
  const run = () => {
    if (!alive()) { obs?.disconnect(); window.removeEventListener('popstate', run); return; }
    clearTimeout(t); t = setTimeout(() => { if (!alive()) return; try { harvest(); badges(); } catch (e) { /* contesto chiuso */ } }, 600);
  };
  run();
  const ours = (n) => n.nodeType === 1 && (n.classList.contains('bm-badge') || n.id === 'bm-outdated');
  obs = new MutationObserver((muts) => {
    const foreign = muts.some((m) => [...m.addedNodes, ...m.removedNodes].some((n) => !ours(n)));
    if (foreign) run();
  });
  obs.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', run);
  chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.__event && msg.kind === 'data') run(); });
})();
