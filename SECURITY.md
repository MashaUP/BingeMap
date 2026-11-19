# Sicurezza e privacy

- Nessun server BingeMap: i dati stanno in IndexedDB sul dispositivo e, se attivata, in una cartella nascosta del Google Drive dell'utente (permesso `drive.appdata`).
- Chiave TMDB, client_id SIMKL e Client ID Google restano in locale, esclusi da backup (salvo scelta) e sincronizzazione. Il token SIMKL sta in `chrome.storage.local`, quello Google solo nella sessione.
- Il report diagnostico non contiene titoli, tag, token, chiavi o indirizzi completi.
- Sul sito del catalogo l'estensione è in sola lettura: niente clic automatici, moduli o modifiche. Si ferma su 403, 429 e CAPTCHA senza aggirarli.
- I permessi di host per il sito sono facoltativi e concessi a mano, uno per dominio.

Segnalazioni: scrivi nel Discord del progetto o apri una issue privata sul repository.
