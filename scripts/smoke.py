"""Exercise browser-facing API routing and session persistence on a running app.

Creates and deletes one temporary synthetic student account. No real data needed.
Run: .venv/bin/python scripts/smoke.py [http://127.0.0.1:3000]
"""
import sys
import uuid
import httpx


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
    origin = base.rstrip("/")
    email = f"smoke-{uuid.uuid4().hex}@example.org"
    password = uuid.uuid4().hex + "Synthetic!"
    checks = 0
    registered = False
    with httpx.Client(base_url=base, headers={"Origin": origin}, timeout=45) as client:
        def check(condition, description):
            nonlocal checks
            if not condition:
                raise AssertionError(description)
            checks += 1

        try:
            health = client.get("/api/health")
            check(health.status_code == 200 and health.json()["status"] == "ok", "API gateway health")
            clubs = client.get("/api/clubs").json()
            events = client.get("/api/events").json()
            check(len(clubs) >= 20 and len(events) > 0, "Representative data loads through gateway")
            club, event = clubs[0], next(e for e in events if e["status"] == "scheduled")
            for path in ("/", f"/clubs/{club['id']}", f"/events/{event['id']}"):
                page = client.get(path)
                check(page.status_code == 200 and "BetterGetInvolved" in page.text, f"Web route responds: {path}")
            response = client.post("/api/auth/register", json={"email": email, "password": password, "display_name": "Temporary smoke test"})
            response.raise_for_status()
            registered = True
            check(response.json()["role"] == "student", "Registration grants student role")
            check("httponly" in response.headers.get("set-cookie", "").lower(), "Proxy preserves HTTP-only session cookie")
            check(client.get("/api/auth/me").json()["email"] == email, "Session cookie survives next request")
            check(client.put("/api/profile", json={"interests": ["technology", "volunteering"], "campus": "Busch", "onboarded": True}).status_code == 200, "Private profile update")
            check(client.get("/api/recommendations").json()["clubs"], "Personalized recommendations")
            check(client.post(f"/api/clubs/{club['id']}/follow").json()["following"], "Club follow persists")
            check(client.post(f"/api/clubs/{club['id']}/bookmark").json()["bookmarked"], "Maybe-later bookmark persists")
            check(client.post(f"/api/events/{event['id']}/save").json()["saved"], "Event save persists")
            check(client.post(f"/api/events/{event['id']}/rsvp", json={"status": "interested"}).status_code == 200, "Private RSVP preference")
            saved = client.get("/api/saved").json()
            check(club["id"] in saved["club_ids"] and event["id"] in saved["event_ids"], "Saved items returned only for current account")
            check(client.put(f"/api/officer/clubs/{club['id']}", json={"location": "Unauthorized"}).status_code == 403, "Student cannot edit organization")
            faq = client.post(f"/api/clubs/{club['id']}/faq", json={"question": club["faqs"][0]["question"]}).json()
            check(faq["supported"] and faq["sources"], "FAQ has source support")
            check(client.get(f"/api/events/{event['id']}/calendar").text.startswith("BEGIN:VCALENDAR"), "Calendar download passes through gateway")
            client.post("/api/auth/logout").raise_for_status()
            check(client.get("/api/auth/me").status_code == 401, "Logout invalidates session")
            client.post("/api/auth/login", json={"email": email, "password": password}).raise_for_status()
            check(event["id"] in client.get("/api/saved").json()["event_ids"], "Saved events survive new login")
            client.delete("/api/auth/me").raise_for_status()
            registered = False
            check(client.get("/api/auth/me").status_code == 401, "Account deletion invalidates session")
        finally:
            if registered:
                if client.get("/api/auth/me").status_code != 200:
                    client.post("/api/auth/login", json={"email": email, "password": password})
                client.delete("/api/auth/me")
    print(f"PASS: {checks} connected API/session checks; temporary account removed.")


if __name__ == "__main__":
    main()
