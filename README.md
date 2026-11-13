# Better Get Involved

A Rutgers–New Brunswick student-engagement prototype built from the Group 6 AI4GOOD project brief. Explore organizations, get explainable recommendations, search in natural language, ask source-backed club questions, save events, and manage assigned organizations as an officer.

**Events and clubs are real Rutgers–New Brunswick data. This independent student project is not affiliated with Rutgers.** The Events and Today screens show live listings from Rutgers getINVOLVED and Rutgers Recreation, collected by [Scarlet Sync](https://scarletsync.app/support/developer-connectors) and refreshed every three hours (`backend/live_events.py`). The club directory comes from public organization profiles on The Arc, built by `scripts/build_rutgers_clubs.py` and loaded with `scripts/import_rutgers_clubs.py`. That catalog file (`data/rutgers_clubs.json`) is **not in Git** because it contains students' contact emails: use the shared Supabase database, or get the file privately from the team. Without it, the app starts with one labeled demo club (`data/demo_club.json`) for the demo officer account. The app does not provide verified Rutgers accounts or real event registration; live events link to getINVOLVED for RSVPs. Set `LIVE_EVENTS_SYNC=0` to run fully offline.

## Quick start

Requirements: Node.js 20.9+ (24 LTS recommended), pnpm 10, Python 3.12+, and a package download connection during setup. No API key or cloud account is required.

```bash
corepack enable
pnpm install --frozen-lockfile
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
python3 scripts/dev.py
```

# RUN .venv\Scripts\python scripts\dev.py

Open **http://127.0.0.1:3000**. Interactive API documentation is at **http://127.0.0.1:8000/docs**. On Windows, create the environment with `py -m venv .venv` and use `.venv\Scripts\python` for Python commands. The development launcher starts both servers and stops them with Ctrl+C. This workspace also has an ignored standard Node runtime in `.tools/node`; the launcher detects it when Node is not on PATH. Set `NODE_BINARY` to select another executable.

Browse and search as a guest. Students sign in with their Rutgers **ScarletMail Google account** (`@scarletmail.rutgers.edu`; see [Signing in with ScarletMail](#signing-in-with-scarletmail)). Signing in reveals club contact details (emails and Discord invites are withheld from guests) and enables follows, saves, and RSVPs. The first sign-in asks for a major, interests, and home campus; all are optional and editable in Profile.

| Local demo account | Password | Access |
| --- | --- | --- |
| `student@demo.local` | `StudentDemo2026!` | Private preferences, follows, saves, RSVP intentions |
| `officer@demo.local` | `OfficerDemo2026!` | Assigned demo organization content and event management |

Demo accounts are available only in `DEMO_MODE=1`, where email + password sign-in exists for them (and for tests). With `DEMO_MODE=0`, password sign-in and registration are switched off and Google is the only way in. A student cannot grant themselves officer access. These public fixture credentials must not be used for a real pilot.

## What's implemented

- Responsive student home, directory, recommendations, swipe discovery, events/calendar, saved items, and profile flows.
- Sign in with Google restricted to ScarletMail, first-run major/interests/campus onboarding, private saved items, and account deletion. Club contacts are visible only when signed in.
- Local hybrid keyword and dense LSA embedding search with deterministic campus/date/free/beginner constraints, and category-diverse recommendations.
- Club profiles with source and freshness information; extractive FAQ retrieval with evidence and missing-answer abstention.
- Event bookmarks, private interested/going intentions, calendar downloads, and cancelled-event handling.
- A Forums tab for club discussions: searchable posts with titles and text, club filters, recent-activity sorting, comments, author deletion, and content reports. Anyone can read; signed-in users can post and comment. Contributions are public and show the author's display name.
- Officer-only management of assigned club profiles/FAQs and event creation, editing, cancellation, duplicate protection, and aggregate engagement counts.
- Backend authorization, request validation, rate limiting, reporting, and reproducible synthetic evaluation fixtures.

The default reference date is **October 22, 2026**. Events are samples; relative-date queries in demo mode use that reference. Display times use `America/New_York`, including daylight-saving changes. Edit `DEMO_REFERENCE_DATE` to change the search reference.

### Club forums

Open **Forums** in the navigation or visit `/forums`. Choose **New post**, select a club, and enter a title and message. Open a post to read or add comments. Search matches titles, post text, and club names; the club filter narrows the results. Sort by newest posts or recent activity. Each discussion has a shareable `/forums/{id}` URL.

Posts and comments use the existing account system and persist in the configured SQLite or Supabase Postgres database. The API creates the new tables on startup without replacing existing records. Authors can delete their own contributions, and deleting an account removes its posts and comments. Discussion text is user-contributed content, separate from official club profile information and the FAQ assistant's sources.

## Architecture and scope

The frontend uses Next.js App Router, React and TypeScript; FastAPI owns the API, persistence, and retrieval. Data lives in Supabase Postgres when `DATABASE_URL` is set, and otherwise in a local SQLite file. Next.js proxies `/api` to the backend so cookies remain same-origin. Run both servers; the UI does not silently substitute fake data when the API fails.

Supabase is used as a Postgres database only: the FastAPI backend keeps its own accounts and authorization, and every table has row-level security enabled with no policies, so Supabase's public Data API cannot read them. The app uses **LSA rather than a pretrained embedding service**, and **extractive FAQ retrieval rather than generative RAG**. Those choices make the first build runnable without credentials and keep its behavior inspectable. They have explicit quality and deployment limits. See [architecture](docs/ARCHITECTURE.md), [API contract](docs/API_CONTRACT.md), and [data disclosure](data/README.md).

Real officer verification, production infrastructure, human research, and measured student impact remain to be completed. Secondary social matching, mobile apps, notification delivery, and flyer extraction are outside this build. This is a working local prototype, not a completed campus launch.

## Club owners and the club manager

Students who own a club see a **Club manager** tab (and a "Clubs you manage" list in Profile). There they can edit everything on their club's profile: name, short name, category, campus, tags, description, about text, meeting time and place, fee, eligibility, contact email, website, Instagram, Discord, accent color, and the published Q&A, and they can publish events. Owners can also upload a **logo** (PNG, JPEG, WebP, or GIF, up to 1 MB; SVG is refused because it can carry scripts). The server checks the file's actual bytes, stores it in the `club_logos` table, and serves it at `/api/clubs/{id}/logo`; it replaces the colored category tile on the club's page, cards, and discovery view. To bulk-load logos, list `{name, profile_url, image_url}` entries in a JSON file and run `scripts/import_club_logos.py <file> --dry-run`, then without `--dry-run`. It matches clubs by profile URL or name, downscales images to 320 px WebP when Pillow is installed (`pip install pillow`), and never overwrites a logo an owner uploaded unless you pass `--replace`. Ownership is checked on the server for every change; owning one club never grants access to another. Once owners edit an imported club, its profile is labeled as maintained by the club's owners.

Ownership is granted by site admins from the command line (there is no self-service claim yet):

```bash
.venv\Scripts\python scripts\manage_clubs.py add data\clubs\amogus-club.json
.venv\Scripts\python scripts\manage_clubs.py grant amogus-club sm3584 ap2999 amw408 akn74
.venv\Scripts\python scripts\manage_clubs.py revoke amogus-club ap2999
.venv\Scripts\python scripts\manage_clubs.py owners amogus-club
```

A bare NetID means `NetID@scarletmail.rutgers.edu`. Owners who haven't signed in yet are stored as pending (`club_owner_invites`) and get access at their first ScarletMail sign-in.

## Signing in with ScarletMail

The backend verifies Google's signed ID token and accepts only verified accounts on the ScarletMail Workspace domain (the token's `hd` claim must be `scarletmail.rutgers.edu`, so personal Gmail addresses are rejected). Set up a Google OAuth client once:

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project.
2. Open **Google Auth Platform** (APIs & Services > OAuth consent screen). Choose **External**, name the app, and add a support email. The default `openid`, `email`, and `profile` scopes are all the app needs. **Publish** the app (status *In production*); while it is in *Testing*, only listed test users can sign in. Apps that request only these basic scopes do not need Google's verification review.
3. Under **Clients** (Credentials), create an **OAuth client ID** of type **Web application**. Add **Authorized JavaScript origins**: `http://localhost`, `http://localhost:3000`, and later your public `https://` address. No redirect URI is needed.
4. Put the client ID in `.env` as `GOOGLE_CLIENT_ID=...` and restart. The ID is public; it is not a secret.
5. Open **http://localhost:3000** (Google does not accept `127.0.0.1` as an origin) and choose **Sign in**.

Rutgers' Google Workspace administrators control whether students may use third-party sign-in; if Rutgers blocks it, Google shows an error and the sign-in fails. `ALLOWED_EMAIL_DOMAINS` (comma-separated) changes the accepted domains. Without a client ID, only the local demo accounts can sign in.

## Using Supabase

1. In the Supabase dashboard, open your project and choose **Connect**. Copy the **Session pooler** connection string (it works on networks without IPv6) and replace `[YOUR-PASSWORD]` with the database password. URL-encode special characters in the password, for example `@` as `%40`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to that string. `.env` is ignored by Git; never commit it.
3. Optional: copy existing local accounts and saves with `.venv\Scripts\python scripts\migrate_to_supabase.py` (Windows) or `.venv/bin/python scripts/migrate_to_supabase.py`. It is safe to run twice.
4. Start the app with `python scripts/dev.py`. The backend creates its tables on first start; `/api/health` reports `"database": "postgres"`.

To run the API tests against Postgres as well, set `TEST_DATABASE_URL`. Each test uses a temporary schema that is dropped afterwards.

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

Environment variables are documented in [.env.example](.env.example). Export them in the terminal or set them through your hosting environment; `scripts/dev.py` loads `.env` for local development; elsewhere, set variables through the hosting environment. `API_URL` is the backend origin for the web proxy. `DATABASE_URL` selects Supabase Postgres; without it, `DATABASE_PATH` selects the persistent SQLite file. `ALLOWED_ORIGINS` must list exact browser origins for writes. Enable `COOKIE_SECURE=1` only behind HTTPS. Avoid putting secrets in browser-exposed variables or Git.

## Project evidence

- [Community research and user-testing protocol](docs/RESEARCH.md)
- [Privacy, safety, fairness, resource use, and mitigations](docs/SAFETY.md)
- [AI4GOOD rubric alignment and outstanding evidence](docs/RUBRIC.md)
- [Ten-minute demonstration runbook](docs/DEMO.md)
- [Implementation architecture and production migration](docs/ARCHITECTURE.md)

Public Rutgers sources establish local context, not demand for another platform. The research plan explicitly compares with **The Arc**, Rutgers' current involvement portal. No student interview, outside-user usability result, or confirmed attendance increase has been invented.
