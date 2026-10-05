#!/bin/sh
# PSG-Audio: the six nights of the 2026-10 study (or the subjects given), one after another
# (each 2.5-4.3 GB, deleted after use), then all nights side by side.
#   research/setup.sh first (YAMNet), then: research/psg-audio/run.sh [subject ...]
# Needs network access to huggingface.co and its file host us.aws.cdn.hf.co.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ $# -gt 0 ]; then nights="$*"; else
  # 00001024-100507 was left out: the mirror is missing its third hour.
  nights="00000999-100507 00001006-100507 00001014-100507 00001016-100507 00001018-100507 00001026-100507"
fi
for id in $nights; do "$HERE/night.sh" "$id"; done
node "$HERE/summary.js" | tee "${SNOREWATCH_DATA:-$HOME/.cache/snorewatch}/results/psg-audio/summary.txt"
