"""Load data/rutgers_clubs.json (real Rutgers–New Brunswick clubs) into the app database.

Usage (from the project folder):
    .venv\\Scripts\\python scripts\\import_rutgers_clubs.py             # Windows
    .venv/bin/python scripts/import_rutgers_clubs.py                   # macOS, Linux
    ... import_rutgers_clubs.py --replace    # overwrite clubs already imported

Uses DATABASE_URL from .env (Supabase) or, without it, the local SQLite file.
Without --replace, clubs that already exist are left alone, so officer edits survive.
The JSON is built by scripts/build_rutgers_clubs.py from the public profiles on The Arc (Suitable).
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from backend.app import SCHEMA  # noqa: E402
from backend.db import open_database  # noqa: E402
from dev import read_env_file  # noqa: E402


def main():
    replace = "--replace" in sys.argv[1:]
    env = {**read_env_file(ROOT / ".env"), **os.environ}
    db = open_database(env.get("DATABASE_URL", ""), env.get("DATABASE_PATH") or ROOT / "backend" / "local.db")
    clubs = json.loads((ROOT / "data" / "rutgers_clubs.json").read_text(encoding="utf-8"))
    db.create_schema(SCHEMA)
    conflict = "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload" if replace else "ON CONFLICT DO NOTHING"
    try:
        with db.connect() as conn:
            before = conn.execute("SELECT count(*) FROM clubs").fetchone()[0]
            for club in clubs:
                conn.execute(f"INSERT INTO clubs VALUES (?,?) {conflict}", (club["id"], json.dumps(club, ensure_ascii=False)))
            after = conn.execute("SELECT count(*) FROM clubs").fetchone()[0]
    finally:
        db.close()
    print(f"{db.kind}: {len(clubs)} clubs in file, {after - before} added, {after} clubs in the database" + (" (existing imports replaced)" if replace else ""))


if __name__ == "__main__":
    main()
