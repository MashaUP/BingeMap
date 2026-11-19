# BingeMap

Versione: **1.0.0**

BingeMap trova le serie del catalogo che non hai ancora visto. Incrocia il catalogo con le liste che hai già in altre app (SIMKL, Refract, Trakt, IMDb e altre), toglie in automatico quello che hai completato e ti lascia combinare generi, anni, tag e voti.

Estensione per Chrome, Brave ed Edge, con un'app completa a tutta pagina. Nessun account, nessun server: i dati restano sul tuo computer e, se vuoi, nel tuo Google Drive.

## Installazione

1. Scarica `BingeMap-1.0.0.zip` dalla radice del repository ed estrailo.
2. Apri `brave://extensions` o `chrome://extensions` e attiva la «Modalità sviluppatore».
3. Premi «Carica estensione non pacchettizzata» e scegli la cartella `BingeMap`.

Per aggiornare: «Cerca aggiornamento» nell'app, poi sostituisci la cartella e premi «Ricarica». I dati restano.

## Primi passi

1. **Catalogo.** Apri Streaming Community, clicca l'icona di BingeMap e scegli «Usa questa scheda». Poi avvia la scansione da Attività. In alternativa o in aggiunta: catalogo legale dei fornitori italiani (Impostazioni › Catalogo, serve la chiave TMDB).
2. **Liste.** Libreria › Importa: SIMKL (accesso diretto), ZIP di Refract o Trakt, CSV di IMDb, TV Time, Showly, SeriesGuide, Sofa Time, CSV/JSON/Excel con mappatura delle colonne, lista manuale.
3. **Scopri.** Filtri combinabili, ricerche salvate che si aggiornano, consigli con il loro perché, «Sorprendimi».

## Cosa serve configurare (facoltativo)

| Servizio | A cosa serve | Dove si crea |
| --- | --- | --- |
| Chiave TMDB | Metadati (paese, lingua, stato, episodi) e catalogo legale | themoviedb.org › Impostazioni › API |
| client_id SIMKL | Import diretto da SIMKL | simkl.com/settings/developer (redirect mostrato in Impostazioni › Servizi) |
| Client ID Google | Sincronizzazione su Google Drive | Google Cloud › Credenziali › ID client OAuth «Applicazione web», API Drive attiva, redirect mostrato in Impostazioni › Servizi |

## App web

Lo stesso codice gira come app web (cartella `web/`, pubblicata con GitHub Pages dal workflow `pages.yml`). Sul web funzionano il catalogo legale, gli import e la sincronizzazione con Google Drive; Streaming Community richiede l'estensione.

## Avvertenza

Streaming Community non è un servizio autorizzato: AGCOM lo blocca periodicamente e la legge prevede sanzioni per chi guarda contenuti pirata. BingeMap legge solo i dati del catalogo dal tuo browser, non mostra né collega video e non aggira blocchi. Il catalogo legale è sempre disponibile in alternativa.

## Supporto

- Ko-fi: https://ko-fi.com/mashaup
- Discord: https://discord.gg/EPsbQCuAkx

I link si aggiornano da `links.json` (aumenta `revision` quando li cambi).

## Sviluppo

- JavaScript a moduli ES, nessuna dipendenza a runtime, nessuna build.
- `npm install` (solo `fake-indexeddb` per i test), `npm test`, `npm run e2e`, `npm run pack`.
- Documentazione tecnica in `docs/`.

Attribuzioni: questo prodotto usa l'API TMDB ma non è approvato né certificato da TMDB. Dati sulla disponibilità: JustWatch.
