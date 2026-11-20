# Rilascio

1. Aggiorna la versione (semver) in `manifest.json`, `package.json`, `version.json` (anche il campo `zip`), `src/common/version.js`, `CHANGELOG.md` e `README.md`.
2. `npm test` e `npm run e2e`.
3. `npm run pack`: crea `BingeMap-x.y.z.zip` nella radice (contiene `BingeMap/`). Cancella dal repository lo zip della versione precedente.
4. Pubblica tu su GitHub (nessun commit automatico) e crea la Release con tag `vx.y.z` (uguale alla versione del manifest, altrimenti il workflow si ferma). Il workflow «Zip della release» rifà controlli e test, allega `BingeMap-x.y.z.zip` alla release (rilanciandolo lo sostituisce) e annuncia su Discord con titolo, note e link di download.
   - Segreto per Discord: `DISCORD_WEBHOOK_URL` in Settings › Secrets and variables › Actions, come negli altri progetti (vale anche il vecchio `DISCORD_WEBHOOK`). Senza segreto lo zip viene allegato lo stesso e l'annuncio si salta con un avviso.
   - Da Actions › «Zip della release» › Run workflow si può rilanciare per un tag già pubblicato, anche saltando i test o ripetendo l'annuncio su Discord.
5. L'app web si pubblica da sola con `pages.yml` (attiva GitHub Pages con sorgente «GitHub Actions»).
