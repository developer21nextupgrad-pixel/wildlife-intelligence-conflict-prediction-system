import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildThermalFrameFilterQuery,
  mapCameraCreateFromApi,
  mapCameraFromApi,
  mapCameraToCreatePayload,
  mapDevSampleIngestFromApi,
  mapRtspTestPullFromApi,
  mapThermalFrameFromApi,
  maskRtspUrlCredentials,
  MAX_THERMAL_IMAGE_BYTES,
  MAX_THERMAL_VIDEO_BYTES,
  validateThermalCameraForm,
  validateThermalSampleFile,
} from './apiMappers';

test('validateThermalCameraForm enforces blank/valid inputs and coordinate bounds', () => {
  assert.equal(
    validateThermalCameraForm({
      cameraCode: '',
      name: 'Cam 1',
      zoneName: 'Zone A',
      zoneType: 'crop_field',
      protocol: 'http_push',
      latitude: '11.66',
      longitude: '76.62',
    }),
    'Camera ID / Code is required.'
  );

  assert.equal(
    validateThermalCameraForm({
      cameraCode: 'BAD CODE!',
      name: 'Cam 1',
      zoneName: 'Zone A',
      zoneType: 'crop_field',
      protocol: 'http_push',
      latitude: '11.66',
      longitude: '76.62',
    }),
    'Camera Code may contain only letters, numbers, hyphens, underscores, and dots.'
  );

  assert.equal(
    validateThermalCameraForm({
      cameraCode: 'CAM-01',
      name: 'North Gate',
      zoneName: 'Mangala Buffer',
      zoneType: '',
      protocol: 'http_push',
      latitude: '11.66',
      longitude: '76.62',
    }),
    'Zone type is required.'
  );

  assert.equal(
    validateThermalCameraForm({
      cameraCode: 'CAM-01',
      name: 'North Gate',
      zoneName: 'Mangala Buffer',
      zoneType: 'crop_field',
      protocol: 'http_push',
      latitude: '95',
      longitude: '76.62',
    }),
    'Latitude must be a finite number between -90 and 90.'
  );

  assert.equal(
    validateThermalCameraForm({
      cameraCode: 'CAM-01',
      name: 'North Gate',
      zoneName: 'Mangala Buffer',
      zoneType: 'crop_field',
      protocol: 'http_push',
      latitude: '11.664',
      longitude: '76.622',
    }),
    null
  );
});

test('camera mappers round-trip snake_case DTOs and one-time API key payload', () => {
  const payload = mapCameraToCreatePayload({
    cameraCode: ' CAM-TEST-01 ',
    name: ' West Perimeter ',
    villageId: undefined,
    villageName: 'Mangala',
    zoneName: ' West Crop Buffer ',
    zoneType: 'crop_field',
    latitude: 11.66,
    longitude: 76.62,
    protocol: 'rtsp',
    streamMetadata: { stream_url: 'rtsp://10.0.0.10/stream' },
    isDevTest: true,
  });

  assert.equal(payload.camera_code, 'CAM-TEST-01');
  assert.equal(payload.zone_name, 'West Crop Buffer');
  assert.equal(payload.is_dev_test, true);

  const created = mapCameraCreateFromApi({
    id: 'cam-uuid-1',
    camera_code: 'CAM-TEST-01',
    name: 'West Perimeter',
    village_id: null,
    zone_name: 'West Crop Buffer',
    zone_type: 'crop_field',
    latitude: 11.66,
    longitude: 76.62,
    protocol: 'rtsp',
    stream_metadata: { stream_url: 'rtsp://***@10.0.0.10/stream' },
    status: 'active',
    last_heartbeat_at: null,
    is_dev_test: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    api_key: 'wicps_cam_secret123',
    api_key_notice: 'Shown once only.',
  });

  assert.equal(created.cameraCode, 'CAM-TEST-01');
  assert.equal(created.apiKey, 'wicps_cam_secret123');
  assert.equal(mapCameraFromApi(created as never).protocol, 'rtsp');
});

test('thermal frame, dev sample, and RTSP mappers handle QC accepted and rejected records', () => {
  const frame = mapThermalFrameFromApi({
    id: 'frame-1',
    camera_id: 'cam-1',
    camera_code: 'CAM-01',
    camera_name: 'Cam 1',
    zone_name: 'Zone A',
    capture_mode: 'dev_sample_upload',
    source_filename: 'thermal_16bit.tiff',
    captured_at: '2026-02-01T10:00:00Z',
    frame_index: 0,
    width: 640,
    height: 512,
    pixel_format: 'uint16_radiometric',
    qc_passed: true,
    qc_metrics: { bit_depth: 16, clahe_applied: true, processed_width: 640, processed_height: 640 },
    rejection_reason: null,
    raw_object_key: 'raw-frames/CAM-01/2026-02-01/frame-1.tiff',
    processed_object_key: 'processed-frames/CAM-01/2026-02-01/frame-1_640x640.png',
    processing_status: 'preprocessed',
    is_dev_test: true,
    created_at: '2026-02-01T10:00:00Z',
    updated_at: '2026-02-01T10:00:00Z',
  });

  assert.equal(frame.pixelFormat, 'uint16_radiometric');
  assert.equal(frame.qcPassed, true);
  assert.equal(frame.qcMetrics.bit_depth, 16);

  const ingest = mapDevSampleIngestFromApi({
    mode: 'DEVELOPMENT_TEST_MODE',
    notice: 'Stage 1 only',
    camera_id: 'cam-1',
    camera_code: 'CAM-01',
    storage_backend: 'filesystem',
    media_type: 'video',
    extracted_count: 10,
    accepted_count: 9,
    rejected_count: 1,
    video_summary: { native_fps: 10, target_fps: 5, source_frame_count: 20, extracted_frame_count: 10 },
    frames: [],
  });
  assert.equal(ingest.extractedCount, 10);
  assert.equal(ingest.videoSummary?.target_fps, 5);

  const detachedFrame = mapThermalFrameFromApi({
    id: 'frame-archived-1',
    camera_id: null,
    camera_code: 'CAM-TEST-001',
    camera_name: 'Retired Test Tower',
    zone_name: 'Mangala Perimeter',
    capture_mode: 'http_push',
    source_filename: 'archived.png',
    captured_at: '2026-02-01T10:00:00Z',
    frame_index: 0,
    width: 640,
    height: 512,
    pixel_format: 'uint8_gray',
    qc_passed: true,
    qc_metrics: { bit_depth: 8 },
    rejection_reason: null,
    raw_object_key: 'raw-frames/CAM-TEST-001/2026-02-01/frame-archived-1.png',
    processed_object_key: 'processed-frames/CAM-TEST-001/2026-02-01/frame-archived-1_640x640.png',
    processing_status: 'preprocessed',
    is_dev_test: true,
    created_at: '2026-02-01T10:00:00Z',
    updated_at: '2026-02-01T10:00:00Z',
  });
  assert.equal(detachedFrame.cameraId, null);
  assert.equal(detachedFrame.cameraCode, 'CAM-TEST-001');
  assert.equal(detachedFrame.cameraName, 'Retired Test Tower');

  const rtsp = mapRtspTestPullFromApi({
    reachable: true,
    masked_rtsp_url: 'rtsp://***@10.0.0.5/stream',
    frames_retrieved: 2,
    accepted_count: 2,
    rejected_count: 0,
    frames: [],
  });
  assert.equal(rtsp.reachable, true);
  assert.equal(rtsp.maskedRtspUrl, 'rtsp://***@10.0.0.5/stream');
});

test('buildThermalFrameFilterQuery serializes camera, qcPassed, date window, and search', () => {
  const qs = buildThermalFrameFilterQuery({
    cameraId: 'cam-99',
    qcPassed: 'rejected',
    dateFrom: '2026-02-01',
    dateTo: '2026-02-02',
    search: 'blank',
    page: 2,
    pageSize: 25,
  });
  const params = new URLSearchParams(qs);
  assert.equal(params.get('camera_id'), 'cam-99');
  assert.equal(params.get('qc_passed'), 'false');
  assert.equal(params.get('search'), 'blank');
  assert.equal(params.get('page'), '2');
  assert.equal(params.get('page_size'), '25');
  assert.ok(params.get('date_from')?.startsWith('2026-02-01T'));
  assert.ok(params.get('date_to')?.startsWith('2026-02-02T23:59:59'));
});

test('validateThermalSampleFile checks allowed extensions and max upload sizes', () => {
  assert.deepEqual(validateThermalSampleFile({ name: 'sample_16bit.TIFF', size: 2048 }), {
    valid: true,
    mediaType: 'image',
    extension: '.tiff',
  });

  assert.deepEqual(validateThermalSampleFile({ name: 'corridor_clip.mp4', size: 1024 * 1024 }), {
    valid: true,
    mediaType: 'video',
    extension: '.mp4',
  });

  const emptyImg = validateThermalSampleFile({ name: 'empty.png', size: 0 });
  assert.equal(emptyImg.valid, false);

  const unsupported = validateThermalSampleFile({ name: 'bad_format.bmp', size: 512 });
  assert.equal(unsupported.valid, false);
  if (!unsupported.valid) {
    assert.match(unsupported.error, /Unsupported file format/);
  }

  const oversizedImg = validateThermalSampleFile({
    name: 'huge.jpg',
    size: MAX_THERMAL_IMAGE_BYTES + 1,
  });
  assert.equal(oversizedImg.valid, false);

  const oversizedVideo = validateThermalSampleFile({
    name: 'huge.avi',
    size: MAX_THERMAL_VIDEO_BYTES + 1,
  });
  assert.equal(oversizedVideo.valid, false);
});

test('maskRtspUrlCredentials masks embedded usernames and passwords', () => {
  assert.equal(
    maskRtspUrlCredentials('rtsp://admin:secretPass@192.168.1.44:554/ch1'),
    'rtsp://***:***@192.168.1.44:554/ch1'
  );
  assert.equal(
    maskRtspUrlCredentials('rtsp://10.0.0.12:554/stream'),
    'rtsp://10.0.0.12:554/stream'
  );
  assert.equal(maskRtspUrlCredentials('   '), '');
});

