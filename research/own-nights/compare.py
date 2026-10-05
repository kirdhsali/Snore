"""YAMNet's verdicts on your clips against your own listening judgements, and against the breath
rule. The judgements are time windows per night in judgements.json in the private folder (see
judgements.example.json: the owner's verdicts on nights 4-6 as recorded in docs/HANDOVER.md).

    $SNOREWATCH_DATA/venv/bin/python research/own-nights/compare.py [folder]   (after clips.py)
"""
import json
import os
import sys

DATA = os.environ.get('SNOREWATCH_DATA', os.path.join(os.path.expanduser('~'), '.cache', 'snorewatch'))
N = sys.argv[1] if len(sys.argv) > 1 else os.path.join(DATA, 'nights')
clips = json.load(open(os.path.join(N, 'yamnet-clips.json')))
judged = json.load(open(os.path.join(N, 'judgements.json')))


def auc(pos, neg):
    if not pos or not neg:
        return float('nan')
    return sum((p > q) + 0.5 * (p == q) for p in pos for q in neg) / (len(pos) * len(neg))


def inside(t, windows):
    return any(a <= t[:5] < b for a, b in windows)


def show(label, xs):
    if not xs:
        print(f'  {label:52s}     0')
        return
    tops = {}
    for x in xs:
        tops[x['yamTop']] = tops.get(x['yamTop'], 0) + 1
    top = ', '.join(f'{k} {v}' for k, v in sorted(tops.items(), key=lambda kv: -kv[1])[:3])
    print(f"  {label:52s} {len(xs):5d}   snoring >=0.5 {100 * sum(x['yam'] >= 0.5 for x in xs) / len(xs):5.1f}%   top classes: {top}")


for stamp, j in judged.items():
    if stamp not in clips:
        continue
    c = clips[stamp]
    print(f"\n{stamp}: {j.get('note', '')}")
    snoring = [x for x in c['snores'] if inside(x['local'], j.get('snoring', []))]
    noise = [x for x in c['snores'] if inside(x['local'], j.get('not_snoring', []))]
    show('counted sounds in the stretches judged snoring', snoring)
    show('counted sounds in the stretches judged not snoring', noise)
    if c['test']:
        show(f"test clips ({j.get('test_clips', 'not judged')})", c['test'])
    loud = sorted(c['snores'], key=lambda x: -x['aboveRoomDb'])[: j.get('loudest', 0)]
    for x in loud:
        print(f"  loudest counted: {x['local']} +{x['aboveRoomDb']} dB, YAMNet snoring {x['yam']:.2f} ({x['yamTop']})")
    if snoring and noise:
        print(f"  separation, judged snoring vs not (AUC; 0.5 = guessing): YAMNet {auc([x['yam'] for x in snoring], [x['yam'] for x in noise]):.2f}", end='')
        if all(x.get('breathRiseDb') is not None for x in snoring + noise):
            print(f", breath noise {auc([x['breathRiseDb'] for x in snoring], [x['breathRiseDb'] for x in noise]):.2f}")
            for name, keep in (('6 dB breath rule', lambda x: x['breathRiseDb'] >= 6), ('YAMNet >= 0.5', lambda x: x['yam'] >= 0.5), ('YAMNet >= 0.1', lambda x: x['yam'] >= 0.1)):
                print(f'  {name:18s} keeps {sum(map(keep, snoring))}/{len(snoring)} judged snoring, {sum(map(keep, noise))}/{len(noise)} judged not snoring')
        else:
            print()
    if snoring and c['test']:
        print(f"  separation, judged snoring vs test clips (AUC): YAMNet {auc([x['yam'] for x in snoring], [x['yam'] for x in c['test']]):.2f}")
    elif c['test']:
        confirmed = [x for x in c['snores'] if x.get('confirmed')]
        print(f"  separation, confirmed snores vs test clips (AUC): YAMNet {auc([x['yam'] for x in confirmed], [x['yam'] for x in c['test']]):.2f}")
