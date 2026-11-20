"""Club knowledge graph behind "For you" recommendations and natural-language search.

Nodes are clubs, topics, tags, and categories ("club:<id>", "topic:<key>", "tag:<tag>",
"category:<name>"). Topics come from the campus vocabulary in topics.py.
Stored edges (table graph_edges, rebuilt whenever club content or the vocabulary changes):
  club -> topic      has_topic    0.5-1.0  (named in the club's name or tags: 1.0; description: less)
  topic -> topic     broader      0.3   (Basketball -> Sports)
  club -> tag        has_tag      1.0   (owner-editable club tags)
  club -> category   in_category  0.5   (except "Other")
  club -> club       similar      cosine similarity of the clubs' text (top neighbours only)
Live edges, read from existing tables at request time rather than copied:
  club -> club       cofollow     clubs followed together by at least MIN_COFOLLOW people
  user -> club       follow / bookmark (personalization seeds), dismiss (negative seeds)

Recommendations are personalized PageRank: a random walk that keeps restarting at what the
student likes. Clubs reached by many strong paths score highest, and each result carries the
path that explains it. Search runs the same walk, starting from the topics a query names and
the clubs whose text matches it best. Scores are relative rankings, not probabilities.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict

import numpy as np
from scipy import sparse
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from sklearn.preprocessing import normalize

from . import topics
from .search import document, expand, tokens

GRAPH_VERSION = "club-graph-v2"
SIMILAR_NEIGHBOURS = 12
SIMILAR_MIN = 0.2
CATEGORY_WEIGHT = 0.5
MIN_COFOLLOW = 3  # never derive an edge from fewer people than this (privacy)
RESTART = 0.25
ITERATIONS = 40
IGNORED_CATEGORIES = {"", "other"}
# Words nearly every club profile uses; left in, they make unrelated clubs look alike.
BOILERPLATE = {
    "rutgers", "university", "new", "brunswick", "nb", "club", "clubs", "student", "students", "organization", "organizations",
    "undergraduate", "undergraduates", "graduate", "members", "member", "membership", "community", "campus", "event", "events",
    "join", "year", "years", "semester", "semesters", "also", "help", "helps", "provide", "provides", "opportunity", "opportunities",
    "interested", "interest", "interests", "goal", "goals", "purpose", "mission", "aim", "aims", "strive", "dedicated", "welcome",
    "welcomes", "https", "http", "www", "com", "org", "edu", "instagram", "email", "discord", "groupme", "linktr", "ee", "meeting",
    "meetings", "general", "body", "weekly", "hold", "host", "hosts", "activities", "various", "foster", "fostering", "environment",
    "space", "people", "individuals", "including", "within", "throughout", "promote", "promoting", "support", "supporting",
    "listed", "profile", "sign", "hidden", "scarletmail",
}


def tag_key(tag):
    return re.sub(r"\s+", " ", str(tag)).strip().lower()


def club_node(club_id):
    return f"club:{club_id}"


def fingerprint(clubs):
    """Changes whenever anything the graph is built from changes."""
    content = sorted((c["id"], c.get("name", ""), c.get("category", ""), c.get("description", ""), c.get("mission", ""), sorted(c.get("interests", []))) for c in clubs)
    return hashlib.sha256(json.dumps([GRAPH_VERSION, topics.VERSION, content]).encode()).hexdigest()


def topic_node(key):
    return f"topic:{key}"


def club_topics(club):
    """{topic key: edge weight}. Naming a topic outright counts more than mentioning it."""
    found = {}
    for key in topics.match(" ".join([club.get("name", ""), *club.get("interests", [])])):
        found[key] = 1.0
    mentions = topics.match(" ".join([club.get("description", ""), club.get("mission", "")]))
    for key, phrases in mentions.items():
        found[key] = max(found.get(key, 0), 0.5 + 0.15 * min(2, len(set(phrases)) - 1))
    return {key: round(w * topics.weight(key), 3) for key, w in found.items()}


def build_edges(clubs):
    """Content edges as (src, dst, kind, weight) tuples."""
    edges = []
    for club in clubs:
        source = club_node(club["id"])
        for tag in dict.fromkeys(tag_key(t) for t in club.get("interests", [])):
            if tag:
                edges.append((source, f"tag:{tag}", "has_tag", 1.0))
        category = tag_key(club.get("category", ""))
        if category not in IGNORED_CATEGORIES:
            edges.append((source, f"category:{category}", "in_category", CATEGORY_WEIGHT))
        for key, weight in club_topics(club).items():
            edges.append((source, topic_node(key), "has_topic", weight))
    used, pending = set(), {dst[6:] for _, dst, kind, _ in edges if kind == "has_topic"}
    while pending:  # link each used topic to its broader topics, all the way up
        key = pending.pop()
        used.add(key)
        for parent in topics.broader(key):
            edges.append((topic_node(key), topic_node(parent), "broader", 0.3))
            if parent not in used:
                pending.add(parent)
    if len(clubs) >= 3:
        texts = [expand(document(club)) for club in clubs]
        tfidf = TfidfVectorizer(stop_words=sorted(ENGLISH_STOP_WORDS | BOILERPLATE), ngram_range=(1, 2), sublinear_tf=True, min_df=1).fit_transform(texts)
        dims = min(96, tfidf.shape[0] - 1, tfidf.shape[1] - 1)
        dense = normalize(TruncatedSVD(n_components=dims, random_state=42).fit_transform(tfidf)) if dims >= 2 else normalize(tfidf.toarray())
        # Blend exact word overlap with the LSA topic space, as search does.
        similarity = 0.5 * (tfidf @ tfidf.T).toarray() + 0.5 * np.maximum(0, dense @ dense.T)
        np.fill_diagonal(similarity, 0)
        best = {}
        for i, club in enumerate(clubs):
            for j in np.argsort(-similarity[i])[:SIMILAR_NEIGHBOURS]:
                score = float(similarity[i, j])
                if score < SIMILAR_MIN:
                    break
                a, b = sorted((club["id"], clubs[j]["id"]))
                best[(a, b)] = max(best.get((a, b), 0), score)
        edges.extend((club_node(a), club_node(b), "similar", round(score, 4)) for (a, b), score in best.items())
    return edges


class ClubGraph:
    def __init__(self, edges):
        self.edges = list(edges)
        self.neighbours = defaultdict(dict)  # node -> {neighbour: (kind, weight)}
        for src, dst, kind, weight in self.edges:
            for a, b in ((src, dst), (dst, src)):
                if weight > self.neighbours[a].get(b, ("", 0))[1]:
                    self.neighbours[a][b] = (kind, weight)
        self.nodes = sorted(self.neighbours)
        self.index = {node: i for i, node in enumerate(self.nodes)}

    def stats(self):
        kinds = defaultdict(int)
        for _, _, kind, _ in self.edges:
            kinds[kind] += 1
        return {"nodes": len(self.nodes), "edges": len(self.edges), **kinds}

    def matrix(self, extra_edges=(), skip=()):
        """Column-stochastic transition matrix over stored edges plus live ones."""
        rows, cols, weights = [], [], []
        for src, dst, kind, weight in [*self.edges, *extra_edges]:
            if kind not in skip and src in self.index and dst in self.index:
                i, j = self.index[src], self.index[dst]
                rows += [i, j]
                cols += [j, i]
                weights += [weight, weight]
        n = len(self.nodes)
        m = sparse.csr_matrix((weights, (rows, cols)), shape=(n, n))
        totals = np.asarray(m.sum(axis=0)).ravel()
        totals[totals == 0] = 1
        return m @ sparse.diags(1 / totals)

    def personalized_pagerank(self, transition, seeds, restart_probability=RESTART):
        n = len(self.nodes)
        restart = np.zeros(n)
        for node, weight in seeds.items():
            if node in self.index and weight > 0:
                restart[self.index[node]] += weight
        if not restart.sum():
            return np.zeros(n)
        restart /= restart.sum()
        rank = restart.copy()
        for _ in range(ITERATIONS):
            rank = (1 - restart_probability) * (transition @ rank) + restart_probability * restart
        return rank


def recommend(graph, clubs, *, follows=(), bookmarks=(), dismissed=(), interests=(), major="", text_scores=None, cofollow=(), limit=24):
    """Rank clubs for one student. Returns (ranked clubs with explanations, method)."""
    by_id = {c["id"]: c for c in clubs}
    follows = [c for c in follows if c in by_id]
    bookmarks = [c for c in bookmarks if c in by_id]
    seeds = {}
    for club_id in follows:
        seeds[club_node(club_id)] = seeds.get(club_node(club_id), 0) + 1.0
    for club_id in bookmarks:
        seeds[club_node(club_id)] = seeds.get(club_node(club_id), 0) + 0.6
    # Interests and major enter the graph at the tag/category nodes they name...
    interest_hits = {}
    for interest in [*interests, major]:
        words = tokens(interest)
        if not words:
            continue
        for node in graph.nodes:
            if node.startswith(("tag:", "category:")) and words & tokens(node.split(":", 1)[1]):
                interest_hits.setdefault(node, interest)
                seeds[node] = seeds.get(node, 0) + 0.5
        for key in topics.match(interest):
            node = topic_node(key)
            if node in graph.index:
                interest_hits.setdefault(node, interest)
                seeds[node] = seeds.get(node, 0) + 0.5 * topics.weight(key)
    # ...and at the clubs whose text best matches them (catches untagged clubs).
    text_scores = text_scores or {}
    for club_id, score in sorted(text_scores.items(), key=lambda kv: -kv[1])[:10]:
        if score >= 0.05:
            seeds[club_node(club_id)] = seeds.get(club_node(club_id), 0) + 0.8 * score / max(text_scores.values())

    if not seeds:
        return [], "cold_start"
    cofollow_edges = [(club_node(a), club_node(b), "cofollow", min(1.0, 0.3 + 0.1 * n)) for a, b, n in cofollow if n >= MIN_COFOLLOW]
    transition = graph.matrix(cofollow_edges)
    rank = graph.personalized_pagerank(transition, seeds)
    if dismissed:
        # Passing a club also cools its close neighbourhood.
        rank = rank - 0.5 * graph.personalized_pagerank(transition, {club_node(c): 1 for c in dismissed if c in by_id})

    live = {(a, b): n for a, b, n in cofollow if n >= MIN_COFOLLOW}
    excluded = set(follows) | set(bookmarks) | set(dismissed)
    candidates = [(float(rank[graph.index[club_node(cid)]]) if club_node(cid) in graph.index else 0.0, cid) for cid in by_id if cid not in excluded]
    candidates.sort(key=lambda item: (-item[0], by_id[item[1]]["name"]))
    top = candidates[0][0] if candidates and candidates[0][0] > 0 else 1.0

    picked, per_category = [], defaultdict(int)
    pool = [item for item in candidates[: limit * 4] if item[0] > 0]
    while pool and len(picked) < limit:
        # A soft penalty keeps one category from filling the whole stack.
        best = max(pool, key=lambda item: item[0] * 0.85 ** per_category[by_id[item[1]]["category"]])
        pool.remove(best)
        score, club_id = best
        club = by_id[club_id]
        per_category[club["category"]] += 1
        reasons = explain(graph, club_id, by_id, follows, bookmarks, interest_hits, major, text_scores, live)
        # The student's own interests this club is linked to, as short labels for the card.
        linked = graph.neighbours.get(club_node(club_id), {})
        tags = list(dict.fromkeys(topics.label(n[6:]) for n in interest_hits if n.startswith("topic:") and n in linked))[:3]
        picked.append({**club, "score": round(score / top, 4), "explanation": reasons[0], "reasons": reasons, "tags": tags})
    return picked, "graph"


def explain(graph, club_id, by_id, follows, bookmarks, interest_hits, major, text_scores, live):
    """The strongest short paths from the student's seeds to this club, as sentences."""
    node = club_node(club_id)
    neighbours = graph.neighbours.get(node, {})
    reasons = []
    for seed_ids, verb in ((follows, "you follow"), (bookmarks, "you saved")):
        best = None
        for seed in seed_ids:
            count = live.get(tuple(sorted((seed, club_id))))
            if count:
                best = max(best or (0, ""), (2 + count, f"People who follow {by_id[seed]['name']} often follow this too"))
            kind, weight = neighbours.get(club_node(seed), ("", 0))
            if kind == "similar":
                best = max(best or (0, ""), (1 + weight, f"Similar to {by_id[seed]['name']}, which {verb}"))
            shared = [n.split(":", 1)[1] for n in neighbours if n.startswith("tag:") and n in graph.neighbours.get(club_node(seed), {})]
            if shared:
                best = max(best or (0, ""), (0.5 + 0.1 * len(shared), f"Shares “{shared[0]}” with {by_id[seed]['name']}, which {verb}"))
        if best:
            reasons.append(best[1])
    for hit, interest in interest_hits.items():
        if hit in neighbours:
            reasons.append(f"Related to your major, {major}" if interest == major else f"Matches your interest in {interest}")
            break
    if not reasons and text_scores.get(club_id, 0) >= 0.05:
        reasons.append(f"Related to your major, {major}" if major and tokens(major) & tokens(document(by_id[club_id])) else "Fits the interests and goals in your profile")
    return reasons[:2] or ["Connected to clubs you like through shared topics"]


# Words that say how someone is asking, not what they want.
CHATTER = {"want", "wanna", "like", "love", "looking", "look", "interested", "something", "somewhere", "really", "get", "getting",
           "enjoy", "maybe", "kind", "good", "know", "need", "place", "find", "im", "ive", "id", "anything", "stuff", "things",
           "thing", "lot", "lots", "cool", "fun", "great", "best", "able", "try", "trying", "start", "starting", "people"}
SEARCH_STOP = set(ENGLISH_STOP_WORDS) | BOILERPLATE | CHATTER
SHORT_TERMS = {"ai", "cs", "ml", "ux", "ui", "dj", "pr", "3d"}
LEXICAL, WALK, TOPICAL, NAME_MATCH = 0.35, 0.25, 0.3, 0.35
MIN_RESULTS, MAX_RESULTS = 8, 60


def search_stems(text):
    return [topics.stem(w) for w in topics.words(text) if (w not in SEARCH_STOP and len(w) > 1) or w in SHORT_TERMS]


def analyze(text):
    terms = search_stems(text)
    return terms + [f"{a} {b}" for a, b in zip(terms, terms[1:])]


class ClubSearch:
    """Natural-language club search over the knowledge graph.

    A query is read three ways: the topics it names (topics.py), the clubs whose own words
    match it (TF-IDF over stemmed text, names weighted up), and a short personalized PageRank
    walk from both, which reaches related clubs that describe themselves differently.
    """

    def __init__(self, graph, clubs):
        self.graph = graph
        self.by_id = {c["id"]: c for c in clubs}
        self.ids = [c["id"] for c in clubs]
        texts = [" ".join([c.get("name", "")] * 3 + list(c.get("interests", [])) * 2 + [c.get("description", ""), c.get("mission", "")]) for c in clubs]
        self.vectorizer = TfidfVectorizer(analyzer=analyze, sublinear_tf=True)
        self.matrix = self.vectorizer.fit_transform(texts) if clubs else None
        self.name_stems = {c["id"]: set(search_stems(c.get("name", ""))) for c in clubs}
        self.doc_stems = {c["id"]: set(analyze(t)) for c, t in zip(clubs, texts)}
        self.topics = defaultdict(dict)  # club id -> {topic key: weight}
        for src, dst, kind, weight in graph.edges:
            if kind == "has_topic":
                self.topics[src[5:]][dst[6:]] = weight
        # Category hubs hold a hundred clubs each; for search they blur more than they connect.
        self.transition = graph.matrix(skip={"in_category"})

    def understand(self, text):
        """(topic keys, search terms). Idioms like "start a business" or "make friends" become
        topics only: their words say little on their own ("business" is not "startups")."""
        text_words, found = topics.spans(text)
        phrases = defaultdict(set)
        used_up = set()
        for start, end, phrase, keys in found:
            for key in keys:
                phrases[key].add(phrase)
            if keys and any(w in SEARCH_STOP for w in text_words[start:end]):
                used_up.update(range(start, end))
        named = []
        for key in phrases:
            narrower = [k for k in phrases if key in topics.broader(k)]
            # "basketball" makes the broad "sports" redundant, and "korean" both East Asian and Korean.
            if narrower and (topics.weight(key) < 1 or any(phrases[key] <= phrases[k] for k in narrower)):
                continue
            named.append(key)
        terms = [topics.stem(w) for i, w in enumerate(text_words) if i not in used_up and ((w not in SEARCH_STOP and len(w) > 1) or w in SHORT_TERMS)]
        return named, terms

    def coverage(self, club_id, key):
        """(credit 0-1, topic the club actually has, how): the topic itself or a narrower one is a
        direct match; a broader one ("Board and card games" for "chess") counts as related."""
        has = self.topics.get(club_id, {})
        options = [(has[key], key, "direct")] if key in has else []
        options += [(w, t, "direct") for t, w in has.items() if key in topics.broader(t)]
        options += [(0.5 * has[p], p, "related") for p in topics.broader(key) if p in has]
        if not options:
            return 0.0, None, None
        credit, held, how = max(options, key=lambda o: o[0])
        return min(1.0, credit / topics.weight(key)), held, how

    def run(self, text, allowed=None):
        """Ranked [(club, relative score, reason)], or None when the query names nothing to search for."""
        query_topics, terms = self.understand(text)
        if (not terms and not query_topics) or not self.ids:
            return None
        allowed = self.ids if allowed is None else [cid for cid in allowed if cid in self.by_id]
        if terms:
            scores = (self.matrix @ self.vectorizer.transform([" ".join(terms)]).T).toarray().ravel()
        else:
            scores = np.zeros(len(self.ids))
        lexical = dict(zip(self.ids, (float(x) for x in scores)))
        top_lexical = max(lexical.values(), default=0) or 1
        matched = [cid for cid, score in sorted(lexical.items(), key=lambda kv: -kv[1])[:8] if score >= 0.05]
        seeds = {topic_node(k): topics.weight(k) for k in query_topics if topic_node(k) in self.graph.index}
        for club_id in matched:
            seeds[club_node(club_id)] = seeds.get(club_node(club_id), 0) + 0.8 * lexical[club_id] / top_lexical
        rank = self.graph.personalized_pagerank(self.transition, seeds, restart_probability=0.4) if seeds else np.zeros(len(self.graph.nodes))
        walk = {cid: float(rank[self.graph.index[club_node(cid)]]) if club_node(cid) in self.graph.index else 0.0 for cid in self.ids}
        top_walk = max(walk.values(), default=0) or 1
        topic_total = sum(topics.weight(k) for k in query_topics) or 1
        term_set = set(terms)
        results = []
        for club_id in allowed:
            covered = {k: self.coverage(club_id, k) for k in query_topics}
            topical = sum(credit * topics.weight(k) for k, (credit, _, _) in covered.items()) / topic_total
            direct = sum(credit * topics.weight(k) for k, (credit, _, how) in covered.items() if how == "direct") / topic_total
            name_hit = bool(term_set) and term_set <= self.name_stems[club_id]
            relevance = LEXICAL * lexical[club_id] / top_lexical + WALK * walk[club_id] / top_walk + TOPICAL * topical
            # A name match counts less when the club is off the query's topics.
            bonus = NAME_MATCH * name_hit * (max(0.3, direct) if query_topics else 1)
            if relevance > 0 or name_hit:
                results.append({"id": club_id, "score": relevance + bonus, "relevance": relevance, "covered": covered, "name_hit": name_hit})
        if not results:
            return []
        results.sort(key=lambda r: (-r["score"], self.by_id[r["id"]]["name"]))
        cutoff = max(0.12, 0.25 * max(r["relevance"] for r in results))
        kept = [r for r in results if r["relevance"] >= cutoff or r["name_hit"]]
        if len(kept) < MIN_RESULTS:
            # Few direct matches: top up with the closest related clubs ("chess" -> board games).
            kept += [r for r in results if r not in kept and r["relevance"] >= 0.08][:MIN_RESULTS - len(kept)]
        top = results[0]["score"]
        return [(self.by_id[r["id"]], round(r["score"] / top, 4), self.reason(r, terms, text, matched)) for r in kept[:MAX_RESULTS]]

    def reason(self, result, terms, text, matched):
        if result["name_hit"]:
            return "Name matches your search"
        held = sorted(((credit, key, topic, how) for key, (credit, topic, how) in result["covered"].items() if credit),
                      key=lambda h: (h[3] != "direct", -h[0], -topics.weight(h[1])))
        direct = list(dict.fromkeys(topic for _, _, topic, how in held if how == "direct"))
        if direct:
            labels = [topics.label(k) for k in direct[:2]]
            return "About " + " and ".join([labels[0], *(lbl[0].lower() + lbl[1:] for lbl in labels[1:])])
        here = self.doc_stems[result["id"]]
        mentioned = [w for w in dict.fromkeys(topics.words(text)) if topics.stem(w) in terms and topics.stem(w) in here]
        if mentioned:
            return "Mentions " + " and ".join(f"\u201c{w}\u201d" for w in mentioned[:2])
        if held:
            return f"Related: {topics.label(held[0][2]).lower()}"
        neighbours = self.graph.neighbours.get(club_node(result["id"]), {})
        similar = [cid for cid in matched if neighbours.get(club_node(cid), ("", 0))[0] == "similar"]
        if similar:
            return f"Similar to {self.by_id[similar[0]]['name']}"
        return "Related to clubs that match your search"

    def interpretation(self, text):
        query_topics, terms = self.understand(text)
        return {"topics": [topics.label(k) for k in sorted(query_topics, key=lambda k: -topics.weight(k))], "terms": terms}
