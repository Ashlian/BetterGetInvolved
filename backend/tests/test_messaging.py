"""Direct messages, club questions, notifications, managers, and blocking."""

import json

import pytest
from fastapi.testclient import TestClient

from backend import messaging
from backend.app import create_app, grant_club_owner
from backend.db import SQLite
from test_api import ORIGIN, club, event
from test_auth import fake_verifier
from test_profile import sign_in


@pytest.fixture
def api(tmp_path):
    path = tmp_path / "seed.json"
    path.write_text(json.dumps({"clubs": [club("chess", "Chess Club"), club("bio", "Biology Society", category="Science")], "events": [event("meetup", club_id="chess")]}))
    db = tmp_path / "messages.db"
    app = create_app(db_path=db, seed_path=path, demo_mode=False, google_client_id="test-client", google_verifier=fake_verifier)
    with TestClient(app, headers=ORIGIN, base_url="https://testserver") as client:
        yield client, db


def own(db, person, club_id="chess"):
    with SQLite(db).connect() as conn:
        grant_club_owner(conn, club_id, person["email"])


def dm(client, person, body="Hi!"):
    return client.post("/api/conversations/direct", json={"user_id": person["id"], "body": body})


def ask(client, body="When do you meet?", club_id="chess"):
    return client.post("/api/conversations/club", json={"club_id": club_id, "body": body})


def test_direct_messages_first_message_limit_reply_and_unread(api):
    client, _ = api
    one, two = sign_in(client, 1), sign_in(client, 2)
    sent = dm(client, one, "  Are you going Friday?  ")
    assert sent.status_code == 201, sent.text
    thread = sent.json()
    assert thread["messages"][0]["body"] == "Are you going Friday?" and thread["awaiting_reply"] and not thread["can_reply"]
    assert dm(client, one, "Hello?").status_code == 409
    sign_in(client, 1)
    assert client.get("/api/inbox/unread").json() == {"messages": 1, "notifications": 0}
    listed = client.get("/api/inbox").json()["conversations"][0]
    assert listed["request"] and listed["unread"] == 1 and listed["title"] == "Student"
    reply = client.post(f"/api/conversations/{thread['id']}/messages", json={"body": "Yes!"}).json()
    assert [m["mine"] for m in reply["messages"]] == [False, True] and reply["can_reply"] and not reply["request"]
    assert client.get("/api/inbox/unread").json()["messages"] == 0  # replying reads the thread
    sign_in(client, 2)
    assert client.get("/api/inbox/unread").json()["messages"] == 1
    client.post(f"/api/conversations/{thread['id']}/read")
    assert client.get("/api/inbox/unread").json()["messages"] == 0
    assert dm(client, one, "Great").json()["id"] == thread["id"]  # same conversation from either side
    assert dm(client, two).status_code == 422
    assert "email" not in json.dumps(client.get("/api/inbox").json())


def test_only_participants_can_read_or_write(api):
    client, db = api
    one = sign_in(client, 1)
    sign_in(client, 2)
    cid = dm(client, one).json()["id"]
    outsider = sign_in(client, 3)
    with SQLite(db).connect() as conn:
        conn.execute("UPDATE users SET role='admin' WHERE id=?", (outsider["id"],))
    assert client.get(f"/api/conversations/{cid}").status_code == 404
    assert client.post(f"/api/conversations/{cid}/messages", json={"body": "x"}).status_code == 404
    assert client.post(f"/api/conversations/{cid}/read").status_code == 404
    assert client.post("/api/reports", json={"kind": "conversation", "target_id": cid, "reason": "not mine"}).status_code == 404
    assert client.get("/api/inbox").json()["conversations"] == []
    client.post("/api/auth/logout")
    for path in ("/api/inbox", "/api/inbox/unread", f"/api/conversations/{cid}"):
        assert client.get(path).status_code == 401
    assert client.post("/api/conversations/club", json={"club_id": "chess", "body": "x"}).status_code == 401
    sign_in(client, 1)
    response = client.get(f"/api/conversations/{cid}")
    assert response.headers["cache-control"] == "no-store"
    assert client.post("/api/reports", json={"kind": "conversation", "target_id": cid, "reason": "spam message"}).status_code == 200
    assert client.post(f"/api/conversations/{cid}/messages", json={"body": "x"}, headers={"Origin": "https://evil.example"}).status_code == 403


def test_message_validation(api):
    client, _ = api
    one = sign_in(client, 1)
    sign_in(client, 2)
    for bad in ("", "   ", "x" * (messaging.MESSAGE_MAX + 1), "nul\x00"):
        assert dm(client, one, bad).status_code == 422
    assert client.post("/api/conversations/direct", json={"user_id": "nobody", "body": "x"}).status_code == 404
    assert client.post("/api/conversations/direct", json={"user_id": one["id"], "body": "x", "author_id": one["id"]}).status_code == 422


def test_message_access_off_still_allows_answering(api):
    client, _ = api
    one = sign_in(client, 1)
    client.put("/api/profile", json={"message_access": "none"})
    two = sign_in(client, 2)
    assert dm(client, one).status_code == 403
    assert client.get(f"/api/users/{one['id']}").json()["can_message"] is False
    sign_in(client, 1)
    cid = dm(client, two, "I have a question").json()["id"]
    sign_in(client, 2)
    assert client.post(f"/api/conversations/{cid}/messages", json={"body": "Sure"}).status_code == 201


def test_blocking_stops_messages_both_ways_and_notifications(api):
    client, _ = api
    one = sign_in(client, 1)
    post = client.post("/api/forums", json={"club_id": "chess", "title": "Openings", "body": "Favorites?"}).json()
    two = sign_in(client, 2)
    cid = dm(client, one).json()["id"]
    sign_in(client, 1)
    assert client.put(f"/api/users/{two['id']}/block").json() == {"blocked": True}
    assert client.put(f"/api/users/{one['id']}/block").status_code == 422
    thread = client.get(f"/api/conversations/{cid}").json()
    assert thread["blocked_by_me"] and not thread["can_reply"]
    assert client.post(f"/api/conversations/{cid}/messages", json={"body": "x"}).status_code == 403
    sign_in(client, 2)
    assert dm(client, one).status_code == 403
    assert client.get(f"/api/conversations/{cid}").json()["blocked_by_me"] is False  # never told who blocked whom
    client.post(f"/api/forums/{post['id']}/comments", json={"body": "The London"})
    sign_in(client, 1)
    assert client.get("/api/inbox").json()["notifications"] == []
    assert client.delete(f"/api/users/{two['id']}/block").json() == {"blocked": False}
    assert client.post(f"/api/conversations/{cid}/messages", json={"body": "Hi again"}).status_code == 201


def test_new_conversations_are_limited_per_day(api, monkeypatch):
    client, _ = api
    people = [sign_in(client, n) for n in (1, 2, 3)]
    sign_in(client, 9)
    monkeypatch.setattr(messaging, "NEW_DIRECT_PER_DAY", 2)
    assert [dm(client, p).status_code for p in people] == [201, 201, 429]


def test_club_questions_reach_every_manager(api):
    client, db = api
    sign_in(client, 5)
    assert ask(client).status_code == 409  # nobody manages it yet
    assert client.get("/api/clubs/chess/managers").json()["count"] == 0
    boss, deputy = sign_in(client, 1), sign_in(client, 2)
    own(db, boss), own(db, deputy)
    assert ask(client).status_code == 422  # managers don't ask themselves
    assert ask(client, club_id="nope").status_code == 404
    sign_in(client, 5)
    cid = ask(client).json()["id"]
    sign_in(client, 1)
    listed = client.get("/api/inbox").json()["conversations"][0]
    assert listed["side"] == "club" and listed["needs_reply"] and listed["unread"] == 1 and listed["person"]["display_name"] == "Student"
    answered = client.post(f"/api/conversations/{cid}/messages", json={"body": "Fridays at 8"}).json()
    assert answered["messages"][-1]["as_club"] and not answered["needs_reply"]
    sign_in(client, 2)  # a colleague's answer isn't unread, but the question still is
    listed = client.get("/api/inbox").json()["conversations"][0]
    assert listed["unread"] == 1 and not listed["needs_reply"]
    sign_in(client, 5)
    thread = client.get(f"/api/conversations/{cid}").json()
    assert thread["title"] == "Chess Club" and thread["side"] == "student" and thread["messages"][-1]["author_name"] == "Student"
    assert client.get("/api/inbox/unread").json()["messages"] == 1
    assert client.get("/api/clubs/chess/managers").json()["conversation_id"] == cid
    sign_in(client, 1)
    with SQLite(db).connect() as conn:
        conn.execute("DELETE FROM officers WHERE user_id=?", (boss["id"],))
    assert client.get(f"/api/conversations/{cid}").status_code == 404  # former managers lose access


def test_unanswered_club_questions_are_limited(api):
    client, db = api
    own(db, sign_in(client, 1))
    sign_in(client, 5)
    codes = [ask(client, f"Question {i}").status_code for i in range(messaging.CLUB_UNANSWERED_MAX + 1)]
    assert codes == [201] * messaging.CLUB_UNANSWERED_MAX + [409]


def test_manager_names_are_for_signed_in_students_and_respect_privacy(api):
    client, db = api
    boss = sign_in(client, 1)
    client.put("/api/profile", json={"username": "boss", "bio": "hidden"})
    own(db, boss)
    sign_in(client, 2)
    found = client.get("/api/clubs/chess/managers").json()
    assert found["managers"] == [{"id": boss["id"], "display_name": "Student", "shared": False, "username": None, "avatar_url": None}]
    card = client.get(f"/api/users/{boss['id']}").json()
    assert card["shared"] is False and card["bio"] == "" and card["username"] is None and card["posts"] == []
    assert [c["id"] for c in card["managed_clubs"]] == ["chess"]
    assert not {"email", "goals", "role"} & set(card)
    client.post("/api/auth/logout")
    assert client.get("/api/clubs/chess/managers").json() == {"count": 1, "managers": [], "is_manager": False, "conversation_id": None}
    assert client.get(f"/api/users/{boss['id']}").status_code == 401


def test_comment_authors_open_a_profile_only_for_signed_in_students(api):
    client, db = api
    boss = sign_in(client, 1)
    own(db, boss)
    post = client.post("/api/forums", json={"club_id": "chess", "title": "Openings", "body": "Favorites?"}).json()
    client.post(f"/api/forums/{post['id']}/comments", json={"body": "Mine is the Ruy Lopez"})
    sign_in(client, 2)
    thread = client.get(f"/api/forums/{post['id']}").json()
    assert thread["comments"][0]["author_id"] == boss["id"] and thread["comments"][0]["author_is_manager"] and thread["author_is_manager"]
    client.post("/api/auth/logout")
    guest = client.get(f"/api/forums/{post['id']}").json()
    assert "author_id" not in guest and "author_id" not in guest["comments"][0] and not guest["author_is_manager"]


def test_notifications_for_comments_replies_announcements_and_events(api):
    client, db = api
    boss = sign_in(client, 1)
    own(db, boss)
    fan = sign_in(client, 2)
    client.post("/api/clubs/chess/follow")
    client.post("/api/events/meetup/rsvp", json={"status": "going"})
    question = client.post("/api/forums", json={"club_id": "chess", "title": "Newbie", "body": "Can I join?"}).json()
    sign_in(client, 3)
    client.post(f"/api/forums/{question['id']}/comments", json={"body": "I did!"})
    sign_in(client, 1)
    client.post("/api/forums", json={"club_id": "chess", "title": "Tournament", "body": "Friday"})
    client.post(f"/api/forums/{question['id']}/comments", json={"body": "Yes, welcome"})
    moved = client.patch("/api/officer/events/meetup", json={"status": "cancelled"})
    assert moved.status_code == 200, moved.text
    created = client.post("/api/officer/events", json={"club_id": "chess", "title": "Blitz night", "description": "Fast games all evening.", "starts_at": "2027-01-10T18:00:00-05:00", "ends_at": "2027-01-10T20:00:00-05:00", "campus": "Busch", "location": "SERC 100", "category": "Games", "cost": 0, "beginner_friendly": True, "accessibility": "Step-free"})
    assert created.status_code == 200, created.text
    assert client.get("/api/inbox").json()["notifications"] == []  # never about your own actions
    sign_in(client, 3)
    assert [n["kind"] for n in client.get("/api/inbox").json()["notifications"]] == ["reply"]
    sign_in(client, 2)
    notes = client.get("/api/inbox").json()["notifications"]
    assert sorted(n["kind"] for n in notes) == ["announcement", "comment", "comment", "event_cancelled", "event_new"]
    assert all(n["actor_id"] is None for n in notes if n["event_id"])
    first = notes[0]["id"]
    assert client.post("/api/notifications/read", json={"id": first}).json()["notifications"] == 4
    sign_in(client, 3)
    client.post("/api/notifications/read", json={"id": notes[1]["id"]})  # someone else's: ignored
    sign_in(client, 2)
    assert client.get("/api/inbox/unread").json()["notifications"] == 4
    assert client.post("/api/notifications/read", json={}).json()["notifications"] == 0
    client.delete(f"/api/forums/{question['id']}")
    assert "comment" not in [n["kind"] for n in client.get("/api/inbox").json()["notifications"]]
    assert fan["id"]


def test_deleting_an_account_removes_its_messages(api):
    client, db = api
    one = sign_in(client, 1)
    sign_in(client, 2)
    dm(client, one)
    assert client.delete("/api/auth/me").status_code == 200
    sign_in(client, 1)
    assert client.get("/api/inbox").json()["conversations"] == []
    boss = sign_in(client, 3)
    own(db, boss)
    sign_in(client, 1)
    cid = ask(client).json()["id"]
    sign_in(client, 3)
    client.post(f"/api/conversations/{cid}/messages", json={"body": "Answer"})
    client.delete("/api/auth/me")
    sign_in(client, 1)
    thread = client.get(f"/api/conversations/{cid}").json()
    assert [m["body"] for m in thread["messages"]] == ["When do you meet?"] and not thread["can_reply"]
    assert client.get("/api/inbox").json()["conversations"][0]["last_message"] == "When do you meet?"
