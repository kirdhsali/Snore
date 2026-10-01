# Working rules (general)

General rules for building software with Claude Code on GitHub. They are not
specific to this project; copy this file as `CLAUDE.md` into the root of any
new repository and Claude Code will follow it from the first session. In this
repository, `CLAUDE.md` and `AGENTS.md` summarise them and add project specifics.

## Principles

1. `main` is always working and is exactly what is live.
2. Every change goes: branch → pull request → automated tests green → merge → automatic deploy.
3. Everything needed to test, build and deploy lives in the repository. No manual steps that only one person knows.
4. Every release has a version number that can be seen in the product and is tagged in git.
5. Any change can be undone.

## Branches

- Never commit directly to `main`. Start each change from the latest `main`.
- One branch per change, short-lived (hours to a few days). Name it
  `feat/…`, `fix/…`, `docs/…` or `chore/…`, or use the branch the Claude session assigns.
- To catch up with `main`, merge `main` into the branch. Never rewrite history
  that others may have (no force-push, no rebase of pushed commits).
- Delete branches once they are merged.

## Commits

- One logical change per commit. The subject line is imperative and at most 72 characters ("Add export as image").
  The body says why and anything non-obvious.
- Run the tests locally before pushing.
- Never commit secrets (keys, passwords, tokens), personal data, build output or
  installed dependencies. Keep them out with `.gitignore`; secrets go in GitHub Secrets.

## Pull requests

- The description covers what changed, why, and how it was tested. Keep pull requests small enough to review.
- CI must be green before merging: formatting/lint, unit tests, and an end-to-end test of the most important user flow.
- Claude may merge its own pull requests into `main` when CI is green, and may create version tags.
- Ask the owner first for anything risky or hard to undo: deleting data or
  files people rely on, database or data-format migrations, security or
  permission changes, anything that costs money, repository or cloud settings,
  and changes outside the agreed scope.
- Never disable, skip or weaken a test to make CI green. Fix the cause.

## Tests

- Every feature and bug fix comes with a test. All tests run with one command (for example `npm test`).
- Provide a way to test without real-world conditions: demo mode, sample data, simulated input.
- If a test fails only on CI, treat it as a real bug. Reproduce it, fix it, and never just re-run until it passes.

## Deployment

- CI runs on every push and every pull request.
- Only `main` deploys, automatically, through a workflow in `.github/workflows/`.
- The deploy stamps the version and short commit hash into the product (for
  example in the footer), so anyone can tell which build they are running.
  Web apps get cache-busting so users load the new build.

## Versions and releases

- Semantic versioning `MAJOR.MINOR.PATCH`: breaking change → major, new feature → minor, fix → patch.
- The version is defined in one place (for example `package.json`); a test
  checks that any copy matches it.
- When a new version reaches `main`, a workflow creates the tag `vX.Y.Z` and a GitHub release with notes.

## Undoing a change

- Revert the pull request's merge commit through a new pull request. The previous state is redeployed automatically.
- Tags mark every released version, for comparing or going back.

## Communication

- After each change, report: the pull request link, what changed, test results, and anything the owner has to do.
- Settings Claude cannot change (repository settings, permissions, secrets):
  give exact click paths and verify the result afterwards.
- If blocked, say what is blocking and propose the next step. Don't work around it silently.

## One-time setup per repository (done by the owner)

1. Create the repository on GitHub and give Claude access (Claude GitHub app / connect GitHub in claude.ai).
2. Name the default branch `main` (Settings → General → Default branch).
3. For web apps on GitHub Pages: Settings → Pages → Source: **GitHub Actions**,
   and Settings → Environments → `github-pages` → allow the branch `main`.
4. Recommended: Settings → Rules → protect `main` (require a pull request and passing status checks, block force pushes).
5. Tell Claude once: "You may merge into main yourself when the tests pass, and set tags."
