"""Phase 2 Individual Animal Re-Identification feature extractor using BVRA MegaDescriptor.

Model: BVRA/MegaDescriptor-T-224 (CC-BY-NC-4.0, Swin-Tiny backbone, 768-dim L2-normalized embeddings).
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import logging
import threading
import time
from typing import Any

import cv2
import numpy as np
from PIL import Image
import torch

from app.core.config import Settings, get_settings

logger = logging.getLogger("wicps.megadescriptor")

MEGADESCRIPTOR_LICENSE = "CC-BY-NC-4.0 (BVRA/WildlifeDatasets non-commercial research & conservation)"


@dataclass(frozen=True)
class CropQualityResult:
    quality_passed: bool
    reason: str | None
    crop_width: int
    crop_height: int
    blur_score: float
    intensity_std: float


def assess_crop_quality(
    crop: Image.Image,
    *,
    min_crop_px: int = 48,
    min_blur_laplacian: float = 25.0,
) -> CropQualityResult:
    """Checks crop resolution, sharpness (Laplacian variance), and uniformity before auto-matching."""
    rgb = crop.convert("RGB")
    w, h = rgb.size
    arr = np.asarray(rgb, dtype=np.uint8)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY) if arr.size > 0 else np.zeros((1, 1), dtype=np.uint8)
    blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var()) if gray.size >= 9 else 0.0
    intensity_std = float(gray.std()) if gray.size > 0 else 0.0

    if w < min_crop_px or h < min_crop_px:
        return CropQualityResult(
            quality_passed=False,
            reason=f"crop_too_small (<{min_crop_px}px)",
            crop_width=w,
            crop_height=h,
            blur_score=round(blur_score, 2),
            intensity_std=round(intensity_std, 2),
        )

    if intensity_std < 6.0:
        return CropQualityResult(
            quality_passed=False,
            reason="uniform_or_blank_crop",
            crop_width=w,
            crop_height=h,
            blur_score=round(blur_score, 2),
            intensity_std=round(intensity_std, 2),
        )

    if blur_score < min_blur_laplacian:
        return CropQualityResult(
            quality_passed=False,
            reason=f"low_sharpness_blur (<{min_blur_laplacian:.1f})",
            crop_width=w,
            crop_height=h,
            blur_score=round(blur_score, 2),
            intensity_std=round(intensity_std, 2),
        )

    return CropQualityResult(
        quality_passed=True,
        reason=None,
        crop_width=w,
        crop_height=h,
        blur_score=round(blur_score, 2),
        intensity_std=round(intensity_std, 2),
    )


class MegaDescriptorExtractor:
    """Thread-safe lazy loader and embedding extractor for BVRA MegaDescriptor."""

    def __init__(
        self,
        model_name: str = "hf-hub:BVRA/MegaDescriptor-T-224",
        *,
        input_size: int = 224,
        embedding_dim: int = 768,
    ) -> None:
        self.model_name = model_name
        self.input_size = input_size
        self.embedding_dim = embedding_dim
        self.model_version = model_name.split("/")[-1] if "/" in model_name else model_name

        self._load_lock = threading.Lock()
        self._infer_lock = threading.Lock()
        self._loaded = False
        self._model: Any = None
        self._transform: Any = None

    def ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._load_lock:
            if self._loaded:
                return
            import timm
            from torchvision import transforms

            t0 = time.perf_counter()
            logger.info("Loading BVRA MegaDescriptor model (%s)...", self.model_name)
            model = timm.create_model(self.model_name, pretrained=True)
            model.eval()
            transform = transforms.Compose(
                [
                    transforms.Resize((self.input_size, self.input_size)),
                    transforms.ToTensor(),
                    transforms.Normalize([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]),
                ]
            )
            self._model = model
            self._transform = transform
            self._loaded = True
            logger.info(
                "Loaded %s in %.2fs", self.model_version, time.perf_counter() - t0
            )

    def extract_embedding(self, crop: Image.Image) -> list[float]:
        """Extracts an L2-normalized 768-dim embedding vector from an RGB animal crop."""
        self.ensure_loaded()
        rgb = crop.convert("RGB")
        with self._infer_lock:
            tensor = self._transform(rgb).unsqueeze(0)
            with torch.inference_mode():
                features = self._model(tensor)
            vec = features.squeeze(0).detach().cpu().numpy().astype(np.float32)

        norm = float(np.linalg.norm(vec))
        if norm > 1e-12:
            vec = vec / norm
        return [float(x) for x in vec.tolist()]


@lru_cache(maxsize=1)
def build_megadescriptor_extractor(
    model_name: str,
    embedding_dim: int,
) -> MegaDescriptorExtractor:
    return MegaDescriptorExtractor(
        model_name=model_name,
        input_size=224,
        embedding_dim=embedding_dim,
    )


def get_megadescriptor_extractor(
    settings: Settings | None = None,
) -> MegaDescriptorExtractor:
    cfg = settings or get_settings()
    return build_megadescriptor_extractor(
        model_name=cfg.megadescriptor_model,
        embedding_dim=cfg.megadescriptor_embedding_dim,
    )
