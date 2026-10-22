"""Reproduce synthetic retrieval/FAQ metrics; never infer real-world impact."""
from datetime import date
import json
from pathlib import Path
import statistics
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from sklearn.feature_extraction.text import TfidfVectorizer
from backend.app import create_app
from backend.search import HybridIndex, MODEL_NAME, answer_faq, document, expand, parse_constraints, same_campus, tokens


def metrics(predicted, relevant, k):
    hits = len(set(predicted[:k]) & set(relevant))
    return {f"precision@{k}": hits / k, f"recall@{k}": hits / max(1, len(set(relevant)))}


def average(rows, key):
    return statistics.mean(row[key] for row in rows) if rows else 0


def main():
    seed = json.loads((ROOT / "data/seed.json").read_text())
    labels = json.loads((ROOT / "data/evaluation.json").read_text())
    clubs = seed["clubs"]
    by_id = {club["id"]: club for club in clubs}
    lexical = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), sublinear_tf=True)
    sparse = lexical.fit_transform([document(club) for club in clubs])
    index = HybridIndex()
    started = time.perf_counter()
    index.scores(clubs, "initialize public corpus")
    fit_ms = (time.perf_counter() - started) * 1000
    search_results = []
    for case in labels["semantic_queries"]:
        constraints = parse_constraints(case["query"], date(2026, 10, 22))
        query = constraints["query"]
        filters = case.get("filters", {})
        def allowed(club):
            campus = filters.get("campus") or constraints["campus"]
            return ((not campus or same_campus(club["campus"], campus))
                    and (not filters.get("category") or club["category"] == filters["category"])
                    and ("beginner" not in filters or club["beginner_friendly"] == filters["beginner"])
                    and (not constraints["beginner"] or club["beginner_friendly"]))
        candidates = [club for club in clubs if allowed(club)]
        base_scores = (sparse @ lexical.transform([query]).T).toarray().ravel()
        baseline = sorted([c["id"] for c, score in zip(clubs, base_scores) if allowed(c) and score > 0], key=lambda cid: (-base_scores[[c["id"] for c in clubs].index(cid)], cid))
        # Same vocabulary expansion as hybrid: isolates projection from expansion.
        expanded_scores = (index.sparse @ index.vectorizer.transform([expand(query)]).T).toarray().ravel()
        expanded = sorted([c["id"] for c, score in zip(clubs, expanded_scores) if allowed(c) and score > 0], key=lambda cid: (-expanded_scores[index.ids.index(cid)], cid))
        before = time.perf_counter()
        scores = index.scores(clubs, query)
        latency = (time.perf_counter() - before) * 1000
        hybrid = sorted([c["id"] for c in candidates if scores.get(c["id"], 0) >= 0.045], key=lambda cid: (-scores[cid], cid))
        relevant = case["relevant_club_ids"]
        row = {"id": case["id"], "query": case["query"], "relevant": relevant,
               "baseline_ids": baseline[:5], "expanded_lexical_ids": expanded[:5], "hybrid_ids": hybrid[:5], "hybrid_ms": round(latency, 3)}
        for name, predicted in [("baseline", baseline), ("expanded", expanded), ("hybrid", hybrid)]:
            row[name] = {**metrics(predicted, relevant, 3), **metrics(predicted, relevant, 5)}
        search_results.append(row)

    faq_results = []
    for case in labels["faq_cases"]:
        club = by_id[case["club_id"]]
        before = time.perf_counter()
        result = answer_faq(club, case["question"])
        latency = (time.perf_counter() - before) * 1000
        # Simple FAQ baseline: select greatest token-overlap question or abstain.
        question_tokens = tokens(case["question"])
        overlaps = [(len(question_tokens & tokens(faq["question"])), faq) for faq in club["faqs"]]
        overlap, baseline_faq = max(overlaps, key=lambda pair: pair[0])
        baseline_answer = baseline_faq["answer"] if overlap else ""
        expected = case["expected_supported"]
        fragments = case["expected_answer_contains"]
        correct = result["supported"] == expected and (not expected or all(part.lower() in result["answer"].lower() for part in fragments))
        baseline_correct = bool(overlap) == expected and (not expected or all(part.lower() in baseline_answer.lower() for part in fragments))
        valid_source = (not result["supported"] or bool(result["sources"]) and all(source["url"] == club["source_url"] and any(source["excerpt"] == faq["answer"] for faq in club["faqs"]) for source in result["sources"]))
        faq_results.append({"id": case["id"], "question": case["question"], "expected_supported": expected,
                            "supported": result["supported"], "correct": correct, "baseline_correct": baseline_correct,
                            "source_supported": valid_source, "answer": result["answer"], "latency_ms": round(latency, 3)})

    persona_results = []
    with tempfile.TemporaryDirectory(prefix="bgi-eval-") as directory:
        app = create_app(db_path=Path(directory) / "evaluation.db", demo_mode=True)
        with TestClient(app, headers={"Origin": "http://localhost:3000"}) as client:
            for number, persona in enumerate(labels["recommendation_personas"]):
                response = client.post("/api/auth/register", json={"email": f"eval{number}@example.org", "password": "SyntheticEvaluation2026!", "display_name": "Evaluation fixture"})
                response.raise_for_status()
                client.put("/api/profile", json=persona["profile"]).raise_for_status()
                response = client.get("/api/recommendations?limit=5")
                response.raise_for_status()
                predicted = response.json()["clubs"]
                ids = [club["id"] for club in predicted]
                profile = persona["profile"]
                query = " ".join(profile["interests"]) + " " + profile["goals"]
                base_scores = (sparse @ lexical.transform([query]).T).toarray().ravel()
                baseline_ids = [club["id"] for _, club in sorted(zip(base_scores, clubs), key=lambda pair: (-pair[0], pair[1]["id"]))[:5]]
                persona_results.append({"id": persona["id"], "relevant": persona["relevant_club_ids"], "baseline_ids": baseline_ids,
                                        "recommended_ids": ids, "baseline": metrics(baseline_ids, persona["relevant_club_ids"], 5),
                                        "personalized": metrics(ids, persona["relevant_club_ids"], 5), "category_count@5": len({club["category"] for club in predicted})})
                client.post("/api/auth/logout").raise_for_status()

    unknown = [row for row in faq_results if not row["expected_supported"]]
    supported = [row for row in faq_results if row["supported"]]
    known = [row for row in faq_results if row["expected_supported"]]
    summary = {
        "disclosure": labels["metadata"]["label_provenance"], "model": MODEL_NAME,
        "corpus": {"clubs": len(clubs), "events": len(seed["events"]), "queries": len(search_results), "faq_cases": len(faq_results), "personas": len(persona_results)},
        "compute": {"index_fit_ms": round(fit_ms, 3), "dense_dimensions": int(index.dense.shape[1]), "mean_hybrid_query_ms": round(average(search_results, "hybrid_ms"), 3), "remote_model_calls": 0},
        "search": {model: {metric: round(statistics.mean(row[model][metric] for row in search_results), 4) for metric in ("precision@3", "recall@3", "precision@5", "recall@5")} for model in ("baseline", "expanded", "hybrid")},
        "faq": {"baseline_accuracy": round(average(faq_results, "baseline_correct"), 4), "retrieval_accuracy": round(average(faq_results, "correct"), 4),
                "known_answer_accuracy": round(average(known, "correct"), 4), "unknown_abstention_rate": round(average(unknown, "correct"), 4),
                "unsupported_answer_rate_on_unknown": round(sum(row["supported"] for row in unknown) / max(1, len(unknown)), 4),
                "citation_support_rate_when_answered": round(average(supported, "source_supported"), 4)},
        "recommendations": {"baseline_recall@5": round(statistics.mean(row["baseline"]["recall@5"] for row in persona_results), 4),
                            "personalized_recall@5": round(statistics.mean(row["personalized"]["recall@5"] for row in persona_results), 4),
                            "mean_category_count@5": round(average(persona_results, "category_count@5"), 4)}
    }
    output = {"summary": summary, "search_cases": search_results, "faq_cases": faq_results, "personas": persona_results}
    (ROOT / "docs/EVALUATION.json").write_text(json.dumps(output, indent=2) + "\n")
    report = ["# Measured synthetic evaluation", "", "Run `.venv/bin/python scripts/evaluate.py` from the repository root to regenerate this report and `docs/EVALUATION.json`. Measurements below come from the actual implementation on this machine; latency varies by hardware. All relevance labels are illustrative fixtures authored alongside the product. No student study or real-world impact is represented.", "", "## Dataset and methodology", "", f"Corpus: {len(clubs)} fictional clubs and {len(seed['events'])} fictional events. Evaluation: {len(search_results)} labeled club queries, {len(faq_results)} FAQ cases and {len(persona_results)} fictional preference profiles. Reference date: October 22, 2026. Fixed random seed: 42. No held-out user judgments. Relevance labels may be incomplete.", "", "All search approaches use the same deterministic campus/beginner/category restrictions. Baseline is raw TF-IDF cosine ranking; expanded lexical adds the documented synonym map; hybrid adds LSA cosine similarity at 45% weight to expanded lexical at 55%. Hybrid applies the application's 0.045 result threshold. Precision divides by K even if fewer results are returned. Recall divides by the number of labeled relevant clubs. Recommendation comparison includes campus and diversity re-ranking, so it does not isolate the embedding contribution.", "", "## Club search", "", "| Method | Precision@3 | Recall@3 | Precision@5 | Recall@5 |", "| --- | --- | --- | --- | --- |"]
    for name, values in summary["search"].items():
        report.append("| " + name + " | " + " | ".join(f"{value:.3f}" for value in values.values()) + " |")
    delta = summary["search"]["hybrid"]["recall@5"] - summary["search"]["baseline"]["recall@5"]
    report.extend(["", f"Hybrid Recall@5 difference from raw lexical baseline: **{delta:+.3f}**. This measures this small synthetic suite only. Equal or lower quality is a valid finding and must not be described as an improvement.", "", "## FAQ retrieval", "", "Correctness requires the expected support/abstention decision and all hand-authored answer fragments. Citation support additionally requires a matching club source URL and an exact stored FAQ passage. Source support does not establish relevance.", "", "| Metric | Result |", "| --- | --- |"])
    report.extend(f"| {key.replace('_', ' ')} | {value:.3f} |" for key, value in summary["faq"].items())
    report.extend(["", "## Personalized recommendations", "", f"Baseline Recall@5: **{summary['recommendations']['baseline_recall@5']:.3f}**; personalized Recall@5: **{summary['recommendations']['personalized_recall@5']:.3f}**. Mean distinct categories in five recommendations: **{summary['recommendations']['mean_category_count@5']:.2f}**. Follow and dismiss behavior is covered by API tests, not these cold preference fixtures.", "", "## Error analysis", "", "These are all queries where hybrid retrieval missed at least one relevant label in the top five:", ""])
    failed_search = [row for row in search_results if row["hybrid"]["recall@5"] < 1]
    report.extend([f"- `{row['id']}`: {row['query']} — missed: {', '.join(sorted(set(row['relevant']) - set(row['hybrid_ids'])))}." for row in failed_search] or ["- None in this small fixture suite; this does not establish broad quality."])
    report.extend(["", "FAQ cases that failed expected behavior:", ""])
    report.extend([f"- `{row['id']}`: {row['question']} — supported={row['supported']}; returned: {row['answer']}" for row in faq_results if not row["correct"]] or ["- None in this small fixture suite; broader paraphrase/adversarial testing remains necessary."])
    report.extend(["", "## Compute and limitations", "", f"Model: `{MODEL_NAME}`, {index.dense.shape[1]} dimensions. Index fit: **{fit_ms:.2f} ms**; mean cached hybrid query: **{summary['compute']['mean_hybrid_query_ms']:.2f} ms**. Remote model calls: **0**. These are CPU/latency proxies, not power or carbon measurements.", "", "LSA is a small-corpus model, not a pretrained transformer. Synonym expansion is manually authored. Lexical overlap can select an irrelevant but correctly cited FAQ. Personalization labels are synthetic and not representative of students. This benchmark measures club ranking, not event-search date correctness, real user task success, live data freshness, or confirmed attendance. API tests cover deterministic date filters and security. Obtain permitted real organization data and independent labels; measure against The Arc in a consented task study before claiming benefit.", ""])
    (ROOT / "docs/EVALUATION.md").write_text("\n".join(report))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
