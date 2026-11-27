"""Comprehensive backend tests for the AI Wildlife Intelligence Assistant.

Covers:
- Authentication & RBAC enforcement (unauthenticated 401, valid operator/reviewer/admin access)
- Missing GEMINI_API_KEY graceful 503 + status endpoint without exposing API keys
- Real database-grounded read-only tool execution across villages, incidents, sightings,
  alerts, risk zones/outlook, village risk details, district comparisons, patrols, detections,
  and daily intelligence brief
- Multi-turn Gemini function-calling loop (tool call -> DB query -> functionResponse -> final answer)
- Session conversation context forwarding
- Security controls: read-only enforcement, rejection of unknown/disallowed tools, PII & API key redaction
- Gemini upstream failure handling (403 auth, 429 quota, 404 model not found, timeout, network error)
- Rate limiting on /api/v1/assistant/chat
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import logging
from typing import Any

from fastapi.testclient import TestClient
import httpx
import pytest
from sqlalchemy.orm import Session

from app.api.routes import assistant as assistant_routes
from app.core.database import get_db
from app.core.security import AuthenticatedPrincipal
from app.main import create_application
from app.models import Alert, Incident, Patrol, RiskZone, Sighting, Village
from app.services.assistant_tools import TOOL_HANDLERS, execute_readonly_tool
from app.services.gemini_assistant import GeminiAssistantService
from app.services.spatial import make_point_geom, make_polygon_geom
from tests.conftest import auth_headers, make_test_settings


def _seed_intelligence_records(db: Session) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    v1 = Village(
        name="Kadambur Fringe",
        district="Bandipur Division",
        forest_range="Hediyala Range",
        population=1840,
        households=410,
        forest_distance_km=0.6,
        latitude=11.674,
        longitude=76.625,
        geom=make_point_geom(11.674, 76.625, False),
        risk_level="Critical",
        risk_score=91,
        active_solar_fence=True,
        fence_status="Damaged - Breach near Pylon 54",
        assigned_rrt="Sector 4 RRT Alpha",
        emergency_contact="+91-99999-00001",  # Must NEVER be sent to Gemini!
        recent_incidents_30d=4,
    )
    v2 = Village(
        name="Mangala Buffer",
        district="Gundlupet Buffer",
        forest_range="Gundlupet Range",
        population=1250,
        households=280,
        forest_distance_km=1.4,
        latitude=11.712,
        longitude=76.648,
        geom=make_point_geom(11.712, 76.648, False),
        risk_level="High",
        risk_score=76,
        active_solar_fence=False,
        fence_status="Not Installed",
        assigned_rrt="Gundlupet Mobile RRT",
        emergency_contact="+91-99999-00002",
        recent_incidents_30d=2,
    )
    db.add_all([v1, v2])
    db.flush()

    inc1 = Incident(
        incident_code="INC-TEST-101",
        species="Asian Elephant",
        date_time=now - timedelta(days=2),
        latitude=11.675,
        longitude=76.626,
        geom=make_point_geom(11.675, 76.626, False),
        village_id=v1.id,
        village=v1.name,
        district="Bandipur Division",
        forest_range="Hediyala Range",
        incident_type="Crop Raiding",
        severity="Critical",
        human_injury="None",
        human_injuries_count=0,
        livestock_loss_count=0,
        crop_damage_estimated_acres=3.5,
        crop_type="Sugarcane",
        description="Herd of 6 Asian Elephants entered sugarcane plots at 21:30 IST.",
        status="Under Investigation",
        reported_by="Beat Guard SecretName",
    )
    inc2 = Incident(
        incident_code="INC-TEST-102",
        species="Indian Leopard",
        date_time=now - timedelta(days=5),
        latitude=11.713,
        longitude=76.649,
        geom=make_point_geom(11.713, 76.649, False),
        village_id=v2.id,
        village=v2.name,
        district="Gundlupet Buffer",
        forest_range="Gundlupet Range",
        incident_type="Livestock Predation",
        severity="High",
        human_injury="None",
        human_injuries_count=0,
        livestock_loss_count=2,
        crop_damage_estimated_acres=0.0,
        description="Leopard entered peripheral cattle pen near dusk.",
        status="Reported",
        reported_by="Forest Watcher Two",
    )
    db.add_all([inc1, inc2])

    s1 = Sighting(
        sighting_code="SGT-TEST-201",
        species="Asian Elephant",
        timestamp=now - timedelta(hours=10),
        latitude=11.676,
        longitude=76.628,
        geom=make_point_geom(11.676, 76.628, False),
        location_name="Kadambur Northern Stream",
        district="Bandipur Division",
        forest_range="Hediyala Range",
        herd_size=7,
        movement_direction="North-East",
        bearing_degrees=45,
        behavior="Crop Approach",
        juveniles_present=True,
        observation_details="Matriarch herd moving along stream toward Kadambur Fringe.",
        observer_name="Ranger A",
        observer_role="Forest Guard",
        verified_by_forest_guard=True,
        village_id=v1.id,
    )
    db.add(s1)

    rz1 = RiskZone(
        name="Kadambur Elephant Corridor Zone",
        district="Bandipur Division",
        forest_range="Hediyala Range",
        village_id=v1.id,
        risk_level="Critical",
        risk_score=92,
        dominant_species="Asian Elephant",
        center_lat=11.674,
        center_lng=76.625,
        polygon_coordinates=[[11.67, 76.62], [11.68, 76.62], [11.68, 76.63], [11.67, 76.63]],
        geom=make_polygon_geom(
            [[11.67, 76.62], [11.68, 76.62], [11.68, 76.63], [11.67, 76.63]], False
        ),
        active_alert_count=2,
        primary_risk_factor="Sugarcane harvest combined with breached solar fence at Pylon 54.",
    )
    db.add(rz1)

    a1 = Alert(
        title="Critical Elephant Herd Approaching Kadambur",
        message="7 elephants tracked 500m from Kadambur perimeter.",
        severity="Critical",
        species="Asian Elephant",
        affected_village=v1.name,
        village_id=v1.id,
        district="Bandipur Division",
        latitude=11.674,
        longitude=76.625,
        geom=make_point_geom(11.674, 76.625, False),
        alert_time="2 hours ago",
        triggered_at=now - timedelta(hours=2),
        acknowledged=False,
        response_status="Pending Dispatch",
        risk_reason="Breached solar fence + active sugarcane harvest.",
    )
    db.add(a1)

    p1 = Patrol(
        patrol_code="PTL-TEST-301",
        team_name="Gundlupet Mobile Unit",
        lead_officer="Officer K",
        target_area="Mangala Buffer Perimeter",
        sector="Gundlupet Range",
        district="Gundlupet Buffer",
        village_id=v2.id,
        priority="High",
        status="Active",
        scheduled_window="19:00 - 04:00 IST",
        active_personnel=5,
        equipment=["Thermal Drone", "Searchlights"],
        risk_rationale="Leopard activity near cattle sheds.",
        approved_by="DFO",
        latitude=11.712,
        longitude=76.648,
        geom=make_point_geom(11.712, 76.648, False),
    )
    db.add(p1)
    db.commit()
    return {"v1": v1, "v2": v2}


def _dummy_principal(role: str = "operator") -> AuthenticatedPrincipal:
    return AuthenticatedPrincipal(
        subject="test-officer",
        email="officer@forest.gov.in",
        display_name="Field Officer",
        roles=frozenset({role}),
        auth_method="jwt_hs256",
    )


def test_assistant_endpoints_require_authentication(db_session: Session) -> None:
    settings = make_test_settings(gemini_api_key="test-key-123")
    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session

    with TestClient(app) as tc:
        assert tc.get("/api/v1/assistant/status").status_code == 401
        assert tc.post("/api/v1/assistant/chat", json={"message": "Hello"}).status_code == 401


def test_assistant_missing_api_key_returns_clear_status_and_503_without_crashing(
    db_session: Session,
) -> None:
    settings = make_test_settings(gemini_api_key=None, gemini_model="gemini-4-hydrogen")
    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session
    headers = auth_headers(settings, role="operator")

    with TestClient(app) as tc:
        status_resp = tc.get("/api/v1/assistant/status", headers=headers)
        assert status_resp.status_code == 200
        body = status_resp.json()
        assert body["configured"] is False
        assert body["model"] == "gemini-4-hydrogen"
        assert body["read_only"] is True
        assert "GEMINI_API_KEY" in (body["message"] or "")
        assert "api_key" not in body
        assert "gemini_api_key" not in body

        chat_resp = tc.post(
            "/api/v1/assistant/chat",
            json={"message": "Which villages are at highest risk today?"},
            headers=headers,
        )
        assert chat_resp.status_code == 503
        assert "GEMINI_API_KEY" in chat_resp.json()["detail"]


def test_readonly_tools_query_real_data_and_exclude_pii_and_block_unknown_tools(
    db_session: Session,
) -> None:
    _seed_intelligence_records(db_session)
    principal = _dummy_principal("operator")

    # 1. High-risk elephant villages
    out_villages = execute_readonly_tool(
        db_session, "get_high_risk_villages", {"limit": 5, "species": "Asian Elephant"}, principal
    )
    assert out_villages.record_count == 2
    assert out_villages.payload["villages"][0]["village_name"] == "Kadambur Fringe"
    assert out_villages.payload["villages"][0]["risk_score"] == 91
    assert len(out_villages.map_locations) == 2
    # PII check: emergency_contact phone numbers must NEVER appear in tool output sent to Gemini
    assert "+91-99999-00001" not in json.dumps(out_villages.payload)

    # 2. Incident summary
    out_inc = execute_readonly_tool(db_session, "get_incident_summary", {"days": 30}, principal)
    assert out_inc.payload["window_summary"]["count"] == 2
    assert out_inc.payload["window_summary"]["total_crop_damage_acres"] == 3.5
    assert "SecretName" not in json.dumps(out_inc.payload)

    # 3. Sightings near Kadambur
    out_sight = execute_readonly_tool(
        db_session, "get_recent_sightings", {"village": "Kadambur Fringe", "species": "Elephant"}, principal
    )
    assert out_sight.record_count == 1
    assert out_sight.payload["movement_direction_summary"]["North-East"] == 1

    # 4. Active alerts
    out_alerts = execute_readonly_tool(db_session, "get_active_alerts", {}, principal)
    assert out_alerts.record_count == 1
    assert out_alerts.payload["unacknowledged_count"] == 1

    # 5. Risk predictions honesty check (must not fabricate ML forecast)
    out_pred = execute_readonly_tool(db_session, "get_risk_predictions", {"window_hours": 48}, principal)
    assert out_pred.payload["live_ml_forecast_available"] is False
    assert len(out_pred.payload["high_risk_zones"]) == 1

    # 6. Village risk details
    out_detail = execute_readonly_tool(
        db_session, "get_village_risk_details", {"village_name": "Kadambur Fringe"}, principal
    )
    assert out_detail.payload["found"] is True
    assert len(out_detail.payload["identified_risk_drivers"]) >= 2

    # 7. District comparison
    out_cmp = execute_readonly_tool(
        db_session,
        "compare_district_incidents",
        {"district_a": "Bandipur Division", "district_b": "Gundlupet Buffer"},
        principal,
    )
    assert len(out_cmp.payload["comparison"]) == 2

    # 8. Patrol coverage gaps (Kadambur has 0 active patrols + 1 unresolved alert)
    out_patrol = execute_readonly_tool(db_session, "get_patrol_summary", {}, principal)
    gap_villages = [g["village_name"] for g in out_patrol.payload["areas_needing_additional_patrols"]]
    assert "Kadambur Fringe" in gap_villages

    # 9. Daily intelligence brief
    out_brief = execute_readonly_tool(db_session, "get_daily_intelligence_brief", {}, principal)
    assert out_brief.payload["incidents"]["last_7d"] == 2
    assert out_brief.payload["alerts"]["unresolved_count"] == 1

    # 10. Disallowed/unknown tool rejected cleanly
    out_bad = execute_readonly_tool(
        db_session, "drop_all_tables", {"sql": "DROP TABLE incidents;"}, principal
    )
    assert "error" in out_bad.payload
    assert set(out_bad.payload["allowed_tools"]) == set(TOOL_HANDLERS.keys())


def test_gemini_multi_turn_tool_calling_and_context_grounding(db_session: Session) -> None:
    _seed_intelligence_records(db_session)
    secret_api_key = "AIza-fake-server-secret-never-leak-98765"
    settings = make_test_settings(
        gemini_api_key=secret_api_key,
        gemini_model="gemini-4-hydrogen",
    )

    captured_requests: list[dict[str, Any]] = []
    call_count = {"n": 0}

    def _mock_transport_handler(request: httpx.Request) -> httpx.Response:
        assert request.headers.get("x-goog-api-key") == secret_api_key
        assert secret_api_key not in str(request.url)
        assert request.headers.get("User-Agent") == "aistudio-build"

        payload = json.loads(request.content.decode("utf-8"))
        captured_requests.append(payload)
        call_count["n"] += 1

        if call_count["n"] == 1:
            # Round 1: Gemini asks backend to run get_high_risk_villages
            return httpx.Response(
                200,
                json={
                    "candidates": [
                        {
                            "content": {
                                "role": "model",
                                "parts": [
                                    {
                                        "functionCall": {
                                            "id": "call-1",
                                            "name": "get_high_risk_villages",
                                            "args": {"limit": 5, "species": "Asian Elephant"},
                                        }
                                    }
                                ],
                            }
                        }
                    ]
                },
            )
        # Round 2: Gemini synthesizes final grounded answer from tool response
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "role": "model",
                            "parts": [
                                {
                                    "text": (
                                        "## Highest Elephant Conflict Risk Villages\n\n"
                                        "- **Kadambur Fringe** (Bandipur Division): **Critical (91%)**, "
                                        "solar fence breached near Pylon 54, 4 recent incidents."
                                    )
                                }
                            ],
                        }
                    }
                ]
            },
        )

    mock_http = httpx.Client(transport=httpx.MockTransport(_mock_transport_handler))
    service = GeminiAssistantService(settings, http_client=mock_http)

    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[assistant_routes._get_assistant_service_dep] = lambda: service

    with TestClient(app) as tc:
        resp = tc.post(
            "/api/v1/assistant/chat",
            json={
                "message": "Show the top 5 villages with the highest elephant conflict risk.",
                "history": [
                    {"role": "user", "content": "Give me a quick overview of Bandipur."},
                    {"role": "assistant", "content": "Bandipur has active elephant corridors."},
                ],
                "active_district": "Bandipur Division",
                "active_date_range": "Last 30 Days",
            },
            headers=auth_headers(settings, role="operator"),
        )

    assert resp.status_code == 200
    body = resp.json()
    assert "Kadambur Fringe" in body["reply"]
    assert body["model"] == "gemini-4-hydrogen"
    assert body["read_only"] is True
    assert "get_high_risk_villages" in body["tools_used"]
    assert len(body["sources"]) == 1
    assert body["sources"][0]["record_count"] == 2
    assert any(loc["label"] == "Kadambur Fringe" for loc in body["map_locations"])
    assert secret_api_key not in json.dumps(body)

    # Verify history and tool response were cleanly passed to Gemini
    assert len(captured_requests) == 2
    assert len(captured_requests[0]["contents"]) == 3  # 2 history turns + 1 current turn
    fn_resp_parts = captured_requests[1]["contents"][-1]["parts"]
    assert fn_resp_parts[0]["functionResponse"]["name"] == "get_high_risk_villages"
    assert fn_resp_parts[0]["functionResponse"]["response"]["villages"][0]["village_name"] == "Kadambur Fringe"


@pytest.mark.parametrize(
    ("upstream_code", "upstream_body", "expected_http"),
    [
        (429, {"error": {"status": "RESOURCE_EXHAUSTED"}}, 429),
        (403, {"error": {"status": "PERMISSION_DENIED"}}, 502),
        (404, {"error": {"status": "NOT_FOUND"}}, 502),
        (500, {"error": {"status": "INTERNAL"}}, 502),
    ],
)
def test_gemini_upstream_errors_mapped_gracefully_and_never_leak_key(
    db_session: Session,
    caplog: pytest.LogCaptureFixture,
    upstream_code: int,
    upstream_body: dict[str, Any],
    expected_http: int,
) -> None:
    secret_key = "AIza-super-secret-error-check-112233"
    settings = make_test_settings(gemini_api_key=secret_key, gemini_model="gemini-4-hydrogen")
    mock_http = httpx.Client(
        transport=httpx.MockTransport(lambda _req: httpx.Response(upstream_code, json=upstream_body))
    )
    service = GeminiAssistantService(settings, http_client=mock_http)

    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[assistant_routes._get_assistant_service_dep] = lambda: service

    with caplog.at_level(logging.WARNING):
        with TestClient(app) as tc:
            resp = tc.post(
                "/api/v1/assistant/chat",
                json={"message": "Summarize today's wildlife intelligence."},
                headers=auth_headers(settings, role="reviewer"),
            )

    assert resp.status_code == expected_http
    assert secret_key not in resp.text
    combined_logs = "\n".join(rec.getMessage() for rec in caplog.records)
    assert secret_key not in combined_logs


def test_gemini_timeout_returns_504(db_session: Session) -> None:
    settings = make_test_settings(gemini_api_key="test-key-timeout")

    def _timeout_handler(_req: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("Timed out")

    service = GeminiAssistantService(
        settings, http_client=httpx.Client(transport=httpx.MockTransport(_timeout_handler))
    )
    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[assistant_routes._get_assistant_service_dep] = lambda: service

    with TestClient(app) as tc:
        resp = tc.post(
            "/api/v1/assistant/chat",
            json={"message": "Show recent sightings."},
            headers=auth_headers(settings, role="admin"),
        )
    assert resp.status_code == 504


def test_assistant_chat_rate_limiting_enforced(db_session: Session) -> None:
    settings = make_test_settings(
        gemini_api_key=None,
        assistant_rate_limit_requests=2,
        assistant_rate_limit_window_seconds=60,
    )
    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session
    headers = auth_headers(settings, role="operator")

    with TestClient(app) as tc:
        r1 = tc.post("/api/v1/assistant/chat", json={"message": "Q1"}, headers=headers)
        r2 = tc.post("/api/v1/assistant/chat", json={"message": "Q2"}, headers=headers)
        r3 = tc.post("/api/v1/assistant/chat", json={"message": "Q3"}, headers=headers)
        assert r1.status_code == 503
        assert r2.status_code == 503
        assert r3.status_code == 429
