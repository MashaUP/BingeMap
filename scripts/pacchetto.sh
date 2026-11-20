#!/usr/bin/env bash
# Crea BingeMap-x.y.z.zip: dentro la cartella BingeMap/ pronta per «Carica estensione non pacchettizzata».
# Lo usa il workflow delle release (.github/workflows/release.yml) e si può lanciare a mano:
#   scripts/pacchetto.sh [versione-attesa] [cartella-di-uscita]
# Senza argomenti lo zip finisce nella radice del repository (quello per «Cerca aggiornamento»).
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
cp "$RADICE/manifest.json" "$LAVORO/BingeMap/"
cp -R "$RADICE/src" "$RADICE/assets" "$LAVORO/BingeMap/"
find "$LAVORO" \( -name '.DS_Store' -o -name 'Thumbs.db' -o -name '*.log' -o -name '*~' \) -delete

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
rm -f "$USCITA"/BingeMap-*.zip
(cd "$LAVORO" && zip -qr9X "$USCITA/$NOME" BingeMap)

# Controllo dell'archivio: tutto dentro BingeMap/, manifest presente, nessun file di sviluppo.
ELENCO="$(unzip -Z1 "$USCITA/$NOME")"
grep -qx 'BingeMap/manifest.json' <<<"$ELENCO" || { echo "::error::BingeMap/manifest.json non è nello zip" >&2; exit 1; }
if grep -vq '^BingeMap/' <<<"$ELENCO" || grep -Eq '/(tests|docs|scripts|\.github|node_modules)/|\.zip$' <<<"$ELENCO"; then
  echo "::error::Nello zip ci sono file fuori da BingeMap/ o file di sviluppo" >&2; exit 1
fi
echo "Creato $USCITA/$NOME ($(wc -l <<<"$ELENCO") file, $(du -h "$USCITA/$NOME" | cut -f1))"
echo "nome=$NOME" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "percorso=$USCITA/$NOME" >> "${GITHUB_OUTPUT:-/dev/null}"
