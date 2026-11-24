import React, { useEffect, useRef, useState } from 'react';
import {
  apiBridge,
  DatabaseHealthSummary,
  SystemSettings,
} from '../services/apiBridge';
import { isValidHttpApiUrl, normalizeApiBaseUrl } from '../utils/apiConfig';
import { AuthenticatedUserProfile, canManageAdmin } from '../utils/authStorage';
import {
  Server,
  Volume2,
  ShieldCheck,
  RotateCcw,
  Check,
  Save,
  AlertCircle,
} from 'lucide-react';

interface SettingsViewProps {
  currentUser?: AuthenticatedUserProfile | null;
  settings: SystemSettings;
  onUpdateSettings: (settings: Partial<SystemSettings>) => Promise<void>;
  onResetData: () => Promise<void>;
  apiError?: string | null;
  isSyncingApi?: boolean;
  onRetrySync?: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  currentUser = null,
  settings,
  onUpdateSettings,
  onResetData,
  apiError = null,
  isSyncingApi = false,
  onRetrySync,
}) => {
  const [formData, setFormData] = useState<SystemSettings>(settings);
  const [activeEndpoint, setActiveEndpoint] = useState<string>(() => apiBridge.getApiBaseUrl());
  const prevSyncedUrlRef = useRef<string>(settings.fastApiBaseUrl);
  const [statusMessage, setStatusMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingApi, setIsTestingApi] = useState(false);
  const [apiTestResult, setApiTestResult] = useState<{
    ok: boolean;
    testedUrl: string;
    message: string;
    db?: DatabaseHealthSummary;
  } | null>(null);

  useEffect(() => {
    setActiveEndpoint(apiBridge.getApiBaseUrl());
    // Sync form only when the persisted backend URL or non-status preferences change externally,
    // so typing a custom URL is never overwritten by async connection status updates.
    setFormData((prev) => ({
      ...settings,
      fastApiBaseUrl:
        settings.fastApiBaseUrl !== prevSyncedUrlRef.current
          ? settings.fastApiBaseUrl
          : prev.fastApiBaseUrl,
    }));
    prevSyncedUrlRef.current = settings.fastApiBaseUrl;
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setStatusMessage(null);

    const normalizedUrl = normalizeApiBaseUrl(formData.fastApiBaseUrl, '');
    if (!normalizedUrl || !isValidHttpApiUrl(normalizedUrl)) {
      setStatusMessage({
        ok: false,
        text: `Invalid backend URL "${formData.fastApiBaseUrl}". Enter a full http:// or https:// URL (e.g. https://your-tunnel.trycloudflare.com/api/v1).`,
      });
      setIsSaving(false);
      return;
    }

    try {
      const nextPayload = { ...formData, fastApiBaseUrl: normalizedUrl };
      await onUpdateSettings(nextPayload);
      const persistedUrl = apiBridge.getApiBaseUrl();
      prevSyncedUrlRef.current = persistedUrl;
      setFormData((prev) => ({ ...prev, fastApiBaseUrl: persistedUrl }));
      setActiveEndpoint(persistedUrl);
      setStatusMessage({
        ok: true,
        text: `Configuration saved. Active FastAPI endpoint is now ${persistedUrl}.`,
      });
      setTimeout(() => setStatusMessage(null), 5000);
    } catch (err) {
      setStatusMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Unable to save configuration.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestApiBridge = async () => {
    setIsTestingApi(true);
    setApiTestResult(null);
    const testedUrl = normalizeApiBaseUrl(formData.fastApiBaseUrl, '');

    if (!testedUrl || !isValidHttpApiUrl(testedUrl)) {
      setApiTestResult({
        ok: false,
        testedUrl: formData.fastApiBaseUrl.trim() || '(empty)',
        message: `Invalid backend URL "${formData.fastApiBaseUrl}". Enter a full http:// or https:// URL ending in /api/v1.`,
      });
      setIsTestingApi(false);
      return;
    }

    try {
      const health = await apiBridge.checkHealth(testedUrl);
      if (!canManageAdmin(currentUser)) {
        setApiTestResult({
          ok: true,
          testedUrl,
          message: `Connected to ${health.service} v${health.version} (Admin role required for DB table diagnostics)`,
        });
        return;
      }
      const dbHealth = await apiBridge.checkDatabaseHealth(testedUrl);
      setApiTestResult({
        ok: true,
        testedUrl,
        message: `Connected to ${health.service} v${health.version} (${dbHealth.dialect}${
          dbHealth.postgis_enabled ? ` • PostGIS ${dbHealth.postgis_version}` : ''
        })`,
        db: dbHealth,
      });
    } catch (err) {
      setApiTestResult({
        ok: false,
        testedUrl,
        message:
          err instanceof Error
            ? err.message
            : `Unable to reach FastAPI backend at ${testedUrl}.`,
      });
    } finally {
      setIsTestingApi(false);
    }
  };

  const handleReset = async () => {
    await onResetData();
    const restoredUrl = apiBridge.getApiBaseUrl();
    prevSyncedUrlRef.current = restoredUrl;
    setActiveEndpoint(restoredUrl);
    setApiTestResult(null);
    setStatusMessage({
      ok: true,
      text: `Preferences reset to default endpoint (${restoredUrl}) and backend datasets refreshed.`,
    });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const isBackendConnected = !apiError && !isSyncingApi;
  const normalizedDraft = normalizeApiBaseUrl(formData.fastApiBaseUrl, '');
  const hasUnsavedEndpointChange = Boolean(normalizedDraft && normalizedDraft !== activeEndpoint);

  return (
    <div className="space-y-6">
      {statusMessage && (
        <div
          role="status"
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold animate-in fade-in border ${
            statusMessage.ok
              ? 'bg-emerald-950 border-emerald-700/60 text-emerald-200'
              : 'bg-red-950 border-red-700/60 text-red-200'
          }`}
        >
          {statusMessage.ok ? (
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          )}
          <span className="break-all">{statusMessage.text}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Section 1: Department Identification */}
        <div className="bg-slate-900/80 rounded-2xl border border-slate-800 p-6 space-y-4 shadow-xl">
          <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="font-bold text-sm text-white">Forest Department Division Identity</h3>
              <p className="text-xs text-slate-400">
                Official division titles and jurisdiction branding
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-bold text-slate-300 mb-1">Division Name</label>
              <input
                type="text"
                value={formData.divisionName}
                onChange={(e) => setFormData({ ...formData, divisionName: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">
                State Ministry / Department
              </label>
              <input
                type="text"
                value={formData.stateDepartment}
                onChange={(e) => setFormData({ ...formData, stateDepartment: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Python FastAPI & PostGIS Backend Connection */}
        <div className="bg-slate-900/80 rounded-2xl border border-slate-800 p-6 space-y-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <Server className="w-5 h-5 text-sky-400" />
              <div>
                <h3 className="font-bold text-sm text-white">
                  Python FastAPI & PostGIS Backend Connection
                </h3>
                <p className="text-xs text-slate-400">
                  Live REST API health & PostgreSQL/PostGIS spatial database diagnostics
                </p>
              </div>
            </div>

            <span
              className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                isSyncingApi
                  ? 'bg-amber-950 text-amber-300 border-amber-800/60'
                  : isBackendConnected
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-800/60'
                  : 'bg-red-950 text-red-300 border-red-800/60'
              }`}
            >
              {isSyncingApi
                ? 'SYNCING...'
                : isBackendConnected
                ? 'API v1 CONNECTED'
                : 'API v1 UNREACHABLE'}
            </span>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <label
                htmlFor="wicps-fastapi-url-input"
                className="block font-bold text-slate-300 mb-1"
              >
                Configured Backend Endpoint URL (Saved Override or VITE_API_BASE_URL)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="wicps-fastapi-url-input"
                  type="text"
                  value={formData.fastApiBaseUrl}
                  onChange={(e) => setFormData({ ...formData, fastApiBaseUrl: e.target.value })}
                  placeholder="http://localhost:8000/api/v1"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 font-mono text-slate-200 focus:ring-1 focus:ring-sky-500 focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={handleTestApiBridge}
                  disabled={isTestingApi}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl font-bold text-xs shrink-0 transition"
                >
                  {isTestingApi ? 'Checking...' : 'Test Live Connection'}
                </button>
                {onRetrySync && (
                  <button
                    type="button"
                    onClick={onRetrySync}
                    disabled={isSyncingApi}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-xl font-bold text-xs shrink-0 transition"
                  >
                    {isSyncingApi ? 'Syncing...' : 'Retry Sync'}
                  </button>
                )}
              </div>

              <div className="mt-2 space-y-1">
                <div className="text-[11px] text-slate-300 flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-slate-400">Active endpoint:</span>
                  <code className="font-mono text-sky-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 break-all">
                    {activeEndpoint}
                  </code>
                </div>
                {hasUnsavedEndpointChange && (
                  <div className="text-[11px] text-amber-300 font-semibold">
                    Unsaved URL in input ({normalizedDraft}). Click Save Configuration to persist and switch all API traffic to this endpoint.
                  </div>
                )}
                <span className="text-[11px] text-slate-400 block leading-relaxed">
                  Local Docker development uses <code className="font-mono text-slate-300">http://localhost:8000/api/v1</code> when no custom URL is saved.
                  From an HTTPS cloud preview, enter a publicly reachable <code className="font-mono text-slate-300">https://</code> backend URL (e.g. Cloudflare Tunnel / ngrok) and click{' '}
                  <strong className="text-slate-200">Save Configuration</strong>.
                </span>
              </div>
            </div>

            {apiTestResult && (
              <div
                role="status"
                className={`p-3 rounded-xl text-xs font-mono space-y-1.5 border ${
                  apiTestResult.ok
                    ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-200'
                    : 'bg-red-950/60 border-red-800/80 text-red-200'
                }`}
              >
                <div className="text-[11px] opacity-85 break-all">
                  Tested endpoint: {apiTestResult.testedUrl}
                </div>
                <div className="flex items-start gap-2 font-bold">
                  {apiTestResult.ok ? (
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  )}
                  <span className="break-words">{apiTestResult.message}</span>
                </div>
                {apiTestResult.db && (
                  <div className="text-[11px] text-emerald-300/90 pl-6">
                    Tables — Incidents: {apiTestResult.db.counts.incidents ?? 0}, Sightings:{' '}
                    {apiTestResult.db.counts.sightings ?? 0}, Alerts:{' '}
                    {apiTestResult.db.counts.alerts ?? 0}, Patrols:{' '}
                    {apiTestResult.db.counts.patrols ?? 0}, Risk Zones:{' '}
                    {apiTestResult.db.counts.risk_zones ?? 0}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-slate-300 mb-1">
                  Spatial Projection (GIS)
                </label>
                <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl font-mono text-slate-300 font-medium">
                  EPSG:4326 (WGS 84 Lat/Lng) + PostGIS GIST
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">
                  Operational Persistence Layer
                </label>
                <div
                  className={`p-2.5 bg-slate-950 border border-slate-800 rounded-xl font-mono font-semibold flex items-center gap-2 ${
                    isSyncingApi
                      ? 'text-amber-300'
                      : isBackendConnected
                      ? 'text-emerald-300'
                      : 'text-red-300'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isSyncingApi
                        ? 'bg-amber-400 animate-pulse'
                        : isBackendConnected
                        ? 'bg-emerald-400'
                        : 'bg-red-400'
                    }`}
                  ></span>
                  {isSyncingApi
                    ? 'Verifying FastAPI + PostGIS...'
                    : isBackendConnected
                    ? 'FastAPI REST + PostgreSQL / PostGIS'
                    : 'FastAPI Backend Offline (Action Required)'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Operational Thresholds & Alerts */}
        <div className="bg-slate-900/80 rounded-2xl border border-slate-800 p-6 space-y-4 shadow-xl">
          <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
            <Volume2 className="w-5 h-5 text-amber-400" />
            <div>
              <h3 className="font-bold text-sm text-white">Alert Triggers & Operational Rules</h3>
              <p className="text-xs text-slate-400">
                Configurable alert thresholds (stored locally in prototype settings)
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-bold text-slate-300 mb-1">
                Minimum Risk Score for Critical Alert Threshold: {formData.minConflictThreshold}%
              </label>
              <input
                type="range"
                min="40"
                max="90"
                value={formData.minConflictThreshold}
                onChange={(e) =>
                  setFormData({ ...formData, minConflictThreshold: parseInt(e.target.value, 10) })
                }
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">
                Emergency Dispatch Radius: {formData.emergencyDispatchRadiusKm} km
              </label>
              <input
                type="range"
                min="1"
                max="15"
                step="0.5"
                value={formData.emergencyDispatchRadiusKm}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    emergencyDispatchRadiusKm: parseFloat(e.target.value),
                  })
                }
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Save and Reset Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-4 py-2 border border-red-800/80 bg-red-950/60 hover:bg-red-900/60 text-red-300 rounded-xl text-xs font-bold transition"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Reset Demo Prototype Data</span>
          </button>

          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-xl text-xs sm:text-sm font-bold shadow-lg shadow-emerald-600/20 transition active:scale-95 border border-emerald-400/40"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Saving & Syncing...' : 'Save Configuration'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
