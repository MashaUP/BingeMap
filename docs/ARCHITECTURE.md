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
