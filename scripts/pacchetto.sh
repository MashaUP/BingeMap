#!/usr/bin/env bash
# Crea BingeMap-x.y.z.zip nella radice: contiene la cartella BingeMap/ pronta per «Carica estensione non pacchettizzata».
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(node -e "console.log(JSON.parse(require('fs').readFileSync('manifest.json','utf8')).version)")
OUT="BingeMap-${V}.zip"
TMP=$(mktemp -d)
mkdir -p "$TMP/BingeMap"
cp manifest.json "$TMP/BingeMap/"
cp -r src assets "$TMP/BingeMap/"
rm -f BingeMap-*.zip
(cd "$TMP" && zip -qr9 "$OLDPWD/$OUT" BingeMap -x '*.DS_Store')
rm -rf "$TMP"
echo "Creato $OUT"
