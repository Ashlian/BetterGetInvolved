"""Forums against a temporary SQLite database; never touches live sync/data."""

import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.app import FORUM_COMMENT_LIMIT, create_app
from test_api import ORIGIN, club, login, register


@pytest.fixture
def api(tmp_path):
    seed = tmp_path / "forum-seed.json"
    seed.write_text(json.dumps({"clubs":[club("ai","Demo AI Club"),club("arts","Demo Arts Club",category="Arts")],"events":[]}))
    db = tmp_path / "forums.db"
    app = create_app(db_path=db,seed_path=seed,demo_mode=True,live_sync=False)
    with TestClient(app,headers=ORIGIN) as client:
        yield client,db


def post(client,title="First club discussion",body="Let's plan a friendly project.",club_id="ai"):
    response = client.post("/api/forums",json={"club_id":club_id,"title":title,"body":body})
    assert response.status_code == 201,response.text
    return response.json()


def comment(client,post_id,body="Count me in!"):
    response = client.post(f"/api/forums/{post_id}/comments",json={"body":body})
    assert response.status_code == 201,response.text
    return response.json()


def test_forum_create_public_read_current_names_and_private_fields(api):
    client,_ = api
    assert client.get("/api/forums").json() == []
    user = login(client)
    created = post(client,title="  New project  ",body="  First line\nSecond line <b>plain text</b>  ")
    assert set(created) == {"id","club_id","club_name","title","body","author_name","created_at","updated_at","comment_count","can_delete"}
    assert created["title"] == "New project"
    assert created["body"] == "First line\nSecond line <b>plain text</b>"
    assert created["author_name"] == user["display_name"]
    assert created["can_delete"] and created["comment_count"] == 0
    assert datetime.fromisoformat(created["created_at"]).utcoffset() == timedelta(0)
    assert client.put("/api/profile",json={"display_name":"Changed Public Name"}).status_code == 200
    reply = comment(client,created["id"],"  A plain-text reply  ")
    assert set(reply) == {"id","post_id","body","author_name","created_at","can_delete"}
    assert reply["body"] == "A plain-text reply"
    assert reply["author_name"] == "Changed Public Name"
    client.cookies.clear()
    listing = client.get("/api/forums")
    thread = client.get(f"/api/forums/{created['id']}")
    assert listing.headers["cache-control"] == thread.headers["cache-control"] == "no-store"
    assert listing.json()[0]["author_name"] == "Changed Public Name"
    assert listing.json()[0]["can_delete"] is False
    assert thread.json()["comments"][0]["can_delete"] is False
    assert thread.json()["comment_count"] == 1
    serialized = json.dumps(thread.json())
    for private_field in ("author_id","email","password","session","@demo.local"):
        assert private_field not in serialized


def test_forum_requires_sessions_and_origin_and_rejects_author_spoofing(api):
    client,_ = api
    payload = {"club_id":"ai","title":"A valid title","body":"A valid body"}
    assert client.post("/api/forums",json=payload).status_code == 401
    assert client.post("/api/forums/missing/comments",json={"body":"Reply"}).status_code == 401
    assert client.delete("/api/forums/missing").status_code == 401
    assert client.delete("/api/forums/missing/comments/missing").status_code == 401
    login(client)
    assert client.post("/api/forums",json=payload,headers={"Origin":"https://evil.example"}).status_code == 403
    for key,value in (("author_id","demo-officer"),("author_name","Pretend Officer"),("created_at","2020-01-01"),("can_delete",True)):
        assert client.post("/api/forums",json={**payload,key:value}).status_code == 422
    created = post(client)
    assert client.post(f"/api/forums/{created['id']}/comments",json={"body":"Reply","author_id":"demo-officer"}).status_code == 422
    assert client.post(f"/api/forums/{created['id']}/comments",json={"body":"Reply","post_id":"other"}).status_code == 422


def test_forum_validation_limits_blanks_types_and_control_characters(api):
    client,_ = api
    login(client)
    payload = {"club_id":"ai","title":"A valid title","body":"A valid body"}
    for updates in ({"title":"  "},{"title":"ab"},{"title":"x"*161},{"body":"\n\t "},{"body":"x"*10001},{"body":True},{"title":False},{"club_id":True},{"body":"bad\x00text"}):
        assert client.post("/api/forums",json={**payload,**updates}).status_code == 422,updates
    created = post(client,title="x"*160,body="x"*10000)
    for body in ("  ","x"*3001,True,"bad\x00text"):
        assert client.post(f"/api/forums/{created['id']}/comments",json={"body":body}).status_code == 422
    assert len(comment(client,created["id"],"x"*3000)["body"]) == 3000


def test_forum_literal_search_club_filter_and_sort_validation(api):
    client,_ = api
    login(client)
    percent = post(client,title="Progress is 100%",body="The first idea")
    underscore = post(client,title="A second idea",body="Bring the club_notes file",club_id="arts")
    quote = post(client,title="An apostrophe's place",body="Literal ' OR 1=1; -- and ! characters")
    ids = lambda response: {entry["id"] for entry in response.json()}
    assert ids(client.get("/api/forums",params={"q":"%"})) == {percent["id"]}
    assert ids(client.get("/api/forums",params={"q":"_"})) == {underscore["id"]}
    assert ids(client.get("/api/forums",params={"q":"' OR 1=1; --"})) == {quote["id"]}
    assert ids(client.get("/api/forums",params={"q":"!"})) == {quote["id"]}
    assert ids(client.get("/api/forums",params={"q":"DEMO ARTS CLUB"})) == {underscore["id"]}
    assert ids(client.get("/api/forums",params={"club_id":"ai"})) == {percent["id"],quote["id"]}
    assert client.get("/api/forums",params={"q":"first","club_id":"arts"}).json() == []
    assert client.get("/api/forums",params={"sort":"invalid"}).status_code == 422
    assert client.get("/api/forums",params={"q":"bad\x00query"}).status_code == 422
    # Club display names are current, rather than an uneditable copy on the post.
    login(client,officer=True)
    assert client.put("/api/officer/clubs/ai",json={"name":"Renamed Computing Club"}).status_code == 200
    renamed = client.get("/api/forums",params={"q":"renamed computing"}).json()
    assert len(renamed) == 2 and all(p["club_name"] == "Renamed Computing Club" for p in renamed)


def test_forum_newest_active_and_oldest_comment_order(api,monkeypatch):
    client,_ = api
    login(client)
    times = iter(["2026-11-12T10:00:00+00:00","2026-11-12T11:00:00+00:00","2026-11-12T12:00:00+00:00","2026-11-12T13:00:00+00:00"])
    monkeypatch.setattr("backend.app.now_iso",lambda:next(times))
    older = post(client,title="Older discussion")
    newer = post(client,title="Newer discussion")
    first_reply = comment(client,older["id"],"Earlier reply")
    second_reply = comment(client,older["id"],"Later reply")
    assert [p["id"] for p in client.get("/api/forums",params={"sort":"newest"}).json()] == [newer["id"],older["id"]]
    assert [p["id"] for p in client.get("/api/forums",params={"sort":"active"}).json()] == [older["id"],newer["id"]]
    thread = client.get(f"/api/forums/{older['id']}").json()
    assert [c["id"] for c in thread["comments"]] == [first_reply["id"],second_reply["id"]]
    assert thread["updated_at"] == second_reply["created_at"]
    assert client.delete(f"/api/forums/{older['id']}/comments/{second_reply['id']}").status_code == 200
    assert client.get(f"/api/forums/{older['id']}").json()["updated_at"] == first_reply["created_at"]
    assert client.delete(f"/api/forums/{older['id']}/comments/{first_reply['id']}").status_code == 200
    assert client.get(f"/api/forums/{older['id']}").json()["updated_at"] == older["created_at"]
    assert client.get("/api/forums",params={"sort":"active"}).json()[0]["id"] == newer["id"]


def test_forum_search_before_limit_and_stable_tie_order(api):
    client,_ = api
    login(client)
    with client.app.state.store.connect() as conn:
        for index in range(105):
            when = (datetime(2026,11,12,tzinfo=timezone.utc)+timedelta(minutes=index)).isoformat()
            conn.execute("INSERT INTO forum_posts VALUES (?,?,?,?,?,?,?)",(f"bulk-{index:03}","arts" if index == 0 else "ai","demo-student","Old unique needle" if index == 0 else "Discussion", "Body",when,when))
    listing = client.get("/api/forums").json()
    assert len(listing) == 100
    assert listing[0]["id"] == "bulk-104"
    assert [p["id"] for p in client.get("/api/forums",params={"q":"unique needle"}).json()] == ["bulk-000"]
    assert [p["id"] for p in client.get("/api/forums",params={"club_id":"arts"}).json()] == ["bulk-000"]
    with client.app.state.store.connect() as conn:
        conn.execute("UPDATE forum_posts SET created_at=?,updated_at=? WHERE id IN (?,?)",("2027-01-01T00:00:00+00:00","2027-01-01T00:00:00+00:00","bulk-103","bulk-104"))
    assert [p["id"] for p in client.get("/api/forums").json()[:2]] == ["bulk-104","bulk-103"]


def test_forum_ownership_officer_equal_privileges_and_admin_deletion(api):
    client,_ = api
    login(client)
    own_post = post(client)
    own_reply = comment(client,own_post["id"])
    login(client,officer=True)
    assert client.get(f"/api/forums/{own_post['id']}").json()["can_delete"] is False
    assert client.delete(f"/api/forums/{own_post['id']}").status_code == 403
    assert client.delete(f"/api/forums/{own_post['id']}/comments/{own_reply['id']}").status_code == 403
    # An officer may participate in any club's public discussions, but may not
    # moderate other authors just because they manage the club profile.
    officer_post = post(client,club_id="arts")
    officer_reply = comment(client,own_post["id"])
    login(client)
    assert client.delete(f"/api/forums/{own_post['id']}/comments/{officer_reply['id']}").status_code == 403
    assert client.delete(f"/api/forums/{officer_post['id']}/comments/{own_reply['id']}").status_code == 404
    with client.app.state.store.connect() as conn:
        conn.execute("UPDATE users SET role='admin' WHERE id='demo-student'")
    assert client.get(f"/api/forums/{officer_post['id']}").json()["can_delete"] is True
    assert client.delete(f"/api/forums/{own_post['id']}/comments/{officer_reply['id']}").json() == {"ok":True}
    assert client.delete(f"/api/forums/{officer_post['id']}").json() == {"ok":True}


def test_forum_missing_targets_and_reports(api):
    client,_ = api
    assert client.get("/api/forums/missing").status_code == 404
    assert client.get("/api/forums",params={"club_id":"missing"}).status_code == 404
    login(client)
    assert client.post("/api/forums",json={"club_id":"missing","title":"Valid title","body":"Body"}).status_code == 404
    assert client.post("/api/forums/missing/comments",json={"body":"Reply"}).status_code == 404
    assert client.delete("/api/forums/missing").status_code == 404
    created = post(client)
    reply = comment(client,created["id"])
    assert client.delete(f"/api/forums/{created['id']}/comments/missing").status_code == 404
    for kind,target in (("forum_post",created["id"]),("forum_comment",reply["id"])):
        assert client.post("/api/reports",json={"kind":kind,"target_id":target,"reason":"Please review this content."}).json() == {"ok":True}
        assert client.post("/api/reports",json={"kind":kind,"target_id":"missing","reason":"Please review this content."}).status_code == 404
    assert client.delete(f"/api/forums/{created['id']}").json() == {"ok":True}
    assert client.get(f"/api/forums/{created['id']}").status_code == 404
    with client.app.state.store.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM forum_comments WHERE post_id=?",(created["id"],)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM reports WHERE kind IN ('forum_post','forum_comment')").fetchone()[0] == 0


def test_forum_account_deletion_cascades_posts_and_comments(api):
    client,_ = api
    owner = register(client,email="forum-author@example.edu")
    owned_post = post(client)
    login(client,officer=True)
    remaining_post = post(client)
    comment(client,owned_post["id"],"Another author's reply on a deleted thread")
    assert client.post("/api/auth/login",json={"email":owner["email"],"password":"Long secret 2026!"}).status_code == 200
    comment(client,remaining_post["id"],"My comment on another person's thread")
    assert client.delete("/api/auth/me").json() == {"ok":True}
    assert client.get(f"/api/forums/{owned_post['id']}").status_code == 404
    remaining = client.get(f"/api/forums/{remaining_post['id']}").json()
    assert remaining["comments"] == [] and remaining["comment_count"] == 0
    assert remaining["updated_at"] == remaining["created_at"]
    with client.app.state.store.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM forum_posts WHERE author_id=?",(owner["id"],)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM forum_comments").fetchone()[0] == 0


def test_forum_thread_limit_is_explicit_and_preserves_all_comments(api):
    client,_ = api
    login(client)
    created = post(client)
    with client.app.state.store.connect() as conn:
        for index in range(FORUM_COMMENT_LIMIT):
            conn.execute("INSERT INTO forum_comments VALUES (?,?,?,?,?)",(f"comment-{index:04}",created["id"],"demo-student","Reply",created["created_at"]))
    response = client.get(f"/api/forums/{created['id']}")
    assert response.status_code == 200
    assert len(response.json()["comments"]) == FORUM_COMMENT_LIMIT
    blocked = client.post(f"/api/forums/{created['id']}/comments",json={"body":"One more"})
    assert blocked.status_code == 409 and "1,000" in blocked.json()["detail"]
    assert client.get(f"/api/forums/{created['id']}").json()["comment_count"] == FORUM_COMMENT_LIMIT


def test_forum_club_deletion_cascades_and_restart_keeps_records(api,tmp_path):
    client,db = api
    login(client)
    kept = post(client)
    removed = post(client,club_id="arts")
    comment(client,removed["id"])
    # No existing events or officer/follow rows refer to the arts fixture.
    with client.app.state.store.connect() as conn:
        conn.execute("DELETE FROM clubs WHERE id='arts'")
        assert conn.execute("SELECT COUNT(*) FROM forum_posts WHERE id=?",(removed["id"],)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM forum_comments WHERE post_id=?",(removed["id"],)).fetchone()[0] == 0
    restarted = create_app(db_path=db,seed_path=tmp_path / "forum-seed.json",demo_mode=True,live_sync=False)
    with TestClient(restarted,headers=ORIGIN) as after:
        assert after.get(f"/api/forums/{kept['id']}").json()["title"] == kept["title"]


def test_forum_write_rate_limit_does_not_block_public_reads(api):
    client,_ = api
    login(client)
    for index in range(30):
        post(client,title=f"Discussion {index}")
    limited = client.post("/api/forums",json={"club_id":"ai","title":"One more discussion","body":"Body"})
    assert limited.status_code == 429
    assert limited.headers["retry-after"] == "60"
    assert client.get("/api/forums").status_code == 200
