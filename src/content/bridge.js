// Ponte nel mondo della pagina (solo sull'origine autorizzata dall'utente).
// Sul sito reale i dati della pagina stanno nell'app Vue/Inertia e non più nell'attributo data-page:
// questo script li legge e passa al content script solo i campi dei titoli. Sola lettura.
(() => {
  if (window.__bingemapBridge) return;
  window.__bingemapBridge = true;
  const KEEP = ['id', 'slug', 'name', 'title', 'type', 'score', 'sub_ita', 'last_air_date', 'seasons_count', 'release_date', 'images', 'genres', 'tmdb_id', 'imdb_id'];
  const slim = (t) => { const o = {}; for (const k of KEEP) if (t && t[k] !== undefined) o[k] = t[k]; return o; };
  function current() {
    try {
      const app = document.querySelector('#app');
      const page = app && app.__vue_app__ && app.__vue_app__.config.globalProperties.$page;
      if (!page || !page.props) return null;
      const p = page.props;
      const props = {};
      if (Array.isArray(p.titles)) props.titles = p.titles.map(slim);
      if (p.title && typeof p.title === 'object') props.title = slim(p.title);
      if (Array.isArray(p.sliders)) props.sliders = p.sliders.map((s) => ({ name: s && s.name, titles: ((s && s.titles) || []).map(slim) }));
      return { component: page.component, props };
    } catch (e) { return null; }
  }
  function post() { const d = current(); if (d) window.postMessage({ __bingemap: 'page', data: d }, location.origin); }
  post();
  document.addEventListener('inertia:navigate', () => setTimeout(post, 300));
  window.addEventListener('message', (e) => { if (e.source === window && e.data && e.data.__bingemap === 'ask') post(); });
})();
