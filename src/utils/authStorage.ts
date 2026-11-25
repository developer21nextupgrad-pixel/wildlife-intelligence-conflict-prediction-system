export type WicpsRole = 'operator' | 'reviewer' | 'admin';

export interface AuthenticatedUserProfile {
  id: string | null;
  subject: string;
  email: string | null;
  displayName: string;
  role: WicpsRole;
  roles: string[];
  effectiveRoles: string[];
  authMethod: string;
}

export interface AuthStatusSummary {
  authenticated: boolean;
  user: AuthenticatedUserProfile | null;
  authEnabled: boolean;
  passwordLoginEnabled: boolean;
  oidcEnabled: boolean;
  oidcIssuer: string | null;
  needsInitialSetup: boolean;
}

export interface UserAccountRecord {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: WicpsRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const TOKEN_STORAGE_KEY = 'wicps_auth_token_v1';
const USER_STORAGE_KEY = 'wicps_auth_user_v1';

const ROLE_LEVEL: Record<WicpsRole, number> = {
  operator: 1,
  reviewer: 2,
  admin: 3,
};

let inMemoryToken: string | null = null;
let inMemoryUser: AuthenticatedUserProfile | null = null;
const unauthorizedListeners = new Set<() => void>();

function getSessionStore(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function normalizeWicpsRole(raw: unknown): WicpsRole {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'admin' || s === 'reviewer' || s === 'operator') {
    return s;
  }
  return 'operator';
}

export function getStoredAuthToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  const store = getSessionStore();
  if (!store) return null;
  try {
    const val = store.getItem(TOKEN_STORAGE_KEY);
    inMemoryToken = val && val.trim() ? val.trim() : null;
    return inMemoryToken;
  } catch {
    return null;
  }
}

export function getStoredAuthUser(): AuthenticatedUserProfile | null {
  if (inMemoryUser) return inMemoryUser;
  const store = getSessionStore();
  if (!store) return null;
  try {
    const raw = store.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthenticatedUserProfile;
    if (!parsed || typeof parsed.displayName !== 'string') return null;
    inMemoryUser = {
      ...parsed,
      role: normalizeWicpsRole(parsed.role),
    };
    return inMemoryUser;
  } catch {
    return null;
  }
}

export function setStoredAuthSession(
  token: string,
  user: AuthenticatedUserProfile | null
): void {
  const cleanToken = token.trim();
  inMemoryToken = cleanToken || null;
  inMemoryUser = user;
  const store = getSessionStore();
  if (!store) return;
  try {
    if (cleanToken) {
      store.setItem(TOKEN_STORAGE_KEY, cleanToken);
    } else {
      store.removeItem(TOKEN_STORAGE_KEY);
    }
    if (user) {
      store.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } else {
      store.removeItem(USER_STORAGE_KEY);
    }
  } catch {
    // Ignore restricted storage contexts
  }
}

export function clearStoredAuthSession(): void {
  inMemoryToken = null;
  inMemoryUser = null;
  const store = getSessionStore();
  if (!store) return;
  try {
    store.removeItem(TOKEN_STORAGE_KEY);
    store.removeItem(USER_STORAGE_KEY);
  } catch {
    // Ignore restricted storage contexts
  }
}

export function onAuthUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export function emitAuthUnauthorized(): void {
  clearStoredAuthSession();
  for (const listener of unauthorizedListeners) {
    try {
      listener();
    } catch {
      // Ignore listener errors
    }
  }
}

export function hasMinimumRole(
  user: AuthenticatedUserProfile | null | undefined,
  requiredRole: WicpsRole
): boolean {
  if (!user) return false;
  const effective = new Set<string>(
    (user.effectiveRoles && user.effectiveRoles.length > 0
      ? user.effectiveRoles
      : [user.role]
    ).map((r) => String(r || '').trim().toLowerCase())
  );
  if (effective.has(requiredRole)) return true;
  const userLevel = ROLE_LEVEL[normalizeWicpsRole(user.role)] ?? 0;
  return userLevel >= (ROLE_LEVEL[requiredRole] ?? 99);
}

export function canReviewReid(user: AuthenticatedUserProfile | null | undefined): boolean {
  return hasMinimumRole(user, 'reviewer');
}

export function canManageAdmin(user: AuthenticatedUserProfile | null | undefined): boolean {
  return hasMinimumRole(user, 'admin');
}

export function getUserInitials(displayName?: string | null): string {
  const parts = String(displayName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'OP';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function isProtectedApiUrl(src: string | null | undefined): boolean {
  if (!src) return false;
  const trimmed = src.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return false;
  if (trimmed.startsWith('/api/v1/')) return true;
  try {
    const parsed = new URL(trimmed, 'http://localhost');
    return parsed.pathname.includes('/api/v1/');
  } catch {
    return trimmed.includes('/api/v1/');
  }
}
