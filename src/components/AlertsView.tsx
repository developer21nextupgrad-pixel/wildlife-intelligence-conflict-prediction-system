import React, { useState } from 'react';
import {
  AlertNotification,
  IncidentSeverity,
  SpeciesType,
} from '../types';
import { AlertUpsertInput } from '../utils/apiMappers';
import { validateAlertInput } from '../utils/wicpsFilters';
import {
  Flame,
  CheckCircle2,
  Clock,
  MapPin,
  Volume2,
  VolumeX,
  Filter,
  Check,
  AlertCircle,
  Plus,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { formatCoordinates } from '../utils/conflictCalculations';

const DUTY_OPERATOR_NAME = 'Duty Officer (Command Desk)';

const SPECIES_OPTIONS: SpeciesType[] = [
  'Asian Elephant',
  'Bengal Tiger',
  'Indian Leopard',
  'Sloth Bear',
  'Wild Boar',
  'Gaur',
];

const RESPONSE_STATUS_OPTIONS: AlertNotification['responseStatus'][] = [
  'Pending Dispatch',
  'RRT En Route',
  'On Scene',
  'Area Cleared',
  'False Alarm',
];

interface AlertFormState {
  title: string;
  message: string;
  severity: IncidentSeverity;
  species: SpeciesType;
  affectedVillage: string;
  district: string;
  latitude: string;
  longitude: string;
  triggeredAt: string;
  assignedOfficer: string;
  responseStatus: AlertNotification['responseStatus'];
}

function toDatetimeLocalValue(isoOrUndefined?: string): string {
  const date = isoOrUndefined ? new Date(isoOrUndefined) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const tzOffsetMs = safe.getTimezoneOffset() * 60000;
  return new Date(safe.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

function fromDatetimeLocalValue(localValue: string): string {
  if (!localValue.trim()) {
    return new Date().toISOString();
  }
  const parsed = new Date(localValue);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function buildDefaultCreateForm(): AlertFormState {
  return {
    title: '',
    message: '',
    severity: 'High',
    species: 'Asian Elephant',
    affectedVillage: '',
    district: 'Bandipur Division',
    latitude: '11.6624',
    longitude: '76.6189',
    triggeredAt: toDatetimeLocalValue(),
    assignedOfficer: '',
    responseStatus: 'Pending Dispatch',
  };
}

function buildEditForm(alert: AlertNotification): AlertFormState {
  return {
    title: alert.title,
    message: alert.message,
    severity: alert.severity,
    species: alert.species,
    affectedVillage: alert.affectedVillage,
    district: alert.district || 'Bandipur Division',
    latitude: String(alert.coordinates[0]),
    longitude: String(alert.coordinates[1]),
    triggeredAt: toDatetimeLocalValue(alert.triggeredAt || alert.createdAt),
    assignedOfficer: alert.assignedOfficer || '',
    responseStatus: alert.responseStatus,
  };
}

interface AlertsViewProps {
  alerts: AlertNotification[];
  onCreateAlert: (data: AlertUpsertInput) => Promise<void>;
  onUpdateAlert: (id: string, data: Partial<AlertUpsertInput>) => Promise<void>;
  onDeleteAlert: (id: string) => Promise<void>;
  onAcknowledge: (id: string, officerName: string) => Promise<void>;
  onUpdateResponseStatus: (
    id: string,
    status: AlertNotification['responseStatus'],
    assignedOfficer?: string
  ) => Promise<void>;
  isApiLoading?: boolean;
  apiError?: string | null;
  onRetrySync?: () => void;
}

export const AlertsView: React.FC<AlertsViewProps> = ({
  alerts,
  onCreateAlert,
  onUpdateAlert,
  onDeleteAlert,
  onAcknowledge,
  onUpdateResponseStatus,
  isApiLoading = false,
  apiError = null,
  onRetrySync,
}) => {
  const [filterSeverity, setFilterSeverity] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [isMuted, setIsMuted] = useState(false);
  const [selectedAlertForDispatch, setSelectedAlertForDispatch] =
    useState<AlertNotification | null>(null);
  const [assignedOfficerInput, setAssignedOfficerInput] = useState('');
  const [responseStatusInput, setResponseStatusInput] =
    useState<AlertNotification['responseStatus']>('RRT En Route');
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isSavingDispatch, setIsSavingDispatch] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  // Create / Edit Alert modal state
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingAlert, setEditingAlert] = useState<AlertNotification | null>(null);
  const [formState, setFormState] = useState<AlertFormState>(buildDefaultCreateForm);
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string>>({});
  const [formSubmitError, setFormSubmitError] = useState<string | null>(null);
  const [isSubmittingForm, setIsSubmittingForm] = useState(false);

  // Delete confirmation modal state
  const [alertPendingDelete, setAlertPendingDelete] = useState<AlertNotification | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletingAlert, setIsDeletingAlert] = useState(false);

  const filtered = alerts.filter((a) => {
    if (filterSeverity !== 'All' && a.severity !== filterSeverity) return false;
    if (filterStatus === 'Unacknowledged' && a.acknowledged) return false;
    if (filterStatus === 'Acknowledged' && !a.acknowledged) return false;
    return true;
  });

  const showSuccessBanner = (message: string) => {
    setActionSuccess(message);
    setTimeout(() => {
      setActionSuccess((current) => (current === message ? null : current));
    }, 4500);
  };

  const handleOpenCreateModal = () => {
    setEditingAlert(null);
    setFormState(buildDefaultCreateForm());
    setFormFieldErrors({});
    setFormSubmitError(null);
    setIsFormModalOpen(true);
  };

  const handleOpenEditModal = (alert: AlertNotification) => {
    setEditingAlert(alert);
    setFormState(buildEditForm(alert));
    setFormFieldErrors({});
    setFormSubmitError(null);
    setIsFormModalOpen(true);
  };

  const handleCloseFormModal = () => {
    if (isSubmittingForm) return;
    setIsFormModalOpen(false);
    setEditingAlert(null);
    setFormFieldErrors({});
    setFormSubmitError(null);
  };

  const handleSubmitAlertForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingForm) return;

    const latNum = Number.parseFloat(formState.latitude);
    const lngNum = Number.parseFloat(formState.longitude);

    const validationErrors = validateAlertInput({
      title: formState.title,
      message: formState.message,
      affectedVillage: formState.affectedVillage,
      district: formState.district,
      latitude: latNum,
      longitude: lngNum,
    });

    if (Object.keys(validationErrors).length > 0) {
      setFormFieldErrors(validationErrors);
      return;
    }

    setFormFieldErrors({});
    setFormSubmitError(null);
    setIsSubmittingForm(true);

    const payload: AlertUpsertInput = {
      title: formState.title.trim(),
      message: formState.message.trim(),
      severity: formState.severity,
      species: formState.species,
      affectedVillage: formState.affectedVillage.trim(),
      district: formState.district.trim(),
      latitude: latNum,
      longitude: lngNum,
      triggeredAt: fromDatetimeLocalValue(formState.triggeredAt),
      assignedOfficer: formState.assignedOfficer.trim() || undefined,
      responseStatus: formState.responseStatus,
    };

    try {
      if (editingAlert) {
        await onUpdateAlert(editingAlert.id, payload);
        setIsFormModalOpen(false);
        setEditingAlert(null);
        showSuccessBanner(`Alert "${payload.title}" updated in PostgreSQL database.`);
      } else {
        await onCreateAlert(payload);
        setIsFormModalOpen(false);
        showSuccessBanner(`Alert "${payload.title}" created and persisted to PostgreSQL database.`);
      }
    } catch (err) {
      setFormSubmitError(
        err instanceof Error
          ? err.message
          : 'Failed to save alert to FastAPI backend. Your input has been preserved.'
      );
    } finally {
      setIsSubmittingForm(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!alertPendingDelete || isDeletingAlert) return;
    setIsDeletingAlert(true);
    setDeleteError(null);
    const targetTitle = alertPendingDelete.title;
    try {
      await onDeleteAlert(alertPendingDelete.id);
      setAlertPendingDelete(null);
      showSuccessBanner(`Alert "${targetTitle}" permanently deleted.`);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete alert from backend database.'
      );
    } finally {
      setIsDeletingAlert(false);
    }
  };

  const handleOpenDispatchModal = (alert: AlertNotification) => {
    setDispatchError(null);
    setSelectedAlertForDispatch(alert);
    setAssignedOfficerInput(alert.assignedOfficer || 'RFO Suresh Kumar');
    setResponseStatusInput(alert.responseStatus);
  };

  const handleAcknowledgeClick = async (alertId: string) => {
    setAcknowledgingId(alertId);
    setActionError(null);
    try {
      await onAcknowledge(alertId, DUTY_OPERATOR_NAME);
      showSuccessBanner('Alert acknowledged in FastAPI database.');
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to acknowledge alert in backend database.'
      );
    } finally {
      setAcknowledgingId(null);
    }
  };

  const handleSaveDispatch = async () => {
    if (!selectedAlertForDispatch || isSavingDispatch) return;
    setIsSavingDispatch(true);
    setDispatchError(null);
    try {
      await onUpdateResponseStatus(
        selectedAlertForDispatch.id,
        responseStatusInput,
        assignedOfficerInput
      );
      setSelectedAlertForDispatch(null);
      showSuccessBanner('Patrol dispatch status updated in database.');
    } catch (err) {
      setDispatchError(
        err instanceof Error
          ? err.message
          : 'Failed to update triage status. Your input has been preserved.'
      );
    } finally {
      setIsSavingDispatch(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-red-400 font-bold uppercase tracking-wider">
            <span>Perimeter Defense & Triage</span>
            <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
            <span>PostgreSQL + PostGIS Alert Desk</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            Wildlife Risk Alerts & Incident Notifications
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Create, edit, acknowledge, dispatch, and manage conflict alerts persisted to FastAPI + PostgreSQL/PostGIS.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsMuted(!isMuted)}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs sm:text-sm font-semibold px-3 py-2 rounded-lg border border-slate-700 shadow-xs transition"
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4 text-slate-400" />
            ) : (
              <Volume2 className="w-4 h-4 text-amber-400" />
            )}
            <span>{isMuted ? 'UI Alert Indicator Muted' : 'UI Alert Indicator On'}</span>
          </button>

          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-bold px-4 py-2 rounded-lg border border-emerald-400/40 shadow-sm transition active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Create Alert</span>
          </button>
        </div>
      </div>

      {actionSuccess && (
        <div
          role="status"
          className="bg-emerald-950/80 border border-emerald-700/70 text-emerald-200 px-4 py-3 rounded-xl flex items-center justify-between gap-2 text-xs font-semibold"
        >
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionSuccess(null)}
            className="text-emerald-300 hover:text-white text-xs font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="bg-red-950/80 border border-red-700/70 text-red-200 px-4 py-3 rounded-xl flex items-center justify-between gap-2 text-xs font-semibold"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-red-300 hover:text-white text-xs font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 font-semibold text-slate-300">
          <Filter className="w-4 h-4 text-red-400" />
          <span>Filter Risk Alerts:</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter alerts by severity"
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 font-medium focus:ring-1 focus:ring-red-500 focus:outline-hidden"
          >
            <option value="All">All Severities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Moderate">Moderate</option>
          </select>

          <select
            aria-label="Filter alerts by acknowledgment status"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 font-medium focus:ring-1 focus:ring-red-500 focus:outline-hidden"
          >
            <option value="All">All Acknowledgment Status</option>
            <option value="Unacknowledged">Action Required (Pending)</option>
            <option value="Acknowledged">Acknowledged / In Progress</option>
          </select>
        </div>
      </div>

      {/* Alerts Feed */}
      <div className="space-y-3.5">
        {isApiLoading && alerts.length === 0 ? (
          <div className="bg-slate-900 p-12 text-center rounded-2xl border border-slate-800 text-slate-300 text-xs">
            Loading conflict alerts from FastAPI + PostGIS...
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-slate-900 p-12 text-center rounded-2xl border border-slate-800 text-slate-400">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
            <div className="font-bold text-white">
              {apiError ? 'Alerts unavailable (Backend offline)' : 'All alerts clear'}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {apiError
                ? 'Ensure FastAPI + PostgreSQL backend is running and click Retry Backend Sync.'
                : 'No matching conflict alerts found in this filter view.'}
            </div>
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
          filtered.map((alert) => (
            <div
              key={alert.id}
              className={`p-5 rounded-2xl border shadow-xs transition ${
                !alert.acknowledged && alert.severity === 'Critical'
                  ? 'bg-red-950/30 border-red-800/80'
                  : !alert.acknowledged
                  ? 'bg-amber-950/25 border-amber-800/70'
                  : 'bg-slate-900 border-slate-800'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="space-y-1.5 max-w-3xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded tracking-wider flex items-center gap-1 ${
                        alert.severity === 'Critical'
                          ? 'bg-red-600 text-white'
                          : alert.severity === 'High'
                          ? 'bg-amber-600 text-white'
                          : alert.severity === 'Low'
                          ? 'bg-slate-600 text-white'
                          : 'bg-yellow-500 text-slate-950'
                      }`}
                    >
                      {alert.severity === 'Critical' && <Flame className="w-3 h-3" />}
                      {alert.severity} Risk
                    </span>

                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                        alert.isDemo
                          ? 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                          : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                      }`}
                    >
                      {alert.isDemo ? 'DEMO SEED' : 'OPERATIONAL DB'}
                    </span>

                    <span className="font-bold text-white text-xs sm:text-sm">
                      {alert.title}
                    </span>

                    <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {alert.alertTime}
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                    {alert.message}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 pt-1">
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-slate-500" />
                      <span>
                        Village: <strong className="text-slate-200">{alert.affectedVillage}</strong>
                        {alert.district ? ` (${alert.district})` : ''}
                      </span>
                    </div>

                    <div className="text-slate-400">
                      Species: <strong className="text-slate-200">{alert.species}</strong>
                    </div>

                    <div className="font-mono text-[11px] text-slate-400">
                      {formatCoordinates(alert.coordinates[0], alert.coordinates[1])}
                    </div>

                    <div>
                      <span>
                        Assigned Officer:{' '}
                        <strong className="text-emerald-400">
                          {alert.assignedOfficer || 'Unassigned'}
                        </strong>
                      </span>
                    </div>

                    <div>
                      <span>
                        Response Status:{' '}
                        <strong className="text-sky-300 font-mono bg-sky-950 px-1.5 py-0.5 rounded border border-sky-800/60">
                          {alert.responseStatus}
                        </strong>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 shrink-0">
                  {!alert.acknowledged ? (
                    <button
                      type="button"
                      disabled={acknowledgingId === alert.id}
                      onClick={() => handleAcknowledgeClick(alert.id)}
                      className="bg-red-600 hover:bg-red-500 text-white font-bold text-xs px-3.5 py-2 rounded-lg shadow-sm transition flex items-center gap-1.5 disabled:opacity-60"
                    >
                      <Check className="w-4 h-4" />
                      <span>
                        {acknowledgingId === alert.id ? 'Saving...' : 'Acknowledge Alert'}
                      </span>
                    </button>
                  ) : (
                    <div className="flex flex-col items-end gap-0.5">
                      <div className="flex items-center gap-1 text-emerald-300 text-xs font-bold bg-emerald-950 px-2.5 py-1 rounded-md border border-emerald-800/60">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Acknowledged</span>
                      </div>
                      {alert.acknowledgedBy && (
                        <span className="text-[10px] text-slate-400 font-mono">
                          By: {alert.acknowledgedBy}
                        </span>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => handleOpenDispatchModal(alert)}
                    className="bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-700 font-semibold text-xs px-3 py-1.5 rounded-lg transition"
                  >
                    Update Patrol Status
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(alert)}
                      aria-label={`Edit alert ${alert.title}`}
                      className="flex items-center gap-1 bg-slate-950 hover:bg-slate-800 text-sky-300 border border-slate-700 font-semibold text-xs px-2.5 py-1.5 rounded-lg transition"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setAlertPendingDelete(alert);
                      }}
                      aria-label={`Delete alert ${alert.title}`}
                      className="flex items-center gap-1 bg-slate-950 hover:bg-red-950/70 text-red-300 border border-red-900/60 font-semibold text-xs px-2.5 py-1.5 rounded-lg transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* MODAL: CREATE / EDIT ALERT */}
      {isFormModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="alert-form-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs overflow-y-auto"
        >
          <div className="bg-slate-900 rounded-2xl shadow-2xl border border-slate-800 w-full max-w-2xl p-6 space-y-4 my-8 animate-in fade-in">
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-xs font-mono font-bold text-emerald-400 uppercase">
                  {editingAlert
                    ? 'Modify Existing Risk Alert • FastAPI + PostGIS'
                    : 'Broadcast New Perimeter Risk Alert • FastAPI + PostGIS'}
                </span>
                <h3 id="alert-form-modal-title" className="text-base sm:text-lg font-bold text-white mt-0.5">
                  {editingAlert ? 'Edit Wildlife Risk Alert' : 'Create Wildlife Risk Alert'}
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseFormModal}
                disabled={isSubmittingForm}
                aria-label="Close alert modal"
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formSubmitError && (
              <div
                role="alert"
                className="bg-red-950/80 border border-red-700/70 text-red-200 px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{formSubmitError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitAlertForm} className="space-y-4 text-xs text-slate-300">
              <div>
                <label htmlFor="alert-title-input" className="block font-bold text-slate-200 mb-1">
                  Alert Title <span className="text-red-400">*</span>
                </label>
                <input
                  id="alert-title-input"
                  type="text"
                  value={formState.title}
                  onChange={(e) => setFormState({ ...formState, title: e.target.value })}
                  placeholder="e.g. CRITICAL: Tusker Herd Approaching Kadambur Solar Perimeter"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                />
                {formFieldErrors.title && (
                  <p className="text-red-400 text-[11px] mt-1">{formFieldErrors.title}</p>
                )}
              </div>

              <div>
                <label htmlFor="alert-message-input" className="block font-bold text-slate-200 mb-1">
                  Message / Description <span className="text-red-400">*</span>
                </label>
                <textarea
                  id="alert-message-input"
                  rows={3}
                  value={formState.message}
                  onChange={(e) => setFormState({ ...formState, message: e.target.value })}
                  placeholder="Describe wildlife movement, proximity to settlements, and immediate preventive guidance..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                />
                {formFieldErrors.message && (
                  <p className="text-red-400 text-[11px] mt-1">{formFieldErrors.message}</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="alert-severity-select" className="block font-bold text-slate-200 mb-1">
                    Severity <span className="text-red-400">*</span>
                  </label>
                  <select
                    id="alert-severity-select"
                    value={formState.severity}
                    onChange={(e) =>
                      setFormState({ ...formState, severity: e.target.value as IncidentSeverity })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  >
                    <option value="Critical">Critical</option>
                    <option value="High">High</option>
                    <option value="Moderate">Moderate</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="alert-species-select" className="block font-bold text-slate-200 mb-1">
                    Species
                  </label>
                  <select
                    id="alert-species-select"
                    value={formState.species}
                    onChange={(e) =>
                      setFormState({ ...formState, species: e.target.value as SpeciesType })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  >
                    {SPECIES_OPTIONS.map((sp) => (
                      <option key={sp} value={sp}>
                        {sp}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="alert-village-input" className="block font-bold text-slate-200 mb-1">
                    Affected Village <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="alert-village-input"
                    type="text"
                    value={formState.affectedVillage}
                    onChange={(e) => setFormState({ ...formState, affectedVillage: e.target.value })}
                    placeholder="e.g. Kadambur Fringe"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  />
                  {formFieldErrors.affectedVillage && (
                    <p className="text-red-400 text-[11px] mt-1">{formFieldErrors.affectedVillage}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="alert-district-input" className="block font-bold text-slate-200 mb-1">
                    District / Division <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="alert-district-input"
                    type="text"
                    value={formState.district}
                    onChange={(e) => setFormState({ ...formState, district: e.target.value })}
                    placeholder="e.g. Bandipur Division"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  />
                  {formFieldErrors.district && (
                    <p className="text-red-400 text-[11px] mt-1">{formFieldErrors.district}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="alert-lat-input" className="block font-bold text-slate-200 mb-1">
                    Latitude <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="alert-lat-input"
                    type="number"
                    step="0.0001"
                    value={formState.latitude}
                    onChange={(e) => setFormState({ ...formState, latitude: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 font-mono text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  />
                  {formFieldErrors.latitude && (
                    <p className="text-red-400 text-[11px] mt-1">{formFieldErrors.latitude}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="alert-lng-input" className="block font-bold text-slate-200 mb-1">
                    Longitude <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="alert-lng-input"
                    type="number"
                    step="0.0001"
                    value={formState.longitude}
                    onChange={(e) => setFormState({ ...formState, longitude: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 font-mono text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  />
                  {formFieldErrors.longitude && (
                    <p className="text-red-400 text-[11px] mt-1">{formFieldErrors.longitude}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="alert-triggered-input" className="block font-bold text-slate-200 mb-1">
                    Triggered At
                  </label>
                  <input
                    id="alert-triggered-input"
                    type="datetime-local"
                    value={formState.triggeredAt}
                    onChange={(e) => setFormState({ ...formState, triggeredAt: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="alert-officer-input" className="block font-bold text-slate-200 mb-1">
                    Assigned Officer
                  </label>
                  <input
                    id="alert-officer-input"
                    type="text"
                    value={formState.assignedOfficer}
                    onChange={(e) => setFormState({ ...formState, assignedOfficer: e.target.value })}
                    placeholder="e.g. RFO Suresh Kumar"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label htmlFor="alert-status-select" className="block font-bold text-slate-200 mb-1">
                    Response Status
                  </label>
                  <select
                    id="alert-status-select"
                    value={formState.responseStatus}
                    onChange={(e) =>
                      setFormState({
                        ...formState,
                        responseStatus: e.target.value as AlertNotification['responseStatus'],
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  >
                    {RESPONSE_STATUS_OPTIONS.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  disabled={isSubmittingForm}
                  onClick={handleCloseFormModal}
                  className="px-4 py-2 border border-slate-700 rounded-lg text-slate-300 font-semibold text-xs hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingForm}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition shadow-sm disabled:opacity-60"
                >
                  {isSubmittingForm
                    ? editingAlert
                      ? 'Saving Changes...'
                      : 'Creating Alert...'
                    : editingAlert
                    ? 'Save Alert Changes'
                    : 'Publish Alert'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DELETE ALERT CONFIRMATION */}
      {alertPendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-alert-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs"
        >
          <div className="bg-slate-900 rounded-2xl shadow-2xl border border-red-800/70 w-full max-w-md p-6 space-y-4 animate-in fade-in">
            <div className="border-b border-slate-800 pb-3">
              <span className="text-xs font-mono font-bold text-red-400 uppercase">
                Permanent Database Action
              </span>
              <h3 id="delete-alert-dialog-title" className="text-base font-bold text-white mt-1">
                Confirm Alert Deletion
              </h3>
            </div>

            {deleteError && (
              <div
                role="alert"
                className="bg-red-950/80 border border-red-700/70 text-red-200 px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="text-xs text-slate-300 space-y-2">
              <p>
                Are you sure you want to permanently delete this wildlife risk alert from PostgreSQL? This action cannot be undone.
              </p>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1">
                <div className="font-bold text-white">{alertPendingDelete.title}</div>
                <div className="text-slate-400">
                  {alertPendingDelete.affectedVillage} • {alertPendingDelete.species} • {alertPendingDelete.severity} Risk
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={isDeletingAlert}
                onClick={() => setAlertPendingDelete(null)}
                className="px-4 py-2 border border-slate-700 rounded-lg text-slate-300 font-semibold text-xs hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingAlert}
                onClick={handleConfirmDelete}
                className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold transition shadow-sm disabled:opacity-60"
              >
                {isDeletingAlert ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: UPDATE PATROL DISPATCH STATUS */}
      {selectedAlertForDispatch && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dispatch-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs"
        >
          <div className="bg-slate-900 rounded-2xl shadow-2xl border border-slate-800 w-full max-w-md p-6 space-y-4 animate-in fade-in">
            <div className="border-b border-slate-800 pb-3">
              <span className="text-xs font-mono font-bold text-red-400 uppercase">
                Triage Status Update • PostgreSQL DB
              </span>
              <h3 id="dispatch-modal-title" className="text-base font-bold text-white mt-1">
                {selectedAlertForDispatch.affectedVillage} ({selectedAlertForDispatch.species})
              </h3>
            </div>

            {dispatchError && (
              <div
                role="alert"
                className="bg-red-950/80 border border-red-700/70 text-red-200 px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{dispatchError}</span>
              </div>
            )}

            <div className="space-y-3 text-xs text-slate-300">
              <div>
                <label className="block font-bold text-slate-200 mb-1">
                  Operational Response Status
                </label>
                <select
                  value={responseStatusInput}
                  onChange={(e) =>
                    setResponseStatusInput(
                      e.target.value as AlertNotification['responseStatus']
                    )
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-medium text-slate-100 focus:ring-1 focus:ring-red-500 focus:outline-hidden"
                >
                  {RESPONSE_STATUS_OPTIONS.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-200 mb-1">
                  Assigned Officer / Unit
                </label>
                <input
                  type="text"
                  value={assignedOfficerInput}
                  onChange={(e) => setAssignedOfficerInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-100 focus:ring-1 focus:ring-red-500 focus:outline-hidden"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={isSavingDispatch}
                onClick={() => setSelectedAlertForDispatch(null)}
                className="px-4 py-2 border border-slate-700 rounded-lg text-slate-300 font-semibold text-xs hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingDispatch}
                onClick={handleSaveDispatch}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition shadow-sm disabled:opacity-60"
              >
                {isSavingDispatch ? 'Saving...' : 'Save Status Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
