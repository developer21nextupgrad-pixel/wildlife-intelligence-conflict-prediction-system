import {
  Incident,
  AnimalSighting,
  VillageRiskProfile,
  AlertNotification,
  RiskZone,
  TelemetryCollar,
  PatrolOperation,
} from '../types';

export interface DivisionFilterMeta {
  id: string;
  label: string;
  keywords: string[];
}

export const DIVISION_OPTIONS: DivisionFilterMeta[] = [
  {
    id: 'Bandipur Division',
    label: 'Bandipur Wildlife Division (All Ranges)',
    keywords: ['bandipur'],
  },
  {
    id: 'Hediyala Range',
    label: 'Hediyala Range',
    keywords: ['hediyala', 'kadambur', 'solakarai', 'sector 4b', 'el-04'],
  },
  {
    id: 'Gundlupet Buffer',
    label: 'Gundlupet Buffer Zone',
    keywords: ['gundlupet', 'mangala', 'lp-k4'],
  },
  {
    id: 'Maddur Range',
    label: 'Maddur Range',
    keywords: ['maddur', 'berambadi', 'el-09'],
  },
  {
    id: 'Omkar Range',
    label: 'Omkar Range',
    keywords: ['omkar', 't-114'],
  },
  {
    id: 'GS Betta Range',
    label: 'GS Betta Range',
    keywords: ['gs betta', 'gopalaswamy'],
  },
];

export const DATE_RANGE_OPTIONS = [
  { id: 'Live (Last 24 Hours)', label: 'Last 24 Hours (Live)' },
  { id: 'Last 7 Days', label: 'Last 7 Days' },
  { id: 'Last 30 Days', label: 'Last 30 Days' },
  { id: 'Current Season', label: 'Current Season (All Records)' },
] as const;

export const DIRECTION_TO_BEARING: Record<AnimalSighting['movementDirection'], number> = {
  North: 0,
  'North-East': 45,
  East: 90,
  'South-East': 135,
  South: 180,
  'South-West': 225,
  West: 270,
  'North-West': 315,
  Stationary: 0,
};

export function getBearingForDirection(
  direction: AnimalSighting['movementDirection']
): number {
  return DIRECTION_TO_BEARING[direction] ?? 0;
}

/**
 * Escapes HTML special characters to prevent XSS in Leaflet HTML tooltips.
 */
export function escapeHtml(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalizes a range/division match against a list of descriptive fields.
 */
export function matchesDivisionOrRange(
  selectedFilter: string,
  fields: Array<string | undefined | null>
): boolean {
  if (!selectedFilter || selectedFilter === 'All' || selectedFilter === 'Bandipur Division') {
    return true;
  }

  const normalizedFilter = selectedFilter.trim().toLowerCase();
  const option = DIVISION_OPTIONS.find(
    (opt) => opt.id.toLowerCase() === normalizedFilter
  );
  const keywords = option ? option.keywords : [normalizedFilter];

  const haystack = fields
    .filter((f): f is string => Boolean(f))
    .join(' ')
    .toLowerCase();

  return keywords.some((kw) => haystack.includes(kw));
}

/**
 * Parses an ISO or date-like timestamp safely. Returns null if unparseable (e.g. relative display strings).
 */
export function parseTimestampMs(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Checks whether an ISO timestamp falls within the selected date window relative to referenceNowMs.
 */
export function matchesDateWindow(
  isoDateTime: string | undefined,
  dateRange: string,
  referenceNowMs: number = Date.now()
): boolean {
  if (!dateRange || dateRange === 'All' || dateRange === 'Current Season') {
    return true;
  }

  const ts = parseTimestampMs(isoDateTime);
  if (ts === null) {
    // Non-ISO display strings (like legacy alert labels) only pass non-strict windows
    return dateRange === 'Last 30 Days' || dateRange === 'Current Season';
  }

  const diffMs = referenceNowMs - ts;
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Future timestamps logged within +/- 5 mins clock skew should still appear in Live
  if (diffMs < -5 * 60 * 1000) {
    return dateRange === 'Current Season';
  }

  if (dateRange === 'Live (Last 24 Hours)' || dateRange === 'Last 24 Hours') {
    return diffMs <= DAY_MS;
  }
  if (dateRange === 'Last 7 Days') {
    return diffMs <= 7 * DAY_MS;
  }
  if (dateRange === 'Last 30 Days') {
    return diffMs <= 30 * DAY_MS;
  }

  return true;
}

export interface WicpsDatasetBundle {
  incidents: Incident[];
  sightings: AnimalSighting[];
  villages: VillageRiskProfile[];
  alerts: AlertNotification[];
  riskZones: RiskZone[];
  telemetry: TelemetryCollar[];
  patrols: PatrolOperation[];
}

/**
 * Applies the global division/range and date-window filters consistently across all application datasets.
 */
export function filterWicpsDatasets(
  data: WicpsDatasetBundle,
  selectedDistrict: string,
  dateRange: string,
  referenceNowMs: number = Date.now()
): WicpsDatasetBundle {
  const incidents = data.incidents.filter(
    (inc) =>
      matchesDivisionOrRange(selectedDistrict, [
        inc.forestRange,
        inc.village,
        inc.district,
      ]) && matchesDateWindow(inc.dateTime, dateRange, referenceNowMs)
  );

  const sightings = data.sightings.filter(
    (s) =>
      matchesDivisionOrRange(selectedDistrict, [
        s.forestRange,
        s.locationName,
      ]) && matchesDateWindow(s.timestamp, dateRange, referenceNowMs)
  );

  const villages = data.villages.filter((v) =>
    matchesDivisionOrRange(selectedDistrict, [v.name, v.assignedRRT, v.district])
  );

  const alerts = data.alerts.filter((a) => {
    const matchesDiv = matchesDivisionOrRange(selectedDistrict, [
      a.affectedVillage,
      a.district,
      a.title,
      a.message,
    ]);
    if (!matchesDiv) return false;
    // Alerts with acknowledgedAt or ISO timestamps respect date window when strict Live/7d is tested if timestamp exists;
    // unacknowledged sample alerts use display string `alertTime` (`18 mins ago...`) which resolves in Live/7d/30d.
    if (dateRange === 'Live (Last 24 Hours)') {
      if (a.acknowledgedAt) {
        return matchesDateWindow(a.acknowledgedAt, dateRange, referenceNowMs);
      }
      return a.alertTime.toLowerCase().includes('min') || a.alertTime.toLowerCase().includes('hr');
    }
    return true;
  });

  const riskZones = data.riskZones.filter((rz) =>
    matchesDivisionOrRange(selectedDistrict, [rz.range, rz.name, rz.district])
  );

  const telemetry = data.telemetry.filter((t) =>
    matchesDivisionOrRange(selectedDistrict, [
      t.animalId,
      t.animalName,
      t.direction,
    ])
  );

  const patrols = data.patrols.filter((p) =>
    matchesDivisionOrRange(selectedDistrict, [p.sector, p.targetArea, p.teamName])
  );

  return {
    incidents,
    sightings,
    villages,
    alerts,
    riskZones,
    telemetry,
    patrols,
  };
}

/**
 * Validates WGS84 latitude and longitude coordinates.
 */
export function validateCoordinates(
  latitude: number,
  longitude: number
): { valid: boolean; latError?: string; lngError?: string } {
  let latError: string | undefined;
  let lngError: string | undefined;

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    latError = 'Valid latitude (-90 to 90) is required.';
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    lngError = 'Valid longitude (-180 to 180) is required.';
  }

  return {
    valid: !latError && !lngError,
    latError,
    lngError,
  };
}

export interface IncidentValidationInput {
  species?: string;
  incidentType?: string;
  dateTime?: string;
  severity?: string;
  village: string;
  district?: string;
  forestRange?: string;
  humanInjury?: string;
  status?: string;
  reportedBy?: string;
  description: string;
  latitude: number;
  longitude: number;
  cropDamageEstimatedAcres: number;
}

export function validateIncidentInput(
  input: IncidentValidationInput
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (input.species !== undefined && !input.species.trim()) {
    errors.species = 'Wildlife species is required.';
  }
  if (input.incidentType !== undefined && !input.incidentType.trim()) {
    errors.incidentType = 'Incident classification is required.';
  }
  if (input.dateTime !== undefined && !input.dateTime.trim()) {
    errors.dateTime = 'Date & time of occurrence is required.';
  }
  if (input.severity !== undefined && !input.severity.trim()) {
    errors.severity = 'Severity level is required.';
  }
  if (!input.village.trim()) errors.village = 'Village name is required.';
  if (input.district !== undefined && !input.district.trim()) {
    errors.district = 'District / wildlife division is required.';
  }
  if (input.forestRange !== undefined && !input.forestRange.trim()) {
    errors.forestRange = 'Forest range is required.';
  }
  if (input.humanInjury !== undefined && !input.humanInjury.trim()) {
    errors.humanInjury = 'Human injury status is required.';
  }
  if (input.status !== undefined && !input.status.trim()) {
    errors.status = 'Initial status is required.';
  }
  if (input.reportedBy !== undefined && !input.reportedBy.trim()) {
    errors.reportedBy = 'Reporting person / unit is required.';
  }
  if (!input.description.trim()) errors.description = 'Incident description is required.';
  if (!Number.isFinite(input.cropDamageEstimatedAcres) || input.cropDamageEstimatedAcres < 0) {
    errors.cropDamageEstimatedAcres = 'Crop loss must be 0 or greater.';
  }
  const coords = validateCoordinates(input.latitude, input.longitude);
  if (coords.latError) errors.latitude = coords.latError;
  if (coords.lngError) errors.longitude = coords.lngError;
  return errors;
}

export interface SightingValidationInput {
  species?: string;
  timestamp?: string;
  movementDirection?: string;
  behavior?: string;
  locationName: string;
  observationDetails: string;
  herdSize: number;
  latitude: number;
  longitude: number;
  forestRange: string;
  district?: string;
  observerName: string;
  observerRole: string;
  photoUrl?: string;
}

export function validateSightingInput(
  input: SightingValidationInput
): Record<string, string> {
  const errs: Record<string, string> = {};
  if (input.species !== undefined && !input.species.trim()) {
    errs.species = 'Wildlife species is required.';
  }
  if (input.timestamp !== undefined && !input.timestamp.trim()) {
    errs.timestamp = 'Sighting date & time is required.';
  }
  if (input.movementDirection !== undefined && !input.movementDirection.trim()) {
    errs.movementDirection = 'Movement direction is required.';
  }
  if (input.behavior !== undefined && !input.behavior.trim()) {
    errs.behavior = 'Observed behavior is required.';
  }
  if (!input.locationName.trim()) errs.locationName = 'Location name or landmark is required.';
  if (!input.observationDetails.trim()) errs.observationDetails = 'Observation details are required.';
  if (!Number.isFinite(input.herdSize) || input.herdSize < 1 || input.herdSize > 500) {
    errs.herdSize = 'Herd size must be between 1 and 500.';
  }
  if (!input.forestRange.trim()) errs.forestRange = 'Forest range is required.';
  if (input.district !== undefined && !input.district.trim()) {
    errs.district = 'District / division is required.';
  }
  if (!input.observerName.trim()) errs.observerName = 'Observer name is required.';
  if (!input.observerRole.trim()) errs.observerRole = 'Observer role is required.';
  if (input.photoUrl !== undefined && input.photoUrl.trim()) {
    const trimmedPhoto = input.photoUrl.trim();
    if (trimmedPhoto.length > 512) {
      errs.photoUrl = 'Image URL must be 512 characters or fewer.';
    } else if (!/^(https?:\/\/|\/|data:image\/)/i.test(trimmedPhoto)) {
      errs.photoUrl = 'Image URL must start with http://, https://, or /.';
    }
  }
  const coords = validateCoordinates(input.latitude, input.longitude);
  if (coords.latError) errs.latitude = coords.latError;
  if (coords.lngError) errs.longitude = coords.lngError;
  return errs;
}

export interface AlertValidationInput {
  title: string;
  message: string;
  severity?: string;
  species?: string;
  responseStatus?: string;
  affectedVillage: string;
  district: string;
  latitude: number;
  longitude: number;
}

export function validateAlertInput(input: AlertValidationInput): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!input.title.trim()) errs.title = 'Alert title is required.';
  if (!input.message.trim()) errs.message = 'Alert message / description is required.';
  if (input.severity !== undefined && !input.severity.trim()) {
    errs.severity = 'Severity level is required.';
  }
  if (input.species !== undefined && !input.species.trim()) {
    errs.species = 'Species is required.';
  }
  if (input.responseStatus !== undefined && !input.responseStatus.trim()) {
    errs.responseStatus = 'Response status is required.';
  }
  if (!input.affectedVillage.trim()) errs.affectedVillage = 'Affected village is required.';
  if (!input.district.trim()) errs.district = 'District / division is required.';
  const coords = validateCoordinates(input.latitude, input.longitude);
  if (coords.latError) errs.latitude = coords.latError;
  if (coords.lngError) errs.longitude = coords.lngError;
  return errs;
}

export interface PatrolValidationInput {
  teamName: string;
  leadOfficer: string;
  targetArea: string;
  sector: string;
  district?: string;
  priority: string;
  status: string;
  scheduledWindow: string;
  activePersonnel: number;
  riskRationale: string;
  approvedBy: string;
  latitude: number;
  longitude: number;
}

export function validatePatrolInput(input: PatrolValidationInput): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!input.teamName.trim()) errs.teamName = 'Squad designation is required.';
  if (!input.leadOfficer.trim()) errs.leadOfficer = 'Lead officer is required.';
  if (!input.targetArea.trim()) errs.targetArea = 'Target area is required.';
  if (!input.sector.trim()) errs.sector = 'Patrol sector is required.';
  if (input.district !== undefined && !input.district.trim()) {
    errs.district = 'District / division is required.';
  }
  if (!input.priority.trim()) errs.priority = 'Priority classification is required.';
  if (!input.status.trim()) errs.status = 'Initial status is required.';
  if (!input.scheduledWindow.trim()) errs.scheduledWindow = 'Operating window is required.';
  if (!Number.isFinite(input.activePersonnel) || input.activePersonnel < 1 || input.activePersonnel > 200) {
    errs.activePersonnel = 'Personnel count must be between 1 and 200.';
  }
  if (!input.riskRationale.trim()) errs.riskRationale = 'Deployment rationale is required.';
  if (!input.approvedBy.trim()) errs.approvedBy = 'Authorizing officer is required.';
  const coords = validateCoordinates(input.latitude, input.longitude);
  if (coords.latError) errs.latitude = coords.latError;
  if (coords.lngError) errs.longitude = coords.lngError;
  return errs;
}
