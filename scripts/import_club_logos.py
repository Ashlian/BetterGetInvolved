"""Download club logos and store them in the club_logos table.

Usage (from the project folder; Windows shown, use .venv/bin/python elsewhere):
    .venv\\Scripts\\python scripts\\import_club_logos.py data\\clubs\\logo_sources.json --dry-run
    .venv\\Scripts\\python scripts\\import_club_logos.py data\\clubs\\logo_sources.json [--replace]

The JSON is a list of {"name", "profile_url", "image_url"}. Each entry is matched to a
club by profile_url == the club's source_url, else by name. Images must be PNG, JPEG,
WebP or GIF up to 1 MB (the same rules as owner uploads). With Pillow installed
(pip install pillow), large images are downscaled to 320 px WebP first. Clubs that already have a
logo are skipped unless --replace is given, so owners' own uploads are kept.
Uses DATABASE_URL from .env (Supabase) or, without it, the local SQLite file.
"""

import base64
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from backend.app import LOGO_MAX_BYTES, SCHEMA, Store, logo_type  # noqa: E402
from backend.db import open_database  # noqa: E402
from dev import read_env_file  # noqa: E402


def key(name):
    return re.sub(r"[^a-z0-9]+", "", name.lower())


DOWNLOAD_LIMIT = 15 * 1024 * 1024
LOGO_SIDE = 320  # logos show at most ~100 px; 320 covers 3x screens
SMALL_ENOUGH = 60 * 1024


def shrink(data):
    """Downscale to LOGO_SIDE px with Pillow when it's installed; otherwise return data unchanged."""
    try:
        from PIL import Image
    except ImportError:
        return data
    import io
    Image.MAX_IMAGE_PIXELS = 50_000_000  # refuse decompression bombs
    try:
        with Image.open(io.BytesIO(data)) as image:
            if max(image.size) <= LOGO_SIDE and len(data) <= SMALL_ENOUGH:
                return data
            image.thumbnail((LOGO_SIDE, LOGO_SIDE))
            out = io.BytesIO()
            # WebP keeps transparency and is far smaller than PNG for logos.
            transparent = image.mode in ("RGBA", "LA") or "transparency" in image.info
            image.convert("RGBA" if transparent else "RGB").save(out, "WEBP", quality=85, method=6)
            return out.getvalue() if len(out.getvalue()) < len(data) else data
    except Exception:  # unreadable image: let the format check below reject it
        return data


def download(url):
    """Return (bytes, None) or (None, reason)."""
    try:
        with requests.get(url, timeout=20, stream=True, headers={"User-Agent": "BetterGetInvolved-logo-import"}) as response:
            if response.status_code != 200:
                return None, f"HTTP {response.status_code}"
            data = b""
            for chunk in response.iter_content(65536):
                data += chunk
                if len(data) > DOWNLOAD_LIMIT:
                    return None, "larger than 15 MB"
    except requests.RequestException as exc:
        return None, f"download failed ({type(exc).__name__})"
    finally:
        time.sleep(0.15)  # be gentle with the image host
    if not logo_type(data):
        return None, "not a PNG, JPEG, WebP or GIF"
    data = shrink(data)
    if len(data) > LOGO_MAX_BYTES:
        return None, "larger than 1 MB (install Pillow to resize: pip install pillow)"
    if not logo_type(data):
        return None, "could not be converted"
    return data, None


def main():
    args = sys.argv[1:]
    files = [a for a in args if not a.startswith("--")]
    if len(files) != 1:
        sys.exit(__doc__)
    dry_run, replace = "--dry-run" in args, "--replace" in args
    sources = json.loads(Path(files[0]).read_text(encoding="utf-8"))
    env = {**read_env_file(ROOT / ".env"), **os.environ}
    db = open_database(env.get("DATABASE_URL", ""), env.get("DATABASE_PATH") or ROOT / "backend" / "local.db")
    store = Store(db)
    try:
        db.create_schema(SCHEMA)
        store.migrate()
        with db.connect() as conn:
            clubs = {row[0]: json.loads(row[1]) for row in conn.execute("SELECT id, payload FROM clubs")}
            has_logo = {row[0] for row in conn.execute("SELECT club_id FROM club_logos")}
        by_url = {c["source_url"]: cid for cid, c in clubs.items() if c.get("source_url")}
        by_name = {}
        for cid, club in clubs.items():
            by_name.setdefault(key(club["name"]), []).append(cid)

        matched, unmatched, skipped = [], [], []
        seen = set()
        for entry in sources:
            cid = by_url.get(entry.get("profile_url") or "")
            if not cid:
                candidates = by_name.get(key(entry.get("name", "")), [])
                cid = candidates[0] if len(candidates) == 1 else None
            if not cid:
                unmatched.append(entry.get("name", "?"))
            elif cid in seen:
                skipped.append((cid, "listed twice"))
            elif cid in has_logo and not replace:
                seen.add(cid)
                skipped.append((cid, "already has a logo"))
            else:
                seen.add(cid)
                matched.append((cid, entry["image_url"]))

        print(f"{len(sources)} sources: {len(matched)} to download, {len(skipped)} skipped, {len(unmatched)} unmatched")
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(lambda item: (item[0], *download(item[1])), matched))

        imported = 0
        for cid, data, reason in results:
            if reason:
                skipped.append((cid, reason))
                continue
            if dry_run:
                imported += 1
                continue
            stamp = datetime.now(timezone.utc)
            with db.connect() as conn:  # logo and logo_url change together
                conn.execute("INSERT INTO club_logos VALUES (?,?,?,?) ON CONFLICT(club_id) DO UPDATE SET content_type=excluded.content_type,data=excluded.data,updated_at=excluded.updated_at",
                             (cid, logo_type(data), base64.b64encode(data).decode(), stamp.isoformat()))
                row = conn.execute("SELECT payload FROM clubs WHERE id=?", (cid,)).fetchone()
                club = json.loads(row[0])
                club["logo_url"] = f"/api/clubs/{cid}/logo?v={int(stamp.timestamp())}"
                conn.execute("UPDATE clubs SET payload=? WHERE id=?", (json.dumps(club, ensure_ascii=False), cid))
            imported += 1
    finally:
        db.close()

    print(f"{'Would import' if dry_run else 'Imported'}: {imported}")
    reasons = {}
    for cid, reason in skipped:
        reasons.setdefault(reason, []).append(cid)
    for reason, ids in sorted(reasons.items()):
        print(f"Skipped ({reason}): {len(ids)}" + (f" e.g. {', '.join(ids[:5])}" if reason != "already has a logo" else ""))
    if unmatched:
        print(f"Unmatched ({len(unmatched)}): " + "; ".join(unmatched[:15]) + (" …" if len(unmatched) > 15 else ""))


if __name__ == "__main__":
    main()
