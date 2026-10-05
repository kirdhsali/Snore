"""PSG-Audio night, pass 2: YAMNet scores for every candidate sound (Normal's and High's events)
from the room microphone at 16 kHz (mic16k.f32 from pass1.js).

    python candidates.py <night dir>      writes events-ai.json next to events.json
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import yamnet  # noqa: E402

D = sys.argv[1]
x = np.memmap(os.path.join(D, 'mic16k.f32'), dtype=np.float32, mode='r')
ev = json.load(open(os.path.join(D, 'events.json')))
for k in ('normal', 'high'):
    for e in ev['events'][k]:
        if e['d'] > 8:  # long sounds are not snores; not scored
            continue
        need = max(e['d'] + 0.4, 0.975)  # the sound plus 0.2 s either side, at least one window
        a = max(0, int((e['t'] + e['d'] / 2 - need / 2) * 16000))
        seg = np.array(x[a:a + int(np.ceil(need * 16000))], dtype=np.float32)
        e['yam'], e['yamBr'], e['yamTop'] = yamnet.judge(seg)
json.dump(ev, open(os.path.join(D, 'events-ai.json'), 'w'))
print('scored', {k: sum('yam' in e for e in ev['events'][k]) for k in ('normal', 'high')})
