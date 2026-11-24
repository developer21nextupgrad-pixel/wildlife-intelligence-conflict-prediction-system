import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampBoundingBoxPercent,
  formatDetectionSpeciesDisplay,
  mapAnimalDetectionFromApi,
  MAX_ANIMAL_DETECTION_IMAGE_BYTES,
  validateAnimalDetectionFile,
} from './apiMappers';
import type { AnimalDetectionItem } from '../types';

test('validateAnimalDetectionFile accepts jpg, jpeg, png and rejects empty/oversized/unsupported files', () => {
  assert.deepEqual(validateAnimalDetectionFile({ name: 'tiger.JPG', size: 120_000 }), {
    valid: true,
    extension: '.jpg',
  });
  assert.deepEqual(validateAnimalDetectionFile({ name: 'elephant.jpeg', size: 80_000 }), {
    valid: true,
    extension: '.jpeg',
  });
  assert.deepEqual(validateAnimalDetectionFile({ name: 'camera_trap.png', size: 512 }), {
    valid: true,
    extension: '.png',
  });

  const unsupported = validateAnimalDetectionFile({ name: 'notes.txt', size: 42 });
  assert.equal(unsupported.valid, false);

  const empty = validateAnimalDetectionFile({ name: 'empty.jpg', size: 0 });
  assert.equal(empty.valid, false);

  const tooBig = validateAnimalDetectionFile({
    name: 'huge.png',
    size: MAX_ANIMAL_DETECTION_IMAGE_BYTES + 1,
  });
  assert.equal(tooBig.valid, false);
});

test('clampBoundingBoxPercent keeps normalized boxes inside [0, 100]% bounds', () => {
  const clamped = clampBoundingBoxPercent({
    xmin: -0.2,
    ymin: 0.25,
    width: 1.5,
    height: 0.9,
    pixelXmin: 0,
    pixelYmin: 100,
    pixelWidth: 800,
    pixelHeight: 300,
  });
  assert.deepEqual(clamped, {
    leftPct: 0,
    topPct: 25,
    widthPct: 100,
    heightPct: 75,
  });
});

test('formatDetectionSpeciesDisplay flags low-confidence/needsReview items as Unknown / Needs Review', () => {
  const certain: AnimalDetectionItem = {
    index: 1,
    category: 'animal',
    detectorConfidence: 0.95,
    bbox: {
      xmin: 0.2,
      ymin: 0.1,
      width: 0.6,
      height: 0.4,
      pixelXmin: 192,
      pixelYmin: 78,
      pixelWidth: 576,
      pixelHeight: 313,
    },
    speciesLabel: 'Tiger',
    commonName: 'Tiger',
    scientificName: 'Panthera tigris',
    taxonomicLevel: 'species',
    speciesConfidence: 0.99,
    predictionSource: 'classifier',
    needsReview: false,
    topCandidates: [],
    individualReIdStatus: 'phase2_not_enabled',
  };
  assert.deepEqual(formatDetectionSpeciesDisplay(certain), {
    label: 'Tiger',
    subtitle: 'Panthera tigris',
    isUncertain: false,
  });

  const uncertain: AnimalDetectionItem = {
    ...certain,
    speciesLabel: 'Unknown / Needs Review',
    commonName: 'Wild Boar',
    speciesConfidence: 0.31,
    needsReview: true,
  };
  const disp = formatDetectionSpeciesDisplay(uncertain);
  assert.equal(disp.label, 'Unknown / Needs Review');
  assert.equal(disp.isUncertain, true);
  assert.match(disp.subtitle || '', /Wild Boar/);
});

test('mapAnimalDetectionFromApi maps snake_case response to camelCase record', () => {
  const mapped = mapAnimalDetectionFromApi(
    {
      id: 'det-123',
      source_filename: 'elephant.jpg',
      content_type: 'image/jpeg',
      file_size_bytes: 261912,
      width: 960,
      height: 640,
      image_object_key: 'animal-detections/2026-11-23/det-123.jpg',
      image_url: '/api/v1/detections/det-123/image',
      storage_backend: 'filesystem',
      processing_status: 'completed',
      detection_count: 1,
      animal_count: 1,
      primary_species: 'Asian Elephant',
      primary_common_name: 'Asian Elephant',
      primary_scientific_name: 'Elephas maximus',
      primary_confidence: 0.98,
      country_code: 'IND',
      admin1_region: null,
      detector_model: 'md_v5a.0.1.pt',
      classifier_model: 'always_crop_99710272_22x8_v12_epoch_00148.pt',
      inference_duration_ms: 4200,
      detections: [
        {
          index: 1,
          category: 'animal',
          detector_confidence: 0.94,
          bbox: {
            xmin: 0.1,
            ymin: 0.2,
            width: 0.5,
            height: 0.6,
            pixel_xmin: 96,
            pixel_ymin: 128,
            pixel_width: 480,
            pixel_height: 384,
          },
          species_label: 'Asian Elephant',
          common_name: 'Asian Elephant',
          scientific_name: 'Elephas maximus',
          taxonomic_level: 'species',
          species_confidence: 0.98,
          prediction_source: 'classifier',
          needs_review: false,
          top_candidates: [
            {
              species_label: 'Asian Elephant',
              common_name: 'Asian Elephant',
              scientific_name: 'Elephas maximus',
              confidence: 0.98,
            },
          ],
          individual_reid_status: 'phase2_not_enabled',
        },
      ],
      model_metadata: {
        detector_model: 'md_v5a.0.1.pt',
        classifier_model: 'always_crop_99710272_22x8_v12_epoch_00148.pt',
        speciesnet_version: '4.0.3a',
        geofence_enabled: true,
        country_code: 'IND',
        admin1_region: null,
        min_detection_confidence: 0.2,
        min_species_confidence: 0.5,
        thermal_imagery_supported: false,
        imagery_notice: 'RGB/IR camera-trap model',
      },
      created_at: '2026-11-23T07:10:00Z',
      updated_at: '2026-11-23T07:10:00Z',
    },
    'http://localhost:3000/api/v1/detections/det-123/image'
  );

  assert.equal(mapped.primarySpecies, 'Asian Elephant');
  assert.equal(mapped.imageUrl, 'http://localhost:3000/api/v1/detections/det-123/image');
  assert.equal(mapped.detections[0].bbox.pixelWidth, 480);
  assert.equal(mapped.modelMetadata.thermalImagerySupported, false);
});
