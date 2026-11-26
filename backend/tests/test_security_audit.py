from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import socket
import sys
import uuid

if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
import cv2
from fastapi.testclient import TestClient
import jwt
import numpy as np
import pytest
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from conftest import TEST_JWT_SECRET, auth_headers, make_test_settings, make_test_token
from app.core.config import Settings
from app.core.database import get_db
from app.main import create_application
from app.models import (
    AnimalDetection,
    AnimalEmbedding,
    AnimalIdentity,
    Camera,
    IdentityReviewLog,
    IotEventRecord,
    ReidMatch,
    ThermalFrame,
)
from app.services.frame_processor import test_pull_rtsp_stream as pull_rtsp_stream
from app.services.frame_processor import validate_rtsp_url_safe
from app.services.reid_service import find_similar_individuals, normalize_species_family
from app.services.storage import FilesystemObjectStorage, get_storage_backend


def _png_bytes(width: int = 320, height: int = 240) -> bytes:
    y, x = np.mgrid[0:height, 0:width]
    arr = np.clip(45 + 140 * np.exp(-(((x - 160) ** 2) + ((y - 120) ** 2)) / (2 * 24.0**2)), 0, 255).astype(
        np.uint8
    )
    ok, buf = cv2.imencode(".png", arr)
    assert ok
    return buf.tobytes()


def test_unauthenticated_requests_rejected_while_public_health_and_auth_status_open(
    anon_client: TestClient,
    test_settings: Settings,
):
    assert anon_client.get("/api/v1/health").status_code == 200
    status_res = anon_client.get("/api/v1/auth/status")
    assert status_res.status_code == 200
    status_body = status_res.json()
    assert status_body["authenticated"] is False
    assert status_body["user"] is None
    assert status_body["auth_enabled"] is True

    # Malformed or expired bearer tokens on /auth/status return HTTP 200 with authenticated=False
    bad_status = anon_client.get(
        "/api/v1/auth/status",
        headers={"Authorization": "Bearer not-a-valid-jwt"},
    )
    assert bad_status.status_code == 200
    assert bad_status.json()["authenticated"] is False
    assert bad_status.json()["user"] is None

    now_ts = int(datetime.now(timezone.utc).timestamp())
    expired_token = jwt.encode(
        {
            "sub": "expired-user",
            "email": "expired@forest.gov.in",
            "name": "Expired Officer",
            "role": "admin",
            "roles": ["admin"],
            "iss": test_settings.auth_jwt_issuer,
            "aud": test_settings.auth_jwt_audience,
            "iat": now_ts - 600,
            "exp": now_ts - 60,
        },
        TEST_JWT_SECRET,
        algorithm="HS256",
    )
    expired_status = anon_client.get(
        "/api/v1/auth/status",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert expired_status.status_code == 200
    assert expired_status.json()["authenticated"] is False
    assert expired_status.json()["user"] is None

    # Wrong signing secret on /auth/status also returns authenticated=False
    wrong_sig_token = jwt.encode(
        {
            "sub": "forged-user",
            "role": "admin",
            "roles": ["admin"],
            "iss": test_settings.auth_jwt_issuer,
            "aud": test_settings.auth_jwt_audience,
            "iat": now_ts,
            "exp": now_ts + 300,
        },
        "completely-wrong-secret-key-not-matching-server-config",
        algorithm="HS256",
    )
    wrong_sig_status = anon_client.get(
        "/api/v1/auth/status",
        headers={"Authorization": f"Bearer {wrong_sig_token}"},
    )
    assert wrong_sig_status.status_code == 200
    assert wrong_sig_status.json()["authenticated"] is False
    assert wrong_sig_status.json()["user"] is None

    protected_gets = [
        "/api/v1/auth/me",
        "/api/v1/auth/users",
        "/api/v1/health/database",
        "/api/v1/health/storage",
        "/api/v1/incidents",
        "/api/v1/sightings",
        "/api/v1/alerts",
        "/api/v1/patrols",
        "/api/v1/villages",
        "/api/v1/gis/features",
        "/api/v1/cameras",
        "/api/v1/ingest/frames",
        "/api/v1/detections",
        "/api/v1/animal-intelligence/animals",
        "/api/v1/animal-intelligence/matches",
        "/api/v1/animal-intelligence/alert-rules",
        "/api/v1/iot/events",
    ]
    for path in protected_gets:
        res = anon_client.get(path)
        assert res.status_code == 401, f"Expected 401 on GET {path}, got {res.status_code}"

    # Invalid/malformed and expired bearer tokens are rejected with 401 on protected routes
    bad_res = anon_client.get(
        "/api/v1/incidents",
        headers={"Authorization": "Bearer not-a-valid-jwt"},
    )
    assert bad_res.status_code == 401

    expired_res = anon_client.get(
        "/api/v1/incidents",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert expired_res.status_code == 401


def test_auth_bootstrap_login_user_provisioning_and_rbac_enforcement(
    anon_client: TestClient,
):
    # First non-prod run needs initial setup
    st = anon_client.get("/api/v1/auth/status").json()
    assert st["needs_initial_setup"] is True

    boot = anon_client.post(
        "/api/v1/auth/bootstrap-admin",
        json={
            "email": "dfo-admin@forest.gov.in",
            "display_name": "DFO Division Lead",
            "password": "StrongAdminPassword!1",
        },
    )
    assert boot.status_code == 201
    admin_token = boot.json()["access_token"]
    assert boot.json()["user"]["role"] == "admin"

    # Bootstrap locks permanently once first user exists
    second_boot = anon_client.post(
        "/api/v1/auth/bootstrap-admin",
        json={
            "email": "attacker@evil.example",
            "display_name": "Attacker",
            "password": "AnotherPassword123",
        },
    )
    assert second_boot.status_code == 403

    admin_hdrs = {"Authorization": f"Bearer {admin_token}"}
    assert anon_client.get("/api/v1/auth/me", headers=admin_hdrs).status_code == 200

    # Authenticated /auth/status returns HTTP 200 with authenticated=True and safe user profile (no password_hash)
    auth_status_admin = anon_client.get("/api/v1/auth/status", headers=admin_hdrs)
    assert auth_status_admin.status_code == 200
    auth_status_body = auth_status_admin.json()
    assert auth_status_body["authenticated"] is True
    assert auth_status_body["needs_initial_setup"] is False
    assert auth_status_body["user"]["email"] == "dfo-admin@forest.gov.in"
    assert auth_status_body["user"]["role"] == "admin"
    assert "password_hash" not in auth_status_body["user"]

    # Admin provisions operator & reviewer accounts
    op_create = anon_client.post(
        "/api/v1/auth/users",
        headers=admin_hdrs,
        json={
            "email": "beat-operator@forest.gov.in",
            "display_name": "Beat Operator",
            "role": "operator",
            "password": "OperatorPassword!1",
        },
    )
    assert op_create.status_code == 201
    op_id = op_create.json()["id"]

    rev_create = anon_client.post(
        "/api/v1/auth/users",
        headers=admin_hdrs,
        json={
            "email": "bio-reviewer@forest.gov.in",
            "display_name": "Biologist Reviewer",
            "role": "reviewer",
            "password": "ReviewerPassword!1",
        },
    )
    assert rev_create.status_code == 201

    # Wrong password returns 401
    bad_login = anon_client.post(
        "/api/v1/auth/login",
        json={"identifier": "beat-operator@forest.gov.in", "password": "wrong-password"},
    )
    assert bad_login.status_code == 401

    op_token = anon_client.post(
        "/api/v1/auth/login",
        json={"identifier": "beat-operator@forest.gov.in", "password": "OperatorPassword!1"},
    ).json()["access_token"]
    rev_token = anon_client.post(
        "/api/v1/auth/login",
        json={"identifier": "bio-reviewer@forest.gov.in", "password": "ReviewerPassword!1"},
    ).json()["access_token"]

    op_hdrs = {"Authorization": f"Bearer {op_token}"}
    rev_hdrs = {"Authorization": f"Bearer {rev_token}"}

    # Operator authenticated status check returns safe operator profile
    op_status = anon_client.get("/api/v1/auth/status", headers=op_hdrs)
    assert op_status.status_code == 200
    assert op_status.json()["authenticated"] is True
    assert op_status.json()["user"]["role"] == "operator"

    # Operator can read operational endpoints, cannot access admin endpoints or Re-ID review
    assert anon_client.get("/api/v1/incidents", headers=op_hdrs).status_code == 200
    assert anon_client.get("/api/v1/health/database", headers=op_hdrs).status_code == 403
    assert anon_client.get("/api/v1/health/storage", headers=op_hdrs).status_code == 403
    assert anon_client.get("/api/v1/auth/users", headers=op_hdrs).status_code == 403
    assert (
        anon_client.post(
            "/api/v1/cameras",
            headers=op_hdrs,
            json={
                "camera_code": "CAM-UNAUTH-01",
                "name": "Unauthorized Camera",
                "zone_name": "Test Zone",
                "zone_type": "crop_field",
                "latitude": 11.66,
                "longitude": 76.62,
                "protocol": "http_push",
            },
        ).status_code
        == 403
    )
    assert (
        anon_client.post(
            f"/api/v1/animal-intelligence/matches/{uuid.uuid4()}/review",
            headers=op_hdrs,
            json={"action": "confirm"},
        ).status_code
        == 403
    )

    # Reviewer cannot call admin-only endpoints
    assert anon_client.get("/api/v1/auth/users", headers=rev_hdrs).status_code == 403
    assert anon_client.get("/api/v1/health/database", headers=rev_hdrs).status_code == 403

    # Deactivating user blocks subsequent logins and revokes /auth/status authenticated state
    deact = anon_client.patch(
        f"/api/v1/auth/users/{op_id}",
        headers=admin_hdrs,
        json={"is_active": False},
    )
    assert deact.status_code == 200
    deact_status = anon_client.get("/api/v1/auth/status", headers=op_hdrs)
    assert deact_status.status_code == 200
    assert deact_status.json()["authenticated"] is False
    assert deact_status.json()["user"] is None
    assert (
        anon_client.post(
            "/api/v1/auth/login",
            json={"identifier": "beat-operator@forest.gov.in", "password": "OperatorPassword!1"},
        ).status_code
        == 403
    )


def test_oidc_rs256_jwks_verification_and_role_claims(db_session, monkeypatch):
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()
    pem_private = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )

    class FakeSigningKey:
        def __init__(self, key):
            self.key = key

    class FakeJWKClient:
        def __init__(self, *args, **kwargs):
            pass

        def get_signing_key_from_jwt(self, token):
            return FakeSigningKey(public_key)

    monkeypatch.setattr("app.core.security._get_jwk_client", lambda url: FakeJWKClient(url))

    settings = Settings(
        environment="test",
        auth_enabled=True,
        auth_jwt_secret=None,
        auth_oidc_issuer="https://idp.forest.example.org/",
        auth_oidc_audience="wicps-api",
        auth_oidc_jwks_url="https://idp.forest.example.org/.well-known/jwks.json",
        auth_role_claim="realm_access.roles",
    )
    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session

    now_ts = int(datetime.now(timezone.utc).timestamp())
    oidc_token = jwt.encode(
        {
            "sub": "oidc-user-42",
            "email": "wildlife.biologist@forest.example.org",
            "name": "Dr. OIDC Biologist",
            "iss": "https://idp.forest.example.org/",
            "aud": "wicps-api",
            "iat": now_ts,
            "exp": now_ts + 300,
            "realm_access": {"roles": ["reviewer"]},
        },
        pem_private,
        algorithm="RS256",
        headers={"kid": "test-kid-1"},
    )

    with TestClient(app) as tc:
        me_res = tc.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {oidc_token}"})
        assert me_res.status_code == 200
        body = me_res.json()
        assert body["auth_method"] == "oidc_jwks"
        assert body["role"] == "reviewer"
        assert "operator" in body["effective_roles"]
        assert "reviewer" in body["effective_roles"]

        # Reviewer OIDC token still blocked from admin endpoints
        assert (
            tc.get("/api/v1/health/database", headers={"Authorization": f"Bearer {oidc_token}"}).status_code
            == 403
        )
    app.dependency_overrides.clear()


def test_production_mode_blocks_dev_endpoints_wildcard_cors_and_missing_auth_secrets(
    db_session, tmp_path: Path, monkeypatch
):
    # Wildcard CORS & missing JWT/OIDC secrets rejected
    with pytest.raises(RuntimeError, match="AUTH_JWT_SECRET"):
        Settings(
            environment="production",
            database_url="postgresql+psycopg://u:p@ep-test.neon.tech/wicps?sslmode=require",
            storage_backend="s3",
            s3_bucket="wicps-prod",
            cors_origins="https://wicps.example.com",
        ).validate_production_requirements()

    with pytest.raises(RuntimeError, match="wildcard"):
        Settings(
            environment="production",
            database_url="postgresql+psycopg://u:p@ep-test.neon.tech/wicps?sslmode=require",
            storage_backend="s3",
            s3_bucket="wicps-prod",
            auth_jwt_secret=TEST_JWT_SECRET,
            cors_origins="*",
        ).validate_production_requirements()

    with pytest.raises(RuntimeError, match="explicit allowed frontend origins"):
        Settings(
            environment="production",
            database_url="postgresql+psycopg://u:p@ep-test.neon.tech/wicps?sslmode=require",
            storage_backend="s3",
            s3_bucket="wicps-prod",
            auth_jwt_secret=TEST_JWT_SECRET,
            cors_origins="",
        ).validate_production_requirements()

    # In production app instance: dev endpoints return 403, docs/openapi disabled, unlisted Vercel CORS rejected
    class DummyS3:
        backend_name = "s3"

        def put_bytes(self, object_key, data, content_type="application/octet-stream"):
            return object_key

        def get_bytes(self, object_key):
            return b""

        def exists(self, object_key):
            return True

        def delete(self, object_key):
            return None

        def verify_access(self):
            return {"backend": "s3", "reachable": True, "bucket": "wicps-prod"}

    prod_settings = Settings(
        environment="production",
        database_url="postgresql+psycopg://u:p@ep-test.neon.tech/wicps?sslmode=require",
        storage_backend="s3",
        s3_bucket="wicps-prod",
        auth_jwt_secret=TEST_JWT_SECRET,
        cors_origins="https://wicps-prod.example.com",
        auto_seed_demo_data=False,
    )
    app = create_application(prod_settings)
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_storage_backend] = lambda: DummyS3()

    admin_hdrs = auth_headers(prod_settings, role="admin")
    with TestClient(app) as prod_client:
        assert prod_client.get("/docs").status_code == 404
        assert prod_client.get("/openapi.json").status_code == 404

        assert (
            prod_client.post(
                "/api/v1/auth/bootstrap-admin",
                json={"email": "a@b.com", "display_name": "A", "password": "StrongPassword123"},
            ).status_code
            == 403
        )
        assert (
            prod_client.post(
                "/api/v1/iot/events/dev-test",
                headers=admin_hdrs,
                json={"device_code": "CAM-1", "species": "Tiger", "confidence": 0.9, "risk_level": "High"},
            ).status_code
            == 403
        )
        assert (
            prod_client.post(
                "/api/v1/ingest/dev-sample",
                headers=admin_hdrs,
                files={"file": ("sample.png", _png_bytes(), "image/png")},
            ).status_code
            == 403
        )
        assert (
            prod_client.post(
                "/api/v1/ingest/rtsp/test-pull",
                headers=admin_hdrs,
                json={"rtsp_url": "rtsp://camera.example.org:554/stream"},
            ).status_code
            == 403
        )

        # Unlisted Vercel preview origin blocked by CORS
        bad_cors = prod_client.options(
            "/api/v1/health",
            headers={
                "Origin": "https://unapproved-preview.vercel.app",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert bad_cors.status_code == 400
    app.dependency_overrides.clear()


def test_rtsp_ssrf_blocks_private_loopback_metadata_and_preserves_env(monkeypatch):
    blocked_urls = [
        "rtsp://127.0.0.1:554/live",
        "rtsp://localhost:554/live",
        "rtsp://[::1]:554/live",
        "rtsp://10.0.0.5:554/live",
        "rtsp://192.168.1.50:554/live",
        "rtsp://172.16.4.2:554/live",
        "rtsp://169.254.169.254/latest/meta-data",
        "rtsp://metadata.google.internal/computeMetadata",
        "rtsp://internal-camera.local/stream",
    ]
    for url in blocked_urls:
        with pytest.raises(ValueError, match="SSRF protection"):
            validate_rtsp_url_safe(url)

    # Hostname resolving via DNS to RFC1918 private IP is also rejected
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda host, port, type=None: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.20.30.40", port))],
    )
    with pytest.raises(ValueError, match="non-public IP"):
        validate_rtsp_url_safe("rtsp://cam.example.com:554/live")

    # Confirm process-wide OPENCV_FFMPEG_CAPTURE_OPTIONS is never mutated
    prev_env = os.environ.get("OPENCV_FFMPEG_CAPTURE_OPTIONS")
    with pytest.raises(Exception):
        pull_rtsp_stream(
            "rtsp://127.0.0.1:19554/live",
            timeout_seconds=1.0,
            allowed_hosts={"127.0.0.1"},
        )
    assert os.environ.get("OPENCV_FFMPEG_CAPTURE_OPTIONS") == prev_env


def test_device_endpoints_x_camera_key_and_idempotency(
    db_session, tmp_path: Path
):
    storage = FilesystemObjectStorage(tmp_path / "device_store")
    settings = make_test_settings(
        storage_backend="filesystem",
        local_storage_dir=str(tmp_path / "device_store"),
    )
    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_storage_backend] = lambda: storage

    admin_hdrs = auth_headers(settings, role="admin")
    with TestClient(app) as tc:
        cam_res = tc.post(
            "/api/v1/cameras",
            headers=admin_hdrs,
            json={
                "camera_code": "CAM-IDEMP-01",
                "name": "Idempotency Mast",
                "zone_name": "South Boundary",
                "zone_type": "perimeter_boundary",
                "latitude": 11.66,
                "longitude": 76.62,
                "protocol": "http_push",
            },
        )
        assert cam_res.status_code == 201
        cam_id = cam_res.json()["id"]
        cam_key = cam_res.json()["api_key"]

        # Heartbeat works purely with X-Camera-Key (no JWT required)
        hb_res = tc.post(
            f"/api/v1/cameras/{cam_id}/heartbeat",
            headers={"X-Camera-Key": cam_key},
            json={"status": "active"},
        )
        assert hb_res.status_code == 200

        # Dev-test IoT dispatch -> ack with X-Camera-Key (no JWT) -> repeated ack preserves original metadata
        iot_res = tc.post(
            "/api/v1/iot/events/dev-test",
            headers=admin_hdrs,
            json={
                "camera_id": cam_id,
                "device_code": "CAM-IDEMP-01",
                "species": "Asian Elephant",
                "confidence": 0.91,
                "risk_level": "High",
            },
        )
        assert iot_res.status_code == 201
        evt_id = iot_res.json()["id"]

        ack1 = tc.post(
            f"/api/v1/iot/events/{evt_id}/acknowledge",
            headers={"X-Camera-Key": cam_key},
            json={"acknowledged_by": "Edge Unit Alpha", "ack_note": "Initial ack"},
        )
        assert ack1.status_code == 200
        first_ack_ts = ack1.json()["acknowledged_at"]
        assert ack1.json()["acknowledged_by"] == "Edge Unit Alpha"
        assert ack1.json()["ack_note"] == "Initial ack"

        ack2 = tc.post(
            f"/api/v1/iot/events/{evt_id}/acknowledge",
            headers={"X-Camera-Key": cam_key},
            json={"acknowledged_by": "Spoofed Retry", "ack_note": "Overwrite attempt"},
        )
        assert ack2.status_code == 200
        assert ack2.json()["acknowledged_at"] == first_ack_ts
        assert ack2.json()["acknowledged_by"] == "Edge Unit Alpha"
        assert ack2.json()["ack_note"] == "Initial ack"

        # POST /ingest/frames works with X-Camera-Key (no JWT) and deduplicates both by Idempotency-Key and (cam, seq, ts)
        img_bytes = _png_bytes()
        meta_ts = "2026-11-23T08:00:00Z"
        meta_json = json.dumps(
            {
                "camera_id": "CAM-IDEMP-01",
                "timestamp": meta_ts,
                "frame_format": "png",
                "sequence_number": 7,
            }
        )
        f1 = tc.post(
            "/api/v1/ingest/frames",
            headers={"X-Camera-Key": cam_key, "Idempotency-Key": "edge-frame-007"},
            files={"file": ("frame7.png", img_bytes, "image/png")},
            data={"metadata": meta_json},
        )
        assert f1.status_code == 201
        frame_id = f1.json()["id"]

        # Replay via identical Idempotency-Key -> 200 OK, same frame ID, no duplicate DB rows
        f2 = tc.post(
            "/api/v1/ingest/frames",
            headers={"X-Camera-Key": cam_key, "Idempotency-Key": "edge-frame-007"},
            files={"file": ("frame7.png", img_bytes, "image/png")},
            data={"metadata": meta_json},
        )
        assert f2.status_code == 200
        assert f2.json()["id"] == frame_id

        # Replay without Idempotency-Key but same (camera_id, sequence_number, timestamp) -> 200 OK
        f3 = tc.post(
            "/api/v1/ingest/frames",
            headers={"X-Camera-Key": cam_key},
            files={"file": ("frame7.png", img_bytes, "image/png")},
            data={"metadata": meta_json},
        )
        assert f3.status_code == 200
        assert f3.json()["id"] == frame_id

        frames_count = len(db_session.execute(select(ThermalFrame)).scalars().all())
        assert frames_count == 1
    app.dependency_overrides.clear()


def test_reid_review_derives_reviewed_by_from_verified_jwt_claims(db_session):
    settings = make_test_settings()
    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session

    det = AnimalDetection(
        source_filename="tiger.jpg",
        image_object_key="detections/tiger.jpg",
        content_type="image/jpeg",
        file_size_bytes=1234,
        width=640,
        height=480,
        detection_count=1,
        animal_count=1,
        primary_species="Bengal Tiger",
        processing_status="completed",
        detector_model="MegaDetector-v5a",
        classifier_model="SpeciesNet",
        inference_duration_ms=42,
        detections=[],
    )
    db_session.add(det)
    db_session.flush()

    identity = AnimalIdentity(
        animal_code="TIG-001",
        species="Bengal Tiger",
        species_family="tiger",
        species_prefix="TIG",
        total_sightings=1,
        reference_image_count=1,
    )
    db_session.add(identity)
    db_session.flush()

    emb = AnimalEmbedding(
        detection_id=det.id,
        detection_item_index=1,
        animal_identity_id=None,
        crop_object_key="crops/t1.jpg",
        species="Bengal Tiger",
        species_family="tiger",
        model_name="MegaDescriptor-T-224",
        model_version="MegaDescriptor-T-224",
        embedding_dim=768,
        embedding=[1.0] + [0.0] * 767,
        crop_width=224,
        crop_height=224,
        blur_score=60.0,
    )
    db_session.add(emb)
    db_session.flush()

    match = ReidMatch(
        detection_id=det.id,
        embedding_id=emb.id,
        detection_item_index=1,
        species="Bengal Tiger",
        decision="needs_review",
        review_status="pending_review",
        suggested_animal_id=identity.id,
        similarity_score=0.68,
        top_candidates=[],
        model_version="MegaDescriptor-T-224",
    )
    db_session.add(match)
    db_session.commit()

    reviewer_hdrs = auth_headers(
        settings,
        role="reviewer",
        email="dr.kavitha@forest.gov.in",
        display_name="Dr. Kavitha Biologist",
    )
    with TestClient(app) as tc:
        res = tc.post(
            f"/api/v1/animal-intelligence/matches/{match.id}/review",
            headers=reviewer_hdrs,
            json={
                "action": "confirm",
                "reviewed_by": "Spoofed Impersonator Name",
                "reason": "Verified stripe pattern",
                "target_animal_identity_id": str(identity.id),
            },
        )
        assert res.status_code == 200
        body = res.json()
        assert body["review_status"] == "confirmed"
        assert body["matched_animal_id"] == str(identity.id)

        audit_log = db_session.execute(
            select(IdentityReviewLog).where(IdentityReviewLog.match_id == match.id)
        ).scalar_one()
        assert audit_log.reviewed_by == "Dr. Kavitha Biologist (dr.kavitha@forest.gov.in)"
        assert "Spoofed" not in (audit_log.reviewed_by or "")
    app.dependency_overrides.clear()


def test_find_similar_individuals_filters_species_family_in_sql_before_limit(db_session):
    det = AnimalDetection(
        source_filename="mix.jpg",
        image_object_key="detections/mix.jpg",
        content_type="image/jpeg",
        file_size_bytes=100,
        width=200,
        height=200,
        detection_count=1,
        animal_count=1,
        processing_status="completed",
        detector_model="MegaDetector-v5a",
        classifier_model="SpeciesNet",
        inference_duration_ms=25,
        detections=[],
    )
    db_session.add(det)
    db_session.flush()

    ele_id = AnimalIdentity(
        animal_code="ELE-901",
        species="Asian Elephant",
        species_family="elephant",
        species_prefix="ELE",
        total_sightings=1,
        reference_image_count=1,
    )
    tig_id = AnimalIdentity(
        animal_code="TIG-901",
        species="Bengal Tiger",
        species_family="tiger",
        species_prefix="TIG",
        total_sightings=1,
        reference_image_count=1,
    )
    db_session.add_all([ele_id, tig_id])
    db_session.flush()

    vec = [1.0] + [0.0] * 767
    db_session.add_all(
        [
            AnimalEmbedding(
                detection_id=det.id,
                detection_item_index=1,
                animal_identity_id=ele_id.id,
                species="Asian Elephant",
                species_family="elephant",
                model_name="MegaDescriptor-T-224",
                model_version="MegaDescriptor-T-224",
                embedding_dim=768,
                crop_object_key="crops/ele.jpg",
                embedding=vec,
                is_reference=True,
                crop_width=100,
                crop_height=100,
                blur_score=50.0,
            ),
            AnimalEmbedding(
                detection_id=det.id,
                detection_item_index=2,
                animal_identity_id=tig_id.id,
                species="Bengal Tiger",
                species_family="tiger",
                model_name="MegaDescriptor-T-224",
                model_version="MegaDescriptor-T-224",
                embedding_dim=768,
                crop_object_key="crops/tig.jpg",
                embedding=vec,
                is_reference=True,
                crop_width=100,
                crop_height=100,
                blur_score=50.0,
            ),
        ]
    )
    db_session.commit()

    # Cross-species candidate with identical embedding MUST NOT pollute Tiger candidate results
    candidates = find_similar_individuals(
        db_session,
        query_embedding=vec,
        species_label="Bengal Tiger",
        limit=5,
    )
    assert len(candidates) == 1
    assert candidates[0].animal_code == "TIG-901"

    # Also compile the PostgreSQL pgvector query shape to confirm WHERE species_family precedes ORDER BY/LIMIT
    dist_col = AnimalEmbedding.embedding.cosine_distance(vec).label("dist")
    stmt = (
        select(AnimalEmbedding.id, dist_col)
        .join(AnimalIdentity, AnimalEmbedding.animal_identity_id == AnimalIdentity.id)
        .where(
            AnimalEmbedding.is_reference.is_(True),
            AnimalEmbedding.species_family == normalize_species_family("Bengal Tiger")[0],
            AnimalIdentity.species_family == "tiger",
        )
        .order_by(dist_col.asc())
        .limit(25)
    )
    compiled = str(stmt.compile(dialect=postgresql.dialect())).lower()
    assert compiled.index("species_family") < compiled.index("order by") < compiled.index("limit")


def test_database_url_normalization_and_production_alembic_guards(monkeypatch):
    from alembic import command as alembic_command
    from alembic.config import Config as AlembicConfig
    from app.core.database import normalize_database_url

    assert (
        normalize_database_url("postgres://u:p%40ss@ep-demo.neon.tech/neondb?sslmode=require")
        == "postgresql+psycopg://u:p%40ss@ep-demo.neon.tech/neondb?sslmode=require"
    )
    assert (
        normalize_database_url("postgresql://u:p%23ss@ep-demo.neon.tech/neondb?sslmode=require")
        == "postgresql+psycopg://u:p%23ss@ep-demo.neon.tech/neondb?sslmode=require"
    )
    assert (
        normalize_database_url("postgresql+psycopg://u:p@ep-demo.neon.tech/neondb")
        == "postgresql+psycopg://u:p@ep-demo.neon.tech/neondb"
    )
    assert normalize_database_url("sqlite:///./local.db") == "sqlite:///./local.db"

    backend_dir = Path(__file__).resolve().parents[1]
    cfg = AlembicConfig(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "alembic"))

    # Production mode blocks missing, SQLite, or localhost DATABASE_URL
    monkeypatch.setenv("ENVIRONMENT", "production")
    for bad_url in (
        "",
        "sqlite:///./accidental.db",
        "postgresql+psycopg://wicps:pw@localhost:5432/wicps",
        "postgresql://wicps:pw@127.0.0.1:5432/wicps",
    ):
        monkeypatch.setenv("DATABASE_URL", bad_url)
        with pytest.raises(RuntimeError, match="Production migration error"):
            alembic_command.upgrade(cfg, "0005_reid_and_wicps_integ:head", sql=True)

    # Production mode accepts Neon postgresql:// URLs even with percent-encoded passwords
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://neondb_owner:p%40ss%23word@ep-prod-example.neon.tech/neondb?sslmode=require",
    )
    alembic_command.upgrade(cfg, "0005_reid_and_wicps_integ:head", sql=True)


def test_alembic_0006_creates_users_table_preserves_data_and_supports_admin_bootstrap(
    tmp_path: Path,
    monkeypatch,
):
    from alembic import command as alembic_command
    from alembic.config import Config as AlembicConfig
    from sqlalchemy import create_engine, inspect, text
    from sqlalchemy.orm import sessionmaker

    from app.core.security import bootstrap_admin_from_env, verify_password

    backend_dir = Path(__file__).resolve().parents[1]
    db_file = tmp_path / "alembic_0006_verify.db"
    db_url = f"sqlite:///{db_file}"

    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("DATABASE_URL", db_url)

    cfg = AlembicConfig(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "alembic"))

    # Upgrade to 0005 first and seed an existing animal_identities row with a >64-char species label
    alembic_command.upgrade(cfg, "0005_reid_and_wicps_integ")
    long_species = "Rare Unclassified Mountain Herbivore Subspecies With An Extremely Long Taxonomic Descriptor Label"
    eng = create_engine(db_url, future=True)
    with eng.begin() as conn:
        assert "users" not in set(inspect(conn).get_table_names())
        conn.execute(
            text(
                "INSERT INTO animal_identities (id, animal_code, species, species_prefix, status, verification_status, total_sightings) "
                "VALUES (:id, :code, :species, :prefix, 'active', 'provisional', 1)"
            ),
            {
                "id": str(uuid.uuid4()),
                "code": "UNK-001",
                "species": long_species,
                "prefix": "UNK",
            },
        )
    eng.dispose()

    # Now upgrade to 0006_security_reid_idemp and confirm users table + preserved data
    alembic_command.upgrade(cfg, "0006_security_reid_idemp")
    eng2 = create_engine(db_url, future=True)
    insp = inspect(eng2)
    assert "users" in set(insp.get_table_names())
    user_indexes = {idx["name"] for idx in insp.get_indexes("users")}
    assert {"ix_users_email", "ix_users_username", "ix_users_role_active"}.issubset(user_indexes)

    with eng2.connect() as conn:
        ver = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        assert ver == "0006_security_reid_idemp"
        fam = conn.execute(
            text("SELECT species_family FROM animal_identities WHERE animal_code = 'UNK-001'")
        ).scalar_one()
        assert len(fam) <= 64
        assert fam.startswith("rare_unclassified_mountain")

    # Verify idempotent admin bootstrap works on migrated users table
    SessionFactory = sessionmaker(bind=eng2, autoflush=False, autocommit=False)
    settings = make_test_settings(
        auth_bootstrap_admin_email="prod-admin@forest.gov.in",
        auth_bootstrap_admin_password="VeryStrongAdminPassword!2026",
        auth_bootstrap_admin_name="Chief Wildlife Warden",
    )
    with SessionFactory() as session:
        first = bootstrap_admin_from_env(session, settings)
        assert first is not None
        assert first.role == "admin"
        assert first.is_active is True
        assert verify_password("VeryStrongAdminPassword!2026", first.password_hash)
        second = bootstrap_admin_from_env(session, settings)
        assert second is not None
        assert second.id == first.id
    eng2.dispose()

