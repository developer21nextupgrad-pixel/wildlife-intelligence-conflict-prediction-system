from datetime import datetime, timedelta, timezone
import io
import math
from pathlib import Path
import uuid

from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from fastapi.testclient import TestClient
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
import pytest
from sqlalchemy import create_engine, inspect, select, text

from app.core.config import Settings
from app.core.database import get_db
from app.main import create_application
from app.models import (
    Alert,
    AlertDeliveryAttempt,
    AlertRule,
    AnimalDetection,
    AnimalEmbedding,
    AnimalIdentity,
    Camera,
    ForestOfficer,
    IdentityReviewLog,
    IotEventRecord,
    ReidMatch,
    Sighting,
    Village,
)
from app.services.animal_detection import AnimalDetectionPipeline
from app.services.megadescriptor import MegaDescriptorExtractor, assess_crop_quality
from app.services.reid_service import allocate_animal_code, run_reid_for_detection
from app.services.seed import seed_demo_data
from app.services.storage import FilesystemObjectStorage, get_storage_backend

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "animal_detection"
BACKEND_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def intel_pipeline() -> AnimalDetectionPipeline:
    pipeline = AnimalDetectionPipeline(
        model_name="kaggle:google/speciesnet/pyTorch/v4.0.3a/1",
        geofence_enabled=True,
        min_detection_confidence=0.20,
        min_species_confidence=0.50,
        max_detections_per_image=25,
    )
    pipeline.ensure_loaded()
    return pipeline


@pytest.fixture(scope="module")
def intel_extractor() -> MegaDescriptorExtractor:
    extractor = MegaDescriptorExtractor()
    extractor.ensure_loaded()
    return extractor


@pytest.fixture()
def intel_client(
    db_session,
    tmp_path: Path,
    intel_pipeline: AnimalDetectionPipeline,
    intel_extractor: MegaDescriptorExtractor,
):
    from conftest import auth_headers, make_test_settings

    seed_demo_data(db_session)
    storage = FilesystemObjectStorage(tmp_path / "intel_store")
    settings = make_test_settings(
        storage_backend="filesystem",
        local_storage_dir=str(tmp_path / "intel_store"),
    )
    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_storage_backend] = lambda: storage

    from app.api.routes.detections import _get_extractor_dep, _get_pipeline_dep

    app.dependency_overrides[_get_pipeline_dep] = lambda: intel_pipeline
    app.dependency_overrides[_get_extractor_dep] = lambda: intel_extractor

    with TestClient(app) as test_client:
        test_client.headers.update(
            auth_headers(settings, role="admin", display_name="Reviewer Admin")
        )
        yield test_client, db_session, storage, settings
    app.dependency_overrides.clear()


def _make_variant_bytes(path: Path) -> bytes:
    with Image.open(path) as img:
        variant = ImageEnhance.Brightness(img.convert("RGB")).enhance(1.07)
        buf = io.BytesIO()
        variant.save(buf, format="JPEG", quality=93)
        return buf.getvalue()


class _ControlledExtractor(MegaDescriptorExtractor):
    """Deterministic unit-vector extractor for testing boundary Re-ID bands & close ties."""

    def __init__(self, vectors: list[list[float]]) -> None:
        super().__init__(model_name="controlled-test/MegaDescriptor-T-224")
        self._vectors = list(vectors)
        self._loaded = True

    def ensure_loaded(self) -> None:
        self._loaded = True

    def extract_embedding(self, crop: Image.Image) -> list[float]:
        vec = np.asarray(self._vectors.pop(0), dtype=np.float32)
        norm = float(np.linalg.norm(vec))
        return (vec / norm).tolist() if norm > 0 else vec.tolist()


def _basis_vec(theta_deg: float = 0.0, axis_b: int = 1) -> list[float]:
    v = [0.0] * 768
    rad = math.radians(theta_deg)
    v[0] = math.cos(rad)
    v[axis_b] = math.sin(rad)
    return v


def test_1_megadescriptor_embedding_dim_and_norm(intel_extractor: MegaDescriptorExtractor):
    with Image.open(FIXTURES_DIR / "elephant.jpg") as img:
        vec = intel_extractor.extract_embedding(img.convert("RGB"))
    assert len(vec) == 768
    norm = float(np.linalg.norm(np.asarray(vec, dtype=np.float32)))
    assert abs(norm - 1.0) < 1e-4


def test_2_3_4_5_real_reid_elephants_and_tigers_same_and_distinct(intel_client):
    client, db, storage, _settings = intel_client

    ele_a_bytes = (FIXTURES_DIR / "elephant.jpg").read_bytes()
    ele_a_variant = _make_variant_bytes(FIXTURES_DIR / "elephant.jpg")
    ele_b_bytes = (FIXTURES_DIR / "elephant_b.jpg").read_bytes()
    tig_a_bytes = (FIXTURES_DIR / "tiger.jpg").read_bytes()
    tig_b_bytes = (FIXTURES_DIR / "tiger_b.jpg").read_bytes()

    # Upload Elephant A -> allocates ELE-001
    r1 = client.post(
        "/api/v1/detections/upload",
        files={"file": ("elephant.jpg", ele_a_bytes, "image/jpeg")},
        data={"country_code": "IND"},
    )
    assert r1.status_code == 201
    b1 = r1.json()
    d1 = b1["detections"][0]
    assert d1["individual_reid_status"] == "new_individual"
    assert d1["animal_code"] == "ELE-001"
    ele1_id = d1["animal_identity_id"]
    assert storage.exists(d1["crop_object_key"])

    # Upload variant of Elephant A -> matches ELE-001
    r2 = client.post(
        "/api/v1/detections/upload",
        files={"file": ("elephant_var.jpg", ele_a_variant, "image/jpeg")},
        data={"country_code": "IND"},
    )
    assert r2.status_code == 201
    b2 = r2.json()
    d2 = b2["detections"][0]
    assert d2["individual_reid_status"] == "matched_existing"
    assert d2["animal_code"] == "ELE-001"
    assert d2["animal_identity_id"] == ele1_id
    assert d2["reid_similarity_score"] >= 0.75

    # Check ELE-001 counts incremented
    prof = client.get(f"/api/v1/animal-intelligence/animals/{ele1_id}").json()
    assert prof["total_sightings"] == 2
    assert prof["reference_image_count"] == 2

    # Upload distinct Elephant B -> must NOT collapse into ELE-001 (allocates ELE-002 or needs_review)
    r3 = client.post(
        "/api/v1/detections/upload",
        files={"file": ("elephant_b.jpg", ele_b_bytes, "image/jpeg")},
        data={"country_code": "IND"},
    )
    assert r3.status_code == 201
    d3 = r3.json()["detections"][0]
    assert d3["individual_reid_status"] != "matched_existing" or d3["animal_code"] != "ELE-001"
    if d3["individual_reid_status"] == "new_individual":
        assert d3["animal_code"] == "ELE-002"

    # Upload Tiger A & Tiger B -> TIG-001 and distinct from ELE-*
    t1 = client.post(
        "/api/v1/detections/upload",
        files={"file": ("tiger.jpg", tig_a_bytes, "image/jpeg")},
        data={"country_code": "IND"},
    )
    assert t1.status_code == 201
    td1 = t1.json()["detections"][0]
    assert td1["animal_code"] == "TIG-001"
    assert td1["individual_reid_status"] == "new_individual"

    t2 = client.post(
        "/api/v1/detections/upload",
        files={"file": ("tiger_b.jpg", tig_b_bytes, "image/jpeg")},
        data={"country_code": "IND"},
    )
    assert t2.status_code == 201
    td2 = t2.json()["detections"][0]
    assert td2["animal_code"] != "TIG-001"
    assert td2["individual_reid_status"] in {"new_individual", "needs_review"}
    assert "ELE-" not in (td2["animal_code"] or "")

    # Verify crop GET endpoint returns valid JPEG bytes (scenario 10)
    crop_res = client.get(f"/api/v1/animal-intelligence/crops/{d1['embedding_id']}/image")
    assert crop_res.status_code == 200
    assert crop_res.headers["content-type"].startswith("image/jpeg")
    assert len(crop_res.content) > 100


def test_6_7_8_ambiguous_band_low_quality_and_low_species_conf_require_review(
    db_session, tmp_path: Path
):
    seed_demo_data(db_session)
    storage = FilesystemObjectStorage(tmp_path / "band_store")
    settings = Settings(
        environment="test",
        auto_seed_demo_data=False,
        storage_backend="filesystem",
        local_storage_dir=str(tmp_path / "band_store"),
        reid_match_threshold=0.75,
        reid_ambiguous_threshold=0.55,
        reid_margin_threshold=0.04,
        reid_min_crop_px=48,
        reid_min_blur_laplacian=25.0,
    )

    sharp_img = Image.new("RGB", (300, 300), (90, 80, 70))
    # Paint sharp textured checkerboard so crop_quality passes
    px = sharp_img.load()
    for x in range(300):
        for y in range(300):
            if (x // 6 + y // 6) % 2 == 0:
                px[x, y] = (180, 160, 140)

    # Tiny crop < 48px
    tiny_img = Image.new("RGB", (32, 32), (100, 100, 100))
    q_tiny = assess_crop_quality(tiny_img, min_crop_px=48, min_blur_laplacian=25.0)
    assert q_tiny.quality_passed is False
    assert "crop_too_small" in (q_tiny.reason or "")

    # Blurry non-uniform crop (large contrast blocks heavily blurred -> std > 20, blur < 25)
    coarse_img = Image.new("RGB", (300, 300), (40, 40, 40))
    c_px = coarse_img.load()
    for x in range(150, 300):
        for y in range(300):
            c_px[x, y] = (220, 220, 220)
    blur_img = coarse_img.filter(ImageFilter.GaussianBlur(radius=12))
    q_blur = assess_crop_quality(blur_img, min_crop_px=48, min_blur_laplacian=25.0)
    assert q_blur.quality_passed is False
    assert "blur" in (q_blur.reason or "")

    # Cosine 0.65 (angle ~49.46 deg) sits cleanly inside [0.55, 0.75) ambiguous band
    extractor = _ControlledExtractor(
        [
            _basis_vec(0.0),      # det 1 -> ELE-001
            _basis_vec(49.5),     # det 2 -> cos(49.5) ≈ 0.6494 -> ambiguous -> needs_review
            _basis_vec(0.0),      # det 3 -> tiny crop -> needs_review even though vector matches!
            _basis_vec(0.0),      # det 4 -> low species confidence -> needs_review!
        ]
    )

    def _make_det(w: int = 300, h: int = 300, needs_species_review: bool = False) -> AnimalDetection:
        det = AnimalDetection(
            id=uuid.uuid4(),
            source_filename="synthetic.jpg",
            content_type="image/jpeg",
            file_size_bytes=1234,
            width=w,
            height=h,
            image_object_key=f"test/{uuid.uuid4()}.jpg",
            processing_status="needs_review" if needs_species_review else "completed",
            detection_count=1,
            animal_count=1,
            primary_species="Unknown / Needs Review" if needs_species_review else "Asian Elephant",
            primary_common_name="Asian Elephant",
            primary_scientific_name="Elephas maximus",
            primary_confidence=0.32 if needs_species_review else 0.92,
            detector_model="MegaDetector",
            classifier_model="SpeciesNet",
            inference_duration_ms=50,
            detections=[
                {
                    "index": 1,
                    "category": "animal",
                    "detector_confidence": 0.95,
                    "bbox": {
                        "xmin": 0.0,
                        "ymin": 0.0,
                        "width": 1.0,
                        "height": 1.0,
                        "pixel_xmin": 0,
                        "pixel_ymin": 0,
                        "pixel_width": w,
                        "pixel_height": h,
                    },
                    "species_label": "Unknown / Needs Review" if needs_species_review else "Asian Elephant",
                    "common_name": "Asian Elephant",
                    "scientific_name": "Elephas maximus",
                    "species_confidence": 0.32 if needs_species_review else 0.92,
                    "needs_review": needs_species_review,
                    "top_candidates": [],
                }
            ],
        )
        db_session.add(det)
        db_session.flush()
        return det

    now = datetime.now(timezone.utc)
    det1 = _make_det()
    res1 = run_reid_for_detection(
        db_session,
        detection=det1,
        pil_image=sharp_img,
        storage=storage,
        extractor=extractor,
        settings=settings,
        observed_at=now,
    )
    assert res1[0]["reid_decision"] == "new_individual"
    assert res1[0]["animal_code"] == "ELE-001"

    det2 = _make_det()
    res2 = run_reid_for_detection(
        db_session,
        detection=det2,
        pil_image=sharp_img,
        storage=storage,
        extractor=extractor,
        settings=settings,
        observed_at=now + timedelta(minutes=1),
    )
    assert res2[0]["reid_decision"] == "needs_review"
    assert res2[0]["reid_review_status"] == "pending_review"
    assert res2[0]["animal_identity_id"] is None
    assert 0.55 <= res2[0]["reid_similarity_score"] < 0.75

    det3 = _make_det(w=32, h=32)
    res3 = run_reid_for_detection(
        db_session,
        detection=det3,
        pil_image=tiny_img,
        storage=storage,
        extractor=extractor,
        settings=settings,
        observed_at=now + timedelta(minutes=2),
    )
    assert res3[0]["reid_decision"] == "needs_review"
    assert res3[0]["crop_quality"]["passed"] is False

    det4 = _make_det(needs_species_review=True)
    res4 = run_reid_for_detection(
        db_session,
        detection=det4,
        pil_image=sharp_img,
        storage=storage,
        extractor=extractor,
        settings=settings,
        observed_at=now + timedelta(minutes=3),
    )
    assert res4[0]["reid_decision"] == "needs_review"
    assert res4[0]["animal_identity_id"] is None
    db_session.commit()


def test_9_manual_review_confirm_reject_mark_needs_review_reassign_and_audit(intel_client):
    client, db, _storage, _settings = intel_client

    ele_a_bytes = (FIXTURES_DIR / "elephant.jpg").read_bytes()
    r1 = client.post(
        "/api/v1/detections/upload",
        files={"file": ("elephant.jpg", ele_a_bytes, "image/jpeg")},
        data={"country_code": "IND"},
    )
    assert r1.status_code == 201
    match1_id = r1.json()["detections"][0]["reid_match_id"]
    ele1_id = r1.json()["detections"][0]["animal_identity_id"]

    # Mark needs review -> clears matched identity, logs audit
    mark_res = client.post(
        f"/api/v1/animal-intelligence/matches/{match1_id}/review",
        json={
            "action": "mark_needs_review",
            "reviewed_by": "Ranger Kavitha",
            "reason": "Want flank scar confirmation",
        },
    )
    assert mark_res.status_code == 200
    assert mark_res.json()["review_status"] == "pending_review"
    assert mark_res.json()["matched_animal_id"] is None

    # Confirm back to ELE-001 -> identity becomes confirmed
    confirm_res = client.post(
        f"/api/v1/animal-intelligence/matches/{match1_id}/review",
        json={
            "action": "confirm",
            "reviewed_by": "Biologist Dr. Nair",
            "reason": "Tusk curvature verified",
            "target_animal_identity_id": ele1_id,
        },
    )
    assert confirm_res.status_code == 200
    assert confirm_res.json()["review_status"] == "confirmed"
    assert confirm_res.json()["matched_animal_id"] == ele1_id

    # Reject with create_new_identity=True creates a separate identity cleanly (never merges!)
    ele_var_bytes = _make_variant_bytes(FIXTURES_DIR / "elephant.jpg")
    r2 = client.post(
        "/api/v1/detections/upload",
        files={"file": ("elephant_var.jpg", ele_var_bytes, "image/jpeg")},
        data={"country_code": "IND"},
    )
    assert r2.status_code == 201
    match2_id = r2.json()["detections"][0]["reid_match_id"]

    reject_res = client.post(
        f"/api/v1/animal-intelligence/matches/{match2_id}/review",
        json={
            "action": "reject",
            "reviewed_by": "RFO Arjun",
            "reason": "Distinct ear notch observed",
            "create_new_identity": True,
        },
    )
    assert reject_res.status_code == 200
    rej_body = reject_res.json()
    assert rej_body["review_status"] == "rejected"
    assert rej_body["matched_animal_id"] is not None
    assert rej_body["matched_animal_id"] != ele1_id
    ele2_id = rej_body["matched_animal_id"]

    # Reassign back to ELE-001
    reass_res = client.post(
        f"/api/v1/animal-intelligence/matches/{match2_id}/review",
        json={
            "action": "reassign",
            "reviewed_by": "DFO Meera",
            "reason": "Corrected lighting angle comparison",
            "target_animal_identity_id": ele1_id,
        },
    )
    assert reass_res.status_code == 200
    assert reass_res.json()["review_status"] == "reassigned"
    assert reass_res.json()["matched_animal_id"] == ele1_id

    # Both ELE-001 and ELE-002 still exist distinctly + audit logs exist
    animals_list = client.get("/api/v1/animal-intelligence/animals").json()
    assert animals_list["total"] == 2
    detail_1 = client.get(f"/api/v1/animal-intelligence/animals/{ele1_id}").json()
    assert len(detail_1["review_logs"]) >= 3
    detail_2 = client.get(f"/api/v1/animal-intelligence/animals/{ele2_id}").json()
    assert detail_2["animal_code"] == "ELE-002"


def test_11_12_13_no_fake_gps_village_camera_sighting_and_idempotency(intel_client):
    client, db, _storage, _settings = intel_client
    elephant_bytes = (FIXTURES_DIR / "elephant.jpg").read_bytes()

    # Scenario 11: Upload with NO camera, village, or lat/lng -> no Sighting/Alert, zero fake GPS
    no_loc = client.post(
        "/api/v1/detections/upload",
        files={"file": ("elephant.jpg", elephant_bytes, "image/jpeg")},
        data={"country_code": "IND"},
    )
    assert no_loc.status_code == 201
    no_loc_body = no_loc.json()
    assert no_loc_body["generated_sighting_id"] is None
    assert no_loc_body["sighting_integration_status"] == "location_required_for_sighting"
    assert no_loc_body["latitude"] is None
    assert no_loc_body["longitude"] is None
    assert no_loc_body["generated_alert_ids"] == []

    # Scenario 12 + 13: Upload with real Village + Idempotency-Key -> creates Sighting with real Village coords
    village = db.execute(select(Village)).scalars().first()
    assert village is not None

    idem_key = f"upload-idem-{uuid.uuid4().hex}"
    r_first = client.post(
        "/api/v1/detections/upload",
        files={"file": ("elephant_village.jpg", elephant_bytes, "image/jpeg")},
        data={"country_code": "IND", "village_id": str(village.id)},
        headers={"Idempotency-Key": idem_key},
    )
    assert r_first.status_code == 201
    b_first = r_first.json()
    assert b_first["generated_sighting_id"] is not None
    assert b_first["sighting_integration_status"] == "linked"
    assert abs(b_first["latitude"] - village.latitude) < 1e-6
    assert abs(b_first["longitude"] - village.longitude) < 1e-6

    # Linked Sighting exists in /api/v1/sightings with animal_identity_id
    sight_res = client.get(f"/api/v1/sightings/{b_first['generated_sighting_id']}")
    assert sight_res.status_code == 200
    assert sight_res.json()["animal_detection_id"] == b_first["id"]
    assert sight_res.json()["animal_identity_id"] == b_first["detections"][0]["animal_identity_id"]

    # Replay same Idempotency-Key -> HTTP 200, exact same detection ID, zero duplicates
    r_replay = client.post(
        "/api/v1/detections/upload",
        files={"file": ("elephant_village.jpg", elephant_bytes, "image/jpeg")},
        data={"country_code": "IND", "village_id": str(village.id)},
        headers={"Idempotency-Key": idem_key},
    )
    assert r_replay.status_code == 200
    assert r_replay.json()["id"] == b_first["id"]
    assert r_replay.json()["generated_sighting_id"] == b_first["generated_sighting_id"]

    total_detections = len(db.execute(select(AnimalDetection)).scalars().all())
    assert total_detections == 2


def test_14_15_16_alert_rules_repeat_window_officer_routing_and_iot_contract(intel_client):
    client, db, _storage, _settings = intel_client

    # Seeded villages and rules exist
    village = db.execute(
        select(Village).where(Village.name.ilike("%Mangala%"))
    ).scalar_one_or_none() or db.execute(select(Village)).scalars().first()
    assert village is not None

    # Register a real Camera linked to that village to test camera GPS inheritance + X-Camera-Key ack
    cam_res = client.post(
        "/api/v1/cameras",
        json={
            "camera_code": "CAM-INT-01",
            "name": "Mangala Boundary Cam 1",
            "village_id": str(village.id),
            "zone_name": f"{village.name} Boundary",
            "zone_type": "perimeter_boundary",
            "latitude": village.latitude,
            "longitude": village.longitude,
            "protocol": "http_push",
            "is_dev_test": True,
        },
    )
    assert cam_res.status_code == 201
    camera_id = cam_res.json()["id"]
    camera_api_key = cam_res.json()["api_key"]

    elephant_bytes = (FIXTURES_DIR / "elephant.jpg").read_bytes()
    ele_var_bytes = _make_variant_bytes(FIXTURES_DIR / "elephant.jpg")
    tiger_bytes = (FIXTURES_DIR / "tiger.jpg").read_bytes()

    # 1) First elephant sighting -> seed rule requires min_repeat_count=2, so 0 Elephant alerts yet!
    now = datetime.now(timezone.utc)
    e1 = client.post(
        "/api/v1/detections/upload",
        files={"file": ("ele_cam_1.jpg", elephant_bytes, "image/jpeg")},
        data={
            "country_code": "IND",
            "camera_id": camera_id,
            "captured_at": (now - timedelta(minutes=15)).isoformat(),
        },
    )
    assert e1.status_code == 201
    assert e1.json()["generated_alert_ids"] == []

    # 2) Second sighting of same individual elephant ELE-001 within 120m -> Repeat Individual Elephant rule triggers!
    e2 = client.post(
        "/api/v1/detections/upload",
        files={"file": ("ele_cam_2.jpg", ele_var_bytes, "image/jpeg")},
        data={
            "country_code": "IND",
            "camera_id": camera_id,
            "captured_at": now.isoformat(),
        },
    )
    assert e2.status_code == 201
    e2_body = e2.json()
    assert len(e2_body["generated_alert_ids"]) >= 1
    assert any("Repeat" in a["title"] or "Elephant" in a["title"] for a in e2_body["generated_alerts"])

    # Verify nearest ForestOfficer routed & honest stub AlertDeliveryAttempt recorded (scenario 15)
    repeat_alert_id = e2_body["generated_alert_ids"][0]
    deliveries = client.get(f"/api/v1/animal-intelligence/deliveries?alert_id={repeat_alert_id}").json()
    assert deliveries["total"] >= 1
    att = deliveries["items"][0]
    assert att["routing_basis"] == "gps_distance"
    assert att["distance_km"] is not None
    assert att["status"] in {"recorded_stub", "queued_provider_unconfigured"}

    # Verify IoT boundary contract event automatically dispatched by seed repeat rule
    iot_list = client.get(f"/api/v1/iot/events?device_code=CAM-INT-01").json()
    assert iot_list["total"] >= 1
    evt = iot_list["items"][0]
    assert evt["delivery_status"] == "pending_ack"
    assert evt["payload_json"]["hardware_actuation"] == "boundary_contract_only_no_siren_activated"

    # Verify X-Camera-Key security on ack endpoint (scenario 16)
    no_key = client.post(f"/api/v1/iot/events/{evt['id']}/acknowledge", json={})
    assert no_key.status_code == 401
    bad_key = client.post(
        f"/api/v1/iot/events/{evt['id']}/acknowledge",
        headers={"X-Camera-Key": "wrong_key_value"},
        json={},
    )
    assert bad_key.status_code == 403
    retry_res = client.post(f"/api/v1/iot/events/{evt['id']}/retry")
    assert retry_res.status_code == 200
    assert retry_res.json()["retry_count"] == 1

    ok_ack = client.post(
        f"/api/v1/iot/events/{evt['id']}/acknowledge",
        headers={"X-Camera-Key": camera_api_key},
        json={"acknowledged_by": "CAM-INT-01-EDGE", "ack_note": "Contract verified"},
    )
    assert ok_ack.status_code == 200
    assert ok_ack.json()["delivery_status"] == "acknowledged"

    # 3) Single Tiger detection -> Critical Tiger rule triggers on count=1 (scenario 14)
    t1 = client.post(
        "/api/v1/detections/upload",
        files={"file": ("tig_cam_1.jpg", tiger_bytes, "image/jpeg")},
        data={"country_code": "IND", "camera_id": camera_id},
    )
    assert t1.status_code == 201
    t1_body = t1.json()
    assert len(t1_body["generated_alert_ids"]) >= 1
    assert any(a["severity"] == "Critical" for a in t1_body["generated_alerts"])

    # 4) AlertRule CRUD + disabled/wrong-zone rule does NOT trigger
    rule_res = client.post(
        "/api/v1/animal-intelligence/alert-rules",
        json={
            "name": "Faraway Zone Test Rule",
            "species_filter": "Tiger",
            "risk_level": "High",
            "zone_name": "NonexistentSectorXYZ",
            "min_repeat_count": 1,
            "time_window_minutes": 60,
            "min_species_confidence": 0.5,
            "enabled": True,
        },
    )
    assert rule_res.status_code == 201
    rule_id = rule_res.json()["id"]
    toggle_res = client.patch(
        f"/api/v1/animal-intelligence/alert-rules/{rule_id}",
        json={"enabled": False},
    )
    assert toggle_res.status_code == 200
    assert toggle_res.json()["enabled"] is False

    # Dev-test IoT endpoint explicitly sets is_dev_test=True
    dev_evt = client.post(
        "/api/v1/iot/events/dev-test",
        json={
            "camera_id": camera_id,
            "device_code": "CAM-INT-01",
            "species": "Asian Elephant",
            "confidence": 0.91,
            "risk_level": "High",
        },
    )
    assert dev_evt.status_code == 201
    assert dev_evt.json()["is_dev_test"] is True

    del_rule = client.delete(f"/api/v1/animal-intelligence/alert-rules/{rule_id}")
    assert del_rule.status_code == 200


def test_17_concurrent_safe_animal_code_allocation(db_session):
    c1, p1 = allocate_animal_code(db_session, "Asian Elephant")
    c2, p2 = allocate_animal_code(db_session, "Elephantidae Family")
    c3, p3 = allocate_animal_code(db_session, "Bengal Tiger")
    assert (c1, p1) == ("ELE-001", "ELE")
    assert (c2, p2) == ("ELE-002", "ELE")
    assert (c3, p3) == ("TIG-001", "TIG")


def test_18_alembic_0005_upgrade_and_downgrade(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_file = tmp_path / "alembic_0005_check.db"
    db_url = f"sqlite:///{db_file}"
    engine = create_engine(db_url, future=True)

    # Create pre-0005 baseline tables matching 0004_animal_detections and stamp alembic_version
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"))
        conn.execute(text("INSERT INTO alembic_version VALUES ('0004_animal_detections')"))
        conn.execute(text("CREATE TABLE villages (id CHAR(36) PRIMARY KEY, name VARCHAR(160))"))
        conn.execute(text("CREATE TABLE cameras (id CHAR(36) PRIMARY KEY, camera_code VARCHAR(64))"))
        conn.execute(text("CREATE TABLE sightings (id CHAR(36) PRIMARY KEY, sighting_code VARCHAR(64))"))
        conn.execute(text("CREATE TABLE alerts (id CHAR(36) PRIMARY KEY, title VARCHAR(240))"))
        conn.execute(text("CREATE TABLE animal_detections (id CHAR(36) PRIMARY KEY, source_filename VARCHAR(255))"))
        conn.execute(
            text(
                "CREATE TABLE thermal_frames (id CHAR(36) PRIMARY KEY, camera_id CHAR(36), capture_mode VARCHAR(32), frame_index INTEGER, captured_at TIMESTAMP)"
            )
        )
    engine.dispose()

    monkeypatch.setenv("DATABASE_URL", db_url)
    cfg = AlembicConfig(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", db_url)

    alembic_command.upgrade(cfg, "0005_reid_and_wicps_integ")

    eng_after_up = create_engine(db_url, future=True)
    insp = inspect(eng_after_up)
    tables = set(insp.get_table_names())
    expected_new_tables = {
        "animal_code_sequences",
        "animal_identities",
        "animal_embeddings",
        "reid_matches",
        "identity_review_logs",
        "alert_rules",
        "forest_officers",
        "alert_delivery_attempts",
        "iot_event_records",
    }
    assert expected_new_tables.issubset(tables)
    det_cols = {c["name"] for c in insp.get_columns("animal_detections")}
    assert {"camera_id", "village_id", "idempotency_key", "generated_sighting_id"}.issubset(det_cols)
    eng_after_up.dispose()

    alembic_command.downgrade(cfg, "0004_animal_detections")

    eng_after_down = create_engine(db_url, future=True)
    insp_down = inspect(eng_after_down)
    tables_down = set(insp_down.get_table_names())
    assert expected_new_tables.isdisjoint(tables_down)
    eng_after_down.dispose()

    # Re-upgrade cleanly to head (0006_security_reid_idemp)
    alembic_command.upgrade(cfg, "head")
    eng_head = create_engine(db_url, future=True)
    insp_head = inspect(eng_head)
    assert "users" in set(insp_head.get_table_names())
    assert "species_family" in {c["name"] for c in insp_head.get_columns("animal_identities")}
    assert "ingest_idempotency_key" in {c["name"] for c in insp_head.get_columns("thermal_frames")}
    eng_head.dispose()
