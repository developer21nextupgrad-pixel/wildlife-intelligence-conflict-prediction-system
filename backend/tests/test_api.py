from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.database import get_db
from app.main import create_application


def test_health_endpoints(seeded_client: TestClient):
    res = seeded_client.get("/api/v1/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["telemetry_coords_exposed"] is False

    db_res = seeded_client.get("/api/v1/health/database")
    assert db_res.status_code == 200
    db_body = db_res.json()
    assert db_body["connected"] is True
    assert db_body["counts"]["incidents"] == 7
    assert db_body["counts"]["sightings"] == 5
    assert db_body["counts"]["villages"] == 7
    assert db_body["counts"]["risk_zones"] == 4
    assert db_body["counts"]["alerts"] == 4
    assert db_body["counts"]["patrols"] == 5
    assert db_body["counts"]["telemetry_records"] == 2


def test_incident_crud_lifecycle(client: TestClient):
    payload = {
        "species": "Asian Elephant",
        "date_time": datetime.now(timezone.utc).isoformat(),
        "latitude": 11.6655,
        "longitude": 76.6211,
        "village": "Kadambur Fringe",
        "district": "Bandipur Division",
        "forest_range": "Hediyala Range (Beat 4)",
        "incident_type": "Crop Depredation",
        "severity": "High",
        "human_injury": "None",
        "human_injuries_count": 0,
        "livestock_loss_count": 0,
        "crop_damage_estimated_acres": 1.5,
        "description": "Elephant crossed solar fence near paddy plot.",
        "status": "Reported",
        "reported_by": "Beat Guard Test Officer",
    }

    create_res = client.post("/api/v1/incidents", json=payload)
    assert create_res.status_code == 201
    created = create_res.json()
    assert created["is_demo"] is False
    assert created["incident_code"].startswith("WICPS-2026-")
    inc_id = created["id"]

    get_res = client.get(f"/api/v1/incidents/{inc_id}")
    assert get_res.status_code == 200
    assert get_res.json()["village"] == "Kadambur Fringe"

    update_res = client.put(
        f"/api/v1/incidents/{inc_id}",
        json={"status": "Patrol Dispatched", "assigned_officer": "RFO S. Kumar"},
    )
    assert update_res.status_code == 200
    assert update_res.json()["status"] == "Patrol Dispatched"
    assert update_res.json()["assigned_officer"] == "RFO S. Kumar"

    del_res = client.delete(f"/api/v1/incidents/{inc_id}")
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "deleted"

    missing_res = client.get(f"/api/v1/incidents/{inc_id}")
    assert missing_res.status_code == 404


def test_sighting_crud_lifecycle(client: TestClient):
    payload = {
        "species": "Bengal Tiger",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "latitude": 11.6375,
        "longitude": 76.5812,
        "location_name": "Omkar Stream Crossing",
        "district": "Bandipur Division",
        "forest_range": "Omkar Range",
        "herd_size": 1,
        "movement_direction": "South-East",
        "behavior": "Foraging",
        "juveniles_present": False,
        "observation_details": "Fresh pugmarks and direct visual near bamboo.",
        "observer_name": "Biologist S. Patil",
        "observer_role": "Wildlife Biologist",
        "verified_by_forest_guard": True,
    }

    create_res = client.post("/api/v1/sightings", json=payload)
    assert create_res.status_code == 201
    created = create_res.json()
    assert created["bearing_degrees"] == 135
    assert created["is_demo"] is False
    sighting_id = created["id"]

    update_res = client.put(
        f"/api/v1/sightings/{sighting_id}",
        json={"movement_direction": "West", "herd_size": 2},
    )
    assert update_res.status_code == 200
    assert update_res.json()["bearing_degrees"] == 270
    assert update_res.json()["herd_size"] == 2

    del_res = client.delete(f"/api/v1/sightings/{sighting_id}")
    assert del_res.status_code == 200


def test_village_crud_lifecycle(client: TestClient):
    payload = {
        "name": "Test Fringe Hamlet",
        "district": "Bandipur Division",
        "forest_range": "Hediyala Range",
        "population": 450,
        "households": 95,
        "forest_distance_km": 0.4,
        "latitude": 11.667,
        "longitude": 76.621,
        "risk_level": "High",
        "risk_score": 74,
        "active_solar_fence": True,
        "fence_status": "Operational",
        "assigned_rrt": "QRT-1",
        "emergency_contact": "+91 821 000 0000",
        "recent_incidents_30d": 1,
    }
    res = client.post("/api/v1/villages", json=payload)
    assert res.status_code == 201
    vid = res.json()["id"]

    upd = client.put(f"/api/v1/villages/{vid}", json={"fence_status": "Breached"})
    assert upd.status_code == 200
    assert upd.json()["fence_status"] == "Breached"

    assert client.delete(f"/api/v1/villages/{vid}").status_code == 200


def test_alert_and_patrol_crud_lifecycles(client: TestClient):
    alert_res = client.post(
        "/api/v1/alerts",
        json={
            "title": "HIGH: Tusker Spotted Near Boundary",
            "message": "Visual confirmation near Hediyala boundary line.",
            "severity": "High",
            "species": "Asian Elephant",
            "affected_village": "Kadambur Fringe",
            "district": "Bandipur Division",
            "latitude": 11.662,
            "longitude": 76.618,
        },
    )
    assert alert_res.status_code == 201
    alert = alert_res.json()
    assert alert["acknowledged"] is False
    assert alert["is_demo"] is False

    ack_res = client.put(
        f"/api/v1/alerts/{alert['id']}",
        json={
            "title": "CRITICAL: Updated Alert Title",
            "message": "Updated field verification message.",
            "severity": "Critical",
            "acknowledged": True,
            "acknowledged_by": "DFO Test",
            "response_status": "RRT En Route",
            "assigned_officer": "RFO Suresh Kumar",
        },
    )
    assert ack_res.status_code == 200
    assert ack_res.json()["title"] == "CRITICAL: Updated Alert Title"
    assert ack_res.json()["severity"] == "Critical"
    assert ack_res.json()["acknowledged"] is True
    assert ack_res.json()["acknowledged_at"] is not None
    assert ack_res.json()["response_status"] == "RRT En Route"
    assert client.delete(f"/api/v1/alerts/{alert['id']}").status_code == 200

    patrol_res = client.post(
        "/api/v1/patrols",
        json={
            "team_name": "Night Intercept Alpha",
            "lead_officer": "Capt. K. Ravindran",
            "target_area": "Kadambur Pylon 54",
            "sector": "Hediyala Range",
            "district": "Bandipur Division",
            "priority": "Critical",
            "status": "Scheduled",
            "scheduled_window": "20:00 - 04:00 IST",
            "active_personnel": 5,
            "equipment": ["Thermal Scope", "VHF Radio"],
            "risk_rationale": "Monitor crop fringe.",
            "approved_by": "DFO Bandipur",
            "latitude": 11.664,
            "longitude": 76.620,
        },
    )
    assert patrol_res.status_code == 201
    patrol = patrol_res.json()
    assert patrol["is_demo"] is False

    patrol_upd = client.put(
        f"/api/v1/patrols/{patrol['id']}",
        json={"status": "In Progress"},
    )
    assert patrol_upd.status_code == 200
    assert patrol_upd.json()["status"] == "In Progress"
    assert client.delete(f"/api/v1/patrols/{patrol['id']}").status_code == 200


def test_invalid_coordinates_and_missing_fields_rejected(client: TestClient):
    invalid_lat = client.post(
        "/api/v1/incidents",
        json={
            "species": "Asian Elephant",
            "date_time": datetime.now(timezone.utc).isoformat(),
            "latitude": 95.5,
            "longitude": 76.6,
            "village": "Kadambur",
            "district": "Bandipur Division",
            "forest_range": "Hediyala Range",
            "incident_type": "Crop Depredation",
            "severity": "High",
            "description": "Invalid latitude test",
            "reported_by": "Tester",
        },
    )
    assert invalid_lat.status_code == 422

    invalid_lng = client.post(
        "/api/v1/sightings",
        json={
            "species": "Asian Elephant",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "latitude": 11.66,
            "longitude": -182.0,
            "location_name": "Stream Checkdam",
            "forest_range": "Hediyala Range",
            "herd_size": 2,
            "observation_details": "Invalid longitude test",
            "observer_name": "Guard",
            "observer_role": "Forest Guard",
        },
    )
    assert invalid_lng.status_code == 422

    missing_fields = client.post(
        "/api/v1/incidents",
        json={
            "species": "Asian Elephant",
            "latitude": 11.66,
            "longitude": 76.62,
            "village": "   ",
            "description": "",
        },
    )
    assert missing_fields.status_code == 422


def test_pagination_division_and_date_filters(client: TestClient):
    now = datetime.now(timezone.utc)
    records = [
        ("Hediyala Range", "Kadambur Fringe", "Reported", now - timedelta(hours=2)),
        ("Hediyala Range", "Solakarai Settlement", "Verified", now - timedelta(days=3)),
        ("Maddur Range", "Berambadi Village", "Resolved", now - timedelta(days=12)),
        ("Omkar Range", "Omkar Forest Fringe", "Closed", now - timedelta(days=45)),
    ]
    for idx, (rng, village, status_val, dt) in enumerate(records):
        res = client.post(
            "/api/v1/incidents",
            json={
                "species": "Asian Elephant",
                "date_time": dt.isoformat(),
                "latitude": 11.66 + idx * 0.01,
                "longitude": 76.61 + idx * 0.01,
                "village": village,
                "district": "Bandipur Division",
                "forest_range": rng,
                "incident_type": "Village Incursion",
                "severity": "Moderate",
                "description": f"Filter test incident {idx}",
                "status": status_val,
                "reported_by": "Tester",
            },
        )
        assert res.status_code == 201

    page1 = client.get("/api/v1/incidents?page=1&page_size=2")
    assert page1.status_code == 200
    p1_data = page1.json()
    assert p1_data["total"] == 4
    assert p1_data["total_pages"] == 2
    assert len(p1_data["items"]) == 2

    hediyala = client.get("/api/v1/incidents?division=Hediyala Range")
    assert hediyala.status_code == 200
    assert hediyala.json()["total"] == 2

    last_7d = client.get("/api/v1/incidents?date_range=Last 7 Days")
    assert last_7d.status_code == 200
    assert last_7d.json()["total"] == 2

    last_30d = client.get("/api/v1/incidents?date_range=Last 30 Days")
    assert last_30d.status_code == 200
    assert last_30d.json()["total"] == 3

    status_filtered = client.get("/api/v1/incidents?status=Verified")
    assert status_filtered.status_code == 200
    assert status_filtered.json()["total"] == 1


def test_gis_geojson_endpoints_and_telemetry_protection(seeded_client: TestClient):
    features_res = seeded_client.get("/api/v1/gis/features")
    assert features_res.status_code == 200
    fc = features_res.json()
    assert fc["type"] == "FeatureCollection"
    assert fc["crs"] == "EPSG:4326"
    assert fc["count"] == len(fc["features"]) > 0

    layers_present = {f["properties"]["layer"] for f in fc["features"]}
    assert "incidents" in layers_present
    assert "risk_zones" in layers_present
    assert "telemetry" not in layers_present
    assert "telemetry_records" not in layers_present

    rz_res = seeded_client.get("/api/v1/gis/risk-zones")
    assert rz_res.status_code == 200
    rz_fc = rz_res.json()
    assert rz_fc["type"] == "FeatureCollection"
    assert rz_fc["count"] == 4
    first_poly = rz_fc["features"][0]["geometry"]
    assert first_poly["type"] == "Polygon"
    ring = first_poly["coordinates"][0]
    assert ring[0] == ring[-1]  # closed polygon ring
    assert ring[0][0] > 70  # longitude first in GeoJSON [lng, lat]
    assert ring[0][1] < 20  # latitude second

    nearby_res = seeded_client.get(
        "/api/v1/gis/nearby-incidents?lat=11.6624&lng=76.6189&radius_km=3.0"
    )
    assert nearby_res.status_code == 200
    nearby_fc = nearby_res.json()
    assert nearby_fc["type"] == "FeatureCollection"
    assert nearby_fc["count"] >= 1
    assert nearby_fc["features"][0]["properties"]["distance_km"] <= 3.0


def test_demo_flag_distinguishes_seed_from_operational(seeded_client: TestClient):
    seeded = seeded_client.get("/api/v1/incidents?is_demo=true")
    assert seeded.status_code == 200
    assert seeded.json()["total"] == 7

    created_res = seeded_client.post(
        "/api/v1/incidents",
        json={
            "species": "Asian Elephant",
            "date_time": datetime.now(timezone.utc).isoformat(),
            "latitude": 11.665,
            "longitude": 76.619,
            "village": "Kadambur Fringe",
            "district": "Bandipur Division",
            "forest_range": "Hediyala Range",
            "incident_type": "Crop Depredation",
            "severity": "High",
            "description": "Operational field report",
            "reported_by": "RFO Suresh Kumar",
        },
    )
    assert created_res.status_code == 201
    assert created_res.json()["is_demo"] is False

    op_only = seeded_client.get("/api/v1/incidents?is_demo=false")
    assert op_only.status_code == 200
    assert op_only.json()["total"] == 1


def test_rate_limiting_middleware(db_session):
    from conftest import auth_headers, make_test_settings

    settings = make_test_settings(
        rate_limit_requests=3,
        rate_limit_window_seconds=60,
    )
    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session

    with TestClient(app) as limited_client:
        limited_client.headers.update(auth_headers(settings, role="operator"))
        for _ in range(3):
            assert limited_client.get("/api/v1/incidents").status_code == 200
        blocked = limited_client.get("/api/v1/incidents")
        assert blocked.status_code == 429
        assert blocked.json()["error"] == "rate_limit_exceeded"


def test_cors_and_private_network_access_preflight(db_session):
    from conftest import make_test_settings

    approved_preview_origin = "https://ais-dev-n6jtdm2fq5bfuarlmbgcjx-731993532283.asia-northeast1.run.app"
    settings = make_test_settings(
        cors_origins=f"http://localhost:3000,{approved_preview_origin}"
    )
    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as cors_client:
        preflight = cors_client.options(
            "/api/v1/health",
            headers={
                "Origin": approved_preview_origin,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        assert preflight.status_code == 200
        assert preflight.headers.get("access-control-allow-origin") == approved_preview_origin
        assert preflight.headers.get("access-control-allow-private-network") == "true"

        local_get = cors_client.get("/api/v1/health", headers={"Origin": "http://localhost:3000"})
        assert local_get.status_code == 200
        assert local_get.headers.get("access-control-allow-origin") == "http://localhost:3000"

        disallowed = cors_client.options(
            "/api/v1/health",
            headers={
                "Origin": "https://untrusted-origin.example.com",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        assert disallowed.status_code == 400
        assert disallowed.headers.get("access-control-allow-origin") is None
    app.dependency_overrides.clear()


def test_village_id_resolution_on_create_and_update(seeded_client: TestClient):
    villages_res = seeded_client.get("/api/v1/villages")
    assert villages_res.status_code == 200
    villages_by_name = {v["name"]: v["id"] for v in villages_res.json()["items"]}
    kadambur_id = villages_by_name["Kadambur Fringe"]
    mangala_id = villages_by_name["Mangala Settlement"]

    # 1. Incident resolves village_id on create and re-resolves on update
    inc_res = seeded_client.post(
        "/api/v1/incidents",
        json={
            "species": "Asian Elephant",
            "date_time": datetime.now(timezone.utc).isoformat(),
            "latitude": 11.664,
            "longitude": 76.622,
            "village": "Kadambur Fringe",
            "district": "Bandipur Division",
            "forest_range": "Hediyala Range",
            "incident_type": "Crop Depredation",
            "severity": "High",
            "human_injuries_count": 1,
            "livestock_loss_count": 2,
            "description": "FK resolution incident test.",
            "reported_by": "Tester",
        },
    )
    assert inc_res.status_code == 201
    inc = inc_res.json()
    assert inc["village_id"] == kadambur_id

    inc_upd = seeded_client.put(
        f"/api/v1/incidents/{inc['id']}",
        json={"village": "Mangala Settlement", "human_injuries_count": 2},
    )
    assert inc_upd.status_code == 200
    assert inc_upd.json()["village_id"] == mangala_id
    assert inc_upd.json()["human_injuries_count"] == 2
    assert seeded_client.delete(f"/api/v1/incidents/{inc['id']}").status_code == 200

    # 2. Alert resolves village_id on create and re-resolves when affected_village changes
    alert_res = seeded_client.post(
        "/api/v1/alerts",
        json={
            "title": "FK Test Alert",
            "message": "Boundary alert test.",
            "severity": "High",
            "species": "Asian Elephant",
            "affected_village": "Kadambur Fringe",
            "district": "Bandipur Division",
            "latitude": 11.664,
            "longitude": 76.622,
        },
    )
    assert alert_res.status_code == 201
    alert = alert_res.json()
    assert alert["village_id"] == kadambur_id

    alert_upd = seeded_client.put(
        f"/api/v1/alerts/{alert['id']}",
        json={"affected_village": "Mangala Settlement"},
    )
    assert alert_upd.status_code == 200
    assert alert_upd.json()["village_id"] == mangala_id
    assert seeded_client.delete(f"/api/v1/alerts/{alert['id']}").status_code == 200

    # 3. Patrol resolves village_id from target_area / sector on create and update
    patrol_res = seeded_client.post(
        "/api/v1/patrols",
        json={
            "team_name": "QRT FK Test",
            "lead_officer": "RFO Rao",
            "target_area": "Kadambur Pylon 54",
            "sector": "Hediyala Range",
            "district": "Bandipur Division",
            "priority": "High",
            "status": "Scheduled",
            "scheduled_window": "20:00 - 04:00 IST",
            "active_personnel": 4,
            "equipment": ["Thermal Scope"],
            "risk_rationale": "Night patrol FK verification.",
            "approved_by": "DFO",
            "latitude": 11.664,
            "longitude": 76.622,
        },
    )
    assert patrol_res.status_code == 201
    patrol = patrol_res.json()
    assert patrol["village_id"] == kadambur_id

    patrol_upd = seeded_client.put(
        f"/api/v1/patrols/{patrol['id']}",
        json={"target_area": "Mangala - Gundlupet Buffer", "sector": "Gundlupet Buffer"},
    )
    assert patrol_upd.status_code == 200
    assert patrol_upd.json()["village_id"] == mangala_id
    assert seeded_client.delete(f"/api/v1/patrols/{patrol['id']}").status_code == 200

    # 4. Explicit nonexistent village_id is rejected with 422
    bad_patrol = seeded_client.post(
        "/api/v1/patrols",
        json={
            "team_name": "QRT Invalid FK",
            "lead_officer": "RFO Rao",
            "target_area": "Kadambur Pylon 54",
            "sector": "Hediyala Range",
            "district": "Bandipur Division",
            "village_id": "00000000-0000-0000-0000-000000000099",
            "priority": "High",
            "status": "Scheduled",
            "scheduled_window": "20:00 - 04:00 IST",
            "active_personnel": 4,
            "equipment": [],
            "risk_rationale": "Invalid FK test.",
            "approved_by": "DFO",
            "latitude": 11.664,
            "longitude": 76.622,
        },
    )
    assert bad_patrol.status_code == 422

