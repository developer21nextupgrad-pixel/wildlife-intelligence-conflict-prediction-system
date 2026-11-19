import {
  Incident,
  AnimalSighting,
  VillageRiskProfile,
  AlertNotification,
  RiskZone,
  TelemetryCollar,
  UserStaff,
  PredictionResult,
  SpeciesType,
  PatrolOperation,
} from '../types';
import {
  INITIAL_VILLAGES,
  INITIAL_RISK_ZONES,
  INITIAL_TELEMETRY,
  INITIAL_STAFF,
} from './mockData';
import { generateDemoPrediction, DemoPredictionOptions } from '../utils/conflictCalculations';
import {
  AlertUpsertInput,
  ApiAlertDto,
  ApiIncidentDto,
  ApiPatrolDto,
  ApiSightingDto,
  extractApiErrorMessage,
  mapAlertFromApi,
  mapAlertToCreatePayload,
  mapAlertToUpdatePayload,
  mapIncidentFromApi,
  mapIncidentToCreatePayload,
  mapPatrolFromApi,
  mapPatrolToCreatePayload,
  mapSightingFromApi,
  mapSightingToCreatePayload,
  mapSightingToUpdatePayload,
  SightingUpsertInput,
} from '../utils/apiMappers';
import {
  clearSavedApiBaseUrl,
  DEFAULT_LOCAL_API_BASE_URL,
  formatApiUnreachableMessage,
  isValidHttpApiUrl,
  normalizeApiBaseUrl,
  readSavedApiBaseUrl,
  resolveActiveApiBaseUrl,
  SETTINGS_STORAGE_KEY,
  writeSavedApiBaseUrl,
} from '../utils/apiConfig';

const STORAGE_KEYS = {
  VILLAGES: 'wicps_villages_v1',
  TELEMETRY: 'wicps_telemetry_v1',
  STAFF: 'wicps_staff_v1',
  SETTINGS: SETTINGS_STORAGE_KEY,
};

export interface SystemSettings {
  divisionName: string;
  stateDepartment: string;
  alertSoundEnabled: boolean;
  autoRefreshIntervalSec: number;
  fastApiBaseUrl: string;
  postGisDbStatus: 'Connected (FastAPI + PostGIS)' | 'FastAPI Backend Offline';
  telemetrySource: 'Satellite + LoRaWAN Grid (Simulated)' | 'Schema Foundation (Protected)';
  minConflictThreshold: number;
  emergencyDispatchRadiusKm: number;
}

export interface ApiHealthSummary {
  status: string;
  service: string;
  version: string;
  environment: string;
  telemetry_coords_exposed: boolean;
}

export interface DatabaseHealthSummary {
  status: string;
  connected: boolean;
  dialect: string;
  postgis_enabled: boolean;
  postgis_version: string | null;
  counts: Record<string, number>;
}

export class ApiBridgeError extends Error {
  status: number;

  constructor(message: string, status: number = 0) {
    super(message);
    this.name = 'ApiBridgeError';
    this.status = status;
  }
}

export function getEnvApiBaseUrl(): string {
  const rawEnv =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    typeof import.meta.env.VITE_API_BASE_URL === 'string'
      ? import.meta.env.VITE_API_BASE_URL.trim()
      : '';
  const browserOriginFallback =
    typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/api/v1`
      : DEFAULT_LOCAL_API_BASE_URL;
  return normalizeApiBaseUrl(rawEnv || browserOriginFallback, browserOriginFallback);
}

export function getConfiguredApiBaseUrl(): string {
  return resolveActiveApiBaseUrl({ envUrl: getEnvApiBaseUrl() });
}

const DEFAULT_SETTINGS: SystemSettings = {
  divisionName: 'Bandipur Wildlife Division',
  stateDepartment: 'Forest, Ecology & Environment Department',
  alertSoundEnabled: true,
  autoRefreshIntervalSec: 30,
  fastApiBaseUrl: getEnvApiBaseUrl(),
  postGisDbStatus: 'Connected (FastAPI + PostGIS)',
  telemetrySource: 'Satellite + LoRaWAN Grid (Simulated)',
  minConflictThreshold: 65,
  emergencyDispatchRadiusKm: 5.0,
};

function getFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveToStorage<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Ignore storage quota issues for settings
  }
}

interface PaginatedApiResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  baseUrlOverride?: string
): Promise<T> {
  const baseUrl =
    baseUrlOverride !== undefined
      ? normalizeApiBaseUrl(baseUrlOverride, '')
      : getConfiguredApiBaseUrl();

  if (!baseUrl || !isValidHttpApiUrl(baseUrl)) {
    throw new ApiBridgeError(
      `Invalid FastAPI base URL "${baseUrlOverride ?? baseUrl}". Provide a full http:// or https:// URL (e.g. http://localhost:8000/api/v1 or https://your-tunnel.trycloudflare.com/api/v1).`,
      0
    );
  }

  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Network error';
    const pageProtocol = typeof window !== 'undefined' ? window.location.protocol : undefined;
    const pageOrigin = typeof window !== 'undefined' ? window.location.origin : undefined;
    throw new ApiBridgeError(
      formatApiUnreachableMessage({
        baseUrl,
        reason,
        pageProtocol,
        pageOrigin,
      }),
      0
    );
  }

  let parsedBody: unknown = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      parsedBody = await response.json();
    } catch {
      parsedBody = null;
    }
  }

  if (!response.ok) {
    const message = extractApiErrorMessage(
      response.status,
      parsedBody,
      response.statusText || 'API request failed'
    );
    throw new ApiBridgeError(message, response.status);
  }

  return parsedBody as T;
}

export const apiBridge = {
  getApiBaseUrl(): string {
    return getConfiguredApiBaseUrl();
  },

  getEnvDefaultApiBaseUrl(): string {
    return getEnvApiBaseUrl();
  },

  // --- Health & Database Verification ---
  async checkHealth(baseUrlOverride?: string): Promise<ApiHealthSummary> {
    return apiRequest<ApiHealthSummary>('/health', { method: 'GET' }, baseUrlOverride);
  },

  async checkDatabaseHealth(baseUrlOverride?: string): Promise<DatabaseHealthSummary> {
    return apiRequest<DatabaseHealthSummary>(
      '/health/database',
      { method: 'GET' },
      baseUrlOverride
    );
  },

  // --- Incidents (API-backed) ---
  async getIncidents(): Promise<Incident[]> {
    const res = await apiRequest<PaginatedApiResponse<ApiIncidentDto>>(
      '/incidents?page=1&page_size=200'
    );
    return res.items.map(mapIncidentFromApi);
  },

  async createIncident(incidentData: Omit<Incident, 'id' | 'incidentCode'>): Promise<Incident> {
    const payload = mapIncidentToCreatePayload(incidentData);
    const created = await apiRequest<ApiIncidentDto>('/incidents', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return mapIncidentFromApi(created);
  },

  async updateIncidentStatus(
    id: string,
    status: Incident['status'],
    assignedOfficer?: string
  ): Promise<Incident> {
    const body: Record<string, unknown> = { status };
    if (assignedOfficer !== undefined) {
      body.assigned_officer = assignedOfficer;
    }
    const updated = await apiRequest<ApiIncidentDto>(`/incidents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return mapIncidentFromApi(updated);
  },

  async deleteIncident(id: string): Promise<void> {
    await apiRequest<{ status: string; id: string }>(`/incidents/${id}`, {
      method: 'DELETE',
    });
  },

  // --- Sightings (API-backed) ---
  async getSightings(): Promise<AnimalSighting[]> {
    const res = await apiRequest<PaginatedApiResponse<ApiSightingDto>>(
      '/sightings?page=1&page_size=200'
    );
    return res.items.map(mapSightingFromApi);
  },

  async createSighting(
    sightingData: SightingUpsertInput
  ): Promise<AnimalSighting> {
    const payload = mapSightingToCreatePayload(sightingData);
    const created = await apiRequest<ApiSightingDto>('/sightings', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return mapSightingFromApi(created);
  },

  async updateSighting(
    id: string,
    sightingData: Partial<SightingUpsertInput>
  ): Promise<AnimalSighting> {
    const payload = mapSightingToUpdatePayload(sightingData);
    const updated = await apiRequest<ApiSightingDto>(`/sightings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return mapSightingFromApi(updated);
  },

  async deleteSighting(id: string): Promise<void> {
    await apiRequest<{ status: string; id: string }>(`/sightings/${id}`, {
      method: 'DELETE',
    });
  },

  // --- Alerts (API-backed) ---
  async getAlerts(): Promise<AlertNotification[]> {
    const res = await apiRequest<PaginatedApiResponse<ApiAlertDto>>(
      '/alerts?page=1&page_size=200'
    );
    return res.items.map(mapAlertFromApi);
  },

  async createAlert(alertData: AlertUpsertInput): Promise<AlertNotification> {
    const payload = mapAlertToCreatePayload(alertData);
    const created = await apiRequest<ApiAlertDto>('/alerts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return mapAlertFromApi(created);
  },

  async updateAlert(
    id: string,
    alertData: Partial<AlertUpsertInput>
  ): Promise<AlertNotification> {
    const payload = mapAlertToUpdatePayload(alertData);
    const updated = await apiRequest<ApiAlertDto>(`/alerts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return mapAlertFromApi(updated);
  },

  async deleteAlert(id: string): Promise<void> {
    await apiRequest<{ status: string; id: string }>(`/alerts/${id}`, {
      method: 'DELETE',
    });
  },

  async acknowledgeAlert(id: string, officerName: string): Promise<AlertNotification> {
    const updated = await apiRequest<ApiAlertDto>(`/alerts/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        acknowledged: true,
        acknowledged_by: officerName,
        acknowledged_at: new Date().toISOString(),
      }),
    });
    return mapAlertFromApi(updated);
  },

  async updateAlertResponse(
    id: string,
    status: AlertNotification['responseStatus'],
    assignedOfficer?: string
  ): Promise<AlertNotification> {
    const payload: Record<string, unknown> = { response_status: status };
    if (assignedOfficer !== undefined) {
      payload.assigned_officer = assignedOfficer.trim() || null;
    }
    const updated = await apiRequest<ApiAlertDto>(`/alerts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return mapAlertFromApi(updated);
  },

  // --- Patrol Operations (API-backed) ---
  async getPatrols(): Promise<PatrolOperation[]> {
    const res = await apiRequest<PaginatedApiResponse<ApiPatrolDto>>(
      '/patrols?page=1&page_size=200'
    );
    return res.items.map(mapPatrolFromApi);
  },

  async updatePatrolStatus(
    id: string,
    status: PatrolOperation['status']
  ): Promise<PatrolOperation> {
    const updated = await apiRequest<ApiPatrolDto>(`/patrols/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    return mapPatrolFromApi(updated);
  },

  async createPatrol(
    patrolData: Omit<PatrolOperation, 'id' | 'patrolCode'>
  ): Promise<PatrolOperation> {
    const payload = mapPatrolToCreatePayload(patrolData);
    const created = await apiRequest<ApiPatrolDto>('/patrols', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return mapPatrolFromApi(created);
  },

  async deletePatrol(id: string): Promise<void> {
    await apiRequest<{ status: string; id: string }>(`/patrols/${id}`, {
      method: 'DELETE',
    });
  },

  // --- Non-migrated Prototype Modules (Villages, Risk Zones, Telemetry, Staff, Prediction DEMO) ---
  async getVillages(): Promise<VillageRiskProfile[]> {
    return getFromStorage<VillageRiskProfile[]>(STORAGE_KEYS.VILLAGES, INITIAL_VILLAGES);
  },

  async getRiskZones(): Promise<RiskZone[]> {
    return INITIAL_RISK_ZONES;
  },

  async executePrediction(
    species: SpeciesType,
    district: string,
    forecastWindow: 'Next 24 Hours' | 'Next 3 Days' | 'Next 7 Days' | 'Next 14 Days',
    options?: DemoPredictionOptions
  ): Promise<PredictionResult> {
    await new Promise((r) => setTimeout(r, 400));
    return generateDemoPrediction(species, district, forecastWindow, options);
  },

  async getTelemetry(): Promise<TelemetryCollar[]> {
    return getFromStorage<TelemetryCollar[]>(STORAGE_KEYS.TELEMETRY, INITIAL_TELEMETRY);
  },

  async getStaff(): Promise<UserStaff[]> {
    return getFromStorage<UserStaff[]>(STORAGE_KEYS.STAFF, INITIAL_STAFF);
  },

  async getSettings(): Promise<SystemSettings> {
    const stored = getFromStorage<Partial<SystemSettings>>(STORAGE_KEYS.SETTINGS, {});
    const activeUrl = readSavedApiBaseUrl() || getEnvApiBaseUrl();
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      fastApiBaseUrl: activeUrl,
    };
  },

  async updateSettings(settings: Partial<SystemSettings>): Promise<SystemSettings> {
    const current = await this.getSettings();
    let nextUrl = current.fastApiBaseUrl;

    if (settings.fastApiBaseUrl !== undefined) {
      const normalized = normalizeApiBaseUrl(settings.fastApiBaseUrl, '');
      if (!normalized || !isValidHttpApiUrl(normalized)) {
        throw new ApiBridgeError(
          `Invalid backend URL "${settings.fastApiBaseUrl}". Use a full http:// or https:// URL ending in /api/v1.`,
          0
        );
      }
      nextUrl = writeSavedApiBaseUrl(normalized);
    }

    const updated: SystemSettings = {
      ...current,
      ...settings,
      fastApiBaseUrl: nextUrl,
    };
    saveToStorage(STORAGE_KEYS.SETTINGS, updated);
    return updated;
  },

  async resetLocalSettings(): Promise<void> {
    const envDefault = getEnvApiBaseUrl();
    clearSavedApiBaseUrl();
    saveToStorage(STORAGE_KEYS.VILLAGES, INITIAL_VILLAGES);
    saveToStorage(STORAGE_KEYS.TELEMETRY, INITIAL_TELEMETRY);
    saveToStorage(STORAGE_KEYS.STAFF, INITIAL_STAFF);
    saveToStorage(STORAGE_KEYS.SETTINGS, {
      ...DEFAULT_SETTINGS,
      fastApiBaseUrl: envDefault,
    });
  },
};
