# AGENTS.md

Snorewatch: a static browser app that records a night with the phone microphone,
keeps only short snore clips and reports on them. **Read `docs/HANDOVER.md` first** (state,
decisions, known issues, next task). Answers to the three reviews (v1.9.1,
`a87c1f3`, `8e05d2b`): `docs/REVIEW-RESPONSE.md`. General working rules: `docs/WORKING-RULES.md`.

## Rules
- Never commit to `main`. Branch from the latest `main`, open a pull request,
  merge only when CI is green. Agents may merge their own PRs and the release
  workflow creates the version tag; agents cannot push tags themselves.
- Bump the version in `package.json` and `js/version.js` together (a test checks).
- Ask the owner before changing counting rules, thresholds or defaults, deleting
  data, or changing repository settings. New detection rules run as background
  tests (shadow detectors) before they change the headline numbers.
- A change to what the detector computes also updates `docs/DETECTOR.md` and the
  reference outputs (`npm run reference -- --update`) in the same PR: the iPhone
  app ports the detector from them.
- Keep the privacy promise: only short snore clips keep audio; nothing is uploaded.
- Never commit recordings, report JSON/WAV from real nights, personal data,
  secrets or the ESC-50 dataset (CC BY-NC).
- Never skip, disable or weaken a test to get green; fix the cause.
- Plain HTML/CSS/JS without a build step or runtime dependencies; match the
  surrounding style.

## Verify
```bash
npm test                                   # unit tests (Node >= 18)
npm ci && npx playwright install chromium  # once, for the browser test and the linters
npm run lint                               # ESLint + Prettier check (Node >= 20.19); `npm run format` fixes formatting
npm run test:e2e                           # CHROMIUM_PATH=... to use an existing Chromium
for f in js/*.js scripts/*.js tests/*.js; do node --check "$f"; done
npm run eval:public                        # before detection changes (ESC-50, ~600 MB once)
npm run evaluate -- report.json            # compare a downloaded night with the current rules
npm run analyze -- night.wav               # run the analysis on a WAV file (data file + snores WAV)
```
ESLint (correctness rules) and Prettier (JavaScript only; CSS and HTML keep their
compact hand layout) run in CI; there is no type checker. Where `docs/WORKING-RULES.md`
differs (creating tags), the rules in this file apply. Record
results as in `docs/VERIFICATION.md`.
