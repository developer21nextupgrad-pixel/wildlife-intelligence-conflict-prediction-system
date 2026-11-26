import {
  AlertDeliveryAttemptRecord,
  AlertNotification,
  AlertRuleCreateInput,
  AlertRuleRecord,
  AnimalBoundingBox,
  AnimalDetectionItem,
  AnimalDetectionRecord,
  AnimalDetectionStatus,
  AnimalEmbeddingImage,
  AnimalIdentityDetail,
  AnimalIdentitySummary,
  AnimalSighting,
  CameraProtocol,
  CameraStatus,
  CameraZoneType,
  DevSampleIngestResult,
  ForestOfficerRecord,
  IdentityReviewLog,
  Incident,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
  IotEventRecord,
  PatrolOperation,
  ReidCandidate,
  ReidMatchRecord,
  RiskZone,
  RtspTestPullResult,
  SpeciesType,
  ThermalCamera,
  ThermalCameraCreateInput,
  ThermalCameraCreateResult,
  ThermalFrameQcMetrics,
  ThermalFrameRecord,
  VillageRiskProfile,
} from '../types';

export interface ApiIncidentDto {
  id: string;
  incident_code: string;
  species: SpeciesType;
  date_time: string;
  latitude: number;
  longitude: number;
  village: string;
  district: string;
  forest_range: string;
  incident_type: IncidentType;
  severity: IncidentSeverity;
  human_injury: Incident['humanInjury'];
  human_injuries_count: number;
  livestock_loss_count: number;
  crop_damage_estimated_acres: number;
  crop_type?: string | null;
  description: string;
  image_url?: string | null;
  status: IncidentStatus;
  reported_by: string;
  assigned_officer?: string | null;
  action_taken?: string | null;
  is_demo: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ApiSightingDto {
  id: string;
  sighting_code: string;
  species: SpeciesType;
  timestamp: string;
  latitude: number;
  longitude: number;
  location_name: string;
  district?: string;
  forest_range: string;
  herd_size: number;
  movement_direction: AnimalSighting['movementDirection'];
  bearing_degrees: number;
  behavior: AnimalSighting['behavior'];
  juveniles_present: boolean;
  observation_details: string;
  observer_name: string;
  observer_role: string;
  verified_by_forest_guard: boolean;
  photo_url?: string | null;
  is_demo: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ApiAlertDto {
  id: string;
  title: string;
  message: string;
  severity: IncidentSeverity;
  species: SpeciesType;
  affected_village: string;
  district: string;
  latitude: number;
  longitude: number;
  alert_time: string;
  triggered_at?: string;
  acknowledged: boolean;
  acknowledged_by?: string | null;
  acknowledged_at?: string | null;
  assigned_officer?: string | null;
  response_status: AlertNotification['responseStatus'];
  is_demo: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ApiPatrolDto {
  id: string;
  patrol_code: string;
  team_name: string;
  lead_officer: string;
  target_area: string;
  sector: string;
  district?: string;
  priority: PatrolOperation['priority'];
  status: PatrolOperation['status'];
  scheduled_window: string;
  active_personnel: number;
  equipment: string[];
  risk_rationale: string;
  approved_by: string;
  latitude: number;
  longitude: number;
  is_demo: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ApiVillageDto {
  id: string;
  name: string;
  district: string;
  forest_range: string;
  population: number;
  households: number;
  forest_distance_km: number;
  latitude: number;
  longitude: number;
  risk_level: IncidentSeverity;
  risk_score: number;
  active_solar_fence: boolean;
  fence_status: VillageRiskProfile['fenceStatus'];
  assigned_rrt: string;
  emergency_contact: string;
  recent_incidents_30d: number;
  is_demo: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ApiRiskZoneFeatureDto {
  type?: 'Feature';
  id?: string;
  geometry: {
    type: 'Polygon' | string;
    coordinates: number[][][];
  };
  properties: {
    layer?: string;
    id: string;
    name: string;
    district: string;
    forest_range: string;
    risk_level: IncidentSeverity;
    risk_score: number;
    dominant_species: SpeciesType;
    center_lat: number;
    center_lng: number;
    active_alert_count: number;
    primary_risk_factor: string;
    is_demo?: boolean;
  };
}

export interface ApiGeoJsonFeatureCollectionDto<TFeature = ApiRiskZoneFeatureDto> {
  type: 'FeatureCollection';
  crs?: string;
  count: number;
  features: TFeature[];
}

function normalizeIsoTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return new Date().toISOString();
  }
  return new Date(parsed).toISOString();
}

export function mapIncidentFromApi(dto: ApiIncidentDto): Incident {
  return {
    id: dto.id,
    incidentCode: dto.incident_code,
    species: dto.species,
    dateTime: dto.date_time,
    latitude: dto.latitude,
    longitude: dto.longitude,
    village: dto.village,
    district: dto.district,
    forestRange: dto.forest_range,
    incidentType: dto.incident_type,
    severity: dto.severity,
    humanInjury: dto.human_injury,
    humanInjuriesCount: dto.human_injuries_count,
    livestockLossCount: dto.livestock_loss_count,
    cropDamageEstimatedAcres: dto.crop_damage_estimated_acres,
    cropType: dto.crop_type ?? undefined,
    description: dto.description,
    imageUrl: dto.image_url ?? undefined,
    status: dto.status,
    reportedBy: dto.reported_by,
    assignedOfficer: dto.assigned_officer ?? undefined,
    actionTaken: dto.action_taken ?? undefined,
    isDemo: dto.is_demo,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export function mapIncidentToCreatePayload(
  input: Omit<Incident, 'id' | 'incidentCode'>
): Record<string, unknown> {
  return {
    species: input.species,
    date_time: normalizeIsoTimestamp(input.dateTime),
    latitude: input.latitude,
    longitude: input.longitude,
    village: input.village.trim(),
    district: (input.district || 'Bandipur Division').trim(),
    forest_range: input.forestRange.trim(),
    incident_type: input.incidentType,
    severity: input.severity,
    human_injury: input.humanInjury,
    human_injuries_count: input.humanInjuriesCount,
    livestock_loss_count: input.livestockLossCount,
    crop_damage_estimated_acres: input.cropDamageEstimatedAcres,
    crop_type: input.cropType?.trim() || null,
    description: input.description.trim(),
    image_url: input.imageUrl?.trim() || null,
    status: input.status,
    reported_by: input.reportedBy.trim(),
    assigned_officer: input.assignedOfficer?.trim() || null,
    action_taken: input.actionTaken?.trim() || null,
  };
}

export type IncidentUpsertInput = Omit<Incident, 'id' | 'incidentCode'>;

export function mapIncidentToUpdatePayload(
  input: Partial<IncidentUpsertInput>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.species !== undefined) payload.species = input.species;
  if (input.dateTime !== undefined && input.dateTime.trim()) {
    payload.date_time = normalizeIsoTimestamp(input.dateTime);
  }
  if (input.latitude !== undefined) payload.latitude = input.latitude;
  if (input.longitude !== undefined) payload.longitude = input.longitude;
  if (input.village !== undefined) payload.village = input.village.trim();
  if (input.district !== undefined) {
    payload.district = (input.district || 'Bandipur Division').trim();
  }
  if (input.forestRange !== undefined) payload.forest_range = input.forestRange.trim();
  if (input.incidentType !== undefined) payload.incident_type = input.incidentType;
  if (input.severity !== undefined) payload.severity = input.severity;
  if (input.humanInjury !== undefined) payload.human_injury = input.humanInjury;
  if (input.humanInjuriesCount !== undefined) {
    payload.human_injuries_count = input.humanInjuriesCount;
  }
  if (input.livestockLossCount !== undefined) {
    payload.livestock_loss_count = input.livestockLossCount;
  }
  if (input.cropDamageEstimatedAcres !== undefined) {
    payload.crop_damage_estimated_acres = input.cropDamageEstimatedAcres;
  }
  if (input.cropType !== undefined) {
    payload.crop_type = input.cropType.trim() || null;
  }
  if (input.description !== undefined) payload.description = input.description.trim();
  if (input.imageUrl !== undefined) {
    payload.image_url = input.imageUrl.trim() || null;
  }
  if (input.status !== undefined) payload.status = input.status;
  if (input.reportedBy !== undefined) payload.reported_by = input.reportedBy.trim();
  if (input.assignedOfficer !== undefined) {
    payload.assigned_officer = input.assignedOfficer.trim() || null;
  }
  if (input.actionTaken !== undefined) {
    payload.action_taken = input.actionTaken.trim() || null;
  }
  return payload;
}

export function mapSightingFromApi(dto: ApiSightingDto): AnimalSighting {
  return {
    id: dto.id,
    sightingCode: dto.sighting_code,
    species: dto.species,
    timestamp: dto.timestamp,
    latitude: dto.latitude,
    longitude: dto.longitude,
    locationName: dto.location_name,
    district: dto.district,
    forestRange: dto.forest_range,
    herdSize: dto.herd_size,
    movementDirection: dto.movement_direction,
    bearingDegrees: dto.bearing_degrees,
    behavior: dto.behavior,
    juvenilesPresent: dto.juveniles_present,
    observationDetails: dto.observation_details,
    observerName: dto.observer_name,
    observerRole: dto.observer_role,
    verifiedByForestGuard: dto.verified_by_forest_guard,
    photoUrl: dto.photo_url ?? undefined,
    isDemo: dto.is_demo,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export type SightingUpsertInput = Omit<AnimalSighting, 'id' | 'sightingCode'>;

export function mapSightingToCreatePayload(
  input: SightingUpsertInput
): Record<string, unknown> {
  return {
    species: input.species,
    timestamp: normalizeIsoTimestamp(input.timestamp),
    latitude: input.latitude,
    longitude: input.longitude,
    location_name: input.locationName.trim(),
    district: (input.district || 'Bandipur Division').trim(),
    forest_range: input.forestRange.trim(),
    herd_size: input.herdSize,
    movement_direction: input.movementDirection,
    bearing_degrees: input.bearingDegrees,
    behavior: input.behavior,
    juveniles_present: input.juvenilesPresent,
    observation_details: input.observationDetails.trim(),
    observer_name: input.observerName.trim(),
    observer_role: input.observerRole.trim(),
    verified_by_forest_guard: input.verifiedByForestGuard,
    photo_url: input.photoUrl?.trim() || null,
  };
}

export function mapSightingToUpdatePayload(
  input: Partial<SightingUpsertInput>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.species !== undefined) payload.species = input.species;
  if (input.timestamp !== undefined && input.timestamp.trim()) {
    payload.timestamp = normalizeIsoTimestamp(input.timestamp);
  }
  if (input.latitude !== undefined) payload.latitude = input.latitude;
  if (input.longitude !== undefined) payload.longitude = input.longitude;
  if (input.locationName !== undefined) payload.location_name = input.locationName.trim();
  if (input.district !== undefined) {
    payload.district = (input.district || 'Bandipur Division').trim();
  }
  if (input.forestRange !== undefined) payload.forest_range = input.forestRange.trim();
  if (input.herdSize !== undefined) payload.herd_size = input.herdSize;
  if (input.movementDirection !== undefined) payload.movement_direction = input.movementDirection;
  if (input.bearingDegrees !== undefined) payload.bearing_degrees = input.bearingDegrees;
  if (input.behavior !== undefined) payload.behavior = input.behavior;
  if (input.juvenilesPresent !== undefined) payload.juveniles_present = input.juvenilesPresent;
  if (input.observationDetails !== undefined) {
    payload.observation_details = input.observationDetails.trim();
  }
  if (input.observerName !== undefined) payload.observer_name = input.observerName.trim();
  if (input.observerRole !== undefined) payload.observer_role = input.observerRole.trim();
  if (input.verifiedByForestGuard !== undefined) {
    payload.verified_by_forest_guard = input.verifiedByForestGuard;
  }
  if (input.photoUrl !== undefined) {
    payload.photo_url = input.photoUrl.trim() || null;
  }
  return payload;
}

export function mapAlertFromApi(dto: ApiAlertDto): AlertNotification {
  return {
    id: dto.id,
    title: dto.title,
    message: dto.message,
    severity: dto.severity,
    species: dto.species,
    affectedVillage: dto.affected_village,
    district: dto.district,
    coordinates: [dto.latitude, dto.longitude],
    alertTime: dto.alert_time,
    triggeredAt: dto.triggered_at,
    acknowledged: dto.acknowledged,
    acknowledgedBy: dto.acknowledged_by ?? undefined,
    acknowledgedAt: dto.acknowledged_at ?? undefined,
    assignedOfficer: dto.assigned_officer ?? undefined,
    responseStatus: dto.response_status,
    isDemo: dto.is_demo,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export interface AlertUpsertInput {
  title: string;
  message: string;
  severity: IncidentSeverity;
  species: SpeciesType;
  affectedVillage: string;
  district: string;
  latitude: number;
  longitude: number;
  triggeredAt?: string;
  assignedOfficer?: string;
  responseStatus: AlertNotification['responseStatus'];
}

function formatUtcAlertTimeLabel(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
}

export function mapAlertToCreatePayload(input: AlertUpsertInput): Record<string, unknown> {
  const triggeredIso = input.triggeredAt ? normalizeIsoTimestamp(input.triggeredAt) : new Date().toISOString();
  return {
    title: input.title.trim(),
    message: input.message.trim(),
    severity: input.severity,
    species: input.species,
    affected_village: input.affectedVillage.trim(),
    district: input.district.trim(),
    latitude: input.latitude,
    longitude: input.longitude,
    triggered_at: triggeredIso,
    alert_time: formatUtcAlertTimeLabel(triggeredIso),
    assigned_officer: input.assignedOfficer?.trim() || null,
    response_status: input.responseStatus,
  };
}

export function mapAlertToUpdatePayload(input: Partial<AlertUpsertInput>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.title !== undefined) payload.title = input.title.trim();
  if (input.message !== undefined) payload.message = input.message.trim();
  if (input.severity !== undefined) payload.severity = input.severity;
  if (input.species !== undefined) payload.species = input.species;
  if (input.affectedVillage !== undefined) payload.affected_village = input.affectedVillage.trim();
  if (input.district !== undefined) payload.district = input.district.trim();
  if (input.latitude !== undefined) payload.latitude = input.latitude;
  if (input.longitude !== undefined) payload.longitude = input.longitude;
  if (input.triggeredAt !== undefined && input.triggeredAt.trim()) {
    const triggeredIso = normalizeIsoTimestamp(input.triggeredAt);
    payload.triggered_at = triggeredIso;
    payload.alert_time = formatUtcAlertTimeLabel(triggeredIso);
  }
  if (input.assignedOfficer !== undefined) {
    payload.assigned_officer = input.assignedOfficer.trim() || null;
  }
  if (input.responseStatus !== undefined) payload.response_status = input.responseStatus;
  return payload;
}

export function mapPatrolFromApi(dto: ApiPatrolDto): PatrolOperation {
  return {
    id: dto.id,
    patrolCode: dto.patrol_code,
    teamName: dto.team_name,
    leadOfficer: dto.lead_officer,
    targetArea: dto.target_area,
    sector: dto.sector,
    district: dto.district,
    priority: dto.priority,
    status: dto.status,
    scheduledWindow: dto.scheduled_window,
    activePersonnel: dto.active_personnel,
    equipment: Array.isArray(dto.equipment) ? dto.equipment : [],
    riskRationale: dto.risk_rationale,
    approvedBy: dto.approved_by,
    coordinates: [dto.latitude, dto.longitude],
    isDemo: dto.is_demo,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export function mapPatrolToCreatePayload(
  input: Omit<PatrolOperation, 'id' | 'patrolCode'>
): Record<string, unknown> {
  return {
    team_name: input.teamName.trim(),
    lead_officer: input.leadOfficer.trim(),
    target_area: input.targetArea.trim(),
    sector: input.sector.trim(),
    district: (input.district || 'Bandipur Division').trim(),
    priority: input.priority,
    status: input.status,
    scheduled_window: input.scheduledWindow.trim(),
    active_personnel: input.activePersonnel,
    equipment: input.equipment,
    risk_rationale: input.riskRationale.trim(),
    approved_by: input.approvedBy.trim(),
    latitude: input.coordinates[0],
    longitude: input.coordinates[1],
  };
}

export type PatrolUpsertInput = Omit<PatrolOperation, 'id' | 'patrolCode'>;

export function mapPatrolToUpdatePayload(
  input: Partial<PatrolUpsertInput>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.teamName !== undefined) payload.team_name = input.teamName.trim();
  if (input.leadOfficer !== undefined) payload.lead_officer = input.leadOfficer.trim();
  if (input.targetArea !== undefined) payload.target_area = input.targetArea.trim();
  if (input.sector !== undefined) payload.sector = input.sector.trim();
  if (input.district !== undefined) {
    payload.district = (input.district || 'Bandipur Division').trim();
  }
  if (input.priority !== undefined) payload.priority = input.priority;
  if (input.status !== undefined) payload.status = input.status;
  if (input.scheduledWindow !== undefined) {
    payload.scheduled_window = input.scheduledWindow.trim();
  }
  if (input.activePersonnel !== undefined) payload.active_personnel = input.activePersonnel;
  if (input.equipment !== undefined) payload.equipment = input.equipment;
  if (input.riskRationale !== undefined) payload.risk_rationale = input.riskRationale.trim();
  if (input.approvedBy !== undefined) payload.approved_by = input.approvedBy.trim();
  if (input.coordinates !== undefined) {
    payload.latitude = input.coordinates[0];
    payload.longitude = input.coordinates[1];
  }
  return payload;
}

export function mapVillageFromApi(dto: ApiVillageDto): VillageRiskProfile {
  return {
    id: dto.id,
    name: dto.name,
    district: dto.district,
    forestRange: dto.forest_range,
    population: dto.population,
    households: dto.households,
    forestDistanceKm: dto.forest_distance_km,
    coordinates: [dto.latitude, dto.longitude],
    riskLevel: dto.risk_level,
    riskScore: dto.risk_score,
    activeSolarFence: dto.active_solar_fence,
    fenceStatus: dto.fence_status,
    assignedRRT: dto.assigned_rrt,
    emergencyContact: dto.emergency_contact,
    recentIncidents30d: dto.recent_incidents_30d,
    isDemo: dto.is_demo,
  };
}

export function mapRiskZoneFromGeoJson(feature: ApiRiskZoneFeatureDto): RiskZone {
  const props = feature.properties;
  const rawRing = feature.geometry?.coordinates?.[0] ?? [];
  const polygonCoordinates = rawRing.map(
    (pt): [number, number] => [Number(pt[1]), Number(pt[0])]
  );
  if (
    polygonCoordinates.length > 1 &&
    polygonCoordinates[0][0] === polygonCoordinates[polygonCoordinates.length - 1][0] &&
    polygonCoordinates[0][1] === polygonCoordinates[polygonCoordinates.length - 1][1]
  ) {
    polygonCoordinates.pop();
  }

  return {
    id: props.id,
    name: props.name,
    district: props.district,
    range: props.forest_range,
    riskLevel: props.risk_level,
    riskScore: props.risk_score,
    dominantSpecies: props.dominant_species,
    centerCoordinates: [props.center_lat, props.center_lng],
    polygonCoordinates,
    activeAlertCount: props.active_alert_count,
    primaryRiskFactor: props.primary_risk_factor,
    isDemo: props.is_demo,
  };
}

export function extractApiErrorMessage(
  status: number,
  body: unknown,
  fallback: string
): string {
  if (body && typeof body === 'object') {
    const obj = body as {
      detail?: unknown;
      errors?: Array<{ field?: string; message?: string }>;
    };
    if (Array.isArray(obj.errors) && obj.errors.length > 0) {
      const details = obj.errors
        .map((e) => (e.field ? `${e.field}: ${e.message}` : e.message))
        .filter(Boolean)
        .join('; ');
      if (details) return `HTTP ${status}: ${details}`;
    }
    if (typeof obj.detail === 'string' && obj.detail.trim()) {
      return `HTTP ${status}: ${obj.detail}`;
    }
  }
  return `HTTP ${status}: ${fallback}`;
}

// --- Phase 1: Thermal Camera & Frame Ingestion DTOs and Mappers ---

export interface ApiCameraDto {
  id: string;
  camera_code: string;
  name: string;
  village_id?: string | null;
  zone_name: string;
  zone_type: CameraZoneType;
  latitude: number;
  longitude: number;
  protocol: CameraProtocol;
  stream_metadata: Record<string, unknown>;
  status: CameraStatus;
  last_heartbeat_at?: string | null;
  is_dev_test: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiCameraCreateDto extends ApiCameraDto {
  api_key: string;
  api_key_notice: string;
}

export interface ApiThermalFrameDto {
  id: string;
  camera_id?: string | null;
  camera_code?: string | null;
  camera_name?: string | null;
  zone_name?: string | null;
  capture_mode: string;
  source_filename?: string | null;
  captured_at: string;
  frame_index: number;
  width: number;
  height: number;
  pixel_format: string;
  qc_passed: boolean;
  qc_metrics: ThermalFrameQcMetrics;
  rejection_reason?: string | null;
  raw_object_key: string;
  processed_object_key?: string | null;
  processing_status: string;
  is_dev_test: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiDevSampleIngestDto {
  mode: string;
  notice: string;
  camera_id: string;
  camera_code: string;
  storage_backend: string;
  media_type: 'image' | 'video';
  extracted_count: number;
  accepted_count: number;
  rejected_count: number;
  video_summary?: {
    native_fps?: number;
    target_fps?: number;
    source_frame_count?: number;
    extracted_frame_count?: number;
  } | null;
  frames: ApiThermalFrameDto[];
}

export interface ApiRtspTestPullDto {
  reachable: boolean;
  masked_rtsp_url: string;
  frames_retrieved: number;
  accepted_count: number;
  rejected_count: number;
  frames: ApiThermalFrameDto[];
}

export function mapCameraFromApi(dto: ApiCameraDto): ThermalCamera {
  return {
    id: dto.id,
    cameraCode: dto.camera_code,
    name: dto.name,
    villageId: dto.village_id ?? null,
    zoneName: dto.zone_name,
    zoneType: dto.zone_type,
    latitude: dto.latitude,
    longitude: dto.longitude,
    protocol: dto.protocol,
    streamMetadata: dto.stream_metadata || {},
    status: dto.status,
    lastHeartbeatAt: dto.last_heartbeat_at ?? null,
    isDevTest: Boolean(dto.is_dev_test),
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export function mapCameraCreateFromApi(dto: ApiCameraCreateDto): ThermalCameraCreateResult {
  return {
    ...mapCameraFromApi(dto),
    apiKey: dto.api_key,
    apiKeyNotice: dto.api_key_notice,
  };
}

export function mapCameraToCreatePayload(
  input: ThermalCameraCreateInput
): Record<string, unknown> {
  return {
    camera_code: input.cameraCode.trim(),
    name: input.name.trim(),
    village_id: input.villageId || null,
    village_name: input.villageName?.trim() || null,
    zone_name: input.zoneName.trim(),
    zone_type: input.zoneType,
    latitude: input.latitude,
    longitude: input.longitude,
    protocol: input.protocol,
    stream_metadata: input.streamMetadata || {},
    status: input.status || 'active',
    is_dev_test: Boolean(input.isDevTest),
  };
}

export function mapThermalFrameFromApi(dto: ApiThermalFrameDto): ThermalFrameRecord {
  return {
    id: dto.id,
    cameraId: dto.camera_id ?? null,
    cameraCode: dto.camera_code ?? null,
    cameraName: dto.camera_name ?? null,
    zoneName: dto.zone_name ?? null,
    captureMode: dto.capture_mode,
    sourceFilename: dto.source_filename ?? null,
    capturedAt: dto.captured_at,
    frameIndex: dto.frame_index,
    width: dto.width,
    height: dto.height,
    pixelFormat: dto.pixel_format,
    qcPassed: Boolean(dto.qc_passed),
    qcMetrics: dto.qc_metrics || {},
    rejectionReason: dto.rejection_reason ?? null,
    rawObjectKey: dto.raw_object_key,
    processedObjectKey: dto.processed_object_key ?? null,
    processingStatus: dto.processing_status,
    isDevTest: Boolean(dto.is_dev_test),
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export function mapDevSampleIngestFromApi(dto: ApiDevSampleIngestDto): DevSampleIngestResult {
  return {
    mode: dto.mode,
    notice: dto.notice,
    cameraId: dto.camera_id,
    cameraCode: dto.camera_code,
    storageBackend: dto.storage_backend,
    mediaType: dto.media_type,
    extractedCount: dto.extracted_count,
    acceptedCount: dto.accepted_count,
    rejectedCount: dto.rejected_count,
    videoSummary: dto.video_summary ?? null,
    frames: (dto.frames || []).map(mapThermalFrameFromApi),
  };
}

export function mapRtspTestPullFromApi(dto: ApiRtspTestPullDto): RtspTestPullResult {
  return {
    reachable: dto.reachable,
    maskedRtspUrl: dto.masked_rtsp_url,
    framesRetrieved: dto.frames_retrieved,
    acceptedCount: dto.accepted_count,
    rejectedCount: dto.rejected_count,
    frames: (dto.frames || []).map(mapThermalFrameFromApi),
  };
}

export interface ThermalFrameFilterParams {
  cameraId?: string;
  qcPassed?: 'all' | 'accepted' | 'rejected';
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export function buildThermalFrameFilterQuery(filters: ThermalFrameFilterParams = {}): string {
  const params = new URLSearchParams();
  params.set('page', String(filters.page ?? 1));
  params.set('page_size', String(filters.pageSize ?? 50));
  if (filters.cameraId && filters.cameraId !== 'All') {
    params.set('camera_id', filters.cameraId);
  }
  if (filters.qcPassed === 'accepted') {
    params.set('qc_passed', 'true');
  } else if (filters.qcPassed === 'rejected') {
    params.set('qc_passed', 'false');
  }
  if (filters.dateFrom) {
    const dt = new Date(filters.dateFrom);
    if (!Number.isNaN(dt.getTime())) {
      params.set('date_from', dt.toISOString());
    }
  }
  if (filters.dateTo) {
    const dt = new Date(filters.dateTo);
    if (!Number.isNaN(dt.getTime())) {
      // If a date-only string YYYY-MM-DD is provided, include the entire day
      if (/^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo.trim())) {
        dt.setUTCHours(23, 59, 59, 999);
      }
      params.set('date_to', dt.toISOString());
    }
  }
  if (filters.search && filters.search.trim()) {
    params.set('search', filters.search.trim());
  }
  return params.toString();
}

export function validateThermalCameraForm(input: {
  cameraCode: string;
  name: string;
  zoneName: string;
  zoneType: string;
  protocol: string;
  latitude: string;
  longitude: string;
}): string | null {
  if (!input.cameraCode.trim()) return 'Camera ID / Code is required.';
  if (!/^[a-zA-Z0-9._-]+$/.test(input.cameraCode.trim())) {
    return 'Camera Code may contain only letters, numbers, hyphens, underscores, and dots.';
  }
  if (!input.name.trim()) return 'Camera name is required.';
  if (!input.zoneName.trim()) return 'Monitored zone name is required.';
  if (!input.zoneType) return 'Zone type is required.';
  if (!input.protocol) return 'Ingestion protocol is required.';

  const lat = Number(input.latitude);
  const lng = Number(input.longitude);
  if (!input.latitude.trim() || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return 'Latitude must be a finite number between -90 and 90.';
  }
  if (!input.longitude.trim() || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return 'Longitude must be a finite number between -180 and 180.';
  }
  return null;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.avi']);

export const MAX_THERMAL_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_THERMAL_VIDEO_BYTES = 100 * 1024 * 1024;

export function validateThermalSampleFile(file: {
  name: string;
  size: number;
}): { valid: true; mediaType: 'image' | 'video'; extension: string } | { valid: false; error: string } {
  const name = (file.name || '').trim();
  const dotIdx = name.lastIndexOf('.');
  const ext = dotIdx >= 0 ? name.slice(dotIdx).toLowerCase() : '';

  if (IMAGE_EXTENSIONS.has(ext)) {
    if (file.size <= 0) {
      return { valid: false, error: 'Selected thermal image file is empty (0 bytes).' };
    }
    if (file.size > MAX_THERMAL_IMAGE_BYTES) {
      return {
        valid: false,
        error: `Thermal image exceeds maximum allowed size of 25 MB (${(file.size / (1024 * 1024)).toFixed(1)} MB).`,
      };
    }
    return { valid: true, mediaType: 'image', extension: ext };
  }

  if (VIDEO_EXTENSIONS.has(ext)) {
    if (file.size <= 0) {
      return { valid: false, error: 'Selected thermal video file is empty (0 bytes).' };
    }
    if (file.size > MAX_THERMAL_VIDEO_BYTES) {
      return {
        valid: false,
        error: `Thermal video exceeds maximum allowed size of 100 MB (${(file.size / (1024 * 1024)).toFixed(1)} MB).`,
      };
    }
    return { valid: true, mediaType: 'video', extension: ext };
  }

  return {
    valid: false,
    error: `Unsupported file format "${ext || 'none'}". Allowed formats: PNG, JPG/JPEG, TIFF, MP4, AVI.`,
  };
}

export function maskRtspUrlCredentials(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  return trimmed.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/@\s]+)@/g, '$1***:***@');
}

// --- Phase 1: Animal Detection & SpeciesNet Identification DTOs and Helpers ---

export interface ApiAnimalBoundingBoxDto {
  xmin: number;
  ymin: number;
  width: number;
  height: number;
  pixel_xmin: number;
  pixel_ymin: number;
  pixel_width: number;
  pixel_height: number;
}

export interface ApiClassificationCandidateDto {
  species_label: string;
  common_name?: string | null;
  scientific_name?: string | null;
  confidence: number;
}

export interface ApiReidCandidateDto {
  animal_identity_id: string;
  animal_code: string;
  species: string;
  similarity_score: number;
  crop_image_url?: string | null;
}

export interface ApiCropQualityDto {
  passed: boolean;
  reason?: string | null;
  width: number;
  height: number;
  blur_score: number;
}

export interface ApiAnimalDetectionItemDto {
  index: number;
  category: 'animal' | 'human' | 'vehicle';
  detector_confidence: number;
  bbox: ApiAnimalBoundingBoxDto;
  species_label: string;
  common_name?: string | null;
  scientific_name?: string | null;
  taxonomic_level?: string | null;
  taxonomy_raw?: string | null;
  species_confidence: number;
  prediction_source?: string | null;
  needs_review: boolean;
  top_candidates?: ApiClassificationCandidateDto[];
  individual_reid_status?: string;
  reid_match_id?: string | null;
  embedding_id?: string | null;
  animal_identity_id?: string | null;
  animal_code?: string | null;
  reid_decision?: string | null;
  reid_review_status?: string | null;
  reid_similarity_score?: number | null;
  reid_review_reason?: string | null;
  reid_top_candidates?: ApiReidCandidateDto[];
  crop_object_key?: string | null;
  crop_image_url?: string | null;
  crop_quality?: ApiCropQualityDto | null;
}

export interface ApiAnimalDetectionModelMetadataDto {
  detector_model: string;
  classifier_model: string;
  speciesnet_version: string;
  geofence_enabled: boolean;
  country_code?: string | null;
  admin1_region?: string | null;
  min_detection_confidence: number;
  min_species_confidence: number;
  thermal_imagery_supported: boolean;
  imagery_notice: string;
  reid_enabled?: boolean;
  reid_model?: string | null;
  reid_license?: string | null;
  reid_match_threshold?: number | null;
  reid_ambiguous_threshold?: number | null;
}

export interface ApiLinkedAlertSummaryDto {
  id: string;
  title: string;
  severity: string;
  affected_village: string;
  assigned_officer?: string | null;
  response_status: string;
  risk_reason?: string | null;
}

export interface ApiAnimalDetectionDto {
  id: string;
  source_filename: string;
  content_type: string;
  file_size_bytes: number;
  width: number;
  height: number;
  image_object_key: string;
  image_url: string;
  storage_backend: string;
  processing_status: AnimalDetectionStatus;
  detection_count: number;
  animal_count: number;
  primary_species?: string | null;
  primary_common_name?: string | null;
  primary_scientific_name?: string | null;
  primary_confidence?: number | null;
  country_code?: string | null;
  admin1_region?: string | null;
  camera_id?: string | null;
  village_id?: string | null;
  captured_at?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location_name?: string | null;
  idempotency_key?: string | null;
  generated_sighting_id?: string | null;
  sighting_integration_status?: string | null;
  generated_alert_ids?: string[];
  generated_alerts?: ApiLinkedAlertSummaryDto[];
  detector_model: string;
  classifier_model: string;
  inference_duration_ms: number;
  detections: ApiAnimalDetectionItemDto[];
  model_metadata: ApiAnimalDetectionModelMetadataDto;
  error_message?: string | null;
  uploaded_by_user_id?: string | null;
  can_delete?: boolean;
  is_deleted?: boolean;
  deleted_at?: string | null;
  deleted_by?: string | null;
  created_at: string;
  updated_at: string;
}

export function resolveBackendAssetUrl(
  rawPath: string | null | undefined,
  apiBaseUrl?: string
): string | null {
  if (!rawPath) return null;
  if (/^https?:\/\//i.test(rawPath)) return rawPath;
  if (!apiBaseUrl) return rawPath;
  const trimmedBase = apiBaseUrl.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
  return `${trimmedBase}${rawPath.startsWith('/') ? rawPath : `/${rawPath}`}`;
}

export function mapAnimalDetectionFromApi(
  dto: ApiAnimalDetectionDto,
  resolvedImageUrl?: string,
  apiBaseUrl?: string
): AnimalDetectionRecord {
  return {
    id: dto.id,
    sourceFilename: dto.source_filename,
    contentType: dto.content_type,
    fileSizeBytes: dto.file_size_bytes,
    width: dto.width,
    height: dto.height,
    imageObjectKey: dto.image_object_key,
    imageUrl: resolvedImageUrl || resolveBackendAssetUrl(dto.image_url, apiBaseUrl) || dto.image_url,
    storageBackend: dto.storage_backend,
    processingStatus: dto.processing_status,
    detectionCount: dto.detection_count,
    animalCount: dto.animal_count,
    primarySpecies: dto.primary_species ?? null,
    primaryCommonName: dto.primary_common_name ?? null,
    primaryScientificName: dto.primary_scientific_name ?? null,
    primaryConfidence: dto.primary_confidence ?? null,
    countryCode: dto.country_code ?? null,
    admin1Region: dto.admin1_region ?? null,
    cameraId: dto.camera_id ?? null,
    villageId: dto.village_id ?? null,
    capturedAt: dto.captured_at ?? null,
    latitude: dto.latitude ?? null,
    longitude: dto.longitude ?? null,
    locationName: dto.location_name ?? null,
    idempotencyKey: dto.idempotency_key ?? null,
    generatedSightingId: dto.generated_sighting_id ?? null,
    sightingIntegrationStatus: dto.sighting_integration_status ?? null,
    generatedAlertIds: dto.generated_alert_ids || [],
    generatedAlerts: (dto.generated_alerts || []).map((a) => ({
      id: a.id,
      title: a.title,
      severity: a.severity,
      affectedVillage: a.affected_village,
      assignedOfficer: a.assigned_officer ?? null,
      responseStatus: a.response_status,
      riskReason: a.risk_reason ?? null,
    })),
    detectorModel: dto.detector_model,
    classifierModel: dto.classifier_model,
    inferenceDurationMs: dto.inference_duration_ms,
    detections: (dto.detections || []).map((item): AnimalDetectionItem => ({
      index: item.index,
      category: item.category,
      detectorConfidence: item.detector_confidence,
      bbox: {
        xmin: item.bbox.xmin,
        ymin: item.bbox.ymin,
        width: item.bbox.width,
        height: item.bbox.height,
        pixelXmin: item.bbox.pixel_xmin,
        pixelYmin: item.bbox.pixel_ymin,
        pixelWidth: item.bbox.pixel_width,
        pixelHeight: item.bbox.pixel_height,
      },
      speciesLabel: item.species_label,
      commonName: item.common_name ?? null,
      scientificName: item.scientific_name ?? null,
      taxonomicLevel: item.taxonomic_level ?? null,
      taxonomyRaw: item.taxonomy_raw ?? null,
      speciesConfidence: item.species_confidence,
      predictionSource: item.prediction_source ?? null,
      needsReview: Boolean(item.needs_review),
      topCandidates: (item.top_candidates || []).map((cand) => ({
        speciesLabel: cand.species_label,
        commonName: cand.common_name ?? null,
        scientificName: cand.scientific_name ?? null,
        confidence: cand.confidence,
      })),
      individualReIdStatus: item.individual_reid_status || 'phase2_not_enabled',
      reidMatchId: item.reid_match_id ?? null,
      embeddingId: item.embedding_id ?? null,
      animalIdentityId: item.animal_identity_id ?? null,
      animalCode: item.animal_code ?? null,
      reidDecision: item.reid_decision ?? null,
      reidReviewStatus: item.reid_review_status ?? null,
      reidSimilarityScore: item.reid_similarity_score ?? null,
      reidReviewReason: item.reid_review_reason ?? null,
      reidTopCandidates: (item.reid_top_candidates || []).map(
        (c): ReidCandidate => ({
          animalIdentityId: c.animal_identity_id,
          animalCode: c.animal_code,
          species: c.species,
          similarityScore: c.similarity_score,
          cropImageUrl: resolveBackendAssetUrl(c.crop_image_url, apiBaseUrl),
        })
      ),
      cropObjectKey: item.crop_object_key ?? null,
      cropImageUrl: resolveBackendAssetUrl(item.crop_image_url, apiBaseUrl),
      cropQuality: item.crop_quality
        ? {
            passed: Boolean(item.crop_quality.passed),
            reason: item.crop_quality.reason ?? null,
            width: item.crop_quality.width,
            height: item.crop_quality.height,
            blurScore: item.crop_quality.blur_score,
          }
        : null,
    })),
    modelMetadata: {
      detectorModel: dto.model_metadata?.detector_model || dto.detector_model,
      classifierModel: dto.model_metadata?.classifier_model || dto.classifier_model,
      speciesnetVersion: dto.model_metadata?.speciesnet_version || '4.0.3a',
      geofenceEnabled: Boolean(dto.model_metadata?.geofence_enabled ?? true),
      countryCode: dto.model_metadata?.country_code ?? dto.country_code ?? null,
      admin1Region: dto.model_metadata?.admin1_region ?? dto.admin1_region ?? null,
      minDetectionConfidence: dto.model_metadata?.min_detection_confidence ?? 0.2,
      minSpeciesConfidence: dto.model_metadata?.min_species_confidence ?? 0.5,
      thermalImagerySupported: Boolean(dto.model_metadata?.thermal_imagery_supported ?? false),
      imageryNotice: dto.model_metadata?.imagery_notice || '',
      reidEnabled: Boolean(dto.model_metadata?.reid_enabled ?? false),
      reidModel: dto.model_metadata?.reid_model ?? null,
      reidLicense: dto.model_metadata?.reid_license ?? null,
      reidMatchThreshold: dto.model_metadata?.reid_match_threshold ?? null,
      reidAmbiguousThreshold: dto.model_metadata?.reid_ambiguous_threshold ?? null,
    },
    errorMessage: dto.error_message ?? null,
    uploadedByUserId: dto.uploaded_by_user_id ?? null,
    canDelete: Boolean(dto.can_delete ?? false),
    isDeleted: Boolean(dto.is_deleted ?? false),
    deletedAt: dto.deleted_at ?? null,
    deletedBy: dto.deleted_by ?? null,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

const ANIMAL_DETECTION_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
export const MAX_ANIMAL_DETECTION_IMAGE_BYTES = 25 * 1024 * 1024;

export function validateAnimalDetectionFile(file: {
  name: string;
  size: number;
}): { valid: true; extension: string } | { valid: false; error: string } {
  const name = (file.name || '').trim();
  const dotIdx = name.lastIndexOf('.');
  const ext = dotIdx >= 0 ? name.slice(dotIdx).toLowerCase() : '';

  if (!ANIMAL_DETECTION_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `Unsupported image format "${ext || 'none'}". Upload a JPG, JPEG, or PNG image.`,
    };
  }
  if (file.size <= 0) {
    return { valid: false, error: 'Selected image file is empty (0 bytes).' };
  }
  if (file.size > MAX_ANIMAL_DETECTION_IMAGE_BYTES) {
    return {
      valid: false,
      error: `Image exceeds maximum allowed size of 25 MB (${(file.size / (1024 * 1024)).toFixed(1)} MB).`,
    };
  }
  return { valid: true, extension: ext };
}

export function clampBoundingBoxPercent(bbox: AnimalBoundingBox): {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
} {
  const xmin = Number.isFinite(bbox.xmin) ? Math.max(0, Math.min(1, bbox.xmin)) : 0;
  const ymin = Number.isFinite(bbox.ymin) ? Math.max(0, Math.min(1, bbox.ymin)) : 0;
  const w = Number.isFinite(bbox.width) ? Math.max(0, Math.min(1 - xmin, bbox.width)) : 0;
  const h = Number.isFinite(bbox.height) ? Math.max(0, Math.min(1 - ymin, bbox.height)) : 0;
  return {
    leftPct: Number((xmin * 100).toFixed(3)),
    topPct: Number((ymin * 100).toFixed(3)),
    widthPct: Number((w * 100).toFixed(3)),
    heightPct: Number((h * 100).toFixed(3)),
  };
}

export function formatDetectionSpeciesDisplay(item: AnimalDetectionItem): {
  label: string;
  subtitle: string | null;
  isUncertain: boolean;
} {
  if (item.needsReview) {
    const candidateHint =
      item.commonName && item.commonName !== 'Unknown / Needs Review'
        ? `Best low-confidence candidate: ${item.commonName}`
        : 'Confidence below verification threshold';
    return {
      label: 'Unknown / Needs Review',
      subtitle: candidateHint,
      isUncertain: true,
    };
  }
  return {
    label: item.speciesLabel || item.commonName || 'Unknown / Needs Review',
    subtitle: item.scientificName || null,
    isUncertain: false,
  };
}

// --- Phase 2 & Phase 3: Animal Registry, Matches, Alert Rules, Officers, Deliveries, IoT ---

export interface ApiAnimalIdentitySummaryDto {
  id: string;
  animal_code: string;
  species: string;
  scientific_name?: string | null;
  species_prefix: string;
  status: string;
  verification_status: string;
  primary_crop_url?: string | null;
  first_seen_at: string;
  last_seen_at: string;
  total_sightings: number;
  reference_image_count: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiAnimalEmbeddingImageDto {
  id: string;
  detection_id: string;
  detection_item_index: number;
  animal_identity_id?: string | null;
  crop_image_url: string;
  source_image_url: string;
  species: string;
  model_name: string;
  model_version: string;
  embedding_dim: number;
  crop_width: number;
  crop_height: number;
  blur_score: number;
  quality_passed: boolean;
  is_reference: boolean;
  created_at: string;
}

export interface ApiIdentityReviewLogDto {
  id: string;
  match_id: string;
  animal_identity_id?: string | null;
  previous_animal_id?: string | null;
  action: string;
  reviewed_by: string;
  reviewed_at: string;
  reason?: string | null;
}

export interface ApiReidMatchDto {
  id: string;
  detection_id: string;
  embedding_id: string;
  detection_item_index: number;
  species: string;
  matched_animal_id?: string | null;
  matched_animal_code?: string | null;
  suggested_animal_id?: string | null;
  suggested_animal_code?: string | null;
  similarity_score?: number | null;
  decision: string;
  review_status: string;
  review_reason?: string | null;
  top_candidates?: ApiReidCandidateDto[];
  crop_image_url: string;
  source_image_url: string;
  model_version: string;
  thresholds_snapshot?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ApiAnimalIdentityDetailDto extends ApiAnimalIdentitySummaryDto {
  images: ApiAnimalEmbeddingImageDto[];
  matches: ApiReidMatchDto[];
  review_logs: ApiIdentityReviewLogDto[];
}

export interface ApiAlertRuleDto {
  id: string;
  name: string;
  species_filter?: string | null;
  risk_level: IncidentSeverity;
  village_id?: string | null;
  zone_name?: string | null;
  min_repeat_count: number;
  time_window_minutes: number;
  min_species_confidence: number;
  enabled: boolean;
  auto_notify_officer: boolean;
  auto_dispatch_iot_boundary: boolean;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiForestOfficerDto {
  id: string;
  name: string;
  badge_number: string;
  role: string;
  forest_range: string;
  district: string;
  latitude?: number | null;
  longitude?: number | null;
  whatsapp_opt_in: boolean;
  sms_opt_in: boolean;
  contact_channel: string;
  duty_status: string;
  on_duty: boolean;
  notification_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiAlertDeliveryAttemptDto {
  id: string;
  alert_id: string;
  officer_id?: string | null;
  officer_name: string;
  channel: string;
  routing_basis: string;
  distance_km?: number | null;
  status: string;
  attempt_number: number;
  detail?: string | null;
  attempted_at: string;
}

export interface ApiIotEventDto {
  id: string;
  alert_id?: string | null;
  camera_id?: string | null;
  device_code: string;
  animal_identity_id?: string | null;
  species: string;
  confidence: number;
  risk_level: string;
  event_type: string;
  is_dev_test: boolean;
  payload_json: Record<string, unknown>;
  delivery_status: string;
  retry_count: number;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  ack_note?: string | null;
  created_at: string;
  updated_at: string;
}

export function mapAnimalIdentitySummaryFromApi(
  dto: ApiAnimalIdentitySummaryDto,
  apiBaseUrl?: string
): AnimalIdentitySummary {
  return {
    id: dto.id,
    animalCode: dto.animal_code,
    species: dto.species,
    scientificName: dto.scientific_name ?? null,
    speciesPrefix: dto.species_prefix,
    status: dto.status,
    verificationStatus: dto.verification_status,
    primaryCropUrl: resolveBackendAssetUrl(dto.primary_crop_url, apiBaseUrl),
    firstSeenAt: dto.first_seen_at,
    lastSeenAt: dto.last_seen_at,
    totalSightings: dto.total_sightings,
    referenceImageCount: dto.reference_image_count,
    notes: dto.notes ?? null,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export function mapAnimalEmbeddingImageFromApi(
  dto: ApiAnimalEmbeddingImageDto,
  apiBaseUrl?: string
): AnimalEmbeddingImage {
  return {
    id: dto.id,
    detectionId: dto.detection_id,
    detectionItemIndex: dto.detection_item_index,
    animalIdentityId: dto.animal_identity_id ?? null,
    cropImageUrl: resolveBackendAssetUrl(dto.crop_image_url, apiBaseUrl) || dto.crop_image_url,
    sourceImageUrl: resolveBackendAssetUrl(dto.source_image_url, apiBaseUrl) || dto.source_image_url,
    species: dto.species,
    modelName: dto.model_name,
    modelVersion: dto.model_version,
    embeddingDim: dto.embedding_dim,
    cropWidth: dto.crop_width,
    cropHeight: dto.crop_height,
    blurScore: dto.blur_score,
    qualityPassed: Boolean(dto.quality_passed),
    isReference: Boolean(dto.is_reference),
    createdAt: dto.created_at,
  };
}

export function mapReidMatchFromApi(
  dto: ApiReidMatchDto,
  apiBaseUrl?: string
): ReidMatchRecord {
  return {
    id: dto.id,
    detectionId: dto.detection_id,
    embeddingId: dto.embedding_id,
    detectionItemIndex: dto.detection_item_index,
    species: dto.species,
    matchedAnimalId: dto.matched_animal_id ?? null,
    matchedAnimalCode: dto.matched_animal_code ?? null,
    suggestedAnimalId: dto.suggested_animal_id ?? null,
    suggestedAnimalCode: dto.suggested_animal_code ?? null,
    similarityScore: dto.similarity_score ?? null,
    decision: dto.decision,
    reviewStatus: dto.review_status,
    reviewReason: dto.review_reason ?? null,
    topCandidates: (dto.top_candidates || []).map((c) => ({
      animalIdentityId: c.animal_identity_id,
      animalCode: c.animal_code,
      species: c.species,
      similarityScore: c.similarity_score,
      cropImageUrl: resolveBackendAssetUrl(c.crop_image_url, apiBaseUrl),
    })),
    cropImageUrl: resolveBackendAssetUrl(dto.crop_image_url, apiBaseUrl) || dto.crop_image_url,
    sourceImageUrl: resolveBackendAssetUrl(dto.source_image_url, apiBaseUrl) || dto.source_image_url,
    modelVersion: dto.model_version,
    thresholdsSnapshot: dto.thresholds_snapshot || {},
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export function mapIdentityReviewLogFromApi(dto: ApiIdentityReviewLogDto): IdentityReviewLog {
  return {
    id: dto.id,
    matchId: dto.match_id,
    animalIdentityId: dto.animal_identity_id ?? null,
    previousAnimalId: dto.previous_animal_id ?? null,
    action: dto.action,
    reviewedBy: dto.reviewed_by,
    reviewedAt: dto.reviewed_at,
    reason: dto.reason ?? null,
  };
}

export function mapAnimalIdentityDetailFromApi(
  dto: ApiAnimalIdentityDetailDto,
  apiBaseUrl?: string
): AnimalIdentityDetail {
  return {
    ...mapAnimalIdentitySummaryFromApi(dto, apiBaseUrl),
    images: (dto.images || []).map((img) => mapAnimalEmbeddingImageFromApi(img, apiBaseUrl)),
    matches: (dto.matches || []).map((m) => mapReidMatchFromApi(m, apiBaseUrl)),
    reviewLogs: (dto.review_logs || []).map(mapIdentityReviewLogFromApi),
  };
}

export function mapAlertRuleFromApi(dto: ApiAlertRuleDto): AlertRuleRecord {
  return {
    id: dto.id,
    name: dto.name,
    speciesFilter: dto.species_filter ?? null,
    riskLevel: dto.risk_level,
    villageId: dto.village_id ?? null,
    zoneName: dto.zone_name ?? null,
    minRepeatCount: dto.min_repeat_count,
    timeWindowMinutes: dto.time_window_minutes,
    minSpeciesConfidence: dto.min_species_confidence,
    enabled: Boolean(dto.enabled),
    autoNotifyOfficer: Boolean(dto.auto_notify_officer),
    autoDispatchIotBoundary: Boolean(dto.auto_dispatch_iot_boundary),
    description: dto.description ?? null,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export function mapAlertRuleToCreatePayload(
  input: AlertRuleCreateInput
): Record<string, unknown> {
  return {
    name: input.name.trim(),
    species_filter: input.speciesFilter?.trim() || null,
    risk_level: input.riskLevel,
    village_id: input.villageId || null,
    zone_name: input.zoneName?.trim() || null,
    min_repeat_count: input.minRepeatCount,
    time_window_minutes: input.timeWindowMinutes,
    min_species_confidence: input.minSpeciesConfidence,
    enabled: input.enabled,
    auto_notify_officer: input.autoNotifyOfficer,
    auto_dispatch_iot_boundary: input.autoDispatchIotBoundary,
    description: input.description?.trim() || null,
  };
}

export function mapForestOfficerFromApi(dto: ApiForestOfficerDto): ForestOfficerRecord {
  return {
    id: dto.id,
    name: dto.name,
    badgeNumber: dto.badge_number,
    role: dto.role,
    forestRange: dto.forest_range,
    district: dto.district,
    latitude: dto.latitude ?? null,
    longitude: dto.longitude ?? null,
    whatsappOptIn: Boolean(dto.whatsapp_opt_in),
    smsOptIn: Boolean(dto.sms_opt_in),
    contactChannel: dto.contact_channel,
    dutyStatus: dto.duty_status,
    onDuty: Boolean(dto.on_duty),
    notificationEnabled: Boolean(dto.notification_enabled),
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export function mapAlertDeliveryAttemptFromApi(
  dto: ApiAlertDeliveryAttemptDto
): AlertDeliveryAttemptRecord {
  return {
    id: dto.id,
    alertId: dto.alert_id,
    officerId: dto.officer_id ?? null,
    officerName: dto.officer_name,
    channel: dto.channel,
    routingBasis: dto.routing_basis,
    distanceKm: dto.distance_km ?? null,
    status: dto.status,
    attemptNumber: dto.attempt_number,
    detail: dto.detail ?? null,
    attemptedAt: dto.attempted_at,
  };
}

export function mapIotEventFromApi(dto: ApiIotEventDto): IotEventRecord {
  return {
    id: dto.id,
    alertId: dto.alert_id ?? null,
    cameraId: dto.camera_id ?? null,
    deviceCode: dto.device_code,
    animalIdentityId: dto.animal_identity_id ?? null,
    species: dto.species,
    confidence: dto.confidence,
    riskLevel: dto.risk_level,
    eventType: dto.event_type,
    isDevTest: Boolean(dto.is_dev_test),
    payloadJson: dto.payload_json || {},
    deliveryStatus: dto.delivery_status,
    retryCount: dto.retry_count,
    acknowledgedAt: dto.acknowledged_at ?? null,
    acknowledgedBy: dto.acknowledged_by ?? null,
    ackNote: dto.ack_note ?? null,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}
