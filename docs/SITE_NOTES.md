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
- **Scheda** `/{lang}/titles/{id}-{slug}`: componente `Titles/Title`, props `title`, `loadedSeason`, `sliders` (`related`, `genre`), `genres`. In `title`: `tmdb_id`, `imdb_id`, `original_name`, `original_language`, `status`, `runtime`, `plot`, `release_date`, `sub_ita`, `dub_ita`, `seasons[]` (`number`, `episodes_count`, `release_date`), `trailers[]` (`youtube_id`), `genres[]`, `keywords`, `main_actors`, `main_directors` (elenchi di oggetti con `name`), `created_by` (attenzione: è il numero dell'utente del sito che ha caricato il titolo, non gli autori), e gli ID dei servizi legali `netflix_id`, `prime_id`, `disney_id`, `now_id`, `apple_id`, `paramount_id`, `hbo_id`.
- **Limite di 20 pagine per elenco** (verificato il 20/11/2026): `page=21` risponde **503** con il corpo JSON `"Page limit reached (20)"`. Con 60 titoli per pagina un elenco arriva a 1 200 titoli, mentre le serie sono 5 027 (`last_page` dichiara 84). Fino alla 1.3.1 BingeMap trattava quel 503 come un blocco del sito e la scansione restava parziale.
- **Filtro `year`**: `&year=2024` restringe l'elenco a quell'anno (485 serie). Valori accettati: gli anni dal 2000 a oggi e i decenni prima (`year=1990` = anni '90), come nel menu «Anno» del sito; un valore fuori elenco risponde 422. La somma delle fette 2000–2026 più i decenni 1910–1990 è esattamente il totale (5 027), e nessuna fetta supera le 20 pagine (la più grande, il 2022, ne ha 12). Altri filtri: `genre[]=<id>`, `sort=name` (un `sort` sconosciuto risponde 422).
- Senza `type=tv` l'archivio conta 19 419 titoli (film compresi); anche `totalCount` nella pagina HTML dell'archivio senza filtri conta i film.
- **Scheda come dati Inertia**: la stessa URL della scheda con `X-Inertia: true` e `X-Inertia-Version: <versione>` risponde in JSON (`component`, `props`, `version`). Con `X-Inertia-Partial-Component: Titles/Title` e `X-Inertia-Partial-Data: title` arrivano solo i dati del titolo (~7,5 KB contro ~436 KB dell'HTML); con `title,sliders` anche i correlati (~195 KB). Se la versione non è quella attuale il sito risponde **409** con `X-Inertia-Location`. La versione sta nel campo `version` dei dati della pagina (`$page.version`).
- Nessuna parola di verifica (captcha, challenge) nell'HTML di una scheda normale.
- Non esiste `/api/archive`: il modo «auto» prova il JSON paginato, poi l'HTML (che però dà solo la prima pagina, quindi una scansione così resta parziale e non segna mai titoli come spariti).

## Valori predefiniti di BingeMap (Impostazioni › Avanzate)

Strategia `auto`, percorso JSON `/{lang}/archive`, parametro `page`, 60 per pagina, filtro `type=tv`, fette per `year`, limite 20 pagine, pausa 1,5 s tra le richieste. Una scansione completa sono circa 95 richieste: la prima pagina senza filtri (totale e novità), poi ogni anno, poi i decenni; un'ultima passata senza filtri solo se mancano titoli. Le schede: una richiesta per serie, come dati Inertia (`title,sliders`; senza correlati se disattivati), con ritorno all'HTML in caso di 409.

## Regole che non cambiano

Sola lettura, una richiesta alla volta, pausa minima 800 ms, stop su 403/429/CAPTCHA e sugli altri errori del sito (il 503 «Page limit» non è un blocco: segna la fine di una fetta), nessun aggiramento di blocchi, mai il player o i video.
