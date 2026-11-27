import { useEffect, useMemo, useState } from 'react';
import {
  Incident,
  AnimalSighting,
  VillageRiskProfile,
  AlertNotification,
  RiskZone,
  TelemetryCollar,
  UserStaff,
  PatrolOperation,
} from './types';
import { apiBridge, SystemSettings } from './services/apiBridge';
import { AlertUpsertInput } from './utils/apiMappers';
import { filterWicpsDatasets } from './utils/wicpsFilters';
import {
  AuthenticatedUserProfile,
  AuthStatusSummary,
  canManageAdmin,
  clearStoredAuthSession,
  getStoredAuthToken,
  onAuthUnauthorized,
  setStoredAuthSession,
} from './utils/authStorage';
import { parseResetPasswordTokenFromUrl, ParsedResetRoute } from './utils/authValidation';
import { AuthLoginGate } from './components/AuthLoginGate';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { GisRiskMapView, GisFocusLocation } from './components/GisRiskMapView';
import { IncidentManagementView } from './components/IncidentManagementView';
import { AnimalSightingsView } from './components/AnimalSightingsView';
import { AiRiskPredictionView } from './components/AiRiskPredictionView';
import { MovementMonitoringView } from './components/MovementMonitoringView';
import { AlertsView } from './components/AlertsView';
import { PatrolOperationsView } from './components/PatrolOperationsView';
import { AnalyticsView } from './components/AnalyticsView';
import { UserManagementView } from './components/UserManagementView';
import { SettingsView } from './components/SettingsView';
import { ThermalIngestionView } from './components/ThermalIngestionView';
import { AnimalDetectionView } from './components/AnimalDetectionView';
import { WildlifeAiAssistant } from './components/WildlifeAiAssistant';
import { AssistantMapLocation } from './utils/assistantHelpers';
import { Menu, X, TreePine, Users, Server, AlertTriangle, RefreshCw } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('command-centre');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isRecordIncidentModalOpen, setIsRecordIncidentModalOpen] = useState<boolean>(false);

  // Global Context Filters & Search
  const [selectedDistrict, setSelectedDistrict] = useState<string>('Bandipur Division');
  const [dateRange, setDateRange] = useState<string>('Last 30 Days');
  const [globalSearchQuery, setGlobalSearchQuery] = useState<string>('');

  // Administration Sub-tab (Personnel vs System Bridge)
  const [adminSubTab, setAdminSubTab] = useState<'personnel' | 'bridge'>('personnel');
  const [mapFocusLocation, setMapFocusLocation] = useState<GisFocusLocation | null>(null);

  // Authentication & RBAC Session State
  const [currentUser, setCurrentUser] = useState<AuthenticatedUserProfile | null>(null);
  const [initialAuthStatus, setInitialAuthStatus] = useState<AuthStatusSummary | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState<boolean>(true);
  const [resetRoute, setResetRoute] = useState<ParsedResetRoute>(() =>
    typeof window !== 'undefined'
      ? parseResetPasswordTokenFromUrl(window.location.pathname, window.location.search)
      : { isResetRoute: false, token: null }
  );

  useEffect(() => {
    const syncResetRoute = () => {
      setResetRoute(
        parseResetPasswordTokenFromUrl(window.location.pathname, window.location.search)
      );
    };
    window.addEventListener('popstate', syncResetRoute);
    return () => window.removeEventListener('popstate', syncResetRoute);
  }, []);

  const clearResetPasswordRoute = () => {
    setResetRoute({ isResetRoute: false, token: null });
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.replaceState({}, '', '/');
    } else if (typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState({}, '', '/');
    }
  };

  // Core Data States
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [sightings, setSightings] = useState<AnimalSighting[]>([]);
  const [villages, setVillages] = useState<VillageRiskProfile[]>([]);
  const [alerts, setAlerts] = useState<AlertNotification[]>([]);
  const [riskZones, setRiskZones] = useState<RiskZone[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryCollar[]>([]);
  const [staff, setStaff] = useState<UserStaff[]>([]);
  const [patrols, setPatrols] = useState<PatrolOperation[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncingApi, setIsSyncingApi] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Load Initial Datasets
  const refreshAllData = async () => {
    setIsSyncingApi(true);
    try {
      const [telData, stfData, cfgData] = await Promise.all([
        apiBridge.getTelemetry(),
        apiBridge.getStaff(),
        apiBridge.getSettings(),
      ]);
      setTelemetry(telData);
      setStaff(stfData);
      setSettings(cfgData);

      try {
        await apiBridge.checkHealth();
      } catch (healthErr) {
        const message =
          healthErr instanceof Error ? healthErr.message : 'Unable to reach FastAPI backend.';
        setVillages([]);
        setRiskZones([]);
        setApiError(message);
        setSettings((prev) =>
          prev ? { ...prev, postGisDbStatus: 'FastAPI Backend Offline' } : prev
        );
        return;
      }

      const apiResults = await Promise.allSettled([
        apiBridge.getIncidents(),
        apiBridge.getSightings(),
        apiBridge.getAlerts(),
        apiBridge.getPatrols(),
        apiBridge.getVillages(),
        apiBridge.getRiskZones(),
      ]);

      const failures: string[] = [];
      const [incRes, sightRes, altRes, patRes, vilRes, rzRes] = apiResults;

      if (incRes.status === 'fulfilled') setIncidents(incRes.value);
      else failures.push(`Incidents: ${incRes.reason instanceof Error ? incRes.reason.message : 'Request failed'}`);

      if (sightRes.status === 'fulfilled') setSightings(sightRes.value);
      else failures.push(`Sightings: ${sightRes.reason instanceof Error ? sightRes.reason.message : 'Request failed'}`);

      if (altRes.status === 'fulfilled') setAlerts(altRes.value);
      else failures.push(`Alerts: ${altRes.reason instanceof Error ? altRes.reason.message : 'Request failed'}`);

      if (patRes.status === 'fulfilled') setPatrols(patRes.value);
      else failures.push(`Patrols: ${patRes.reason instanceof Error ? patRes.reason.message : 'Request failed'}`);

      if (vilRes.status === 'fulfilled') setVillages(vilRes.value);
      else {
        setVillages([]);
        failures.push(`Villages: ${vilRes.reason instanceof Error ? vilRes.reason.message : 'Request failed'}`);
      }

      if (rzRes.status === 'fulfilled') setRiskZones(rzRes.value);
      else {
        setRiskZones([]);
        failures.push(`Risk Zones: ${rzRes.reason instanceof Error ? rzRes.reason.message : 'Request failed'}`);
      }

      if (failures.length > 0) {
        setApiError(failures[0]);
        setSettings((prev) =>
          prev ? { ...prev, postGisDbStatus: 'FastAPI Backend Offline' } : prev
        );
      } else {
        setApiError(null);
        setSettings((prev) =>
          prev ? { ...prev, postGisDbStatus: 'Connected (FastAPI + PostGIS)' } : prev
        );
      }
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to load WICPS datasets.');
    } finally {
      setIsLoading(false);
      setIsSyncingApi(false);
    }
  };

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthUnauthorized(() => {
      if (!active) return;
      setCurrentUser(null);
      setInitialAuthStatus(null);
      setApiError(null);
    });

    async function verifyExistingSession() {
      const token = getStoredAuthToken();
      try {
        const status = await apiBridge.getAuthStatus();
        if (!active) return;
        if (status.authenticated && status.user && token) {
          setStoredAuthSession(token, status.user);
          setCurrentUser(status.user);
          setInitialAuthStatus(status);
        } else {
          if (token) {
            clearStoredAuthSession();
          }
          setCurrentUser(null);
          setInitialAuthStatus({ ...status, authenticated: false, user: null });
          setIsLoading(false);
        }
      } catch {
        if (token) {
          clearStoredAuthSession();
        }
        if (active) {
          setCurrentUser(null);
          setInitialAuthStatus(null);
          setIsLoading(false);
        }
      } finally {
        if (active) {
          setIsCheckingSession(false);
        }
      }
    }

    verifyExistingSession();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (currentUser) {
      refreshAllData();
    }
  }, [currentUser]);

  // Apply Global Division and Date Filters consistently across datasets
  const filteredData = useMemo(
    () =>
      filterWicpsDatasets(
        {
          incidents,
          sightings,
          villages,
          alerts,
          riskZones,
          telemetry,
          patrols,
        },
        selectedDistrict,
        dateRange
      ),
    [incidents, sightings, villages, alerts, riskZones, telemetry, patrols, selectedDistrict, dateRange]
  );

  const handleResetGlobalFilters = () => {
    setSelectedDistrict('Bandipur Division');
    setDateRange('Last 30 Days');
  };

  // Handlers for API-backed Data Mutations
  const handleAddIncident = async (newIncidentData: Omit<Incident, 'id' | 'incidentCode'>) => {
    const created = await apiBridge.createIncident(newIncidentData);
    setIncidents((prev) => [created, ...prev]);
    setApiError(null);
  };

  const handleUpdateIncident = async (
    id: string,
    updatedIncidentData: Partial<Omit<Incident, 'id' | 'incidentCode'>>
  ) => {
    const updated = await apiBridge.updateIncident(id, updatedIncidentData);
    setIncidents((prev) => prev.map((item) => (item.id === id ? updated : item)));
    setApiError(null);
  };

  const handleUpdateIncidentStatus = async (id: string, status: Incident['status'], officer?: string) => {
    const updated = await apiBridge.updateIncidentStatus(id, status, officer);
    setIncidents((prev) => prev.map((item) => (item.id === id ? updated : item)));
    setApiError(null);
  };

  const handleDeleteIncident = async (id: string) => {
    await apiBridge.deleteIncident(id);
    setIncidents((prev) => prev.filter((item) => item.id !== id));
    setApiError(null);
  };

  const handleAddSighting = async (newSightingData: Omit<AnimalSighting, 'id' | 'sightingCode'>) => {
    await apiBridge.createSighting(newSightingData);
    const refreshed = await apiBridge.getSightings();
    setSightings(refreshed);
    setApiError(null);
  };

  const handleUpdateSighting = async (
    id: string,
    updatedSightingData: Partial<Omit<AnimalSighting, 'id' | 'sightingCode'>>
  ) => {
    await apiBridge.updateSighting(id, updatedSightingData);
    const refreshed = await apiBridge.getSightings();
    setSightings(refreshed);
    setApiError(null);
  };

  const handleDeleteSighting = async (id: string) => {
    await apiBridge.deleteSighting(id);
    const refreshed = await apiBridge.getSightings();
    setSightings(refreshed);
    setApiError(null);
  };

  const handleCreateAlert = async (data: AlertUpsertInput) => {
    await apiBridge.createAlert(data);
    const refreshed = await apiBridge.getAlerts();
    setAlerts(refreshed);
    setApiError(null);
  };

  const handleUpdateAlert = async (id: string, data: Partial<AlertUpsertInput>) => {
    await apiBridge.updateAlert(id, data);
    const refreshed = await apiBridge.getAlerts();
    setAlerts(refreshed);
    setApiError(null);
  };

  const handleDeleteAlert = async (id: string) => {
    await apiBridge.deleteAlert(id);
    const refreshed = await apiBridge.getAlerts();
    setAlerts(refreshed);
    setApiError(null);
  };

  const handleAcknowledgeAlert = async (id: string, officerName: string) => {
    await apiBridge.acknowledgeAlert(id, officerName);
    const refreshed = await apiBridge.getAlerts();
    setAlerts(refreshed);
    setApiError(null);
  };

  const handleUpdateAlertResponse = async (
    id: string,
    responseStatus: AlertNotification['responseStatus'],
    assignedOfficer?: string
  ) => {
    await apiBridge.updateAlertResponse(id, responseStatus, assignedOfficer);
    const refreshed = await apiBridge.getAlerts();
    setAlerts(refreshed);
    setApiError(null);
  };

  const handleUpdatePatrol = async (
    id: string,
    updatedPatrolData: Partial<Omit<PatrolOperation, 'id' | 'patrolCode'>>
  ) => {
    const updated = await apiBridge.updatePatrol(id, updatedPatrolData);
    setPatrols((prev) => prev.map((p) => (p.id === id ? updated : p)));
    setApiError(null);
  };

  const handleUpdatePatrolStatus = async (id: string, status: PatrolOperation['status']) => {
    const updated = await apiBridge.updatePatrolStatus(id, status);
    setPatrols((prev) => prev.map((p) => (p.id === id ? updated : p)));
    setApiError(null);
  };

  const handleCreatePatrol = async (newPatrolData: Omit<PatrolOperation, 'id' | 'patrolCode'>) => {
    const created = await apiBridge.createPatrol(newPatrolData);
    setPatrols((prev) => [created, ...prev]);
    setApiError(null);
  };

  const handleDeletePatrol = async (id: string) => {
    await apiBridge.deletePatrol(id);
    setPatrols((prev) => prev.filter((p) => p.id !== id));
    setApiError(null);
  };

  const handleUpdateSettings = async (newSettings: Partial<SystemSettings>) => {
    const previousUrl = settings?.fastApiBaseUrl;
    const updated = await apiBridge.updateSettings(newSettings);
    setSettings(updated);
    if (
      (newSettings.fastApiBaseUrl !== undefined && updated.fastApiBaseUrl !== previousUrl) ||
      apiError
    ) {
      await refreshAllData();
    }
  };

  const handleResetData = async () => {
    await apiBridge.resetLocalSettings();
    await refreshAllData();
  };

  const handleLogout = () => {
    apiBridge.logout();
    setCurrentUser(null);
    setInitialAuthStatus(null);
    setIncidents([]);
    setSightings([]);
    setVillages([]);
    setAlerts([]);
    setRiskZones([]);
    setApiError(null);
  };

  if (resetRoute.isResetRoute) {
    return (
      <AuthLoginGate
        initialAuthStatus={initialAuthStatus}
        initialResetRoute
        initialResetToken={resetRoute.token}
        onExitResetFlow={clearResetPasswordRoute}
        onAuthenticated={(user) => {
          clearResetPasswordRoute();
          setIsLoading(true);
          setCurrentUser(user);
        }}
      />
    );
  }

  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-emerald-600 flex items-center justify-center animate-bounce shadow-xl shadow-emerald-500/20 border border-emerald-400/40">
          <TreePine className="w-8 h-8 text-white" />
        </div>
        <div className="text-center">
          <div className="text-xs uppercase font-mono tracking-widest text-emerald-400 font-bold">
            FOREST DEPARTMENT • GOVT. OF UTTAR PRADESH • INDIA
          </div>
          <h2 className="text-base font-bold font-mono tracking-wider text-white mt-1">
            WICPS COMMAND PLATFORM
          </h2>
          <p className="text-xs text-slate-400 mt-1">Verifying authenticated session...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthLoginGate
        initialAuthStatus={initialAuthStatus}
        onAuthenticated={(user) => {
          setIsLoading(true);
          setCurrentUser(user);
        }}
      />
    );
  }

  if (isLoading || !settings) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-emerald-600 flex items-center justify-center animate-bounce shadow-xl shadow-emerald-500/20 border border-emerald-400/40">
          <TreePine className="w-8 h-8 text-white" />
        </div>
        <div className="text-center">
          <div className="text-xs uppercase font-mono tracking-widest text-emerald-400 font-bold">
            FOREST DEPARTMENT • GOVT. OF UTTAR PRADESH • INDIA
          </div>
          <h2 className="text-base font-bold font-mono tracking-wider text-white mt-1">
            WICPS COMMAND PLATFORM
          </h2>
          <p className="text-xs text-slate-400 mt-1">Initializing GIS layers and operational telemetry...</p>
        </div>
      </div>
    );
  }

  const unacknowledgedAlerts = filteredData.alerts.filter((a) => !a.acknowledged);

  // Normalize legacy tab IDs to the 10 requested items
  const resolvedTab = (() => {
    if (activeTab === 'dashboard') return 'command-centre';
    if (activeTab === 'gis-map') return 'wildlife-risk-map';
    if (activeTab === 'ai-prediction') return 'conflict-prediction';
    if (activeTab === 'movement') return 'animal-movement';
    if (activeTab === 'incidents') return 'incident-management';
    if (activeTab === 'sightings') return 'animal-sightings';
    if (activeTab === 'alerts') return 'alert-management';
    if (activeTab === 'patrols') return 'patrol-operations';
    if (activeTab === 'analytics') return 'analytics-reports';
    if (activeTab === 'detection' || activeTab === 'detections' || activeTab === 'species-id') {
      return 'animal-detection';
    }
    if (activeTab === 'thermal' || activeTab === 'ingestion') return 'thermal-ingestion';
    if (activeTab === 'settings' || activeTab === 'users') return 'administration';
    return activeTab;
  })();

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 font-sans text-slate-100 selection:bg-emerald-600 selection:text-white antialiased">
      {/* Top Header */}
      <Header
        currentUser={currentUser}
        onLogout={handleLogout}
        setActiveTab={setActiveTab}
        onNavigateAdmin={(subTab) => {
          setAdminSubTab(subTab);
          setActiveTab('administration');
        }}
        unacknowledgedAlerts={unacknowledgedAlerts}
        onOpenNewIncident={() => {
          setActiveTab('incident-management');
          setIsRecordIncidentModalOpen(true);
        }}
        selectedDistrict={selectedDistrict}
        setSelectedDistrict={setSelectedDistrict}
        dateRange={dateRange}
        setDateRange={setDateRange}
        globalSearchQuery={globalSearchQuery}
        onGlobalSearchChange={(q) => setGlobalSearchQuery(q)}
        onGlobalSearchSubmit={(q) => {
          setGlobalSearchQuery(q);
          setActiveTab('incident-management');
        }}
      />

      {/* Main Layout Container with Sidebar and Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Left Sidebar (Collapsible & Persistent) */}
        <div className="hidden lg:flex shrink-0">
          <Sidebar
            activeTab={resolvedTab}
            setActiveTab={setActiveTab}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
            connectionStatus={isSyncingApi ? 'syncing' : apiError ? 'offline' : 'connected'}
            counts={{
              incidents: filteredData.incidents.length,
              sightings: filteredData.sightings.length,
              alerts: unacknowledgedAlerts.length,
              collars: filteredData.telemetry.length,
              villages: filteredData.villages.length,
              patrols: filteredData.patrols.length,
            }}
          />
        </div>

        {/* Mobile Sidebar Drawer Toggle Bar */}
        <div className="lg:hidden fixed bottom-4 right-4 z-40">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full shadow-lg border border-emerald-400 flex items-center justify-center active:scale-95 transition"
            aria-label="Open Navigation Menu"
          >
            <Menu className="w-6 h-6" />
          </button>
        </div>

        {/* Mobile Navigation Drawer Modal */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div
              className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="relative w-72 bg-slate-950 z-10 flex flex-col h-full shadow-2xl animate-in slide-in-from-left">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between text-white">
                <span className="font-bold text-xs tracking-wider text-emerald-400 font-mono uppercase">
                  WICPS Command Menu
                </span>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <Sidebar
                  activeTab={resolvedTab}
                  setActiveTab={(tab) => {
                    setActiveTab(tab);
                    setMobileMenuOpen(false);
                  }}
                  connectionStatus={isSyncingApi ? 'syncing' : apiError ? 'offline' : 'connected'}
                  counts={{
                    incidents: filteredData.incidents.length,
                    sightings: filteredData.sightings.length,
                    alerts: unacknowledgedAlerts.length,
                    collars: filteredData.telemetry.length,
                    villages: filteredData.villages.length,
                    patrols: filteredData.patrols.length,
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Dynamic Main View Content Panel */}
        <main className="flex-1 overflow-y-auto bg-slate-950">
          {/* Global Backend API Connectivity Banner (when FastAPI backend is unreachable or syncing) */}
          {apiError && (
            <div
              role="alert"
              className="mx-4 sm:mx-6 lg:mx-8 mt-4 bg-red-950/70 border border-red-700/70 text-red-100 px-4 py-3 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs"
            >
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-bold text-red-200">
                    FastAPI + PostGIS Backend Connection Issue
                  </div>
                  <div className="text-[11px] font-mono text-red-300/90 mt-0.5 break-all">
                    Configured endpoint: {apiBridge.getApiBaseUrl()}
                  </div>
                  <div className="text-red-200/90 mt-1 leading-relaxed">{apiError}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setAdminSubTab('bridge');
                    setActiveTab('administration');
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900/90 hover:bg-slate-800 text-red-100 border border-red-700/60 font-semibold rounded-lg transition"
                >
                  <Server className="w-3.5 h-3.5" />
                  <span>Configure Backend URL</span>
                </button>
                <button
                  type="button"
                  onClick={refreshAllData}
                  disabled={isSyncingApi}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-800 hover:bg-red-700 text-white font-semibold rounded-lg transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingApi ? 'animate-spin' : ''}`} />
                  <span>{isSyncingApi ? 'Retrying...' : 'Retry Backend Sync'}</span>
                </button>
              </div>
            </div>
          )}

          {/* 1. Command Centre (Main Dashboard) */}
          {resolvedTab === 'command-centre' && (
            <DashboardView
              incidents={filteredData.incidents}
              sightings={filteredData.sightings}
              villages={filteredData.villages}
              alerts={filteredData.alerts}
              riskZones={filteredData.riskZones}
              telemetry={filteredData.telemetry}
              patrols={filteredData.patrols}
              onNavigate={(tab) => setActiveTab(tab)}
              onOpenNewIncident={() => {
                setActiveTab('incident-management');
                setIsRecordIncidentModalOpen(true);
              }}
              selectedDistrict={selectedDistrict}
              setSelectedDistrict={setSelectedDistrict}
              dateRange={dateRange}
              setDateRange={setDateRange}
              onResetFilters={handleResetGlobalFilters}
              isApiLoading={isSyncingApi}
              apiError={apiError}
              onRetrySync={refreshAllData}
            />
          )}

          {/* 2. Wildlife Risk Map */}
          {resolvedTab === 'wildlife-risk-map' && (
            <GisRiskMapView
              incidents={filteredData.incidents}
              sightings={filteredData.sightings}
              villages={filteredData.villages}
              riskZones={filteredData.riskZones}
              telemetry={filteredData.telemetry}
              globalDistrict={selectedDistrict}
              globalDateRange={dateRange}
              onResetGlobalFilters={handleResetGlobalFilters}
              onSelectIncident={() => {
                setActiveTab('incident-management');
              }}
              isApiLoading={isSyncingApi}
              apiError={apiError}
              onRetrySync={refreshAllData}
              focusLocation={mapFocusLocation}
            />
          )}

          {/* 3. Conflict Prediction */}
          {resolvedTab === 'conflict-prediction' && <AiRiskPredictionView />}

          {/* 4. Animal Movement */}
          {resolvedTab === 'animal-movement' && (
            <MovementMonitoringView telemetry={filteredData.telemetry} />
          )}

          {/* 5. Incident Management */}
          {resolvedTab === 'incident-management' && (
            <IncidentManagementView
              incidents={filteredData.incidents}
              totalUnfilteredCount={incidents.length}
              selectedDistrict={selectedDistrict}
              dateRange={dateRange}
              onResetGlobalFilters={handleResetGlobalFilters}
              globalSearchQuery={globalSearchQuery}
              onGlobalSearchChange={setGlobalSearchQuery}
              onAddIncident={handleAddIncident}
              onUpdateIncident={handleUpdateIncident}
              onUpdateStatus={handleUpdateIncidentStatus}
              onDeleteIncident={canManageAdmin(currentUser) ? handleDeleteIncident : undefined}
              isApiLoading={isSyncingApi}
              apiError={apiError}
              onRetrySync={refreshAllData}
              isModalOpen={isRecordIncidentModalOpen}
              setIsModalOpen={setIsRecordIncidentModalOpen}
            />
          )}

          {/* 6. Animal Sightings */}
          {resolvedTab === 'animal-sightings' && (
            <AnimalSightingsView
              sightings={filteredData.sightings}
              totalUnfilteredCount={sightings.length}
              selectedDistrict={selectedDistrict}
              dateRange={dateRange}
              onResetGlobalFilters={handleResetGlobalFilters}
              onAddSighting={handleAddSighting}
              onUpdateSighting={handleUpdateSighting}
              onDeleteSighting={canManageAdmin(currentUser) ? handleDeleteSighting : undefined}
              isApiLoading={isSyncingApi}
              apiError={apiError}
              onRetrySync={refreshAllData}
            />
          )}

          {/* 7. Alert Management */}
          {resolvedTab === 'alert-management' && (
            <AlertsView
              alerts={filteredData.alerts}
              onCreateAlert={handleCreateAlert}
              onUpdateAlert={handleUpdateAlert}
              onDeleteAlert={canManageAdmin(currentUser) ? handleDeleteAlert : undefined}
              onAcknowledge={handleAcknowledgeAlert}
              onUpdateResponseStatus={handleUpdateAlertResponse}
              isApiLoading={isSyncingApi}
              apiError={apiError}
              onRetrySync={refreshAllData}
            />
          )}

          {/* 8. Patrol Operations */}
          {resolvedTab === 'patrol-operations' && (
            <PatrolOperationsView
              patrols={filteredData.patrols}
              onUpdateStatus={handleUpdatePatrolStatus}
              onCreatePatrol={handleCreatePatrol}
              onUpdatePatrol={handleUpdatePatrol}
              onDeletePatrol={canManageAdmin(currentUser) ? handleDeletePatrol : undefined}
              onNavigateToMap={() => setActiveTab('wildlife-risk-map')}
              isApiLoading={isSyncingApi}
              apiError={apiError}
              onRetrySync={refreshAllData}
            />
          )}

          {/* 9. Analytics & Reports */}
          {resolvedTab === 'analytics-reports' && (
            <AnalyticsView
              incidents={filteredData.incidents}
              villages={filteredData.villages}
              selectedDistrict={selectedDistrict}
              dateRange={dateRange}
              onResetGlobalFilters={handleResetGlobalFilters}
              isApiLoading={isSyncingApi}
              apiError={apiError}
              onRetrySync={refreshAllData}
            />
          )}

          {/* 9.4. Animal Detection, Individual Re-Identification & Intelligence Integration (Phase 1-3) */}
          {resolvedTab === 'animal-detection' && (
            <AnimalDetectionView
              currentUser={currentUser}
              villages={villages}
              onDataIntegrated={refreshAllData}
            />
          )}

          {/* 9.5. Thermal Ingestion (Stage 1 Boundary & CV Preprocessing) */}
          {resolvedTab === 'thermal-ingestion' && (
            <ThermalIngestionView currentUser={currentUser} villages={villages} />
          )}

          {/* 10. Administration (Personnel & FastAPI/PostGIS System Bridge) */}
          {resolvedTab === 'administration' && (
            <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
              {/* Administration Header & Sub-Navigation */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 font-bold uppercase tracking-wider">
                    <span>Forest Department Command</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    <span>System Administration</span>
                  </div>
                  <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight mt-1">
                    Administration & System Architecture
                  </h1>
                  <p className="text-xs text-slate-400 mt-1">
                    Manage frontline beat officers, RRT squads, FastAPI intelligence bridge and PostGIS geospatial pipelines.
                  </p>
                </div>

                {/* Sub-tab pills */}
                <div className="flex items-center bg-slate-900 border border-slate-800 p-1 rounded-xl self-start sm:self-auto">
                  <button
                    onClick={() => setAdminSubTab('personnel')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      adminSubTab === 'personnel'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Personnel & Staff ({staff.length})</span>
                  </button>
                  <button
                    onClick={() => setAdminSubTab('bridge')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      adminSubTab === 'bridge'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Server className="w-3.5 h-3.5" />
                    <span>FastAPI / PostGIS Bridge</span>
                  </button>
                </div>
              </div>

              {/* Sub-tab views */}
              {adminSubTab === 'personnel' ? (
                <UserManagementView currentUser={currentUser} staff={staff} />
              ) : (
                <SettingsView
                  currentUser={currentUser}
                  settings={settings}
                  onUpdateSettings={handleUpdateSettings}
                  onResetData={handleResetData}
                  apiError={apiError}
                  isSyncingApi={isSyncingApi}
                  onRetrySync={refreshAllData}
                />
              )}
            </div>
          )}
        </main>
      </div>

      {/* Floating AI Wildlife Intelligence Assistant (Visible across all authenticated pages) */}
      <WildlifeAiAssistant
        activeDistrict={selectedDistrict}
        activeDateRange={dateRange}
        onFocusMapLocation={(loc: AssistantMapLocation) => {
          setMapFocusLocation({
            id: loc.id,
            label: loc.label,
            kind: loc.kind,
            latitude: loc.latitude,
            longitude: loc.longitude,
            timestamp: Date.now(),
          });
          setActiveTab('wildlife-risk-map');
        }}
      />
    </div>
  );
}
