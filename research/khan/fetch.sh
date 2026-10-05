#!/bin/sh
# The Khan snoring dataset (500 snoring + 500 other 1 s clips, 16 kHz; T. H. Khan, Electronics 8
# (2019) 987) from its GitHub mirror, pinned to the commit used in 2026-10. The mirror has no
# licence: local testing only, never commit the clips or anything derived from them.
set -eu
DATA="${SNOREWATCH_DATA:-$HOME/.cache/snorewatch}"
K="$DATA/datasets/khan"
if [ ! -d "$K/.git" ]; then
  git clone -q --filter=blob:none --no-checkout https://github.com/adrianagaler/Snoring-Detection "$K"
fi
cd "$K"
git sparse-checkout set --no-cone '/Snoring_Dataset_@16000/snoring/' '/Snoring_Dataset_@16000/no_snoring/' '/Snoring_Dataset_@16000/Snoring_dataset.txt'
git checkout -q cae6c6e1b831562ac5ad45c3f430381a046627d1
echo "Khan clips: $(ls Snoring_Dataset_@16000/snoring | wc -l) snoring, $(ls Snoring_Dataset_@16000/no_snoring | wc -l) other"
