#!/usr/bin/env bash
# Crea BingeMap-x.y.z.zip (dentro la cartella BingeMap/ pronta per «Carica estensione non pacchettizzata»)
# e BingeMap-x.y.z.zip.sha256. Lo usano npm run build / npm run package e il workflow delle release:
#   scripts/pacchetto.sh [versione-attesa] [cartella-di-uscita]
# Senza cartella di uscita lo zip va nella radice del repository (quello che scarica «Cerca aggiornamento»)
# e lo script scrive in version.json il nome dello zip e il suo SHA-256: mai a mano.
# Lo zip è riproducibile (date, permessi e ordine fissi): stesso codice → stesso SHA-256, anche nelle Actions.
# Esce con errore se le versioni non coincidono o se manca un file nominato dal manifest.
set -euo pipefail

RADICE="$(cd "$(dirname "$0")/.." && pwd)"
ATTESA="${1:-}"
USCITA="${2:-$RADICE}"

VERSIONE="$(node -p "require('$RADICE/manifest.json').version")"
if [[ -n "$ATTESA" && "${ATTESA#v}" != "$VERSIONE" ]]; then
  echo "::error::La release è ${ATTESA} ma manifest.json dice ${VERSIONE}: allinea le versioni prima di pubblicare." >&2
  exit 1
fi
VERSIONE_JSON="$(node -p "require('$RADICE/version.json').version")"
if [[ "$VERSIONE_JSON" != "$VERSIONE" ]]; then
  echo "::error::version.json dice ${VERSIONE_JSON}, manifest.json ${VERSIONE}: «Cerca aggiornamento» darebbe informazioni sbagliate." >&2
  exit 1
fi

NOME="BingeMap-${VERSIONE}.zip"
LAVORO="$(mktemp -d)"
trap 'rm -rf "$LAVORO"' EXIT
mkdir -p "$LAVORO/BingeMap"
cp "$RADICE/manifest.json" "$RADICE/LICENSE" "$LAVORO/BingeMap/"
cp -R "$RADICE/src" "$RADICE/assets" "$LAVORO/BingeMap/"
find "$LAVORO" \( -name '.DS_Store' -o -name 'Thumbs.db' -o -name '*.log' -o -name '*~' \) -delete
# Riproducibile: permessi e date fissi.
find "$LAVORO" -type d -exec chmod 755 {} +
find "$LAVORO" -type f -exec chmod 644 {} +
find "$LAVORO" -exec env TZ=UTC touch -h -t 202601010000 {} +

# Ogni file nominato dal manifest deve esserci.
node -e '
  const fs = require("fs"), path = require("path");
  const dir = process.argv[1];
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const file = [
    m.background?.service_worker,
    ...(m.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
    m.action?.default_popup, m.options_page, m.options_ui?.page, ...Object.values(m.icons || {}), ...Object.values(m.action?.default_icon || {}),
    ...(m.web_accessible_resources || []).flatMap((w) => w.resources || []).filter((r) => !r.includes("*")),
  ].filter(Boolean);
  const mancanti = file.map((f) => f.split(/[?#]/)[0]).filter((f) => !fs.existsSync(path.join(dir, f)));
  if (mancanti.length) { console.error("::error::File del manifest mancanti: " + mancanti.join(", ")); process.exit(1); }
' "$LAVORO/BingeMap"

mkdir -p "$USCITA"
USCITA="$(cd "$USCITA" && pwd)"
rm -f "$USCITA"/BingeMap-*.zip "$USCITA"/BingeMap-*.zip.sha256
(cd "$LAVORO" && find BingeMap -type f | LC_ALL=C sort | TZ=UTC zip -q -9 -X -D "$USCITA/$NOME" -@)

# Controllo dell'archivio: tutto dentro BingeMap/, manifest presente, nessun file di sviluppo.
ELENCO="$(unzip -Z1 "$USCITA/$NOME")"
grep -qx 'BingeMap/manifest.json' <<<"$ELENCO" || { echo "::error::BingeMap/manifest.json non è nello zip" >&2; exit 1; }
if grep -vq '^BingeMap/' <<<"$ELENCO" || grep -Eq '/(tests|docs|scripts|\.github|node_modules)/|\.zip$' <<<"$ELENCO"; then
  echo "::error::Nello zip ci sono file fuori da BingeMap/ o file di sviluppo" >&2; exit 1
fi
SHA="$(sha256sum "$USCITA/$NOME" | cut -d' ' -f1)"
echo "$SHA  $NOME" > "$USCITA/$NOME.sha256"
if [[ "$USCITA" == "$RADICE" ]]; then
  node -e '
    const fs = require("fs"); const p = process.argv[1];
    const v = JSON.parse(fs.readFileSync(p, "utf8"));
    v.zip = process.argv[2]; v.sha256 = process.argv[3];
    const { version, date, zip, sha256, notes, ...rest } = v;
    fs.writeFileSync(p, JSON.stringify({ version, date, zip, sha256, notes, ...rest }, null, 2) + "\n");
  ' "$RADICE/version.json" "$NOME" "$SHA"
  rm -f "$USCITA/$NOME.sha256" # nella radice basta version.json
  echo "version.json aggiornato: zip $NOME, sha256 $SHA"
fi
echo "Creato $USCITA/$NOME ($(wc -l <<<"$ELENCO") file, $(du -h "$USCITA/$NOME" | cut -f1)), sha256 $SHA"
echo "nome=$NOME" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "percorso=$USCITA/$NOME" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "sha256=$SHA" >> "${GITHUB_OUTPUT:-/dev/null}"
