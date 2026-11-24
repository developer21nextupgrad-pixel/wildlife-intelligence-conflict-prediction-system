"""Phase 1 Animal Detection & Species Identification service.

Combines:
1. Animal object detection (MegaDetector v5 via ``SpeciesNetDetector``, MIT License).
2. Species classification + optional geofencing/taxonomic rollup (Google SpeciesNet, Apache-2.0).
3. Clean Phase 2 extensibility seam (``IndividualReIdExtractor``) for future MegaDescriptor
   individual animal re-identification on cropped bounding boxes.

NOTE: SpeciesNet is trained on RGB / infrared camera-trap imagery and is NOT verified for
radiometric or false-color thermal imagery.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from functools import lru_cache
import io
import logging
from pathlib import Path
import threading
import time
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError
import torch

from app.core.config import Settings, get_settings

logger = logging.getLogger("wicps.animal_detection")

SUPPORTED_ANIMAL_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
SUPPORTED_PIL_IMAGE_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png"}
EXT_TO_CONTENT_TYPE = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
}

THERMAL_IMAGERY_NOTICE = (
    "SpeciesNet (v4.0.3a) + MegaDetector v5 is calibrated for RGB / IR camera-trap imagery "
    "and is not verified for radiometric or false-color thermal frames. Phase 2 individual "
    "re-identification uses BVRA/MegaDescriptor-T-224 (CC-BY-NC-4.0) cosine similarity as a "
    "probabilistic aid — human verification is recommended for ambiguous or low-quality crops."
)

_UNKNOWN_COMMON_NAMES = {
    "",
    "blank",
    "no cv result",
    "unknown",
    "animal",
}


class UnsupportedAnimalImageError(ValueError):
    """Raised when the uploaded file extension or image format is unsupported (HTTP 415)."""


class CorruptedAnimalImageError(ValueError):
    """Raised when an uploaded image file is empty, truncated, or cannot be decoded (HTTP 422)."""


@dataclass(frozen=True)
class ValidatedAnimalImage:
    pil_image: Image.Image
    width: int
    height: int
    extension: str
    content_type: str
    file_size_bytes: int


@dataclass(frozen=True)
class ParsedTaxonomy:
    common_name: str | None
    scientific_name: str | None
    taxonomic_level: str
    is_generic_or_unknown: bool


def _format_common_name(raw_name: str) -> str:
    words = raw_name.strip().split()
    if not words:
        return ""
    return " ".join(w if w.isupper() and len(w) <= 4 else w.capitalize() for w in words)


def parse_speciesnet_taxonomy(raw_label: str | None) -> ParsedTaxonomy:
    """Parses a 7-part SpeciesNet taxonomy label:
    ``uuid;class;order;family;genus;species;common_name``.
    """
    if not raw_label or not raw_label.strip():
        return ParsedTaxonomy(
            common_name=None,
            scientific_name=None,
            taxonomic_level="unknown",
            is_generic_or_unknown=True,
        )

    parts = [p.strip() for p in raw_label.split(";")]
    while len(parts) < 7:
        parts.append("")
    _uid, cls_name, order_name, family_name, genus_name, species_name, common_raw = parts[:7]

    common_lower = common_raw.lower()
    if common_lower in _UNKNOWN_COMMON_NAMES:
        return ParsedTaxonomy(
            common_name=None,
            scientific_name=None,
            taxonomic_level="animal" if common_lower == "animal" else "unknown",
            is_generic_or_unknown=True,
        )

    common_formatted = _format_common_name(common_raw)
    if genus_name and species_name:
        scientific = f"{genus_name.capitalize()} {species_name.lower()}"
        level = "species"
    elif genus_name:
        scientific = genus_name.capitalize()
        level = "genus"
    elif family_name:
        scientific = family_name.capitalize()
        level = "family"
    elif order_name:
        scientific = order_name.capitalize()
        level = "order"
    elif cls_name:
        scientific = cls_name.capitalize()
        level = "class"
    else:
        scientific = None
        level = "unknown"

    return ParsedTaxonomy(
        common_name=common_formatted or scientific,
        scientific_name=scientific,
        taxonomic_level=level,
        is_generic_or_unknown=False,
    )


def clamp_normalized_bbox(raw_bbox: list[float] | tuple[float, ...], width: int, height: int) -> dict[str, Any]:
    if len(raw_bbox) != 4:
        xmin = ymin = w = h = 0.0
    else:
        xmin = max(0.0, min(1.0, float(raw_bbox[0])))
        ymin = max(0.0, min(1.0, float(raw_bbox[1])))
        w = max(0.0, min(1.0 - xmin, float(raw_bbox[2])))
        h = max(0.0, min(1.0 - ymin, float(raw_bbox[3])))

    return {
        "xmin": round(xmin, 6),
        "ymin": round(ymin, 6),
        "width": round(w, 6),
        "height": round(h, 6),
        "pixel_xmin": int(round(xmin * width)),
        "pixel_ymin": int(round(ymin * height)),
        "pixel_width": int(round(w * width)),
        "pixel_height": int(round(h * height)),
    }


def validate_animal_image_bytes(raw_bytes: bytes, filename: str | None) -> ValidatedAnimalImage:
    """Validates extension (.jpg/.jpeg/.png) and decodes RGB pixels cleanly."""
    clean_name = Path(filename or "upload.jpg").name
    ext = Path(clean_name).suffix.lower()
    if ext not in SUPPORTED_ANIMAL_IMAGE_EXTENSIONS:
        raise UnsupportedAnimalImageError(
            f"Unsupported image format '{ext or 'none'}'. Allowed formats: .jpg, .jpeg, .png."
        )

    if not raw_bytes:
        raise CorruptedAnimalImageError("Uploaded image file is empty (0 bytes).")

    try:
        with Image.open(io.BytesIO(raw_bytes)) as probe:
            pil_format = (probe.format or "").upper()
            probe.verify()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise CorruptedAnimalImageError(
            f"Uploaded image '{clean_name}' is corrupted or cannot be decoded."
        ) from exc

    if pil_format not in SUPPORTED_PIL_IMAGE_FORMATS:
        raise UnsupportedAnimalImageError(
            f"Image payload decoded as '{pil_format or 'unknown'}', which is not supported. Allowed: JPEG, PNG."
        )

    try:
        with Image.open(io.BytesIO(raw_bytes)) as loaded:
            loaded.load()
            rgb_image = ImageOps.exif_transpose(loaded).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise CorruptedAnimalImageError(
            f"Uploaded image '{clean_name}' failed pixel decoding."
        ) from exc

    if rgb_image.width <= 0 or rgb_image.height <= 0:
        raise CorruptedAnimalImageError("Uploaded image has zero dimensions.")

    return ValidatedAnimalImage(
        pil_image=rgb_image,
        width=rgb_image.width,
        height=rgb_image.height,
        extension=ext,
        content_type=SUPPORTED_PIL_IMAGE_FORMATS[pil_format],
        file_size_bytes=len(raw_bytes),
    )


class IndividualReIdExtractor(ABC):
    """Phase 2 extensibility interface for individual animal re-identification (MegaDescriptor)."""

    @abstractmethod
    def extract_status(self, crop: Image.Image, species_label: str) -> str:
        raise NotImplementedError


class DisabledPhase2MegaDescriptorHook(IndividualReIdExtractor):
    """Explicit Phase 1 placeholder — individual Re-ID is deferred to Phase 2."""

    def extract_status(self, crop: Image.Image, species_label: str) -> str:
        return "phase2_not_enabled"


class AnimalDetectionPipeline:
    """Thread-safe lazy loader and inference runner for MegaDetector v5 + Google SpeciesNet."""

    def __init__(
        self,
        model_name: str,
        *,
        geofence_enabled: bool = True,
        min_detection_confidence: float = 0.20,
        min_species_confidence: float = 0.50,
        max_detections_per_image: int = 25,
        reid_hook: IndividualReIdExtractor | None = None,
    ) -> None:
        self.model_name = model_name
        self.geofence_enabled = geofence_enabled
        self.min_detection_confidence = min_detection_confidence
        self.min_species_confidence = min_species_confidence
        self.max_detections_per_image = max_detections_per_image
        self.reid_hook = reid_hook or DisabledPhase2MegaDescriptorHook()

        self._load_lock = threading.Lock()
        self._infer_lock = threading.Lock()
        self._loaded = False

        self._detector: Any = None
        self._classifier: Any = None
        self._ensemble: Any = None
        self._detector_model_name = "MegaDetector v5a (md_v5a.0.1)"
        self._classifier_model_name = "Google SpeciesNet v4.0.3a (always_crop)"
        self._speciesnet_version = "4.0.3a"

    def ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._load_lock:
            if self._loaded:
                return
            from speciesnet import SpeciesNetClassifier, SpeciesNetDetector, SpeciesNetEnsemble

            t0 = time.perf_counter()
            logger.info("Loading SpeciesNet detector/classifier/ensemble (%s)...", self.model_name)
            detector = SpeciesNetDetector(self.model_name)
            classifier = SpeciesNetClassifier(self.model_name)
            ensemble = SpeciesNetEnsemble(
                self.model_name,
                geofence=self.geofence_enabled,
            )
            self._detector = detector
            self._classifier = classifier
            self._ensemble = ensemble
            info = detector.model_info
            self._detector_model_name = Path(str(info.detector)).name
            self._classifier_model_name = Path(str(info.classifier)).name
            self._speciesnet_version = str(getattr(info, "version", "4.0.3a"))
            self._loaded = True
            logger.info(
                "Loaded SpeciesNet v%s (%s + %s) in %.2fs",
                self._speciesnet_version,
                self._detector_model_name,
                self._classifier_model_name,
                time.perf_counter() - t0,
            )

    @property
    def detector_model_name(self) -> str:
        return self._detector_model_name

    @property
    def classifier_model_name(self) -> str:
        return self._classifier_model_name

    @property
    def speciesnet_version(self) -> str:
        return self._speciesnet_version

    def analyze_image(
        self,
        pil_image: Image.Image,
        *,
        image_key: str,
        country_code: str | None = None,
        admin1_region: str | None = None,
    ) -> dict[str, Any]:
        """Runs MegaDetector + SpeciesNet per-crop classification + ensemble on an RGB PIL image."""
        self.ensure_loaded()

        from speciesnet.geolocation import find_admin1_region
        from speciesnet.utils import (
            BBox,
            build_classifier_result,
            select_detections_for_classification,
        )

        started = time.perf_counter()
        width, height = pil_image.size
        clean_country = country_code.strip().upper() if country_code and country_code.strip() else None
        clean_admin1 = admin1_region.strip().upper() if admin1_region and admin1_region.strip() else None

        with self._infer_lock:
            with torch.inference_mode():
                det_preprocessed = self._detector.preprocess(pil_image)
                detector_output = self._detector.predict(image_key, det_preprocessed)
                raw_detections = detector_output.get("detections") or []
                accepted_raw = [
                    det
                    for det in raw_detections
                    if float(det.get("conf", 0.0)) >= self.min_detection_confidence
                ][: self.max_detections_per_image]

                if not accepted_raw:
                    duration_ms = max(1, int(round((time.perf_counter() - started) * 1000)))
                    return {
                        "processing_status": "no_animal_detected",
                        "detection_count": 0,
                        "animal_count": 0,
                        "primary_species": None,
                        "primary_common_name": None,
                        "primary_scientific_name": None,
                        "primary_confidence": None,
                        "country_code": clean_country,
                        "admin1_region": clean_admin1,
                        "detector_model": self._detector_model_name,
                        "classifier_model": self._classifier_model_name,
                        "speciesnet_version": self._speciesnet_version,
                        "inference_duration_ms": duration_ms,
                        "detections": [],
                    }

                filtered_detector_output = {
                    "filepath": image_key,
                    "detections": accepted_raw,
                }
                whole_image_mode = getattr(self._classifier.model_info, "type_", "") == "full_image"
                indices = (
                    []
                    if whole_image_mode
                    else select_detections_for_classification(
                        accepted_raw,
                        self.min_detection_confidence,
                        self.max_detections_per_image,
                    )
                )
                bboxes = [BBox(*accepted_raw[idx]["bbox"]) for idx in indices]
                crops = self._classifier.preprocess(pil_image, bboxes=bboxes)
                raw_classifier_pred = self._classifier.predict(image_key, crops, num_classes=5)
                classifier_result = build_classifier_result(
                    raw_classifier_pred,
                    accepted_raw,
                    indices,
                    whole_image_mode,
                )

                resolved_admin1 = (
                    find_admin1_region(clean_country, clean_admin1, None, None)
                    if clean_country
                    else clean_admin1
                )
                ensembled_list = self._ensemble.combine(
                    filepaths=[image_key],
                    classifier_results={image_key: classifier_result},
                    detector_results={image_key: filtered_detector_output},
                    geolocation_results={
                        image_key: {
                            "country": clean_country,
                            "admin1_region": resolved_admin1,
                        }
                    },
                    max_classifications_per_detection=3,
                )

        ensembled = ensembled_list[0] if ensembled_list else {"detections": accepted_raw}
        ensembled_detections = ensembled.get("detections") or []

        parsed_items: list[dict[str, Any]] = []
        animal_items: list[dict[str, Any]] = []

        for idx, det in enumerate(ensembled_detections, start=1):
            category_raw = str(det.get("label") or "animal").lower()
            category = category_raw if category_raw in {"animal", "human", "vehicle"} else "animal"
            det_conf = float(det.get("conf", 0.0))
            bbox_dict = clamp_normalized_bbox(det.get("bbox") or [], width, height)

            if category in {"human", "vehicle"}:
                display = "Human" if category == "human" else "Vehicle"
                needs_review = det_conf < self.min_species_confidence
                parsed_items.append(
                    {
                        "index": idx,
                        "category": category,
                        "detector_confidence": round(det_conf, 4),
                        "bbox": bbox_dict,
                        "species_label": display if not needs_review else "Unknown / Needs Review",
                        "common_name": display,
                        "scientific_name": "Homo sapiens" if category == "human" else None,
                        "taxonomic_level": "species" if category == "human" else "non_wildlife",
                        "taxonomy_raw": None,
                        "species_confidence": round(det_conf, 4),
                        "prediction_source": "detector",
                        "needs_review": needs_review,
                        "top_candidates": [],
                        "individual_reid_status": "not_applicable",
                    }
                )
                continue

            proc = det.get("processed_classification") or {}
            raw_cls_label = proc.get("class")
            species_conf = float(proc.get("score") if proc.get("score") is not None else det_conf)
            pred_source = proc.get("source") or "detector"
            parsed = parse_speciesnet_taxonomy(raw_cls_label)

            # Parse top raw candidates cleanly for operator transparency
            top_candidates: list[dict[str, Any]] = []
            raw_cls = det.get("raw_classifications") or {}
            for cand_label, cand_score in zip(
                raw_cls.get("classes") or [],
                raw_cls.get("scores") or [],
            ):
                score_val = float(cand_score)
                if score_val < 0.001:
                    continue
                cand_parsed = parse_speciesnet_taxonomy(cand_label)
                if not cand_parsed.is_generic_or_unknown and cand_parsed.common_name:
                    top_candidates.append(
                        {
                            "species_label": cand_parsed.common_name,
                            "common_name": cand_parsed.common_name,
                            "scientific_name": cand_parsed.scientific_name,
                            "confidence": round(score_val, 4),
                        }
                    )

            needs_review = (
                parsed.is_generic_or_unknown
                or species_conf < self.min_species_confidence
            )
            species_label = (
                "Unknown / Needs Review"
                if needs_review
                else (parsed.common_name or "Unknown / Needs Review")
            )

            # Crop region cleanly passed to Phase 2 hook (currently a no-op marker)
            x0, y0 = bbox_dict["pixel_xmin"], bbox_dict["pixel_ymin"]
            x1 = min(width, x0 + max(1, bbox_dict["pixel_width"]))
            y1 = min(height, y0 + max(1, bbox_dict["pixel_height"]))
            crop_img = pil_image.crop((x0, y0, x1, y1)) if x1 > x0 and y1 > y0 else pil_image
            reid_status = self.reid_hook.extract_status(crop_img, species_label)

            item = {
                "index": idx,
                "category": "animal",
                "detector_confidence": round(det_conf, 4),
                "bbox": bbox_dict,
                "species_label": species_label,
                "common_name": parsed.common_name,
                "scientific_name": parsed.scientific_name,
                "taxonomic_level": parsed.taxonomic_level,
                "taxonomy_raw": raw_cls_label,
                "species_confidence": round(species_conf, 4),
                "prediction_source": pred_source,
                "needs_review": needs_review,
                "top_candidates": top_candidates,
                "individual_reid_status": reid_status,
            }
            parsed_items.append(item)
            animal_items.append(item)

        animal_count = len(animal_items)
        if animal_count == 0:
            processing_status = "no_animal_detected"
            primary_species = None
            primary_common = None
            primary_scientific = None
            primary_conf = None
        else:
            # Prefer non-review species-level detections over coarser family/genus rollups
            ranked_animals = sorted(
                animal_items,
                key=lambda x: (
                    not x["needs_review"],
                    x.get("taxonomic_level") == "species",
                    x["species_confidence"],
                    x["detector_confidence"],
                ),
                reverse=True,
            )
            lead = ranked_animals[0]
            all_need_review = all(x["needs_review"] for x in animal_items)
            processing_status = "needs_review" if all_need_review else "completed"
            primary_species = lead["species_label"]
            primary_common = lead["common_name"]
            primary_scientific = lead["scientific_name"]
            primary_conf = lead["species_confidence"]

        duration_ms = max(1, int(round((time.perf_counter() - started) * 1000)))
        return {
            "processing_status": processing_status,
            "detection_count": len(parsed_items),
            "animal_count": animal_count,
            "primary_species": primary_species,
            "primary_common_name": primary_common,
            "primary_scientific_name": primary_scientific,
            "primary_confidence": primary_conf,
            "country_code": clean_country,
            "admin1_region": resolved_admin1 if animal_items else clean_admin1,
            "detector_model": self._detector_model_name,
            "classifier_model": self._classifier_model_name,
            "speciesnet_version": self._speciesnet_version,
            "inference_duration_ms": duration_ms,
            "detections": parsed_items,
        }


@lru_cache(maxsize=1)
def build_animal_detection_pipeline(
    model_name: str,
    geofence_enabled: bool,
    min_detection_confidence: float,
    min_species_confidence: float,
    max_detections_per_image: int,
) -> AnimalDetectionPipeline:
    return AnimalDetectionPipeline(
        model_name=model_name,
        geofence_enabled=geofence_enabled,
        min_detection_confidence=min_detection_confidence,
        min_species_confidence=min_species_confidence,
        max_detections_per_image=max_detections_per_image,
    )


def get_animal_detection_pipeline(
    settings: Settings | None = None,
) -> AnimalDetectionPipeline:
    cfg = settings or get_settings()
    return build_animal_detection_pipeline(
        model_name=cfg.speciesnet_model,
        geofence_enabled=cfg.speciesnet_geofence_enabled,
        min_detection_confidence=cfg.speciesnet_min_detection_confidence,
        min_species_confidence=cfg.speciesnet_min_species_confidence,
        max_detections_per_image=cfg.speciesnet_max_detections_per_image,
    )
