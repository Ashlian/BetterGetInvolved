"""ScarletMail Google sign-in, contact privacy for visitors, and the major on profiles."""

import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from test_api import ORIGIN, club

DOMAIN = "scarletmail.rutgers.edu"


def claims(sub="g-1", email=f"ab123@{DOMAIN}", hd=DOMAIN, verified=True, name="Avery Brooks"):
    return {"iss": "https://accounts.google.com", "sub": sub, "email": email, "hd": hd, "email_verified": verified, "name": name, "given_name": name.split()[0]}


def fake_verifier(credential):
    # Tests pass the claims as JSON in place of a signed Google token.
    if credential.startswith("bad"):
        raise ValueError("invalid signature")
    return json.loads(credential)


def private_club():
    record = club("chess", "Chess Club")
    record["contact_email"] = "president@scarletmail.rutgers.edu"
    record["discord"] = "https://discord.gg/abc123"
    record["mission"] = "Play chess weekly. Email chess@scarletmail.rutgers.edu or join https://discord.gg/abc123 to sign up."
    record["faqs"] = [{"question": "How do I join?", "answer": "Email chess@scarletmail.rutgers.edu to join the club."}]
    return record


@pytest.fixture
def api(tmp_path):
    path = tmp_path / "seed.json"
    path.write_text(json.dumps({"clubs": [private_club(), club("bio", "Biology Society", category="Science")], "events": []}))
    db = tmp_path / "auth.db"
    app = create_app(db_path=db, seed_path=path, demo_mode=False, google_client_id="test-client", google_verifier=fake_verifier)
    # Outside demo mode the session cookie is Secure, so talk to the app over HTTPS.
    with TestClient(app, headers=ORIGIN, base_url="https://testserver") as client:
        yield client, db


def google(client, **kwargs):
    return client.post("/api/auth/google", json={"credential": json.dumps(claims(**kwargs))})


def test_config_exposes_client_and_domain_only(api):
    client, _ = api
    assert client.get("/api/auth/config").json() == {"google_client_id": "test-client", "allowed_domains": [DOMAIN], "password_login": False}


def test_first_google_sign_in_creates_a_student_who_must_onboard(api):
    client, db = api
    response = google(client)
    assert response.status_code == 200, response.text
    user = response.json()
    assert user["email"] == f"ab123@{DOMAIN}" and user["display_name"] == "Avery" and user["role"] == "student"
    assert user["onboarded"] is False and user["major"] == ""
    assert client.get("/api/auth/me").json()["id"] == user["id"]
    # Signing in again finds the same account by its Google subject, not a duplicate.
    client.post("/api/auth/logout")
    assert google(client, email=f"AB123@{DOMAIN}").json()["id"] == user["id"]
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT COUNT(*), MIN(password_hash) FROM users").fetchone() == (1, "")


@pytest.mark.parametrize("kwargs,status", [
    ({"email": "someone@gmail.com", "hd": ""}, 403),
    ({"email": "someone@rutgers.edu", "hd": "rutgers.edu"}, 403),
    ({"hd": ""}, 403),  # a ScarletMail-looking address without Workspace proof
    ({"verified": False}, 403),
])
def test_only_verified_scarletmail_workspace_accounts_get_in(api, kwargs, status):
    client, _ = api
    assert google(client, **kwargs).status_code == status
    assert client.get("/api/auth/me").status_code == 401


def test_bad_tokens_and_wrong_issuer_are_rejected(api):
    client, _ = api
    assert client.post("/api/auth/google", json={"credential": "bad-token-from-somewhere"}).status_code == 401
    forged = claims()
    forged["iss"] = "https://evil.example"
    assert client.post("/api/auth/google", json={"credential": json.dumps(forged)}).status_code == 401


def test_a_second_google_account_cannot_take_over_an_email(api):
    client, _ = api
    assert google(client, sub="g-1").status_code == 200
    client.post("/api/auth/logout")
    assert google(client, sub="g-2").status_code == 409


def test_google_sign_in_unavailable_without_client_id(tmp_path):
    path = tmp_path / "seed.json"
    path.write_text('{"clubs":[],"events":[]}')
    app = create_app(db_path=tmp_path / "x.db", seed_path=path, demo_mode=False, google_client_id="")
    with TestClient(app, headers=ORIGIN) as client:
        assert client.get("/api/auth/config").json()["google_client_id"] is None
        assert client.post("/api/auth/google", json={"credential": json.dumps(claims())}).status_code == 503


def test_visitors_never_receive_club_contacts(api):
    client, _ = api
    for record in (client.get("/api/clubs/chess").json(), next(c for c in client.get("/api/clubs").json() if c["id"] == "chess")):
        dumped = json.dumps(record)
        assert "@scarletmail" not in dumped and "discord.gg" not in dumped
        assert record["contact_email"] == "" and record["discord"] == "" and record["contacts_hidden"] is True
        assert "[email hidden: sign in to see]" in record["mission"]
    recommended = json.dumps(client.get("/api/recommendations?limit=24").json())
    assert "@scarletmail" not in recommended and "discord.gg" not in recommended
    answer = client.post("/api/clubs/chess/faq", json={"question": "How do I join the club?"}).json()
    assert "@scarletmail" not in json.dumps(answer)
    # The shared fixture club also lists a contact email, so it is flagged too.
    assert client.get("/api/clubs/bio").json()["contacts_hidden"] is True
    google(client)
    full = client.get("/api/clubs/chess").json()
    assert full["contact_email"] == "president@scarletmail.rutgers.edu" and full["discord"] == "https://discord.gg/abc123"
    assert full["contacts_hidden"] is False and "chess@scarletmail.rutgers.edu" in full["mission"]
    assert "chess@scarletmail.rutgers.edu" in json.dumps(client.post("/api/clubs/chess/faq", json={"question": "How do I join the club?"}).json())


def test_onboarding_saves_major_and_it_shapes_recommendations(api):
    client, _ = api
    google(client)
    user = client.put("/api/profile", json={"major": "Biology", "interests": ["Science"], "campus": "Busch", "onboarded": True}).json()
    assert user["major"] == "Biology" and user["onboarded"] is True
    assert client.get("/api/auth/me").json()["major"] == "Biology"
    assert client.put("/api/profile", json={"major": "x" * 101}).status_code == 422
    top = client.get("/api/recommendations?limit=1").json()["clubs"][0]
    assert top["id"] == "bio"


def test_saved_items_belong_to_the_signed_in_google_account(api):
    client, _ = api
    google(client, sub="g-1", email=f"one@{DOMAIN}")
    assert client.post("/api/clubs/chess/follow").json() == {"following": True}
    client.post("/api/auth/logout")
    assert client.get("/api/saved").status_code == 401
    google(client, sub="g-2", email=f"two@{DOMAIN}")
    assert client.get("/api/saved").json()["club_ids"] == []
    client.post("/api/auth/logout")
    google(client, sub="g-1", email=f"one@{DOMAIN}")
    assert client.get("/api/saved").json()["club_ids"] == ["chess"]


def test_existing_database_gains_new_user_columns(tmp_path):
    db = tmp_path / "old.db"
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL, interests TEXT NOT NULL DEFAULT '[]', goals TEXT NOT NULL DEFAULT '', campus TEXT NOT NULL DEFAULT '', onboarded INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)")
        conn.execute("INSERT INTO users(id,email,password_hash,display_name,role,created_at) VALUES ('old','old@example.edu','x','Old','student','2026-01-01')")
    path = tmp_path / "seed.json"
    path.write_text('{"clubs":[],"events":[]}')
    with TestClient(create_app(db_path=db, seed_path=path, demo_mode=False, google_client_id=""), headers=ORIGIN):
        pass
    with sqlite3.connect(db) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
        assert {"major", "google_sub"} <= columns
        assert conn.execute("SELECT major FROM users WHERE id='old'").fetchone() == ("",)


def grant(db, club_id, email):
    from backend.app import grant_club_owner
    from backend.db import SQLite
    with SQLite(db).connect() as conn:
        return grant_club_owner(conn, club_id, email)


def test_pending_owner_gets_club_manager_access_at_first_sign_in(api):
    client, db = api
    assert grant(db, "chess", f"OWNER@{DOMAIN}") == "invited"
    user = google(client, sub="g-owner", email=f"owner@{DOMAIN}").json()
    assert user["managed_club_ids"] == ["chess"]
    assert client.get("/api/auth/me").json()["managed_club_ids"] == ["chess"]
    assert [c["id"] for c in client.get("/api/officer/clubs").json()] == ["chess"]
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT COUNT(*) FROM club_owner_invites").fetchone()[0] == 0
    # An existing account is granted immediately.
    assert grant(db, "bio", f"owner@{DOMAIN}") == "granted"
    assert client.get("/api/auth/me").json()["managed_club_ids"] == ["bio", "chess"]


def test_non_owners_cannot_open_the_club_manager_or_edit(api):
    client, db = api
    user = google(client).json()
    assert user["managed_club_ids"] == []
    assert client.get("/api/officer/clubs").status_code == 403
    assert client.put("/api/officer/clubs/chess", json={"description": "Taken over by a random student."}).status_code == 403
    grant(db, "bio", f"ab123@{DOMAIN}")
    # Owning one club doesn't open another.
    assert client.put("/api/officer/clubs/chess", json={"description": "Taken over by a random student."}).status_code == 403


def test_owner_can_edit_every_club_field_including_tags(api):
    client, db = api
    grant(db, "chess", f"ab123@{DOMAIN}")
    google(client)
    changes = {"name": "Knight Riders Chess", "short_name": "KRC", "category": "Lifestyle & Hobbies", "description": "Casual and rated chess for every level.",
               "mission": "Teach chess and run weekly tournaments.", "interests": ["chess", " strategy ", "chess", "board games"], "campus": "",
               "location": "Busch Student Center 116", "meeting_schedule": "Tuesdays 8 PM", "membership_fee": "Free", "eligibility": "All students",
               "contact_email": "knights@scarletmail.rutgers.edu", "website": "https://example.com", "instagram": "https://instagram.com/knights",
               "discord": "https://discord.gg/knights", "color": "#123ABC", "beginner_friendly": True,
               "faqs": [{"question": "Do I need a board?", "answer": "No, we bring boards and clocks."}]}
    response = client.put("/api/officer/clubs/chess", json=changes)
    assert response.status_code == 200, response.text
    saved = client.get("/api/clubs/chess").json()
    assert saved["name"] == "Knight Riders Chess" and saved["interests"] == ["chess", "strategy", "board games"]
    assert saved["color"] == "#123ABC" and saved["campus"] == "" and saved["discord"] == "https://discord.gg/knights"
    assert client.put("/api/officer/clubs/chess", json={"color": "red"}).status_code == 422
    assert client.put("/api/officer/clubs/chess", json={"interests": ["x" * 61]}).status_code == 422
    assert client.put("/api/officer/clubs/chess", json={"verification": "verified"}).status_code == 422


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def test_owner_uploads_replaces_and_removes_a_logo(api):
    client, db = api
    grant(db, "chess", f"ab123@{DOMAIN}")
    google(client)
    response = client.put("/api/officer/clubs/chess/logo", content=PNG, headers={"Content-Type": "image/png"})
    assert response.status_code == 200, response.text
    logo_url = response.json()["logo_url"]
    assert logo_url.startswith("/api/clubs/chess/logo?v=")
    assert client.get("/api/clubs/chess").json()["logo_url"] == logo_url
    client.post("/api/auth/logout")
    image = client.get(logo_url)  # anyone can see a logo
    assert image.status_code == 200 and image.content == PNG and image.headers["content-type"] == "image/png"
    assert "sandbox" in image.headers["content-security-policy"] and image.headers["x-content-type-options"] == "nosniff"
    google(client)
    # Editing the profile keeps the logo.
    client.put("/api/officer/clubs/chess", json={"description": "Casual and rated chess for every level."})
    assert client.get("/api/clubs/chess").json()["logo_url"] == logo_url
    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 64
    assert client.put("/api/officer/clubs/chess/logo", content=jpeg).status_code == 200
    assert client.get("/api/clubs/chess/logo").headers["content-type"] == "image/jpeg"
    assert client.delete("/api/officer/clubs/chess/logo").status_code == 200
    assert "logo_url" not in client.get("/api/clubs/chess").json()
    assert client.get("/api/clubs/chess/logo").status_code == 404


def test_logo_uploads_are_checked(api):
    client, db = api
    google(client)
    # Not an owner of this club.
    assert client.put("/api/officer/clubs/chess/logo", content=PNG).status_code == 403
    grant(db, "chess", f"ab123@{DOMAIN}")
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    for bad in (svg, b"<html>hi</html>", b"GIF8"):
        assert client.put("/api/officer/clubs/chess/logo", content=bad, headers={"Content-Type": "image/png"}).status_code == 415
    too_big = PNG + b"\x00" * (1024 * 1024)
    assert client.put("/api/officer/clubs/chess/logo", content=too_big).status_code == 413
    # Ordinary requests keep the small body limit.
    assert client.put("/api/officer/clubs/chess", content=b"{" + b" " * 70000 + b"}", headers={"Content-Type": "application/json"}).status_code == 413
    client.post("/api/auth/logout")
    assert client.put("/api/officer/clubs/chess/logo", content=PNG).status_code == 401
