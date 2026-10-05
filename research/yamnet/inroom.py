"""YAMNet on exactly the in-room audio the detector heard (from inroom.js), as recorded and turned
up to a fixed level first, side by side with the detector's verdict.

    python inroom.py <work dir>
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import yamnet  # noqa: E402

W = sys.argv[1]
NIGHT = set('breathing coughing sneezing laughing crying_baby footsteps door_wood_creaks door_wood_knock clock_tick clock_alarm mouse_click keyboard_typing water_drops drinking_sipping toilet_flush washing_machine vacuum_cleaner wind rain thunderstorm dog cat crickets engine car_horn'.split())
meta = json.load(open(os.path.join(W, 'meta.json')))
for m in meta:
    x = yamnet.to16k(np.fromfile(os.path.join(W, 'audio', m['raw']), dtype=np.float32), m['sr'])
    m['yamRaw'] = yamnet.judge(x, normalise=False)[0]
    m['yamLevelled'], _, m['top'] = yamnet.judge(x)
json.dump(meta, open(os.path.join(W, 'scored.json'), 'w'))
pct = lambda xs, f: 100 * np.mean([f(m) for m in xs]) if xs else float('nan')  # noqa: E731
print('snoring found / others counted, same in-room audio (Khan: all others; ESC-50: snoring vs night sounds)')
for level in (-50, -60, -66):
    for name, sel in (('Khan', lambda m: m['set'] == 'khan'), ('ESC-50', lambda m: m['set'] == 'esc50' and (m['label'] == 'snore' or m['cat'] in NIGHT))):
        ms = [m for m in meta if m['level'] == level and sel(m)]
        pos = [m for m in ms if m['label'] == 'snore']
        neg = [m for m in ms if m['label'] == 'other']
        line = f"{level} dBFS {name:7s} detector {pct(pos, lambda m: m['detFound']):5.1f}/{pct(neg, lambda m: m['detFound']):5.1f}"
        line += f"   YAMNet as heard >=0.1 {pct(pos, lambda m: m['yamRaw'] >= 0.1):5.1f}/{pct(neg, lambda m: m['yamRaw'] >= 0.1):5.1f}"
        for t in (0.1, 0.3, 0.5):
            line += f"   levelled >={t} {pct(pos, lambda m: m['yamLevelled'] >= t):5.1f}/{pct(neg, lambda m: m['yamLevelled'] >= t):5.1f}"
        print(line)
fa = {}
for m in meta:
    if m['set'] == 'esc50' and m['level'] == -50 and m['label'] == 'other' and m['cat'] in NIGHT and m['yamRaw'] >= 0.1:
        fa[m['cat']] = fa.get(m['cat'], 0) + 1
print('ESC-50 night sounds YAMNet (as heard, >= 0.1, -50 dBFS) scores as snoring:', dict(sorted(fa.items(), key=lambda kv: -kv[1])))
