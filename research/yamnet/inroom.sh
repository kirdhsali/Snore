#!/bin/sh
# YAMNet versus the detector on the same in-room audio (about 5 GB of temporary audio, deleted at
# the end; about 15 minutes). research/setup.sh, research/khan/fetch.sh and `npm run eval:public` first.
set -eu
DATA="${SNOREWATCH_DATA:-$HOME/.cache/snorewatch}"
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$DATA/tmp/yamnet-inroom"
mkdir -p "$W" "$DATA/results/yamnet"
node "$HERE/inroom.js" "$W"
"$DATA/venv/bin/python" "$HERE/inroom.py" "$W" | tee "$DATA/results/yamnet/inroom.txt"
rm -rf "${W:?}/audio"
