import {
  AlertDeliveryAttemptRecord,
  AlertNotification,
  AlertRuleCreateInput,
  AlertRuleRecord,
  AnimalDetectionRecord,
  AnimalIdentityDetail,
  AnimalIdentitySummary,
  AnimalSighting,
  DevSampleIngestResult,
  ForestOfficerRecord,
  Incident,
  IotEventRecord,
  PatrolOperation,
  ReidMatchRecord,
  RiskZone,
  RtspTestPullInput,
  RtspTestPullResult,
  SpeciesType,
  TelemetryCollar,
  ThermalCamera,
  ThermalCameraCreateInput,
  ThermalCameraCreateResult,
  ThermalFrameRecord,
  UserStaff,
  VillageRiskProfile,
  PredictionResult,
} from '../types';
import {
  INITIAL_TELEMETRY,
  INITIAL_STAFF,
} from './mockData';
import { generateDemoPrediction, DemoPredictionOptions } from '../utils/conflictCalculations';
import {
  AlertUpsertInput,
  ApiAlertDeliveryAttemptDto,
  ApiAlertDto,
  ApiAlertRuleDto,
  ApiAnimalDetectionDto,
  ApiAnimalIdentityDetailDto,
  ApiAnimalIdentitySummaryDto,
  ApiCameraCreateDto,
  ApiCameraDto,
  ApiDevSampleIngestDto,
  ApiForestOfficerDto,
  ApiGeoJsonFeatureCollectionDto,
  ApiIncidentDto,
  ApiIotEventDto,
  ApiPatrolDto,
  ApiReidMatchDto,
  ApiRiskZoneFeatureDto,
  ApiRtspTestPullDto,
  ApiSightingDto,
  ApiThermalFrameDto,
  ApiVillageDto,
  buildThermalFrameFilterQuery,
  extractApiErrorMessage,
  IncidentUpsertInput,
  mapAlertDeliveryAttemptFromApi,
  mapAlertFromApi,
  mapAlertRuleFromApi,
  mapAlertRuleToCreatePayload,
  mapAlertToCreatePayload,
  mapAlertToUpdatePayload,
  mapAnimalDetectionFromApi,
  mapAnimalIdentityDetailFromApi,
  mapAnimalIdentitySummaryFromApi,
  mapCameraCreateFromApi,
  mapCameraFromApi,
  mapCameraToCreatePayload,
  mapDevSampleIngestFromApi,
  mapForestOfficerFromApi,
  mapIncidentFromApi,
  mapIncidentToCreatePayload,
  mapIncidentToUpdatePayload,
  mapIotEventFromApi,
  mapPatrolFromApi,
  mapPatrolToCreatePayload,
  mapPatrolToUpdatePayload,
  mapReidMatchFromApi,
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
  resolveEnvApiBaseUrl,
  SETTINGS_STORAGE_KEY,
  writeSavedApiBaseUrl,
} from '../utils/apiConfig';
import {
  AuthenticatedUserProfile,
  AuthStatusSummary,
  clearStoredAuthSession,
  emitAuthUnauthorized,
  getStoredAuthToken,
  normalizeWicpsRole,
  setStoredAuthSession,
  UserAccountRecord,
  WicpsRole,
} from '../utils/authStorage';

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
  return resolveEnvApiBaseUrl({
    rawEnvUrl: rawEnv,
    pageOrigin: typeof window !== 'undefined' ? window.location?.origin : null,
    pageProtocol: typeof window !== 'undefined' ? window.location?.protocol : null,
  });
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
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  let response: Response;
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = isFormData
    ? { ...((options.headers as Record<string, string>) || {}) }
    : {
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
      };
  const token = getStoredAuthToken();
  const hasCameraKey = Boolean(headers['X-Camera-Key'] || headers['x-camera-key']);
  if (token && !headers.Authorization && !headers.authorization && !hasCameraKey) {
    headers.Authorization = `Bearer ${token}`;
  }
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
    if (
      response.status === 401 &&
      !hasCameraKey &&
      !normalizedPath.startsWith('/auth/login') &&
      !normalizedPath.startsWith('/auth/register') &&
      !normalizedPath.startsWith('/auth/forgot-password') &&
      !normalizedPath.startsWith('/auth/reset-password') &&
      !normalizedPath.startsWith('/auth/bootstrap-admin') &&
      !normalizedPath.startsWith('/auth/status')
    ) {
      emitAuthUnauthorized();
    }
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

interface ApiAuthStatusDto {
  authenticated?: boolean;
  user?: ApiAuthenticatedProfileDto | null;
  auth_enabled: boolean;
  password_login_enabled: boolean;
  oidc_enabled: boolean;
  oidc_issuer: string | null;
  needs_initial_setup: boolean;
}

interface ApiAuthenticatedProfileDto {
  id: string | null;
  subject: string;
  email: string | null;
  display_name: string;
  role: string;
  roles: string[];
  effective_roles: string[];
  auth_method: string;
}

interface ApiLoginResponseDto {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: ApiAuthenticatedProfileDto;
}

interface ApiUserAccountDto {
  id: string;
  email: string;
  username: string;
  display_name: string;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ApiRegisterResponseDto {
  id: string;
  email: string;
  username: string;
  display_name: string;
  role: string;
  is_active: boolean;
  requires_approval: boolean;
  message: string;
}

interface ApiForgotPasswordResponseDto {
  status: string;
  message: string;
}

interface ApiValidateResetTokenResponseDto {
  valid: boolean;
  expires_at?: string | null;
  detail?: string | null;
}

interface ApiResetPasswordResponseDto {
  status: string;
  message: string;
}

interface ApiAnimalDetectionListDto extends PaginatedApiResponse<ApiAnimalDetectionDto> {
  eligible_clear_count?: number;
}

interface ApiAnimalDetectionDeleteDto {
  status: string;
  id: string;
  source_filename: string;
  deleted_at: string;
  deleted_by: string;
  storage_cleaned: boolean;
  storage_preserved_reason?: string | null;
}

interface ApiAnimalDetectionClearDto {
  status: string;
  cleared_count: number;
  skipped_unauthorized_count: number;
  storage_objects_cleaned: number;
  storage_objects_preserved: number;
}

function mapUserProfileFromApi(dto: ApiAuthenticatedProfileDto): AuthenticatedUserProfile {
  return {
    id: dto.id ?? null,
    subject: dto.subject,
    email: dto.email ?? null,
    displayName: dto.display_name,
    role: normalizeWicpsRole(dto.role),
    roles: dto.roles ?? [],
    effectiveRoles: dto.effective_roles ?? [],
    authMethod: dto.auth_method,
  };
}

function mapUserAccountFromApi(dto: ApiUserAccountDto): UserAccountRecord {
  return {
    id: dto.id,
    email: dto.email,
    username: dto.username,
    displayName: dto.display_name,
    role: normalizeWicpsRole(dto.role),
    isActive: dto.is_active,
    lastLoginAt: dto.last_login_at ?? null,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export const apiBridge = {
  getApiBaseUrl(): string {
    return getConfiguredApiBaseUrl();
  },

  getEnvDefaultApiBaseUrl(): string {
    return getEnvApiBaseUrl();
  },

  // --- Authentication & RBAC ---
  async getAuthStatus(baseUrlOverride?: string): Promise<AuthStatusSummary> {
    const dto = await apiRequest<ApiAuthStatusDto>('/auth/status', { method: 'GET' }, baseUrlOverride);
    const mappedUser = dto?.user ? mapUserProfileFromApi(dto.user) : null;
    return {
      authenticated: Boolean(dto?.authenticated && mappedUser),
      user: mappedUser,
      authEnabled: Boolean(dto?.auth_enabled),
      passwordLoginEnabled: Boolean(dto?.password_login_enabled),
      oidcEnabled: Boolean(dto?.oidc_enabled),
      oidcIssuer: dto?.oidc_issuer ?? null,
      needsInitialSetup: Boolean(dto?.needs_initial_setup),
    };
  },

  async bootstrapInitialAdmin(input: {
    email: string;
    displayName: string;
    password: string;
  }): Promise<AuthenticatedUserProfile> {
    const res = await apiRequest<ApiLoginResponseDto>('/auth/bootstrap-admin', {
      method: 'POST',
      body: JSON.stringify({
        email: input.email.trim(),
        display_name: input.displayName.trim(),
        password: input.password,
      }),
    });
    const profile = mapUserProfileFromApi(res.user);
    setStoredAuthSession(res.access_token, profile);
    return profile;
  },

  async login(identifier: string, password: string): Promise<AuthenticatedUserProfile> {
    const res = await apiRequest<ApiLoginResponseDto>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        identifier: identifier.trim(),
        password,
      }),
    });
    const profile = mapUserProfileFromApi(res.user);
    setStoredAuthSession(res.access_token, profile);
    return profile;
  },

  async registerAccount(input: {
    fullName: string;
    email: string;
    password: string;
    confirmPassword: string;
  }): Promise<{
    id: string;
    email: string;
    username: string;
    displayName: string;
    role: WicpsRole;
    isActive: boolean;
    requiresApproval: boolean;
    message: string;
  }> {
    const res = await apiRequest<ApiRegisterResponseDto>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        full_name: input.fullName.trim(),
        email: input.email.trim(),
        password: input.password,
        confirm_password: input.confirmPassword,
      }),
    });
    return {
      id: res.id,
      email: res.email,
      username: res.username,
      displayName: res.display_name,
      role: normalizeWicpsRole(res.role),
      isActive: Boolean(res.is_active),
      requiresApproval: Boolean(res.requires_approval),
      message: res.message,
    };
  },

  async requestPasswordReset(email: string): Promise<{ status: string; message: string }> {
    const res = await apiRequest<ApiForgotPasswordResponseDto>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim() }),
    });
    return { status: res.status, message: res.message };
  },

  async validatePasswordResetToken(token: string): Promise<{
    valid: boolean;
    expiresAt: string | null;
    detail: string | null;
  }> {
    const res = await apiRequest<ApiValidateResetTokenResponseDto>('/auth/reset-password/validate', {
      method: 'POST',
      body: JSON.stringify({ token: token.trim() }),
    });
    return {
      valid: Boolean(res.valid),
      expiresAt: res.expires_at ?? null,
      detail: res.detail ?? null,
    };
  },

  async resetPassword(input: {
    token: string;
    newPassword: string;
    confirmPassword: string;
  }): Promise<{ status: string; message: string }> {
    const res = await apiRequest<ApiResetPasswordResponseDto>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        token: input.token.trim(),
        new_password: input.newPassword,
        confirm_password: input.confirmPassword,
      }),
    });
    return { status: res.status, message: res.message };
  },

  async getCurrentUser(): Promise<AuthenticatedUserProfile> {
    const dto = await apiRequest<ApiAuthenticatedProfileDto>('/auth/me', { method: 'GET' });
    const profile = mapUserProfileFromApi(dto);
    const token = getStoredAuthToken();
    if (token) {
      setStoredAuthSession(token, profile);
    }
    return profile;
  },

  async authenticateWithToken(rawToken: string): Promise<AuthenticatedUserProfile> {
    const clean = rawToken.trim();
    const dto = await apiRequest<ApiAuthenticatedProfileDto>('/auth/me', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${clean}`,
      },
    });
    const profile = mapUserProfileFromApi(dto);
    setStoredAuthSession(clean, profile);
    return profile;
  },

  logout(): void {
    clearStoredAuthSession();
  },

  async listUsers(): Promise<UserAccountRecord[]> {
    const rows = await apiRequest<ApiUserAccountDto[]>('/auth/users', { method: 'GET' });
    return rows.map(mapUserAccountFromApi);
  },

  async createUser(input: {
    email: string;
    username?: string;
    displayName: string;
    role: WicpsRole;
    password: string;
  }): Promise<UserAccountRecord> {
    const dto = await apiRequest<ApiUserAccountDto>('/auth/users', {
      method: 'POST',
      body: JSON.stringify({
        email: input.email.trim(),
        username: input.username?.trim() || null,
        display_name: input.displayName.trim(),
        role: input.role,
        password: input.password,
      }),
    });
    return mapUserAccountFromApi(dto);
  },

  async updateUser(
    userId: string,
    updates: {
      displayName?: string;
      role?: WicpsRole;
      isActive?: boolean;
      password?: string;
    }
  ): Promise<UserAccountRecord> {
    const payload: Record<string, unknown> = {};
    if (updates.displayName !== undefined) payload.display_name = updates.displayName.trim();
    if (updates.role !== undefined) payload.role = updates.role;
    if (updates.isActive !== undefined) payload.is_active = updates.isActive;
    if (updates.password !== undefined && updates.password) payload.password = updates.password;
    const dto = await apiRequest<ApiUserAccountDto>(`/auth/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return mapUserAccountFromApi(dto);
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

  async deleteCamera(cameraId: string): Promise<{
    status: string;
    id: string;
    camera_code?: string;
    preserved_frames?: number;
  }> {
    return apiRequest<{
      status: string;
      id: string;
      camera_code?: string;
      preserved_frames?: number;
    }>(`/cameras/${cameraId}`, {
      method: 'DELETE',
    });
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
        const token = getStoredAuthToken();
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }
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
            if (xhr.status === 401) {
              emitAuthUnauthorized();
            }
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

  // --- Phase 1 / Phase 2 / Phase 3: Animal Detection, SpeciesNet, Re-ID & Wildlife Intelligence ---
  getAnimalDetectionImageUrl(detectionId: string): string {
    const baseUrl = getConfiguredApiBaseUrl();
    return `${baseUrl}/detections/${detectionId}/image`;
  },

  async getAnimalDetections(params: {
    page?: number;
    pageSize?: number;
    processingStatus?: string;
    search?: string;
  } = {}): Promise<{
    items: AnimalDetectionRecord[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    eligibleClearCount: number;
  }> {
    const baseUrl = getConfiguredApiBaseUrl();
    const qs = new URLSearchParams();
    qs.set('page', String(params.page ?? 1));
    qs.set('page_size', String(params.pageSize ?? 25));
    if (params.processingStatus && params.processingStatus !== 'All') {
      qs.set('processing_status', params.processingStatus);
    }
    if (params.search && params.search.trim()) {
      qs.set('search', params.search.trim());
    }
    const res = await apiRequest<ApiAnimalDetectionListDto>(
      `/detections?${qs.toString()}`
    );
    return {
      items: res.items.map((dto) =>
        mapAnimalDetectionFromApi(dto, this.getAnimalDetectionImageUrl(dto.id), baseUrl)
      ),
      total: res.total,
      page: res.page,
      pageSize: res.page_size,
      totalPages: res.total_pages,
      eligibleClearCount: res.eligible_clear_count ?? res.total,
    };
  },

  async getAnimalDetectionById(detectionId: string): Promise<AnimalDetectionRecord> {
    const baseUrl = getConfiguredApiBaseUrl();
    const dto = await apiRequest<ApiAnimalDetectionDto>(`/detections/${detectionId}`);
    return mapAnimalDetectionFromApi(dto, this.getAnimalDetectionImageUrl(dto.id), baseUrl);
  },

  async deleteAnimalDetection(
    detectionId: string,
    reason?: string
  ): Promise<{
    status: string;
    id: string;
    sourceFilename: string;
    deletedAt: string;
    deletedBy: string;
    storageCleaned: boolean;
    storagePreservedReason: string | null;
  }> {
    const qs = new URLSearchParams();
    if (reason && reason.trim()) {
      qs.set('reason', reason.trim());
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await apiRequest<ApiAnimalDetectionDeleteDto>(
      `/detections/${detectionId}${suffix}`,
      { method: 'DELETE' }
    );
    return {
      status: res.status,
      id: res.id,
      sourceFilename: res.source_filename,
      deletedAt: res.deleted_at,
      deletedBy: res.deleted_by,
      storageCleaned: Boolean(res.storage_cleaned),
      storagePreservedReason: res.storage_preserved_reason ?? null,
    };
  },

  async clearAnimalDetectionHistory(params: {
    processingStatus?: string;
    search?: string;
    reason?: string;
  } = {}): Promise<{
    status: string;
    clearedCount: number;
    skippedUnauthorizedCount: number;
    storageObjectsCleaned: number;
    storageObjectsPreserved: number;
  }> {
    const qs = new URLSearchParams();
    if (params.processingStatus && params.processingStatus !== 'All') {
      qs.set('processing_status', params.processingStatus);
    }
    if (params.search && params.search.trim()) {
      qs.set('search', params.search.trim());
    }
    if (params.reason && params.reason.trim()) {
      qs.set('reason', params.reason.trim());
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await apiRequest<ApiAnimalDetectionClearDto>(`/detections${suffix}`, {
      method: 'DELETE',
    });
    return {
      status: res.status,
      clearedCount: res.cleared_count,
      skippedUnauthorizedCount: res.skipped_unauthorized_count,
      storageObjectsCleaned: res.storage_objects_cleaned,
      storageObjectsPreserved: res.storage_objects_preserved,
    };
  },

  async uploadAnimalDetectionImage(params: {
    file: File;
    countryCode?: string;
    admin1Region?: string;
    cameraId?: string;
    villageId?: string;
    latitude?: number;
    longitude?: number;
    locationName?: string;
    capturedAt?: string;
    autoCreateSighting?: boolean;
    idempotencyKey?: string;
    onProgress?: (percent: number) => void;
  }): Promise<AnimalDetectionRecord> {
    const baseUrl = getConfiguredApiBaseUrl();
    const formData = new FormData();
    formData.append('file', params.file);
    if (params.countryCode && params.countryCode.trim()) {
      formData.append('country_code', params.countryCode.trim().toUpperCase());
    }
    if (params.admin1Region && params.admin1Region.trim()) {
      formData.append('admin1_region', params.admin1Region.trim().toUpperCase());
    }
    if (params.cameraId && params.cameraId.trim()) {
      formData.append('camera_id', params.cameraId.trim());
    }
    if (params.villageId && params.villageId.trim()) {
      formData.append('village_id', params.villageId.trim());
    }
    if (params.latitude !== undefined && params.longitude !== undefined) {
      formData.append('latitude', String(params.latitude));
      formData.append('longitude', String(params.longitude));
    }
    if (params.locationName && params.locationName.trim()) {
      formData.append('location_name', params.locationName.trim());
    }
    if (params.capturedAt && params.capturedAt.trim()) {
      formData.append('captured_at', params.capturedAt.trim());
    }
    if (params.autoCreateSighting !== undefined) {
      formData.append('auto_create_sighting', String(params.autoCreateSighting));
    }
    if (params.idempotencyKey && params.idempotencyKey.trim()) {
      formData.append('idempotency_key', params.idempotencyKey.trim());
    }

    let dto: ApiAnimalDetectionDto;
    if (params.onProgress && typeof XMLHttpRequest !== 'undefined') {
      const url = `${baseUrl}/detections/upload`;
      dto = await new Promise<ApiAnimalDetectionDto>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        const token = getStoredAuthToken();
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }
        if (params.idempotencyKey && params.idempotencyKey.trim()) {
          xhr.setRequestHeader('Idempotency-Key', params.idempotencyKey.trim());
        }
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
            resolve(parsed as ApiAnimalDetectionDto);
          } else {
            if (xhr.status === 401) {
              emitAuthUnauthorized();
            }
            const msg = extractApiErrorMessage(
              xhr.status,
              parsed,
              xhr.statusText || 'Animal detection upload failed'
            );
            reject(new ApiBridgeError(msg, xhr.status));
          }
        };
        xhr.onerror = () => {
          reject(
            new ApiBridgeError(
              `Network error uploading animal image to ${url}.`,
              0
            )
          );
        };
        xhr.send(formData);
      });
    } else {
      const headers: Record<string, string> = {};
      if (params.idempotencyKey && params.idempotencyKey.trim()) {
        headers['Idempotency-Key'] = params.idempotencyKey.trim();
      }
      dto = await apiRequest<ApiAnimalDetectionDto>('/detections/upload', {
        method: 'POST',
        body: formData,
        headers,
      });
    }

    return mapAnimalDetectionFromApi(dto, this.getAnimalDetectionImageUrl(dto.id), baseUrl);
  },

  async getAnimalIdentities(params: {
    page?: number;
    pageSize?: number;
    species?: string;
    status?: string;
    verificationStatus?: string;
    search?: string;
  } = {}): Promise<{ items: AnimalIdentitySummary[]; total: number }> {
    const baseUrl = getConfiguredApiBaseUrl();
    const qs = new URLSearchParams();
    qs.set('page', String(params.page ?? 1));
    qs.set('page_size', String(params.pageSize ?? 50));
    if (params.species && params.species !== 'All') qs.set('species', params.species);
    if (params.status && params.status !== 'All') qs.set('status', params.status);
    if (params.verificationStatus && params.verificationStatus !== 'All') {
      qs.set('verification_status', params.verificationStatus);
    }
    if (params.search && params.search.trim()) qs.set('search', params.search.trim());
    const res = await apiRequest<PaginatedApiResponse<ApiAnimalIdentitySummaryDto>>(
      `/animal-intelligence/animals?${qs.toString()}`
    );
    return {
      items: res.items.map((dto) => mapAnimalIdentitySummaryFromApi(dto, baseUrl)),
      total: res.total,
    };
  },

  async getAnimalIdentityDetail(animalId: string): Promise<AnimalIdentityDetail> {
    const baseUrl = getConfiguredApiBaseUrl();
    const dto = await apiRequest<ApiAnimalIdentityDetailDto>(
      `/animal-intelligence/animals/${animalId}`
    );
    return mapAnimalIdentityDetailFromApi(dto, baseUrl);
  },

  async getAnimalIdentitySightings(animalId: string): Promise<AnimalSighting[]> {
    const res = await apiRequest<PaginatedApiResponse<ApiSightingDto>>(
      `/animal-intelligence/animals/${animalId}/sightings?page=1&page_size=50`
    );
    return res.items.map(mapSightingFromApi);
  },

  async getReidMatches(params: {
    page?: number;
    pageSize?: number;
    decision?: string;
    reviewStatus?: string;
    species?: string;
    needsReviewOnly?: boolean;
  } = {}): Promise<{ items: ReidMatchRecord[]; total: number }> {
    const baseUrl = getConfiguredApiBaseUrl();
    const qs = new URLSearchParams();
    qs.set('page', String(params.page ?? 1));
    qs.set('page_size', String(params.pageSize ?? 50));
    if (params.decision && params.decision !== 'All') qs.set('decision', params.decision);
    if (params.reviewStatus && params.reviewStatus !== 'All') {
      qs.set('review_status', params.reviewStatus);
    }
    if (params.species && params.species !== 'All') qs.set('species', params.species);
    if (params.needsReviewOnly) qs.set('needs_review_only', 'true');
    const res = await apiRequest<PaginatedApiResponse<ApiReidMatchDto>>(
      `/animal-intelligence/matches?${qs.toString()}`
    );
    return {
      items: res.items.map((dto) => mapReidMatchFromApi(dto, baseUrl)),
      total: res.total,
    };
  },

  async reviewReidMatch(
    matchId: string,
    payload: {
      action: 'confirm' | 'reject' | 'mark_needs_review' | 'reassign';
      reviewedBy?: string;
      reason?: string;
      targetAnimalIdentityId?: string;
      createNewIdentity?: boolean;
    }
  ): Promise<ReidMatchRecord> {
    const baseUrl = getConfiguredApiBaseUrl();
    const dto = await apiRequest<ApiReidMatchDto>(
      `/animal-intelligence/matches/${matchId}/review`,
      {
        method: 'POST',
        body: JSON.stringify({
          action: payload.action,
          reason: payload.reason?.trim() || null,
          target_animal_identity_id: payload.targetAnimalIdentityId || null,
          create_new_identity: Boolean(payload.createNewIdentity),
        }),
      }
    );
    return mapReidMatchFromApi(dto, baseUrl);
  },

  async getAlertRules(): Promise<AlertRuleRecord[]> {
    const res = await apiRequest<PaginatedApiResponse<ApiAlertRuleDto>>(
      '/animal-intelligence/alert-rules?page=1&page_size=100'
    );
    return res.items.map(mapAlertRuleFromApi);
  },

  async createAlertRule(input: AlertRuleCreateInput): Promise<AlertRuleRecord> {
    const dto = await apiRequest<ApiAlertRuleDto>('/animal-intelligence/alert-rules', {
      method: 'POST',
      body: JSON.stringify(mapAlertRuleToCreatePayload(input)),
    });
    return mapAlertRuleFromApi(dto);
  },

  async updateAlertRule(
    ruleId: string,
    updates: Partial<AlertRuleCreateInput>
  ): Promise<AlertRuleRecord> {
    const payload: Record<string, unknown> = {};
    if (updates.name !== undefined) payload.name = updates.name.trim();
    if (updates.speciesFilter !== undefined) payload.species_filter = updates.speciesFilter || null;
    if (updates.riskLevel !== undefined) payload.risk_level = updates.riskLevel;
    if (updates.villageId !== undefined) payload.village_id = updates.villageId || null;
    if (updates.zoneName !== undefined) payload.zone_name = updates.zoneName || null;
    if (updates.minRepeatCount !== undefined) payload.min_repeat_count = updates.minRepeatCount;
    if (updates.timeWindowMinutes !== undefined) payload.time_window_minutes = updates.timeWindowMinutes;
    if (updates.minSpeciesConfidence !== undefined) payload.min_species_confidence = updates.minSpeciesConfidence;
    if (updates.enabled !== undefined) payload.enabled = updates.enabled;
    if (updates.autoNotifyOfficer !== undefined) payload.auto_notify_officer = updates.autoNotifyOfficer;
    if (updates.autoDispatchIotBoundary !== undefined) {
      payload.auto_dispatch_iot_boundary = updates.autoDispatchIotBoundary;
    }
    if (updates.description !== undefined) payload.description = updates.description || null;
    const dto = await apiRequest<ApiAlertRuleDto>(`/animal-intelligence/alert-rules/${ruleId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return mapAlertRuleFromApi(dto);
  },

  async deleteAlertRule(ruleId: string): Promise<void> {
    await apiRequest<{ status: string; id: string }>(
      `/animal-intelligence/alert-rules/${ruleId}`,
      { method: 'DELETE' }
    );
  },

  async getForestOfficers(): Promise<ForestOfficerRecord[]> {
    const res = await apiRequest<PaginatedApiResponse<ApiForestOfficerDto>>(
      '/animal-intelligence/officers?page=1&page_size=100'
    );
    return res.items.map(mapForestOfficerFromApi);
  },

  async getAlertDeliveries(alertId?: string): Promise<AlertDeliveryAttemptRecord[]> {
    const qs = alertId ? `?alert_id=${encodeURIComponent(alertId)}&page=1&page_size=100` : '?page=1&page_size=100';
    const res = await apiRequest<PaginatedApiResponse<ApiAlertDeliveryAttemptDto>>(
      `/animal-intelligence/deliveries${qs}`
    );
    return res.items.map(mapAlertDeliveryAttemptFromApi);
  },

  async getIotEvents(): Promise<IotEventRecord[]> {
    const res = await apiRequest<PaginatedApiResponse<ApiIotEventDto>>(
      '/iot/events?page=1&page_size=100'
    );
    return res.items.map(mapIotEventFromApi);
  },

  async dispatchDevTestIotEvent(input: {
    cameraId?: string;
    deviceCode: string;
    species: string;
    animalIdentityId?: string;
    confidence: number;
    riskLevel: string;
  }): Promise<IotEventRecord> {
    const dto = await apiRequest<ApiIotEventDto>('/iot/events/dev-test', {
      method: 'POST',
      body: JSON.stringify({
        camera_id: input.cameraId || null,
        device_code: input.deviceCode.trim(),
        species: input.species.trim(),
        animal_identity_id: input.animalIdentityId || null,
        confidence: input.confidence,
        risk_level: input.riskLevel,
      }),
    });
    return mapIotEventFromApi(dto);
  },

  async acknowledgeIotEvent(
    eventId: string,
    cameraKey: string,
    acknowledgedBy?: string,
    ackNote?: string
  ): Promise<IotEventRecord> {
    const dto = await apiRequest<ApiIotEventDto>(`/iot/events/${eventId}/acknowledge`, {
      method: 'POST',
      headers: {
        'X-Camera-Key': cameraKey.trim(),
      },
      body: JSON.stringify({
        acknowledged_by: acknowledgedBy?.trim() || null,
        ack_note: ackNote?.trim() || null,
      }),
    });
    return mapIotEventFromApi(dto);
  },

  async retryIotEvent(eventId: string): Promise<IotEventRecord> {
    const dto = await apiRequest<ApiIotEventDto>(`/iot/events/${eventId}/retry`, {
      method: 'POST',
    });
    return mapIotEventFromApi(dto);
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
