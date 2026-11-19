# Rilascio

1. Aggiorna la versione (semver) in `manifest.json`, `package.json`, `version.json` (anche il campo `zip`), `src/common/version.js`, `CHANGELOG.md` e `README.md`.
2. `npm test` e `npm run e2e`.
3. `npm run pack`: crea `BingeMap-x.y.z.zip` nella radice (contiene `BingeMap/`). Cancella dal repository lo zip della versione precedente.
4. Pubblica tu su GitHub (nessun commit automatico) e crea la Release `vx.y.z`: il workflow allega lo zip e annuncia su Discord se esiste il segreto `DISCORD_WEBHOOK`.
5. L'app web si pubblica da sola con `pages.yml` (attiva GitHub Pages con sorgente «GitHub Actions»).
