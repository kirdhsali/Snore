"""Sort every sound of one of your nights (counted and ignored, from the data file) into groups of
similar sounds (k-means on the stored measurements), then describe each group without labels:
size, share counted, rhythm (another sound of the group 2.5-8 s away), pitch, breath noise,
duration, loudness, YAMNet's median score (counted sounds with clips, from clips.py) and when it
happened. A snore group stands out by rhythm, breath noise and timing; hum swells by a ~50-70 Hz
centroid with little breath noise.

    $SNOREWATCH_DATA/venv/bin/python research/own-nights/groups.py <stamp> [k] [folder]
"""
import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np

DATA = os.environ.get('SNOREWATCH_DATA', os.path.join(os.path.expanduser('~'), '.cache', 'snorewatch'))
stamp = sys.argv[1]
k = int(sys.argv[2]) if len(sys.argv) > 2 else 6
N = sys.argv[3] if len(sys.argv) > 3 else os.path.join(DATA, 'nights')
r = json.load(open(os.path.join(N, f'snore-report_{stamp}.json')))
tz = ZoneInfo(r.get('timeZone') or os.environ.get('NIGHT_TZ', 'Europe/Zurich'))
yam = {}
if os.path.exists(os.path.join(N, 'yamnet-clips.json')):
    for x in json.load(open(os.path.join(N, 'yamnet-clips.json'))).get(stamp, {}).get('snores', []):
        yam[x['offsetSec']] = x['yam']
ev = [dict(x, counted=True) for x in r['snores']] + [dict(x, counted=False) for x in r['ignored']]
ev = [e for e in ev if e.get('lowFrequencyShare') is not None and e.get('centroidHz') is not None and e.get('breathRiseDb') is not None and e['durationSec'] <= 4]
ev.sort(key=lambda e: e['offsetSec'])
for e in ev:
    e['hour'] = datetime.fromisoformat(e['time'].replace('Z', '+00:00')).astimezone(tz).strftime('%H')
F = np.array([[np.log(max(e['centroidHz'], 30)), e['lowFrequencyShare'], e['highFrequencyShare'], e.get('subBassShare') or 0, e['breathRiseDb'],
               np.log(e['durationSec']), e['aboveRoomDb'], min(e.get('bursts') or 1, 6), e.get('loudFill') or 0.5] for e in ev])
Z = (F - F.mean(0)) / (F.std(0) + 1e-9)
rng = np.random.default_rng(1)
best = None
for _ in range(8):  # k-means, best of 8 starts
    C = Z[rng.choice(len(Z), k, replace=False)]
    for _ in range(100):
        lab = ((Z[:, None, :] - C[None]) ** 2).sum(-1).argmin(1)
        C2 = np.array([Z[lab == j].mean(0) if (lab == j).any() else C[j] for j in range(k)])
        if np.allclose(C, C2):
            break
        C = C2
    inertia = ((Z - C[lab]) ** 2).sum()
    if best is None or inertia < best[0]:
        best = (inertia, lab)
lab = best[1]
t = np.array([e['offsetSec'] for e in ev])
print(f'{stamp}: {len(ev)} sounds ({sum(e["counted"] for e in ev)} counted), {k} groups')
print(' group     n  counted  rhythm  centroid  low share  breath dB  duration  +dB  YAMNet  | sounds per local hour')
for j in sorted(range(k), key=lambda j: -(lab == j).sum()):
    idx = np.where(lab == j)[0]
    tt = t[idx]
    rhythm = np.mean([np.any((np.abs(tt - x) >= 2.5) & (np.abs(tt - x) <= 8)) for x in tt])
    ys = [yam[ev[i]['offsetSec']] for i in idx if ev[i]['offsetSec'] in yam]
    hours = {}
    for i in idx:
        hours[ev[i]['hour']] = hours.get(ev[i]['hour'], 0) + 1
    when = ' '.join(f'{h}:{n}' for h, n in sorted(hours.items(), key=lambda kv: (int(kv[0]) + 12) % 24))
    med = lambda key: np.median([ev[i][key] for i in idx])  # noqa: E731
    print(f" {j:5d} {len(idx):5d}  {100 * np.mean([ev[i]['counted'] for i in idx]):6.0f}%  {100 * rhythm:5.0f}%  {np.median(np.exp(F[idx, 0])):6.0f} Hz  {med('lowFrequencyShare'):8.2f}  {med('breathRiseDb'):9.1f}  {med('durationSec'):7.2f} s {med('aboveRoomDb'):5.1f}  {np.median(ys) if ys else float('nan'):5.2f}  | {when}")
