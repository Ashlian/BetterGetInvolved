# Measured synthetic evaluation

Run `.venv/bin/python scripts/evaluate.py` from the repository root to regenerate this report and `docs/EVALUATION.json`. Measurements below come from the actual implementation on this machine; latency varies by hardware. All relevance labels are illustrative fixtures authored alongside the product. No student study or real-world impact is represented.

## Dataset and methodology

Corpus: 28 fictional clubs and 41 fictional events. Evaluation: 18 labeled club queries, 14 FAQ cases and 9 fictional preference profiles. Reference date: October 22, 2026. Fixed random seed: 42. No held-out user judgments. Relevance labels may be incomplete.

All search approaches use the same deterministic campus/beginner/category restrictions. Baseline is raw TF-IDF cosine ranking; expanded lexical adds the documented synonym map; hybrid adds LSA cosine similarity at 45% weight to expanded lexical at 55%. Hybrid applies the application's 0.045 result threshold. Precision divides by K even if fewer results are returned. Recall divides by the number of labeled relevant clubs. Recommendation comparison includes campus and diversity re-ranking, so it does not isolate the embedding contribution.

## Club search

| Method | Precision@3 | Recall@3 | Precision@5 | Recall@5 |
| --- | --- | --- | --- | --- |
| baseline | 0.463 | 0.907 | 0.278 | 0.907 |
| expanded | 0.518 | 0.954 | 0.333 | 1.000 |
| hybrid | 0.500 | 0.935 | 0.311 | 0.963 |

Hybrid Recall@5 difference from raw lexical baseline: **+0.056**. This measures this small synthetic suite only. Equal or lower quality is a valid finding and must not be described as an improvement.

## FAQ retrieval

Correctness requires the expected support/abstention decision and all hand-authored answer fragments. Citation support additionally requires a matching club source URL and an exact stored FAQ passage. Source support does not establish relevance.

| Metric | Result |
| --- | --- |
| baseline accuracy | 0.929 |
| retrieval accuracy | 1.000 |
| known answer accuracy | 1.000 |
| unknown abstention rate | 1.000 |
| unsupported answer rate on unknown | 0.000 |
| citation support rate when answered | 1.000 |

## Personalized recommendations

Baseline Recall@5: **0.963**; personalized Recall@5: **0.926**. Mean distinct categories in five recommendations: **3.78**. Follow and dismiss behavior is covered by API tests, not these cold preference fixtures.

## Error analysis

These are all queries where hybrid retrieval missed at least one relevant label in the top five:

- `q05`: environment conservation and water quality — missed: bioexplorers, repair-and-reuse.

FAQ cases that failed expected behavior:

- None in this small fixture suite; broader paraphrase/adversarial testing remains necessary.

## Compute and limitations

Model: `local-tfidf-lsa-64-v1`, 27 dimensions. Index fit: **30.49 ms**; mean cached hybrid query: **0.98 ms**. Remote model calls: **0**. These are CPU/latency proxies, not power or carbon measurements.

LSA is a small-corpus model, not a pretrained transformer. Synonym expansion is manually authored. Lexical overlap can select an irrelevant but correctly cited FAQ. Personalization labels are synthetic and not representative of students. This benchmark measures club ranking, not event-search date correctness, real user task success, live data freshness, or confirmed attendance. API tests cover deterministic date filters and security. Obtain permitted real organization data and independent labels; measure against The Arc in a consented task study before claiming benefit.
