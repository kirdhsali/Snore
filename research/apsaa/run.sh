#!/bin/sh
# APSAA, all 32 nights (or the subjects given): download once (3.9 GB, MD5 from Zenodo), evaluate
# three nights at a time (night.sh unpacks, evaluates and deletes the audio again), then summarise.
#   research/apsaa/run.sh [subject ...]      results in $SNOREWATCH_DATA/results/apsaa
# Data licence: academic and non-commercial use only, no redistribution; never commit it or its output.
set -eu
DATA="${SNOREWATCH_DATA:-$HOME/.cache/snorewatch}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$DATA/datasets/apsaa"
RES="$DATA/results/apsaa"
mkdir -p "$SRC" "$RES"
if [ ! -f "$SRC/APSAA.zip.ok" ]; then
  curl -sSL --retry 4 -C - -o "$SRC/APSAA.zip" "https://zenodo.org/records/14096541/files/APSAA.zip?download=1"
  echo "44420c64647f6b7d898d3e84ff48e910  $SRC/APSAA.zip" | md5sum -c --quiet -
  touch "$SRC/APSAA.zip.ok"
fi
if [ $# -gt 0 ]; then subjects="$*"; else subjects="$(unzip -Z1 "$SRC/APSAA.zip" | grep '\.wav$' | cut -d/ -f1 | sort -u)"; fi
for id in $subjects; do echo "$id"; done | xargs -P 3 -n 1 "$HERE/night.sh"
node "$HERE/summary.js" | tee "$RES/summary.txt"
