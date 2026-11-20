# Rilascio

1. Versione (semver) in `manifest.json`, che è la fonte unica. Le copie in `package.json`, `version.json`, `src/common/version.js` e `README.md` le controlla `npm run check`. Aggiungi la sezione in `CHANGELOG.md` e le voci `notes` in `version.json` (elenco, massimo 12 da 300 caratteri).
2. `npm run package`:
   - crea `BingeMap-x.y.z.zip` nella radice (cartella `BingeMap/`) e toglie quello vecchio;
   - scrive `zip` e `sha256` in `version.json` (mai a mano);
   - esegue `npm test` (controlli, lint, test di unità);
   - crea `dist/BingeMap_GitHub.zip`.

   Lo zip è riproducibile: stesso codice, stesso SHA-256, anche nelle Actions.
3. `npm run test:e2e` (Chromium reale, sito simulato).
4. Carica i file su GitHub (nessun commit automatico) e **cancella a mano lo zip della versione precedente**: caricando la cartella, GitHub non lo toglie.
5. Pubblica la Release con tag `vx.y.z`, uguale alla versione del manifest. Il workflow «Zip della release»:
   - si ferma se il tag è diverso;
   - rifà `npm test`;
   - allega `BingeMap-x.y.z.zip` e `BingeMap-x.y.z.zip.sha256`; se lo rilanci, li sostituisce;
   - annuncia su Discord con titolo, note e link di download.

   Il segreto per Discord è `DISCORD_WEBHOOK_URL`, in Settings › Secrets and variables › Actions (vale anche il vecchio `DISCORD_WEBHOOK`). Senza segreto, avviso e niente annuncio.

   Da Actions › «Zip della release» › Run workflow puoi rilanciarlo per un tag già pubblicato, anche saltando i test o ripetendo l'annuncio.
6. L'app web si pubblica da sola con `pages.yml` (GitHub Pages con sorgente «GitHub Actions»).

A ogni push, `ci.yml` esegue `npm test` e un pacchetto di prova, che resta tra gli artifact per 14 giorni. Se lo zip nella radice non corrisponde al codice, la CI lo segnala con un avviso.

## Cambiare un link

Modifica `links.json` su `main`, nel formato comune (schemaVersion 1, solo https verso github.com, discord.gg/discord.com, ko-fi.com, mashaup.github.io), e aumenta `revision`. Non serve una versione nuova: BingeMap lo rilegge entro 12 ore o subito con «Cerca aggiornamento». Con `enabled: false` il link sparisce.
