# Verification record

Run date: October 22, 2026. Local macOS ARM64 workspace, Node 24.21.0, Python 3.14, Next.js 16.4.2 and React 19.3.1. Direct Python dependencies are pinned; the web dependency resolution is recorded in `pnpm-lock.yaml`.

| Check | Result | Scope |
| --- | --- | --- |
| Next.js optimized production build | Passed | Compilation, TypeScript, root page, club/event dynamic routes, API gateway |
| TypeScript `--noEmit` | Passed | Frontend and API proxy types |
| Targeted Eastern Time conversion | Five cases passed | Normal October time, November standard time, pre-change midnight, rejected spring gap and rejected ambiguous fall hour |
| Backend pytest suite | 14 passed | Authentication/session lifecycle, account ownership/deletion, officer scoping, input validation, duplicate/update/cancel behavior, source-backed FAQ/abstention, filters, persistence and audit regressions |
| Connected application smoke test | 21 passed | Home/club/event HTTP routes, browser-facing gateway, HTTP-only cookies, login persistence, profile/saved state, recommendations, student write denial, FAQ citations, calendar output and cleanup; exercised in development and production servers |
| Frozen dependency lock check | Passed | Offline pnpm frozen-lockfile validation |
| Synthetic AI evaluation | Completed; errors disclosed | 28 club records; 18 queries, 14 FAQ cases, nine preference profiles. See EVALUATION.md/JSON |
| Fixture generator consistency checks | Passed | 28 clubs, 41 events, references, synthetic labels, dates, durations, Eastern DST offsets |
| Browser visual/interaction QA | Blocked | No browser surface was enabled; native Chrome access reported “Computer Use permissions are not granted” |
| External user/assistive-technology testing | Not performed | Requires willing participants and consent |
| Docker/cloud deployment | Not executed | Dockerfiles/Compose provided; no public deployment, Supabase instance or real data integration claimed |

The backend suite emits an upstream AnyIO/Starlette test-client deprecation warning; it does not fail the checks. Standard Node was downloaded from the official nodejs.org distribution into an ignored local tools directory because the app-bundled Node runtime refused the native Next compiler under macOS code-signing restrictions. No OS security settings were changed.

## Reproduce

```bash
pnpm typecheck
pnpm build
.venv/bin/python -m pytest backend/tests -q
.venv/bin/python scripts/evaluate.py
python3 data/build_fixtures.py
```

Start both servers with `python3 scripts/dev.py`, then in another terminal:

```bash
.venv/bin/python scripts/smoke.py
```

The connected smoke test creates and removes one synthetic student account. It does not require or transmit real student data. It requires a running API and frontend, and the tested browser origin must be permitted by the backend.

Automated checks do not establish visual quality, complete accessibility, production readiness, or social impact. Review desktop/mobile layouts in a permitted browser, conduct outside-team task testing, and replace synthetic content with authorized real records before a campus pilot.
