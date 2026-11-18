"""Club knowledge graph for "For you" recommendations.

Nodes are clubs, tags, and categories ("club:<id>", "tag:<tag>", "category:<name>").
Stored edges (table graph_edges, rebuilt whenever club content changes):
  club -> tag        has_tag      1.0   (owner-editable club tags)
  club -> category   in_category  0.5   (except "Other")
  club -> club       similar      cosine similarity of the clubs' text (top neighbours only)
Live edges, read from existing tables at request time rather than copied:
  club -> club       cofollow     clubs followed together by at least MIN_COFOLLOW people
  user -> club       follow / bookmark (personalization seeds), dismiss (negative seeds)

Recommendations are personalized PageRank: a random walk that keeps restarting at what the
student likes. Clubs reached by many strong paths score highest, and each result carries the
path that explains it. Scores are relative rankings, not probabilities.
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

from .search import document, expand, tokens

GRAPH_VERSION = "club-graph-v1"
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
    return hashlib.sha256(json.dumps([GRAPH_VERSION, content]).encode()).hexdigest()


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

    def matrix(self, extra_edges=()):
        """Column-stochastic transition matrix over stored edges plus live ones."""
        rows, cols, weights = [], [], []
        for src, dst, _, weight in [*self.edges, *extra_edges]:
            if src in self.index and dst in self.index:
                i, j = self.index[src], self.index[dst]
                rows += [i, j]
                cols += [j, i]
                weights += [weight, weight]
        n = len(self.nodes)
        m = sparse.csr_matrix((weights, (rows, cols)), shape=(n, n))
        totals = np.asarray(m.sum(axis=0)).ravel()
        totals[totals == 0] = 1
        return m @ sparse.diags(1 / totals)

    def personalized_pagerank(self, transition, seeds):
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
            rank = (1 - RESTART) * (transition @ rank) + RESTART * restart
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
        picked.append({**club, "score": round(score / top, 4), "explanation": reasons[0], "reasons": reasons})
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
