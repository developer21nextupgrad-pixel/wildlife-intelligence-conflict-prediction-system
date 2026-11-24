import io
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from app.core.config import Settings
from app.core.database import get_db
from app.main import create_application
from app.services.animal_detection import (
    AnimalDetectionPipeline,
    clamp_normalized_bbox,
    parse_speciesnet_taxonomy,
)
from app.services.megadescriptor import MegaDescriptorExtractor
from app.services.storage import FilesystemObjectStorage, get_storage_backend

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "animal_detection"


@pytest.fixture(scope="module")
def shared_pipeline() -> AnimalDetectionPipeline:
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
def shared_extractor() -> MegaDescriptorExtractor:
    extractor = MegaDescriptorExtractor()
    extractor.ensure_loaded()
    return extractor


@pytest.fixture()
def detection_client(
    db_session,
    tmp_path: Path,
    shared_pipeline: AnimalDetectionPipeline,
    shared_extractor: MegaDescriptorExtractor,
):
    from conftest import auth_headers, make_test_settings

    storage = FilesystemObjectStorage(tmp_path / "detection_store")
    settings = make_test_settings(
        storage_backend="filesystem",
        local_storage_dir=str(tmp_path / "detection_store"),
    )
    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_storage_backend] = lambda: storage

    from app.api.routes.detections import _get_extractor_dep, _get_pipeline_dep

    app.dependency_overrides[_get_pipeline_dep] = lambda: shared_pipeline
    app.dependency_overrides[_get_extractor_dep] = lambda: shared_extractor

    with TestClient(app) as test_client:
        test_client.headers.update(auth_headers(settings, role="operator"))
        yield test_client, storage
    app.dependency_overrides.clear()


def test_parse_speciesnet_taxonomy_and_bbox_clamping():
    tiger = parse_speciesnet_taxonomy(
        "e1c6c5b2-b808-4d50-bf01-90aa46f964c2;mammalia;carnivora;felidae;panthera;tigris;tiger"
    )
    assert tiger.common_name == "Tiger"
    assert tiger.scientific_name == "Panthera tigris"
    assert tiger.taxonomic_level == "species"
    assert tiger.is_generic_or_unknown is False

    family = parse_speciesnet_taxonomy(
        "338af0f6-3c5b-460a-ae72-19e2b8403da6;mammalia;proboscidea;elephantidae;;;elephantidae family"
    )
    assert family.common_name == "Elephantidae Family"
    assert family.scientific_name == "Elephantidae"
    assert family.taxonomic_level == "family"
    assert family.is_generic_or_unknown is False

    unknown = parse_speciesnet_taxonomy(
        "f2efdae9-efb8-48fb-8a91-eccf79ab4ffb;no cv result;no cv result;no cv result;no cv result;no cv result;no cv result"
    )
    assert unknown.is_generic_or_unknown is True

    generic_animal = parse_speciesnet_taxonomy(
        "1f689929-883d-4dae-958c-3d57ab5b6c16;;;;;;animal"
    )
    assert generic_animal.is_generic_or_unknown is True

    clamped = clamp_normalized_bbox([-0.1, 0.25, 1.5, 0.9], 1000, 500)
    assert clamped["xmin"] == 0.0
    assert clamped["ymin"] == 0.25
    assert clamped["width"] == 1.0
    assert clamped["height"] == 0.75
    assert clamped["pixel_xmin"] == 0
    assert clamped["pixel_width"] == 1000


def test_animal_detection_elephant_image_real_inference(detection_client):
    client, storage = detection_client
    elephant_bytes = (FIXTURES_DIR / "elephant.jpg").read_bytes()

    res = client.post(
        "/api/v1/detections/upload",
        files={"file": ("elephant.jpg", elephant_bytes, "image/jpeg")},
        data={"country_code": "IND"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["processing_status"] == "completed"
    assert body["animal_count"] >= 1
    assert body["primary_species"] is not None
    assert "elephant" in body["primary_species"].lower()
    assert body["primary_confidence"] is not None and body["primary_confidence"] >= 0.50
    assert body["model_metadata"]["thermal_imagery_supported"] is False
    assert storage.exists(body["image_object_key"])

    first_det = body["detections"][0]
    assert first_det["category"] == "animal"
    assert first_det["detector_confidence"] >= 0.20
    assert 0.0 <= first_det["bbox"]["xmin"] <= 1.0
    assert 0.0 <= first_det["bbox"]["ymin"] <= 1.0
    assert first_det["bbox"]["width"] > 0.0
    assert first_det["bbox"]["height"] > 0.0
    assert first_det["individual_reid_status"] in {"new_individual", "matched_existing", "needs_review"}
    if first_det["individual_reid_status"] == "new_individual":
        assert first_det["animal_code"].startswith("ELE-")
        assert first_det["crop_image_url"] is not None

    img_res = client.get(f"/api/v1/detections/{body['id']}/image")
    assert img_res.status_code == 200
    assert img_res.headers["content-type"].startswith("image/jpeg")
    assert len(img_res.content) == len(elephant_bytes)


def test_animal_detection_tiger_jpg_and_png_real_inference(detection_client):
    client, _storage = detection_client
    tiger_bytes = (FIXTURES_DIR / "tiger.jpg").read_bytes()

    jpg_res = client.post(
        "/api/v1/detections/upload",
        files={"file": ("tiger.jpg", tiger_bytes, "image/jpeg")},
        data={"country_code": "IND"},
    )
    assert jpg_res.status_code == 201
    jpg_body = jpg_res.json()
    assert jpg_body["processing_status"] == "completed"
    assert jpg_body["animal_count"] >= 1
    assert jpg_body["primary_species"] == "Tiger"
    assert jpg_body["primary_scientific_name"] == "Panthera tigris"
    assert jpg_body["primary_confidence"] >= 0.85

    # Also verify PNG upload path
    with Image.open(io.BytesIO(tiger_bytes)) as img:
        png_buf = io.BytesIO()
        img.save(png_buf, format="PNG")
    png_res = client.post(
        "/api/v1/detections/upload",
        files={"file": ("tiger_sample.png", png_buf.getvalue(), "image/png")},
        data={"country_code": "IND"},
    )
    assert png_res.status_code == 201
    png_body = png_res.json()
    assert png_body["content_type"] == "image/png"
    assert png_body["primary_species"] == "Tiger"


def test_animal_detection_multiple_animals_in_one_image(detection_client):
    client, _storage = detection_client
    multi_bytes = (FIXTURES_DIR / "multi_animals.jpg").read_bytes()

    res = client.post(
        "/api/v1/detections/upload",
        files={"file": ("multi_animals.jpg", multi_bytes, "image/jpeg")},
        data={"country_code": "IND"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["processing_status"] == "completed"
    assert body["animal_count"] >= 2
    animal_boxes = [d for d in body["detections"] if d["category"] == "animal"]
    assert len(animal_boxes) >= 2
    assert any("elephant" in (d["species_label"] or "").lower() for d in animal_boxes)


def test_animal_detection_no_animal_graceful_handling(detection_client):
    client, _storage = detection_client
    empty_bytes = (FIXTURES_DIR / "empty_forest.jpg").read_bytes()

    res = client.post(
        "/api/v1/detections/upload",
        files={"file": ("empty_forest.jpg", empty_bytes, "image/jpeg")},
        data={"country_code": "IND"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["animal_count"] == 0
    assert body["processing_status"] == "no_animal_detected"
    assert body["primary_species"] is None
    assert body["primary_confidence"] is None


def test_animal_detection_low_confidence_marks_unknown_needs_review(
    db_session, tmp_path: Path, shared_pipeline: AnimalDetectionPipeline
):
    # Share loaded model weights but use a strict threshold (0.9999) to verify Unknown / Needs Review behavior
    strict_pipeline = AnimalDetectionPipeline(
        model_name=shared_pipeline.model_name,
        geofence_enabled=True,
        min_detection_confidence=0.20,
        min_species_confidence=0.9999,
        max_detections_per_image=25,
    )
    strict_pipeline._detector = shared_pipeline._detector
    strict_pipeline._classifier = shared_pipeline._classifier
    strict_pipeline._ensemble = shared_pipeline._ensemble
    strict_pipeline._detector_model_name = shared_pipeline._detector_model_name
    strict_pipeline._classifier_model_name = shared_pipeline._classifier_model_name
    strict_pipeline._speciesnet_version = shared_pipeline._speciesnet_version
    strict_pipeline._loaded = True

    from conftest import auth_headers, make_test_settings

    storage = FilesystemObjectStorage(tmp_path / "strict_store")
    settings = make_test_settings(
        storage_backend="filesystem",
        local_storage_dir=str(tmp_path / "strict_store"),
        speciesnet_min_species_confidence=0.9999,
    )
    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_storage_backend] = lambda: storage
    from app.api.routes.detections import _get_pipeline_dep

    app.dependency_overrides[_get_pipeline_dep] = lambda: strict_pipeline

    try:
        with TestClient(app) as strict_client:
            strict_client.headers.update(auth_headers(settings, role="operator"))
            elephant_bytes = (FIXTURES_DIR / "elephant.jpg").read_bytes()
            res = strict_client.post(
                "/api/v1/detections/upload",
                files={"file": ("elephant.jpg", elephant_bytes, "image/jpeg")},
            )
            assert res.status_code == 201
            body = res.json()
            assert body["processing_status"] == "needs_review"
            assert body["primary_species"] == "Unknown / Needs Review"
            assert all(
                d["needs_review"] is True and d["species_label"] == "Unknown / Needs Review"
                for d in body["detections"]
                if d["category"] == "animal"
            )
    finally:
        app.dependency_overrides.clear()


def test_animal_detection_rejects_unsupported_empty_and_corrupted_files(detection_client):
    client, _storage = detection_client

    txt_bytes = (FIXTURES_DIR / "unsupported.txt").read_bytes()
    bad_ext = client.post(
        "/api/v1/detections/upload",
        files={"file": ("unsupported.txt", txt_bytes, "text/plain")},
    )
    assert bad_ext.status_code == 415
    assert "Unsupported image format" in bad_ext.json()["detail"]

    empty_res = client.post(
        "/api/v1/detections/upload",
        files={"file": ("empty.jpg", b"", "image/jpeg")},
    )
    assert empty_res.status_code == 422
    assert "empty" in empty_res.json()["detail"].lower()

    corrupted_bytes = (FIXTURES_DIR / "corrupted.jpg").read_bytes()
    corrupted_res = client.post(
        "/api/v1/detections/upload",
        files={"file": ("corrupted.jpg", corrupted_bytes, "image/jpeg")},
    )
    assert corrupted_res.status_code == 422
    assert "corrupted" in corrupted_res.json()["detail"].lower()

    # None of the failed uploads should persist records
    listed = client.get("/api/v1/detections")
    assert listed.status_code == 200
    assert listed.json()["total"] == 0


def test_animal_detection_persists_across_fresh_queries(
    db_session,
    tmp_path: Path,
    shared_pipeline: AnimalDetectionPipeline,
    shared_extractor: MegaDescriptorExtractor,
):
    from conftest import auth_headers, make_test_settings

    storage = FilesystemObjectStorage(tmp_path / "persist_store")
    settings = make_test_settings(
        storage_backend="filesystem",
        local_storage_dir=str(tmp_path / "persist_store"),
    )
    from app.api.routes.detections import _get_extractor_dep, _get_pipeline_dep

    app1 = create_application(settings)
    app1.dependency_overrides[get_db] = lambda: db_session
    app1.dependency_overrides[get_storage_backend] = lambda: storage
    app1.dependency_overrides[_get_pipeline_dep] = lambda: shared_pipeline
    app1.dependency_overrides[_get_extractor_dep] = lambda: shared_extractor

    tiger_bytes = (FIXTURES_DIR / "tiger.jpg").read_bytes()
    with TestClient(app1) as client1:
        client1.headers.update(auth_headers(settings, role="operator"))
        created = client1.post(
            "/api/v1/detections/upload",
            files={"file": ("tiger.jpg", tiger_bytes, "image/jpeg")},
        )
        assert created.status_code == 201
        det_id = created.json()["id"]
    app1.dependency_overrides.clear()

    # Fresh app & TestClient simulating page refresh / new request session
    app2 = create_application(settings)
    app2.dependency_overrides[get_db] = lambda: db_session
    app2.dependency_overrides[get_storage_backend] = lambda: storage
    app2.dependency_overrides[_get_pipeline_dep] = lambda: shared_pipeline
    app2.dependency_overrides[_get_extractor_dep] = lambda: shared_extractor

    with TestClient(app2) as client2:
        client2.headers.update(auth_headers(settings, role="operator"))
        list_res = client2.get("/api/v1/detections")
        assert list_res.status_code == 200
        assert list_res.json()["total"] == 1
        assert list_res.json()["items"][0]["id"] == det_id
        assert list_res.json()["items"][0]["primary_species"] == "Tiger"

        detail_res = client2.get(f"/api/v1/detections/{det_id}")
        assert detail_res.status_code == 200
        assert detail_res.json()["primary_scientific_name"] == "Panthera tigris"

        img_res = client2.get(f"/api/v1/detections/{det_id}/image")
        assert img_res.status_code == 200
        assert len(img_res.content) == len(tiger_bytes)
    app2.dependency_overrides.clear()
