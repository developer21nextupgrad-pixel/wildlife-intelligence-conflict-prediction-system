export const DEFAULT_LOCAL_API_BASE_URL = 'http://localhost:8000/api/v1';
export const API_URL_STORAGE_KEY = 'wicps_api_base_url_v1';
export const SETTINGS_STORAGE_KEY = 'wicps_settings_v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function normalizeApiBaseUrl(
  rawUrl: string | null | undefined,
  fallback: string = DEFAULT_LOCAL_API_BASE_URL
): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return fallback ? fallback.replace(/\/+$/, '') : '';
  }

  const stripped = trimmed.replace(/\/+$/, '');
  try {
    const parsed = new URL(stripped);
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.pathname === '/') {
      return `${parsed.origin}/api/v1`;
    }
  } catch {
    // Return stripped invalid string so strict validators can report an actionable error
  }
  return stripped;
}

export function isValidHttpApiUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      Boolean(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export function isLocalhostUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1' ||
      parsed.hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

export function readSavedApiBaseUrl(storage: StorageLike | null = getDefaultStorage()): string | null {
  if (!storage) return null;

  try {
    const direct = storage.getItem(API_URL_STORAGE_KEY);
    if (direct && direct.trim()) {
      const normalized = normalizeApiBaseUrl(direct, '');
      if (isValidHttpApiUrl(normalized)) {
        return normalized;
      }
    }

    const rawSettings = storage.getItem(SETTINGS_STORAGE_KEY);
    if (rawSettings) {
      const parsed = JSON.parse(rawSettings) as { fastApiBaseUrl?: unknown };
      if (typeof parsed?.fastApiBaseUrl === 'string' && parsed.fastApiBaseUrl.trim()) {
        const normalized = normalizeApiBaseUrl(parsed.fastApiBaseUrl, '');
        if (isValidHttpApiUrl(normalized)) {
          return normalized;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function writeSavedApiBaseUrl(
  rawUrl: string,
  storage: StorageLike | null = getDefaultStorage()
): string {
  const normalized = normalizeApiBaseUrl(rawUrl, '');
  if (!normalized || !isValidHttpApiUrl(normalized)) {
    throw new Error(
      `Invalid backend URL "${rawUrl}". Use a full http:// or https:// URL ending in /api/v1.`
    );
  }

  if (storage) {
    storage.setItem(API_URL_STORAGE_KEY, normalized);
    try {
      const rawSettings = storage.getItem(SETTINGS_STORAGE_KEY);
      const parsed = rawSettings ? (JSON.parse(rawSettings) as Record<string, unknown>) : {};
      storage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({
          ...parsed,
          fastApiBaseUrl: normalized,
        })
      );
    } catch {
      // Direct API_URL_STORAGE_KEY is already persisted
    }
  }

  return normalized;
}

export function clearSavedApiBaseUrl(storage: StorageLike | null = getDefaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(API_URL_STORAGE_KEY);
  } catch {
    // Ignore storage removal errors
  }
}

export function resolveActiveApiBaseUrl(options?: {
  envUrl?: string | null;
  storage?: StorageLike | null;
}): string {
  const storage = options?.storage !== undefined ? options.storage : getDefaultStorage();
  const saved = readSavedApiBaseUrl(storage);
  if (saved) {
    return saved;
  }

  const envNormalized = normalizeApiBaseUrl(options?.envUrl, '');
  if (envNormalized && isValidHttpApiUrl(envNormalized)) {
    return envNormalized;
  }

  return DEFAULT_LOCAL_API_BASE_URL;
}

export interface ConnectionDiagnosticInput {
  baseUrl: string;
  reason: string;
  pageProtocol?: string;
  pageOrigin?: string;
}

export function formatApiUnreachableMessage({
  baseUrl,
  reason,
  pageProtocol,
  pageOrigin,
}: ConnectionDiagnosticInput): string {
  const cleanBase = normalizeApiBaseUrl(baseUrl, '');
  const isHttpsPage = pageProtocol === 'https:';
  const targetsLocalhost = isLocalhostUrl(cleanBase);

  if (isHttpsPage && targetsLocalhost) {
    const originLabel = pageOrigin || 'an HTTPS cloud preview';
    return (
      `Unable to reach WICPS FastAPI backend at ${cleanBase} (${reason}). ` +
      `This preview is served over HTTPS (${originLabel}), so the browser cannot reliably access your machine's local Docker http://localhost:8000 directly (Mixed Content / Private Network Access / iframe isolation). ` +
      `Run the frontend locally at http://localhost:3000 OR expose your backend via an HTTPS URL (e.g. Cloudflare Tunnel / ngrok) and save it in Administration → FastAPI / PostGIS Bridge.`
    );
  }

  if (isHttpsPage && cleanBase.startsWith('http://')) {
    return (
      `Unable to reach WICPS FastAPI backend at ${cleanBase} (${reason}). ` +
      `Because this page runs over HTTPS, browsers block insecure http:// API endpoints (Mixed Content). Use an https:// backend URL.`
    );
  }

  if (cleanBase.startsWith('https://')) {
    const originHint = pageOrigin ? ` (${pageOrigin})` : '';
    return (
      `Unable to reach WICPS FastAPI backend at ${cleanBase} (${reason}). ` +
      `Verify the HTTPS tunnel is running and your FastAPI CORS configuration allows this origin${originHint} along with OPTIONS preflight requests.`
    );
  }

  return `Unable to reach WICPS FastAPI backend at ${cleanBase} (${reason}). Ensure the FastAPI + PostGIS server is running and CORS allows this origin.`;
}
