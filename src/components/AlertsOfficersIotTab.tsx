import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertDeliveryAttemptRecord,
  AlertRuleRecord,
  ForestOfficerRecord,
  IncidentSeverity,
  IotEventRecord,
  ThermalCamera,
  VillageRiskProfile,
} from '../types';
import { apiBridge } from '../services/apiBridge';
import { validateAlertRuleInput } from '../utils/animalIntelligence';
import { AuthenticatedUserProfile, canManageAdmin } from '../utils/authStorage';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Loader2,
  Plus,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';

interface AlertsOfficersIotTabProps {
  currentUser: AuthenticatedUserProfile | null;
  villages: VillageRiskProfile[];
  cameras: ThermalCamera[];
}

export const AlertsOfficersIotTab: React.FC<AlertsOfficersIotTabProps> = ({
  currentUser,
  villages,
  cameras,
}) => {
  const isAdmin = canManageAdmin(currentUser);
  const [rules, setRules] = useState<AlertRuleRecord[]>([]);
  const [officers, setOfficers] = useState<ForestOfficerRecord[]>([]);
  const [deliveries, setDeliveries] = useState<AlertDeliveryAttemptRecord[]>([]);
  const [iotEvents, setIotEvents] = useState<IotEventRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Create Rule Form State
  const [ruleName, setRuleName] = useState<string>('');
  const [speciesFilter, setSpeciesFilter] = useState<string>('Asian Elephant');
  const [riskLevel, setRiskLevel] = useState<IncidentSeverity>('High');
  const [villageId, setVillageId] = useState<string>('');
  const [zoneName, setZoneName] = useState<string>('');
  const [minRepeatCount, setMinRepeatCount] = useState<number>(2);
  const [timeWindowMinutes, setTimeWindowMinutes] = useState<number>(120);
  const [minSpeciesConfidence, setMinSpeciesConfidence] = useState<number>(0.5);
  const [autoNotifyOfficer, setAutoNotifyOfficer] = useState<boolean>(true);
  const [autoDispatchIot, setAutoDispatchIot] = useState<boolean>(false);

  // Dev-Test IoT Form State
  const [iotDeviceCode, setIotDeviceCode] = useState<string>(cameras[0]?.cameraCode || 'CAM-DEV-BOUNDARY-01');
  const [iotCameraId, setIotCameraId] = useState<string>(cameras[0]?.id || '');
  const [iotSpecies, setIotSpecies] = useState<string>('Asian Elephant');
  const [iotConfidence, setIotConfidence] = useState<number>(0.92);
  const [iotRiskLevel, setIotRiskLevel] = useState<IncidentSeverity>('High');
  const [ackKeyInputs, setAckKeyInputs] = useState<Record<string, string>>({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, o, d, e] = await Promise.all([
        apiBridge.getAlertRules(),
        apiBridge.getForestOfficers(),
        apiBridge.getAlertDeliveries(),
        apiBridge.getIotEvents(),
      ]);
      setRules(r);
      setOfficers(o);
      setDeliveries(d);
      setIotEvents(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alert rules and IoT records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (cameras.length > 0 && !iotCameraId) {
      setIotCameraId(cameras[0].id);
      setIotDeviceCode(cameras[0].cameraCode);
    }
  }, [cameras, iotCameraId]);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const payload = {
      name: ruleName,
      speciesFilter: speciesFilter === 'ALL' ? undefined : speciesFilter,
      riskLevel,
      villageId: villageId || undefined,
      zoneName: zoneName.trim() || undefined,
      minRepeatCount: Number(minRepeatCount),
      timeWindowMinutes: Number(timeWindowMinutes),
      minSpeciesConfidence: Number(minSpeciesConfidence),
      enabled: true,
      autoNotifyOfficer,
      autoDispatchIotBoundary: autoDispatchIot,
    };
    const errMsg = validateAlertRuleInput(payload);
    if (errMsg) {
      setError(errMsg);
      return;
    }
    try {
      const created = await apiBridge.createAlertRule(payload);
      setRuleName('');
      setZoneName('');
      setNotice(`Created alert rule "${created.name}".`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create alert rule.');
    }
  };

  const handleToggleRule = async (rule: AlertRuleRecord) => {
    setError(null);
    try {
      await apiBridge.updateAlertRule(rule.id, { enabled: !rule.enabled });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle rule.');
    }
  };

  const handleDeleteRule = async (rule: AlertRuleRecord) => {
    setError(null);
    try {
      await apiBridge.deleteAlertRule(rule.id);
      setNotice(`Deleted alert rule "${rule.name}".`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete rule.');
    }
  };

  const handleDispatchDevIot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!iotDeviceCode.trim() || !iotSpecies.trim()) {
      setError('Device Code and Species are required to dispatch a Dev-Test IoT boundary event.');
      return;
    }
    const conf = Number(iotConfidence);
    if (!Number.isFinite(conf) || conf < 0 || conf > 1) {
      setError('IoT confidence must be a number between 0 and 1.');
      return;
    }
    try {
      const evt = await apiBridge.dispatchDevTestIotEvent({
        cameraId: iotCameraId || undefined,
        deviceCode: iotDeviceCode.trim(),
        species: iotSpecies.trim(),
        confidence: Number(iotConfidence),
        riskLevel: iotRiskLevel,
      });
      setNotice(
        `Dispatched Dev-Test IoT Boundary Event (${evt.deviceCode}, status: ${evt.deliveryStatus}) — no physical hardware actuated.`
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dispatch IoT boundary event.');
    }
  };

  const handleAckIotEvent = async (eventId: string) => {
    const key = ackKeyInputs[eventId] || '';
    if (!key.trim()) {
      setError('Enter the registered Camera API key (X-Camera-Key) to verify device acknowledgement.');
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const acked = await apiBridge.acknowledgeIotEvent(eventId, key, 'Boundary Device Edge Client');
      setNotice(`IoT event ${acked.id.slice(0, 8)} acknowledged cleanly via X-Camera-Key.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'IoT acknowledgement failed.');
    }
  };

  const handleRetryIotEvent = async (eventId: string) => {
    setError(null);
    try {
      await apiBridge.retryIotEvent(eventId);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue IoT retry.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-300">
          Configurable detection-to-alert thresholds, nearest GPS Forest Officer routing logs, and boundary IoT software contract telemetry.
        </div>
        <button
          type="button"
          onClick={loadAll}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-xl text-xs font-semibold text-slate-200 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Intelligence State</span>
        </button>
      </div>

      {error && (
        <div role="alert" className="bg-red-950/60 border border-red-800 rounded-xl p-3 text-xs text-red-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div role="status" className="bg-emerald-950/60 border border-emerald-800 rounded-xl p-3 text-xs text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {loading && rules.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
          <span>Loading alert rules, officer roster, and IoT events...</span>
        </div>
      ) : (
        <>
          {/* Section A: Alert Rules */}
          <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <BellRing className="w-4 h-4 text-amber-400" />
                <span>Configurable Alert Rules ({rules.length})</span>
              </h2>
            </div>

            <form
              onSubmit={handleCreateRule}
              className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Add Alert Rule</span>
                </div>
                {!isAdmin && (
                  <span className="text-[11px] font-mono text-amber-300">
                    Admin role required to create, toggle, or delete rules
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div>
                  <label htmlFor="rule-name-input" className="block text-[11px] font-mono text-slate-400 mb-1">
                    Rule Name
                  </label>
                  <input
                    id="rule-name-input"
                    type="text"
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    placeholder="e.g., Mangala Crop Raider Watch"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="rule-species-select" className="block text-[11px] font-mono text-slate-400 mb-1">
                    Species Filter
                  </label>
                  <select
                    id="rule-species-select"
                    value={speciesFilter}
                    onChange={(e) => setSpeciesFilter(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                  >
                    <option value="ALL">All Wildlife Species</option>
                    <option value="Asian Elephant">Asian Elephant</option>
                    <option value="Bengal Tiger">Bengal Tiger</option>
                    <option value="Indian Leopard">Indian Leopard</option>
                    <option value="Sloth Bear">Sloth Bear</option>
                    <option value="Wild Boar">Wild Boar</option>
                    <option value="Gaur">Gaur</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="rule-risk-select" className="block text-[11px] font-mono text-slate-400 mb-1">
                    Alert Severity
                  </label>
                  <select
                    id="rule-risk-select"
                    value={riskLevel}
                    onChange={(e) => setRiskLevel(e.target.value as IncidentSeverity)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                  >
                    <option value="Critical">Critical</option>
                    <option value="High">High</option>
                    <option value="Moderate">Moderate</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="rule-village-select" className="block text-[11px] font-mono text-slate-400 mb-1">
                    Target Village (Optional)
                  </label>
                  <select
                    id="rule-village-select"
                    value={villageId}
                    onChange={(e) => setVillageId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                  >
                    <option value="">Any Village / Perimeter</option>
                    {villages.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.district})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="rule-repeat-input" className="block text-[11px] font-mono text-slate-400 mb-1">
                    Min Repeat Sightings
                  </label>
                  <input
                    id="rule-repeat-input"
                    type="number"
                    min={1}
                    max={50}
                    value={minRepeatCount}
                    onChange={(e) => setMinRepeatCount(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="rule-window-input" className="block text-[11px] font-mono text-slate-400 mb-1">
                    Window (Minutes)
                  </label>
                  <input
                    id="rule-window-input"
                    type="number"
                    min={1}
                    max={10080}
                    value={timeWindowMinutes}
                    onChange={(e) => setTimeWindowMinutes(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="rule-conf-input" className="block text-[11px] font-mono text-slate-400 mb-1">
                    Min Species Conf (0-1)
                  </label>
                  <input
                    id="rule-conf-input"
                    type="number"
                    step="any"
                    min={0}
                    max={1}
                    value={minSpeciesConfidence}
                    onChange={(e) => setMinSpeciesConfidence(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="rule-zone-input" className="block text-[11px] font-mono text-slate-400 mb-1">
                    Zone Substring (Optional)
                  </label>
                  <input
                    id="rule-zone-input"
                    type="text"
                    value={zoneName}
                    onChange={(e) => setZoneName(e.target.value)}
                    placeholder="e.g., Gopalaswamy"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoNotifyOfficer}
                      onChange={(e) => setAutoNotifyOfficer(e.target.checked)}
                    />
                    <span>Route Nearest Forest Officer (Audit Log)</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoDispatchIot}
                      onChange={(e) => setAutoDispatchIot(e.target.checked)}
                    />
                    <span>Dispatch IoT Boundary Contract</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={!isAdmin}
                  title={isAdmin ? 'Create Rule' : 'Admin role required'}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-xs font-bold transition"
                >
                  Create Rule
                </button>
              </div>
            </form>

            <div className="space-y-2" data-testid="alert-rules-list">
              {rules.map((r) => (
                <div
                  key={r.id}
                  className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white">{r.name}</span>
                      <span className="px-1.5 py-0.5 rounded font-mono text-[10px] border border-amber-700 bg-amber-950 text-amber-300">
                        {r.riskLevel}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded font-mono text-[10px] border ${
                          r.enabled
                            ? 'border-emerald-700 bg-emerald-950 text-emerald-300'
                            : 'border-slate-700 bg-slate-900 text-slate-400'
                        }`}
                      >
                        {r.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      Species: {r.speciesFilter || 'All'} • Repeat &ge;{r.minRepeatCount} in {r.timeWindowMinutes}m • Min Conf {(r.minSpeciesConfidence * 100).toFixed(0)}%
                      {r.autoNotifyOfficer ? ' • Officer Routing' : ''}
                      {r.autoDispatchIotBoundary ? ' • IoT Contract' : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!isAdmin}
                      title={isAdmin ? 'Toggle rule state' : 'Admin role required'}
                      onClick={() => handleToggleRule(r)}
                      className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 border border-slate-700 rounded-lg text-[11px] font-semibold text-slate-200"
                    >
                      {r.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      disabled={!isAdmin}
                      title={isAdmin ? `Delete rule ${r.name}` : 'Admin role required'}
                      aria-label={`Delete rule ${r.name}`}
                      onClick={() => handleDeleteRule(r)}
                      className="p-1.5 bg-red-950/50 hover:bg-red-900 disabled:opacity-40 border border-red-800/70 rounded-lg text-red-300"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Section B: Officers & Notification Delivery Log */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-sky-400" />
                  <span>Forest Officer Routing Roster ({officers.length})</span>
                </h2>
                <span className="text-[10px] font-mono text-slate-400">GPS Haversine Nearest</span>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {officers.map((o) => (
                  <div
                    key={o.id}
                    className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white">
                        {o.name} <span className="font-mono text-sky-300">({o.badgeNumber})</span>
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-300 font-mono text-[10px]">
                        {o.dutyStatus}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {o.role} • {o.forestRange}
                      {o.latitude !== null && o.longitude !== null
                        ? ` • Station (${o.latitude?.toFixed(3)}, ${o.longitude?.toFixed(3)})`
                        : ''}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500">
                      Channel: {o.contactChannel} • Opt-in WA:{String(o.whatsappOptIn)} SMS:{String(o.smsOptIn)} (no phone numbers stored in demo)
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Officer Notification Audit Log ({deliveries.length})</span>
                </h2>
                <span className="text-[10px] font-mono text-amber-300">Stub Provider (Honest Status)</span>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1" data-testid="delivery-attempts-list">
                {deliveries.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400 bg-slate-950/60 border border-slate-800 rounded-xl">
                    No alert notifications dispatched yet. Trigger an alert rule to see nearest-officer routing logs.
                  </div>
                ) : (
                  deliveries.map((d) => (
                    <div
                      key={d.id}
                      className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-white">{d.officerName}</span>
                        <span className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-amber-950 border border-amber-700 text-amber-300">
                          {d.status}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-sky-300">
                        Basis: {d.routingBasis}
                        {d.distanceKm !== null && d.distanceKm !== undefined
                          ? ` (${d.distanceKm.toFixed(2)} km)`
                          : ''} • {d.channel}
                      </div>
                      {d.detail && <div className="text-[11px] text-slate-400">{d.detail}</div>}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          {/* Section C: IoT Boundary Contract */}
          <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Radio className="w-4 h-4 text-cyan-400" />
                <span>IoT Siren / Boundary Alert Contract ({iotEvents.length})</span>
              </h2>
              <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-cyan-950 border border-cyan-800 text-cyan-300">
                Software Contract Only — No Physical Siren Actuated
              </span>
            </div>

            <form
              onSubmit={handleDispatchDevIot}
              className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end text-xs"
            >
              <div>
                <label htmlFor="iot-camera-select" className="block text-[11px] font-mono text-slate-400 mb-1">
                  Registered Camera (Optional)
                </label>
                <select
                  id="iot-camera-select"
                  value={iotCameraId}
                  onChange={(e) => {
                    const camId = e.target.value;
                    setIotCameraId(camId);
                    const found = cameras.find((c) => c.id === camId);
                    if (found) setIotDeviceCode(found.cameraCode);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                >
                  <option value="">Manual Device Code</option>
                  {cameras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.cameraCode} ({c.zoneName})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="iot-device-code" className="block text-[11px] font-mono text-slate-400 mb-1">
                  Device Code
                </label>
                <input
                  id="iot-device-code"
                  type="text"
                  value={iotDeviceCode}
                  onChange={(e) => setIotDeviceCode(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono"
                />
              </div>
              <div>
                <label htmlFor="iot-species-input" className="block text-[11px] font-mono text-slate-400 mb-1">
                  Species
                </label>
                <input
                  id="iot-species-input"
                  type="text"
                  value={iotSpecies}
                  onChange={(e) => setIotSpecies(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="iot-conf-input" className="block text-[11px] font-mono text-slate-400 mb-1">
                  Confidence
                </label>
                <input
                  id="iot-conf-input"
                  type="number"
                  step="any"
                  min={0}
                  max={1}
                  value={iotConfidence}
                  onChange={(e) => setIotConfidence(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="iot-risk-select" className="block text-[11px] font-mono text-slate-400 mb-1">
                  Risk Level
                </label>
                <select
                  id="iot-risk-select"
                  value={iotRiskLevel}
                  onChange={(e) => setIotRiskLevel(e.target.value as IncidentSeverity)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                >
                  <option value="Critical">Critical</option>
                  <option value="High">High</option>
                  <option value="Moderate">Moderate</option>
                  <option value="Low">Low</option>
                </select>
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 text-white rounded-lg text-xs font-bold transition"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send Dev-Test Event</span>
              </button>
            </form>

            <div className="space-y-2" data-testid="iot-events-list">
              {iotEvents.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 bg-slate-950/60 border border-slate-800 rounded-xl">
                  No IoT boundary contract events dispatched yet.
                </div>
              ) : (
                iotEvents.map((evt) => (
                  <div
                    key={evt.id}
                    className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 text-xs space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-cyan-300">{evt.deviceCode}</span>
                        <span className="text-white font-semibold">{evt.species}</span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                          {evt.riskLevel} ({(evt.confidence * 100).toFixed(0)}%)
                        </span>
                        {evt.isDevTest && (
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-purple-950 border border-purple-700 text-purple-300">
                            DEV-TEST
                          </span>
                        )}
                      </div>
                      <span
                        className={`font-mono text-[10px] px-2 py-0.5 rounded border ${
                          evt.deliveryStatus === 'acknowledged'
                            ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                            : 'bg-amber-950 border-amber-700 text-amber-300'
                        }`}
                      >
                        {evt.deliveryStatus} • retries={evt.retryCount}
                      </span>
                    </div>

                    {evt.deliveryStatus !== 'acknowledged' && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <input
                          type="password"
                          aria-label={`Camera API key for ${evt.deviceCode} (${evt.id.slice(0, 6)})`}
                          value={ackKeyInputs[evt.id] || ''}
                          onChange={(e) =>
                            setAckKeyInputs((prev) => ({ ...prev, [evt.id]: e.target.value }))
                          }
                          placeholder="Enter X-Camera-Key to acknowledge..."
                          className="flex-1 min-w-[200px] bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-100"
                        />
                        <button
                          type="button"
                          onClick={() => handleAckIotEvent(evt.id)}
                          className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-[11px] font-semibold"
                        >
                          Acknowledge (X-Camera-Key)
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => handleRetryIotEvent(evt.id)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-semibold"
                          >
                            Retry Dispatch
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
};
