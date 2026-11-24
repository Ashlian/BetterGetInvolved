"""Direct messages, questions to club managers, notifications, and blocking.

A conversation is either "direct" (two students) or "club" (one student and whoever manages the
club right now). Reading always goes through `participant`, so a conversation that isn't yours is
indistinguishable from one that doesn't exist. Site admins get no special access.
"""

import json
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

MESSAGE_SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('direct','club')), club_id TEXT REFERENCES clubs(id) ON DELETE CASCADE, starter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, other_id TEXT REFERENCES users(id) ON DELETE CASCADE, pair_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_message_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS conversations_starter_idx ON conversations(starter_id,last_message_at);
CREATE INDEX IF NOT EXISTS conversations_other_idx ON conversations(other_id,last_message_at);
CREATE INDEX IF NOT EXISTS conversations_club_idx ON conversations(club_id,last_message_at);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, as_club INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS messages_author_idx ON messages(author_id);
CREATE TABLE IF NOT EXISTS conversation_reads(conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, read_at TEXT NOT NULL, PRIMARY KEY(conversation_id,user_id));
CREATE TABLE IF NOT EXISTS user_blocks(blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY(blocker_id,blocked_id));
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, actor_id TEXT REFERENCES users(id) ON DELETE CASCADE, club_id TEXT REFERENCES clubs(id) ON DELETE CASCADE, post_id TEXT REFERENCES forum_posts(id) ON DELETE CASCADE, comment_id TEXT REFERENCES forum_comments(id) ON DELETE CASCADE, event_id TEXT REFERENCES events(id) ON DELETE CASCADE, created_at TEXT NOT NULL, read_at TEXT);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id,created_at);
"""

MESSAGE_MAX = 2000
THREAD_LIMIT = 200  # newest messages shown in one conversation
NEW_DIRECT_PER_DAY = 20
CLUB_UNANSWERED_MAX = 5
NOTIFICATION_LIMIT = 50

# Conversations this user takes part in: their own, or their clubs' questions from other students.
MINE = "(c.starter_id=? OR c.other_id=? OR (c.kind='club' AND c.club_id IN (SELECT club_id FROM officers WHERE user_id=?)))"
# A message is unread for someone on the other side of the conversation. Managers of one club are
# on the same side, so a colleague's reply isn't unread.
INCOMING = "((c.kind='direct' AND m.author_id<>?) OR (c.kind='club' AND ((c.starter_id=? AND m.as_club=1) OR (c.starter_id<>? AND m.as_club=0))))"


def now_iso():
    # Always six decimals: these strings are compared as text.
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


class MessageInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    body: str = Field(min_length=1, max_length=MESSAGE_MAX)

    @field_validator("body")
    @classmethod
    def plain_text(cls, value):
        if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", value):
            raise ValueError("Messages cannot contain control characters")
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            raise ValueError("Messages must contain valid Unicode")
        return value


class DirectInput(MessageInput):
    user_id: str = Field(min_length=1, max_length=100)


class ClubQuestion(MessageInput):
    club_id: str = Field(min_length=1, max_length=100)


class ReadNotifications(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # None marks everything read.
    id: str | None = Field(default=None, max_length=100)


def is_blocked(conn, a, b):
    """True when either student has blocked the other."""
    return bool(conn.execute("SELECT 1 FROM user_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)", (a, b, b, a)).fetchone())


def has_blocked(conn, blocker, blocked):
    return bool(conn.execute("SELECT 1 FROM user_blocks WHERE blocker_id=? AND blocked_id=?", (blocker, blocked)).fetchone())


def pair_key(a, b):
    return "direct:" + ":".join(sorted((a, b)))


def can_message(conn, viewer_id, row):
    """May `viewer_id` write to the student in `row`? Someone who wrote to you can always be answered."""
    if viewer_id == row["id"] or is_blocked(conn, viewer_id, row["id"]):
        return False
    if row["message_access"] == "students":
        return True
    return bool(conn.execute("SELECT 1 FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.pair_key=? AND m.author_id=?", (pair_key(viewer_id, row["id"]), row["id"])).fetchone())


def notify(conn, user_ids, kind, *, actor_id=None, club_id=None, post_id=None, comment_id=None, event_id=None):
    """Add one notification per user, never to the actor or across a block."""
    users = set(user_ids) - {actor_id}
    if actor_id and users:
        users -= {r[0] for r in conn.execute("SELECT blocked_id FROM user_blocks WHERE blocker_id=? UNION SELECT blocker_id FROM user_blocks WHERE blocked_id=?", (actor_id, actor_id))}
    users, stamp = sorted(users), now_iso()
    for start in range(0, len(users), 80):
        chunk = users[start:start + 80]
        rows = [value for u in chunk for value in (str(uuid.uuid4()), u, kind, actor_id, club_id, post_id, comment_id, event_id, stamp)]
        conn.execute("INSERT INTO notifications(id,user_id,kind,actor_id,club_id,post_id,comment_id,event_id,created_at) VALUES " + ",".join(["(?,?,?,?,?,?,?,?,?)"] * len(chunk)), rows)


def followers(conn, club_id):
    return [r[0] for r in conn.execute("SELECT user_id FROM follows WHERE club_id=?", (club_id,))]


def manages(conn, user_id, club_id):
    return bool(conn.execute("SELECT 1 FROM officers WHERE user_id=? AND club_id=?", (user_id, club_id)).fetchone())


def notify_post(conn, post_id, club_id, author_id):
    """A club manager's post in their own club is an announcement to its followers."""
    if manages(conn, author_id, club_id):
        notify(conn, followers(conn, club_id), "announcement", actor_id=author_id, club_id=club_id, post_id=post_id)


def notify_comment(conn, post_id, comment_id, author_id):
    post = conn.execute("SELECT author_id,club_id FROM forum_posts WHERE id=?", (post_id,)).fetchone()
    others = {r[0] for r in conn.execute("SELECT DISTINCT author_id FROM forum_comments WHERE post_id=?", (post_id,))} - {post["author_id"]}
    refs = {"actor_id": author_id, "club_id": post["club_id"], "post_id": post_id, "comment_id": comment_id}
    notify(conn, [post["author_id"]], "comment", **refs)
    notify(conn, others, "reply", **refs)


def notify_event(conn, event, kind, actor_id):
    if kind == "event_new":
        users = followers(conn, event["club_id"])
    else:
        users = [r[0] for r in conn.execute("SELECT user_id FROM saves WHERE event_id=? UNION SELECT user_id FROM rsvps WHERE event_id=?", (event["id"], event["id"]))]
    notify(conn, users, kind, actor_id=actor_id, club_id=event["club_id"], event_id=event["id"])


def participant(conn, conversation_id, user_id):
    """The conversation, or 404 for anyone who isn't part of it."""
    row = None if "\x00" in conversation_id else conn.execute(f"SELECT c.* FROM conversations c WHERE c.id=? AND {MINE}", (conversation_id, user_id, user_id, user_id)).fetchone()
    if not row:
        raise HTTPException(404, "Conversation not found")
    return row


def register(app, store, current_user, optional_user, student_card):
    def mark_read(conn, conversation_id, user_id, stamp):
        conn.execute("INSERT INTO conversation_reads(conversation_id,user_id,read_at) VALUES (?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET read_at=excluded.read_at WHERE conversation_reads.read_at<excluded.read_at", (conversation_id, user_id, stamp))

    def insert_message(conn, conversation, user_id, as_club, body):
        # Strictly after the previous message, so order and unread counts never depend on clock ticks.
        previous = datetime.fromisoformat(conversation["last_message_at"])
        stamp = max(datetime.now(timezone.utc), previous + timedelta(microseconds=1)).isoformat(timespec="microseconds")
        conn.execute("INSERT INTO messages(id,conversation_id,author_id,as_club,body,created_at) VALUES (?,?,?,?,?,?)", (str(uuid.uuid4()), conversation["id"], user_id, int(as_club), body, stamp))
        conn.execute("UPDATE conversations SET last_message_at=? WHERE id=?", (stamp, conversation["id"]))
        mark_read(conn, conversation["id"], user_id, stamp)

    def open_conversation(conn, key, kind, user_id, other_id=None, club_id=None):
        row = conn.execute("SELECT * FROM conversations WHERE pair_key=?", (key,)).fetchone()
        if row:
            return row
        if kind == "direct":
            since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="microseconds")
            if conn.execute("SELECT COUNT(*) FROM conversations WHERE kind='direct' AND starter_id=? AND created_at>?", (user_id, since)).fetchone()[0] >= NEW_DIRECT_PER_DAY:
                raise HTTPException(429, "You've started a lot of conversations today. Try again tomorrow.")
        conversation_id, stamp = str(uuid.uuid4()), now_iso()
        conn.execute("INSERT INTO conversations(id,kind,club_id,starter_id,other_id,pair_key,created_at,last_message_at) VALUES (?,?,?,?,?,?,?,?)", (conversation_id, kind, club_id, user_id, other_id, key, stamp, stamp))
        return conn.execute("SELECT * FROM conversations WHERE id=?", (conversation_id,)).fetchone()

    def send_direct(conn, user, target_id, body):
        target = None if "\x00" in target_id else conn.execute("SELECT * FROM users WHERE id=?", (target_id,)).fetchone()
        if not target:
            raise HTTPException(404, "Student not found")
        if target["id"] == user["id"]:
            raise HTTPException(422, "You can't message yourself")
        # The lock makes the first-message limit hold when two requests arrive together.
        conn.lock(pair_key(user["id"], target["id"]))
        if not can_message(conn, user["id"], target):
            raise HTTPException(403, "You can't message this student")
        conversation = open_conversation(conn, pair_key(user["id"], target["id"]), "direct", user["id"], other_id=target["id"])
        authors = {r[0] for r in conn.execute("SELECT DISTINCT author_id FROM messages WHERE conversation_id=?", (conversation["id"],))}
        if user["id"] in authors and target["id"] not in authors:
            raise HTTPException(409, "You can send another message after they reply")
        insert_message(conn, conversation, user["id"], False, body)
        return conversation["id"]

    def send_to_club(conn, user, club_id, body):
        if "\x00" in club_id or not conn.execute("SELECT 1 FROM clubs WHERE id=?", (club_id,)).fetchone():
            raise HTTPException(404, "Club not found")
        key = f"club:{club_id}:{user['id']}"
        conn.lock(key)
        if not conn.execute("SELECT 1 FROM officers WHERE club_id=?", (club_id,)).fetchone():
            raise HTTPException(409, "No one manages this club on ClRUb yet, so there's nobody to answer")
        existing = conn.execute("SELECT * FROM conversations WHERE pair_key=?", (key,)).fetchone()
        if not existing and manages(conn, user["id"], club_id):
            raise HTTPException(422, "You manage this club")
        conversation = existing or open_conversation(conn, key, "club", user["id"], club_id=club_id)
        answered = conn.execute("SELECT MAX(created_at) FROM messages WHERE conversation_id=? AND as_club=1", (conversation["id"],)).fetchone()[0] or ""
        waiting = conn.execute("SELECT COUNT(*) FROM messages WHERE conversation_id=? AND as_club=0 AND created_at>?", (conversation["id"], answered)).fetchone()[0]
        if waiting >= CLUB_UNANSWERED_MAX:
            raise HTTPException(409, "You've sent several questions already. You can write again after the club replies.")
        insert_message(conn, conversation, user["id"], False, body)
        return conversation["id"]

    def side(row, user_id):
        return "club" if row["kind"] == "club" and row["starter_id"] != user_id else "student"

    def conversation_list(conn, user, only=None):
        me = user["id"]
        rows = conn.execute(f"""SELECT c.*,cl.payload AS club_payload FROM conversations c LEFT JOIN clubs cl ON cl.id=c.club_id
            WHERE {MINE} {'AND c.id=?' if only else ''} ORDER BY c.last_message_at DESC LIMIT 100""", (me, me, me, *([only] if only else []))).fetchall()
        if not rows:
            return []
        ids = [r["id"] for r in rows]
        marks = ",".join("?" * len(ids))
        unread = {r[0]: r[1] for r in conn.execute(f"""SELECT c.id,COUNT(*) FROM conversations c JOIN messages m ON m.conversation_id=c.id
            LEFT JOIN conversation_reads r ON r.conversation_id=c.id AND r.user_id=?
            WHERE c.id IN ({marks}) AND {INCOMING} AND (r.read_at IS NULL OR m.created_at>r.read_at) GROUP BY c.id""", (me, *ids, me, me, me))}
        last = {r["conversation_id"]: r for r in conn.execute(f"SELECT m.conversation_id,m.body,m.author_id,m.as_club FROM messages m WHERE m.conversation_id IN ({marks}) AND m.created_at=(SELECT MAX(x.created_at) FROM messages x WHERE x.conversation_id=m.conversation_id)", ids)}
        authors = {(r[0], r[1]) for r in conn.execute(f"SELECT DISTINCT conversation_id,author_id FROM messages WHERE conversation_id IN ({marks})", ids)}
        wanted = sorted({r["other_id"] if r["starter_id"] == me else r["starter_id"] for r in rows if r["kind"] == "direct" or r["starter_id"] != me})
        people = {p["id"]: p for p in conn.execute(f"SELECT * FROM users WHERE id IN ({','.join('?' * len(wanted))})", wanted)} if wanted else {}
        out = []
        for row in rows:
            mine, direct = side(row, me), row["kind"] == "direct"
            other_id = row["other_id"] if row["starter_id"] == me else row["starter_id"]
            card = student_card(people[other_id], user) if other_id in people else None
            club = json.loads(row["club_payload"]) if row["club_payload"] else None
            tail = last.get(row["id"])  # None when every message's author has deleted their account
            i_wrote, they_wrote = (row["id"], me) in authors, (row["id"], other_id) in authors
            out.append({
                "id": row["id"], "kind": row["kind"], "side": mine,
                "title": card["display_name"] if card else club["name"] if club else "Conversation",
                "person": card,
                "club": {key: club.get(key) for key in ("id", "name", "category", "color", "logo_url")} if club else None,
                "last_message": tail["body"][:140] if tail else "", "last_is_mine": bool(tail and tail["author_id"] == me),
                "last_message_at": row["last_message_at"], "unread": unread.get(row["id"], 0),
                "needs_reply": bool(mine == "club" and tail and not tail["as_club"]),
                # A first message from a student you haven't answered yet, or one of yours they haven't.
                "request": direct and they_wrote and not i_wrote,
                "awaiting_reply": direct and i_wrote and not they_wrote,
            })
        return out

    def detail(conn, conversation_id, user):
        row = participant(conn, conversation_id, user["id"])
        summary = {**conversation_list(conn, user, only=row["id"])[0], "blocked_by_me": False}
        messages = conn.execute("SELECT m.*,u.display_name FROM messages m JOIN users u ON u.id=m.author_id WHERE m.conversation_id=? ORDER BY m.created_at DESC LIMIT ?", (row["id"], THREAD_LIMIT)).fetchall()
        can_reply, note = True, ""
        if row["kind"] == "direct":
            other_id = row["other_id"] if row["starter_id"] == user["id"] else row["starter_id"]
            other = conn.execute("SELECT * FROM users WHERE id=?", (other_id,)).fetchone()
            summary["blocked_by_me"] = has_blocked(conn, user["id"], other_id)
            if not can_message(conn, user["id"], other):
                can_reply, note = False, "You blocked this student." if summary["blocked_by_me"] else "You can't message this student."
            elif summary["awaiting_reply"]:
                can_reply, note = False, "You can send another message after they reply."
        elif summary["side"] == "student" and not conn.execute("SELECT 1 FROM officers WHERE club_id=?", (row["club_id"],)).fetchone():
            can_reply, note = False, "No one manages this club on ClRUb right now."
        return {**summary, "can_reply": can_reply, "reply_note": note, "messages": [
            {"id": m["id"], "body": m["body"], "created_at": m["created_at"], "mine": m["author_id"] == user["id"], "as_club": bool(m["as_club"]), "author_id": m["author_id"], "author_name": m["display_name"]} for m in reversed(messages)]}

    def unread_counts(conn, user_id):
        messages = conn.execute(f"""SELECT COUNT(*) FROM conversations c JOIN messages m ON m.conversation_id=c.id
            LEFT JOIN conversation_reads r ON r.conversation_id=c.id AND r.user_id=?
            WHERE {MINE} AND {INCOMING} AND (r.read_at IS NULL OR m.created_at>r.read_at)""", (user_id,) * 7).fetchone()[0]
        notes = conn.execute("SELECT COUNT(*) FROM notifications WHERE user_id=? AND read_at IS NULL", (user_id,)).fetchone()[0]
        return {"messages": messages, "notifications": notes}

    @app.get("/api/inbox/unread")
    def inbox_unread(user=Depends(current_user)):
        with store.connect() as conn:
            return unread_counts(conn, user["id"])

    @app.get("/api/inbox")
    def inbox(user=Depends(current_user)):
        with store.connect() as conn:
            rows = conn.execute("""SELECT n.*,u.display_name AS actor_name,p.title AS post_title,fc.body AS comment_body,e.payload AS event_payload,c.payload AS club_payload
                FROM notifications n LEFT JOIN users u ON u.id=n.actor_id LEFT JOIN forum_posts p ON p.id=n.post_id
                LEFT JOIN forum_comments fc ON fc.id=n.comment_id LEFT JOIN events e ON e.id=n.event_id LEFT JOIN clubs c ON c.id=n.club_id
                WHERE n.user_id=? ORDER BY n.created_at DESC,n.id DESC LIMIT ?""", (user["id"], NOTIFICATION_LIMIT)).fetchall()
            return {"conversations": conversation_list(conn, user), "unread": unread_counts(conn, user["id"]), "notifications": [{
                "id": n["id"], "kind": n["kind"], "created_at": n["created_at"], "read": n["read_at"] is not None,
                # Event notices come from the club, not from a named manager.
                "actor_id": None if n["event_id"] else n["actor_id"], "actor_name": None if n["event_id"] else n["actor_name"],
                "club_id": n["club_id"], "club_name": json.loads(n["club_payload"])["name"] if n["club_payload"] else "",
                "post_id": n["post_id"], "event_id": n["event_id"],
                "title": n["post_title"] or (json.loads(n["event_payload"])["title"] if n["event_payload"] else ""),
                "excerpt": (n["comment_body"] or "")[:160]} for n in rows]}

    @app.post("/api/notifications/read")
    def read_notifications(body: ReadNotifications, user=Depends(current_user)):
        with store.connect() as conn:
            conn.execute("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL" + (" AND id=?" if body.id else ""), (now_iso(), user["id"], *([body.id.replace("\x00", "")] if body.id else [])))
            return unread_counts(conn, user["id"])

    @app.post("/api/conversations/direct", status_code=201)
    def start_direct(body: DirectInput, user=Depends(current_user)):
        with store.connect() as conn:
            return detail(conn, send_direct(conn, user, body.user_id, body.body), user)

    @app.post("/api/conversations/club", status_code=201)
    def ask_club(body: ClubQuestion, user=Depends(current_user)):
        with store.connect() as conn:
            return detail(conn, send_to_club(conn, user, body.club_id, body.body), user)

    @app.get("/api/conversations/{conversation_id}")
    def conversation(conversation_id: str, user=Depends(current_user)):
        with store.connect() as conn:
            return detail(conn, conversation_id, user)

    @app.post("/api/conversations/{conversation_id}/messages", status_code=201)
    def reply(conversation_id: str, body: MessageInput, user=Depends(current_user)):
        with store.connect() as conn:
            row = participant(conn, conversation_id, user["id"])
            if row["kind"] == "direct":
                send_direct(conn, user, row["other_id"] if row["starter_id"] == user["id"] else row["starter_id"], body.body)
            elif side(row, user["id"]) == "student":
                send_to_club(conn, user, row["club_id"], body.body)
            else:
                conn.lock(row["pair_key"])
                # Read again under the lock: someone may have written, or this manager been removed.
                insert_message(conn, participant(conn, conversation_id, user["id"]), user["id"], True, body.body)
            return detail(conn, conversation_id, user)

    @app.post("/api/conversations/{conversation_id}/read")
    def read_conversation(conversation_id: str, user=Depends(current_user)):
        with store.connect() as conn:
            mark_read(conn, conversation_id, user["id"], participant(conn, conversation_id, user["id"])["last_message_at"])
            return unread_counts(conn, user["id"])

    @app.put("/api/users/{user_id}/block")
    def block(user_id: str, user=Depends(current_user)):
        with store.connect() as conn:
            if "\x00" in user_id or not conn.execute("SELECT 1 FROM users WHERE id=?", (user_id,)).fetchone():
                raise HTTPException(404, "Student not found")
            if user_id == user["id"]:
                raise HTTPException(422, "You can't block yourself")
            conn.execute("INSERT INTO user_blocks VALUES (?,?,?) ON CONFLICT DO NOTHING", (user["id"], user_id, now_iso()))
        return {"blocked": True}

    @app.delete("/api/users/{user_id}/block")
    def unblock(user_id: str, user=Depends(current_user)):
        with store.connect() as conn:
            conn.execute("DELETE FROM user_blocks WHERE blocker_id=? AND blocked_id=?", (user["id"], user_id.replace("\x00", "")))
        return {"blocked": False}

    @app.get("/api/clubs/{club_id}/managers")
    def club_managers(club_id: str, request: Request):
        """Who manages a club. Names are for signed-in students; guests get only the count."""
        club_id = club_id.replace("\x00", "")
        store.record("clubs", club_id)
        viewer = optional_user(request)
        with store.connect() as conn:
            rows = conn.execute("SELECT u.* FROM users u JOIN officers o ON o.user_id=u.id WHERE o.club_id=? ORDER BY u.display_name,u.id", (club_id,)).fetchall()
            existing = conn.execute("SELECT id FROM conversations WHERE pair_key=?", (f"club:{club_id}:{viewer['id']}",)).fetchone() if viewer else None
        return {"count": len(rows), "managers": [student_card(r, viewer) for r in rows] if viewer else [], "is_manager": bool(viewer and any(r["id"] == viewer["id"] for r in rows)), "conversation_id": existing[0] if existing else None}
