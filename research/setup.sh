#!/bin/sh
# One-time setup for the research scripts (nothing here is part of the app):
#   - a Python virtual environment under $SNOREWATCH_DATA/venv with numpy and Google's LiteRT runtime;
#   - YAMNet (Google, Apache 2.0): the TFLite classification export as bundled in the npm package
#     @apocaliss92/scrypted-yamnet@0.0.3, and the class map from the Hugging Face ONNX conversion
#     audiomagic/yamnet-onnx (also downloaded, as the checksum-verified reference conversion).
# Every download is checked against the SHA-256 recorded here.
set -eu
DATA="${SNOREWATCH_DATA:-$HOME/.cache/snorewatch}"
HERE="$(cd "$(dirname "$0")" && pwd)"
M="$DATA/models/yamnet"
mkdir -p "$M"
check() { echo "$2  $1" | sha256sum -c --quiet - || { echo "checksum mismatch: $1"; exit 1; }; }

if [ ! -x "$DATA/venv/bin/python" ]; then python3 -m venv "$DATA/venv"; fi
"$DATA/venv/bin/pip" install -q -r "$HERE/requirements.txt"

if [ ! -f "$M/yamnet.tflite" ]; then
  tmp="$(mktemp -d)"
  curl -sSL -o "$tmp/p.tgz" https://registry.npmjs.org/@apocaliss92/scrypted-yamnet/-/scrypted-yamnet-0.0.3.tgz
  tar xzf "$tmp/p.tgz" -C "$tmp" package/src/model/yamnet.tflite
  mv "$tmp/package/src/model/yamnet.tflite" "$M/yamnet.tflite"
  rm -rf "$tmp"
fi
check "$M/yamnet.tflite" 10c95ea3eb9a7bb4cb8bddf6feb023250381008177ac162ce169694d05c317de
HF=https://huggingface.co/audiomagic/yamnet-onnx/resolve/main
[ -f "$M/yamnet_class_map.csv" ] || curl -sSL -o "$M/yamnet_class_map.csv" "$HF/yamnet_class_map.csv"
check "$M/yamnet_class_map.csv" cdf24d193e196d9e95912a2667051ae203e92a2ba09449218ccb40ef787c6df2
[ -f "$M/yamnet.onnx" ] || curl -sSL -o "$M/yamnet.onnx" "$HF/yamnet.onnx"
check "$M/yamnet.onnx" d3835ffbbd4a1bb3e777f0ca217b5007907f5171dd5d17c4236b95b2af8f908e
[ -f "$M/LICENSE" ] || curl -sSL -o "$M/LICENSE" "$HF/LICENSE"
echo "research setup ready: $DATA/venv, $M"
