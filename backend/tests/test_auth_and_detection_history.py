"""Comprehensive tests for Phase 1-3 Auth, Email Recovery, and Animal Detection History Management."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import io
import logging
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse
import uuid

from fastapi.testclient import TestClient
from PIL import Image
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.routes import auth as auth_routes
from app.api.routes import detections as detections_routes
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import hash_password, verify_password
from app.main import create_application
from app.models.alert import Alert
from app.models.animal_detection import AnimalDetection
from app.models.animal_intelligence import (
    AnimalEmbedding,
    AnimalIdentity,
    IdentityReviewLog,
    ReidMatch,
)
from app.models.sighting import Sighting
from app.models.user import PasswordResetToken, UserAccount
from app.services.email_service import (
    EmailDispatchResult,
    SmtpEmailService,
    build_password_reset_url,
    render_password_reset_email,
)
from app.services.spatial import make_point_geom
from app.services.storage import FilesystemObjectStorage, get_storage_backend
from tests.conftest import auth_headers, make_test_settings, make_test_token


class RecordingEmailService(SmtpEmailService):
    """Captures outgoing password reset emails without opening external SMTP sockets."""

    def __init__(self, settings):
        super().__init__(settings)
        self.sent: list[dict[str, Any]] = []

    def send_password_reset_email(
        self,
        *,
        to_email: str,
        display_name: str,
        reset_url: str,
        expire_minutes: int,
    ) -> EmailDispatchResult:
        subject, text_body, html_body = render_password_reset_email(
            display_name=display_name,
            reset_url=reset_url,
            expire_minutes=expire_minutes,
        )
        self.sent.append(
            {
                "from_email": self.settings.smtp_from_email,
                "to_email": to_email,
                "display_name": display_name,
                "reset_url": reset_url,
                "expire_minutes": expire_minutes,
                "subject": subject,
                "html_body": html_body,
                "text_body": text_body,
            }
        )
        return EmailDispatchResult(sent=True, provider="test_spy")


def _extract_reset_token(reset_url: str) -> str:
    parsed = urlparse(reset_url)
    qs = parse_qs(parsed.query)
    assert parsed.path.endswith("/reset-password")
    assert "token" in qs and len(qs["token"]) == 1
    return qs["token"][0]


def _make_jpeg_bytes(color: tuple[int, int, int] = (34, 139, 34)) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (320, 240), color=color)
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


class _StubDetectionPipeline:
    """Fast deterministic stand-in for MegaDetector + SpeciesNet during history tests."""

    def analyze_image(
        self,
        pil_image: Any,
        *,
        image_key: str,
        country_code: str | None = None,
        admin1_region: str | None = None,
    ) -> dict[str, Any]:
        return {
            "processing_status": "completed",
            "detection_count": 1,
            "animal_count": 1,
            "primary_species": "Asian Elephant",
            "primary_common_name": "Asian Elephant",
            "primary_scientific_name": "Elephas maximus",
            "primary_confidence": 0.94,
            "country_code": country_code,
            "admin1_region": admin1_region,
            "detector_model": "stub-megadetector",
            "classifier_model": "stub-speciesnet",
            "inference_duration_ms": 12,
            "detections": [
                {
                    "index": 1,
                    "category": "animal",
                    "detector_confidence": 0.96,
                    "bbox": {
                        "xmin": 0.1,
                        "ymin": 0.15,
                        "width": 0.5,
                        "height": 0.6,
                        "pixel_xmin": 32,
                        "pixel_ymin": 36,
                        "pixel_width": 160,
                        "pixel_height": 144,
                    },
                    "species_label": "Asian Elephant",
                    "common_name": "Asian Elephant",
                    "scientific_name": "Elephas maximus",
                    "taxonomic_level": "species",
                    "taxonomy_raw": "elephas;maximus",
                    "species_confidence": 0.94,
                    "prediction_source": "stub",
                    "needs_review": False,
                    "top_candidates": [
                        {
                            "species_label": "Asian Elephant",
                            "common_name": "Asian Elephant",
                            "scientific_name": "Elephas maximus",
                            "confidence": 0.94,
                        }
                    ],
                }
            ],
            "model_metadata": {
                "detector_model": "stub-megadetector",
                "classifier_model": "stub-speciesnet",
                "speciesnet_version": "4.0.3a-stub",
                "geofence_enabled": bool(country_code),
                "country_code": country_code,
                "admin1_region": admin1_region,
                "min_detection_confidence": 0.2,
                "min_species_confidence": 0.5,
                "thermal_imagery_supported": False,
                "imagery_notice": "Stub test pipeline",
                "reid_enabled": False,
            },
        }


# ---------------------------------------------------------------------------
# PHASE 1 & 2 TESTS: Registration, Login, RBAC, Forgot/Reset Password, SMTP
# ---------------------------------------------------------------------------


def test_public_registration_hashes_password_enforces_operator_role_and_blocks_duplicates(
    anon_client: TestClient,
    db_session: Session,
) -> None:
    # Reject privilege escalation attempt via extra role field
    esc_resp = anon_client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Sneaky Admin",
            "email": "sneaky@forest.gov.in",
            "password": "StrongPassword123!",
            "confirm_password": "StrongPassword123!",
            "role": "admin",
        },
    )
    assert esc_resp.status_code == 422

    # Reject mismatched confirmation password
    mismatch_resp = anon_client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Field Ranger",
            "email": "ranger1@forest.gov.in",
            "password": "StrongPassword123!",
            "confirm_password": "DifferentPassword123!",
        },
    )
    assert mismatch_resp.status_code == 422

    # Valid registration creates active operator account
    reg_resp = anon_client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Aarav Sharma",
            "email": "Aarav.Sharma@Forest.Gov.In",
            "password": "ForestPassword#2026",
            "confirm_password": "ForestPassword#2026",
        },
    )
    assert reg_resp.status_code == 201, reg_resp.text
    reg_data = reg_resp.json()
    assert reg_data["email"] == "aarav.sharma@forest.gov.in"
    assert reg_data["role"] == "operator"
    assert reg_data["is_active"] is True
    assert reg_data["requires_approval"] is False

    # Verify password is securely hashed (never stored plaintext)
    stored = db_session.execute(
        select(UserAccount).where(UserAccount.email == "aarav.sharma@forest.gov.in")
    ).scalar_one()
    assert stored.password_hash != "ForestPassword#2026"
    assert stored.password_hash.startswith("pbkdf2_sha256$")
    assert verify_password("ForestPassword#2026", stored.password_hash)

    # Duplicate email registration must fail with 409 Conflict
    dup_resp = anon_client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Duplicate Ranger",
            "email": "aarav.sharma@forest.gov.in",
            "password": "AnotherPassword#2026",
            "confirm_password": "AnotherPassword#2026",
        },
    )
    assert dup_resp.status_code == 409

    # Login with invalid password fails (401)
    bad_login = anon_client.post(
        "/api/v1/auth/login",
        json={"identifier": "aarav.sharma@forest.gov.in", "password": "WrongPassword!"},
    )
    assert bad_login.status_code == 401

    # Login with valid password succeeds (200)
    good_login = anon_client.post(
        "/api/v1/auth/login",
        json={"identifier": "aarav.sharma@forest.gov.in", "password": "ForestPassword#2026"},
    )
    assert good_login.status_code == 200
    token = good_login.json()["access_token"]
    assert good_login.json()["user"]["role"] == "operator"

    # Self-registered operator cannot access admin-only routes
    admin_users_resp = anon_client.get(
        "/api/v1/auth/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert admin_users_resp.status_code == 403

    admin_db_health = anon_client.get(
        "/api/v1/health/database",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert admin_db_health.status_code == 403


def test_registration_admin_approval_workflow_when_enabled(db_session: Session) -> None:
    settings = make_test_settings(auth_require_admin_approval=True)
    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session

    with TestClient(app) as tc:
        reg_resp = tc.post(
            "/api/v1/auth/register",
            json={
                "full_name": "Pending Analyst",
                "email": "pending@forest.gov.in",
                "password": "PendingPassword123!",
                "confirm_password": "PendingPassword123!",
            },
        )
        assert reg_resp.status_code == 201
        body = reg_resp.json()
        assert body["role"] == "operator"
        assert body["is_active"] is False
        assert body["requires_approval"] is True
        user_id = body["id"]

        # Login blocked until admin activates account
        blocked_login = tc.post(
            "/api/v1/auth/login",
            json={"identifier": "pending@forest.gov.in", "password": "PendingPassword123!"},
        )
        assert blocked_login.status_code == 403

        # Admin approves (activates) account
        admin_hdrs = auth_headers(settings, role="admin")
        approve_resp = tc.patch(
            f"/api/v1/auth/users/{user_id}",
            json={"is_active": True},
            headers=admin_hdrs,
        )
        assert approve_resp.status_code == 200
        assert approve_resp.json()["is_active"] is True

        # Now login succeeds
        ok_login = tc.post(
            "/api/v1/auth/login",
            json={"identifier": "pending@forest.gov.in", "password": "PendingPassword123!"},
        )
        assert ok_login.status_code == 200


def test_forgot_and_reset_password_full_security_lifecycle(db_session: Session) -> None:
    settings = make_test_settings(
        smtp_from_email="developer21.nextupgrad@gmail.com",
        frontend_base_url="http://localhost:3000",
        password_reset_token_expire_minutes=20,
    )
    email_spy = RecordingEmailService(settings)
    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[auth_routes._get_email_service_dep] = lambda: email_spy

    user = UserAccount(
        email="recovery.officer@forest.gov.in",
        username="recovery.officer",
        display_name="Recovery Officer",
        role="operator",
        password_hash=hash_password("InitialSecret#111"),
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    with TestClient(app) as tc:
        # 1. Unregistered email returns identical generic 200 (no account enumeration)
        unknown_resp = tc.post(
            "/api/v1/auth/forgot-password",
            json={"email": "does-not-exist@forest.gov.in"},
        )
        assert unknown_resp.status_code == 200
        assert len(email_spy.sent) == 0

        # 2. Registered email returns identical generic 200 and sends branded email
        known_resp = tc.post(
            "/api/v1/auth/forgot-password",
            json={"email": "recovery.officer@forest.gov.in"},
        )
        assert known_resp.status_code == 200
        assert known_resp.json()["message"] == unknown_resp.json()["message"]
        assert len(email_spy.sent) == 1

        dispatched = email_spy.sent[0]
        assert dispatched["from_email"] == "developer21.nextupgrad@gmail.com"
        assert dispatched["to_email"] == "recovery.officer@forest.gov.in"
        assert "WICPS" in dispatched["html_body"]
        assert "20 minutes" in dispatched["html_body"]
        assert "Reset WICPS Password" in dispatched["html_body"]
        raw_token = _extract_reset_token(dispatched["reset_url"])

        # 3. Verify token is hashed in DB (raw token never stored)
        token_row = db_session.execute(
            select(PasswordResetToken).where(PasswordResetToken.user_id == user.id)
        ).scalar_one()
        assert token_row.token_hash != raw_token
        assert token_row.token_hash == hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        assert token_row.used_at is None

        # 4. Validate token endpoint returns valid=True for active token and valid=False for bogus token
        val_ok = tc.post("/api/v1/auth/reset-password/validate", json={"token": raw_token})
        assert val_ok.status_code == 200
        assert val_ok.json()["valid"] is True

        val_bad = tc.post(
            "/api/v1/auth/reset-password/validate",
            json={"token": "invalid-token-value-1234567890"},
        )
        assert val_bad.status_code == 200
        assert val_bad.json()["valid"] is False

        # 5. Reset password with valid token succeeds
        reset_resp = tc.post(
            "/api/v1/auth/reset-password",
            json={
                "token": raw_token,
                "new_password": "NewStrongPassword#999",
                "confirm_password": "NewStrongPassword#999",
            },
        )
        assert reset_resp.status_code == 200

        # 6. Token reuse is blocked (400)
        reuse_resp = tc.post(
            "/api/v1/auth/reset-password",
            json={
                "token": raw_token,
                "new_password": "AnotherPassword#888",
                "confirm_password": "AnotherPassword#888",
            },
        )
        assert reuse_resp.status_code == 400

        # 7. Old password fails, new password succeeds
        old_login = tc.post(
            "/api/v1/auth/login",
            json={"identifier": "recovery.officer@forest.gov.in", "password": "InitialSecret#111"},
        )
        assert old_login.status_code == 401

        new_login = tc.post(
            "/api/v1/auth/login",
            json={
                "identifier": "recovery.officer@forest.gov.in",
                "password": "NewStrongPassword#999",
            },
        )
        assert new_login.status_code == 200

        # 8. Expired token is rejected both by validate and reset endpoints
        expired_raw = "expired-token-secret-value-abcdef123456"
        expired_row = PasswordResetToken(
            user_id=user.id,
            token_hash=hashlib.sha256(expired_raw.encode("utf-8")).hexdigest(),
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        )
        db_session.add(expired_row)
        db_session.commit()

        val_exp = tc.post("/api/v1/auth/reset-password/validate", json={"token": expired_raw})
        assert val_exp.status_code == 200
        assert val_exp.json()["valid"] is False

        reset_exp = tc.post(
            "/api/v1/auth/reset-password",
            json={
                "token": expired_raw,
                "new_password": "ShouldNotWork#123",
                "confirm_password": "ShouldNotWork#123",
            },
        )
        assert reset_exp.status_code == 400


def test_smtp_failure_is_graceful_and_never_logs_secrets_or_tokens(
    caplog: pytest.LogCaptureFixture,
) -> None:
    secret_pwd = "super-secret-gmail-app-password-xyz"
    raw_token = "raw-reset-token-must-never-appear-in-logs-987654"
    settings = make_test_settings(
        smtp_host="127.0.0.1",
        smtp_port=1,  # Unreachable port to force graceful SMTP failure
        smtp_username="developer21.nextupgrad@gmail.com",
        smtp_password=secret_pwd,
        smtp_from_email="developer21.nextupgrad@gmail.com",
        smtp_timeout_seconds=1,
    )
    service = SmtpEmailService(settings)
    reset_url = build_password_reset_url("http://localhost:3000", raw_token)

    with caplog.at_level(logging.WARNING):
        result = service.send_password_reset_email(
            to_email="officer@forest.gov.in",
            display_name="Officer One",
            reset_url=reset_url,
            expire_minutes=20,
        )

    assert result.sent is False
    assert result.reason
    combined_logs = "\n".join(rec.getMessage() for rec in caplog.records)
    assert secret_pwd not in combined_logs
    assert raw_token not in combined_logs


def test_password_reset_rate_limiting_enforced(db_session: Session) -> None:
    settings = make_test_settings(
        auth_password_reset_rate_limit_requests=2,
        auth_password_reset_rate_limit_window_seconds=60,
    )
    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[auth_routes._get_email_service_dep] = lambda: RecordingEmailService(settings)

    with TestClient(app) as tc:
        r1 = tc.post("/api/v1/auth/forgot-password", json={"email": "a@example.com"})
        r2 = tc.post("/api/v1/auth/forgot-password", json={"email": "b@example.com"})
        r3 = tc.post("/api/v1/auth/forgot-password", json={"email": "c@example.com"})
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r3.status_code == 429


# ---------------------------------------------------------------------------
# PHASE 3 TESTS: Animal Detection History Delete, Clear All, RBAC & Integrity
# ---------------------------------------------------------------------------


def _build_detection_test_app(db_session: Session, tmp_path: Path):
    settings = make_test_settings(
        storage_backend="filesystem",
        local_storage_dir=str(tmp_path / "storage"),
        megadescriptor_enabled=False,
    )
    storage = FilesystemObjectStorage(settings.local_storage_dir)
    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_storage_backend] = lambda: storage
    return app, settings, storage


def test_detection_history_upload_pagination_single_delete_and_clear_all(
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        detections_routes, "get_animal_detection_pipeline", lambda _s: _StubDetectionPipeline()
    )
    app, settings, storage = _build_detection_test_app(db_session, tmp_path)

    admin_hdrs = auth_headers(settings, role="admin")
    jpg_bytes = _make_jpeg_bytes()

    with TestClient(app) as tc:
        # Upload 3 detection images
        created_ids: list[str] = []
        created_keys: list[str] = []
        for idx in range(3):
            resp = tc.post(
                "/api/v1/detections/upload",
                headers=admin_hdrs,
                files={"file": (f"elephant_{idx}.jpg", jpg_bytes, "image/jpeg")},
                data={"auto_create_sighting": "false"},
            )
            assert resp.status_code == 201, resp.text
            body = resp.json()
            created_ids.append(body["id"])
            created_keys.append(body["image_object_key"])
            assert storage.exists(body["image_object_key"])

        # Paginated listing returns all 3 with eligible_clear_count=3 and can_delete=True
        page1 = tc.get("/api/v1/detections?page=1&page_size=2", headers=admin_hdrs)
        assert page1.status_code == 200
        p1 = page1.json()
        assert p1["total"] == 3
        assert p1["total_pages"] == 2
        assert len(p1["items"]) == 2
        assert p1["eligible_clear_count"] == 3
        assert all(item["can_delete"] is True for item in p1["items"])

        # Delete ONE specific detection record
        target_id = created_ids[1]
        target_key = created_keys[1]
        del_resp = tc.delete(
            f"/api/v1/detections/{target_id}?reason=Duplicate+camera+test",
            headers=admin_hdrs,
        )
        assert del_resp.status_code == 200, del_resp.text
        del_body = del_resp.json()
        assert del_body["status"] == "archived"
        assert del_body["id"] == target_id
        assert del_body["storage_cleaned"] is True

        # Storage for unreferenced deleted record was cleaned post-commit; unrelated remain intact
        assert not storage.exists(target_key)
        assert storage.exists(created_keys[0])
        assert storage.exists(created_keys[2])

        # Soft-delete audit trail preserved in DB
        db_session.expire_all()
        archived_row = db_session.get(AnimalDetection, uuid.UUID(target_id))
        assert archived_row is not None
        assert archived_row.is_deleted is True
        assert archived_row.deleted_at is not None
        assert archived_row.deleted_by is not None
        assert archived_row.deletion_reason == "Duplicate camera test"

        # Deleted record no longer appears in history listing or default GET
        after_single = tc.get("/api/v1/detections", headers=admin_hdrs).json()
        remaining_ids = [item["id"] for item in after_single["items"]]
        assert target_id not in remaining_ids
        assert created_ids[0] in remaining_ids
        assert created_ids[2] in remaining_ids
        assert after_single["total"] == 2

        get_archived = tc.get(f"/api/v1/detections/{target_id}", headers=admin_hdrs)
        assert get_archived.status_code == 404

        # Clear All remaining eligible records
        clear_resp = tc.delete("/api/v1/detections", headers=admin_hdrs)
        assert clear_resp.status_code == 200, clear_resp.text
        clear_body = clear_resp.json()
        assert clear_body["cleared_count"] == 2
        assert clear_body["skipped_unauthorized_count"] == 0
        assert clear_body["storage_objects_cleaned"] == 2
        assert not storage.exists(created_keys[0])
        assert not storage.exists(created_keys[2])

        after_clear = tc.get("/api/v1/detections", headers=admin_hdrs).json()
        assert after_clear["total"] == 0
        assert after_clear["items"] == []
        assert after_clear["eligible_clear_count"] == 0


def test_detection_delete_preserves_linked_sightings_alerts_reid_and_evidence_storage(
    db_session: Session,
    tmp_path: Path,
) -> None:
    app, settings, storage = _build_detection_test_app(db_session, tmp_path)
    admin_hdrs = auth_headers(settings, role="admin")

    # Store real image and crop objects
    source_key = "detections/2026/01/evidence_tiger.jpg"
    crop_key = "reid_crops/2026/01/evidence_tiger_crop.jpg"
    storage.put_bytes(source_key, _make_jpeg_bytes((200, 100, 30)), "image/jpeg")
    storage.put_bytes(crop_key, _make_jpeg_bytes((220, 120, 40)), "image/jpeg")

    # Create linked Sighting, Alert, AnimalIdentity, AnimalDetection, AnimalEmbedding, ReidMatch, ReviewLog
    now_utc = datetime.now(timezone.utc)
    point_geom = make_point_geom(11.662, 76.628, is_postgres=False)
    sighting = Sighting(
        sighting_code="SGT-TEST-001",
        species="Tiger",
        timestamp=now_utc,
        latitude=11.662,
        longitude=76.628,
        geom=point_geom,
        location_name="Mangala East Fireline",
        district="Bandipur Division",
        forest_range="Gundlupet Range",
        herd_size=1,
        movement_direction="North-East",
        bearing_degrees=45,
        behavior="Normal",
        juveniles_present=False,
        observation_details="Camera trap capture",
        observer_name="WICPS Automated Detection",
        observer_role="Automated Vision",
        verified_by_forest_guard=False,
        is_demo=False,
    )
    alert = Alert(
        title="Tiger Activity Near Mangala",
        message="High-confidence tiger detection",
        severity="Critical",
        species="Tiger",
        affected_village="Mangala",
        district="Bandipur Division",
        latitude=11.662,
        longitude=76.628,
        geom=point_geom,
        alert_time="2026-01-10 08:00 UTC",
        triggered_at=now_utc,
        response_status="Pending",
        is_demo=False,
    )
    identity = AnimalIdentity(
        animal_code="TGR-001",
        species="Tiger",
        species_family="tiger",
        scientific_name="Panthera tigris",
        species_prefix="TGR",
        status="active",
        verification_status="verified",
        primary_crop_object_key=crop_key,
        first_seen_at=datetime.now(timezone.utc),
        last_seen_at=datetime.now(timezone.utc),
        total_sightings=1,
        reference_image_count=1,
    )
    db_session.add_all([sighting, alert, identity])
    db_session.flush()

    detection = AnimalDetection(
        source_filename="evidence_tiger.jpg",
        content_type="image/jpeg",
        file_size_bytes=1234,
        width=320,
        height=240,
        image_object_key=source_key,
        processing_status="completed",
        detection_count=1,
        animal_count=1,
        primary_species="Tiger",
        primary_common_name="Tiger",
        primary_scientific_name="Panthera tigris",
        primary_confidence=0.95,
        generated_sighting_id=sighting.id,
        generated_alert_ids=[str(alert.id)],
        detector_model="md",
        classifier_model="sn",
        inference_duration_ms=25,
        detections=[],
    )
    db_session.add(detection)
    db_session.flush()

    embedding = AnimalEmbedding(
        detection_id=detection.id,
        detection_item_index=1,
        animal_identity_id=identity.id,
        crop_object_key=crop_key,
        species="Tiger",
        species_family="tiger",
        model_name="MegaDescriptor-T-224",
        model_version="1.0",
        embedding_dim=768,
        embedding=[0.1] * 16,
        crop_width=120,
        crop_height=120,
        blur_score=140.0,
        quality_passed=True,
        is_reference=True,
    )
    db_session.add(embedding)
    db_session.flush()

    match = ReidMatch(
        detection_id=detection.id,
        embedding_id=embedding.id,
        detection_item_index=1,
        species="Tiger",
        matched_animal_id=identity.id,
        similarity_score=0.92,
        decision="matched",
        review_status="auto_confirmed",
        top_candidates=[],
        model_version="1.0",
        thresholds_snapshot={},
    )
    db_session.add(match)
    db_session.flush()

    review_log = IdentityReviewLog(
        match_id=match.id,
        animal_identity_id=identity.id,
        action="confirm",
        reviewed_by="admin@wicps.test",
        reason="Verified stripe pattern",
    )
    db_session.add(review_log)
    db_session.commit()

    with TestClient(app) as tc:
        del_resp = tc.delete(f"/api/v1/detections/{detection.id}", headers=admin_hdrs)
        assert del_resp.status_code == 200, del_resp.text
        del_body = del_resp.json()
        assert del_body["storage_cleaned"] is False
        assert del_body["storage_preserved_reason"] is not None

    # Verify linked wildlife records and storage files are 100% preserved!
    db_session.expire_all()
    assert db_session.get(Sighting, sighting.id) is not None
    assert db_session.get(Alert, alert.id) is not None
    assert db_session.get(AnimalIdentity, identity.id) is not None
    assert db_session.get(AnimalEmbedding, embedding.id) is not None
    assert db_session.get(ReidMatch, match.id) is not None
    assert db_session.get(IdentityReviewLog, review_log.id) is not None
    assert storage.exists(source_key)
    assert storage.exists(crop_key)


def test_detection_delete_rbac_operator_vs_reviewer_vs_admin_and_unauthenticated(
    db_session: Session,
    tmp_path: Path,
) -> None:
    app, settings, storage = _build_detection_test_app(db_session, tmp_path)

    op1 = UserAccount(
        email="op1@forest.gov.in",
        username="op1",
        display_name="Operator One",
        role="operator",
        password_hash=hash_password("OpPassword#1"),
        is_active=True,
    )
    op2 = UserAccount(
        email="op2@forest.gov.in",
        username="op2",
        display_name="Operator Two",
        role="operator",
        password_hash=hash_password("OpPassword#2"),
        is_active=True,
    )
    db_session.add_all([op1, op2])
    db_session.commit()
    db_session.refresh(op1)
    db_session.refresh(op2)

    def _create_det(owner_id: uuid.UUID, filename: str) -> AnimalDetection:
        key = f"detections/rbac/{uuid.uuid4().hex}_{filename}"
        storage.put_bytes(key, _make_jpeg_bytes(), "image/jpeg")
        row = AnimalDetection(
            source_filename=filename,
            content_type="image/jpeg",
            file_size_bytes=500,
            width=320,
            height=240,
            image_object_key=key,
            processing_status="no_animal_detected",
            detection_count=0,
            animal_count=0,
            detector_model="md",
            classifier_model="sn",
            inference_duration_ms=10,
            detections=[],
            uploaded_by_user_id=owner_id,
        )
        db_session.add(row)
        db_session.commit()
        db_session.refresh(row)
        return row

    d_op1_a = _create_det(op1.id, "op1_a.jpg")
    d_op1_b = _create_det(op1.id, "op1_b.jpg")
    d_op2_a = _create_det(op2.id, "op2_a.jpg")

    op1_hdrs = {
        "Authorization": f"Bearer {make_test_token(settings, role='operator', subject=str(op1.id), email=op1.email, user_id=op1.id)}"
    }
    reviewer_hdrs = auth_headers(settings, role="reviewer")

    with TestClient(app) as tc:
        # Unauthenticated delete & clear rejected (401)
        assert tc.delete(f"/api/v1/detections/{d_op1_a.id}").status_code == 401
        assert tc.delete("/api/v1/detections").status_code == 401

        # Operator 1 sees eligible_clear_count == 2 (only their own uploads)
        list_op1 = tc.get("/api/v1/detections", headers=op1_hdrs).json()
        assert list_op1["total"] == 3
        assert list_op1["eligible_clear_count"] == 2
        can_delete_map = {item["id"]: item["can_delete"] for item in list_op1["items"]}
        assert can_delete_map[str(d_op1_a.id)] is True
        assert can_delete_map[str(d_op1_b.id)] is True
        assert can_delete_map[str(d_op2_a.id)] is False

        # Operator 1 CANNOT delete Operator 2's record (403)
        forbidden = tc.delete(f"/api/v1/detections/{d_op2_a.id}", headers=op1_hdrs)
        assert forbidden.status_code == 403

        # Operator 1 CAN delete their own record (200)
        own_del = tc.delete(f"/api/v1/detections/{d_op1_a.id}", headers=op1_hdrs)
        assert own_del.status_code == 200

        # Operator 1 Clear All only clears their own remaining record (skips op2's record)
        op1_clear = tc.delete("/api/v1/detections", headers=op1_hdrs)
        assert op1_clear.status_code == 200
        clear_data = op1_clear.json()
        assert clear_data["cleared_count"] == 1
        assert clear_data["skipped_unauthorized_count"] == 1

        # Reviewer can delete Operator 2's remaining record
        rev_del = tc.delete(f"/api/v1/detections/{d_op2_a.id}", headers=reviewer_hdrs)
        assert rev_del.status_code == 200


def test_detection_delete_rolls_back_and_preserves_storage_on_db_commit_failure(
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, settings, storage = _build_detection_test_app(db_session, tmp_path)
    admin_hdrs = auth_headers(settings, role="admin")

    key = "detections/rollback/test_rollback.jpg"
    storage.put_bytes(key, _make_jpeg_bytes(), "image/jpeg")
    det = AnimalDetection(
        source_filename="test_rollback.jpg",
        content_type="image/jpeg",
        file_size_bytes=500,
        width=320,
        height=240,
        image_object_key=key,
        processing_status="no_animal_detected",
        detection_count=0,
        animal_count=0,
        detector_model="md",
        classifier_model="sn",
        inference_duration_ms=10,
        detections=[],
    )
    db_session.add(det)
    db_session.commit()
    db_session.refresh(det)

    def _failing_commit():
        raise RuntimeError("Simulated database commit failure")

    monkeypatch.setattr(db_session, "commit", _failing_commit)

    with TestClient(app) as tc:
        resp = tc.delete(f"/api/v1/detections/{det.id}", headers=admin_hdrs)
        assert resp.status_code == 500

    # Storage must remain completely untouched because DB commit rolled back
    assert storage.exists(key)
    db_session.expire_all()
    reloaded = db_session.get(AnimalDetection, det.id)
    assert reloaded is not None
    assert reloaded.is_deleted is False
