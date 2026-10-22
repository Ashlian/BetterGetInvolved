# AI4GOOD criteria and evidence

The rubric weights indicate effort emphasis, not awarded points. Status here describes this local implementation, not a competition score. Only completed checks should be reported as passed.

| Criterion | Weight | Current evidence | Status / remaining work |
| --- | --- | --- | --- |
| Problem Statement & Social Impact | 20% | Local Rutgers–New Brunswick focus; primary-source scale/context; interview and task-study protocol in RESEARCH.md | **Needs Work**: interview students/officers; validate unmet need against The Arc; measure real outcomes |
| AI & Technical Skills | 30% | Connected Next.js/FastAPI application; local dense LSA embeddings plus lexical retrieval; recommendations; source-based FAQ; reproducible fixtures, evaluation script and API tests | **Needs Work**: validate on authorized real data and independent relevance labels; consider pretrained embeddings/generative RAG only if quality improves |
| Ethics & Safety | 20% | Guest access, optional personalization, private saves, deletion, backend club ownership, hashed sessions/passwords, abstention, demo/freshness labels, risk/mitigation register | **Needs Work**: production email verification, officer verification, database RLS, staffed moderation, broader fairness/adversarial testing |
| Design & User Experience | 15% | Responsive discover/search/calendar/detail/officer flows; form labels, dialog focus controls and keyboard actions implemented; TypeScript/build checks | **Needs Work**: browser visual QA blocked by computer-use permissions; observe unaided outside-team users, test assistive technology, measure/fix task friction |
| Presentation & Documentation | 15% | Setup, architecture, API contract, data disclosure, research protocol, demo runbook and reproducible evaluation | **Needs Work**: rehearse 10-minute talk, capture backup recording, add real study findings and prepare Q&A |

## Scope against project PDF

The local implementation prioritizes connected student discovery, authentication, opt-in interests, recommendations, search, swipe cards, sourced club profiles/FAQs, events/calendar, saved items, authorized officer management and aggregate engagement. Fixtures are explicitly synthetic. Runtime storage is SQLite rather than the proposed Supabase/pgvector stack. The FAQ assistant is extractive retrieval rather than generative RAG. These are documented implementation choices and limitations, not completed production integrations.

The PDF's representative real data, live deployment, student/officer research, verified production identities, real-world impact measurements, presentation recording and native apps are not provided by synthetic fixtures or local test success. Secondary features such as unrestricted community matching, notifications, flyer extraction, advanced analytics and multi-university support should remain gated by validation of the core workflow.
