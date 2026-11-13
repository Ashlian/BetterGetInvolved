"""Add clubs and manage who owns them (club managers).

Usage (from the project folder; Windows shown, use .venv/bin/python elsewhere):
    .venv\\Scripts\\python scripts\\manage_clubs.py add data\\clubs\\amogus-club.json [--replace]
    .venv\\Scripts\\python scripts\\manage_clubs.py grant amogus-club sm3584 ap2999@scarletmail.rutgers.edu
    .venv\\Scripts\\python scripts\\manage_clubs.py revoke amogus-club ap2999
    .venv\\Scripts\\python scripts\\manage_clubs.py owners [amogus-club]

A bare NetID gets @scarletmail.rutgers.edu appended. Owners who already have an account
get access immediately; anyone else is recorded as a pending owner and gets access the
first time they sign in with that address. Uses DATABASE_URL from .env (Supabase) or,
without it, the local SQLite file.
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from backend.app import SCHEMA, Store, grant_club_owner  # noqa: E402
from backend.db import open_database  # noqa: E402
from dev import read_env_file  # noqa: E402

DOMAIN = "scarletmail.rutgers.edu"


def email(value):
    value = value.strip().lower()
    return value if "@" in value else f"{value}@{DOMAIN}"


def require_club(conn, club_id):
    row = conn.execute("SELECT payload FROM clubs WHERE id=?", (club_id,)).fetchone()
    if not row:
        sys.exit(f"No club with id {club_id!r}. Add it first with: manage_clubs.py add <file>")
    return json.loads(row[0])


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("add", "grant", "revoke", "owners"):
        sys.exit(__doc__)
    command, args = sys.argv[1], sys.argv[2:]
    env = {**read_env_file(ROOT / ".env"), **os.environ}
    db = open_database(env.get("DATABASE_URL", ""), env.get("DATABASE_PATH") or ROOT / "backend" / "local.db")
    store = Store(db)
    db.create_schema(SCHEMA)
    store.migrate()
    try:
        with db.connect() as conn:
            if command == "add":
                replace = "--replace" in args
                files = [a for a in args if a != "--replace"] or sys.exit("Give a club JSON file to add.")
                conflict = "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload" if replace else "ON CONFLICT DO NOTHING"
                for path in files:
                    data = json.loads(Path(path).read_text(encoding="utf-8"))
                    for club in data if isinstance(data, list) else [data]:
                        added = conn.execute(f"INSERT INTO clubs VALUES (?,?) {conflict}", (club["id"], json.dumps(club, ensure_ascii=False))).rowcount
                        print(f"{club['id']}: {'saved' if added else 'already exists (use --replace to overwrite)'}")
            elif command in ("grant", "revoke"):
                if len(args) < 2:
                    sys.exit(f"Usage: manage_clubs.py {command} <club-id> <netid-or-email>...")
                club = require_club(conn, args[0])
                for address in map(email, args[1:]):
                    if command == "grant":
                        result = grant_club_owner(conn, club["id"], address)
                        print(f"{address}: {'can manage now' if result == 'granted' else 'pending; gets access at first sign-in'}")
                    else:
                        user = conn.execute("SELECT id FROM users WHERE email=?", (address,)).fetchone()
                        removed = conn.execute("DELETE FROM club_owner_invites WHERE email=? AND club_id=?", (address, club["id"])).rowcount
                        if user:
                            removed += conn.execute("DELETE FROM officers WHERE user_id=? AND club_id=?", (user[0], club["id"])).rowcount
                        print(f"{address}: {'removed' if removed else 'was not an owner'}")
            else:
                where, params = ("WHERE o.club_id=?", (args[0],)) if args else ("", ())
                for row in conn.execute(f"SELECT o.club_id, u.email FROM officers o JOIN users u ON u.id=o.user_id {where} ORDER BY o.club_id, u.email", params):
                    print(f"{row[0]}: {row[1]}")
                where = "WHERE club_id=?" if args else ""
                for row in conn.execute(f"SELECT club_id, email FROM club_owner_invites {where} ORDER BY club_id, email", params):
                    print(f"{row[0]}: {row[1]} (pending first sign-in)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
