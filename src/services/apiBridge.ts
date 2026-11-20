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
  ThermalCamera,
  ThermalCameraCreateInput,
  ThermalCameraCreateResult,
  ThermalFrameRecord,
  DevSampleIngestResult,
  RtspTestPullInput,
  RtspTestPullResult,
} from '../types';
import {
  INITIAL_TELEMETRY,
  INITIAL_STAFF,
} from './mockData';
import { generateDemoPrediction, DemoPredictionOptions } from '../utils/conflictCalculations';
import {
  AlertUpsertInput,
  ApiAlertDto,
  ApiCameraCreateDto,
  ApiCameraDto,
  ApiDevSampleIngestDto,
  ApiGeoJsonFeatureCollectionDto,
  ApiIncidentDto,
  ApiPatrolDto,
  ApiRiskZoneFeatureDto,
  ApiRtspTestPullDto,
  ApiSightingDto,
  ApiThermalFrameDto,
  ApiVillageDto,
  buildThermalFrameFilterQuery,
  extractApiErrorMessage,
  IncidentUpsertInput,
  mapAlertFromApi,
  mapAlertToCreatePayload,
  mapAlertToUpdatePayload,
  mapCameraCreateFromApi,
  mapCameraFromApi,
  mapCameraToCreatePayload,
  mapDevSampleIngestFromApi,
  mapIncidentFromApi,
  mapIncidentToCreatePayload,
  mapIncidentToUpdatePayload,
  mapPatrolFromApi,
  mapPatrolToCreatePayload,
  mapPatrolToUpdatePayload,
  mapRiskZoneFromGeoJson,
  mapRtspTestPullFromApi,
  mapSightingFromApi,
  mapSightingToCreatePayload,
  mapSightingToUpdatePayload,
  mapThermalFrameFromApi,
  mapVillageFromApi,
  PatrolUpsertInput,
  SightingUpsertInput,
  ThermalFrameFilterParams,
} from '../utils/apiMappers';
import {
  clearSavedApiBaseUrl,
  DEFAULT_LOCAL_API_BASE_URL,
  formatApiUnreachableMessage,
  isLocalhostUrl,
  isValidHttpApiUrl,
  normalizeApiBaseUrl,
  readSavedApiBaseUrl,
  resolveActiveApiBaseUrl,
  SETTINGS_STORAGE_KEY,
  writeSavedApiBaseUrl,
} from '../utils/apiConfig';

const STORAGE_KEYS = {
  LEGACY_VILLAGES: 'wicps_villages_v1',
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

  // In unified server.ts preview/runtime, port 8000 is not the browser-facing API origin;
  // route localhost env defaults through same-origin /api/v1 unless explicitly overridden in Settings.
  if (!rawEnv || (typeof window !== 'undefined' && window.location?.origin && isLocalhostUrl(rawEnv))) {
    return normalizeApiBaseUrl(browserOriginFallback, browserOriginFallback);
  }
  return normalizeApiBaseUrl(rawEnv, browserOriginFallback);
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
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = isFormData
    ? { ...((options.headers as Record<string, string>) || {}) }
    : {
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
      };
  try {
    response = await fetch(url, {
      ...options,
      headers,
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
    if (response.status === 404 && /not found/i.test(message)) {
      throw new ApiBridgeError(
        `${message} (${options.method || 'GET'} ${url}). Verify VITE_API_BASE_URL points to the Render FastAPI /api/v1 service and Phase 1 routes + Alembic 0002 are deployed.`,
        response.status
      );
    }
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

  async updateIncident(
    id: string,
    incidentData: Partial<IncidentUpsertInput>
  ): Promise<Incident> {
    const payload = mapIncidentToUpdatePayload(incidentData);
    const updated = await apiRequest<ApiIncidentDto>(`/incidents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return mapIncidentFromApi(updated);
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

  async updatePatrol(
    id: string,
    patrolData: Partial<PatrolUpsertInput>
  ): Promise<PatrolOperation> {
    const payload = mapPatrolToUpdatePayload(patrolData);
    const updated = await apiRequest<ApiPatrolDto>(`/patrols/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return mapPatrolFromApi(updated);
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

  // --- Villages & GIS Risk Zones (API-backed) ---
  async getVillages(): Promise<VillageRiskProfile[]> {
    const res = await apiRequest<PaginatedApiResponse<ApiVillageDto>>(
      '/villages?page=1&page_size=200'
    );
    return res.items.map(mapVillageFromApi);
  },

  async getRiskZones(): Promise<RiskZone[]> {
    const fc = await apiRequest<ApiGeoJsonFeatureCollectionDto<ApiRiskZoneFeatureDto>>(
      '/gis/risk-zones'
    );
    return (fc.features ?? []).map(mapRiskZoneFromGeoJson);
  },

  // --- Phase 1: Thermal Cameras & Frame Ingestion ---
  async getCameras(): Promise<ThermalCamera[]> {
    const res = await apiRequest<PaginatedApiResponse<ApiCameraDto>>(
      '/cameras?page=1&page_size=200'
    );
    return res.items.map(mapCameraFromApi);
  },

  async registerCamera(input: ThermalCameraCreateInput): Promise<ThermalCameraCreateResult> {
    const payload = mapCameraToCreatePayload(input);
    const created = await apiRequest<ApiCameraCreateDto>('/cameras', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return mapCameraCreateFromApi(created);
  },

  async updateCameraStatus(
    cameraId: string,
    status: ThermalCamera['status']
  ): Promise<ThermalCamera> {
    const updated = await apiRequest<ApiCameraDto>(`/cameras/${cameraId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    return mapCameraFromApi(updated);
  },

  async getThermalFrames(filters: ThermalFrameFilterParams = {}): Promise<{
    items: ThermalFrameRecord[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const qs = buildThermalFrameFilterQuery(filters);
    const res = await apiRequest<PaginatedApiResponse<ApiThermalFrameDto>>(
      `/ingest/frames?${qs}`
    );
    return {
      items: res.items.map(mapThermalFrameFromApi),
      total: res.total,
      page: res.page,
      pageSize: res.page_size,
      totalPages: res.total_pages,
    };
  },

  async uploadDevSample(params: {
    file: File;
    cameraId?: string;
    targetFps?: number;
    onProgress?: (percent: number) => void;
  }): Promise<DevSampleIngestResult> {
    const formData = new FormData();
    formData.append('file', params.file);
    if (params.cameraId) {
      formData.append('camera_id', params.cameraId);
    }
    if (params.targetFps !== undefined) {
      formData.append('target_fps', String(params.targetFps));
    }

    if (params.onProgress && typeof XMLHttpRequest !== 'undefined') {
      const baseUrl = getConfiguredApiBaseUrl();
      const url = `${baseUrl}/ingest/dev-sample`;
      const dto = await new Promise<ApiDevSampleIngestDto>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable && evt.total > 0) {
            params.onProgress?.(Math.min(100, Math.round((evt.loaded / evt.total) * 100)));
          }
        };
        xhr.onload = () => {
          let parsed: unknown = null;
          try {
            parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
          } catch {
            parsed = null;
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(parsed as ApiDevSampleIngestDto);
          } else {
            const msg = extractApiErrorMessage(
              xhr.status,
              parsed,
              xhr.statusText || 'Thermal upload failed'
            );
            reject(new ApiBridgeError(msg, xhr.status));
          }
        };
        xhr.onerror = () => {
          reject(
            new ApiBridgeError(
              `Network error uploading thermal sample to ${url}.`,
              0
            )
          );
        };
        xhr.send(formData);
      });
      return mapDevSampleIngestFromApi(dto);
    }

    const res = await apiRequest<ApiDevSampleIngestDto>('/ingest/dev-sample', {
      method: 'POST',
      body: formData,
    });
    return mapDevSampleIngestFromApi(res);
  },

  getThermalFrameImageUrl(
    frameId: string,
    variant: 'raw' | 'processed',
    preview: boolean = variant === 'raw'
  ): string {
    const baseUrl = getConfiguredApiBaseUrl();
    const qs = new URLSearchParams({ variant });
    if (preview && variant === 'raw') {
      qs.set('preview', 'true');
    }
    return `${baseUrl}/ingest/frames/${frameId}/image?${qs.toString()}`;
  },

  async testRtspPull(input: RtspTestPullInput): Promise<RtspTestPullResult> {
    const res = await apiRequest<ApiRtspTestPullDto>('/ingest/rtsp/test-pull', {
      method: 'POST',
      body: JSON.stringify({
        camera_id: input.cameraId || null,
        rtsp_url: input.rtspUrl.trim(),
        max_frames: input.maxFrames,
        timeout_seconds: input.timeoutSeconds,
      }),
    });
    return mapRtspTestPullFromApi(res);
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
    try {
      localStorage.removeItem(STORAGE_KEYS.LEGACY_VILLAGES);
    } catch {
      // Ignore storage access issues
    }
    saveToStorage(STORAGE_KEYS.TELEMETRY, INITIAL_TELEMETRY);
    saveToStorage(STORAGE_KEYS.STAFF, INITIAL_STAFF);
    saveToStorage(STORAGE_KEYS.SETTINGS, {
      ...DEFAULT_SETTINGS,
      fastApiBaseUrl: envDefault,
    });
  },
};
