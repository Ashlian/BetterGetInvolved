"""Delete the synthetic demo clubs (verification "demo") and their sample events.

Usage (from the project folder):
    .venv\\Scripts\\python scripts\\remove_demo_clubs.py             # Windows
    .venv/bin/python scripts/remove_demo_clubs.py                   # macOS, Linux

Uses DATABASE_URL from .env (Supabase) or, without it, the local SQLite file.
Follows, bookmarks, dismissals, officer assignments, saves, RSVPs and reports that
point at those clubs or events go too, in one transaction. Real clubs are untouched.
With DEMO_MODE=1 the backend re-creates the demo officer's one club (data/demo_club.json)
on its next start.
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from backend.db import open_database  # noqa: E402
from dev import read_env_file  # noqa: E402


def placeholders(items):
    return ",".join("?" * len(items))


def main():
    env = {**read_env_file(ROOT / ".env"), **os.environ}
    db = open_database(env.get("DATABASE_URL", ""), env.get("DATABASE_PATH") or ROOT / "backend" / "local.db")
    try:
        with db.connect() as conn:
            clubs = [row[0] for row in conn.execute("SELECT id, payload FROM clubs").fetchall() if json.loads(row[1]).get("verification") == "demo"]
            if not clubs:
                print(f"{db.kind}: no demo clubs left.")
                return
            events = [row[0] for row in conn.execute(f"SELECT id FROM events WHERE club_id IN ({placeholders(clubs)})", clubs).fetchall()]
            counts = {}
            if events:
                for table in ("saves", "rsvps"):
                    counts[table] = conn.execute(f"DELETE FROM {table} WHERE event_id IN ({placeholders(events)})", events).rowcount
            targets = clubs + events
            counts["reports"] = conn.execute(f"DELETE FROM reports WHERE target_id IN ({placeholders(targets)})", targets).rowcount
            for table in ("officers", "follows", "bookmarks", "dismissals"):
                counts[table] = conn.execute(f"DELETE FROM {table} WHERE club_id IN ({placeholders(clubs)})", clubs).rowcount
            counts["events"] = conn.execute(f"DELETE FROM events WHERE club_id IN ({placeholders(clubs)})", clubs).rowcount
            counts["clubs"] = conn.execute(f"DELETE FROM clubs WHERE id IN ({placeholders(clubs)})", clubs).rowcount
            left = conn.execute("SELECT count(*) FROM clubs").fetchone()[0]
    finally:
        db.close()
    print(f"{db.kind}: deleted " + ", ".join(f"{n} {t}" for t, n in counts.items()) + f". {left} clubs remain.")


if __name__ == "__main__":
    main()
