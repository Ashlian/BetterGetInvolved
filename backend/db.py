"""One storage interface over SQLite (local and tests) and Postgres (Supabase).

The app writes SQL once, with `?` placeholders and syntax both engines accept
(`ON CONFLICT ... DO NOTHING/UPDATE`). This module covers the rest: placeholder
style, row access by name or index, connection pooling, row locks, and the
Postgres schema hardening Supabase needs.
"""

from __future__ import annotations

import hashlib
import re
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path


class Row(tuple):
    """A result row readable as row[0] or row["column"], like sqlite3.Row."""

    def __new__(cls, values, columns):
        row = super().__new__(cls, values)
        row._index = columns
        return row

    def __getitem__(self, key):
        return super().__getitem__(self._index[key] if isinstance(key, str) else key)

    def keys(self):
        return list(self._index)


class SQLite:
    kind = "sqlite"
    IntegrityError = sqlite3.IntegrityError

    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield SQLiteConnection(conn)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def create_schema(self, schema):
        with self.connect() as conn:
            conn.raw.executescript("PRAGMA journal_mode=WAL;\n" + schema)

    def close(self):
        pass


class SQLiteConnection:
    def __init__(self, raw):
        self.raw = raw

    def execute(self, sql, params=()):
        return self.raw.execute(sql, params)

    def lock(self, key):
        # BEGIN IMMEDIATE takes SQLite's single write lock, serializing toggles.
        self.raw.execute("BEGIN IMMEDIATE")


class Postgres:
    """Supabase Postgres through a small psycopg connection pool."""

    kind = "postgres"

    def __init__(self, url, schema="public", min_size=1, max_size=8):
        import psycopg
        from psycopg_pool import ConnectionPool

        if not re.fullmatch(r"[a-z_][a-z0-9_]*", schema):
            raise ValueError("Schema names must be lowercase identifiers")
        self.IntegrityError = psycopg.errors.IntegrityError
        self.schema = schema

        def configure(conn):
            conn.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")
            conn.execute(f"SET search_path TO {schema}")
            conn.commit()

        # prepare_threshold=None keeps Supabase's transaction pooler (port 6543) working.
        # The pool opens on first use, so importing the app never touches the network.
        self.pool = ConnectionPool(url, min_size=min_size, max_size=max_size, configure=configure, kwargs={"prepare_threshold": None, "connect_timeout": 10}, open=False)
        self._opened, self._open_lock = False, threading.Lock()

    @contextmanager
    def connect(self):
        if not self._opened:
            with self._open_lock:
                if not self._opened:
                    self.pool.open(wait=True, timeout=30)
                    self._opened = True
        with self.pool.connection() as raw:
            # The pool commits on clean exit and rolls back on an exception.
            yield PostgresConnection(raw)

    def create_schema(self, schema):
        statements = [s.strip() for s in schema.split(";") if s.strip()]
        tables = [re.search(r"CREATE TABLE IF NOT EXISTS (\w+)", s).group(1) for s in statements if s.startswith("CREATE TABLE")]
        with self.connect() as conn:
            # One migration at a time when several workers start together.
            conn.execute("SELECT pg_advisory_xact_lock(?)", (_lock_id("schema"),))
            for statement in statements:
                # SQLite REAL is 8 bytes; Postgres REAL is 4 and would round epoch times.
                conn.execute(re.sub(r"\bREAL\b", "DOUBLE PRECISION", statement))
            for table in tables:
                # Supabase publishes tables through its Data API. Only this
                # backend (the postgres role, which bypasses RLS) may read them.
                conn.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
                conn.execute(f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON {table} FROM anon, authenticated'; END IF; END $$")

    def close(self):
        if self._opened:
            self.pool.close()


class PostgresConnection:
    def __init__(self, raw):
        self.raw = raw

    def execute(self, sql, params=()):
        cursor = self.raw.cursor(row_factory=_row_factory)
        return cursor.execute(_placeholders(sql), params or None)

    def lock(self, key):
        # A transaction-scoped advisory lock serializes double-click toggles
        # for the same user and item, like SQLite's BEGIN IMMEDIATE.
        self.execute("SELECT pg_advisory_xact_lock(?)", (_lock_id(key),))


def _row_factory(cursor):
    columns = {column.name: i for i, column in enumerate(cursor.description or [])}
    return lambda values: Row(values, columns)


def _placeholders(sql):
    # The app's SQL never contains a literal "?" or "%", so a plain swap is safe.
    return sql.replace("%", "%%").replace("?", "%s")


def _lock_id(key):
    return int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big", signed=True)


def open_database(url=None, path=None, schema="public"):
    """DATABASE_URL (postgres://...) selects Postgres; otherwise a SQLite file."""
    if url and url.startswith(("postgres://", "postgresql://")):
        return Postgres(url, schema=schema)
    return SQLite(path)
