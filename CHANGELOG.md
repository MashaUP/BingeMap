# Changelog

## [1.3.2] - 2026-11-20

Audit di stabilità: dettagli in `docs/DEBUG_AUDIT.md`.

### Correzioni
- **«Usa questa scheda» non collegava niente** (1.3.1): un nome fuori portata nel popup bloccava il clic subito dopo il permesso. Ora il collegamento parte; se la finestra del permesso chiude il popup, lo completa il motore. Doppio clic: un solo collegamento.
- **La scansione completa leggeva al massimo 1 200 serie su oltre 5 000**: il sito serve al massimo 20 pagine per elenco e oltre risponde 503 «Page limit reached (20)», che BingeMap prendeva per un blocco. Ora l'archivio si legge a fette, anno per anno (come il menu «Anno» del sito): verificato sul sito vero, la somma delle fette dà tutte le serie. Un filtro rifiutato salta solo la sua fetta; se il sito ignorasse il filtro BingeMap non rilegge l'elenco per ogni anno.
- Le schede dei titoli e i metadati TMDB, ripresi dopo una pausa o una chiusura del browser, saltavano titoli: l'elenco da leggere ora si fissa al primo avvio.
- All'avvio del browser la stessa scansione poteva partire due volte (doppie richieste al sito): avvio del motore e riprese ora avvengono una volta sola.
- Le schede si leggevano dall'indirizzo salvato, anche se il sito aveva cambiato dominio: ora dal sito collegato.
- Due salvataggi contemporanei delle impostazioni potevano cancellarsi a vicenda.
- La prima scansione completa contava tutte le serie come «novità» nel badge e nel popup.
- Dopo un riavvio di BingeMap le schede del sito già aperte davano errori a ripetizione.
- Un avviso di scansione senza dati svuotava il riquadro dell'operazione in Attività.

### Miglioramenti
- Schede lette come dati della pagina (come fa il sito quando si naviga) invece della pagina intera: circa la metà dei dati con i titoli correlati, una frazione senza. Se il sito cambia versione si torna da soli alla pagina intera.
- Impostazioni › Avanzate: filtro delle fette, pagine massime per elenco, modo di lettura delle schede, titoli correlati sì/no.
- Controllo statico del codice (`npm run lint`, anche nella release automatica) e nuovi test, tra cui il collegamento con un clic vero nel popup.
- Release automatica come negli altri progetti: alla pubblicazione di una Release su GitHub, `BingeMap-x.y.z.zip` allegato (sostituito se si rilancia) e annuncio su Discord con il link di download (segreto `DISCORD_WEBHOOK_URL`). Il workflow si ferma se il tag non coincide con la versione.
- Licenza MIT (prima: tutti i diritti riservati) e immagine di anteprima della repository (`docs/social-preview.png`).

## [1.3.1] - 2026-11-20

### Correzioni
- Il motore della 1.0.0 non risponde alla domanda sulla versione e il controllo lo credeva aggiornato: per questo dopo aver copiato la cartella nuova «Usa questa scheda» continuava a fallire senza nessun avviso. Ora una risposta mancante vale come «motore vecchio» e, aprendo il popup, BingeMap si riavvia da solo una volta.
- «Usa questa scheda»: i dati della pagina li legge direttamente il popup e li passa al motore. Se qualcosa non va, il messaggio dice quale passaggio non è riuscito.
- Nel popup, in basso, la versione dei file e quella del motore in esecuzione.

## [1.3.0] - 2026-11-20

### Novità
- **Riavvia BingeMap**: pulsante nella barra laterale, nel popup e nella finestra «Cerca aggiornamento». Dopo aver copiato la cartella della versione nuova basta premerlo: l'estensione rilegge i file dal disco. Se BingeMap si accorge che la cartella è nuova ma il motore è ancora quello vecchio, lo dice da solo.
- **Lettura automatica di tutto l'archivio**: con «Usa questa scheda» parte subito l'elenco completo, poi le schede di tutte le serie (con calma, riprende anche dopo la chiusura del browser), poi i metadati TMDB se c'è la chiave. Disattivabile in Impostazioni.
- **Icona nuova**: quadrato pieno con la spina e il «play», leggibile anche a 16 px nella barra del browser; stesso disegno nel logo dell'app.

### Correzioni
- Collegamento del sito: i dati vengono letti direttamente dall'app della pagina, poi dall'HTML come prima. Prima della 1.3.0 l'errore «La pagina non contiene i dati attesi» compariva quando il motore in esecuzione era ancora quello della versione precedente.
- Ricerca in Scopri: se il testo è il titolo di una serie si cerca quella, invece di interpretarlo come filtri; con il catalogo vuoto spiega cosa fare.
- «Doppiate» nella ricerca a parole usa il dato del doppiaggio italiano.

## [1.2.0] - 2026-11-20

### Novità
- **Esplora**: una pagina con tutti i modi di scoprire (mappa, giro del mondo, universi, classici, persone, anime, linea del tempo e le altre).
- **Cancellate senza finale**: avviso nella scheda e filtro; c'è anche il filtro «Chiuse bene».
- **Quasi finite**: le serie all'80% o più, con gli episodi che mancano, anche in Scopri.
- **Prova il pilota**: serie mai iniziate, ben votate, con episodi brevi.
- **I grandi classici che ti mancano**: top 50/100/250 con voto pesato sul numero di voti, quante ne hai viste; copertura di una tua lista importata (ad esempio la top 250 di IMDb).
- **Universi e spin-off**: serie collegate (franchise, stessi autori con legame forte) in ordine di uscita, con la prossima da guardare; anche nella scheda.
- **Stagioni mancanti nel catalogo**: avviso quando sono uscite più stagioni di quelle presenti sul sito.
- **Persone che segui**: tocca il nome di un attore o di un autore nella scheda; pagina dedicata, filtro e notifica quando arriva una sua serie.
- **Anime**: import da AniList (profilo pubblico) e da MyAnimeList (XML, anche .xml.gz); anime della stagione con il prossimo episodio, confrontati con catalogo e liste.
- **Il giro del mondo in serie**: mappa dei paesi visti e di quelli mai provati, con un consiglio per ognuno.
- **La tua linea del tempo**: anno per anno le serie iniziate e finite, con la migliore dell'anno.
- **Esporta verso altre app**: CSV formato IMDb (voti e watchlist), CSV completo con ID e progresso, XML MyAnimeList per gli anime.
- **Alto contrasto e testo più grande** (115% o 130%).
- Filtri nuovi: doppiata in italiano, anime, con persone che segui; pulsante «Annulla» nei messaggi dopo una modifica.

## [1.1.0] - 2026-11-19

### Novità
- **Progresso per episodio**: «sono a S2E4», percentuale, episodi e ore che mancano; si riempie da solo con gli import che hanno gli episodi (SIMKL, Netflix).
- **In arrivo**: calendario dei prossimi episodi e delle nuove stagioni delle serie che segui, esportabile in `.ics`.
- **Rinnovi e cancellazioni**: avviso quando una serie che segui viene rinnovata, conclusa o cancellata.
- **Pianifica la maratona**: ore a settimana e giorni scelti → data di fine di ogni serie.
- **La mappa**: serie simili vicine (generi, parole chiave, cast, paese, decennio), zone con nome e quota esplorata, tutto calcolato in locale.
- **Scorri**: mazzo di carte da smistare con frecce, pulsanti o trascinando.
- **Ho 40 minuti**: cosa guardare nel tempo che hai.
- **Senza spoiler**: trama nascosta per le serie in corso o in pausa.
- **Import Netflix** (cronologia di visione, anche il file completo con i profili) e **Incolla una lista** da un articolo.
- **Tasto destro** «Cerca in BingeMap» / «Aggiungi a Da vedere» e barra degli indirizzi con la parola chiave `bm`.
- **Dove guardarla legalmente** in ogni scheda (JustWatch tramite TMDB) e i tuoi abbonamenti evidenziati e filtrabili.
- **Il tuo anno in serie**: immagine PNG da condividere.
- **Annulla globale** con Ctrl+Z.
- **Interfaccia in inglese** (menu, stati, filtri, pulsanti e pagine principali).
- Avviso di ricarica per le schede aperte con il codice di una versione precedente.

### Correzioni
- Scansione allineata alla struttura reale del sito (verificata il 19/11/2026): elenco JSON paginato su `/{lang}/archive`, dati della pagina letti anche dopo l'avvio dell'app del sito, titoli correlati dallo slider «related», episodi per stagione, parole chiave, cast e servizi legali dalla scheda. Le impostazioni della 1.0.0 vengono aggiornate da sole.
- Titoli in coreano, giapponese e altri alfabeti non più ridotti a stringa vuota (abbinamento corretto).
- Filtri «negli ultimi N giorni» corretti a cavallo del cambio dell'ora legale; ordinamento A–Z con le regole italiane.
- CSV salvati da Excel in Windows‑1252 o UTF‑16 letti correttamente.
- Diagnostica: oscurati anche token Google e parametri sensibili non preceduti da «?».
- GitHub Pages: il workflow non fallisce se Pages non è attivo; azioni aggiornate a Node 24.

## [1.0.0] - 2026-11-19

Prima versione: tutta la roadmap (dalla 1.0 alla 2.0 del documento di prodotto) in un'unica release.

### Catalogo
- Collegamento al sito dalla scheda aperta, riconosciuto dalla struttura della pagina e non dal dominio.
- Scansione in tre livelli (elenco, dettagli, metadati TMDB) con pausa, ripresa anche dopo la chiusura del browser, ritmo prudente e arresto su 403, 429 e CAPTCHA.
- Area temporanea: una scansione diventa catalogo solo se completa; le parziali non segnano mai titoli come spariti; «non più rilevato» dopo 2 scansioni complete.
- Novità, titoli spariti, stagioni aggiunte, istantanee e cronologia per titolo; raccolta passiva dalle pagine visitate.
- Catalogo legale dai fornitori italiani (TMDB, dati JustWatch).
- Pacchetto catalogo esportabile e importabile, senza dati personali.

### Import e riconoscimento
- SIMKL (PKCE), Refract, Trakt, IMDb, TV Time, Showly, SeriesGuide, Sofa Time, CSV, JSON, Excel, lista manuale.
- Anteprima con diff, transazione unica, annullamento, reimport senza doppioni, mappatura delle colonne ricordata.
- Riconoscimento per ID TMDB/IMDb/TVDB, titolo normalizzato e anno, titoli alternativi, somiglianza; coda «Da confermare» con tastiera; correzioni permanenti.

### Scoperta
- Sette stati di visione, conflitti tra fonti con regole configurabili, stato personale che non tocca le fonti.
- Motore di filtri E/O/NON con conteggi per opzione, costruttore visuale, filtri scritti a parole, «Perché non la vedo?».
- Ricerche salvate e collezioni che segnalano le novità; ricerche predefinite, umori, «Stasera ho 2 ore».
- Consigli spiegati con pesi regolabili, «Sorprendimi» a titolo nascosto, Non mi interessa, Rimanda, Le prossime 5, Serata in due.
- Nuove stagioni per le serie completate, «Ora è conclusa», «Riprendi o lascia», complete nel catalogo, ore per finirla.

### Dati e servizi
- Sincronizzazione su Google Drive (cartella nascosta, permesso drive.appdata), backup e ripristino, backup automatico in cartella, esportazioni CSV e formato per Refract.
- Badge sulle copertine del sito, popup, notifiche, scansioni programmate facoltative, monitoraggio dei titoli.
- Statistiche, Wrapped annuale, diario delle scoperte, profili multipli, tema chiaro e scuro, palette dei comandi.
- App web (PWA) con lo stesso codice.
- «Cerca aggiornamento», Ko-fi e Discord da `links.json`, centro diagnostica senza dati personali.
