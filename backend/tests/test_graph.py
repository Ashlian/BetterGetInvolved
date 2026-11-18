"""The club graph behind Discover's "For you" mode."""

import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend import graph as club_graph
from backend.app import create_app, grant_club_owner
from backend.db import SQLite
from test_api import ORIGIN, club
from test_auth import DOMAIN, fake_verifier, google


def make(club_id, name, description, tags, category="Lifestyle & Hobbies"):
    record = club(club_id, name, category=category)
    record.update(description=description, mission=description, interests=tags, faqs=[], contact_email="")
    return record


CLUBS = [
    make("chess", "Chess Club", "Play chess, learn openings and endgames, and compete in rated chess tournaments.", ["chess", "board games", "strategy"]),
    make("boardgames", "Board Game Society", "Weekly board game nights with strategy games, card games, and chess variants.", ["board games", "strategy", "card games"]),
    make("go", "Go Club", "Learn the ancient strategy board game Go; beginners get free lessons and practice boards.", ["go", "board games", "strategy"]),
    make("robotics", "Robotics Team", "Design, build, and program competition robots with motors, sensors, and microcontrollers.", ["robotics", "engineering"], "Academic"),
    make("mecheng", "Mechanical Engineering Society", "Mechanical engineering projects, CAD workshops, and machine shop training for engineers.", ["engineering", "mechanical engineering"], "Academic"),
    make("choir", "University Choir", "Sing choral music in concerts; rehearsals every week for singers of all voice types.", ["music", "singing"], "Performing Arts"),
    make("poetry", "Poetry Society", "Read and write poems, share work at open mics, and publish a poetry zine.", ["writing", "poetry"], "Performing Arts"),
]


@pytest.fixture
def api(tmp_path):
    path = tmp_path / "seed.json"
    path.write_text(json.dumps({"clubs": CLUBS, "events": []}))
    db = tmp_path / "graph.db"
    app = create_app(db_path=db, seed_path=path, demo_mode=False, google_client_id="test-client", google_verifier=fake_verifier)
    with TestClient(app, headers=ORIGIN, base_url="https://testserver") as client:
        yield client, db


def ids(response):
    return [c["id"] for c in response.json()["clubs"]]


def test_graph_edges_connect_related_clubs():
    edges = club_graph.build_edges(CLUBS)
    similar = {(a, b) for a, b, kind, _ in edges if kind == "similar"}
    assert ("club:boardgames", "club:chess") in similar
    assert ("club:choir", "club:chess") not in similar and ("club:chess", "club:choir") not in similar
    assert ("club:chess", "tag:board games", "has_tag", 1.0) in edges
    assert ("club:robotics", "category:academic", "in_category", club_graph.CATEGORY_WEIGHT) in edges


def test_guests_get_a_cold_start(api):
    client, _ = api
    body = client.get("/api/for-you").json()
    assert body["method"] == "cold_start" and body["clubs"] == [] and body["graph"]["edges"] > 0


def test_following_a_club_recommends_its_neighbours_with_reasons(api):
    client, _ = api
    google(client)
    client.post("/api/clubs/chess/follow")
    body = client.get("/api/for-you").json()
    assert body["method"] == "graph"
    ranked = ids(client.get("/api/for-you"))
    assert "chess" not in ranked  # never recommend what you already follow
    assert set(ranked[:2]) == {"boardgames", "go"}
    top = body["clubs"][0]
    assert "Chess Club" in top["explanation"] and 0 < top["score"] <= 1
    # Passing a club removes it and cools its close neighbours.
    client.post("/api/clubs/boardgames/dismiss")
    assert "boardgames" not in ids(client.get("/api/for-you"))


def test_interests_and_major_seed_the_graph(api):
    client, _ = api
    google(client)
    client.put("/api/profile", json={"major": "Mechanical Engineering", "onboarded": True})
    body = client.get("/api/for-you").json()
    assert ids(client.get("/api/for-you"))[0] == "mecheng"
    assert body["clubs"][0]["explanation"] == "Related to your major, Mechanical Engineering"
    client.put("/api/profile", json={"major": "", "interests": ["Music"]})
    first = client.get("/api/for-you").json()["clubs"][0]
    assert first["id"] == "choir" and first["explanation"] == "Matches your interest in Music"


def test_graph_is_stored_and_rebuilt_when_clubs_change(api):
    client, db = api
    google(client)
    client.post("/api/clubs/chess/follow")
    client.get("/api/for-you")
    with sqlite3.connect(db) as conn:
        before = conn.execute("SELECT COUNT(*) FROM graph_edges").fetchone()[0]
        fingerprint = json.loads(conn.execute("SELECT value FROM sync_state WHERE key='club_graph'").fetchone()[0])["fingerprint"]
    assert before > 0
    with SQLite(db).connect() as conn:
        grant_club_owner(conn, "poetry", f"ab123@{DOMAIN}")
    # An owner adds a tag; the next request rebuilds and stores the new graph.
    assert client.put("/api/officer/clubs/poetry", json={"interests": ["writing", "poetry", "board games"]}).status_code == 200
    client.get("/api/for-you")
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT COUNT(*) FROM graph_edges WHERE src='club:poetry' AND dst='tag:board games'").fetchone()[0] == 1
        assert json.loads(conn.execute("SELECT value FROM sync_state WHERE key='club_graph'").fetchone()[0])["fingerprint"] != fingerprint


def test_followed_together_needs_three_people(api):
    client, _ = api
    for n in range(3):
        client.post("/api/auth/logout")
        google(client, sub=f"g-{n}", email=f"s{n}@{DOMAIN}")
        client.post("/api/clubs/robotics/follow")
        client.post("/api/clubs/poetry/follow")
        if n == 1:
            # Two people following both clubs is not enough to create an edge.
            assert all("often follow this" not in c["explanation"] for c in client.get("/api/for-you").json()["clubs"])
    client.post("/api/auth/logout")
    google(client, sub="g-new", email=f"new@{DOMAIN}")
    client.post("/api/clubs/robotics/follow")
    poetry = next(c for c in client.get("/api/for-you").json()["clubs"] if c["id"] == "poetry")
    assert poetry["explanation"] == "People who follow Robotics Team often follow this too"
