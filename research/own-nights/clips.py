"""YAMNet on every saved clip of your own nights: the snores WAV and the test-clip WAV that the app
downloads, matched to the data file by their WAV positions (wavStartSec; 0.4 s silence between
clips). Your files stay in a private folder outside the repository; the results are written there.

    $SNOREWATCH_DATA/venv/bin/python research/own-nights/clips.py [folder]
    folder (default $SNOREWATCH_DATA/nights) holds snore-report_<stamp>.json, snores_<stamp>.wav
    and, where the night has one, test-clips_<stamp>.wav. Writes yamnet-clips.json there.
"""
import glob
import json
import os
import sys
import wave
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import yamnet  # noqa: E402

N = sys.argv[1] if len(sys.argv) > 1 else os.path.join(yamnet.DATA, 'nights')
DEFAULT_TZ = os.environ.get('NIGHT_TZ', 'Europe/Zurich')  # files before 1.12.5 name no time zone


def read(path):
    w = wave.open(path)
    return w.getframerate(), np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768


def score_clips(items, wav):
    sr, x = read(wav)
    items = sorted([i for i in items if i.get('wavStartSec') is not None], key=lambda i: i['wavStartSec'])
    for k, i in enumerate(items):
        end = items[k + 1]['wavStartSec'] - 0.4 if k + 1 < len(items) else len(x) / sr
        seg = x[int(i['wavStartSec'] * sr):int(end * sr)]
        i['yam'], i['yamBr'], i['yamTop'] = yamnet.judge(yamnet.to16k(seg, sr), centre=True)
    return items


out = {}
for report in sorted(glob.glob(os.path.join(N, 'snore-report_*.json'))):
    stamp = os.path.basename(report)[len('snore-report_'):-len('.json')]
    r = json.load(open(report))
    tz = ZoneInfo(r.get('timeZone') or DEFAULT_TZ)
    start = datetime.fromisoformat(r['startedAt'].replace('Z', '+00:00'))
    local = lambda off: datetime.fromtimestamp(start.timestamp() + off, tz).strftime('%H:%M:%S')  # noqa: E731
    for s in r['snores']:
        s['local'] = local(s['offsetSec'])
    night = {'stamp': stamp, 'snores': [], 'test': []}
    if os.path.exists(os.path.join(N, f'snores_{stamp}.wav')):
        night['snores'] = score_clips(r['snores'], os.path.join(N, f'snores_{stamp}.wav'))
    if os.path.exists(os.path.join(N, f'test-clips_{stamp}.wav')):
        tc = [dict(x, test=name, local=local(x['offsetSec'])) for name, sh in (r.get('shadows') or {}).items() for x in sh['snores'] if x.get('wavStartSec') is not None]
        night['test'] = score_clips(tc, os.path.join(N, f'test-clips_{stamp}.wav'))
    out[stamp] = night
    print(stamp, 'snore clips', len(night['snores']), 'test clips', len(night['test']))
json.dump(out, open(os.path.join(N, 'yamnet-clips.json'), 'w'))
