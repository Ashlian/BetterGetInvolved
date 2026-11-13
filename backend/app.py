"""FastAPI API for the local BetterGetInvolved demonstration.

All user-owned records are scoped from the authenticated session, never a client
user id. SQLite is the local MVP store; this is not a production identity service.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager, contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import live_events
from .db import SQLite, open_database
from .search import HybridIndex, MODEL_NAME, answer_faq, parse_constraints, same_campus, tokens


ROOT = Path(__file__).resolve().parents[1]
COOKIE = "bgi_session"
SESSION_SECONDS = 7 * 24 * 60 * 60
DEMO_ACCOUNTS = {
    "student@demo.local": ("StudentDemo2026!", "Alex Demo", "student"),
    "officer@demo.local": ("OfficerDemo2026!", "Jordan Demo", "officer"),
}
# Only Google accounts on these Workspace domains may sign in (ScarletMail by default).
DEFAULT_EMAIL_DOMAINS = "scarletmail.rutgers.edu"
GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")
# Contact details stay private to signed-in students; anonymous visitors get these placeholders.
EMAIL_PATTERN = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
DISCORD_PATTERN = re.compile(r"(?:https?://)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com/invite)/[\w-]+", re.I)
HIDDEN_EMAIL = "[email hidden: sign in to see]"
HIDDEN_DISCORD = "[Discord invite hidden: sign in to see]"
CLUB_TEXT_FIELDS = ("description", "mission", "meeting_schedule", "location", "eligibility", "membership_fee")


def public_club(club, user):
    """The club as a visitor may see it: signed-in users get everything, others no contacts."""
    if user:
        return {**club, "contacts_hidden": False}
    hidden = False

    def scrub(text):
        nonlocal hidden
        cleaned = DISCORD_PATTERN.sub(HIDDEN_DISCORD, EMAIL_PATTERN.sub(HIDDEN_EMAIL, text))
        hidden = hidden or cleaned != text
        return cleaned

    out = dict(club)
    for key in ("contact_email", "discord"):
        if out.get(key):
            out[key] = ""
            hidden = True
    for key in CLUB_TEXT_FIELDS:
        if isinstance(out.get(key), str):
            out[key] = scrub(out[key])
    out["faqs"] = [{**faq, "question": scrub(faq["question"]), "answer": scrub(faq["answer"])} for faq in out.get("faqs", [])]
    out["contacts_hidden"] = hidden
    return out


def google_token_verifier(client_id):
    """Verify a Google Identity Services ID token (signature, expiry, audience, issuer)."""
    def verify(credential):
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token
        return id_token.verify_oauth2_token(credential, google_requests.Request(), client_id)
    return verify


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=32768, r=8, p=3, maxmem=64*1024*1024, dklen=32)
    return f"scrypt$32768$8$3${salt}${digest.hex()}"


def check_password(password, stored):
    try:
        _, n, r, p, salt, expected = stored.split("$")
        digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), maxmem=64*1024*1024, dklen=32)
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, TypeError):
        return False


DUMMY_HASH = password_hash("timing-padding-not-a-user-password")


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Credentials(Input):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address")
        return value


class Registration(Credentials):
    display_name: str = Field(min_length=1, max_length=80)

    @field_validator("display_name")
    @classmethod
    def valid_name(cls, value):
        if not value.strip():
            raise ValueError("Display name cannot be blank")
        return value.strip()

    @field_validator("password")
    @classmethod
    def strong_password(cls, value):
        if len(value) < 12:
            raise ValueError("Password must have at least 12 characters")
        return value


class Profile(Input):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    major: str | None = Field(default=None, max_length=100)
    interests: list[str] | None = Field(default=None, max_length=20)
    goals: str | None = Field(default=None, max_length=1000)
    campus: str | None = Field(default=None, max_length=80)
    onboarded: bool | None = None

    @field_validator("interests")
    @classmethod
    def bounded_interests(cls, value):
        if value is not None and any(not item.strip() or len(item) > 60 for item in value):
            raise ValueError("Each interest must contain 1 to 60 characters")
        return list(dict.fromkeys(item.strip() for item in value)) if value is not None else value


class GoogleCredential(Input):
    credential: str = Field(min_length=20, max_length=4096)


class Question(Input):
    question: str = Field(min_length=3, max_length=500)


class RSVP(Input):
    status: Literal["interested", "going", "none"]


class Report(Input):
    kind: Literal["club", "event", "answer", "forum_post", "forum_comment"]
    target_id: str = Field(min_length=1, max_length=100)
    reason: str = Field(min_length=5, max_length=2000)


class ForumPostCreate(Input):
    club_id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=3, max_length=160)
    body: str = Field(min_length=1, max_length=10000)

    @field_validator("club_id", "title", "body")
    @classmethod
    def plain_text(cls, value):
        if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", value):
            raise ValueError("Text cannot contain control characters")
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            raise ValueError("Text must contain valid Unicode")
        return value


class ForumCommentCreate(Input):
    body: str = Field(min_length=1, max_length=3000)

    @field_validator("body")
    @classmethod
    def plain_text(cls, value):
        return ForumPostCreate.plain_text(value)


def safe_url(value, allow_blank=True):
    if not value and allow_blank:
        return value
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Use an http or https URL without embedded credentials")
    return value


class EventCreate(Input):
    club_id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=3, max_length=150)
    description: str = Field(min_length=10, max_length=5000)
    starts_at: datetime
    ends_at: datetime
    campus: str = Field(min_length=1, max_length=80)
    location: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=80)
    cost: float = Field(ge=0, le=10000, allow_inf_nan=False)
    beginner_friendly: bool
    registration_url: str = Field(default="", max_length=1000)
    accessibility: str = Field(default="Contact the club for accessibility details.", max_length=1000)

    @field_validator("registration_url")
    @classmethod
    def valid_url(cls, value):
        return safe_url(value)

    @model_validator(mode="after")
    def validate_dates(self):
        if self.starts_at.utcoffset() is None or self.ends_at.utcoffset() is None:
            raise ValueError("Event dates must include a timezone")
        if self.ends_at <= self.starts_at:
            raise ValueError("End time must be after start time")
        if self.ends_at - self.starts_at > timedelta(days=14):
            raise ValueError("An event cannot last longer than 14 days")
        return self


class EventPatch(Input):
    club_id: str | None = Field(default=None, min_length=1, max_length=100)
    title: str | None = Field(default=None, min_length=3, max_length=150)
    description: str | None = Field(default=None, min_length=10, max_length=5000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    campus: str | None = Field(default=None, min_length=1, max_length=80)
    location: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = Field(default=None, min_length=1, max_length=80)
    cost: float | None = Field(default=None, ge=0, le=10000, allow_inf_nan=False)
    beginner_friendly: bool | None = None
    registration_url: str | None = Field(default=None, max_length=1000)
    accessibility: str | None = Field(default=None, max_length=1000)
    status: Literal["scheduled", "cancelled"] | None = None


class FAQ(Input):
    question: str = Field(min_length=3, max_length=300)
    answer: str = Field(min_length=3, max_length=1500)


class ClubPatch(Input):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    short_name: str | None = Field(default=None, min_length=1, max_length=15)
    category: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, min_length=10, max_length=5000)
    mission: str | None = Field(default=None, max_length=2000)
    interests: list[str] | None = Field(default=None, max_length=20)
    campus: str | None = Field(default=None, min_length=1, max_length=80)
    location: str | None = Field(default=None, max_length=200)
    meeting_schedule: str | None = Field(default=None, max_length=300)
    beginner_friendly: bool | None = None
    membership_fee: str | None = Field(default=None, max_length=200)
    eligibility: str | None = Field(default=None, max_length=500)
    contact_email: str | None = Field(default=None, max_length=254)
    website: str | None = Field(default=None, max_length=1000)
    instagram: str | None = Field(default=None, max_length=1000)
    discord: str | None = Field(default=None, max_length=1000)
    faqs: list[FAQ] | None = Field(default=None, max_length=30)

    @field_validator("website", "instagram", "discord")
    @classmethod
    def valid_url(cls, value):
        return safe_url(value) if value is not None else None

    @field_validator("contact_email")
    @classmethod
    def valid_email(cls, value):
        if value and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid contact email")
        return value


SCHEMA = """
CREATE TABLE IF NOT EXISTS clubs(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id), title_key TEXT NOT NULL, starts_at TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(club_id,title_key,starts_at));
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','officer','admin')), interests TEXT NOT NULL DEFAULT '[]', goals TEXT NOT NULL DEFAULT '', campus TEXT NOT NULL DEFAULT '', onboarded INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, major TEXT NOT NULL DEFAULT '', google_sub TEXT);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS officers(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, club_id TEXT NOT NULL REFERENCES clubs(id), PRIMARY KEY(user_id,club_id));
CREATE TABLE IF NOT EXISTS follows(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, club_id TEXT NOT NULL REFERENCES clubs(id), PRIMARY KEY(user_id,club_id));
CREATE TABLE IF NOT EXISTS bookmarks(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, club_id TEXT NOT NULL REFERENCES clubs(id), PRIMARY KEY(user_id,club_id));
CREATE TABLE IF NOT EXISTS dismissals(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, club_id TEXT NOT NULL REFERENCES clubs(id), PRIMARY KEY(user_id,club_id));
CREATE TABLE IF NOT EXISTS saves(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, event_id TEXT NOT NULL REFERENCES events(id), PRIMARY KEY(user_id,event_id));
CREATE TABLE IF NOT EXISTS rsvps(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, event_id TEXT NOT NULL REFERENCES events(id), status TEXT NOT NULL CHECK(status IN ('interested','going')), PRIMARY KEY(user_id,event_id));
CREATE TABLE IF NOT EXISTS live_events(id TEXT PRIMARY KEY, starts_at TEXT NOT NULL, payload TEXT NOT NULL, synced_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS live_saves(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, event_id TEXT NOT NULL REFERENCES live_events(id), PRIMARY KEY(user_id,event_id));
CREATE TABLE IF NOT EXISTS sync_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS forum_posts(id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS forum_comments(id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS forum_posts_newest_idx ON forum_posts(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS forum_posts_club_idx ON forum_posts(club_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS forum_posts_author_idx ON forum_posts(author_id);
CREATE INDEX IF NOT EXISTS forum_comments_thread_idx ON forum_comments(post_id,created_at,id);
CREATE INDEX IF NOT EXISTS forum_comments_author_idx ON forum_comments(author_id);
"""


# Standard SQL shared by SQLite and Postgres. Last activity is derived from
# remaining comments, so cascading account deletion cannot leave stale counts.
FORUM_POST_SELECT = """
SELECT p.id,p.club_id,p.title,p.body,p.author_id,p.created_at,
       u.display_name AS author_name,c.payload AS club_payload,
       COALESCE(a.comment_count,0) AS comment_count,
       CASE WHEN a.last_comment_at>p.updated_at THEN a.last_comment_at
            ELSE p.updated_at END AS last_activity_at
FROM forum_posts p
JOIN users u ON u.id=p.author_id
JOIN clubs c ON c.id=p.club_id
LEFT JOIN (SELECT post_id,COUNT(*) AS comment_count,MAX(created_at) AS last_comment_at
           FROM forum_comments GROUP BY post_id) a ON a.post_id=p.id
"""
FORUM_COMMENT_LIMIT = 1000


class Store:
    def __init__(self, database):
        # A plain path keeps the original SQLite behavior.
        self.db = database if hasattr(database, "connect") else SQLite(database)
        self.IntegrityError = self.db.IntegrityError

    def connect(self):
        return self.db.connect()

    def columns(self, conn, table):
        if self.db.kind == "sqlite":
            return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        return {row[0] for row in conn.execute("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=?", (table,))}

    def migrate(self):
        """Add columns introduced after a database was first created (CREATE TABLE won't)."""
        with self.connect() as conn:
            existing = self.columns(conn, "users")
            if "major" not in existing:
                conn.execute("ALTER TABLE users ADD COLUMN major TEXT NOT NULL DEFAULT ''")
            if "google_sub" not in existing:
                conn.execute("ALTER TABLE users ADD COLUMN google_sub TEXT")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_idx ON users(google_sub)")

    def initialize(self, seed_path, demo_mode):
        self.db.create_schema(SCHEMA)
        self.migrate()
        with self.connect() as conn:
            # Idempotent seed import. Officer edits survive server restarts.
            # The real catalog is not in Git (it contains students' contact emails). Without it,
            # start with no imported clubs; a shared Supabase database already holds them.
            seed = json.loads(Path(seed_path).read_text(encoding="utf-8")) if Path(seed_path).exists() else []
            # A bare list is the real club catalog (data/rutgers_clubs.json): clubs only and no
            # sample events. Real clubs are never handed to the demo officer; in demo mode it
            # gets one clearly labeled demo club (data/demo_club.json) to manage instead.
            fixture = isinstance(seed, dict)
            officer_clubs = []
            if not fixture:
                seed = {"clubs": seed, "events": []}
                if demo_mode:
                    officer_clubs = [json.loads((ROOT / "data" / "demo_club.json").read_text(encoding="utf-8"))]
                    seed["clubs"] = seed["clubs"] + officer_clubs
            for club in seed["clubs"]:
                conn.execute("INSERT INTO clubs VALUES (?,?) ON CONFLICT DO NOTHING", (club["id"], json.dumps(club)))
            for event in seed["events"]:
                conn.execute("INSERT INTO events VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING", (event["id"], event["club_id"], event["title"].strip().casefold(), datetime.fromisoformat(event["starts_at"]).astimezone(timezone.utc).isoformat(), json.dumps(event)))
            if demo_mode:
                for email, (password, name, role) in DEMO_ACCOUNTS.items():
                    user_id = "demo-" + role
                    existing = conn.execute("SELECT id FROM users WHERE email=?",(email,)).fetchone()
                    # Never promote a real account that happens to own a fixture
                    # address when switching an existing database into demo mode.
                    if existing and existing["id"] != user_id:
                        continue
                    conn.execute("INSERT INTO users(id,email,password_hash,display_name,role,interests,goals,campus,onboarded,created_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING", (user_id,email,password_hash(password),name,role,json.dumps(["Technology", "Community Service"]),"Meet people and learn something new", "Busch", 1,now_iso()))
                    if role == "officer" and (officer_clubs or (fixture and seed["clubs"])):
                        assigned = officer_clubs or [seed["clubs"][0]]
                        technology = next((c for c in seed["clubs"] if c["category"].lower() == "technology"), None)
                        if fixture and technology:
                            assigned.append(technology)
                        for club in assigned:
                            conn.execute("INSERT INTO officers VALUES (?,?) ON CONFLICT DO NOTHING", (user_id,club["id"]))
            else:
                # A previously used demo database must not preserve known logins.
                conn.execute("DELETE FROM users WHERE id IN ('demo-student','demo-officer')")

    def replace_live_events(self, events, synced_at):
        """Upsert the feed. Rows are never deleted, so saved events keep their details."""
        with self.connect() as conn:
            for event in events:
                conn.execute("INSERT INTO live_events VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET starts_at=excluded.starts_at,payload=excluded.payload,synced_at=excluded.synced_at", (event["id"], datetime.fromisoformat(event["starts_at"]).astimezone(timezone.utc).isoformat(), json.dumps(event), synced_at))
            conn.execute("INSERT INTO sync_state VALUES ('live_events',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps({"synced_at": synced_at, "ids": [e["id"] for e in events], "error": ""}),))

    def record_sync_error(self, message):
        with self.connect() as conn:
            row = conn.execute("SELECT value FROM sync_state WHERE key='live_events'").fetchone()
            state = json.loads(row[0]) if row else {"synced_at": "", "ids": []}
            state["error"] = message
            conn.execute("INSERT INTO sync_state VALUES ('live_events',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(state),))

    def live_state(self):
        with self.connect() as conn:
            row = conn.execute("SELECT value FROM sync_state WHERE key='live_events'").fetchone()
        return json.loads(row[0]) if row else {"synced_at": "", "ids": [], "error": ""}

    def live_records(self, ids=None):
        """Events in the latest feed, or any stored rows by id (for saved items)."""
        wanted = list(self.live_state()["ids"] if ids is None else ids)
        if not wanted:
            return []
        with self.connect() as conn:
            rows = conn.execute(f"SELECT payload FROM live_events WHERE id IN ({','.join('?'*len(wanted))}) ORDER BY starts_at", wanted).fetchall()
        return [json.loads(row[0]) for row in rows]

    def live_record(self, event_id):
        with self.connect() as conn:
            row = conn.execute("SELECT payload FROM live_events WHERE id=?", (event_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Event not found")
        return json.loads(row[0])

    def records(self, table):
        assert table in ("clubs", "events")
        with self.connect() as conn:
            return [json.loads(row[0]) for row in conn.execute(f"SELECT payload FROM {table} ORDER BY id")]

    def record(self, table, item_id):
        assert table in ("clubs", "events")
        with self.connect() as conn:
            row = conn.execute(f"SELECT payload FROM {table} WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Club not found" if table == "clubs" else "Event not found")
        return json.loads(row[0])


def public_user(row):
    return {"id": row["id"], "email": row["email"], "display_name": row["display_name"], "role": row["role"], "major": row["major"], "interests": json.loads(row["interests"]), "goals": row["goals"], "campus": row["campus"], "onboarded": bool(row["onboarded"])}


LIVE_SYNC_SECONDS = 3 * 60 * 60


def create_app(db_path=None, seed_path=None, demo_mode=None, live_sync=None, database_url=None, db_schema="public", google_client_id=None, google_verifier=None):
    demo_mode = os.getenv("DEMO_MODE", "1") == "1" if demo_mode is None else demo_mode
    live_sync = os.getenv("LIVE_EVENTS_SYNC", "1") == "1" if live_sync is None else live_sync
    # An explicit file path (tests) always means SQLite; otherwise DATABASE_URL
    # selects Supabase Postgres, falling back to the local SQLite file.
    database_url = database_url if database_url is not None else (None if db_path else os.getenv("DATABASE_URL"))
    store = Store(open_database(database_url, db_path or os.getenv("DATABASE_PATH", str(ROOT / "backend" / "local.db")), db_schema))
    seed_path = seed_path or ROOT / "data" / "rutgers_clubs.json"
    allowed_origins = set(os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000,http://127.0.0.1:8000").split(","))
    demo_hosts = set(os.getenv("DEMO_ALLOWED_HOSTS", "localhost,127.0.0.1,::1,testserver").split(","))
    reference = os.getenv("DEMO_REFERENCE_DATE", "2026-10-22") if demo_mode else None
    google_client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip() if google_client_id is None else google_client_id
    verify_google = google_verifier or (google_token_verifier(google_client_id) if google_client_id else None)
    email_domains = [d.strip().lower() for d in os.getenv("ALLOWED_EMAIL_DOMAINS", DEFAULT_EMAIL_DOMAINS).split(",") if d.strip()]
    club_index, event_index = HybridIndex(), HybridIndex()
    windows = defaultdict(deque)
    rate_lock = threading.Lock()

    stop_sync = threading.Event()

    def sync_live_events():
        try:
            store.replace_live_events(live_events.select_events(live_events.fetch_upcoming()), now_iso())
        except Exception as exc:  # Network or feed errors keep the last good copy.
            store.record_sync_error(f"{type(exc).__name__}: {exc}"[:300])

    def sync_loop():
        while not stop_sync.is_set():
            synced = store.live_state()["synced_at"]
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(synced)).total_seconds() if synced else None
            if age is None or age >= LIVE_SYNC_SECONDS:
                sync_live_events()
                age = 0
            stop_sync.wait(max(60, LIVE_SYNC_SECONDS - age))

    @asynccontextmanager
    async def lifespan(app):
        store.initialize(seed_path, demo_mode)
        if live_sync:
            threading.Thread(target=sync_loop, name="live-events-sync", daemon=True).start()
        yield
        stop_sync.set()
        store.db.close()

    app = FastAPI(title="BetterGetInvolved API", version="0.1.0", lifespan=lifespan)
    app.state.store, app.state.club_index = store, club_index
    app.state.demo_mode = demo_mode
    app.state.sync_live_events = sync_live_events

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        message = "; ".join(".".join(str(p) for p in err["loc"][1:]) + ": " + err["msg"] for err in exc.errors())
        return JSONResponse(status_code=422, content={"detail": message})

    @app.middleware("http")
    async def security(request: Request, call_next):
        path = request.url.path
        if demo_mode and request.url.hostname not in demo_hosts:
            return JSONResponse(status_code=403, content={"detail": "Demo mode is restricted to local hosts"})
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            if request.headers.get("origin") not in allowed_origins:
                return JSONResponse(status_code=403, content={"detail": "Request origin is not allowed"})
            try:
                if int(request.headers.get("content-length", "0")) > 65536:
                    return JSONResponse(status_code=413, content={"detail": "Request body is too large"})
            except ValueError:
                return JSONResponse(status_code=400, content={"detail": "Invalid content length"})
        client_ip = request.client.host if request.client else "unknown"
        bucket = "auth" if path in ("/api/auth/login", "/api/auth/register", "/api/auth/google") else "faq" if path.endswith("/faq") else "forum_write" if path.startswith("/api/forums") and request.method in ("POST", "PUT", "PATCH", "DELETE") else "general"
        limit = {"auth": 15, "faq": 25, "forum_write": 30, "general": 300}[bucket]
        timestamp = time.monotonic()
        with rate_lock:
            key = (client_ip, bucket)
            queue = windows[key]
            while queue and queue[0] < timestamp - 60:
                queue.popleft()
            if len(queue) >= limit:
                return JSONResponse(status_code=429, content={"detail": "Too many requests. Try again in a minute."}, headers={"Retry-After": "60"})
            queue.append(timestamp)
            # Prune inactive client buckets instead of retaining arbitrary IPs forever.
            if len(windows) > 10000:
                for old_key in list(windows):
                    if not windows[old_key] or windows[old_key][-1] < timestamp - 60:
                        del windows[old_key]
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if path.startswith(("/api/auth", "/api/profile", "/api/saved", "/api/recommendations", "/api/officer", "/api/forums")):
            response.headers["Cache-Control"] = "no-store"
        return response

    def current_user(request: Request):
        token = request.cookies.get(COOKIE)
        if not token:
            raise HTTPException(401, "Sign in to continue")
        digest = hashlib.sha256(token.encode()).hexdigest()
        with store.connect() as conn:
            row = conn.execute("SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?", (digest,time.time())).fetchone()
        if not row:
            raise HTTPException(401, "Your session expired. Please sign in again.")
        return public_user(row)

    def optional_user(request):
        if not request.cookies.get(COOKIE):
            return None
        try:
            return current_user(request)
        except HTTPException:
            return None

    def officer(user=Depends(current_user)):
        if user["role"] not in ("officer", "admin"):
            raise HTTPException(403, "Officer access is required")
        return user

    def officer_scope(user, club_id):
        if user["role"] == "admin":
            return
        with store.connect() as conn:
            assigned = conn.execute("SELECT 1 FROM officers WHERE user_id=? AND club_id=?", (user["id"],club_id)).fetchone()
        if not assigned:
            raise HTTPException(403, "You can only manage your assigned clubs")

    def start_session(response, user_id):
        token = secrets.token_urlsafe(32)
        with store.connect() as conn:
            conn.execute("DELETE FROM sessions WHERE expires_at<=?", (time.time(),))
            conn.execute("INSERT INTO sessions VALUES (?,?,?)", (hashlib.sha256(token.encode()).hexdigest(),user_id,time.time()+SESSION_SECONDS))
        response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True, secure=os.getenv("COOKIE_SECURE", "0" if demo_mode else "1") == "1", samesite="lax", path="/")

    def reference_day():
        return date.fromisoformat(reference) if reference else datetime.now(ZoneInfo("America/New_York")).date()

    @app.get("/api/health")
    def health():
        return {"status": "ok", "data_mode": "synthetic_demo" if demo_mode else "local", "database": store.db.kind, "embedding_model": MODEL_NAME}

    def can_delete_forum(author_id, user):
        return bool(user and (user["id"] == author_id or user["role"] == "admin"))

    def public_forum_post(row, user):
        return {"id":row["id"],"club_id":row["club_id"],"club_name":json.loads(row["club_payload"])["name"],"title":row["title"],"body":row["body"],"author_name":row["author_name"],"created_at":row["created_at"],"updated_at":row["last_activity_at"],"comment_count":row["comment_count"],"can_delete":can_delete_forum(row["author_id"],user)}

    def public_forum_comment(row, user):
        return {"id":row["id"],"post_id":row["post_id"],"body":row["body"],"author_name":row["author_name"],"created_at":row["created_at"],"can_delete":can_delete_forum(row["author_id"],user)}

    def forum_post_row(conn, post_id):
        if "\x00" in post_id:
            raise HTTPException(404,"Forum post not found")
        row = conn.execute(FORUM_POST_SELECT + " WHERE p.id=?",(post_id,)).fetchone()
        if not row:
            raise HTTPException(404,"Forum post not found")
        return row

    @app.get("/api/forums")
    def forum_posts(request: Request, q: str = Query(default="",max_length=500), club_id: str = Query(default="",max_length=100), sort: Literal["newest","active"] = "newest"):
        """Return at most 100 matches; filters apply before the result limit."""
        user = optional_user(request)
        conditions,params = [],[]
        if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]",q):
            raise HTTPException(422,"Search cannot contain control characters")
        if club_id:
            if "\x00" in club_id:
                raise HTTPException(404,"Club not found")
            store.record("clubs",club_id)
            conditions.append("p.club_id=?")
            params.append(club_id)
        if q.strip():
            # '!' escapes SQL LIKE wildcards, so '%' and '_' are literal text.
            # Club names live in JSON payloads; find their IDs in Python to keep
            # this query portable without searching unrelated JSON properties.
            query = q.strip().lower()
            escaped = query.replace("!","!!").replace("%","!%").replace("_","!_")
            matching_clubs = [club["id"] for club in store.records("clubs") if query in club["name"].lower()]
            text_condition = "(LOWER(p.title) LIKE ? ESCAPE '!' OR LOWER(p.body) LIKE ? ESCAPE '!'"
            params.extend([f"%{escaped}%",f"%{escaped}%"])
            if matching_clubs:
                text_condition += " OR p.club_id IN (" + ",".join("?" for _ in matching_clubs) + ")"
                params.extend(matching_clubs)
            conditions.append(text_condition+")")
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        order = "last_activity_at DESC,p.id DESC" if sort == "active" else "p.created_at DESC,p.id DESC"
        with store.connect() as conn:
            rows = conn.execute(FORUM_POST_SELECT+where+" ORDER BY "+order+" LIMIT 100",params).fetchall()
        return [public_forum_post(row,user) for row in rows]

    @app.get("/api/forums/{post_id}")
    def forum_thread(post_id: str,request: Request):
        user = optional_user(request)
        with store.connect() as conn:
            post = public_forum_post(forum_post_row(conn,post_id),user)
            rows = conn.execute("SELECT c.*,u.display_name AS author_name FROM forum_comments c JOIN users u ON u.id=c.author_id WHERE c.post_id=? ORDER BY c.created_at,c.id LIMIT ?",(post_id,FORUM_COMMENT_LIMIT+1)).fetchall()
        if len(rows) > FORUM_COMMENT_LIMIT:
            raise HTTPException(409,"This thread exceeds the 1,000-comment display limit. Please contact an administrator.")
        return {**post,"comments":[public_forum_comment(row,user) for row in rows]}

    @app.post("/api/forums",status_code=201)
    def create_forum_post(body: ForumPostCreate,user=Depends(current_user)):
        post_id,created_at = str(uuid.uuid4()),now_iso()
        try:
            with store.connect() as conn:
                if not conn.execute("SELECT 1 FROM clubs WHERE id=?",(body.club_id,)).fetchone():
                    raise HTTPException(404,"Club not found")
                conn.execute("INSERT INTO forum_posts(id,club_id,author_id,title,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",(post_id,body.club_id,user["id"],body.title,body.body,created_at,created_at))
                post = public_forum_post(forum_post_row(conn,post_id),user)
        except store.IntegrityError:
            raise HTTPException(409,"The club or account changed. Refresh and try again.")
        return post

    @app.post("/api/forums/{post_id}/comments",status_code=201)
    def create_forum_comment(post_id: str,body: ForumCommentCreate,user=Depends(current_user)):
        comment_id,created_at = str(uuid.uuid4()),now_iso()
        try:
            with store.connect() as conn:
                # The same per-thread lock protects comments and deletion in
                # both stores, and makes the finite thread limit atomic.
                conn.lock("forum-post:"+post_id)
                forum_post_row(conn,post_id)
                count = conn.execute("SELECT COUNT(*) FROM forum_comments WHERE post_id=?",(post_id,)).fetchone()[0]
                if count >= FORUM_COMMENT_LIMIT:
                    raise HTTPException(409,"This thread has reached its 1,000-comment limit. Start a new post.")
                conn.execute("INSERT INTO forum_comments(id,post_id,author_id,body,created_at) VALUES (?,?,?,?,?)",(comment_id,post_id,user["id"],body.body,created_at))
                row = conn.execute("SELECT c.*,u.display_name AS author_name FROM forum_comments c JOIN users u ON u.id=c.author_id WHERE c.id=?",(comment_id,)).fetchone()
                comment = public_forum_comment(row,user)
        except store.IntegrityError:
            raise HTTPException(409,"The thread or account changed. Refresh and try again.")
        return comment

    @app.delete("/api/forums/{post_id}")
    def delete_forum_post(post_id: str,user=Depends(current_user)):
        with store.connect() as conn:
            conn.lock("forum-post:"+post_id)
            post = forum_post_row(conn,post_id)
            if not can_delete_forum(post["author_id"],user):
                raise HTTPException(403,"Only the author or an administrator can delete this post")
            conn.execute("DELETE FROM reports WHERE (kind='forum_post' AND target_id=?) OR (kind='forum_comment' AND target_id IN (SELECT id FROM forum_comments WHERE post_id=?))",(post_id,post_id))
            conn.execute("DELETE FROM forum_posts WHERE id=?",(post_id,))
        return {"ok":True}

    @app.delete("/api/forums/{post_id}/comments/{comment_id}")
    def delete_forum_comment(post_id: str,comment_id: str,user=Depends(current_user)):
        if "\x00" in comment_id:
            raise HTTPException(404,"Forum comment not found")
        with store.connect() as conn:
            conn.lock("forum-post:"+post_id)
            forum_post_row(conn,post_id)
            comment = conn.execute("SELECT author_id FROM forum_comments WHERE id=? AND post_id=?",(comment_id,post_id)).fetchone()
            if not comment:
                raise HTTPException(404,"Forum comment not found")
            if not can_delete_forum(comment["author_id"],user):
                raise HTTPException(403,"Only the author or an administrator can delete this comment")
            conn.execute("DELETE FROM reports WHERE kind='forum_comment' AND target_id=?",(comment_id,))
            conn.execute("DELETE FROM forum_comments WHERE id=? AND post_id=?",(comment_id,post_id))
        return {"ok":True}

    @app.get("/api/clubs")
    def clubs(request: Request, q: str = Query(default="", max_length=500), campus: str = "", category: str = "", beginner: bool | None = None):
        user = optional_user(request)
        records = store.records("clubs")
        constraints = parse_constraints(q, reference_day())
        records = [club for club in records if (not (campus or constraints["campus"]) or same_campus(club["campus"], campus or constraints["campus"])) and (not category or club["category"].casefold() == category.casefold()) and (beginner is None or club["beginner_friendly"] == beginner) and (not constraints["beginner"] or club["beginner_friendly"]) and (not constraints["free"] or bool(re.search(r"\b(free|none|no (?:dues|fee)|0(?:\.00)?)\b", club["membership_fee"].lower()))) ]
        topic = constraints["query"]
        if tokens(topic):
            # Fit on the full public catalog; hard filters never alter embeddings.
            scores = club_index.scores(store.records("clubs"), topic)
            records = [club for club in records if scores.get(club["id"], 0) >= 0.045]
            records.sort(key=lambda club: (-scores.get(club["id"],0),club["name"]))
        else:
            records.sort(key=lambda club: (not club["featured"],club["name"]))
        return [public_club(club,user) for club in records]

    @app.get("/api/clubs/{club_id}")
    def club_detail(club_id: str, request: Request):
        return public_club(store.record("clubs", club_id), optional_user(request))

    @app.get("/api/events")
    def events(q: str = Query(default="", max_length=500), campus: str = "", club_id: str = "", from_date: date | None = None, to_date: date | None = None):
        if from_date and to_date and from_date > to_date:
            raise HTTPException(422, "From date must not be after to date")
        all_events = store.records("events")
        constraints = parse_constraints(q, reference_day())
        start, end = from_date or constraints["start"], to_date or constraints["end"]
        def local_start(event):
            return datetime.fromisoformat(event["starts_at"]).astimezone(ZoneInfo("America/New_York"))
        records = [event for event in all_events if (not club_id or event["club_id"] == club_id) and (not (campus or constraints["campus"]) or same_campus(event["campus"],campus or constraints["campus"])) and (not start or local_start(event).date() >= start) and (not end or local_start(event).date() <= end) and (not constraints["after_time"] or local_start(event).time() >= constraints["after_time"]) and (not constraints["before_time"] or local_start(event).time() <= constraints["before_time"]) and (not constraints["beginner"] or event["beginner_friendly"]) and (not constraints["free"] or event["cost"] == 0)]
        topic = constraints["query"]
        if tokens(topic):
            scores = event_index.scores(all_events, topic)
            records = [event for event in records if scores.get(event["id"],0) >= 0.045]
            records.sort(key=lambda event: (-scores.get(event["id"],0),datetime.fromisoformat(event["starts_at"])))
        else:
            records.sort(key=lambda event: datetime.fromisoformat(event["starts_at"]))
        return records

    def is_live(event_id):
        return event_id.startswith("live-")

    def any_event(event_id):
        return store.live_record(event_id) if is_live(event_id) else store.record("events", event_id)

    @app.get("/api/live/status")
    def live_status():
        state = store.live_state()
        return {"synced_at": state["synced_at"] or None, "count": len(state["ids"]), "error": state.get("error") or None, "source": "Rutgers getINVOLVED and Rutgers Recreation, via Scarlet Sync", "source_url": live_events.ATTRIBUTION_URL}

    @app.get("/api/live/events")
    def live_event_list(q: str = Query(default="", max_length=500), campus: str = "", category: str = "", from_date: date | None = None, to_date: date | None = None):
        if from_date and to_date and from_date > to_date:
            raise HTTPException(422, "From date must not be after to date")
        eastern = ZoneInfo("America/New_York")
        today = datetime.now(eastern).date()
        constraints = parse_constraints(q, today)
        start, end = from_date or constraints["start"] or today, to_date or constraints["end"]
        wanted_campus = campus or constraints["campus"]
        topic = tokens(constraints["query"])
        def local_start(event):
            return datetime.fromisoformat(event["starts_at"]).astimezone(eastern)
        def matches(event):
            when = local_start(event)
            return ((not wanted_campus or (event["campus"] and same_campus(event["campus"], wanted_campus)))
                and (not category or event["category"].casefold() == category.casefold())
                and when.date() >= start and (not end or when.date() <= end)
                and (not constraints["after_time"] or when.time() >= constraints["after_time"])
                and (not constraints["before_time"] or when.time() <= constraints["before_time"])
                and (not constraints["free"] or event["cost"] == 0))
        records = [event for event in store.live_records() if matches(event)]
        if topic:
            # The feed has no descriptions, so search the fields it does carry.
            def score(event):
                return len(topic & tokens(" ".join((event["title"], event["club_name"], event["category"], event["location"], event["campus"])))) / len(topic)
            records = [event for event in records if score(event) > 0]
            records.sort(key=lambda event: (-score(event), event["starts_at"]))
        return records

    @app.get("/api/events/{event_id}")
    def event_detail(event_id: str):
        return any_event(event_id)

    @app.post("/api/clubs/{club_id}/faq")
    def faq(club_id: str, body: Question, request: Request):
        # Answers quote the profile verbatim, so they get the same contact redaction.
        return answer_faq(public_club(store.record("clubs",club_id), optional_user(request)), body.question)

    @app.get("/api/auth/me")
    def me(user=Depends(current_user)):
        return user

    @app.get("/api/auth/config")
    def auth_config():
        # The OAuth client ID is public by design; it only names this site to Google.
        return {"google_client_id": google_client_id or None, "allowed_domains": email_domains, "password_login": demo_mode}

    @app.post("/api/auth/google")
    def google_login(body: GoogleCredential, request: Request, response: Response):
        if not verify_google:
            raise HTTPException(503, "Google sign-in is not configured on this server")
        try:
            claims = verify_google(body.credential)
        except Exception:
            raise HTTPException(401, "Google sign-in could not be verified. Please try again.")
        email = str(claims.get("email", "")).strip().lower()
        domain = email.rsplit("@", 1)[-1] if "@" in email else ""
        if claims.get("iss") not in GOOGLE_ISSUERS or not claims.get("sub"):
            raise HTTPException(401, "Google sign-in could not be verified. Please try again.")
        # hd is set by Google only for Workspace accounts, so a personal Gmail can't pass.
        if not claims.get("email_verified") or domain not in email_domains or str(claims.get("hd", "")).lower() != domain:
            raise HTTPException(403, "Sign in with your Rutgers ScarletMail account (@" + email_domains[0] + ").")
        name = re.sub(r"\s+", " ", str(claims.get("given_name") or claims.get("name") or email.split("@")[0])).strip()[:80] or "Rutgers student"
        with store.connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE google_sub=?", (claims["sub"],)).fetchone()
            if not row:
                row = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
                if row and row["google_sub"] and row["google_sub"] != claims["sub"]:
                    raise HTTPException(409, "This email is linked to a different Google account")
                if row:
                    conn.execute("UPDATE users SET google_sub=? WHERE id=?", (claims["sub"], row["id"]))
                else:
                    # No password: these accounts can only sign in through Google.
                    conn.execute("INSERT INTO users(id,email,password_hash,display_name,role,created_at,google_sub) VALUES (?,?,?,?,?,?,?)", (str(uuid.uuid4()), email, "", name, "student", now_iso(), claims["sub"]))
                row = conn.execute("SELECT * FROM users WHERE google_sub=?", (claims["sub"],)).fetchone()
        old_token = request.cookies.get(COOKIE)
        if old_token:
            with store.connect() as conn:
                conn.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(old_token.encode()).hexdigest(),))
        start_session(response, row["id"])
        return public_user(row)

    def password_auth_enabled():
        # Email + password accounts exist only in local demo mode (shared demo logins,
        # tests). Public deployments sign in exclusively with ScarletMail through Google.
        if not demo_mode:
            raise HTTPException(403, "Sign in with your Rutgers ScarletMail Google account")

    @app.post("/api/auth/register")
    def register(body: Registration, response: Response):
        password_auth_enabled()
        if demo_mode and body.email in DEMO_ACCOUNTS:
            raise HTTPException(409,"This email is reserved for a local demo account")
        user_id = str(uuid.uuid4())
        try:
            with store.connect() as conn:
                conn.execute("INSERT INTO users(id,email,password_hash,display_name,role,created_at) VALUES (?,?,?,?,?,?)", (user_id,body.email,password_hash(body.password),body.display_name,"student",now_iso()))
                row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        except store.IntegrityError:
            raise HTTPException(409, "An account with this email already exists")
        start_session(response,user_id)
        return public_user(row)

    @app.post("/api/auth/login")
    def login(body: Credentials, request: Request, response: Response):
        password_auth_enabled()
        with store.connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE email=?", (body.email,)).fetchone()
        valid = check_password(body.password,row["password_hash"] if row else DUMMY_HASH)
        if not row or not valid:
            raise HTTPException(401, "Email or password is incorrect")
        old_token = request.cookies.get(COOKIE)
        if old_token:
            with store.connect() as conn:
                conn.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(old_token.encode()).hexdigest(),))
        start_session(response,row["id"])
        return public_user(row)

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response):
        token = request.cookies.get(COOKIE)
        if token:
            with store.connect() as conn:
                conn.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
        response.delete_cookie(COOKIE,path="/")
        return {"ok": True}

    @app.delete("/api/auth/me")
    def delete_me(response: Response, user=Depends(current_user)):
        with store.connect() as conn:
            conn.execute("DELETE FROM users WHERE id=?", (user["id"],))
        response.delete_cookie(COOKIE,path="/")
        return {"ok": True}

    @app.put("/api/profile")
    def profile(body: Profile, user=Depends(current_user)):
        updates = body.model_dump(exclude_none=True)
        if "interests" in updates:
            updates["interests"] = json.dumps(updates["interests"])
        if "onboarded" in updates:
            # Stored as 0/1: Postgres, unlike SQLite, rejects a boolean in an integer column.
            updates["onboarded"] = int(updates["onboarded"])
        if updates:
            with store.connect() as conn:
                # Column names come exclusively from the validated model.
                conn.execute("UPDATE users SET " + ",".join(f"{key}=?" for key in updates) + " WHERE id=?", (*updates.values(),user["id"]))
        with store.connect() as conn:
            return public_user(conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone())

    @app.get("/api/saved")
    def saved(user=Depends(current_user)):
        with store.connect() as conn:
            live_ids = [r[0] for r in conn.execute("SELECT event_id FROM live_saves WHERE user_id=? ORDER BY event_id",(user["id"],))]
            return {"club_ids": [r[0] for r in conn.execute("SELECT club_id FROM follows WHERE user_id=? ORDER BY club_id",(user["id"],))], "event_ids": [r[0] for r in conn.execute("SELECT event_id FROM saves WHERE user_id=? ORDER BY event_id",(user["id"],))] + live_ids, "live_events": store.live_records(live_ids), "dismissed_ids": [r[0] for r in conn.execute("SELECT club_id FROM dismissals WHERE user_id=? ORDER BY club_id",(user["id"],))], "maybe_later_ids": [r[0] for r in conn.execute("SELECT club_id FROM bookmarks WHERE user_id=? ORDER BY club_id",(user["id"],))], "rsvps": {r[0]:r[1] for r in conn.execute("SELECT event_id,status FROM rsvps WHERE user_id=?",(user["id"],))}}

    def toggle(table, column, item_id, user_id):
        assert (table,column) in (("follows","club_id"),("bookmarks","club_id"),("dismissals","club_id"),("saves","event_id"),("live_saves","event_id"))
        with store.connect() as conn:
            # Serializes a concurrent double-click toggle of the same item.
            conn.lock(f"{table}:{user_id}:{item_id}")
            exists = conn.execute(f"SELECT 1 FROM {table} WHERE user_id=? AND {column}=?",(user_id,item_id)).fetchone()
            if exists:
                conn.execute(f"DELETE FROM {table} WHERE user_id=? AND {column}=?",(user_id,item_id))
            else:
                conn.execute(f"INSERT INTO {table} VALUES (?,?)",(user_id,item_id))
        return not bool(exists)

    @app.post("/api/clubs/{club_id}/follow")
    def follow(club_id: str, user=Depends(current_user)):
        store.record("clubs",club_id)
        return {"following": toggle("follows","club_id",club_id,user["id"])}

    @app.post("/api/clubs/{club_id}/dismiss")
    def dismiss(club_id: str, user=Depends(current_user)):
        store.record("clubs",club_id)
        return {"dismissed": toggle("dismissals","club_id",club_id,user["id"])}

    @app.post("/api/clubs/{club_id}/bookmark")
    def bookmark(club_id: str, user=Depends(current_user)):
        store.record("clubs",club_id)
        return {"bookmarked": toggle("bookmarks","club_id",club_id,user["id"])}

    @app.post("/api/events/{event_id}/save")
    def save(event_id: str, user=Depends(current_user)):
        any_event(event_id)
        return {"saved": toggle("live_saves" if is_live(event_id) else "saves","event_id",event_id,user["id"])}

    @app.post("/api/events/{event_id}/rsvp")
    def rsvp(event_id: str, body: RSVP, user=Depends(current_user)):
        if is_live(event_id):
            raise HTTPException(409,"RSVP for this event on getINVOLVED")
        event = store.record("events",event_id)
        if event["status"] == "cancelled" and body.status != "none":
            raise HTTPException(409,"This event is cancelled")
        with store.connect() as conn:
            if body.status == "none":
                conn.execute("DELETE FROM rsvps WHERE user_id=? AND event_id=?",(user["id"],event_id))
            else:
                conn.execute("INSERT INTO rsvps VALUES (?,?,?) ON CONFLICT(user_id,event_id) DO UPDATE SET status=excluded.status",(user["id"],event_id,body.status))
        return {"status": body.status}

    @app.get("/api/recommendations")
    def recommendations(request: Request, limit: int = Query(default=8,ge=1,le=24)):
        user = optional_user(request)
        records = store.records("clubs")
        dismissed, followed = set(), set()
        query = ""
        if user:
            query = " ".join(user["interests"]) + " " + user["goals"] + " " + user["major"]
            with store.connect() as conn:
                dismissed = {r[0] for r in conn.execute("SELECT club_id FROM dismissals WHERE user_id=?",(user["id"],))}
                followed = {r[0] for r in conn.execute("SELECT club_id FROM follows WHERE user_id=?",(user["id"],))}
            # Following affects the private vector only, never public popularity.
            query += " " + " ".join(" ".join(c["interests"]) for c in records if c["id"] in followed)
        has_profile = bool(tokens(query))
        scores = club_index.scores(records,query) if has_profile else {c["id"]: 0.05 for c in records}
        candidates = [c for c in records if c["id"] not in dismissed]
        selected, categories = [], defaultdict(int)
        while candidates and len(selected) < limit:
            def utility(club):
                campus_bonus = 0.08 if user and user["campus"] and same_campus(club["campus"],user["campus"]) else 0
                # Soft category penalty prevents a single category dominating.
                return scores.get(club["id"],0) + campus_bonus + (0.02 if club["beginner_friendly"] else 0) - 0.075*categories[club["category"]]
            best = max(candidates,key=lambda c:(utility(c),c["name"]))
            overlap = [interest for interest in (user["interests"] if user else []) if tokens(interest) & tokens(" ".join(best["interests"]) + " " + best["category"])]
            reasons = []
            major_match = bool(user and user["major"] and tokens(user["major"]) & tokens(" ".join(best["interests"]) + " " + best["category"] + " " + best["name"] + " " + best["description"]))
            if overlap:
                reasons.append("Matches your interests in " + ", ".join(overlap[:2]))
            elif major_match:
                reasons.append("Connects to your major, " + user["major"])
            elif has_profile and scores.get(best["id"],0) >= 0.045:
                reasons.append("Related to your interests and goals in the local text model")
            elif has_profile:
                reasons.append("An exploratory option to broaden your suggestions")
            else:
                reasons.append("A starting point from the club directory")
            if user and user["campus"] and same_campus(best["campus"],user["campus"]):
                reasons.append("meets on your selected campus")
            if best["beginner_friendly"]:
                reasons.append("welcomes beginners")
            selected.append({**public_club(best,user),"score":round(scores.get(best["id"],0),4),"explanation":"; ".join(reasons) + ". Category variety also influences the order."})
            categories[best["category"]] += 1
            candidates.remove(best)
        return {"clubs":selected,"method":"Local TF-IDF + LSA similarity, explicit interests and goals, campus preference, and category diversity. Scores are similarities, not probabilities." if has_profile else "Cold start: a varied mix of clubs. Add interests to personalize."}

    @app.post("/api/reports")
    def reports(body: Report,user=Depends(current_user)):
        with store.connect() as conn:
            if body.kind == "forum_post":
                forum_post_row(conn,body.target_id)
            elif body.kind == "forum_comment":
                if "\x00" in body.target_id or not conn.execute("SELECT 1 FROM forum_comments WHERE id=?",(body.target_id,)).fetchone():
                    raise HTTPException(404,"Forum comment not found")
            else:
                any_event(body.target_id) if body.kind == "event" else store.record("clubs",body.target_id)
            conn.execute("INSERT INTO reports VALUES (?,?,?,?,?,?)",(str(uuid.uuid4()),user["id"],body.kind,body.target_id,body.reason,now_iso()))
        return {"ok":True}

    @app.get("/api/officer/clubs")
    def officer_clubs(user=Depends(officer)):
        if user["role"] == "admin":
            return store.records("clubs")
        with store.connect() as conn:
            ids = {r[0] for r in conn.execute("SELECT club_id FROM officers WHERE user_id=?",(user["id"],))}
        return [club for club in store.records("clubs") if club["id"] in ids]

    def persist_event(event, creating=False):
        start = datetime.fromisoformat(event["starts_at"]).astimezone(timezone.utc).isoformat()
        try:
            with store.connect() as conn:
                if creating:
                    conn.execute("INSERT INTO events VALUES (?,?,?,?,?)",(event["id"],event["club_id"],event["title"].strip().casefold(),start,json.dumps(event)))
                else:
                    conn.execute("UPDATE events SET club_id=?,title_key=?,starts_at=?,payload=? WHERE id=?",(event["club_id"],event["title"].strip().casefold(),start,json.dumps(event),event["id"]))
        except store.IntegrityError:
            raise HTTPException(409,"An event with the same club, title and start time already exists")
        return event

    @app.post("/api/officer/events")
    def create_event(body: EventCreate,user=Depends(officer)):
        club = store.record("clubs",body.club_id)
        officer_scope(user,body.club_id)
        event_id = str(uuid.uuid4())
        event = {**body.model_dump(mode="json"),"id":event_id,"club_name":club["name"],"source_url":f"/events/{event_id}","updated_at":now_iso(),"status":"scheduled","is_demo":bool(demo_mode)}
        return persist_event(event,creating=True)

    @app.patch("/api/officer/events/{event_id}")
    def update_event(event_id: str,body: EventPatch,user=Depends(officer)):
        event = store.record("events",event_id)
        officer_scope(user,event["club_id"])
        updates = body.model_dump(mode="json",exclude_none=True)
        if "club_id" in updates:
            officer_scope(user,updates["club_id"])
        merged = {**event,**updates}
        try:
            validated = EventCreate.model_validate({key:merged[key] for key in EventCreate.model_fields}).model_dump(mode="json")
        except ValueError as exc:
            raise HTTPException(422,str(exc))
        merged.update(validated)
        merged["club_name"] = store.record("clubs",merged["club_id"])["name"]
        merged["updated_at"] = now_iso()
        return persist_event(merged)

    @app.put("/api/officer/clubs/{club_id}")
    def update_club(club_id: str,body: ClubPatch,user=Depends(officer)):
        club = store.record("clubs",club_id)
        officer_scope(user,club_id)
        updates = body.model_dump(mode="json",exclude_none=True)
        club.update(updates)
        # Keep generic factual FAQs consistent with edited structured fields.
        # The resulting passages are stored publicly and then retrieved verbatim.
        # Specialized equipment/safety/other FAQs are preserved.
        suffix = " This is demonstration data; no real meeting or membership is advertised." if club["verification"] == "demo" else ""
        groups = []
        if {"meeting_schedule","location","campus"} & updates.keys():
            groups.append((lambda question: bool(re.search(r"\b(meet|meeting|meetings|schedule)\b",question,re.I)), "When and where do you meet?", f"Meeting schedule: {club['meeting_schedule']}. Location: {club['location']}, {club['campus']}." + suffix))
        if "membership_fee" in updates:
            groups.append((lambda question: bool(re.search(r"\b(cost|fee|fees|dues)\b",question,re.I) and re.search(r"\b(membership|member|join|dues)\b",question,re.I)), "How much does membership cost?", f"Membership fee: {club['membership_fee']}." + suffix))
        if {"eligibility","beginner_friendly"} & updates.keys():
            groups.append((lambda question: bool(re.search(r"\b(eligibility|eligible|who|beginners|beginner|experience)\b",question,re.I)), "Who can join, and is the club beginner friendly?", f"Eligibility: {club['eligibility']}. Beginner-friendly: {'Yes' if club['beginner_friendly'] else 'No'}." + suffix))
        for matches,question,answer in groups:
            found = False
            for faq in club["faqs"]:
                if matches(faq["question"]):
                    faq["answer"] = answer
                    found = True
            if not found:
                club["faqs"].append({"question":question,"answer":answer})
        club["updated_at"] = now_iso()
        with store.connect() as conn:
            conn.execute("UPDATE clubs SET payload=? WHERE id=?",(json.dumps(club),club_id))
            # Keep event labels consistent after an authorized club rename.
            for row in conn.execute("SELECT id,payload FROM events WHERE club_id=?",(club_id,)).fetchall():
                event = json.loads(row["payload"])
                event["club_name"] = club["name"]
                conn.execute("UPDATE events SET payload=? WHERE id=?",(json.dumps(event),row["id"]))
        return club

    @app.get("/api/officer/analytics")
    def analytics(user=Depends(officer)):
        clubs = officer_clubs(user)
        counts = []
        with store.connect() as conn:
            for club in clubs:
                club_id = club["id"]
                follows = conn.execute("SELECT COUNT(*) FROM follows WHERE club_id=?",(club_id,)).fetchone()[0]
                saves = conn.execute("SELECT COUNT(*) FROM saves s JOIN events e ON s.event_id=e.id WHERE e.club_id=?",(club_id,)).fetchone()[0]
                rsvps = conn.execute("SELECT COUNT(*) FROM rsvps r JOIN events e ON r.event_id=e.id WHERE e.club_id=?",(club_id,)).fetchone()[0]
                events = conn.execute("SELECT COUNT(*) FROM events WHERE club_id=?",(club_id,)).fetchone()[0]
                counts.append({"club_id":club_id,"name":club["name"],"follows":follows,"saved_events":saves,"rsvps":rsvps,"events":events})
        return {"clubs":counts,"note":"Aggregate actions in this local database only. RSVPs are stated intent, not verified attendance. Demo activity is synthetic; no student identities are exposed."}

    @app.get("/api/events/{event_id}/calendar")
    def calendar(event_id: str):
        event = any_event(event_id)
        def escape(value):
            return str(value).replace("\\","\\\\").replace("\r","").replace("\n","\\n").replace(";","\\;").replace(",","\\,")
        def stamp(value):
            return datetime.fromisoformat(value).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//BetterGetInvolved//Demo Events//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH","BEGIN:VEVENT",f"UID:{escape(event['id'])}@bettergetinvolved.local",f"DTSTAMP:{stamp(event['updated_at'])}",f"DTSTART:{stamp(event['starts_at'])}",*([f"DTEND:{stamp(event['ends_at'])}"] if event.get('ends_at') else []),f"SUMMARY:{escape(event['title'])}",f"DESCRIPTION:{escape(('DEMO EVENT — ' if event['is_demo'] else '') + (event['description'] or ('Hosted by ' + event['club_name'] + '. Details: ' + event['source_url'])))}",f"LOCATION:{escape(', '.join(part for part in (event['location'], event['campus']) if part))}",f"STATUS:{'CANCELLED' if event['status']=='cancelled' else 'CONFIRMED'}","END:VEVENT","END:VCALENDAR"]
        folded = []
        for line in lines:
            chunk = ""
            for char in line:
                if len((chunk+char).encode()) > 73:
                    folded.append(chunk)
                    chunk = " "
                chunk += char
            folded.append(chunk)
        return Response("\r\n".join(folded)+"\r\n",media_type="text/calendar",headers={"Content-Disposition":f'attachment; filename="event-{event_id}.ics"'})

    return app


app = create_app()
