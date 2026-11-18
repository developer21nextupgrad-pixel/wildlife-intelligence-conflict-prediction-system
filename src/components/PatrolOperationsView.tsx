import React, { useState } from 'react';
import { PatrolOperation } from '../types';
import {
  ShieldCheck,
  MapPin,
  CheckCircle2,
  Plus,
  Search,
  X,
  AlertCircle,
} from 'lucide-react';
import { formatCoordinates } from '../utils/conflictCalculations';

const DUTY_APPROVER_LABEL = 'Duty Officer (Command Desk)';

interface PatrolOperationsViewProps {
  patrols: PatrolOperation[];
  onUpdateStatus: (id: string, status: PatrolOperation['status']) => Promise<void>;
  onCreatePatrol: (patrol: Omit<PatrolOperation, 'id' | 'patrolCode'>) => Promise<void>;
  onDeletePatrol?: (id: string) => Promise<void>;
  onNavigateToMap: () => void;
  isApiLoading?: boolean;
  apiError?: string | null;
  onRetrySync?: () => void;
}

export const PatrolOperationsView: React.FC<PatrolOperationsViewProps> = ({
  patrols,
  onUpdateStatus,
  onCreatePatrol,
  onDeletePatrol,
  onNavigateToMap,
  isApiLoading = false,
  apiError = null,
  onRetrySync,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'active' | 'recommended' | 'history'>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPriority, setFilterPriority] = useState('All');
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [updatingPatrolId, setUpdatingPatrolId] = useState<string | null>(null);

  // New Patrol Form State
  const [formData, setFormData] = useState({
    teamName: 'QRT Beta — Secondary Intercept Unit',
    leadOfficer: 'Suresh Kumar, SFS (RFO)',
    targetArea: 'Mangala - Gundlupet Agricultural Buffer',
    sector: 'Gundlupet Buffer Beat 02',
    priority: 'High' as PatrolOperation['priority'],
    status: 'Scheduled' as PatrolOperation['status'],
    scheduledWindow: '20:00 - 04:00 IST (Night Shift)',
    activePersonnel: 4,
    equipment: ['Thermal Monocular', 'Searchlight Array', 'Acoustic Siren', 'First Aid Trauma Kit'],
    riskRationale: 'Preemptive night surveillance following camera trap leopard triggers',
    approvedBy: DUTY_APPROVER_LABEL,
    coordinates: [11.6892, 76.6412] as [number, number],
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const activePatrols = patrols.filter(
    (p) => p.status === 'In Progress' || p.status === 'On Station'
  );
  const onStationCount = patrols.filter((p) => p.status === 'On Station').length;
  const inProgressCount = patrols.filter((p) => p.status === 'In Progress').length;
  const uniqueSectorCount = new Set(activePatrols.map((p) => p.sector)).size;

  const scheduledPatrols = patrols.filter((p) => p.status === 'Scheduled');
  const historyPatrols = patrols.filter((p) => p.status === 'Completed');

  // Recommended patrol suggestions (DEMO)
  const recommendedPatrols = [
    {
      id: 'rec-1',
      title: 'Sector 4B Stream Gully Pre-Dusk Perimeter Sweep',
      targetSector: 'Hediyala Range (Beat 4)',
      priority: 'Critical' as const,
      riskScore: 89,
      dominantThreat: 'Asian Elephant Herd #EL-04 Migration Vector',
      recommendedWindow: '17:30 - 22:30 IST',
      suggestedPersonnel: 5,
      suggestedGear: ['Thermal Imaging Drone', 'Solar Fence Pylon Tester', 'Spotlight Vehicle'],
      rationale:
        'Demo telemetry indicates herd is 280m from agricultural fence with mature sugarcane ready for harvest.',
    },
    {
      id: 'rec-2',
      title: 'Mangala Village Cattle Corral Buffer Reinforcement',
      targetSector: 'Gundlupet Buffer Beat 02',
      priority: 'High' as const,
      riskScore: 84,
      dominantThreat: 'Indian Leopard Nocturnal Stalking',
      recommendedWindow: '21:00 - 03:00 IST',
      suggestedPersonnel: 4,
      suggestedGear: ['Box Trap #02', 'VHF Tracking Antenna', 'Loud Hailer'],
      rationale:
        'Sample camera trap CT-18 triggered multiple perimeter passes within 400m of sheep pens.',
    },
    {
      id: 'rec-3',
      title: 'Maddur Highway Elephant Pass Speed & Corridor Watch',
      targetSector: 'Maddur Beat 06',
      priority: 'Moderate' as const,
      riskScore: 68,
      dominantThreat: 'Highway Corridor Crossing (Bull Elephant)',
      recommendedWindow: '18:00 - 02:00 IST',
      suggestedPersonnel: 3,
      suggestedGear: ['Reflective Cones', 'LED Batons', 'Speed Radar'],
      rationale: 'Historical collision vulnerability during post-monsoon bamboo foraging season.',
    },
  ];

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setModalError(null);
    setActionError(null);
    try {
      await onCreatePatrol(formData);
      setIsSubmitting(false);
      setIsPlanModalOpen(false);
      setToastMessage('Patrol schedule persisted to PostgreSQL/PostGIS database.');
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err) {
      setIsSubmitting(false);
      setModalError(
        err instanceof Error
          ? err.message
          : 'Failed to schedule patrol operation. Your inputs have been preserved.'
      );
    }
  };

  const handleStatusChange = async (id: string, status: PatrolOperation['status']) => {
    setUpdatingPatrolId(id);
    setActionError(null);
    try {
      await onUpdateStatus(id, status);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to update patrol status in backend.'
      );
    } finally {
      setUpdatingPatrolId(null);
    }
  };

  const handleApproveRecommended = async (rec: (typeof recommendedPatrols)[0]) => {
    setActionError(null);
    try {
      await onCreatePatrol({
        teamName: `Field Unit for ${rec.title.slice(0, 32)}`,
        leadOfficer: 'Range Forest Officer (Assigned)',
        targetArea: rec.title,
        sector: rec.targetSector,
        priority: rec.priority === 'Moderate' ? 'Medium' : rec.priority,
        status: 'Scheduled',
        scheduledWindow: rec.recommendedWindow,
        activePersonnel: rec.suggestedPersonnel,
        equipment: rec.suggestedGear,
        riskRationale: rec.rationale,
        approvedBy: DUTY_APPROVER_LABEL,
        coordinates: [11.664, 76.62],
      });
      setToastMessage('Recommended patrol scheduled and saved to PostgreSQL database.');
      setTimeout(() => setToastMessage(null), 4000);
      setActiveSubTab('active');
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to schedule recommended patrol.'
      );
    }
  };

  const filteredPatrols = patrols.filter((p) => {
    if (activeSubTab === 'active' && p.status === 'Completed') return false;
    if (activeSubTab === 'history' && p.status !== 'Completed') return false;
    if (filterPriority !== 'All' && p.priority !== filterPriority) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      const match =
        `${p.patrolCode} ${p.teamName} ${p.leadOfficer} ${p.targetArea} ${p.sector}`.toLowerCase();
      if (!match.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 font-bold uppercase tracking-wider">
            <span>Tactical Field Deployment</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>PostgreSQL + PostGIS Patrol Roster</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            Patrol Planning & Operational Deployments
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Track Rapid Response Teams (RRT), beat squads, and simulated patrol route recommendations.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onNavigateToMap}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs sm:text-sm font-semibold px-3 py-2 rounded-lg border border-slate-700 transition"
          >
            <MapPin className="w-4 h-4 text-emerald-400" />
            <span>View Sectors on GIS Map</span>
          </button>
          <button
            onClick={() => {
              setModalError(null);
              setIsPlanModalOpen(true);
            }}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold px-3.5 py-2 rounded-lg shadow-sm transition active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Plan New Patrol</span>
          </button>
        </div>
      </div>

      {/* Action Success Toast */}
      {toastMessage && (
        <div className="bg-emerald-950/90 border border-emerald-600/70 text-emerald-200 px-4 py-3 rounded-xl flex items-center justify-between text-xs font-semibold shadow-lg animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button
            onClick={() => setToastMessage(null)}
            className="text-emerald-400 hover:text-white p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Action Error Banner */}
      {actionError && (
        <div
          role="alert"
          className="bg-red-950/80 border border-red-700/70 text-red-200 px-4 py-3 rounded-xl flex items-center justify-between text-xs font-semibold"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-red-300 hover:text-white p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI 4 Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-xs">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">
            Active Patrol Teams
          </div>
          <div className="text-3xl font-extrabold text-white font-mono tabular-nums mt-1">
            {activePatrols.length}
          </div>
          <div className="text-[11px] text-emerald-400 font-semibold mt-1 font-mono tabular-nums">
            {onStationCount} On Station • {inProgressCount} In Progress
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-xs">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">
            Field Personnel Deployed
          </div>
          <div className="text-3xl font-extrabold text-emerald-400 font-mono tabular-nums mt-1">
            {activePatrols.reduce((acc, p) => acc + p.activePersonnel, 0)} Officers
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-mono tabular-nums">
            Across {uniqueSectorCount} Active Sector{uniqueSectorCount === 1 ? '' : 's'}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-xs">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">
            Scheduled Shifts
          </div>
          <div className="text-3xl font-extrabold text-amber-400 font-mono tabular-nums mt-1">
            {scheduledPatrols.length}
          </div>
          <div className="text-[11px] text-amber-300 font-semibold mt-1">
            Pending dispatch transition
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-xs">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">
            Recommended Routes (Demo)
          </div>
          <div className="text-3xl font-extrabold text-sky-400 font-mono tabular-nums mt-1">
            {recommendedPatrols.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Simulated route suggestions
          </div>
        </div>
      </div>

      {/* Sub-tab Navigation Strip */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab('active')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeSubTab === 'active'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            Active & Scheduled ({activePatrols.length + scheduledPatrols.length})
          </button>
          <button
            onClick={() => setActiveSubTab('recommended')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
              activeSubTab === 'recommended'
                ? 'bg-sky-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <span>Recommended Routes (Demo)</span>
            <span className="text-[10px] bg-sky-900 text-sky-200 px-1.5 py-0.2 rounded font-mono">
              {recommendedPatrols.length}
            </span>
          </button>
          <button
            onClick={() => setActiveSubTab('history')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeSubTab === 'history'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            Patrol History Log ({historyPatrols.length})
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-2">
          <span className="text-[11px] text-slate-400 font-mono">
            CRS: EPSG:4326 • Grid: UTM-43N
          </span>
        </div>
      </div>

      {/* VIEW A: ACTIVE & SCHEDULED PATROLS */}
      {activeSubTab === 'active' && (
        <div className="space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search patrol code, team, lead officer, sector..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-hidden focus:border-emerald-500"
              />
            </div>

            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 font-medium focus:outline-hidden"
            >
              <option value="All">All Priority Levels</option>
              <option value="Critical">Critical Priority</option>
              <option value="High">High Priority</option>
              <option value="Medium">Medium Priority</option>
              <option value="Low">Low Priority</option>
            </select>
          </div>

          {isApiLoading && patrols.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center text-xs text-slate-300">
              Loading patrol roster from FastAPI + PostGIS...
            </div>
          ) : filteredPatrols.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center text-xs text-slate-400">
              <p className="font-semibold text-white">
                {apiError
                  ? 'Patrol roster unavailable (Backend offline)'
                  : 'No active or scheduled patrols match the current filter.'}
              </p>
              {apiError && onRetrySync && (
                <button
                  type="button"
                  onClick={onRetrySync}
                  className="mt-3 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded-lg font-semibold text-xs"
                >
                  Retry Backend Sync
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredPatrols.map((patrol) => (
                <div
                  key={patrol.id}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3.5 hover:border-slate-700 transition flex flex-col justify-between"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                            {patrol.patrolCode}
                          </span>
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                              patrol.isDemo
                                ? 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                                : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                            }`}
                          >
                            {patrol.isDemo ? 'DEMO' : 'DB'}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                              patrol.priority === 'Critical'
                                ? 'bg-red-950 text-red-400 border border-red-800/60'
                                : patrol.priority === 'High'
                                ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                                : 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                            }`}
                          >
                            {patrol.priority} Priority
                          </span>
                        </div>
                        <h4 className="text-base font-bold text-white mt-1.5">{patrol.teamName}</h4>
                        <div className="text-xs text-slate-400">
                          {patrol.sector} •{' '}
                          <span className="font-mono">
                            {formatCoordinates(patrol.coordinates[0], patrol.coordinates[1])}
                          </span>
                        </div>
                      </div>

                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                          patrol.status === 'In Progress'
                            ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/60'
                            : patrol.status === 'On Station'
                            ? 'bg-blue-900/60 text-blue-300 border border-blue-700/60'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {patrol.status}
                      </span>
                    </div>

                    <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 text-xs space-y-1.5">
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-400">Target Area:</span>
                        <span className="font-semibold text-slate-200 text-right">
                          {patrol.targetArea}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-400">Team Leader:</span>
                        <span className="font-semibold text-emerald-300 text-right">
                          {patrol.leadOfficer}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-400">Operating Shift:</span>
                        <span className="font-mono text-slate-300">{patrol.scheduledWindow}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-400">Active Personnel:</span>
                        <span className="font-bold text-white font-mono">
                          {patrol.activePersonnel} Officers
                        </span>
                      </div>
                    </div>

                    <div className="text-xs text-slate-400 bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/80">
                      <span className="font-bold text-slate-300">Deployment Directive: </span>
                      {patrol.riskRationale}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {patrol.equipment.map((eq, i) => (
                        <span
                          key={i}
                          className="text-[10px] font-mono bg-slate-800/80 text-slate-300 px-2 py-0.5 rounded border border-slate-700/60"
                        >
                          {eq}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Status Switcher & Map Jump */}
                  <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <button
                      onClick={onNavigateToMap}
                      className="text-emerald-400 hover:text-emerald-300 text-[11px] font-semibold flex items-center gap-1"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span>Inspect Sector on GIS Map</span>
                    </button>

                    <div className="flex items-center gap-1.5">
                      {patrol.status !== 'In Progress' && (
                        <button
                          disabled={updatingPatrolId === patrol.id}
                          onClick={() => handleStatusChange(patrol.id, 'In Progress')}
                          className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-[11px] font-semibold transition disabled:opacity-60"
                        >
                          Dispatch
                        </button>
                      )}
                      {patrol.status === 'In Progress' && (
                        <button
                          disabled={updatingPatrolId === patrol.id}
                          onClick={() => handleStatusChange(patrol.id, 'On Station')}
                          className="px-2.5 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded text-[11px] font-semibold transition disabled:opacity-60"
                        >
                          Arrived On Station
                        </button>
                      )}
                      {patrol.status !== 'Completed' && (
                        <button
                          disabled={updatingPatrolId === patrol.id}
                          onClick={() => handleStatusChange(patrol.id, 'Completed')}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] transition disabled:opacity-60"
                        >
                          End Shift
                        </button>
                      )}
                      {onDeletePatrol && (
                        <button
                          disabled={updatingPatrolId === patrol.id}
                          onClick={async () => {
                            setUpdatingPatrolId(patrol.id);
                            setActionError(null);
                            try {
                              await onDeletePatrol(patrol.id);
                            } catch (err) {
                              setActionError(
                                err instanceof Error
                                  ? err.message
                                  : 'Failed to delete patrol.'
                              );
                            } finally {
                              setUpdatingPatrolId(null);
                            }
                          }}
                          className="px-2 py-1 bg-red-950/70 hover:bg-red-900/70 border border-red-800/50 text-red-300 rounded text-[11px] transition disabled:opacity-60"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW B: RECOMMENDED PATROLS (DEMO) */}
      {activeSubTab === 'recommended' && (
        <div className="space-y-4">
          <div className="bg-sky-950/40 border border-sky-800/60 p-4 rounded-xl text-xs text-sky-200">
            <div className="font-bold flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-sky-400" />
              <span>Officer Authority & Demo Route Suggestions</span>
            </div>
            <p className="text-sky-300/80 leading-relaxed">
              These patrol recommendations are static prototype samples illustrating how risk scores could inform beat scheduling. Approving a route adds it to your local browser roster.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {recommendedPatrols.map((rec) => (
              <div
                key={rec.id}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3.5 flex flex-col justify-between hover:border-sky-500/50 transition"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between">
                    <span
                      className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded ${
                        rec.priority === 'Critical'
                          ? 'bg-red-950 text-red-400 border border-red-800/60'
                          : 'bg-amber-950 text-amber-400 border border-amber-800/60'
                      }`}
                    >
                      {rec.priority} (DEMO)
                    </span>
                    <span className="font-mono text-sm font-extrabold text-red-400">
                      Risk: {rec.riskScore}%
                    </span>
                  </div>

                  <h4 className="text-sm font-bold text-white">{rec.title}</h4>
                  <div className="text-xs text-slate-400">{rec.targetSector}</div>

                  <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-xs space-y-1.5">
                    <div>
                      <span className="text-slate-400">Dominant Factor:</span>
                      <div className="font-semibold text-slate-200 mt-0.5">
                        {rec.dominantThreat}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400">Recommended Window:</span>
                      <div className="font-mono text-emerald-400">{rec.recommendedWindow}</div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/70 leading-relaxed">
                    {rec.rationale}
                  </p>

                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold text-slate-500">
                      Suggested Gear:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {rec.suggestedGear.map((g, i) => (
                        <span
                          key={i}
                          className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono"
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800">
                  <button
                    onClick={() => handleApproveRecommended(rec)}
                    className="w-full bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs py-2 rounded-xl transition shadow-xs flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Schedule Demo Patrol</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW C: PATROL HISTORY */}
      {activeSubTab === 'history' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xs">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-bold uppercase text-[10px] font-mono">
              <tr>
                <th className="py-3 px-4">Patrol Code</th>
                <th className="py-3 px-4">Squad / Unit</th>
                <th className="py-3 px-4">Sector Covered</th>
                <th className="py-3 px-4">Lead Officer</th>
                <th className="py-3 px-4">Personnel</th>
                <th className="py-3 px-4">Shift Details</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {historyPatrols.map((p) => (
                <tr key={p.id} className="hover:bg-slate-800/50">
                  <td className="py-3 px-4 font-mono font-bold text-white">{p.patrolCode}</td>
                  <td className="py-3 px-4 font-semibold text-slate-200">{p.teamName}</td>
                  <td className="py-3 px-4">{p.targetArea}</td>
                  <td className="py-3 px-4 text-emerald-300">{p.leadOfficer}</td>
                  <td className="py-3 px-4 font-mono">{p.activePersonnel} Officers</td>
                  <td className="py-3 px-4 font-mono text-slate-400">{p.scheduledWindow}</td>
                  <td className="py-3 px-4">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      Completed & Logged
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL: PLAN NEW PATROL */}
      {isPlanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs overflow-y-auto">
          <div className="bg-slate-900 rounded-2xl border border-slate-800 w-full max-w-xl overflow-hidden shadow-2xl animate-in fade-in">
            <div className="bg-slate-950 px-6 py-4 border-b border-slate-800 flex items-center justify-between text-white">
              <div>
                <span className="text-emerald-400 font-mono text-xs uppercase font-bold">
                  Field Operations • Directive Form P-01
                </span>
                <h3 className="text-base font-bold">Schedule New Patrol Squad</h3>
              </div>
              <button
                onClick={() => setIsPlanModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-6 space-y-4 text-xs text-slate-300">
              {modalError && (
                <div
                  role="alert"
                  className="bg-red-950/80 border border-red-700/70 text-red-200 px-3.5 py-2.5 rounded-lg flex items-center gap-2 text-xs font-semibold"
                >
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-200 mb-1">
                    Squad Designation *
                  </label>
                  <input
                    type="text"
                    value={formData.teamName}
                    onChange={(e) => setFormData({ ...formData, teamName: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-hidden focus:border-emerald-500"
                    required
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-200 mb-1">Lead Officer *</label>
                  <input
                    type="text"
                    value={formData.leadOfficer}
                    onChange={(e) => setFormData({ ...formData, leadOfficer: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-hidden focus:border-emerald-500"
                    required
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-200 mb-1">
                    Target Sector / Boundary *
                  </label>
                  <input
                    type="text"
                    value={formData.targetArea}
                    onChange={(e) => setFormData({ ...formData, targetArea: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-hidden focus:border-emerald-500"
                    required
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-200 mb-1">
                    Priority Classification
                  </label>
                  <select
                    value={formData.priority}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        priority: e.target.value as PatrolOperation['priority'],
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-hidden focus:border-emerald-500"
                  >
                    <option value="Critical">Critical (Immediate Interception)</option>
                    <option value="High">High (High-Vulnerability Buffer)</option>
                    <option value="Medium">Medium (Routine Perimeter)</option>
                    <option value="Low">Low (Biological Sweep)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-200 mb-1">Operating Window</label>
                  <input
                    type="text"
                    value={formData.scheduledWindow}
                    onChange={(e) =>
                      setFormData({ ...formData, scheduledWindow: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 font-mono text-white focus:outline-hidden focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-200 mb-1">
                    Team Strength (Personnel)
                  </label>
                  <input
                    type="number"
                    min="2"
                    max="15"
                    value={formData.activePersonnel}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        activePersonnel: parseInt(e.target.value, 10) || 4,
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 font-mono text-white focus:outline-hidden focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-200 mb-1">
                  Deployment Rationale & Directive *
                </label>
                <textarea
                  rows={2}
                  value={formData.riskRationale}
                  onChange={(e) => setFormData({ ...formData, riskRationale: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-hidden focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-slate-200 mb-1">
                  Authorizing Officer *
                </label>
                <input
                  type="text"
                  value={formData.approvedBy}
                  onChange={(e) => setFormData({ ...formData, approvedBy: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-hidden focus:border-emerald-500"
                  required
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsPlanModalOpen(false)}
                  className="px-4 py-2 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition disabled:opacity-60"
                >
                  {isSubmitting ? 'Saving to Database...' : 'Schedule Patrol Operation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
