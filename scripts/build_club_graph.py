"""Build the club graph (graph_edges) now and print its size.

Usage (from the project folder):
    .venv\\Scripts\\python scripts\\build_club_graph.py          # Windows
    .venv/bin/python scripts/build_club_graph.py                # macOS, Linux

The API also rebuilds the graph by itself the first time someone opens "For you" after club
content changes; running this ahead of time just spares that person the few-second wait.
Uses DATABASE_URL from .env (Supabase) or, without it, the local SQLite file.
"""

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from backend import graph as club_graph  # noqa: E402
from backend.app import SCHEMA, Store  # noqa: E402
from backend.db import open_database  # noqa: E402
from dev import read_env_file  # noqa: E402


def main():
    env = {**read_env_file(ROOT / ".env"), **os.environ}
    db = open_database(env.get("DATABASE_URL", ""), env.get("DATABASE_PATH") or ROOT / "backend" / "local.db")
    store = Store(db)
    try:
        db.create_schema(SCHEMA)
        store.migrate()
        clubs = store.records("clubs")
        started = time.time()
        edges = club_graph.build_edges(clubs)
        graph = club_graph.ClubGraph(edges)
        store.save_graph(edges, club_graph.fingerprint(clubs), graph.stats())
        print(f"{db.kind}: graph for {len(clubs)} clubs built in {time.time() - started:.1f}s: {json.dumps(graph.stats())}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
