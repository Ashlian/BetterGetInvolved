# Local API

From the repository root:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/uvicorn backend.app:app --host 127.0.0.1 --port 8000
.venv/bin/python -m pytest backend/tests -q
```

Next.js proxies `/api` to the loopback API. Use the web app at
`http://localhost:3000`; browser writes require an allowed `Origin` header.
For command-line writes, pass `Origin: http://localhost:3000` explicitly.

`DEMO_MODE=1` is the local default. It imports the explicitly fictional clubs
and events in `data/seed.json` into `backend/local.db`, idempotently, and creates:

| Account | Password | Access |
| --- | --- | --- |
| student@demo.local | StudentDemo2026! | Private student profile and saves |
| officer@demo.local | OfficerDemo2026! | First seed club: Scarlet AI Collective |

These credentials are public demo fixtures. Bind only to loopback. Default demo
host checks allow localhost, 127.0.0.1, ::1 and testserver; a trusted local Docker
network can add its service hostname with `DEMO_ALLOWED_HOSTS`. The hostname
check is defense in depth; the network binding remains the access boundary.
Setting `DEMO_MODE=0` removes these two known accounts and their sessions from an
existing database. It does not turn synthetic club data into live campus data.
New registrations always receive the student role. Assignments for real officers
need a separate trusted administrator process; there is no self-promotion API.

Configuration:

- `DATABASE_PATH`: defaults to `backend/local.db`.
- `DEMO_REFERENCE_DATE`: `2026-10-22` by default in demo mode; fixes relative
  searches for repeatable evaluation. Live mode uses America/New_York's date.
- `ALLOWED_ORIGINS`: comma-separated exact origins, defaults to localhost and
  127.0.0.1 on ports 3000 and 8000. Includes no wildcard.
- `DEMO_ALLOWED_HOSTS`: comma-separated local hostnames; defaults above.
- `COOKIE_SECURE`: defaults to 0 in the loopback demo, 1 outside demo mode.
  Use HTTPS for any deployment with actual accounts.

Passwords use salted scrypt with N=32768, r=8, p=3 (32 MiB working memory).
Opaque random session tokens are stored only as SHA-256 digests in SQLite;
HTTP-only SameSite=Lax cookies expire after seven days. Session reads check
expiry, login rotates the browser's old session, logout revokes it, and account
deletion cascades through private preferences, actions, reports and sessions.
All writes enforce exact allowed Origins. Per-client in-memory limits cover
authentication (15/min), FAQ retrieval (25/min) and general routes (300/min).
These rate limits are per process; production needs a shared limiter, trusted
reverse proxy configuration, identity verification/recovery, migrations, managed
secrets, backups, and an operational incident process.

Club and event public text is indexed with local TF-IDF (unigrams/bigrams) and
TruncatedSVD LSA (up to 64 dimensions, limited by corpus size), fixed random seed
42 and normalized dense vectors. The fitted index is cached in memory until the
public catalog changes. Hybrid scores are 55% lexical and 45% LSA cosine;
they are similarities, not calibrated confidence or match percentages. The
small documented synonym dictionary in `search.py` expands common campus
vocabulary before indexing. LSA learns from the demo corpus, so it has limited
paraphrase understanding and is not a pretrained language model.

Search extracts campus, beginner, free, relative/ISO dates and before/after
AM/PM time constraints deterministically. Relative weeks use the remaining
current week or the next Monday–Sunday; weekends use the upcoming Saturday–Sunday
or the remaining current weekend. Event dates and time constraints use New York
time. Exact filter parameters combine with the topic query. Class schedule
availability, travel time, arbitrary price ranges and unrecognized natural
language constraints are not inferred. Recommendations use private explicit
interests/goals and followed club interests, a small campus/beginner preference,
and a soft category-diversity penalty. Dismissed clubs are excluded.

FAQ answers are retrieved verbatim from this club's structured FAQ records,
with a source title, internal club URL and quoted excerpt. The question and
answer text are scored separately (65% question, 35% full passage TF-IDF), with
minimum score/content-word coverage and instruction-injection refusal. Unknown
questions abstain. No generative model, prompt execution, private-user context,
or external fetch participates in answering. Source records must still be
reviewed by accountable club administrators before any real-world use.
When an officer changes schedule, location, dues or eligibility fields, matching
generic FAQ passages are synchronized from those fields in the same transaction;
equipment and safety FAQs remain separately authored. A real student account
whose email collides with a known demo fixture is never promoted during startup.

See the root evaluation script for the synthetic lexical-vs-hybrid comparison.
The hand-authored fixture is a reproducible smoke test, not independent evidence
of accuracy, fairness, accessibility or social impact.
