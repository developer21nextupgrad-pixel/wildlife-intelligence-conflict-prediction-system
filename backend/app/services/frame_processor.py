from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import io
import ipaddress
import os
from pathlib import Path
import socket
import tempfile
from typing import Any
from urllib.parse import urlsplit

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError

SUPPORTED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}
SUPPORTED_VIDEO_EXTENSIONS = {".mp4", ".avi"}

TARGET_SIZE = 640
MIN_WIDTH = 160
MIN_HEIGHT = 120
MAX_DIMENSION = 8192
MIN_INTENSITY_STD = 1.5
MIN_DYNAMIC_RANGE = 2.0


class UnsupportedMediaError(ValueError):
    """Raised when uploaded file extension or stream type is unsupported."""


class MediaLimitError(ValueError):
    """Raised when uploaded file or video exceeds safety limits."""


class RtspConnectionError(RuntimeError):
    """Raised when an RTSP stream cannot be opened or timed out."""


@dataclass
class FrameProcessingOutcome:
    frame_index: int
    captured_at: datetime
    width: int
    height: int
    pixel_format: str
    qc_passed: bool
    qc_metrics: dict[str, Any]
    rejection_reason: str | None
    raw_bytes: bytes
    raw_extension: str
    raw_content_type: str
    processed_png_bytes: bytes | None


def _extension_to_content_type(ext: str) -> str:
    ext = ext.lower()
    if ext == ".png":
        return "image/png"
    if ext in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if ext in {".tif", ".tiff"}:
        return "image/tiff"
    return "application/octet-stream"


def _decode_image_array(raw_bytes: bytes) -> np.ndarray | None:
    arr = np.frombuffer(raw_bytes, dtype=np.uint8)
    if arr.size == 0:
        return None
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    if img is not None and img.size > 0:
        return img

    # Fallback via Pillow for TIFF variants OpenCV imdecode may reject
    try:
        with Image.open(io.BytesIO(raw_bytes)) as pil_img:
            pil_img.load()
            np_img = np.array(pil_img)
            if np_img.size == 0:
                return None
            if np_img.ndim == 3 and np_img.shape[2] >= 3:
                if np_img.shape[2] == 4:
                    return cv2.cvtColor(np_img, cv2.COLOR_RGBA2BGRA)
                return cv2.cvtColor(np_img, cv2.COLOR_RGB2BGR)
            return np_img
    except (UnidentifiedImageError, OSError, ValueError):
        return None


def _to_grayscale_and_metadata(img: np.ndarray) -> tuple[np.ndarray, str, int]:
    """
    Returns (single-channel array preserving dtype, pixel_format label, bit_depth).
    """
    dtype = img.dtype
    if img.ndim == 2:
        if dtype == np.uint16:
            return img, "uint16_radiometric", 16
        if dtype == np.uint8:
            return img, "uint8_gray", 8
        if np.issubdtype(dtype, np.floating):
            return img, "float32_radiometric", 32
        return img.astype(np.uint16), "uint16_radiometric", 16

    channels = img.shape[2]
    if channels == 1:
        squeezed = img[:, :, 0]
        if dtype == np.uint16:
            return squeezed, "uint16_radiometric", 16
        return squeezed, "uint8_gray", 8

    if channels == 4:
        if dtype == np.uint16:
            gray = cv2.cvtColor(img, cv2.COLOR_BGRA2GRAY)
            return gray, "uint16_radiometric", 16
        gray = cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_BGRA2GRAY)
        return gray, "uint8_rgba", 8

    if dtype == np.uint16:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        return gray, "uint16_radiometric", 16

    gray = cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_BGR2GRAY)
    return gray, "uint8_rgb", 8


def _normalize_to_uint8(
    gray: np.ndarray, bit_depth: int
) -> tuple[np.ndarray, dict[str, Any]]:
    raw_min = float(np.min(gray))
    raw_max = float(np.max(gray))
    raw_mean = float(np.mean(gray))
    raw_std = float(np.std(gray))
    dynamic_range = raw_max - raw_min

    if bit_depth > 8 or gray.dtype != np.uint8:
        p_low = float(np.percentile(gray, 1.0))
        p_high = float(np.percentile(gray, 99.5))
        if p_high - p_low >= 1e-6:
            scaled = np.clip((gray.astype(np.float32) - p_low) / (p_high - p_low), 0.0, 1.0)
            norm_u8 = (scaled * 255.0).round().astype(np.uint8)
            norm_method = "percentile_1_99.5_to_uint8"
            low_bound, high_bound = p_low, p_high
        elif dynamic_range >= 1e-6:
            scaled = (gray.astype(np.float32) - raw_min) / dynamic_range
            norm_u8 = (scaled * 255.0).round().astype(np.uint8)
            norm_method = "minmax_to_uint8"
            low_bound, high_bound = raw_min, raw_max
        else:
            norm_u8 = np.zeros(gray.shape, dtype=np.uint8)
            norm_method = "flat_zero"
            low_bound, high_bound = raw_min, raw_max
    else:
        norm_u8 = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
        norm_method = "uint8_minmax"
        low_bound, high_bound = raw_min, raw_max

    stats = {
        "bit_depth": bit_depth,
        "min_raw": round(raw_min, 4),
        "max_raw": round(raw_max, 4),
        "mean_intensity": round(raw_mean, 4),
        "std_intensity": round(raw_std, 4),
        "dynamic_range": round(dynamic_range, 4),
        "normalization_method": norm_method,
        "norm_low_raw": round(low_bound, 4),
        "norm_high_raw": round(high_bound, 4),
    }
    return norm_u8, stats


def letterbox_resize(image: np.ndarray, target_size: int = TARGET_SIZE) -> np.ndarray:
    """Aspect-ratio-preserving resize + center padding to target_size x target_size."""
    h, w = image.shape[:2]
    scale = min(target_size / float(w), target_size / float(h))
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))

    interp = cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR
    resized = cv2.resize(image, (new_w, new_h), interpolation=interp)

    canvas = np.zeros((target_size, target_size), dtype=np.uint8)
    pad_top = (target_size - new_h) // 2
    pad_left = (target_size - new_w) // 2
    canvas[pad_top : pad_top + new_h, pad_left : pad_left + new_w] = resized
    return cv2.cvtColor(canvas, cv2.COLOR_GRAY2BGR)


def process_decoded_array(
    img: np.ndarray,
    *,
    raw_bytes: bytes,
    raw_extension: str,
    raw_content_type: str,
    frame_index: int = 0,
    captured_at: datetime | None = None,
) -> FrameProcessingOutcome:
    ts = captured_at or datetime.now(timezone.utc)
    h, w = img.shape[:2]
    gray, pixel_format, bit_depth = _to_grayscale_and_metadata(img)
    norm_u8, stats = _normalize_to_uint8(gray, bit_depth)
    sharpness = float(cv2.Laplacian(norm_u8, cv2.CV_64F).var()) if w >= 3 and h >= 3 else 0.0

    qc_metrics: dict[str, Any] = {
        "decode_ok": True,
        "width": int(w),
        "height": int(h),
        "sharpness_laplacian": round(sharpness, 4),
        **stats,
    }

    if w < MIN_WIDTH or h < MIN_HEIGHT:
        qc_metrics["is_blank_or_uniform"] = stats["std_intensity"] < MIN_INTENSITY_STD
        return FrameProcessingOutcome(
            frame_index=frame_index,
            captured_at=ts,
            width=int(w),
            height=int(h),
            pixel_format=pixel_format,
            qc_passed=False,
            qc_metrics=qc_metrics,
            rejection_reason=(
                f"Image dimensions {w}x{h} below minimum required {MIN_WIDTH}x{MIN_HEIGHT}."
            ),
            raw_bytes=raw_bytes,
            raw_extension=raw_extension,
            raw_content_type=raw_content_type,
            processed_png_bytes=None,
        )

    if w > MAX_DIMENSION or h > MAX_DIMENSION:
        qc_metrics["is_blank_or_uniform"] = False
        return FrameProcessingOutcome(
            frame_index=frame_index,
            captured_at=ts,
            width=int(w),
            height=int(h),
            pixel_format=pixel_format,
            qc_passed=False,
            qc_metrics=qc_metrics,
            rejection_reason=f"Image dimensions {w}x{h} exceed max allowed {MAX_DIMENSION}px.",
            raw_bytes=raw_bytes,
            raw_extension=raw_extension,
            raw_content_type=raw_content_type,
            processed_png_bytes=None,
        )

    is_blank = stats["std_intensity"] < MIN_INTENSITY_STD or stats["dynamic_range"] < MIN_DYNAMIC_RANGE
    qc_metrics["is_blank_or_uniform"] = bool(is_blank)
    if is_blank:
        return FrameProcessingOutcome(
            frame_index=frame_index,
            captured_at=ts,
            width=int(w),
            height=int(h),
            pixel_format=pixel_format,
            qc_passed=False,
            qc_metrics=qc_metrics,
            rejection_reason=(
                f"Blank or uniform thermal frame detected (std={stats['std_intensity']:.3f}, "
                f"range={stats['dynamic_range']:.3f})."
            ),
            raw_bytes=raw_bytes,
            raw_extension=raw_extension,
            raw_content_type=raw_content_type,
            processed_png_bytes=None,
        )

    # Preprocessing pipeline: Gaussian noise reduction -> CLAHE -> 640x640 letterbox resize
    denoised = cv2.GaussianBlur(norm_u8, (3, 3), sigmaX=0.8)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(denoised)
    processed_bgr = letterbox_resize(enhanced, TARGET_SIZE)

    ok, encoded = cv2.imencode(".png", processed_bgr)
    if not ok:
        raise RuntimeError("Failed to encode preprocessed thermal frame to PNG.")

    qc_metrics["clahe_applied"] = True
    qc_metrics["gaussian_denoise_kernel"] = "3x3"
    qc_metrics["processed_width"] = TARGET_SIZE
    qc_metrics["processed_height"] = TARGET_SIZE
    qc_metrics["processed_mean_intensity"] = round(float(np.mean(enhanced)), 4)
    qc_metrics["processed_std_intensity"] = round(float(np.std(enhanced)), 4)

    return FrameProcessingOutcome(
        frame_index=frame_index,
        captured_at=ts,
        width=int(w),
        height=int(h),
        pixel_format=pixel_format,
        qc_passed=True,
        qc_metrics=qc_metrics,
        rejection_reason=None,
        raw_bytes=raw_bytes,
        raw_extension=raw_extension,
        raw_content_type=raw_content_type,
        processed_png_bytes=encoded.tobytes(),
    )


def process_image_bytes(
    raw_bytes: bytes,
    filename: str,
    captured_at: datetime | None = None,
    frame_index: int = 0,
) -> FrameProcessingOutcome:
    ext = Path(filename or "").suffix.lower()
    if ext not in SUPPORTED_IMAGE_EXTENSIONS:
        raise UnsupportedMediaError(
            f"Unsupported image extension '{ext or 'none'}'. Allowed: {sorted(SUPPORTED_IMAGE_EXTENSIONS)}."
        )
    if not raw_bytes:
        raise UnsupportedMediaError("Uploaded image file is empty.")

    ts = captured_at or datetime.now(timezone.utc)
    content_type = _extension_to_content_type(ext)
    img = _decode_image_array(raw_bytes)
    if img is None:
        return FrameProcessingOutcome(
            frame_index=frame_index,
            captured_at=ts,
            width=0,
            height=0,
            pixel_format="unknown",
            qc_passed=False,
            qc_metrics={"decode_ok": False, "byte_size": len(raw_bytes)},
            rejection_reason="Corrupted or unreadable image payload.",
            raw_bytes=raw_bytes,
            raw_extension=ext,
            raw_content_type=content_type,
            processed_png_bytes=None,
        )

    return process_decoded_array(
        img,
        raw_bytes=raw_bytes,
        raw_extension=ext,
        raw_content_type=content_type,
        frame_index=frame_index,
        captured_at=ts,
    )


def process_video_bytes(
    video_bytes: bytes,
    filename: str,
    *,
    target_fps: float = 5.0,
    max_duration_seconds: float = 30.0,
    max_frames: int = 150,
    start_captured_at: datetime | None = None,
) -> tuple[list[FrameProcessingOutcome], dict[str, Any]]:
    ext = Path(filename or "").suffix.lower()
    if ext not in SUPPORTED_VIDEO_EXTENSIONS:
        raise UnsupportedMediaError(
            f"Unsupported video extension '{ext or 'none'}'. Allowed: {sorted(SUPPORTED_VIDEO_EXTENSIONS)}."
        )
    if not video_bytes:
        raise UnsupportedMediaError("Uploaded video file is empty.")
    if target_fps <= 0 or target_fps > 30:
        raise ValueError("target_fps must be between 0.1 and 30.")

    base_ts = start_captured_at or datetime.now(timezone.utc)
    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(video_bytes)
            tmp_path = tmp.name

        cap = cv2.VideoCapture(tmp_path)
        if not cap.isOpened():
            raise ValueError("Corrupted or unreadable video container.")

        try:
            native_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
            if native_fps <= 0 or not np.isfinite(native_fps):
                native_fps = 25.0
            total_src_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            est_duration = (total_src_frames / native_fps) if total_src_frames > 0 else 0.0
            if est_duration > max_duration_seconds * 1.15:
                raise MediaLimitError(
                    f"Video duration (~{est_duration:.1f}s) exceeds maximum allowed {max_duration_seconds:.0f}s."
                )

            step_ms = 1000.0 / target_fps
            next_sample_ms = 0.0
            outcomes: list[FrameProcessingOutcome] = []
            src_idx = 0

            while len(outcomes) < max_frames:
                ok, frame = cap.read()
                if not ok or frame is None:
                    break

                pos_ms = float(cap.get(cv2.CAP_PROP_POS_MSEC) or 0.0)
                if pos_ms <= 0.0 and src_idx > 0:
                    pos_ms = (src_idx / native_fps) * 1000.0

                if pos_ms > max_duration_seconds * 1000.0 + 100.0:
                    break

                if src_idx == 0 or pos_ms + 1e-3 >= next_sample_ms:
                    ok_enc, raw_png = cv2.imencode(".png", frame)
                    if ok_enc:
                        frame_ts = base_ts + timedelta(milliseconds=pos_ms)
                        outcome = process_decoded_array(
                            frame,
                            raw_bytes=raw_png.tobytes(),
                            raw_extension=".png",
                            raw_content_type="image/png",
                            frame_index=len(outcomes),
                            captured_at=frame_ts,
                        )
                        outcomes.append(outcome)
                    while next_sample_ms <= pos_ms + 1e-3:
                        next_sample_ms += step_ms

                src_idx += 1

            if not outcomes:
                raise ValueError("Video stream contained zero decodable frames.")

            summary = {
                "native_fps": round(native_fps, 3),
                "target_fps": target_fps,
                "source_frame_count": total_src_frames,
                "extracted_frame_count": len(outcomes),
            }
            return outcomes, summary
        finally:
            cap.release()
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


_BLOCKED_METADATA_HOSTS = {
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
    "metadata",
    "instance-data",
}


def _is_public_ip(ip_obj: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if (
        ip_obj.is_private
        or ip_obj.is_loopback
        or ip_obj.is_link_local
        or ip_obj.is_multicast
        or ip_obj.is_reserved
        or ip_obj.is_unspecified
        or not ip_obj.is_global
    ):
        return False
    # Reject IPv4-mapped IPv6 addresses resolving to non-global IPv4
    if isinstance(ip_obj, ipaddress.IPv6Address) and ip_obj.ipv4_mapped is not None:
        return _is_public_ip(ip_obj.ipv4_mapped)
    return True


def validate_rtsp_url_safe(
    rtsp_url: str,
    *,
    allowed_hosts: set[str] | None = None,
) -> str:
    """Validates RTSP URL scheme/host and blocks SSRF into loopback, private, link-local, and metadata IPs."""
    cleaned = rtsp_url.strip()
    parsed = urlsplit(cleaned)
    if parsed.scheme.lower() not in {"rtsp", "rtsps"} or not parsed.hostname:
        raise ValueError(
            "Invalid RTSP URL. Must start with rtsp:// or rtsps:// and include a host."
        )

    port = parsed.port or (322 if parsed.scheme.lower() == "rtsps" else 554)
    if not (1 <= port <= 65535):
        raise ValueError("Invalid RTSP URL port.")

    hostname = parsed.hostname.strip().lower().rstrip(".")
    allowlist = {h.lower() for h in (allowed_hosts or set()) if h.strip()}
    if hostname in allowlist:
        return cleaned

    if hostname in _BLOCKED_METADATA_HOSTS or hostname.endswith(".local") or hostname.endswith(".internal"):
        raise ValueError(
            f"RTSP host '{hostname}' is blocked for SSRF protection (internal/loopback/metadata hosts disallowed)."
        )

    try:
        ip_literal = ipaddress.ip_address(hostname)
    except ValueError:
        ip_literal = None

    if ip_literal is not None:
        if not _is_public_ip(ip_literal):
            raise ValueError(
                f"RTSP address '{ip_literal}' is blocked for SSRF protection (non-public IP range)."
            )
        return cleaned

    try:
        addr_infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise RtspConnectionError(f"Unable to resolve RTSP hostname '{hostname}': {exc}") from exc

    resolved_ips: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for info in addr_infos:
        sockaddr = info[4]
        raw_ip = str(sockaddr[0]).split("%", 1)[0]
        try:
            ip_obj = ipaddress.ip_address(raw_ip)
        except ValueError:
            continue
        resolved_ips.append(ip_obj)
        if not _is_public_ip(ip_obj):
            raise ValueError(
                f"RTSP host '{hostname}' resolves to blocked non-public IP '{ip_obj}'."
            )

    if not resolved_ips:
        raise RtspConnectionError(f"RTSP hostname '{hostname}' did not resolve to any valid IP address.")

    return cleaned


def test_pull_rtsp_stream(
    rtsp_url: str,
    *,
    max_frames: int = 5,
    timeout_seconds: float = 8.0,
    allowed_hosts: set[str] | None = None,
) -> list[FrameProcessingOutcome]:
    cleaned_url = validate_rtsp_url_safe(rtsp_url, allowed_hosts=allowed_hosts)
    timeout_ms = int(max(1.0, timeout_seconds) * 1000)

    cap = None
    try:
        cap_params = [
            cv2.CAP_PROP_OPEN_TIMEOUT_MSEC,
            timeout_ms,
            cv2.CAP_PROP_READ_TIMEOUT_MSEC,
            timeout_ms,
        ]
        try:
            cap = cv2.VideoCapture(cleaned_url, cv2.CAP_FFMPEG, cap_params)
        except (TypeError, cv2.error):
            cap = cv2.VideoCapture(cleaned_url, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout_ms)
            cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, timeout_ms)

        if not cap.isOpened():
            raise RtspConnectionError("Unable to connect to RTSP stream within timeout.")

        outcomes: list[FrameProcessingOutcome] = []
        deadline = datetime.now(timezone.utc) + timedelta(seconds=timeout_seconds)
        frame_idx = 0
        while len(outcomes) < max_frames and datetime.now(timezone.utc) < deadline:
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            ok_enc, raw_png = cv2.imencode(".png", frame)
            if ok_enc:
                outcomes.append(
                    process_decoded_array(
                        frame,
                        raw_bytes=raw_png.tobytes(),
                        raw_extension=".png",
                        raw_content_type="image/png",
                        frame_index=frame_idx,
                        captured_at=datetime.now(timezone.utc),
                    )
                )
                frame_idx += 1

        if not outcomes:
            raise RtspConnectionError("RTSP stream opened but yielded zero readable frames.")
        return outcomes
    finally:
        if cap is not None:
            cap.release()
