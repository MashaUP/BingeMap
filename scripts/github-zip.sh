#!/usr/bin/env bash
# Crea dist/BingeMap_GitHub.zip: la cartella BingeMap_GitHub/ con tutti i file del repository
# (compreso BingeMap-x.y.z.zip nella radice), senza node_modules, dist, .git, _site.
set -euo pipefail
RADICE="$(cd "$(dirname "$0")/.." && pwd)"
LAVORO="$(mktemp -d)"
trap 'rm -rf "$LAVORO"' EXIT
mkdir -p "$LAVORO/BingeMap_GitHub" "$RADICE/dist"
(cd "$RADICE" && tar --exclude=./node_modules --exclude=./dist --exclude=./.git --exclude=./_site --exclude=./tmp --exclude='*.DS_Store' -cf - .) | tar -xf - -C "$LAVORO/BingeMap_GitHub"
rm -f "$RADICE/dist/BingeMap_GitHub.zip"
(cd "$LAVORO" && zip -qr9 "$RADICE/dist/BingeMap_GitHub.zip" BingeMap_GitHub)
echo "Creato dist/BingeMap_GitHub.zip ($(unzip -Z1 "$RADICE/dist/BingeMap_GitHub.zip" | wc -l) voci)"
