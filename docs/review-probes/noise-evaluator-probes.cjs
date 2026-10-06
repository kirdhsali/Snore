/*
 * Appendix of docs/reviews/2026-10-05-8e05d2b-review.md (N1, N2), adapted to take the
 * checkout as an argument and to print the exact re-count where the checkout has one
 * (`recount`, from 1.22.1). Run: node docs/review-probes/noise-evaluator-probes.cjs "$PWD"
 *
 * Before the fixes (1.22.0): N1 prints one stretch and one loud period 1200-5520 s across
 * the missing hour 1560-5160 s; N2 prints 2 versus 0 twice.
 */
const path = require('node:path');
const repo = process.argv[2];
const get = (name) => require(path.join(repo, name));
const N = get('js/noise.js');
const E = get('scripts/evaluate.js');
const { SessionStats } = get('js/stats.js');

// N1: 20 quiet minutes, 6 louder, an hour not recorded, 6 louder, 20 quiet.
const bandsHz = [31.5, 63, 125, 250, 500, 1000, 2000, 4000];
const minutes = Array.from({ length: 52 }, (_, i) => {
  const raised = i >= 20 && i < 32;
  return {
    t: (i + (i >= 26 ? 60 : 0)) * 60,
    quietSec: 55,
    backgroundDb: raised ? -81 : -89,
    p90Db: raised ? -79 : -87,
    bandsDb: bandsHz.map((hz) => (raised && hz >= 500 ? -97 : -105)),
    humHz: null,
  };
});
const s = N.summarize({ minuteSec: 60, bandsHz, minutes });
console.log(
  'N1 stretches:',
  JSON.stringify(s.stretches.map((x) => [x.start, x.end])),
  'masked:',
  JSON.stringify(s.masked.map((x) => [x.start, x.end])),
);
console.log(
  'N1 text:',
  JSON.stringify(N.describe(s, (sec) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`)),
);

// N2 used the automatic-sensitivity test's rules, removed in 1.24.0: it runs against checkouts up to 1.23.0.
if (!get('js/detector.js').SENSITIVITY.auto) {
  console.log('N2: not applicable from 1.24.0 (the automatic-sensitivity test and its rules were removed)');
  process.exit(0);
}

// N2: two rattles at 2 and 6 s that only a smooth snore at 10 s rescues.
const make = (start, peaks, breathRise, preRise100) => ({
  start,
  end: start + 1,
  duration: 1,
  relDb: 20,
  peakDb: -35,
  lowRatio: 0.95,
  highRatio: 0.03,
  centroid: 200,
  subBass: 0.1,
  fill: 0.85,
  peaks,
  breathRise,
  lowRise: 15,
  preRise100,
  onsetJump: 10,
  wasSnore: true,
  wasReason: null,
});
const events = [make(2, 4, 8, 10), make(6, 4, 8, 10), make(10, 1, 4, 7)];
const opts = { sensitivity: 'auto', minBreathRiseDb: 3, minLowRiseDb: 8, minPreRiseDb: 6, preRiseSec: 1 };
const accepted = E.reevaluate(events, opts);
const sh = {
  snores: accepted.map((x) => ({
    offsetSec: x.start,
    durationSec: x.duration,
    aboveRoomDb: x.relDb,
    breathRiseDb: x.breathRise,
    preRise100Db: x.preRise100,
  })),
};
const count = (xs) => {
  const st = new SessionStats();
  xs.forEach((x) => st.add({ ...x, clip: null }));
  return st.confirmed.length;
};
console.log(
  'N2 breath 6 dB, estimate / full rules:',
  E.stricterBreath(sh, 6),
  count(E.reevaluate(events, { ...opts, minBreathRiseDb: 6 })),
);
console.log(
  'N2 pre-rise 8 dB, estimate / full rules:',
  E.preRiseVariant(sh, 1, 8).length,
  count(E.reevaluate(events, { ...opts, minPreRiseDb: 8 })),
);
if (E.recount) {
  // The same sounds as a 1.22.1 data file stores them: every feature and the rescue flag.
  const full = {
    sensitivity: 'auto',
    minBreathRiseDb: 3,
    minLowRiseDb: 8,
    minPreRiseDb: 6,
    preRiseSec: 1,
    snores: accepted.map((x) => ({
      offsetSec: x.start,
      durationSec: x.duration,
      aboveRoomDb: x.relDb,
      lowFrequencyShare: x.lowRatio,
      highFrequencyShare: x.highRatio,
      centroidHz: x.centroid,
      bursts: x.peaks,
      subBassShare: x.subBass,
      loudFill: x.fill,
      breathRiseDb: x.breathRise,
      lowRiseDb: x.lowRise,
      onsetJumpDb: x.onsetJump,
      preRise100Db: x.preRise100,
      rhythmRescued: !!x.rhythm,
    })),
    setAside: [],
  };
  console.log(
    'N2 recount (1.22.1+): own rules',
    E.recount(full).length,
    '· breath 6 dB',
    E.recount(full, { minBreathRiseDb: 6 }).length,
    '· pre-rise 8 dB',
    E.recount(full, { minPreRiseDb: 8 }).length,
  );
} else console.log('N2 recount: not in this checkout (before 1.22.1)');
