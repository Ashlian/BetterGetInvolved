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
import sqlite3
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

from .search import HybridIndex, MODEL_NAME, answer_faq, parse_constraints, same_campus, tokens


ROOT = Path(__file__).resolve().parents[1]
COOKIE = "bgi_session"
SESSION_SECONDS = 7 * 24 * 60 * 60
DEMO_ACCOUNTS = {
    "student@demo.local": ("StudentDemo2026!", "Alex Demo", "student"),
    "officer@demo.local": ("OfficerDemo2026!", "Jordan Demo", "officer"),
}


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


class Question(Input):
    question: str = Field(min_length=3, max_length=500)


class RSVP(Input):
    status: Literal["interested", "going", "none"]


class Report(Input):
    kind: Literal["club", "event", "answer"]
    target_id: str = Field(min_length=1, max_length=100)
    reason: str = Field(min_length=5, max_length=2000)


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
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS clubs(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id), title_key TEXT NOT NULL, starts_at TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(club_id,title_key,starts_at));
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','officer','admin')), interests TEXT NOT NULL DEFAULT '[]', goals TEXT NOT NULL DEFAULT '', campus TEXT NOT NULL DEFAULT '', onboarded INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS officers(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, club_id TEXT NOT NULL REFERENCES clubs(id), PRIMARY KEY(user_id,club_id));
CREATE TABLE IF NOT EXISTS follows(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, club_id TEXT NOT NULL REFERENCES clubs(id), PRIMARY KEY(user_id,club_id));
CREATE TABLE IF NOT EXISTS bookmarks(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, club_id TEXT NOT NULL REFERENCES clubs(id), PRIMARY KEY(user_id,club_id));
CREATE TABLE IF NOT EXISTS dismissals(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, club_id TEXT NOT NULL REFERENCES clubs(id), PRIMARY KEY(user_id,club_id));
CREATE TABLE IF NOT EXISTS saves(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, event_id TEXT NOT NULL REFERENCES events(id), PRIMARY KEY(user_id,event_id));
CREATE TABLE IF NOT EXISTS rsvps(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, event_id TEXT NOT NULL REFERENCES events(id), status TEXT NOT NULL CHECK(status IN ('interested','going')), PRIMARY KEY(user_id,event_id));
CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
"""


class Store:
    def __init__(self, path):
        self.path = str(path)

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def initialize(self, seed_path, demo_mode):
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.executescript(SCHEMA)
            # Idempotent seed import. Officer edits survive server restarts.
            seed = json.loads(Path(seed_path).read_text())
            for club in seed["clubs"]:
                conn.execute("INSERT OR IGNORE INTO clubs VALUES (?,?)", (club["id"], json.dumps(club)))
            for event in seed["events"]:
                conn.execute("INSERT OR IGNORE INTO events VALUES (?,?,?,?,?)", (event["id"], event["club_id"], event["title"].strip().casefold(), datetime.fromisoformat(event["starts_at"]).astimezone(timezone.utc).isoformat(), json.dumps(event)))
            if demo_mode:
                for email, (password, name, role) in DEMO_ACCOUNTS.items():
                    user_id = "demo-" + role
                    existing = conn.execute("SELECT id FROM users WHERE email=?",(email,)).fetchone()
                    # Never promote a real account that happens to own a fixture
                    # address when switching an existing database into demo mode.
                    if existing and existing["id"] != user_id:
                        continue
                    conn.execute("INSERT OR IGNORE INTO users(id,email,password_hash,display_name,role,interests,goals,campus,onboarded,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", (user_id,email,password_hash(password),name,role,json.dumps(["Technology", "Community Service"]),"Meet people and learn something new", "Busch", 1,now_iso()))
                    if role == "officer" and seed["clubs"]:
                        assigned = [seed["clubs"][0]]
                        technology = next((c for c in seed["clubs"] if c["category"].lower() == "technology"), None)
                        if technology:
                            assigned.append(technology)
                        for club in assigned:
                            conn.execute("INSERT OR IGNORE INTO officers VALUES (?,?)", (user_id,club["id"]))
            else:
                # A previously used demo database must not preserve known logins.
                conn.execute("DELETE FROM users WHERE id IN ('demo-student','demo-officer')")

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
    return {"id": row["id"], "email": row["email"], "display_name": row["display_name"], "role": row["role"], "interests": json.loads(row["interests"]), "goals": row["goals"], "campus": row["campus"], "onboarded": bool(row["onboarded"])}


def create_app(db_path=None, seed_path=None, demo_mode=None):
    demo_mode = os.getenv("DEMO_MODE", "1") == "1" if demo_mode is None else demo_mode
    store = Store(db_path or os.getenv("DATABASE_PATH", str(ROOT / "backend" / "local.db")))
    seed_path = seed_path or ROOT / "data" / "seed.json"
    allowed_origins = set(os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000,http://127.0.0.1:8000").split(","))
    demo_hosts = set(os.getenv("DEMO_ALLOWED_HOSTS", "localhost,127.0.0.1,::1,testserver").split(","))
    reference = os.getenv("DEMO_REFERENCE_DATE", "2026-10-22") if demo_mode else None
    club_index, event_index = HybridIndex(), HybridIndex()
    windows = defaultdict(deque)
    rate_lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(app):
        store.initialize(seed_path, demo_mode)
        yield

    app = FastAPI(title="BetterGetInvolved API", version="0.1.0", lifespan=lifespan)
    app.state.store, app.state.club_index = store, club_index
    app.state.demo_mode = demo_mode

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
        bucket = "auth" if path in ("/api/auth/login", "/api/auth/register") else "faq" if path.endswith("/faq") else "general"
        limit = {"auth": 15, "faq": 25, "general": 300}[bucket]
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
        if path.startswith(("/api/auth", "/api/profile", "/api/saved", "/api/recommendations", "/api/officer")):
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
        return {"status": "ok", "data_mode": "synthetic_demo" if demo_mode else "local", "embedding_model": MODEL_NAME}

    @app.get("/api/clubs")
    def clubs(q: str = Query(default="", max_length=500), campus: str = "", category: str = "", beginner: bool | None = None):
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
        return records

    @app.get("/api/clubs/{club_id}")
    def club_detail(club_id: str):
        return store.record("clubs", club_id)

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

    @app.get("/api/events/{event_id}")
    def event_detail(event_id: str):
        return store.record("events", event_id)

    @app.post("/api/clubs/{club_id}/faq")
    def faq(club_id: str, body: Question):
        return answer_faq(store.record("clubs",club_id), body.question)

    @app.get("/api/auth/me")
    def me(user=Depends(current_user)):
        return user

    @app.post("/api/auth/register")
    def register(body: Registration, response: Response):
        if demo_mode and body.email in DEMO_ACCOUNTS:
            raise HTTPException(409,"This email is reserved for a local demo account")
        user_id = str(uuid.uuid4())
        try:
            with store.connect() as conn:
                conn.execute("INSERT INTO users(id,email,password_hash,display_name,role,created_at) VALUES (?,?,?,?,?,?)", (user_id,body.email,password_hash(body.password),body.display_name,"student",now_iso()))
                row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        except sqlite3.IntegrityError:
            raise HTTPException(409, "An account with this email already exists")
        start_session(response,user_id)
        return public_user(row)

    @app.post("/api/auth/login")
    def login(body: Credentials, request: Request, response: Response):
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
        if updates:
            with store.connect() as conn:
                # Column names come exclusively from the validated model.
                conn.execute("UPDATE users SET " + ",".join(f"{key}=?" for key in updates) + " WHERE id=?", (*updates.values(),user["id"]))
        with store.connect() as conn:
            return public_user(conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone())

    @app.get("/api/saved")
    def saved(user=Depends(current_user)):
        with store.connect() as conn:
            return {"club_ids": [r[0] for r in conn.execute("SELECT club_id FROM follows WHERE user_id=? ORDER BY club_id",(user["id"],))], "event_ids": [r[0] for r in conn.execute("SELECT event_id FROM saves WHERE user_id=? ORDER BY event_id",(user["id"],))], "dismissed_ids": [r[0] for r in conn.execute("SELECT club_id FROM dismissals WHERE user_id=? ORDER BY club_id",(user["id"],))], "maybe_later_ids": [r[0] for r in conn.execute("SELECT club_id FROM bookmarks WHERE user_id=? ORDER BY club_id",(user["id"],))], "rsvps": {r[0]:r[1] for r in conn.execute("SELECT event_id,status FROM rsvps WHERE user_id=?",(user["id"],))}}

    def toggle(table, column, item_id, user_id):
        assert (table,column) in (("follows","club_id"),("bookmarks","club_id"),("dismissals","club_id"),("saves","event_id"))
        with store.connect() as conn:
            # BEGIN IMMEDIATE serializes a concurrent double-click toggle.
            conn.execute("BEGIN IMMEDIATE")
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
        store.record("events",event_id)
        return {"saved": toggle("saves","event_id",event_id,user["id"])}

    @app.post("/api/events/{event_id}/rsvp")
    def rsvp(event_id: str, body: RSVP, user=Depends(current_user)):
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
            query = " ".join(user["interests"]) + " " + user["goals"]
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
            if overlap:
                reasons.append("Matches your interests in " + ", ".join(overlap[:2]))
            elif has_profile and scores.get(best["id"],0) >= 0.045:
                reasons.append("Related to your interests and goals in the local text model")
            elif has_profile:
                reasons.append("An exploratory option to broaden your suggestions")
            else:
                reasons.append("A starting point from the demo catalog")
            if user and user["campus"] and same_campus(best["campus"],user["campus"]):
                reasons.append("meets on your selected campus")
            if best["beginner_friendly"]:
                reasons.append("welcomes beginners")
            selected.append({**best,"score":round(scores.get(best["id"],0),4),"explanation":"; ".join(reasons) + ". Category variety also influences the order."})
            categories[best["category"]] += 1
            candidates.remove(best)
        return {"clubs":selected,"method":"Local TF-IDF + LSA similarity, explicit interests and goals, campus preference, and category diversity. Scores are similarities, not probabilities." if has_profile else "Cold start: varied beginner-friendly demo clubs. Add interests to personalize."}

    @app.post("/api/reports")
    def reports(body: Report,user=Depends(current_user)):
        store.record("events" if body.kind == "event" else "clubs",body.target_id)
        with store.connect() as conn:
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
        except sqlite3.IntegrityError:
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
        event = store.record("events",event_id)
        def escape(value):
            return str(value).replace("\\","\\\\").replace("\r","").replace("\n","\\n").replace(";","\\;").replace(",","\\,")
        def stamp(value):
            return datetime.fromisoformat(value).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//BetterGetInvolved//Demo Events//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH","BEGIN:VEVENT",f"UID:{escape(event['id'])}@bettergetinvolved.local",f"DTSTAMP:{stamp(event['updated_at'])}",f"DTSTART:{stamp(event['starts_at'])}",f"DTEND:{stamp(event['ends_at'])}",f"SUMMARY:{escape(event['title'])}",f"DESCRIPTION:{escape(('DEMO EVENT — ' if event['is_demo'] else '') + event['description'])}",f"LOCATION:{escape(event['location'] + ', ' + event['campus'])}",f"STATUS:{'CANCELLED' if event['status']=='cancelled' else 'CONFIRMED'}","END:VEVENT","END:VCALENDAR"]
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
