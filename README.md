# Better Get Involved

A Rutgers–New Brunswick student-engagement prototype built from the Group 6 AI4GOOD project brief. Explore organizations, get explainable recommendations, search in natural language, ask source-backed club questions, save events, and manage assigned organizations as an officer.

**Current data is fictional and explicitly labeled demo data. This independent student project is not affiliated with Rutgers.** The app does not provide live university listings, verified Rutgers accounts, or real event registration.

## Quick start

Requirements: Node.js 20.9+ (24 LTS recommended), pnpm 10, Python 3.12+, and a package download connection during setup. No API key or cloud account is required.

```bash
corepack enable
pnpm install --frozen-lockfile
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
python3 scripts/dev.py
```

Open **http://127.0.0.1:3000**. Interactive API documentation is at **http://127.0.0.1:8000/docs**. On Windows, create the environment with `py -m venv .venv` and use `.venv\Scripts\python` for Python commands. The development launcher starts both servers and stops them with Ctrl+C. This workspace also has an ignored standard Node runtime in `.tools/node`; the launcher detects it when Node is not on PATH. Set `NODE_BINARY` to select another executable.

Browse and search as a guest, or register with a display name, email, and password of at least 12 characters. Interests and campus preferences are optional; onboarding can be skipped.

| Local demo account | Password | Access |
| --- | --- | --- |
| `student@demo.local` | `StudentDemo2026!` | Private preferences, follows, saves, RSVP intentions |
| `officer@demo.local` | `OfficerDemo2026!` | Assigned demo organization content and event management |

Demo accounts are available only in `DEMO_MODE=1`; the API restricts demo hosts to local addresses. A registered student cannot grant themselves officer access. These public fixture credentials must not be used for a real pilot.

## What's implemented

- Responsive student home, directory, recommendations, swipe discovery, events/calendar, saved items, and profile flows.
- Persistent registration/login/logout, optional editable interests, private saved items, and account deletion.
- Local hybrid keyword and dense LSA embedding search with deterministic campus/date/free/beginner constraints, and category-diverse recommendations.
- Club profiles with source and freshness information; extractive FAQ retrieval with evidence and missing-answer abstention.
- Event bookmarks, private interested/going intentions, calendar downloads, and cancelled-event handling.
- Officer-only management of assigned club profiles/FAQs and event creation, editing, cancellation, duplicate protection, and aggregate engagement counts.
- Backend authorization, request validation, rate limiting, reporting, and reproducible synthetic evaluation fixtures.

The default reference date is **October 22, 2026**. Events are samples; relative-date queries in demo mode use that reference. Display times use `America/New_York`, including daylight-saving changes. Edit `DEMO_REFERENCE_DATE` to change the search reference.

## Architecture and scope

The frontend uses Next.js App Router, React and TypeScript; FastAPI owns the API, local SQLite persistence and retrieval. Next.js proxies `/api` to the backend so cookies remain same-origin. Run both servers; the UI does not silently substitute fake data when the API fails.

This local implementation uses **SQLite rather than Supabase/PostgreSQL/pgvector**, **LSA rather than a pretrained embedding service**, and **extractive FAQ retrieval rather than generative RAG**. Those choices make the first build runnable without credentials and keep its behavior inspectable. They have explicit quality and deployment limits. See [architecture](docs/ARCHITECTURE.md), [API contract](docs/API_CONTRACT.md), and [data disclosure](data/README.md).

Real officer verification, email verification/recovery, authorized live data, Supabase RLS, production infrastructure, human research, and measured student impact remain to be completed. Secondary social matching, mobile apps, notification delivery, and flyer extraction are outside this build. This is a working local prototype, not a completed campus launch.

## Checks and evaluation

```bash
pnpm typecheck
pnpm build
.venv/bin/python -m pytest backend/tests -q
.venv/bin/python scripts/evaluate.py
```

The evaluation command compares keyword and hybrid retrieval on labeled synthetic queries, reports Recall@K/Precision@K and per-query errors, checks FAQ relevance/support/abstention, and records compute proxies. Its labels are hand-authored fixtures, not independent student judgments. Similarity scores are not probabilities, and a citation alone does not prove an answer is relevant. See [evaluation results](docs/EVALUATION.md) for actual measured outcomes and limits.

With both servers running, `.venv/bin/python scripts/smoke.py` verifies the browser-facing API connection and cleans up its temporary test account. See the [verification record](docs/VERIFICATION.md) for passed checks and the browser-permission limitation.

## Running the built app

```bash
pnpm build
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

In another terminal, run `pnpm start`. For a containerized local installation, use `docker compose up --build`; the API database persists in a named volume and the web port binds to the local machine. Docker execution has separate environment requirements; see the verification record for what was actually tested.

Environment variables are documented in [.env.example](.env.example). Export them in the terminal or set them through your hosting environment; the Python API does not automatically load `.env` files. `API_URL` is the backend origin for the web proxy. `DATABASE_PATH` selects the persistent SQLite file. `ALLOWED_ORIGINS` must list exact browser origins for writes. Enable `COOKIE_SECURE=1` only behind HTTPS. Avoid putting secrets in browser-exposed variables or Git.

## Project evidence

- [Community research and user-testing protocol](docs/RESEARCH.md)
- [Privacy, safety, fairness, resource use, and mitigations](docs/SAFETY.md)
- [AI4GOOD rubric alignment and outstanding evidence](docs/RUBRIC.md)
- [Ten-minute demonstration runbook](docs/DEMO.md)
- [Implementation architecture and production migration](docs/ARCHITECTURE.md)

Public Rutgers sources establish local context, not demand for another platform. The research plan explicitly compares with **The Arc**, Rutgers' current involvement portal. No student interview, outside-user usability result, or confirmed attendance increase has been invented.
