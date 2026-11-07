"""The API suite against Postgres, the engine Supabase runs.

Set TEST_DATABASE_URL to a disposable database (or a Supabase project you are
happy to add a temporary schema to). Each test gets its own schema, dropped
afterwards, so it never touches the app's tables in `public`.
"""

import json
import os
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from test_api import ORIGIN, club, event
from test_api import (  # noqa: F401  Re-collected here with the Postgres fixture.
    test_authentication_cookie_login_logout_and_expiry, test_password_is_not_trimmed_and_registration_is_student,
    test_auth_and_officer_denial, test_ownership_of_profile_saves_bookmarks_rsvp_and_account_delete,
    test_origin_csrf_and_remote_demo_host_denial, test_officer_scope_create_duplicate_validation_cancellation,
    test_faq_exact_source_missing_and_injection_abstention, test_deterministic_campus_cost_beginner_date_time_filters,
    test_sql_injection_search_profile_and_login, test_recommendations_dismissal_diversity_and_aggregate_privacy,
    test_profile_faq_facts_follow_officer_edits, test_live_events_search_save_calendar_and_rsvp,
)

URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL is not set")


@pytest.fixture
def api(tmp_path):
    import psycopg

    seed = {"clubs":[club("ai","Demo AI Club"),club("robotics","Demo Robotics Club",beginner=False,fee="$20"),club("arts","Demo Arts Club",campus="Douglass",category="Arts")],"events":[event("weekend"),event("paid",cost=10),event("advanced",beginner=False),event("next",starts="2026-10-31T18:30:00-04:00")]}
    path = tmp_path / "seed.json"
    path.write_text(json.dumps(seed))
    schema = "bgi_test_" + uuid.uuid4().hex[:12]
    app = create_app(seed_path=path, demo_mode=True, live_sync=False, database_url=URL, db_schema=schema)
    try:
        with TestClient(app, headers=ORIGIN) as client:
            yield client, None
    finally:
        with psycopg.connect(URL, autocommit=True) as conn:
            conn.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def test_postgres_schema_is_private_and_precise(api):
    client, _ = api
    store = client.app.state.store
    assert store.db.kind == "postgres"
    with store.connect() as conn:
        # Epoch seconds must survive storage; a 4-byte REAL would round by minutes.
        assert conn.execute("SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='sessions' AND column_name='expires_at'").fetchone()[0] == "double precision"
        unprotected = conn.execute("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relkind='r' AND NOT c.relrowsecurity").fetchall()
        assert unprotected == []
    assert client.get("/api/health").json()["database"] == "postgres"
