# Note sul sito del catalogo

Streaming Community non ha un'API pubblica e cambia dominio spesso. L'adattatore (`src/catalog/sc/adapter.js`) si corregge da **Impostazioni › Avanzate** senza nuovo codice.

## Verificato sul sito reale (19 novembre 2026, sola lettura: archivio e una scheda)

- App Laravel + Inertia + Vue. L'HTML grezzo contiene il JSON della pagina nell'attributo `data-page` di `#app`; **dopo l'avvio di Vue l'attributo sparisce dal DOM** e i dati restano solo in `#app.__vue_app__.config.globalProperties.$page` (mondo della pagina). Per questo:
  - il collegamento dalla scheda rilegge l'HTML grezzo dello stesso indirizzo se l'attributo non c'è;
  - la raccolta passiva usa un piccolo script nel mondo della pagina (`src/content/bridge.js`) che passa i titoli al content script.
- **Archivio** `/{lang}/archive?type=tv` (HTML): componente `Titles/Browse`, props `titles` (60), `totalCount` (5025 serie il 19/11/2026), `browseMoreApiRoute`, `genres`, `countries`, `sortBy`. Il parametro `offset` nell'HTML è ignorato.
- **Elenco paginato JSON** (quello che usa «carica altri»): `GET /{lang}/archive?lang=it&type=tv&page=N` con intestazioni `X-Requested-With: XMLHttpRequest` e `Accept: application/json`. Risponde con un paginatore Laravel: `current_page`, `data` (60 titoli), `last_page` (84), `per_page`, `from`, `to`, `total`. Senza quelle intestazioni la stessa URL restituisce l'HTML.
- Campi dell'elenco: `id`, `slug`, `name`, `type`, `score` (stringa o null), `sub_ita`, `last_air_date`, `last_air_date_it`, `age`, `seasons_count`, `images[]` (`filename`, `type`: poster, cover, background, logo, cover_mobile), `translations`.
- Immagini: `https://cdn.<dominio>/images/<filename>`.
- **Scheda** `/{lang}/titles/{id}-{slug}`: componente `Titles/Title`, props `title`, `loadedSeason`, `sliders` (`related`, `genre`), `genres`. In `title`: `tmdb_id`, `imdb_id`, `original_name`, `original_language`, `status`, `runtime`, `plot`, `release_date`, `sub_ita`, `dub_ita`, `seasons[]` (`number`, `episodes_count`, `release_date`), `trailers[]` (`youtube_id`), `genres[]`, `keywords`, `main_actors`, `main_directors`, `created_by`, e gli ID dei servizi legali `netflix_id`, `prime_id`, `disney_id`, `now_id`, `apple_id`, `paramount_id`, `hbo_id`.
- Non esiste `/api/archive`: il modo «auto» prova il JSON paginato, poi l'HTML (che però dà solo la prima pagina, quindi una scansione così resta parziale e non segna mai titoli come spariti).

## Valori predefiniti di BingeMap (Impostazioni › Avanzate)

Strategia `auto`, percorso JSON `/{lang}/archive`, parametro `page`, 60 per pagina, filtro `type=tv`, pausa 1,5 s tra le pagine. Una scansione completa sono circa 85 richieste (2–3 minuti); i dettagli una richiesta per serie.

## Regole che non cambiano

Sola lettura, una richiesta alla volta, pausa minima 800 ms, stop su 403/429/CAPTCHA, nessun aggiramento di blocchi, mai il player o i video.
