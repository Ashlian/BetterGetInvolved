"""Real Rutgers events from Scarlet Sync's public, no-auth MCP tool `get_events`.

Scarlet Sync aggregates Rutgers getINVOLVED (CampusLabs) and IMLeagues feeds. The
records carry no descriptions, accessibility notes, or reliable campus field, so
this module never invents them: campus is inferred only from known place names,
and everything else links back to the original listing.
"""

from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone

MCP_URL = "https://scarletsync.app/api/mcp"
ATTRIBUTION_URL = "https://scarletsync.app/events"
USER_AGENT = "BetterGetInvolved/0.1 (independent student project)"
PAGE_SIZE = 50
MAX_PAGES = 20

# Place names checked in order; the first match wins. Unmatched or online
# locations keep an empty campus rather than a guessed one.
CAMPUS_PLACES = [
    ("Livingston", r"\b(livingstone?|livi|lsc|tillett|lucy stone|beck hall|rbs|business school|quads|kilmer library|jersey mike.?s arena|rutgers athletic center|rac)\b"),
    ("Busch", r"\b(busch|werblin|hill center|allison road|core building|arc|sec|science and engineering resource|bsc|richard weeks|carr library|math/physics library|library of science and medicine|lsm|shi stadium)\b"),
    ("Cook", r"\b(cook|neilson|foran|blake hall|food science|loree|red oak|gardens)\b"),
    ("Douglass", r"\b(douglass|dcc|voorhees chapel|jameson|mabel smith|trayes)\b"),
    ("College Avenue", r"\b(college ave(?:nue)?|casc|cac|the yard|scott hall|murray hall|brower|alexander library|hamilton street|zimmerli|kirkpatrick|voorhees mall|student activities center|sac|honors college|frelinghuysen|hardenbergh|old queens|academic building)\b"),
]
INVOLVEMENT_CATEGORIES = {"club", "arts", "recreation", "intramural"}
OTHER_CAMPUSES = r"\b(newark|camden)\b"


def is_involvement_event(event):
    """Club, arts, and recreation events, plus games played in New Brunswick.

    Study-space hours, Newark and Camden listings, and away games are part of
    the feed but are not ways to get involved on this campus.
    """
    if re.search(OTHER_CAMPUSES, event["location"], re.I):
        return False
    if event["category"].lower() in INVOLVEMENT_CATEGORIES:
        return True
    return event["category"].lower() != "study space" and bool(event["campus"])


def select_events(events):
    """Involvement events only, with repeated same-time listings collapsed.

    IMLeagues lists one generic "Intramural" entry per field at the same hour;
    one entry per title, host, and start time is enough to find the games.
    """
    seen, selected = set(), []
    for event in sorted(events, key=lambda e: (e["starts_at"], e["campus"] == "")):
        key = (event["title"].casefold(), event["club_name"].casefold(), event["starts_at"])
        if is_involvement_event(event) and key not in seen:
            seen.add(key)
            selected.append(event)
    return selected


def repair_text(value):
    """Undo UTF-8 text that was decoded as Windows-1252 upstream (e.g. "â€”")."""
    if not isinstance(value, str) or not re.search(r"[ÃÂâ][\x80-\xbf€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]", value):
        return value
    try:
        return value.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value


def infer_campus(location):
    text = (location or "").lower()
    return next((campus for campus, pattern in CAMPUS_PLACES if re.search(pattern, text)), "")


def normalize(raw):
    """Map one Scarlet Sync event onto the app's event shape, marked as live."""
    clean = {key: repair_text(value) for key, value in raw.items()}
    starts = datetime.fromisoformat(clean["startTime"])
    ends = datetime.fromisoformat(clean["endTime"]) if clean.get("endTime") else None
    url = clean.get("url") if str(clean.get("url") or "").startswith("https://") else ""
    image = clean.get("imageUrl") if str(clean.get("imageUrl") or "").startswith("https://") else None
    location = (clean.get("location") or "").strip()
    return {
        "id": "live-" + str(clean["id"]),
        "club_id": "",
        "club_name": (clean.get("host") or "Rutgers organization").strip(),
        "title": (clean.get("title") or "Untitled event").strip(),
        "description": (clean.get("description") or "").strip(),
        "starts_at": starts.isoformat(),
        "ends_at": ends.isoformat() if ends else None,
        "campus": infer_campus(location),
        "location": location or "Location not listed",
        "category": (clean.get("category") or "Event").strip(),
        "cost": 0 if clean.get("isFree") else None,
        "beginner_friendly": False,
        "registration_url": url,
        "accessibility": "",
        "source_url": url,
        "updated_at": clean.get("scrapedAt") or datetime.now(timezone.utc).isoformat(),
        "status": "scheduled",
        "is_demo": False,
        "live": True,
        "source": clean.get("source") or "",
        "image_url": image,
    }


def call_tool(name, arguments, timeout=20):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}}).encode()
    request = urllib.request.Request(MCP_URL, data=body, method="POST", headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = response.read().decode("utf-8")
    if payload.lstrip().startswith("event:") or payload.lstrip().startswith("data:"):
        # Streamable HTTP may answer as server-sent events; take the last data line.
        payload = [line[5:].strip() for line in payload.splitlines() if line.startswith("data:")][-1]
    message = json.loads(payload)
    result = message.get("result") or {}
    if message.get("error") or result.get("isError"):
        raise RuntimeError(f"Scarlet Sync {name} failed: {message.get('error') or result.get('content')}")
    return result.get("structuredContent") or {}


def fetch_upcoming(fetch=call_tool):
    """Every upcoming event the feed returns, normalized. Raises on network errors."""
    events, offset = [], 0
    for _ in range(MAX_PAGES):
        page = fetch("get_events", {"limit": PAGE_SIZE, "offset": offset})
        batch = page.get("events") or []
        for raw in batch:
            try:
                events.append(normalize(raw))
            except (KeyError, TypeError, ValueError):
                continue
        offset += len(batch)
        if not batch or offset >= int(page.get("total") or 0):
            break
    return events
