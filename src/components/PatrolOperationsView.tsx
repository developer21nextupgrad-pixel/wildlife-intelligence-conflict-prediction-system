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
  Pencil,
  Trash2,
} from 'lucide-react';
import { formatCoordinates } from '../utils/conflictCalculations';
import { DIVISION_OPTIONS, validatePatrolInput } from '../utils/wicpsFilters';

const DUTY_APPROVER_LABEL = 'Duty Officer (Command Desk)';

interface PatrolFormState {
  teamName: string;
  leadOfficer: string;
  targetArea: string;
  sector: string;
  district: string;
  priority: PatrolOperation['priority'] | '';
  status: PatrolOperation['status'] | '';
  scheduledWindow: string;
  activePersonnel: string;
  equipmentText: string;
  riskRationale: string;
  approvedBy: string;
  latitude: string;
  longitude: string;
}

function buildEmptyPatrolForm(): PatrolFormState {
  return {
    teamName: '',
    leadOfficer: '',
    targetArea: '',
    sector: '',
    district: '',
    priority: '',
    status: '',
    scheduledWindow: '',
    activePersonnel: '',
    equipmentText: '',
    riskRationale: '',
    approvedBy: '',
    latitude: '',
    longitude: '',
  };
}

function buildFormFromPatrol(patrol: PatrolOperation): PatrolFormState {
  return {
    teamName: patrol.teamName,
    leadOfficer: patrol.leadOfficer,
    targetArea: patrol.targetArea,
    sector: patrol.sector,
    district: patrol.district || 'Bandipur Division',
    priority: patrol.priority,
    status: patrol.status,
    scheduledWindow: patrol.scheduledWindow,
    activePersonnel: String(patrol.activePersonnel),
    equipmentText: patrol.equipment.join(', '),
    riskRationale: patrol.riskRationale,
    approvedBy: patrol.approvedBy,
    latitude: String(patrol.coordinates[0]),
    longitude: String(patrol.coordinates[1]),
  };
}

interface PatrolOperationsViewProps {
  patrols: PatrolOperation[];
  onUpdateStatus: (id: string, status: PatrolOperation['status']) => Promise<void>;
  onCreatePatrol: (patrol: Omit<PatrolOperation, 'id' | 'patrolCode'>) => Promise<void>;
  onUpdatePatrol?: (
    id: string,
    updates: Partial<Omit<PatrolOperation, 'id' | 'patrolCode'>>
  ) => Promise<void>;
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
  onUpdatePatrol,
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
  const [editingPatrol, setEditingPatrol] = useState<PatrolOperation | null>(null);
  const [patrolPendingDelete, setPatrolPendingDelete] = useState<PatrolOperation | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [updatingPatrolId, setUpdatingPatrolId] = useState<string | null>(null);

  // Patrol Form State
  const [formData, setFormData] = useState<PatrolFormState>(buildEmptyPatrolForm);
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string>>({});

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

  const handleOpenPlanModal = () => {
    setEditingPatrol(null);
    setFormData(buildEmptyPatrolForm());
    setFormFieldErrors({});
    setModalError(null);
    setIsPlanModalOpen(true);
  };

  const handleOpenEditModal = (patrol: PatrolOperation) => {
    setEditingPatrol(patrol);
    setFormData(buildFormFromPatrol(patrol));
    setFormFieldErrors({});
    setModalError(null);
    setIsPlanModalOpen(true);
  };

  const handleClosePlanModal = () => {
    if (isSubmitting) return;
    setIsPlanModalOpen(false);
    setEditingPatrol(null);
    setFormData(buildEmptyPatrolForm());
    setFormFieldErrors({});
    setModalError(null);
  };

  const handleSavePatrolSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const personnelNum = Number.parseInt(formData.activePersonnel, 10);
    const latNum = Number.parseFloat(formData.latitude);
    const lngNum = Number.parseFloat(formData.longitude);

    const validationErrors = validatePatrolInput({
      teamName: formData.teamName,
      leadOfficer: formData.leadOfficer,
      targetArea: formData.targetArea,
      sector: formData.sector,
      district: formData.district,
      priority: formData.priority,
      status: formData.status,
      scheduledWindow: formData.scheduledWindow,
      activePersonnel: personnelNum,
      riskRationale: formData.riskRationale,
      approvedBy: formData.approvedBy,
      latitude: latNum,
      longitude: lngNum,
    });

    setFormFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setModalError('Please correct the highlighted fields before saving the patrol operation.');
      return;
    }

    const equipment = formData.equipmentText
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const payload: Omit<PatrolOperation, 'id' | 'patrolCode'> = {
      teamName: formData.teamName.trim(),
      leadOfficer: formData.leadOfficer.trim(),
      targetArea: formData.targetArea.trim(),
      sector: formData.sector.trim(),
      district: formData.district.trim(),
      priority: formData.priority as PatrolOperation['priority'],
      status: formData.status as PatrolOperation['status'],
      scheduledWindow: formData.scheduledWindow.trim(),
      activePersonnel: personnelNum,
      equipment,
      riskRationale: formData.riskRationale.trim(),
      approvedBy: formData.approvedBy.trim(),
      coordinates: [latNum, lngNum],
    };

    setIsSubmitting(true);
    setModalError(null);
    setActionError(null);
    try {
      if (editingPatrol && onUpdatePatrol) {
        await onUpdatePatrol(editingPatrol.id, payload);
        setToastMessage(`Patrol ${editingPatrol.patrolCode} updated in PostgreSQL/PostGIS database.`);
      } else {
        await onCreatePatrol(payload);
        setToastMessage('Patrol schedule persisted to PostgreSQL/PostGIS database.');
      }
      setIsSubmitting(false);
      setIsPlanModalOpen(false);
      setEditingPatrol(null);
      setFormData(buildEmptyPatrolForm());
      setFormFieldErrors({});
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err) {
      setIsSubmitting(false);
      setModalError(
        err instanceof Error
          ? err.message
          : 'Failed to save patrol operation. Your inputs have been preserved.'
      );
    }
  };

  const handleConfirmDeletePatrol = async () => {
    if (!patrolPendingDelete || !onDeletePatrol || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    setActionError(null);
    try {
      await onDeletePatrol(patrolPendingDelete.id);
      const deletedCode = patrolPendingDelete.patrolCode;
      setPatrolPendingDelete(null);
      setToastMessage(`Patrol ${deletedCode} deleted from PostgreSQL/PostGIS database.`);
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete patrol from backend.'
      );
    } finally {
      setIsDeleting(false);
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
        district: 'Bandipur Division',
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
            type="button"
            onClick={handleOpenPlanModal}
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

                    <div className="flex flex-wrap items-center gap-1.5">
                      {onUpdatePatrol && (
                        <button
                          type="button"
                          disabled={updatingPatrolId === patrol.id}
                          onClick={() => handleOpenEditModal(patrol)}
                          aria-label={`Edit patrol ${patrol.patrolCode}`}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded text-[11px] font-semibold transition inline-flex items-center gap-1 disabled:opacity-60"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                      )}
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
                          type="button"
                          disabled={updatingPatrolId === patrol.id}
                          onClick={() => {
                            setDeleteError(null);
                            setPatrolPendingDelete(patrol);
                          }}
                          aria-label={`Delete patrol ${patrol.patrolCode}`}
                          className="px-2 py-1 bg-red-950/70 hover:bg-red-900/70 border border-red-800/50 text-red-300 rounded text-[11px] transition inline-flex items-center gap-1 disabled:opacity-60"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Remove</span>
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
              These patrol recommendations are static prototype samples illustrating how risk scores could inform beat scheduling. Approving a route schedules and persists it to the operational patrol database.
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
                {(onUpdatePatrol || onDeletePatrol) && (
                  <th className="py-3 px-4 text-right">Actions</th>
                )}
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
                  {(onUpdatePatrol || onDeletePatrol) && (
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {onUpdatePatrol && (
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(p)}
                            aria-label={`Edit patrol ${p.patrolCode}`}
                            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded text-[11px] font-semibold inline-flex items-center gap-1"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                        )}
                        {onDeletePatrol && (
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null);
                              setPatrolPendingDelete(p);
                            }}
                            aria-label={`Delete patrol ${p.patrolCode}`}
                            className="px-2 py-1 bg-red-950/70 hover:bg-red-900/70 border border-red-800/50 text-red-300 rounded text-[11px] inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Remove</span>
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL: CREATE OR EDIT PATROL */}
      {isPlanModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="patrol-form-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs overflow-y-auto"
        >
          <div className="bg-slate-900 rounded-2xl border border-slate-800 w-full max-w-2xl my-8 overflow-hidden shadow-2xl animate-in fade-in">
            <div className="bg-slate-950 px-6 py-4 border-b border-slate-800 flex items-center justify-between text-white">
              <div>
                <span className="text-emerald-400 font-mono text-xs uppercase font-bold">
                  {editingPatrol
                    ? `Edit Deployment • ${editingPatrol.patrolCode}`
                    : 'Field Operations • Directive Form P-01'}
                </span>
                <h3 id="patrol-form-modal-title" className="text-base font-bold">
                  {editingPatrol ? 'Edit Patrol Operation' : 'Schedule New Patrol Squad'}
                </h3>
              </div>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleClosePlanModal}
                aria-label="Close patrol form"
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleSavePatrolSubmit}
              noValidate
              className="p-6 space-y-4 text-xs text-slate-300 max-h-[80vh] overflow-y-auto"
            >
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
                  <label htmlFor="patrol-team-input" className="block font-bold text-slate-200 mb-1">
                    Squad Designation *
                  </label>
                  <input
                    id="patrol-team-input"
                    type="text"
                    placeholder="e.g. QRT Beta — Secondary Intercept Unit"
                    value={formData.teamName}
                    onChange={(e) => setFormData({ ...formData, teamName: e.target.value })}
                    className={`w-full bg-slate-950 border rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 ${
                      formFieldErrors.teamName ? 'border-red-500' : 'border-slate-800'
                    }`}
                    required
                  />
                  {formFieldErrors.teamName && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formFieldErrors.teamName}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="patrol-officer-input" className="block font-bold text-slate-200 mb-1">
                    Lead Officer *
                  </label>
                  <input
                    id="patrol-officer-input"
                    type="text"
                    placeholder="e.g. Suresh Kumar, SFS (RFO)"
                    value={formData.leadOfficer}
                    onChange={(e) => setFormData({ ...formData, leadOfficer: e.target.value })}
                    className={`w-full bg-slate-950 border rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 ${
                      formFieldErrors.leadOfficer ? 'border-red-500' : 'border-slate-800'
                    }`}
                    required
                  />
                  {formFieldErrors.leadOfficer && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formFieldErrors.leadOfficer}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="patrol-target-area-input" className="block font-bold text-slate-200 mb-1">
                    Target Area / Boundary *
                  </label>
                  <input
                    id="patrol-target-area-input"
                    type="text"
                    placeholder="e.g. Mangala - Gundlupet Agricultural Buffer"
                    value={formData.targetArea}
                    onChange={(e) => setFormData({ ...formData, targetArea: e.target.value })}
                    className={`w-full bg-slate-950 border rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 ${
                      formFieldErrors.targetArea ? 'border-red-500' : 'border-slate-800'
                    }`}
                    required
                  />
                  {formFieldErrors.targetArea && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formFieldErrors.targetArea}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="patrol-sector-input" className="block font-bold text-slate-200 mb-1">
                    Patrol Sector / Beat *
                  </label>
                  <input
                    id="patrol-sector-input"
                    type="text"
                    placeholder="e.g. Gundlupet Buffer Beat 02"
                    value={formData.sector}
                    onChange={(e) => setFormData({ ...formData, sector: e.target.value })}
                    className={`w-full bg-slate-950 border rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 ${
                      formFieldErrors.sector ? 'border-red-500' : 'border-slate-800'
                    }`}
                    required
                  />
                  {formFieldErrors.sector && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formFieldErrors.sector}
                    </span>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="patrol-district-input" className="block font-bold text-slate-200 mb-1">
                    District / Wildlife Division *
                  </label>
                  <input
                    id="patrol-district-input"
                    type="text"
                    list="patrol-division-suggestions"
                    placeholder="e.g. Bandipur Division"
                    value={formData.district}
                    onChange={(e) => setFormData({ ...formData, district: e.target.value })}
                    className={`w-full bg-slate-950 border rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 ${
                      formFieldErrors.district ? 'border-red-500' : 'border-slate-800'
                    }`}
                    required
                  />
                  <datalist id="patrol-division-suggestions">
                    {DIVISION_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id} />
                    ))}
                  </datalist>
                  {formFieldErrors.district && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formFieldErrors.district}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="patrol-priority-select" className="block font-bold text-slate-200 mb-1">
                    Priority Classification *
                  </label>
                  <select
                    id="patrol-priority-select"
                    value={formData.priority}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        priority: e.target.value as PatrolOperation['priority'] | '',
                      })
                    }
                    className={`w-full bg-slate-950 border rounded-lg p-2.5 text-white focus:outline-hidden focus:border-emerald-500 ${
                      formFieldErrors.priority ? 'border-red-500' : 'border-slate-800'
                    }`}
                  >
                    <option value="">Select priority level...</option>
                    <option value="Critical">Critical (Immediate Interception)</option>
                    <option value="High">High (High-Vulnerability Buffer)</option>
                    <option value="Medium">Medium (Routine Perimeter)</option>
                    <option value="Low">Low (Biological Sweep)</option>
                  </select>
                  {formFieldErrors.priority && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formFieldErrors.priority}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="patrol-status-select" className="block font-bold text-slate-200 mb-1">
                    Initial Status *
                  </label>
                  <select
                    id="patrol-status-select"
                    value={formData.status}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        status: e.target.value as PatrolOperation['status'] | '',
                      })
                    }
                    className={`w-full bg-slate-950 border rounded-lg p-2.5 text-white focus:outline-hidden focus:border-emerald-500 ${
                      formFieldErrors.status ? 'border-red-500' : 'border-slate-800'
                    }`}
                  >
                    <option value="">Select initial status...</option>
                    <option value="Scheduled">Scheduled</option>
                    <option value="In Progress">In Progress</option>
                    <option value="On Station">On Station</option>
                    <option value="Completed">Completed</option>
                  </select>
                  {formFieldErrors.status && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formFieldErrors.status}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="patrol-window-input" className="block font-bold text-slate-200 mb-1">
                    Scheduled Date & Operating Window *
                  </label>
                  <input
                    id="patrol-window-input"
                    type="text"
                    placeholder="e.g. 2026-11-19 • 20:00 - 04:00 IST"
                    value={formData.scheduledWindow}
                    onChange={(e) =>
                      setFormData({ ...formData, scheduledWindow: e.target.value })
                    }
                    className={`w-full bg-slate-950 border rounded-lg p-2.5 font-mono text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 ${
                      formFieldErrors.scheduledWindow ? 'border-red-500' : 'border-slate-800'
                    }`}
                  />
                  {formFieldErrors.scheduledWindow && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formFieldErrors.scheduledWindow}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="patrol-personnel-input" className="block font-bold text-slate-200 mb-1">
                    Team Strength (Personnel) *
                  </label>
                  <input
                    id="patrol-personnel-input"
                    type="number"
                    min="1"
                    max="200"
                    placeholder="e.g. 4"
                    value={formData.activePersonnel}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        activePersonnel: e.target.value,
                      })
                    }
                    className={`w-full bg-slate-950 border rounded-lg p-2.5 font-mono text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 ${
                      formFieldErrors.activePersonnel ? 'border-red-500' : 'border-slate-800'
                    }`}
                  />
                  {formFieldErrors.activePersonnel && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formFieldErrors.activePersonnel}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="patrol-lat-input" className="block font-bold text-slate-200 mb-1">
                    Latitude (WGS84) *
                  </label>
                  <input
                    id="patrol-lat-input"
                    type="number"
                    step="0.0001"
                    placeholder="e.g. 11.6892"
                    value={formData.latitude}
                    onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                    className={`w-full bg-slate-950 border rounded-lg p-2.5 font-mono text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 ${
                      formFieldErrors.latitude ? 'border-red-500' : 'border-slate-800'
                    }`}
                  />
                  {formFieldErrors.latitude && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formFieldErrors.latitude}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="patrol-lng-input" className="block font-bold text-slate-200 mb-1">
                    Longitude (WGS84) *
                  </label>
                  <input
                    id="patrol-lng-input"
                    type="number"
                    step="0.0001"
                    placeholder="e.g. 76.6412"
                    value={formData.longitude}
                    onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                    className={`w-full bg-slate-950 border rounded-lg p-2.5 font-mono text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 ${
                      formFieldErrors.longitude ? 'border-red-500' : 'border-slate-800'
                    }`}
                  />
                  {formFieldErrors.longitude && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formFieldErrors.longitude}
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="patrol-equipment-input" className="block font-bold text-slate-200 mb-1">
                  Assigned Equipment (Comma-separated, Optional)
                </label>
                <input
                  id="patrol-equipment-input"
                  type="text"
                  placeholder="e.g. Thermal Monocular, Searchlight Array, Acoustic Siren"
                  value={formData.equipmentText}
                  onChange={(e) => setFormData({ ...formData, equipmentText: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              <div>
                <label htmlFor="patrol-rationale-textarea" className="block font-bold text-slate-200 mb-1">
                  Deployment Rationale & Directive *
                </label>
                <textarea
                  id="patrol-rationale-textarea"
                  rows={2}
                  placeholder="Describe tactical objective and wildlife movement risk..."
                  value={formData.riskRationale}
                  onChange={(e) => setFormData({ ...formData, riskRationale: e.target.value })}
                  className={`w-full bg-slate-950 border rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 ${
                    formFieldErrors.riskRationale ? 'border-red-500' : 'border-slate-800'
                  }`}
                  required
                />
                {formFieldErrors.riskRationale && (
                  <span className="text-red-400 text-[11px] mt-0.5 block">
                    {formFieldErrors.riskRationale}
                  </span>
                )}
              </div>

              <div>
                <label htmlFor="patrol-approved-by-input" className="block font-bold text-slate-200 mb-1">
                  Authorizing Officer *
                </label>
                <input
                  id="patrol-approved-by-input"
                  type="text"
                  placeholder="e.g. Duty Officer (Command Desk)"
                  value={formData.approvedBy}
                  onChange={(e) => setFormData({ ...formData, approvedBy: e.target.value })}
                  className={`w-full bg-slate-950 border rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 ${
                    formFieldErrors.approvedBy ? 'border-red-500' : 'border-slate-800'
                  }`}
                  required
                />
                {formFieldErrors.approvedBy && (
                  <span className="text-red-400 text-[11px] mt-0.5 block">
                    {formFieldErrors.approvedBy}
                  </span>
                )}
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleClosePlanModal}
                  className="px-4 py-2 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition disabled:opacity-60"
                >
                  {isSubmitting
                    ? 'Saving to Database...'
                    : editingPatrol
                    ? 'Save Patrol Changes'
                    : 'Schedule Patrol Operation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DELETE CONFIRMATION DIALOG */}
      {patrolPendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="patrol-delete-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs"
        >
          <div className="bg-slate-900 border border-red-900/60 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="bg-slate-950 border-b border-slate-800 px-5 py-4 flex items-center justify-between">
              <div>
                <span className="text-red-400 font-mono text-[11px] uppercase font-bold">
                  Confirm Deletion
                </span>
                <h3 id="patrol-delete-dialog-title" className="text-sm font-bold text-white mt-0.5">
                  Delete Patrol Operation?
                </h3>
              </div>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setPatrolPendingDelete(null)}
                aria-label="Cancel patrol deletion"
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs text-slate-300">
              {deleteError && (
                <div
                  role="alert"
                  className="bg-red-950/80 border border-red-700/70 text-red-200 px-3 py-2 rounded-lg flex items-center gap-2 font-semibold"
                >
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{deleteError}</span>
                </div>
              )}

              <p className="text-slate-300 leading-relaxed">
                This will permanently remove the following patrol operation from the PostgreSQL/PostGIS database:
              </p>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1">
                <div className="font-mono text-emerald-300 font-bold">
                  {patrolPendingDelete.patrolCode}
                </div>
                <div className="font-bold text-white">{patrolPendingDelete.teamName}</div>
                <div className="text-slate-400">
                  {patrolPendingDelete.sector} • {patrolPendingDelete.targetArea}
                </div>
                <div className="text-slate-400 font-mono">
                  Lead: {patrolPendingDelete.leadOfficer}
                </div>
              </div>
            </div>

            <div className="bg-slate-950 border-t border-slate-800 px-5 py-3 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setPatrolPendingDelete(null)}
                className="px-4 py-1.5 border border-slate-700 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDeletePatrol}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold transition disabled:opacity-60"
              >
                {isDeleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
