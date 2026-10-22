"""Local, reproducible hybrid retrieval. No remote model or API requests.

LSA learns dense vectors from this installation's public club/event text. It is
small-corpus semantic retrieval, not a pretrained language model. Rankings must
be evaluated on the separate query set; cosine scores are not probabilities.
"""

import hashlib
import json
import re
import threading
from datetime import date, time, timedelta

import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from sklearn.preprocessing import normalize


MODEL_NAME = "local-tfidf-lsa-64-v1"
# Bounded, documented expansion for common campus vocabulary. This is not an LLM.
SYNONYMS = {
    "coding": "programming software computer technology",
    "code": "programming software computer",
    "volunteer": "service community volunteering social impact",
    "volunteering": "service community volunteer social impact",
    "helping": "service community volunteer",
    "beginner": "beginners novice introductory new experience",
    "beginners": "beginner introductory experience",
    "art": "creative arts painting drawing",
    "music": "musical performing singing instruments",
    "fitness": "sports recreation exercise wellness",
    "friends": "social community belonging",
    "environment": "sustainability climate ecology green",
    "robot": "robotics engineering hardware",
    "ai": "artificial intelligence machine learning technology",
}


def tokens(value):
    return set(re.findall(r"[a-z0-9]+", value.lower())) - ENGLISH_STOP_WORDS


def expand(value):
    return value + " " + " ".join(SYNONYMS.get(t, "") for t in sorted(tokens(value)))


def document(record):
    fields = ("name", "club_name", "title", "category", "description", "mission", "campus", "goals")
    return " ".join(str(record.get(field, "")) for field in fields) + " " + " ".join(record.get("interests", []))


class HybridIndex:
    """Thread-safe in-memory index, rebuilt only when public content changes."""

    def __init__(self):
        self.fingerprint = None
        self.lock = threading.RLock()
        self.ids = []

    def scores(self, records, query):
        if not records:
            return {}
        with self.lock:
            fingerprint = hashlib.sha256(json.dumps(records, sort_keys=True).encode()).hexdigest()
            if fingerprint != self.fingerprint:
                texts = [expand(document(record)) for record in records]
                self.vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), sublinear_tf=True)
                self.sparse = self.vectorizer.fit_transform(texts)
                dimensions = min(64, self.sparse.shape[0] - 1, self.sparse.shape[1] - 1)
                self.reducer = TruncatedSVD(n_components=dimensions, random_state=42) if dimensions >= 2 else None
                self.dense = normalize(self.reducer.fit_transform(self.sparse)) if self.reducer else normalize(self.sparse.toarray())
                self.ids = [record["id"] for record in records]
                self.fingerprint = fingerprint
            vector = self.vectorizer.transform([expand(query)])
            lexical = (self.sparse @ vector.T).toarray().ravel()
            query_dense = normalize(self.reducer.transform(vector)) if self.reducer else normalize(vector.toarray())
            semantic = np.maximum(0, (self.dense @ query_dense.T).ravel())
            # Exact lexical matches stabilize small-corpus LSA similarity.
            combined = 0.55 * lexical + 0.45 * semantic
            return {item_id: float(score) for item_id, score in zip(self.ids, combined)}


def parse_constraints(query, reference_date):
    """Keep hard constraints deterministic rather than entrusting them to scores."""
    q = query.lower()
    campuses = {
        "College Avenue": r"\b(college ave(?:nue)?|college-ave)\b",
        "Busch": r"\bbusch\b",
        "Livingston": r"\b(livingston|livi)\b",
        "Cook": r"\bcook\b",
        "Douglass": r"\bdouglass\b",
        "Newark": r"\bnewark\b",
        "Camden": r"\bcamden\b",
    }
    campus = next((name for name, pattern in campuses.items() if re.search(pattern, q)), None)
    start = end = None
    if "today" in q:
        start = end = reference_date
    elif "tomorrow" in q:
        start = end = reference_date + timedelta(days=1)
    elif "this weekend" in q:
        start = reference_date if reference_date.weekday() >= 5 else reference_date + timedelta(days=5-reference_date.weekday())
        end = start + timedelta(days=6-start.weekday())
    elif "next week" in q:
        start = reference_date + timedelta(days=7 - reference_date.weekday())
        end = start + timedelta(days=6)
    elif "this week" in q:
        start = reference_date
        end = reference_date + timedelta(days=6 - reference_date.weekday())
    iso_dates = re.findall(r"\b\d{4}-\d{2}-\d{2}\b", q)
    if iso_dates:
        try:
            start = date.fromisoformat(iso_dates[0])
            end = date.fromisoformat(iso_dates[1]) if len(iso_dates) > 1 else start
        except ValueError:
            pass
    beginner = bool(re.search(r"\b(beginner|beginners|beginner-friendly|no experience|new to|novice)\b", q))
    free = bool(re.search(r"\b(free|no cost|no fee|zero cost)\b", q))
    residual = q
    for pattern in campuses.values():
        residual = re.sub(pattern, " ", residual)
    residual = re.sub(r"\b(this weekend|this week|next week|today|tomorrow|beginner-friendly|no experience|no cost|no fee|zero cost|beginners?|free|novice|new to)\b", " ", residual)
    residual = re.sub(r"\b\d{4}-\d{2}-\d{2}\b", " ", residual)
    before_time = after_time = None
    time_pattern = r"\b(after|before)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b"
    for direction, hour, minute, meridiem in re.findall(time_pattern, q):
        hour, minute = int(hour), int(minute or 0)
        if not (1 <= hour <= 12 and 0 <= minute < 60):
            continue
        cutoff = time(hour % 12 + (12 if meridiem == "pm" else 0), minute)
        if direction == "after":
            after_time = cutoff
        else:
            before_time = cutoff
    residual = re.sub(time_pattern, " ", residual)
    # Broad interface words do not imply a topical constraint.
    residual = re.sub(r"\b(find|show|looking|want|like|join|clubs?|events?|groups?|meetings?|campus|friendly|available|week|weekend|near|on|me|please|something)\b", " ", residual)
    return {"campus": campus, "beginner": beginner, "free": free, "start": start, "end": end, "after_time": after_time, "before_time": before_time, "query": residual.strip()}


def same_campus(actual, expected):
    normalize_campus = lambda s: re.sub(r"[^a-z]", "", s.lower().replace("avenue", "ave"))
    return normalize_campus(actual) == normalize_campus(expected)


def answer_faq(club, question):
    """Return one source passage verbatim, or abstain; never execute instructions."""
    method = "Grounded extractive FAQ retrieval; no generated claims"
    abstain = {"answer": "I couldn't find a reliable answer in this club's published demo FAQs. Please contact the club directly.", "sources": [], "supported": False, "method": method}
    if re.search(r"(ignore (all |previous |the )?instructions|system prompt|reveal.*(?:password|secret)|pretend|override|disregard|jailbreak)", question, re.I):
        return abstain
    faqs = club.get("faqs", [])
    if not faqs:
        return abstain
    vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2))
    passages = [faq["question"] + " " + faq["answer"] for faq in faqs]
    matrix = vectorizer.fit_transform(passages)
    question_matrix = vectorizer.transform([faq["question"] for faq in faqs])
    query_vector = vectorizer.transform([question])
    scores = (0.65 * (question_matrix @ query_vector.T) + 0.35 * (matrix @ query_vector.T)).toarray().ravel()
    best = int(np.argmax(scores))
    query_terms = tokens(question)
    passage_terms = tokens(passages[best])
    overlap = query_terms & passage_terms
    # A lone broad word ("club", "Rutgers") must never justify an answer.
    meaningful = overlap - {"club", "rutgers", "demo", "group", "student", "students", "organization"}
    coverage = len(overlap) / max(1, len(query_terms))
    if scores[best] < 0.24 or not meaningful or coverage < 0.4:
        return abstain
    faq = faqs[best]
    return {"answer": faq["answer"], "sources": [{"title": f"{club['name']} · {faq['question']}", "url": club["source_url"], "excerpt": faq["answer"]}], "supported": True, "method": method}
