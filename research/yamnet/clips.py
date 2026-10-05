"""YAMNet on the human-labelled clips (Khan, ESC-50) as they are: snoring score per clip, how well
it separates snoring from the rest (AUC), recall and false alarms at several thresholds, a sanity
check of its top classes, and what happens when the sound is cut at 4 or 2 kHz (APSAA's 4 kHz
recordings keep only up to 2 kHz).

    research/setup.sh, research/khan/fetch.sh and `npm run eval:public` first; then
    $SNOREWATCH_DATA/venv/bin/python research/yamnet/clips.py
"""
import csv
import os
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import yamnet  # noqa: E402

DATA = yamnet.DATA
K = os.path.join(DATA, 'datasets', 'khan', 'Snoring_Dataset_@16000')
E = os.environ.get('ESC50_DIR', os.path.join(DATA, 'esc-50'))
NIGHT = set('breathing coughing sneezing laughing crying_baby footsteps door_wood_creaks door_wood_knock clock_tick clock_alarm mouse_click keyboard_typing water_drops drinking_sipping toilet_flush washing_machine vacuum_cleaner wind rain thunderstorm dog cat crickets engine car_horn'.split())


def read16(path):
    w = wave.open(path)
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    if w.getnchannels() > 1:
        x = x.reshape(-1, w.getnchannels()).mean(1)
    return yamnet.to16k(x, w.getframerate())


def auc(pos, neg):
    v = np.concatenate([pos, neg])
    r = v.argsort().argsort().astype(float) + 1
    return (r[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))


def cut(x, hz):
    X = np.fft.rfft(x)
    X[int(hz * len(x) / 16000):] = 0
    return np.fft.irfft(X, len(x)).astype(np.float32)


clips = []  # (set, label, category, audio)
for label, folder in (('snore', 'snoring'), ('other', 'no_snoring')):
    for f in sorted(os.listdir(os.path.join(K, folder))):
        clips.append(('khan', label, folder, read16(os.path.join(K, folder, f))))
for r in csv.DictReader(open(os.path.join(E, 'meta', 'esc50.csv'))):
    clips.append(('esc50', 'snore' if r['category'] == 'snoring' else 'other', r['category'], read16(os.path.join(E, 'audio', r['filename']))))

# As recorded (no levelling): the first test of 2026-10.
scores = [yamnet.judge(x, normalise=False) for _, _, _, x in clips]
print('Sanity, YAMNet\'s most common top class per ESC-50 category:')
for cat in ('dog', 'siren', 'rain', 'crying_baby', 'snoring', 'clock_tick', 'toilet_flush', 'thunderstorm'):
    tops = [s[2] for (st, _, c, _), s in zip(clips, scores) if st == 'esc50' and c == cat]
    best = max(set(tops), key=tops.count)
    print(f'  {cat:13s} {best!r} ({tops.count(best)}/{len(tops)})')
for name, sel in (('Khan', lambda c: c[0] == 'khan'), ('ESC-50, snoring vs night sounds', lambda c: c[0] == 'esc50' and (c[1] == 'snore' or c[2] in NIGHT))):
    pos = np.array([s[0] for c, s in zip(clips, scores) if sel(c) and c[1] == 'snore'])
    neg = np.array([s[0] for c, s in zip(clips, scores) if sel(c) and c[1] == 'other'])
    print(f'\n{name}: AUC {auc(pos, neg):.3f} (snoring {len(pos)}, others {len(neg)})')
    for t in (0.05, 0.1, 0.2, 0.3, 0.5):
        print(f'  snoring score >= {t:<4}: snoring found {100 * np.mean(pos >= t):5.1f}%   others counted {100 * np.mean(neg >= t):5.1f}%')

# Cut at 4 and 2 kHz (levelled, as in a pipeline).
print('\nSnoring cut at a frequency (levelled to -20 dBFS): share with a snoring score >= 0.5')
for name, sel in (('ESC-50 snoring', lambda c: c[0] == 'esc50' and c[1] == 'snore'), ('Khan snoring (first 200)', lambda c: c[0] == 'khan' and c[1] == 'snore')):
    xs = [c[3] for c in clips if sel(c)][:200]
    for hz in (8000, 4000, 2000):
        s = np.array([yamnet.judge(cut(x, hz) if hz < 8000 else x)[0] for x in xs])
        print(f'  {name:26s} up to {hz:>4} Hz: {100 * np.mean(s >= 0.5):5.1f}%   median score {np.median(s):.3f}')
