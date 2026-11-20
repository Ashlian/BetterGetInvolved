"""Student profile page: profile fields, photos, visibility, the summary, and announcements."""

import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app, grant_club_owner
from backend.db import SQLite
from test_api import ORIGIN, club, event
from test_auth import DOMAIN, fake_verifier, google

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def api(tmp_path):
    path = tmp_path / "seed.json"
    seed = {"clubs": [club("chess", "Chess Club"), club("bio", "Biology Society", category="Science")],
            "events": [event("meetup", club_id="chess"), event("old", club_id="chess", starts="2026-09-01T18:30:00-04:00")]}
    path.write_text(json.dumps(seed))
    db = tmp_path / "profile.db"
    app = create_app(db_path=db, seed_path=path, demo_mode=False, google_client_id="test-client", google_verifier=fake_verifier)
    with TestClient(app, headers=ORIGIN, base_url="https://testserver") as client:
        yield client, db


def sign_in(client, n):
    client.post("/api/auth/logout")
    response = google(client, sub=f"g-{n}", email=f"s{n}@{DOMAIN}", name=f"Student {n}")
    assert response.status_code == 200, response.text
    return response.json()


def test_profile_fields_validate_save_and_clear(api):
    client, _ = api
    sign_in(client, 1)
    saved = client.put("/api/profile", json={"username": "@Avery.B", "grad_year": 2028, "bio": "Chess and biology.", "profile_visibility": "students"}).json()
    assert (saved["username"], saved["grad_year"], saved["bio"], saved["profile_visibility"]) == ("avery.b", 2028, "Chess and biology.", "students")
    for bad in ({"username": "ab"}, {"username": "has space"}, {"username": ".dot"}, {"grad_year": 1999}, {"bio": "x" * 301}, {"profile_visibility": "everyone"}):
        assert client.put("/api/profile", json=bad).status_code == 422, bad
    cleared = client.put("/api/profile", json={"username": "", "grad_year": 0}).json()
    assert cleared["username"] is None and cleared["grad_year"] is None and cleared["bio"] == "Chess and biology."


def test_usernames_are_unique(api):
    client, _ = api
    sign_in(client, 1)
    assert client.put("/api/profile", json={"username": "taken"}).status_code == 200
    sign_in(client, 2)
    response = client.put("/api/profile", json={"username": "TAKEN"})
    assert response.status_code == 409 and response.json()["detail"] == "That username is taken"


def test_private_by_default_and_never_shows_private_fields(api):
    client, _ = api
    first = sign_in(client, 1)
    assert first["profile_visibility"] == "private"
    client.put("/api/profile", json={"username": "first", "goals": "secret goals", "interests": ["Gaming"]})
    sign_in(client, 2)
    assert client.get("/api/users/first").status_code == 404
    sign_in(client, 1)
    client.put("/api/profile", json={"profile_visibility": "students"})
    sign_in(client, 2)
    shown = client.get("/api/users/@First").json()
    assert shown["username"] == "first" and shown["interests"] == ["Gaming"]
    assert not {"email", "goals", "role", "profile_visibility"} & set(shown)
    client.post("/api/auth/logout")
    assert client.get("/api/users/first").status_code == 401


def test_profile_photo_upload_visibility_and_removal(api):
    client, _ = api
    me = sign_in(client, 1)
    assert client.put("/api/profile/avatar", content=b"<svg onload=alert(1)>").status_code == 415
    assert client.put("/api/profile/avatar", content=b"GIF89a" + b"\x00" * 20).status_code == 415
    assert client.put("/api/profile/avatar", content=PNG + b"\x00" * (1024 * 1024)).status_code == 413
    user = client.put("/api/profile/avatar", content=PNG).json()
    url = user["avatar_url"]
    assert url.startswith(f"/api/users/{me['id']}/avatar?v=")
    own = client.get(url)
    assert own.status_code == 200 and own.content == PNG and own.headers["content-type"] == "image/png"
    assert own.headers["cache-control"].startswith("private") and "sandbox" in own.headers["content-security-policy"]
    sign_in(client, 2)
    assert client.get(url).status_code == 404  # private profile: not even the photo
    sign_in(client, 1)
    client.put("/api/profile", json={"profile_visibility": "students"})
    sign_in(client, 2)
    assert client.get(url).status_code == 200
    client.post("/api/auth/logout")
    assert client.get(url).status_code == 404
    sign_in(client, 1)
    assert client.delete("/api/profile/avatar").json()["avatar_url"] is None
    assert client.get(url).status_code == 404


def test_summary_counts_only_your_own_activity(api):
    client, _ = api
    sign_in(client, 1)
    client.post("/api/clubs/chess/follow")
    client.post("/api/clubs/bio/bookmark")
    client.post("/api/events/meetup/rsvp", json={"status": "going"})
    client.post("/api/events/old/rsvp", json={"status": "going"})
    client.post("/api/events/meetup/save")
    created = client.post("/api/forums", json={"club_id": "chess", "title": "Openings night", "body": "Who wants to practice?"}).json()
    client.post(f"/api/forums/{created['id']}/comments", json={"body": "I can bring boards."})
    summary = client.get("/api/profile/summary").json()
    assert summary["stats"] == {"clubs": 1, "events_going": 2, "saved": 2, "posts": 2}
    assert [c["id"] for c in summary["clubs"]] == ["chess"] and [c["id"] for c in summary["later"]] == ["bio"]
    events = {e["id"]: e for e in summary["events"]}
    assert events["meetup"]["rsvp"] == "going" and events["meetup"]["saved"] and not events["old"]["saved"]
    assert sorted((a["kind"], a["title"]) for a in summary["activity"]) == [("comment", "Openings night"), ("post", "Openings night")]
    sign_in(client, 2)
    other = client.get("/api/profile/summary").json()
    assert other["stats"] == {"clubs": 0, "events_going": 0, "saved": 0, "posts": 0} and other["activity"] == []
    client.post("/api/auth/logout")
    assert client.get("/api/profile/summary").status_code == 401


def test_announcements_are_owner_posts_from_followed_clubs(api):
    client, db = api
    owner = sign_in(client, 1)
    with SQLite(db).connect() as conn:
        grant_club_owner(conn, "chess", owner["email"])
    client.post("/api/forums", json={"club_id": "chess", "title": "Tournament on Friday", "body": "Sign up at the meeting."})
    client.post("/api/forums", json={"club_id": "bio", "title": "Not my club", "body": "Owners only count for their own club."})
    sign_in(client, 2)
    client.post("/api/forums", json={"club_id": "chess", "title": "Member question", "body": "Is it beginner friendly?"})
    assert client.get("/api/announcements").json() == []  # not following yet
    client.post("/api/clubs/chess/follow")
    client.post("/api/clubs/bio/follow")
    assert [a["title"] for a in client.get("/api/announcements").json()] == ["Tournament on Friday"]


def test_forum_handles_follow_profile_visibility(api):
    client, _ = api
    sign_in(client, 1)
    client.put("/api/profile", json={"username": "poster", "profile_visibility": "students"})
    created = client.post("/api/forums", json={"club_id": "chess", "title": "Hello", "body": "First post"}).json()
    sign_in(client, 2)
    assert client.get(f"/api/forums/{created['id']}").json()["author_username"] == "poster"
    client.post("/api/auth/logout")
    assert client.get(f"/api/forums/{created['id']}").json()["author_username"] is None


def test_account_deletion_removes_the_photo(api):
    client, db = api
    sign_in(client, 1)
    client.put("/api/profile/avatar", content=PNG)
    assert client.delete("/api/auth/me").status_code == 200
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT COUNT(*) FROM user_avatars").fetchone()[0] == 0
