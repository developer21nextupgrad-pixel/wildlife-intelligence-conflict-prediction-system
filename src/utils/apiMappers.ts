import {
  AlertNotification,
  AnimalSighting,
  Incident,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
  PatrolOperation,
  SpeciesType,
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
