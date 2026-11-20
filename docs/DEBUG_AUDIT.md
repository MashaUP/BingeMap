# Audit di stabilità — BingeMap 1.3.2

Data: 20 novembre 2026. Punto di partenza: 1.3.1 (76 test di unità, 95 controlli end-to-end, tutti verdi).

## Sintesi

**Stato iniziale.** I test erano tutti verdi, ma i due flussi principali non funzionavano sul sito vero.
- **Collegamento del sito:** il pulsante «Usa questa scheda» del popup si interrompeva con un errore JavaScript subito dopo la richiesta del permesso. I test non se ne accorgevano perché chiamavano il motore direttamente, senza passare dal popup.
- **Scansione completa:** non poteva arrivare oltre 1.200 serie su 5.027. Il sito serve al massimo 20 pagine per elenco e BingeMap prendeva la risposta di limite per un blocco del sito.

Erano presenti anche:
- riprese che saltavano titoli;
- doppie esecuzioni della stessa scansione all'avvio del browser;
- perdite di impostazioni con salvataggi contemporanei;
- un campo del sito interpretato male (gli «autori»);
- piccoli guasti dell'interfaccia.

**Stato finale.**
- Tutti i guasti trovati sono corretti, ognuno con un test che lo riproduceva prima della correzione.
- I test di unità passano da 76 a 91, i controlli end-to-end da 95 a 99. Il nuovo controllo statico (ESLint) non segnala errori.
- La sequenza di richieste della nuova scansione, rifatta sul sito vero con lo stesso ritmo, ha raccolto **5.027 serie su 5.027** in 102 richieste: nessun errore e nessuna richiesta oltre il limite.

## Bug trovati

| # | Gravità | Componente | Titolo |
|---|---|---|---|
| C1 | Critica | popup | «Usa questa scheda» non collega niente |
| C2 | Critica | scanner, adattatore | La scansione completa si ferma a 1.200 serie |
| H1 | Alta | scanner | Le riprese di schede e TMDB saltano titoli |
| H2 | Alta | service worker, scanner | La stessa scansione gira due volte |
| H3 | Alta | popup, service worker | Collegamento perso se la finestra del permesso chiude il popup |
| M1 | Media | scanner | Schede lette dal dominio vecchio |
| M2 | Media | scanner, adattatore | Schede scaricate come pagina intera (~436 KB l'una) |
| M3 | Media | impostazioni | Salvataggi contemporanei si cancellano |
| M4 | Media | adattatore | «Autori» letti da un campo sbagliato |
| M5 | Media | service worker | La prima scansione conta tutto come «novità» |
| M6 | Media | content script | Errori a ripetizione sul sito dopo un riavvio |
| M7 | Media | interfaccia | Il riquadro dell'operazione in Attività si svuota |
| L1 | Bassa | vari | Codice morto, chiave i18n duplicata, escape inutili |

### C1 — «Usa questa scheda» non collega niente (Critica, `src/ui/popup.js`)
- **Causa:**
  - Nella 1.3.1 il gestore del clic usava la variabile `stale`, dichiarata solo dentro `main()`.
  - Dopo il permesso, il confronto `stale === 'restart'` lanciava `ReferenceError`.
  - Il collegamento non partiva e il popup non mostrava nessun messaggio. Lo screenshot di Andrea del 20/11 corrisponde: motore 1.3.1, «Nessuna scansione».
- **Correzione:**
  - Lo stato passa nel contesto del clic (`cur.stale`).
  - Il collegamento è diventato una funzione a parte, con il pulsante disattivato mentre lavora (niente doppio clic) e un messaggio «Collego…».
  - Il permesso si chiede solo se manca.
- **Verifica:**
  - Nuovo controllo end-to-end che apre il popup e clicca davvero il pulsante: «popup: “Usa questa scheda” collega il sito».
  - ESLint `no-undef` ora segnala questo tipo di errore e gira in `npm run check` e nella release automatica.

### C2 — La scansione completa si ferma a 1.200 serie (Critica, `src/scan/scanner.js`, `src/catalog/sc/adapter.js`)
- **Causa (verificata sul sito vero):**
  - `page=21` risponde **503** con il corpo JSON `"Page limit reached (20)"`, mentre il paginatore dichiara `last_page` 84.
  - `blockedReason` tratta ogni 5xx come un blocco: la scansione finiva «Bloccata dal sito» dopo 1.200 serie.
  - Le schede e TMDB non partivano mai, perché la catena automatica parte solo da una scansione completa.
  - Di conseguenza la ricerca e la scoperta non vedevano tre quarti del catalogo.
- **Correzione:** l'archivio si legge a fette, con il filtro `year` del sito.
  1. La prima pagina senza filtri dà il totale dichiarato e le novità. Se l'elenco intero sta entro il limite, si legge così.
  2. Poi una fetta per ogni anno dal 2000 e una per ogni decennio prima, come il menu «Anno» del sito.
  3. Infine una passata senza filtri, solo se mancano ancora titoli.
- **Casi particolari:**
  - Il 503 «Page limit» chiude la fetta e il limite indicato dal sito viene imparato.
  - Un 422 salta solo quella fetta.
  - Se il sito ignorasse il filtro (una fetta con lo stesso totale dell'elenco intero), le fette si abbandonano invece di rileggere l'elenco 36 volte.
  - Una fetta più grande del limite viene annotata, e la scansione resta parziale se il conteggio non torna.
  - Le operazioni avviate dalle versioni precedenti riprendono dalla loro pagina.
- **Verifica:**
  - **Test di unità** con un sito simulato che ha il limite e il filtro:
    - 1.600 serie lette, al massimo una richiesta oltre il limite;
    - fetta rifiutata;
    - pausa e ripresa a metà;
    - archivio piccolo senza fette;
    - filtro ignorato;
    - cursore vecchio.
  - **End-to-end:** il sito simulato ha un limite di 2 pagine e il filtro `year`. Scansione completa di 130 serie a fette, ripresa dopo la chiusura del browser.
  - **Sito vero:** stessa sequenza di URL, con 1,5 s tra le richieste, eseguita nella scheda: 5.027 su 5.027 in 102 richieste. Vedi `docs/SITE_NOTES.md` per i dati verificati.

### H1 — Le riprese di schede e TMDB saltano titoli (Alta, `src/scan/scanner.js`)
- **Causa:**
  - Alla ripresa, l'elenco dei titoli da leggere veniva ricalcolato.
  - I titoli già letti non ne facevano più parte, ma l'indice salvato si applicava all'elenco accorciato.
  - Il test lo ha dimostrato: pausa dopo 10 titoli su 30, poi ripresa, alla fine 20 schede lette.
- **Correzione:** l'elenco (`cursor.cks`) si fissa al primo avvio e si salva nel cursore. I titoli spariti nel frattempo si saltano.
- **Verifica:** test «H1: dettagli ripresi dopo una pausa».

### H2 — La stessa scansione gira due volte (Alta, `src/background/sw.js`, `src/scan/scanner.js`)
- **Causa:**
  - `init()` partiva sia dal livello superiore del service worker sia da `onInstalled`/`onStartup`.
  - Due `resumeInterrupted()` contemporanei superavano entrambi il controllo `running.has(id)`, perché il controllo e la prenotazione erano separati da un'attesa.
  - Risultato: doppie richieste al sito e cursore corrotto.
  - Inoltre `startJob` aveva la stessa finestra tra controllo e scrittura, e due content script venivano registrati in contemporanea.
- **Correzione:**
  - `init()` restituisce sempre la stessa promessa, e i messaggi che toccano i dati la aspettano (anche per il profilo attivo).
  - `resumeJob` prenota l'operazione in modo sincrono prima di ogni attesa.
  - Gli avvii passano da un lucchetto.
  - Un'operazione in pausa viene chiusa come parziale quando ne parte un'altra.
- **Verifica:** i test «H2» (tre riprese contemporanee → pagina 1 chiesta una sola volta; due avvii → uno solo riesce) e il controllo end-to-end di ripresa dopo la chiusura del browser.

### H3 — Collegamento perso se la finestra del permesso chiude il popup (Alta, popup, service worker)
- **Causa:**
  - Su alcuni sistemi la finestra del permesso chiude il popup.
  - Il codice che doveva completare il collegamento muore con lui.
- **Correzione:**
  - Il popup legge i dati della pagina prima del permesso e lascia la richiesta in `chrome.storage.session`.
  - `permissions.onAdded` nel motore la completa se il popup non l'ha fatto.
  - Il collegamento è unico per sito: niente doppioni tra popup e motore.
- **Verifica:** il percorso normale è coperto dal controllo end-to-end. **Il caso della chiusura del popup non è automatizzabile** (la finestra del permesso non si può comandare): va provato a mano.

### M1 — Schede lette dal dominio vecchio (Media, scanner)
- **Causa:** le schede si leggevano dall'indirizzo salvato al momento dell'elenco. Dopo un cambio di dominio puntavano al sito vecchio.
- **Correzione:** l'indirizzo si costruisce dal sito collegato ora, e quello salvato viene aggiornato.
- **Verifica:** test «M2».

### M2 — Schede scaricate come pagina intera (Media, scanner, adattatore)
- **Causa:** ogni scheda era una pagina HTML di circa 436 KB, cioè circa 2,2 GB per tutto l'archivio.
- **Correzione:**
  - Le schede si chiedono come dati Inertia, come fa il sito quando si naviga: circa 195 KB con i titoli correlati, circa 7,5 KB senza (opzione in Avanzate).
  - La versione dell'app del sito si impara al collegamento o dalla prima pagina HTML. Con un 409 si torna all'HTML e si impara la versione nuova.
  - I JSON di dati non vengono più scambiati per pagine di verifica CAPTCHA.
- **Verifica:**
  - Test «M2» e test sui dati veri.
  - Controllo end-to-end «schede lette come dati della pagina».
  - Forma della risposta verificata sul sito vero con le stesse intestazioni.

### M3 — Salvataggi contemporanei delle impostazioni si cancellano (Media, `src/common/settings.js`)
- **Causa:** la lettura e la scrittura erano in due transazioni separate.
- **Correzione:** una sola transazione.
- **Verifica:** test «M3».

### M4 — «Autori» letti da un campo sbagliato (Media, adattatore)
- **Causa:**
  - Sul sito vero `created_by` è il numero dell'utente che ha caricato il titolo (es. `7`).
  - BingeMap lo leggeva come elenco di autori, quindi in «Persone che segui» sarebbe comparso l'autore «7» su moltissime serie.
- **Correzione:** gli autori vengono da `main_directors` quando `created_by` non è un elenco, e i numeri non sono più nomi.
- **Verifica:** test con la forma dei dati veri della scheda del 20/11.

### M5 — La prima scansione conta tutto come «novità» (Media, service worker)
- **Causa:** dopo la prima scansione completa, badge e popup avrebbero mostrato «+5.000 serie».
- **Correzione:** l'istantanea segna `first` e la prima scansione completa non incrementa le novità.
- **Verifica:** test «M5».

### M6 — Errori a ripetizione sul sito dopo un riavvio (Media, `src/content/site.js`)
- **Causa:** dopo «Riavvia BingeMap», le schede del sito già aperte tenevano uno script che non può più parlare con l'estensione, e ogni cambiamento della pagina lanciava «Extension context invalidated».
- **Correzione:** lo script si accorge del contesto chiuso e si spegne.
- **Verifica:** revisione del codice e controlli end-to-end dei badge. Il riavvio reale con una scheda aperta non è stato riprodotto in automatico.

### M7 — Il riquadro dell'operazione in Attività si svuota (Media, `src/ui/app.js`)
- **Causa:** il motore mandava eventi `{kind:'scan'}` senza operazione: errore nel gestore e riquadro svuotato.
- **Correzione:** il motore manda sempre l'operazione e l'interfaccia ignora gli eventi senza.
- **Verifica:** controllo end-to-end «nessun errore JavaScript nelle pagine».

### L1 — Pulizie minori (Bassa, vari)
Segnalate da ESLint, senza effetti visibili:
- codice morto (`x` in exports, `DAY` in engine, import inutili);
- una chiave i18n duplicata;
- due escape inutili;
- uno spazio non separabile scritto letteralmente in una regex (ora ` `).

## Modifiche effettuate

**Codice dell'estensione**
- `src/ui/popup.js`: C1, H3, doppio clic, `?tab=` per test e diagnostica.
- `src/background/sw.js`: avvio unico, attesa dell'avvio nei messaggi, collegamento unico e in sospeso, versione Inertia, ripresa della scansione in pausa al collegamento, eventi con l'operazione, novità.
- `src/scan/scanner.js`: fette, limite di pagine, cursori fissati, lucchetti, schede Inertia, `first`.
- `src/catalog/sc/adapter.js`: `listSlices`, `pageLimitReached`, `inertiaHeaders`, `pageVersion`, `listUrl` con fetta, CAPTCHA solo su HTML, autori.
- `src/common/settings.js`: nuove impostazioni del sito, salvataggio in una transazione.
- `src/content/site.js`: spegnimento dopo un riavvio.
- `src/ui/app.js`: eventi senza operazione.
- `src/ui/views/impostazioni.js`: nuove voci in Avanzate.
- Pulizie: `src/backup/exports.js`, `src/query/engine.js`, `src/sync/drive.js`, `src/common/util.js`, `src/import/paste.js`, `src/ui/i18n.js`, `src/ui/views/risultati.js`.

**Test**
- `tests/unit/v132.test.js` (nuovo, 15 test).
- `tests/unit/v110.test.js`, `tests/unit/v120.test.js`: import inutili.
- `tests/e2e/site_server.py`: limite di pagine, filtro `year`, schede Inertia, registro delle richieste.
- `tests/e2e/run_e2e.py`: collegamento dal popup con un clic, controlli su fette e schede Inertia, attesa più lunga per la ripresa (più richieste a fette, stesso ritmo).

**Strumenti e documenti**
- `eslint.config.js`, `package.json` (`lint`, `check`), `.github/workflows/release.yml` (lint nella release).
- `docs/SITE_NOTES.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`, `README.md`.
- Versione 1.3.2: `manifest.json`, `version.json`, `src/common/version.js`, `package.json`.

## Test

**Eseguiti e risultati**
- **Unità:** `npm test` → 91 su 91 superati (76 prima). Il nuovo file è stato eseguito tre volte di fila, sempre verde.
- **Controllo statico:** `npm run check` (manifest, changelog, ESLint) → superato, nessun errore e nessun avviso.
- **End-to-end:** `npm run e2e`, Chromium reale con il pacchetto estratto → 99 controlli su 99 superati (95 prima).
- **Sito vero, sola lettura, con la scheda di Andrea:**
  - limite di 20 pagine e filtro per anno, con la somma delle fette = il totale;
  - sequenza completa della nuova scansione: 5.027 su 5.027;
  - forma della scheda come dati Inertia, 409 con una versione vecchia;
  - nessuna parola di verifica nelle schede.

**Test falliti durante il lavoro**
- I nuovi test di regressione, prima delle correzioni.
- Due test esistenti, che hanno rivelato rischi veri:
  - «sito reale: elenco JSON…» ha mostrato il caso del filtro ignorato e dell'archivio piccolo;
  - «ripresa dopo la chiusura del browser» richiedeva solo più tempo.
- Nessuna aspettativa dei test esistenti è stata cambiata. Solo l'attesa del secondo è stata allungata, con il motivo scritto nel test.

**Non eseguibili qui**
- **L'estensione caricata nel Brave di Andrea:** le pagine `chrome-extension://` non si possono comandare da fuori. Il percorso è coperto dall'end-to-end in Chromium e dalla prova delle richieste sul sito vero.
- **Chiusura del popup durante il permesso (H3) e riavvio con schede del sito aperte (M6):** vanno provati a mano.
- **Google Drive, TMDB, SIMKL, AniList:** mancano le chiavi o gli account. Restano coperti solo dai test di unità con servizi simulati.
- **Lettura completa delle schede sul sito vero** (5.027 richieste, qualche ora): non eseguita per non caricare il sito durante l'audit. Una scheda è stata letta e interpretata con il codice nuovo.

## Problemi ancora aperti

- **Fette troppo grandi.** Se in futuro un anno supera le 20 pagine (oggi il massimo è il 2022, con 12 pagine), quella fetta resta incompleta: la scansione lo annota e risulta parziale. Si risolverebbe dividendo l'anno per genere.
- **Struttura del sito.** BingeMap dipende dalla struttura attuale (paginatore Laravel, filtro `year`, Inertia). Se cambia, i valori si correggono da Impostazioni › Avanzate, ma un cambiamento grosso richiede codice. Le scansioni si fermano senza segnare titoli come spariti.
- **Durata delle schede.** Per 5.000 serie servono qualche ora. Con i titoli correlati si scarica circa 1 GB in totale; senza, circa 40 MB (opzione in Avanzate).
- **Dati vecchi.** Le schede lette con le versioni precedenti possono avere l'autore «7» finché non vengono rilette (Attività › «Dettagli dei titoli nuovi» oppure una nuova scansione).
- **Permessi del popup.** Il collegamento in sospeso dipende dalla finestra del permesso del browser e va confermato a mano su Brave.
- **Profili.** Le operazioni in corso appartengono al profilo attivo all'avvio del motore. Un cambio di profilo durante una scansione non è stato provato.

## Stato di affidabilità

Collegamento e scansione erano i due flussi bloccanti. Ora funzionano nei test automatici, che riproducono i comportamenti verificati sul sito vero, e la sequenza di richieste è stata provata per intero sul sito vero. Le riprese e la concorrenza hanno test dedicati.

Restano da confermare con un uso reale su Brave:
- il collegamento dal popup;
- la lettura completa delle schede;
- i servizi esterni con le chiavi personali.

Non è possibile dichiarare BingeMap «stabile» in assoluto: dipende da un sito senza API pubblica che cambia spesso. Però i guasti noti sono corretti e ognuno ha un test che lo intercetterebbe se tornasse.
