import {
  AlertNotification,
  AnimalSighting,
  CameraProtocol,
  CameraStatus,
  CameraZoneType,
  DevSampleIngestResult,
  Incident,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
  PatrolOperation,
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
  camera_id: string;
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
    cameraId: dto.camera_id,
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

