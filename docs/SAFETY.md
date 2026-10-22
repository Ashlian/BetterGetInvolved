# Privacy, safety and operational limits

This is a local project prototype with synthetic organizations, events, and accounts. It is independently developed and does not represent Rutgers or its official involvement services.

| Risk | Implemented control | Remaining validation |
| --- | --- | --- |
| Unnecessary personal disclosure | Guest browsing/search; optional interests and campus; private account preferences; self-service deletion | Validate understandable consent with students; add a retention policy before a pilot |
| Account compromise | Salted scrypt hashes; opaque server-side sessions; HTTP-only SameSite cookies; rate-limited sensitive actions | Production verified-email/recovery flows, HTTPS, shared rate limits, session monitoring |
| Officer impersonation or cross-club edits | Registration always creates students; server checks assigned officer ownership for writes; role-denial tests | Out-of-band real officer verification and production database RLS |
| Fabricated facts or unsafe retrieved content | Extractive source-backed FAQ answers, abstention, source/updated labels, no executed uploaded instructions | Human-authored adversarial tests on authorized real content; relevance review |
| Popularity/category bias | Explicit preferences, category diversity, no follower-count ranking, manual directory browse, dismiss controls | Real participant relevance labels and exposure audit across categories |
| Exposing social activity | Saved items/preferences private; no public attendance lists, direct messaging, precise location or browsing-history dashboard | Consent and moderation design before adding community matching |
| Stale/misleading events | Explicit demo labels, stored source/update timestamp, authorized edits/cancellation, reports | Real officer freshness confirmation, moderator operations and permitted data import |
| Inflated impact claims | Aggregate follows/bookmarks/intentions labeled separately from attendance; synthetic evaluation disclosure | Consented task study and independently measured outcomes |
| Computational cost | Local cached document embeddings, no paid/API model calls, no generative model required | Record CPU/latency/index cost and compare quality against lighter baseline on larger data |

## Data handling

The browser sends account email, display name, password at registration/login, and optional interests, goals and campus preferences to the local API. Passwords are hashed before persistence. The cookie contains an opaque session token; the database stores its hash. Public club/event data and private account records live on the machine running the API. External model services receive no user information in the default implementation.

Accounts can edit preferences, log out, and delete their own stored account records. Organization officers see aggregate counts, not another student's private profile or search history. Reports provide a correction channel; a complete staffed moderator workflow is outside this prototype. Demo credentials are public fixtures and must be disabled before external exposure.

## AI evaluation limits

Citation support and answer relevance are different. A verbatim FAQ passage can be supported but irrelevant to a question. Evaluation records both known-answer correctness and unsupported-question abstention. A passed injection example does not establish comprehensive prompt-injection resistance. LSA and the synonym map have limited coverage, and scores are similarity values rather than calibrated confidence probabilities.

## Resource reporting

The evaluation command records index fit time, per-query latency, corpus size, LSA dimensions and remote model calls (zero). These are compute proxies, not estimates of electricity use or CO₂ emissions. No environmental benefit is claimed without measurement.
