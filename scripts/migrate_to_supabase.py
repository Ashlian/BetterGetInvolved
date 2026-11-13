"""Copy the local SQLite database into Supabase Postgres.

Usage (from the project folder, with DATABASE_URL in .env or the environment):
    .venv\\Scripts\\python scripts\\migrate_to_supabase.py            # Windows
    .venv/bin/python scripts/migrate_to_supabase.py                  # macOS, Linux

It creates the tables if needed, then inserts every row, skipping rows that
already exist, so running it twice is safe. Nothing in SQLite is changed.
"""

import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from backend.app import SCHEMA  # noqa: E402
from backend.db import Postgres  # noqa: E402
from dev import read_env_file  # noqa: E402

# Parents before children, so foreign keys always resolve.
TABLES = ["clubs", "events", "users", "sessions", "officers", "follows", "bookmarks", "dismissals", "saves", "rsvps", "live_events", "live_saves", "sync_state", "reports", "forum_posts", "forum_comments"]


def main():
    env = {**read_env_file(ROOT / ".env"), **os.environ}
    url = env.get("DATABASE_URL", "")
    source = Path(env.get("DATABASE_PATH") or ROOT / "backend" / "local.db")
    if not url.startswith(("postgres://", "postgresql://")):
        sys.exit("Set DATABASE_URL in .env to your Supabase connection string first.")
    if not source.exists():
        sys.exit(f"No local database at {source}; nothing to copy. Start the app and it will seed Supabase directly.")
    target = Postgres(url)
    target.create_schema(SCHEMA)
    local = sqlite3.connect(source)
    try:
        with target.connect() as conn:
            for table in TABLES:
                exists = local.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
                if not exists:
                    continue
                cursor = local.execute(f"SELECT * FROM {table}")
                columns = [c[0] for c in cursor.description]
                rows = cursor.fetchall()
                for row in rows:
                    conn.execute(f"INSERT INTO {table}({','.join(columns)}) VALUES ({','.join('?' * len(columns))}) ON CONFLICT DO NOTHING", row)
                print(f"{table:12} {len(rows):5} rows")
    finally:
        local.close()
        target.close()
    print("Done. Start the app with scripts/dev.py; it now uses Supabase.")


if __name__ == "__main__":
    main()
