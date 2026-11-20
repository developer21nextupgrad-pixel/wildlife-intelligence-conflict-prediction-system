from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import tempfile

from alembic import command
from alembic.config import Config
import cv2
from fastapi.testclient import TestClient
import numpy as np
from PIL import Image
import pytest

from app.core.config import Settings
from app.core.database import get_db
from app.main import create_application
from app.services.frame_processor import UnsupportedMediaError, process_image_bytes
from app.services.storage import (
    FilesystemObjectStorage,
    S3ObjectStorage,
    get_storage_backend,
)


def _make_synthetic_thermal_8bit(width: int = 320, height: int = 200) -> np.ndarray:
    """Synthetic thermal-like 8-bit grayscale test fixture with warm hotspot."""
    y, x = np.mgrid[0:height, 0:width]
    bg = (40 + 15 * np.sin(x / 35.0) + 10 * np.cos(y / 25.0)).astype(np.float32)
    hotspot = 175.0 * np.exp(-(((x - width * 0.55) ** 2) + ((y - height * 0.45) ** 2)) / (2 * 22.0**2))
    arr = np.clip(bg + hotspot, 0, 255).astype(np.uint8)
    return arr


def _make_synthetic_thermal_16bit_tiff(width: int = 320, height: int = 240) -> bytes:
    """Synthetic 16-bit radiometric TIFF fixture (simulating Kelvin*100 thermal data)."""
    y, x = np.mgrid[0:height, 0:width]
    base_kelvin_x100 = 29315.0 + 120.0 * np.sin(x / 40.0)
    animal_heat = 1150.0 * np.exp(-(((x - 180.0) ** 2) + ((y - 120.0) ** 2)) / (2 * 24.0**2))
    arr16 = np.clip(base_kelvin_x100 + animal_heat, 0, 65535).astype(np.uint16)
    ok, buf = cv2.imencode(".tiff", arr16)
    assert ok
    return buf.tobytes()


def _make_synthetic_thermal_avi(
    width: int = 320, height: int = 240, fps: float = 20.0, num_frames: int = 40
) -> bytes:
    """Synthetic 2.0-second 20 FPS AVI thermal test fixture with moving hotspot."""
    with tempfile.NamedTemporaryFile(suffix=".avi", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        fourcc = cv2.VideoWriter_fourcc(*"MJPG")
        writer = cv2.VideoWriter(tmp_path, fourcc, fps, (width, height))
        assert writer.isOpened()
        y, x = np.mgrid[0:height, 0:width]
        for idx in range(num_frames):
            cx = 60.0 + idx * 4.5
            cy = 120.0 + 15.0 * np.sin(idx / 4.0)
            gray = np.clip(
                35.0 + 180.0 * np.exp(-(((x - cx) ** 2) + ((y - cy) ** 2)) / (2 * 18.0**2)),
                0,
                255,
            ).astype(np.uint8)
            writer.write(cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR))
        writer.release()
        return Path(tmp_path).read_bytes()
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@pytest.fixture()
def phase1_client(db_session, tmp_path: Path):
    storage = FilesystemObjectStorage(tmp_path / "object_store")
    settings = Settings(
        environment="test",
        auto_seed_demo_data=False,
        rate_limit_requests=500,
        rate_limit_window_seconds=60,
        storage_backend="filesystem",
        local_storage_dir=str(tmp_path / "object_store"),
    )
    app = create_application(settings)
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_storage_backend] = lambda: storage

    with TestClient(app) as test_client:
        yield test_client, storage
    app.dependency_overrides.clear()


def test_camera_registration_credential_masking_and_auth(phase1_client):
    client, _storage = phase1_client

    reg_res = client.post(
        "/api/v1/cameras",
        json={
            "camera_code": "CAM-HED-01",
            "name": "Hediyala North Thermal Mast",
            "zone_name": "Kadambur North Sugarcane",
            "zone_type": "crop_field",
            "latitude": 11.6642,
            "longitude": 76.6218,
            "protocol": "rtsp",
            "stream_metadata": {
                "rtsp_url": "rtsp://iot_user:supersecret123@10.10.2.5:554/stream1",
                "api_key": "should-be-masked",
                "fps": 5,
            },
            "is_dev_test": False,
        },
    )
    assert reg_res.status_code == 201
    created = reg_res.json()
    api_key = created["api_key"]
    assert api_key.startswith("wicps_cam_")
    assert "api_key_hash" not in created
    assert "supersecret123" not in created["stream_metadata"]["rtsp_url"]
    assert "***:***" in created["stream_metadata"]["rtsp_url"]
    assert created["stream_metadata"]["api_key"] == "***"

    # GET list never exposes plaintext api_key or api_key_hash
    list_res = client.get("/api/v1/cameras")
    assert list_res.status_code == 200
    assert list_res.json()["total"] == 1
    listed = list_res.json()["items"][0]
    assert "api_key" not in listed
    assert "api_key_hash" not in listed

    # Heartbeat rejects missing/wrong X-Camera-Key
    cam_id = created["id"]
    assert client.post(f"/api/v1/cameras/{cam_id}/heartbeat").status_code == 401
    assert (
        client.post(
            f"/api/v1/cameras/{cam_id}/heartbeat",
            headers={"X-Camera-Key": "wrong-key"},
        ).status_code
        == 401
    )

    # Valid heartbeat succeeds and updates last_heartbeat_at
    hb = client.post(
        f"/api/v1/cameras/{cam_id}/heartbeat",
        headers={"X-Camera-Key": api_key},
        json={"status": "active"},
    )
    assert hb.status_code == 200
    assert hb.json()["last_heartbeat_at"] is not None

    # PATCH update works
    patched = client.patch(
        f"/api/v1/cameras/{cam_id}",
        json={"status": "maintenance", "zone_type": "structure"},
    )
    assert patched.status_code == 200
    assert patched.json()["status"] == "maintenance"
    assert patched.json()["zone_type"] == "structure"


def test_http_frame_ingestion_contract_and_8bit_preprocessing(phase1_client):
    client, storage = phase1_client

    reg = client.post(
        "/api/v1/cameras",
        json={
            "camera_code": "CAM-HTTP-01",
            "name": "Mangala Perimeter Thermal",
            "zone_name": "Mangala Cattle Shed",
            "zone_type": "structure",
            "latitude": 11.688,
            "longitude": 76.643,
            "protocol": "http_push",
        },
    ).json()
    api_key = reg["api_key"]

    img_8bit = _make_synthetic_thermal_8bit(320, 200)
    ok, png_buf = cv2.imencode(".png", img_8bit)
    assert ok
    raw_bytes = png_buf.tobytes()

    metadata = json.dumps(
        {
            "camera_id": "CAM-HTTP-01",
            "timestamp": "2026-11-19T02:15:00Z",
            "location": {"latitude": 11.688, "longitude": 76.643},
            "zone": {"zone_name": "Mangala Cattle Shed", "zone_type": "structure"},
            "stream_metadata": {"protocol": "http_push", "fps": 5.0, "width": 320, "height": 200},
            "sequence_number": 7,
        }
    )

    # Missing or wrong key rejected
    no_key = client.post(
        "/api/v1/ingest/frames",
        files={"file": ("thermal.png", raw_bytes, "image/png")},
        data={"metadata": metadata},
    )
    assert no_key.status_code == 401

    bad_key = client.post(
        "/api/v1/ingest/frames",
        headers={"X-Camera-Key": "invalid-secret"},
        files={"file": ("thermal.png", raw_bytes, "image/png")},
        data={"metadata": metadata},
    )
    assert bad_key.status_code == 401

    # Valid authenticated HTTP ingestion
    ok_res = client.post(
        "/api/v1/ingest/frames",
        headers={"X-Camera-Key": api_key},
        files={"file": ("thermal_frame.png", raw_bytes, "image/png")},
        data={"metadata": metadata},
    )
    assert ok_res.status_code == 201
    frame = ok_res.json()
    assert frame["qc_passed"] is True
    assert frame["processing_status"] == "preprocessed"
    assert frame["width"] == 320
    assert frame["height"] == 200
    assert frame["pixel_format"] == "uint8_gray"
    assert frame["raw_object_key"].startswith("raw-frames/CAM-HTTP-01/")
    assert frame["processed_object_key"].startswith("processed-frames/CAM-HTTP-01/")
    assert frame["qc_metrics"]["clahe_applied"] is True
    assert storage.exists(frame["raw_object_key"])
    assert storage.exists(frame["processed_object_key"])

    # Verify processed output is exact 640x640 letterboxed PNG (top/bottom padding = 0)
    processed_bytes = client.get(f"/api/v1/ingest/frames/{frame['id']}/image?variant=processed")
    assert processed_bytes.status_code == 200
    decoded_proc = cv2.imdecode(np.frombuffer(processed_bytes.content, np.uint8), cv2.IMREAD_UNCHANGED)
    assert decoded_proc.shape == (640, 640, 3)
    # 320x200 scaled to 640x400 -> top 120px & bottom 120px are letterbox padding (0)
    assert int(decoded_proc[0, 320, 0]) == 0
    assert int(decoded_proc[639, 320, 0]) == 0
    assert int(decoded_proc[320, 320, 0]) > 0


def test_16bit_tiff_radiometric_preservation_and_preview(phase1_client):
    client, storage = phase1_client
    tiff_bytes = _make_synthetic_thermal_16bit_tiff(320, 240)

    res = client.post(
        "/api/v1/ingest/dev-sample",
        files={"file": ("radiometric_sample.tiff", tiff_bytes, "image/tiff")},
    )
    assert res.status_code == 201
    payload = res.json()
    assert payload["mode"] == "DEVELOPMENT_TEST_MODE"
    assert payload["accepted_count"] == 1
    frame = payload["frames"][0]
    assert frame["is_dev_test"] is True
    assert frame["pixel_format"] == "uint16_radiometric"
    assert frame["qc_metrics"]["bit_depth"] == 16
    assert frame["qc_metrics"]["min_raw"] > 29000
    assert frame["qc_metrics"]["max_raw"] > 30000
    assert frame["raw_object_key"].endswith(".tiff")

    # Stored raw file must preserve original 16-bit TIFF byte-for-byte
    stored_raw = storage.get_bytes(frame["raw_object_key"])
    assert stored_raw == tiff_bytes

    # Browser preview renders PNG without mutating stored raw object
    preview_res = client.get(f"/api/v1/ingest/frames/{frame['id']}/image?variant=raw&preview=true")
    assert preview_res.status_code == 200
    assert preview_res.headers["content-type"] == "image/png"

    # Processed frame is 640x640 CLAHE PNG
    proc_res = client.get(f"/api/v1/ingest/frames/{frame['id']}/image?variant=processed")
    assert proc_res.status_code == 200
    proc_arr = cv2.imdecode(np.frombuffer(proc_res.content, np.uint8), cv2.IMREAD_UNCHANGED)
    assert proc_arr.shape == (640, 640, 3)


def test_corrupted_blank_undersized_and_invalid_format_handling(phase1_client):
    client, storage = phase1_client

    # 1. Invalid file extension -> 415
    bad_ext = client.post(
        "/api/v1/ingest/dev-sample",
        files={"file": ("notes.txt", b"not thermal data", "text/plain")},
    )
    assert bad_ext.status_code == 415

    # 2. Empty file -> 422
    empty_res = client.post(
        "/api/v1/ingest/dev-sample",
        files={"file": ("empty.png", b"", "image/png")},
    )
    assert empty_res.status_code == 422

    # 3. Corrupted image bytes -> persisted as qc_failed with explicit rejection reason
    corrupt_res = client.post(
        "/api/v1/ingest/dev-sample",
        files={"file": ("corrupt.png", b"\x89PNG\r\n\x1a\ncorrupted-bytes", "image/png")},
    )
    assert corrupt_res.status_code == 201
    corrupt_frame = corrupt_res.json()["frames"][0]
    assert corrupt_frame["qc_passed"] is False
    assert corrupt_frame["processing_status"] == "qc_failed"
    assert "Corrupted" in corrupt_frame["rejection_reason"]
    assert corrupt_frame["processed_object_key"] is None
    assert storage.exists(corrupt_frame["raw_object_key"])
    assert (
        client.get(f"/api/v1/ingest/frames/{corrupt_frame['id']}/image?variant=processed").status_code
        == 404
    )

    # 4. Blank/uniform frame -> rejected by blank sensor validation
    blank_arr = np.full((240, 320), 120, dtype=np.uint8)
    _, blank_png = cv2.imencode(".png", blank_arr)
    blank_res = client.post(
        "/api/v1/ingest/dev-sample",
        files={"file": ("blank_sensor.png", blank_png.tobytes(), "image/png")},
    )
    assert blank_res.status_code == 201
    blank_frame = blank_res.json()["frames"][0]
    assert blank_frame["qc_passed"] is False
    assert "Blank or uniform" in blank_frame["rejection_reason"]

    # 5. Undersized frame -> rejected by dimension check
    small_arr = _make_synthetic_thermal_8bit(100, 80)
    _, small_png = cv2.imencode(".png", small_arr)
    small_res = client.post(
        "/api/v1/ingest/dev-sample",
        files={"file": ("tiny.png", small_png.tobytes(), "image/png")},
    )
    assert small_res.status_code == 201
    small_frame = small_res.json()["frames"][0]
    assert small_frame["qc_passed"] is False
    assert "below minimum required" in small_frame["rejection_reason"]

    # Filter rejected frames via GET /api/v1/ingest/frames
    rejected_list = client.get("/api/v1/ingest/frames?qc_passed=false")
    assert rejected_list.status_code == 200
    assert rejected_list.json()["total"] == 3


def test_video_fps_extraction_and_filtering(phase1_client):
    client, _storage = phase1_client
    avi_bytes = _make_synthetic_thermal_avi(width=320, height=240, fps=20.0, num_frames=40)

    res = client.post(
        "/api/v1/ingest/dev-sample",
        files={"file": ("thermal_clip_2s.avi", avi_bytes, "video/x-msvideo")},
        data={"target_fps": "5.0", "captured_at": "2026-11-19T03:00:00Z"},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["media_type"] == "video"
    # 2.0 seconds @ 5 FPS -> 10 extracted frames
    assert 9 <= data["extracted_count"] <= 11
    assert data["accepted_count"] == data["extracted_count"]
    assert data["video_summary"]["target_fps"] == 5.0
    assert [f["frame_index"] for f in data["frames"]] == list(range(data["extracted_count"]))

    # Date & camera filters work
    cam_id = data["camera_id"]
    filtered = client.get(
        f"/api/v1/ingest/frames?camera_id={cam_id}&date_from=2026-11-19T02:59:00Z&date_to=2026-11-19T03:05:00Z"
    )
    assert filtered.status_code == 200
    assert filtered.json()["total"] == data["extracted_count"]


def test_rtsp_test_pull_validation_and_credential_masking(phase1_client):
    client, _storage = phase1_client

    bad_scheme = client.post(
        "/api/v1/ingest/rtsp/test-pull",
        json={"rtsp_url": "http://example.com/not-rtsp", "max_frames": 3},
    )
    assert bad_scheme.status_code == 422

    # Closed local port fails quickly with 502 and masked credentials
    unreachable = client.post(
        "/api/v1/ingest/rtsp/test-pull",
        json={
            "rtsp_url": "rtsp://admin:topsecret@127.0.0.1:19554/live",
            "max_frames": 2,
            "timeout_seconds": 1.5,
        },
    )
    assert unreachable.status_code == 502
    detail = unreachable.json()["detail"]
    assert "topsecret" not in detail
    assert "***:***" in detail


def test_storage_path_traversal_and_s3_adapter_contract(tmp_path: Path, monkeypatch):
    fs = FilesystemObjectStorage(tmp_path)
    with pytest.raises(ValueError):
        fs.put_bytes("../escape.png", b"bad")

    # Test S3ObjectStorage against stubbed boto3 client
    stored_objects: dict[tuple[str, str], bytes] = {}

    class FakeS3Client:
        def put_object(self, Bucket, Key, Body, ContentType):
            stored_objects[(Bucket, Key)] = Body

        def get_object(self, Bucket, Key):
            body = stored_objects[(Bucket, Key)]
            return {"Body": io.BytesIO(body)}

        def head_object(self, Bucket, Key):
            if (Bucket, Key) not in stored_objects:
                raise KeyError(Key)

        def delete_object(self, Bucket, Key):
            stored_objects.pop((Bucket, Key), None)

    monkeypatch.setattr("app.services.storage.boto3.client", lambda *a, **kw: FakeS3Client())
    s3 = S3ObjectStorage(bucket="wicps-thermal-test", endpoint_url="http://localhost:9000")
    key = s3.put_bytes("raw-frames/CAM-1/2026-11-19/f1.tiff", b"tiff-bytes", "image/tiff")
    assert s3.get_bytes(key) == b"tiff-bytes"
    s3.delete(key)
    assert (s3.bucket, key) not in stored_objects


def test_direct_unit_processor_unsupported_error():
    with pytest.raises(UnsupportedMediaError):
        process_image_bytes(b"hello", "bad.bmp")


def test_jpg_upload_and_clahe_metrics(phase1_client):
    client, _storage = phase1_client
    img = _make_synthetic_thermal_8bit(400, 300)
    ok, jpg_buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
    assert ok
    res = client.post(
        "/api/v1/ingest/dev-sample",
        files={"file": ("thermal_night.jpg", jpg_buf.tobytes(), "image/jpeg")},
    )
    assert res.status_code == 201
    frame = res.json()["frames"][0]
    assert frame["qc_passed"] is True
    assert frame["width"] == 400
    assert frame["height"] == 300
    assert frame["qc_metrics"]["clahe_applied"] is True
    assert frame["qc_metrics"]["processed_width"] == 640
    assert frame["qc_metrics"]["processed_height"] == 640


def test_mp4_video_fps_extraction(phase1_client):
    client, _storage = phase1_client
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(tmp_path, fourcc, 15.0, (320, 240))
        assert writer.isOpened()
        y, x = np.mgrid[0:240, 0:320]
        for idx in range(30):
            gray = np.clip(
                35.0 + 180.0 * np.exp(-(((x - (80 + idx * 4)) ** 2) + ((y - 120) ** 2)) / (2 * 18.0**2)),
                0,
                255,
            ).astype(np.uint8)
            writer.write(cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR))
        writer.release()
        mp4_bytes = Path(tmp_path).read_bytes()
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    res = client.post(
        "/api/v1/ingest/dev-sample",
        files={"file": ("thermal_sample.mp4", mp4_bytes, "video/mp4")},
        data={"target_fps": "5.0"},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["media_type"] == "video"
    assert 9 <= data["extracted_count"] <= 11
    assert data["accepted_count"] == data["extracted_count"]


def test_alembic_upgrade_0001_and_0002_on_sqlite(tmp_path: Path, monkeypatch):
    from alembic.script import ScriptDirectory
    from app.core.config import get_settings

    backend_dir = Path(__file__).resolve().parents[1]
    db_file = tmp_path / "alembic_test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_file}")
    get_settings.cache_clear()
    try:
        cfg = Config(str(backend_dir / "alembic.ini"))
        cfg.set_main_option("script_location", str(backend_dir / "alembic"))
        script_dir = ScriptDirectory.from_config(cfg)
        for rev in script_dir.walk_revisions():
            assert len(rev.revision) <= 32, (
                f"Alembic revision '{rev.revision}' exceeds VARCHAR(32) limit ({len(rev.revision)} chars)"
            )

        command.upgrade(cfg, "head")
        command.downgrade(cfg, "0001_initial_schema")
        command.upgrade(cfg, "0002_cameras_and_thermal_frames")
        command.upgrade(cfg, "0003_thermal_delete")
        command.downgrade(cfg, "0002_cameras_and_thermal_frames")
        command.upgrade(cfg, "head")
    finally:
        get_settings.cache_clear()


def test_cors_allows_x_camera_key_and_vercel_origin(phase1_client):
    client, _storage = phase1_client
    vercel_origin = "https://wicps-command-preview.vercel.app"
    preflight = client.options(
        "/api/v1/ingest/frames",
        headers={
            "Origin": vercel_origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-Camera-Key, Content-Type",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers.get("access-control-allow-origin") == vercel_origin
    allowed_headers = preflight.headers.get("access-control-allow-headers", "").lower()
    assert "x-camera-key" in allowed_headers


def test_production_config_disallows_sqlite_and_filesystem_fallbacks():
    from app.core.config import Settings

    sqlite_prod = Settings(
        environment="production",
        database_url="sqlite:///./wicps_dev.db",
        storage_backend="s3",
        s3_bucket="wicps-bucket",
    )
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        sqlite_prod.validate_production_requirements()

    fs_prod = Settings(
        environment="production",
        database_url="postgresql+psycopg://user:pass@ep-cool.neon.tech/wicps?sslmode=require",
        storage_backend="filesystem",
    )
    with pytest.raises(RuntimeError, match="STORAGE_BACKEND=s3"):
        fs_prod.validate_production_requirements()

    valid_prod = Settings(
        environment="production",
        database_url="postgresql+psycopg://user:pass@ep-cool.neon.tech/wicps?sslmode=require",
        storage_backend="s3",
        s3_bucket="wicps-thermal-prod",
    )
    valid_prod.validate_production_requirements()


def test_camera_village_name_fallback_when_villages_empty(phase1_client):
    client, _storage = phase1_client
    res = client.post(
        "/api/v1/cameras",
        json={
            "camera_code": "CAM-VILLAGE-FALLBACK",
            "name": "Fallback Test Tower",
            "village_id": "98dfd489-c9fe-46d8-a241-d37fff83e903",
            "village_name": "Kadambur Fringe",
            "zone_name": "Kadambur Crop Perimeter",
            "zone_type": "crop_field",
            "latitude": 11.664,
            "longitude": 76.622,
            "protocol": "http_push",
            "is_dev_test": True,
        },
    )
    assert res.status_code == 201
    body = res.json()
    assert body["village_id"] is None
    assert body["stream_metadata"]["village_name"] == "Kadambur Fringe"

    # Without village_name, unknown explicit village_id still fails with 422
    bad_res = client.post(
        "/api/v1/cameras",
        json={
            "camera_code": "CAM-VILLAGE-BAD",
            "name": "Bad Village Tower",
            "village_id": "98dfd489-c9fe-46d8-a241-d37fff83e903",
            "zone_name": "Unknown Perimeter",
            "zone_type": "crop_field",
            "latitude": 11.664,
            "longitude": 76.622,
            "protocol": "http_push",
            "is_dev_test": True,
        },
    )
    assert bad_res.status_code == 422


def test_delete_camera_preserves_historical_frames_and_storage_objects(phase1_client):
    client, storage = phase1_client

    reg = client.post(
        "/api/v1/cameras",
        json={
            "camera_code": "CAM-DEL-PRESERVE-01",
            "name": "Delete Preservation Tower",
            "zone_name": "South Buffer",
            "zone_type": "crop_field",
            "latitude": 11.66,
            "longitude": 76.62,
            "protocol": "http_push",
            "is_dev_test": True,
        },
    )
    assert reg.status_code == 201
    cam = reg.json()
    cam_id = cam["id"]
    api_key = cam["api_key"]

    img = _make_synthetic_thermal_8bit(320, 240)
    ok, png_buf = cv2.imencode(".png", img)
    assert ok
    meta = json.dumps({"camera_id": "CAM-DEL-PRESERVE-01", "timestamp": "2026-11-20T09:00:00Z"})
    ingest_res = client.post(
        "/api/v1/ingest/frames",
        headers={"X-Camera-Key": api_key},
        data={"metadata": meta},
        files={"file": ("preserve_check.png", png_buf.tobytes(), "image/png")},
    )
    assert ingest_res.status_code == 201
    frame = ingest_res.json()
    frame_id = frame["id"]
    raw_key = frame["raw_object_key"]
    proc_key = frame["processed_object_key"]
    assert proc_key is not None

    # Delete the registered camera
    del_res = client.delete(f"/api/v1/cameras/{cam_id}")
    assert del_res.status_code == 200
    del_body = del_res.json()
    assert del_body["status"] == "deleted"
    assert del_body["id"] == cam_id
    assert del_body["camera_code"] == "CAM-DEL-PRESERVE-01"
    assert del_body["preserved_frames"] == 1

    # Camera is gone from camera list and 404 on repeat delete
    cams_after = client.get("/api/v1/cameras").json()["items"]
    assert all(c["id"] != cam_id for c in cams_after)
    assert client.delete(f"/api/v1/cameras/{cam_id}").status_code == 404

    # Historical thermal frame and provenance snapshot remain intact
    frames_after = client.get("/api/v1/ingest/frames").json()["items"]
    preserved = next((f for f in frames_after if f["id"] == frame_id), None)
    assert preserved is not None
    assert preserved["camera_id"] is None
    assert preserved["camera_code"] == "CAM-DEL-PRESERVE-01"
    assert preserved["camera_name"] == "Delete Preservation Tower"
    assert preserved["zone_name"] == "South Buffer"
    assert preserved["raw_object_key"] == raw_key
    assert preserved["processed_object_key"] == proc_key

    # Object storage artifacts remain readable via image endpoint and backend storage
    assert len(storage.get_bytes(raw_key)) > 0
    assert len(storage.get_bytes(proc_key)) > 0
    assert client.get(f"/api/v1/ingest/frames/{frame_id}/image?variant=raw").status_code == 200
    assert client.get(f"/api/v1/ingest/frames/{frame_id}/image?variant=processed").status_code == 200


