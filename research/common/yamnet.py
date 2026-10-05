"""YAMNet (Google, Apache 2.0) as a sound judge for the research scripts.

The model is the TFLite classification export (input: 15600 samples = 0.975 s at 16 kHz, output:
521 AudioSet class scores). research/setup.sh downloads it and checks its SHA-256. Every piece of
audio is first turned up so that its loudest 50 ms sit at -20 dBFS (YAMNet judges absolute level;
quiet bedside snores would otherwise look like silence), then scored in 0.975 s windows every
0.4875 s; a clip's score is the highest window's.
"""
import csv
import os

import numpy as np
from ai_edge_litert.interpreter import Interpreter

DATA = os.environ.get('SNOREWATCH_DATA', os.path.join(os.path.expanduser('~'), '.cache', 'snorewatch'))
MODEL = os.path.join(DATA, 'models', 'yamnet')
WIN = 15600
NAMES = [r['display_name'] for r in csv.DictReader(open(os.path.join(MODEL, 'yamnet_class_map.csv')))]
SNORING, BREATHING = NAMES.index('Snoring'), NAMES.index('Breathing')

_it = Interpreter(model_path=os.path.join(MODEL, 'yamnet.tflite'))
_it.allocate_tensors()
_IN, _OUT = _it.get_input_details()[0]['index'], _it.get_output_details()[0]['index']


def to16k(x, sr):
    """Band-limited (FFT) resampling to 16 kHz."""
    x = np.asarray(x, dtype=np.float32)
    if sr == 16000 or len(x) == 0:
        return x
    m = int(round(len(x) * 16000 / sr))
    return (np.fft.irfft(np.fft.rfft(x), m) * (m / len(x))).astype(np.float32)


def level(x, target_db=-20.0):
    """Turn x up or down so its loudest 50 ms (at 16 kHz) sit at target_db dBFS."""
    x = np.asarray(x, dtype=np.float32)
    if len(x) >= 800:
        rms = np.sqrt(np.convolve(x * x, np.ones(800) / 800, 'valid'))
    else:
        rms = np.array([np.sqrt(np.mean(x * x))])
    return (x * (10 ** (target_db / 20) / max(float(rms.max()), 1e-9))).astype(np.float32)


def judge(x16k, normalise=True, centre=False):
    """(snoring score, breathing score, top class) of 16 kHz audio, max over its windows."""
    y = level(x16k) if normalise else np.asarray(x16k, dtype=np.float32)
    if len(y) < WIN:
        pad = WIN - len(y)
        y = np.pad(y, (pad // 2, pad - pad // 2) if centre else (0, pad))
    best = np.zeros(len(NAMES), dtype=np.float32)
    for o in range(0, len(y) - WIN + 1, WIN // 2):
        _it.set_tensor(_IN, y[o:o + WIN])
        _it.invoke()
        best = np.maximum(best, _it.get_tensor(_OUT)[0])
    return float(best[SNORING]), float(best[BREATHING]), NAMES[int(best.argmax())]
