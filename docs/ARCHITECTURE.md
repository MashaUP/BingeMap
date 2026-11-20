# Architettura

Estensione Manifest V3 local-first, JavaScript a moduli ES senza build e senza dipendenze, IndexedDB come unico database. Lo stesso codice gira come app web (`web/`) tramite `src/platform/platform.js`.

## Parti

| Parte | File | Compito |
| --- | --- | --- |
| Service worker | `src/background/sw.js` | Scansioni, allarmi (aggiornamenti, sync, scansioni programmate, promemoria backup), notifiche, badge, messaggi |
| Content script | `src/content/site.js` | Solo sull'origine autorizzata: raccolta passiva dei titoli, badge sulle copertine |
| Dashboard | `src/ui/app.html` + `src/ui/views/*` | Tutta l'app |
| Popup | `src/ui/popup.*` | Pagina aperta, «Usa questa scheda», stato |
| Web Worker | `src/ui/worker.js` | Viste, filtri, conteggi, consigli in memoria |

## Moduli

`catalog/` adattatori (Streaming Community, fornitori TMDB) · `scan/` coda, area temporanea, promozione · `import/` lettori delle fonti, CSV, ZIP, Excel, SIMKL, pipeline · `match/` normalizzazione, punteggi, regole · `library/` stati, tag, viste, strato personale · `query/` motore, preset, linguaggio naturale · `recommend/` consigli spiegati · `metadata/` TMDB · `sync/` Google Drive · `backup/` backup, CSV, pacchetto catalogo · `common/` versione, link, aggiornamenti, impostazioni, diagnostica.

## Dati

Tre strati mai mescolati: catalogo (`catalog_*`, `scan_*`, `tmdb_cache`), libreria importata (`import_batches`, `library_raw`, `library_items`, `matches`), strato personale (`overlay`, `tags`, `tag_aliases`, `tag_rules`, `match_rules`, `saved_queries`, `diary`). Schema versionato in `src/db/db.js` con migrazioni numerate. Un database per profilo.

## Regole di integrità

- Le scansioni scrivono in `scan_staging`; la promozione è una transazione unica. Le parziali non segnano spariti; «gone» dopo 2 complete consecutive.
- Gli import sono una transazione unica con stato precedente salvato per l'annullamento.
- Le regole manuali di match e lo strato personale vincono sempre e non vengono sovrascritti.
- Sincronizzazione: vince il record con `updatedAt` più recente; cancellazioni tramite tombstones.

## Aggiunte della 1.1.0

- `src/library/progress.js` progresso per episodio · `src/library/alerts.js` calendario e rinnovi · `src/common/ics.js` esportazione `.ics` · `src/library/planner.js` maratona.
- `src/recommend/map.js` mappa: TF-IDF dei tratti → k vicini con indice invertito → layout a forze deterministico → zone con k-means; calcolata nel worker e tenuta in cache.
- `src/recommend/tonight.js` «Ho 40 minuti» · `src/library/wrapped.js` riepilogo annuale · `src/library/undo.js` annulla globale (ogni `setOverlay` salva il record precedente).
- `src/import/paste.js` lista incollata · Netflix in `src/import/sources.js` · `decodeBytes` in `src/import/csv.js` (UTF-8, UTF-16, Windows-1252).
- `src/library/search.js` ricerca veloce per menu del tasto destro e barra degli indirizzi (parola chiave `bm`).
- `src/content/bridge.js` script nel mondo della pagina (solo sull'origine autorizzata) che passa i titoli al content script: sul sito reale Vue toglie `data-page` dal DOM.
- `src/ui/i18n.js` interfaccia in inglese: dizionario applicato ai nodi di testo, con un osservatore per i contenuti aggiunti dopo.
- Tra schede: ogni modifica manda `data.changed` al service worker, che avvisa le altre pagine; queste ricaricano i dati senza rimandare l'avviso.

## Aggiunte della 1.2.0

- `src/library/universes.js` universi (prefisso di franchise + stessi autori con legame forte, union-find) · `src/library/classics.js` voto pesato e copertura · `src/library/timeline.js` · `src/library/world.js` con `assets/world.json` (Natural Earth 1:110m già proiettato, generato una volta con world-atlas e d3-geo, nessuna dipendenza a runtime).
- `src/import/anime.js` AniList (GraphQL pubblico, permesso di host chiesto al primo uso) e MyAnimeList (XML, anche gzip con `DecompressionStream`), anime della stagione.
- `src/backup/exports.js` CSV formato IMDb (senza BOM), CSV completo, XML MyAnimeList.
- Persone seguite in `settings.follows`; campi delle viste `openEnding`, `missingSeasons`, `followedPeople`, `anime`, `dubIta`.
- Alto contrasto: `html[data-contrast=high]` ridefinisce le variabili; testo più grande con `zoom` sulla radice.

## Test

`npm test` (75 test di unità, fake-indexeddb) e `npm run e2e` (95 controlli in Chrome con l'estensione estratta dallo zip del pacchetto, sito simulato con la struttura reale, axe-core, confronto con le immagini in `tests/e2e/baseline/`, ripresa della scansione dopo la chiusura del browser).

## Aggiunte della 1.3.0

- Riavvio: `restartExtension()` (`chrome.runtime.reload()`) dalla pagina, dal popup o dalla palette; `staleKind()` confronta la versione dei file con quella del service worker in esecuzione e mostra l'avviso. Un motore precedente alla 1.1.0 non risponde a `app.version` e viene trattato come vecchio.
- Lettura automatica: alla fine di ogni operazione lo scanner chiama `afterJob`; `nextAutoKind()` decide il passo successivo (elenco → schede → TMDB).
- Collegamento: prima i dati della pagina letti nel mondo della pagina (`executeScript` con `world: 'MAIN'`), poi l'HTML.
- Nota sui test: in Chrome automatizzato un'estensione caricata da riga di comando, dopo `runtime.reload()`, viene scaricata ma non ricaricata; il test verifica che il riavvio venga eseguito.

## Correzioni della 1.3.2 (audit)

- **Elenco a fette** (`scanner.runScList`, `sc.listSlices`): fetta 0 = prima pagina senza filtri (totale e novità); se l'elenco intero sta entro `pageLimit` si legge così, altrimenti una fetta per anno e per decennio, poi un'ultima passata senza filtri solo se mancano titoli. Cursore: `{ slices, slice, page, seen, unsliced, tailFrom }`. Il 503 «Page limit» chiude la fetta (`sc.pageLimitReached`), il 422 la salta, un filtro ignorato fa abbandonare le fette.
- **Elenchi da leggere fissati nel cursore** (`cursor.cks`) per schede e TMDB: la ripresa continua dallo stesso punto dello stesso elenco.
- **Operazioni senza doppioni**: `startJob` passa da un lucchetto; `resumeJob` prenota l'operazione in modo sincrono prima di ogni attesa; il service worker si avvia una volta sola (`init()` restituisce sempre la stessa promessa) e i messaggi che toccano i dati la aspettano.
- **Schede come dati Inertia** (`sc.inertiaHeaders`, `sc.pageVersion`): versione imparata al collegamento o dalla prima pagina HTML, 409 → HTML.
- **Collegamento**: il popup legge i dati della pagina prima di chiedere il permesso e lascia la richiesta in `chrome.storage.session` (`pendingConnect`); `permissions.onAdded` nel motore la completa se il popup si è chiuso. `site.connect` è unico per sito (`connecting`).
- **Impostazioni salvate in una sola transazione** (`saveSettings` con `atomic`).
- **Controllo statico**: `eslint.config.js`, `npm run lint`; `npm run check` e la release automatica lo eseguono.
