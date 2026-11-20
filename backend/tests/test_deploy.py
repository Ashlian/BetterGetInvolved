"""Running on Vercel: proxy-only access, real client IPs, preview origins, cron, and packaging."""

import json
import re
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend.app import create_app
from test_api import club

BACKEND = Path(__file__).resolve().parents[1]
SECRET = "proxy-secret-for-tests"


@pytest.fixture
def make(tmp_path, monkeypatch):
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps({"clubs": [club("ai", "Demo AI Club")], "events": []}))

    def build(**env):
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        return TestClient(create_app(db_path=tmp_path / "deploy.db", seed_path=seed, demo_mode=False, live_sync=False, google_client_id="x"), base_url="https://testserver")
    return build


def proxied(ip="203.0.113.7", host="bgi.vercel.app"):
    return {"x-bgi-proxy-secret": SECRET, "x-bgi-client-ip": ip, "x-bgi-site-host": host}


def test_only_the_proxy_can_reach_the_api(make):
    client = make(PROXY_SECRET=SECRET)
    assert client.get("/api/health").status_code == 403
    assert client.get("/api/health", headers={"x-bgi-proxy-secret": "wrong"}).status_code == 403
    assert client.get("/api/health", headers=proxied()).status_code == 200


def test_writes_are_accepted_from_the_site_the_request_came_to(make):
    client = make(PROXY_SECRET=SECRET, ALLOWED_ORIGINS="https://bettergetinvolved.example")
    # A preview deployment's own origin works without listing it.
    assert client.post("/api/auth/logout", headers={**proxied(host="bgi-git-x.vercel.app"), "origin": "https://bgi-git-x.vercel.app"}).status_code == 200
    # Another site's origin does not, even through the proxy.
    assert client.post("/api/auth/logout", headers={**proxied(host="bgi.vercel.app"), "origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/auth/logout", headers={**proxied(), "origin": "https://bettergetinvolved.example"}).status_code == 200


def test_rate_limits_apply_per_visitor_behind_the_proxy(make):
    client = make(PROXY_SECRET=SECRET)
    body = {"credential": "x"}  # rejected by validation; only the rate limit matters here
    origin = {"origin": "https://bgi.vercel.app"}
    # Sixteen different visitors each get their own allowance...
    assert all(client.post("/api/auth/google", json=body, headers={**proxied(ip=f"198.51.100.{n}"), **origin}).status_code == 422 for n in range(16))
    # ...while one visitor is limited after fifteen sign-in attempts a minute.
    codes = [client.post("/api/auth/google", json=body, headers={**proxied(ip="192.0.2.1"), **origin}).status_code for _ in range(16)]
    assert codes[:15] == [422] * 15 and codes[15] == 429


def test_cron_sync_requires_the_secret(make, monkeypatch):
    calls = []
    monkeypatch.setattr(app_module.live_events, "fetch_upcoming", lambda: calls.append(1) or [])
    assert make().get("/api/cron/live-events").status_code == 404  # no CRON_SECRET: no endpoint
    client = make(CRON_SECRET="cron-secret-for-tests")
    assert client.get("/api/cron/live-events", headers={"authorization": "Bearer nope"}).status_code == 404
    response = client.get("/api/cron/live-events", headers={"authorization": "Bearer cron-secret-for-tests"})
    assert response.status_code == 200 and calls == [1] and response.json()["count"] == 0


def test_vercel_defaults_to_production_and_requires_a_database(tmp_path, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        create_app()
    app = create_app(db_path=tmp_path / "v.db", seed_path=tmp_path / "none.json")
    assert app.state.demo_mode is False


def test_deploy_dependencies_match_local_requirements():
    pins = lambda lines: {re.split(r"[=\[]", line)[0].lower(): line.split("==")[1] for line in lines if "==" in line}
    local = pins((BACKEND / "requirements.txt").read_text().split())
    deployed = pins(tomllib.loads((BACKEND / "pyproject.toml").read_text())["project"]["dependencies"])
    assert deployed and all(local.get(name) == version for name, version in deployed.items()), (deployed, local)
    assert "pytest" not in deployed and "httpx" not in deployed  # test tools stay out of the bundle


def test_entry_point_works_from_a_renamed_folder(tmp_path):
    # Vercel deploys backend/ as the function root, so it is no longer named "backend".
    task = tmp_path / "task"
    shutil.copytree(BACKEND, task, ignore=shutil.ignore_patterns("tests", "__pycache__", "*.db"))
    code = "import sys; sys.path.insert(0, '.'); import vercel_app; print(type(vercel_app.app).__name__, sys.modules['backend'].__file__)"
    env = {"DEMO_MODE": "0", "LIVE_EVENTS_SYNC": "0", "DATABASE_URL": "", "DATABASE_PATH": str(tmp_path / "x.db"), "SYSTEMROOT": __import__("os").environ.get("SYSTEMROOT", "")}
    result = subprocess.run([sys.executable, "-I", "-c", code], cwd=task, env=env, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith("FastAPI") and str(task) in result.stdout
