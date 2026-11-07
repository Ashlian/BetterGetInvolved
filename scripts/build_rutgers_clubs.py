"""Turn the Suitable (The Arc) organization export into BetterGetInvolved club records.

Usage: python -I build_clubs.py suitable_orgs.json clubs_out.json excluded_out.json
Everything is extracted from the organization's own public profile text; nothing is invented.
"""
import hashlib
import json
import re
import sys
import unicodedata

SRC, OUT, EXCLUDED = sys.argv[1:4]
UPDATED = "2026-11-06T12:00:00-05:00"
NOT_LISTED = "Not listed on the club's profile"

GREEK = r"\b(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)\b"
# Greek-letter names that are not fraternities, sororities or honor societies.
KEEP_GREEK = {"Chi Alpha Christian Fellowship", "Alpha Omega"}
# Fraternity/sorority governing bodies, offices and "similar" groups without two Greek letters.
EXCLUDE_NAMES = {
    "Greek Programming Board", "Interfraternity Council", "Multicultural Greek Council", "National Pan-Hellenic Council",
    "Office of Fraternity and Sorority Affairs", "Panhellenic Council", "Professional Fraternity Council",
    "Groove Phi Groove Social Fellowship", "1. Rutgers University Club/Organization Directory (Start Here!)",
}
CATEGORY_GROUP = "NEW: Student Organization Categories"
PALETTE = ["#D72C46", "#33987B", "#3B6FD4", "#C2721A", "#8A4FC7", "#1F8FA3", "#B8438A", "#5E7D2B", "#C4472D", "#4F5BD5"]
DAYS = r"(mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?s?"
DAY_RE = re.compile(r"\b(" + DAYS + r"|weekdays?|weekends?)\b", re.I)
TIME_RE = re.compile(r"\b\d{1,2}(?::\d{2})?\s*(?:-|–|to)?\s*(?:\d{1,2}(?::\d{2})?\s*)?(?:a\.?m\.?|p\.?m\.?)(?![a-z])|\bnoon\b|\b\d{1,2}:\d{2}\b", re.I)
MEET_RE = re.compile(r"\b(meet|meets|meeting|meetings|gbm|general body|practice|practices|rehearsal|rehearsals|service|services|session|sessions|gather|bible study|weekly|biweekly|bi-weekly)\b", re.I)
CAMPUS_PATTERNS = [
    ("College Avenue", r"\b(college ave(?:nue)?|cac\b|casc\b|college avenue student center|scott hall|murray hall|brower|alexander library|hickman|voorhees|frelinghuysen|van dyck|academic building)"),
    ("Busch", r"\b(busch|hill center|core building|(?-i:CoRE)\b|serc\b|allison road|engineering building|weeks hall)"),
    ("Livingston", r"\b(livingston|lsc\b|tillett|lucy stone|beck hall|(?-i:RBS)\b|rutgers business school)"),
    ("Cook", r"\b(cook campus|cook student center|cook/douglass|foran hall|blake hall)"),
    ("Douglass", r"\b(douglass (?:campus|student center|library)|trayes hall|loree)"),
]


def clean(markdown):
    text = unicodedata.normalize("NFKC", markdown or "").replace("​", "")
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)  # images
    text = re.sub(r"\[([^\]]*)\]\((?:url)?\)", r"\1", text)  # [https://x](url) style
    text = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", lambda m: m.group(1) if m.group(2) in m.group(1) else f"{m.group(1)} ({m.group(2)})", text)
    text = re.sub(r"[*_`#>]+", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def sentences(text):
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"“(])|\n+", text)
    return [p.strip(" -•\t") for p in parts if len(p.strip(" -•\t")) > 2]


def is_greekish(org):
    name = org["name"]
    if name in KEEP_GREEK:
        return False
    if name in EXCLUDE_NAMES:
        return True
    return len(re.findall(GREEK, name.lower())) >= 2


def is_about(header):
    return bool(re.search(r"about|who we are|mission|purpose|overview|description|^$", (header or "").strip(), re.I))


def is_officers(header):
    return bool(re.search(r"officer|e-?board|executive|leadership|meet (our|the)", header or "", re.I)) and not re.search(r"contact|social|link", header or "", re.I)


def shorten(text, limit=320):
    out = ""
    for s in sentences(text):
        if re.match(r"^(https?://|www\.)", s, re.I):
            continue
        candidate = (out + " " + s).strip()
        if len(candidate) > limit and out:
            break
        out = candidate
        if len(out) >= 140:
            break
    if len(out) > limit:
        out = out[: limit - 1].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return out


FREQ_RE = re.compile(r"\b(weekly|bi-?weekly|every (?:other )?week|monthly|twice a (?:week|month)|once a (?:week|month))\b", re.I)


def join_limited(parts, limit=300):
    out = ""
    for p in parts:
        candidate = (out + " " + p).strip()
        if len(candidate) > limit:
            if not out:
                out = p[: limit - 1].rsplit(" ", 1)[0].rstrip(",;:(") + "…"
            break
        out = candidate
    return out


def meeting(text):
    found, fallback = [], []
    for s in sentences(text):
        if len(s) > 400:
            continue
        day, time, meet = DAY_RE.search(s), TIME_RE.search(s), MEET_RE.search(s)
        recurring = re.search(r"\b(every|each|weekly|biweekly|bi-weekly|other)\b", s, re.I)
        if (day and time) or (day and meet and recurring) or (meet and time):
            if s not in found:
                found.append(s)
        elif meet and FREQ_RE.search(s) and len(s) < 250:
            fallback.append(s)
    return join_limited(found or fallback[:1])


def campus_of(text):
    hits = [name for name, pattern in CAMPUS_PATTERNS if re.search(pattern, text, re.I)]
    return hits[0] if len(hits) == 1 else ""


BUILDING = (r"(?:Student Center|Hall|Library|Center|Building|Gym|Gymnasium|Auditorium|Chapel|House|Lounge|Theater|Theatre|"
            r"Field|Room|Ballroom|Complex|Plaza|Annex|Commons|Pavilion|Lab|Laboratory)")
LOCATION_RES = [
    # "Busch Student Center 116a", "Alexander Library 130", "Scott Hall room 123"
    re.compile(r"\b((?:[A-Z][\w'’.-]*\s){0,4}" + BUILDING + r"(?:\s*(?:,\s*)?(?:[Rr]oom|[Rr]m\.?|#)?\s*\d{2,4}[A-Za-z]?)?)\b"),
    # "BME 116", "Wright-Reiman 231", "SEC 117"
    re.compile(r"\b([A-Z][A-Za-z]+(?:-[A-Z][A-Za-z]+)?\s\d{3}[A-Za-z]?)\b"),
    re.compile(r"\b(Zoom|Discord|Google Meet|online|virtual(?:ly)?)\b", re.I),
]


def location_of(schedule):
    for pattern in LOCATION_RES:
        m = pattern.search(schedule)
        if m:
            loc = m.group(1).strip(" ,.")
            if len(loc) >= 3 and not re.match(r"^(Fall|Spring|Summer|Winter|Sept?|Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug)\b", loc):
                return loc[0].upper() + loc[1:200] if loc.islower() else loc[:200]
    return ""


def fee_of(text):
    for s in sentences(text):
        if re.search(r"\b(dues|membership fee|member fee|fee of|cost to join|free to join|no dues|no fee)\b", s, re.I) and len(s) < 300:
            return s[:200]
    return ""


def beginner(text):
    return bool(re.search(r"no (prior |previous )?(experience|skill|background)|all (skill |experience )?levels|beginners?( are)? welcome|regardless of (experience|skill|level|major|background)|open to (all|everyone|any)|everyone is welcome|anyone (is welcome|can join)|no auditions?", text, re.I))


def eligibility_of(text):
    for s in sentences(text):
        if re.search(r"\b(open to|eligib|must be|membership is|anyone|everyone is welcome|all students|regardless of)\b", s, re.I) and len(s) < 300:
            return s[:300]
    return ""


def links(text):
    urls = re.findall(r"https?://[^\s)\]<>\"']+|(?<![@\w.])(?:www\.)[^\s)\]<>\"']+", text)
    urls = [u.rstrip(".,;:!") for u in urls]
    urls = ["https://" + u if u.startswith("www.") else u for u in urls]
    insta = next((u for u in urls if "instagram.com" in u), "")
    if not insta:
        m = re.search(r"(?:instagram|insta|IG)\s*(?:handle|account|page)?\s*[:\-]?\s*(?:at\s+)?@([A-Za-z0-9._]{2,30})", text, re.I)
        if m:
            insta = f"https://www.instagram.com/{m.group(1).rstrip('.')}"
    discord = next((u for u in urls if re.search(r"discord\.(gg|com)", u)), "")
    website = next((u for u in urls if not re.search(r"instagram|discord|linktr|facebook|tiktok|twitter|x\.com|youtube|groupme|forms\.gle|docs\.google|suitable\.co|mailto", u)), "")
    if not website:
        website = next((u for u in urls if "linktr.ee" in u), "")
    return website[:1000], insta[:1000], discord[:1000]


def email_of(text):
    emails = re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text)
    emails = [e.rstrip(".") for e in emails if not e.lower().endswith((".png", ".jpg"))]
    return emails[0] if emails else ""


def slug(name, used):
    base = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()).strip("-")[:60] or "club"
    base = "ru-" + base
    out, n = base, 2
    while out in used:
        out, n = f"{base}-{n}", n + 1
    used.add(out)
    return out


def short_name(name):
    m = re.search(r"\(([A-Z][A-Za-z0-9&]{1,9})\)", name)
    if m:
        return m.group(1)[:15]
    words = [w for w in re.findall(r"[A-Za-z0-9]+", name) if w.lower() not in {"of", "the", "and", "at", "for", "in", "a", "an", "rutgers", "university", "ru", "club", "new", "brunswick"}]
    initials = "".join(w[0].upper() for w in words)[:5]
    return initials or name[:4].upper()


orgs = json.load(open(SRC, encoding="utf-8"))
clubs, excluded, used = [], [], set()
for org in sorted(orgs, key=lambda o: o["name"].casefold()):
    reason = None
    if is_greekish(org):
        reason = "fraternity, sorority, Greek-letter honor society or Greek council"
    elif org["standing"] == "INACTIVE":
        reason = "inactive on The Arc"
    if reason:
        excluded.append({"name": org["name"], "reason": reason})
        continue
    sections = [(s["header"] or "", clean(s["body"])) for s in org["sections"]]
    about = "\n\n".join(body for header, body in sections if is_about(header) and body) or next((body for header, body in sections if body and not is_officers(header)), "")
    public_text = "\n".join(body for header, body in sections if not is_officers(header))
    contact_text = "\n".join(body for header, body in sections)
    categories = [t["text"] for t in org["tags"] if t["group"] == CATEGORY_GROUP]
    grad = any(t["text"] == "Graduate Student Organization" for t in org["tags"])
    category = categories[0] if categories else ("Graduate Student Organization" if grad else "Other")
    schedule = meeting(public_text)
    website, instagram, discord = links(contact_text)
    email = email_of("\n".join(body for header, body in sections if re.search(r"contact|email|reach", header, re.I)) or contact_text)
    fee = fee_of(public_text)
    description = shorten(about) or f"{org['name']} is a registered student organization at Rutgers–New Brunswick."
    if len(description) < 10:
        description = f"{org['name']} is a registered student organization at Rutgers–New Brunswick."
    location = location_of(schedule)
    campus = campus_of(schedule) or campus_of(public_text)
    club = {
        "id": slug(org["name"], used),
        "name": org["name"].strip().rstrip("�").strip(),
        "short_name": short_name(org["name"]),
        "category": category,
        "description": description,
        "mission": about[:2000],
        "interests": sorted({c.lower() for c in categories} | ({"graduate students"} if grad else set())),
        "campus": campus,
        "location": location or NOT_LISTED,
        "meeting_schedule": schedule or NOT_LISTED,
        "beginner_friendly": beginner(public_text),
        "membership_fee": fee or NOT_LISTED,
        "eligibility": eligibility_of(public_text) or NOT_LISTED,
        "contact_email": email,
        "website": website,
        "instagram": instagram,
        "discord": discord,
        "faqs": [],
        "source_url": org["profile"],
        "updated_at": UPDATED,
        "verification": "unclaimed",
        "color": PALETTE[int(hashlib.sha1(category.encode()).hexdigest(), 16) % len(PALETTE)],
        "featured": False,
    }
    if schedule:
        club["faqs"].append({"question": "When and where do you meet?", "answer": f"From the club's profile: {schedule}"})
    if fee:
        club["faqs"].append({"question": "How much does membership cost?", "answer": f"From the club's profile: {fee}"})
    if email or website or instagram or discord:
        ways = [f"email {email}" if email else "", f"website {website}" if website else "", f"Instagram {instagram}" if instagram else "", f"Discord {discord}" if discord else ""]
        club["faqs"].append({"question": "How do I contact or join the club?", "answer": "The club's profile lists: " + "; ".join(w for w in ways if w) + "."})
    clubs.append(club)

json.dump(clubs, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(excluded, open(EXCLUDED, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"clubs: {len(clubs)}  excluded: {len(excluded)}")
for key in ("meeting_schedule", "location", "membership_fee", "eligibility"):
    print(f"  {key} found: {sum(1 for c in clubs if c[key] != NOT_LISTED)}")
for key in ("campus", "contact_email", "website", "instagram", "discord"):
    print(f"  {key} found: {sum(1 for c in clubs if c[key])}")
print("  beginner_friendly:", sum(c["beginner_friendly"] for c in clubs))
