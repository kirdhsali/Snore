#!/bin/sh
# One PSG-Audio night from the Hugging Face mirror (dust-systems/psg-audio, V3/APNEA_EDF):
# download its hourly EDF parts, refuse nights with a missing hour, run pass 1, YAMNet and the
# night summary, then delete the audio again. Called by run.sh with the subject id.
set -eu
DATA="${SNOREWATCH_DATA:-$HOME/.cache/snorewatch}"
HERE="$(cd "$(dirname "$0")" && pwd)"
id="${1:?subject id, e.g. 00001006-100507}"
SRC="$DATA/datasets/psg-audio"
OUT="$DATA/results/psg-audio/$id"
[ -f "$OUT/summary.json" ] && exit 0
mkdir -p "$SRC" "$OUT"
API=https://huggingface.co/api/datasets/dust-systems/psg-audio/tree/main/V3/APNEA_EDF/$id
FILES=https://huggingface.co/datasets/dust-systems/psg-audio/resolve/main/V3/APNEA_EDF/$id
# The file names contain "%5B001%5D" literally; "size name" per part, in order.
list="$(curl -sS "$API" | python3 -c 'import sys,json; [print(f["size"], f["path"].rsplit("/",1)[1]) for f in json.load(sys.stdin) if f["path"].endswith(".edf")]' | sort -k2)"
n="$(echo "$list" | grep -c . || true)"
last="$(echo "$list" | tail -1 | sed -E 's/.*%5B0*([0-9]+)%5D.*/\1/')"
if [ "$n" -eq 0 ] || [ "$n" -ne "$last" ]; then echo "$id: $n parts but the last is number $last (an hour is missing): skipped"; exit 0; fi
parts=""
echo "$list" | while read -r size name; do
  local_name="$SRC/$(echo "$name" | sed 's/%5B/_/; s/%5D//')"
  [ -f "$local_name" ] && [ "$(stat -c %s "$local_name")" -eq "$size" ] && continue
  curl -sSL --retry 4 -o "$local_name" "$FILES/$(echo "$name" | sed 's/%/%25/g')"
  [ "$(stat -c %s "$local_name")" -eq "$size" ] || { echo "$id: $name has the wrong size"; exit 1; }
done
parts="$(echo "$list" | while read -r size name; do echo "$SRC/$(echo "$name" | sed 's/%5B/_/; s/%5D//')"; done | tr '\n' ' ')"
# shellcheck disable=SC2086
node "$HERE/pass1.js" "$OUT" $parts > "$OUT/pass1.log"
"$DATA/venv/bin/python" "$HERE/candidates.py" "$OUT" > "$OUT/candidates.log" 2>&1
node "$HERE/night-summary.js" "$OUT" > "$OUT/summary.txt"
cat "$OUT/summary.txt"
for p in $parts; do rm -f "${p:?}"; done
rm -f "${OUT:?}/mic16k.f32"
