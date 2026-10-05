#!/bin/sh
# One APSAA subject: unpack it from the archive, evaluate it, delete its audio again (the small
# CSVs stay for the summary). Called by run.sh.
set -eu
DATA="${SNOREWATCH_DATA:-$HOME/.cache/snorewatch}"
HERE="$(cd "$(dirname "$0")" && pwd)"
id="${1:?subject}"
SRC="$DATA/datasets/apsaa"
RES="$DATA/results/apsaa"
[ -f "$RES/out-$id.json" ] && exit 0
unzip -o -q "$SRC/APSAA.zip" "$id/*" -d "$SRC"
node "$HERE/evaluate.js" "$SRC/$id" "$RES/out-$id.json"
rm -f "${SRC:?}/${id:?}/${id:?}.wav"
