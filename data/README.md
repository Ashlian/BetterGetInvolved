# Demo data and evaluation fixtures

Every organization, event, meeting, membership condition, fee, and FAQ in these files is **synthetic**. Organization names were invented for this prototype. They are not actual Rutgers organizations, official listings, verified campus events, research participants, community partnerships, or evidence of community need. Names of campuses and student centers provide familiar geographic context only. Every room and meeting schedule is a sample. Do not travel to an event, send a payment, or contact an organization based on this dataset.

The dataset contains 28 fictional organizations across ten categories and 41 fictional events between **October 22 and November 8, 2026**. The dates are fixed for a reproducible demonstration; they do not mean an event is currently happening. All events have `is_demo: true`, every organization has `verification: "demo"`, and visible organization/event names include `(Demo)`. One event is cancelled to exercise that UI state. No actual registration, reservation, attendance, or payment is represented.

`seed.json` follows the exact public schemas in [API_CONTRACT.md](../docs/API_CONTRACT.md). Its top-level keys are `clubs` and `events`.

| Record | Fields |
| --- | --- |
| Club | `id`, `name`, `short_name`, `category`, `description`, `mission`, `interests`, `campus`, `location`, `meeting_schedule`, `beginner_friendly`, `membership_fee`, `eligibility`, `contact_email`, `website`, `instagram`, `discord`, `faqs`, `source_url`, `updated_at`, `verification`, `color`, `featured` |
| FAQ | `question`, `answer` |
| Event | `id`, `club_id`, `club_name`, `title`, `description`, `starts_at`, `ends_at`, `campus`, `location`, `category`, `cost`, `beginner_friendly`, `registration_url`, `accessibility`, `source_url`, `updated_at`, `status`, `is_demo` |

IDs are stable slugs, organization links use `/clubs/{id}`, and event links use `/events/{id}`. These internal links identify the sample record from which an answer was drawn; they are not independent evidence. External website, social, and registration links are empty. Emails use the reserved example domain `example.org` and are placeholders. The app should not attempt to send email to them. Costs and dues are illustrative amounts; no money is collected. Sample accessibility descriptions are plans rather than verified room accommodations.

Timestamps use ISO 8601 offsets from `America/New_York`. Daylight saving time ends on November 1, 2026: events before the change use `-04:00`, and events after it use `-05:00`. All November 1 events are after the time change. The fixed `updated_at` value is October 22, 2026 at 9:00 AM Eastern.

`evaluation.json` is a small, hand-authored smoke-test set, with synthetic label disclosure in `metadata`:

- `semantic_queries`: natural-language query, optional `campus`/`category`/`beginner` filters, and an ordered list of plausible relevant organization IDs. Multiple clubs may be useful. Lists are illustrative, not exhaustive ground truth.
- `faq_cases`: club-specific questions, expected grounded-support boolean, and case-insensitive answer fragments for supported cases. Missing data, tuition/scholarship guarantees, private contact information, and prompt-injection attempts must not lead to invented answers. An unsupported answer should say the available record cannot establish the requested detail.
- `recommendation_personas`: fictional interests, goals, campus, and plausible relevant IDs. These profiles contain no real personal data or protected-class targeting rules. A first-generation interest is an explicit user-selected community interest, not an inferred attribute.

These fixtures are authored alongside the demonstration and cannot establish production retrieval accuracy, fairness, safety, accessibility, or social impact. The app's evaluation command should report measured results and abstentions honestly. Real student interviews, independently labeled queries, real organization consent, verified event feeds, and external usability testing remain separate work.

Reproduce all generated fixtures with Python 3.9+ and the system time-zone database:

```sh
python3 data/build_fixtures.py
```

The generator makes no network requests and needs no API key. It checks ID uniqueness, references, demo disclosure, record counts, event durations, date bounds, and daylight-saving offsets before writing deterministic JSON. Use `DEMO_REFERENCE_DATE=2026-10-22` when running reproducible application evaluations.
