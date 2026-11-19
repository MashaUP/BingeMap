# Changelog

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
