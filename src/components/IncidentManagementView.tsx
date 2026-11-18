import React, { useEffect, useState } from 'react';
import {
  Incident,
  SpeciesType,
  IncidentSeverity,
  IncidentType,
  IncidentStatus,
} from '../types';
import {
  Plus,
  Search,
  Download,
  FileSpreadsheet,
  X,
  Check,
  AlertCircle,
  Camera,
  RotateCcw,
} from 'lucide-react';
import { formatCoordinates } from '../utils/conflictCalculations';
import { validateIncidentInput } from '../utils/wicpsFilters';

interface IncidentManagementViewProps {
  incidents: Incident[];
  totalUnfilteredCount?: number;
  selectedDistrict?: string;
  dateRange?: string;
  onResetGlobalFilters?: () => void;
  globalSearchQuery?: string;
  onGlobalSearchChange?: (query: string) => void;
  onAddIncident: (incident: Omit<Incident, 'id' | 'incidentCode'>) => Promise<void>;
  onUpdateStatus: (id: string, status: IncidentStatus, officer?: string) => Promise<void>;
  onDeleteIncident?: (id: string) => Promise<void>;
  isApiLoading?: boolean;
  apiError?: string | null;
  onRetrySync?: () => void;
  isModalOpen: boolean;
  setIsModalOpen: (open: boolean) => void;
}

export const IncidentManagementView: React.FC<IncidentManagementViewProps> = ({
  incidents,
  totalUnfilteredCount,
  selectedDistrict,
  dateRange,
  onResetGlobalFilters,
  globalSearchQuery = '',
  onGlobalSearchChange,
  onAddIncident,
  onUpdateStatus,
  onDeleteIncident,
  isApiLoading = false,
  apiError = null,
  onRetrySync,
  isModalOpen,
  setIsModalOpen,
}) => {
  // Search & Filter States
  const [searchTerm, setSearchTerm] = useState(globalSearchQuery);
  const [filterSpecies, setFilterSpecies] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterSeverity, setFilterSeverity] = useState('All');

  // Sync local search input whenever global search query changes
  useEffect(() => {
    setSearchTerm(globalSearchQuery);
  }, [globalSearchQuery]);

  // Selected incident for detail view
  const [viewIncident, setViewIncident] = useState<Incident | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [docketError, setDocketError] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    species: 'Asian Elephant' as SpeciesType,
    dateTime: new Date().toISOString().slice(0, 16),
    latitude: 11.664,
    longitude: 76.622,
    village: '',
    district: 'Bandipur Division',
    forestRange: 'Hediyala Range (Beat 4)',
    incidentType: 'Crop Depredation' as IncidentType,
    severity: 'High' as IncidentSeverity,
    humanInjury: 'None' as Incident['humanInjury'],
    humanInjuriesCount: 0,
    livestockLossCount: 0,
    cropDamageEstimatedAcres: 0,
    cropType: '',
    description: '',
    imageUrl:
      'https://images.unsplash.com/photo-1557050543-4d5f4e07ef46?auto=format&fit=crop&w=800&q=80',
    status: 'Reported' as IncidentStatus,
    reportedBy: 'Village Forest Committee',
    assignedOfficer: 'RFO Suresh Kumar (QRT-1)',
    actionTaken: '',
  });

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const handleSearchInputChange = (val: string) => {
    setSearchTerm(val);
    onGlobalSearchChange?.(val);
  };

  // Filtered List
  const filtered = incidents.filter((inc) => {
    if (filterSpecies !== 'All' && inc.species !== filterSpecies) return false;
    if (filterStatus !== 'All' && inc.status !== filterStatus) return false;
    if (filterSeverity !== 'All' && inc.severity !== filterSeverity) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      const match =
        `${inc.incidentCode} ${inc.species} ${inc.village} ${inc.forestRange} ${inc.description} ${inc.incidentType}`.toLowerCase();
      if (!match.includes(q)) return false;
    }
    return true;
  });

  const validateForm = () => {
    const errors = validateIncidentInput({
      village: formData.village,
      description: formData.description,
      latitude: formData.latitude,
      longitude: formData.longitude,
      cropDamageEstimatedAcres: formData.cropDamageEstimatedAcres,
    });
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFormError('Please correct the highlighted fields before submitting the incident record.');
      return false;
    }
    setFormError(null);
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      setIsSubmitting(true);
      setFormError(null);
      await onAddIncident(formData);
      setSubmitSuccess(true);
      setTimeout(() => {
        setIsSubmitting(false);
        setSubmitSuccess(false);
        setIsModalOpen(false);
        setFormErrors({});
        setFormError(null);
        setFormData({
          species: 'Asian Elephant',
          dateTime: new Date().toISOString().slice(0, 16),
          latitude: 11.664,
          longitude: 76.622,
          village: '',
          district: 'Bandipur Division',
          forestRange: 'Hediyala Range (Beat 4)',
          incidentType: 'Crop Depredation',
          severity: 'High',
          humanInjury: 'None',
          humanInjuriesCount: 0,
          livestockLossCount: 0,
          cropDamageEstimatedAcres: 0,
          cropType: '',
          description: '',
          imageUrl:
            'https://images.unsplash.com/photo-1557050543-4d5f4e07ef46?auto=format&fit=crop&w=800&q=80',
          status: 'Reported',
          reportedBy: 'Village Forest Committee',
          assignedOfficer: 'RFO Suresh Kumar (QRT-1)',
          actionTaken: '',
        });
      }, 450);
    } catch (err) {
      setIsSubmitting(false);
      setFormError(
        err instanceof Error
          ? err.message
          : 'Failed to save incident record to backend API. Your form inputs have been preserved.'
      );
    }
  };

  const handleExportCSV = () => {
    const headers = [
      'IncidentCode',
      'Species',
      'DateTime',
      'Latitude',
      'Longitude',
      'Village',
      'Type',
      'Severity',
      'HumanInjury',
      'CropAcres',
      'Status',
    ];
    const rows = filtered.map((i) => [
      i.incidentCode,
      i.species,
      i.dateTime,
      i.latitude,
      i.longitude,
      `"${i.village}"`,
      `"${i.incidentType}"`,
      i.severity,
      i.humanInjury,
      i.cropDamageEstimatedAcres,
      i.status,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `WICPS_Incidents_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isGloballyFiltered =
    totalUnfilteredCount !== undefined && incidents.length < totalUnfilteredCount;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 font-bold uppercase tracking-wider">
            <span>Forest Department Incident Desk</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>Official Register</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            Human-Wildlife Conflict Incident Management
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Log, verify, investigate and track mitigation actions for wildlife incursions and depredations.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs sm:text-sm font-semibold px-3 py-2 rounded-lg border border-slate-700 shadow-xs transition"
          >
            <Download className="w-4 h-4 text-slate-400" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => {
              setFormError(null);
              setFormErrors({});
              setIsModalOpen(true);
            }}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold px-3.5 py-2 rounded-lg shadow-sm transition border border-emerald-400/30"
          >
            <Plus className="w-4 h-4" />
            <span>Record New Incident</span>
          </button>
        </div>
      </div>

      {/* Global filter notice when global division/date filter hides records */}
      {isGloballyFiltered && (
        <div className="bg-slate-900 border border-emerald-800/60 px-4 py-2.5 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-slate-300">
            Showing <strong className="text-white font-mono">{incidents.length}</strong> of{' '}
            <strong className="text-white font-mono">{totalUnfilteredCount}</strong> incidents under active global filter (
            <span className="text-emerald-300">{selectedDistrict}</span> •{' '}
            <span className="font-mono text-slate-200">{dateRange}</span>).
          </span>
          {onResetGlobalFilters && (
            <button
              onClick={onResetGlobalFilters}
              className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-semibold"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Global Filter</span>
            </button>
          )}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            aria-label="Filter incidents search"
            placeholder="Search code, species, village, range, description..."
            value={searchTerm}
            onChange={(e) => handleSearchInputChange(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => handleSearchInputChange('')}
              aria-label="Clear incident search"
              className="absolute right-2.5 top-2 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter incidents by species"
            value={filterSpecies}
            onChange={(e) => setFilterSpecies(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-slate-200 font-medium focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
          >
            <option value="All">All Species</option>
            <option value="Asian Elephant">Asian Elephant</option>
            <option value="Bengal Tiger">Bengal Tiger</option>
            <option value="Indian Leopard">Indian Leopard</option>
            <option value="Sloth Bear">Sloth Bear</option>
            <option value="Wild Boar">Wild Boar</option>
            <option value="Gaur">Gaur</option>
          </select>

          <select
            aria-label="Filter incidents by severity"
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-slate-200 font-medium focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
          >
            <option value="All">All Severity</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Moderate">Moderate</option>
            <option value="Low">Low</option>
          </select>

          <select
            aria-label="Filter incidents by status"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-slate-200 font-medium focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
          >
            <option value="All">All Statuses</option>
            <option value="Reported">Reported</option>
            <option value="Verified">Verified</option>
            <option value="Patrol Dispatched">Patrol Dispatched</option>
            <option value="Under Control">Under Control</option>
            <option value="Resolved">Resolved</option>
            <option value="Closed">Closed</option>
          </select>
        </div>
      </div>

      {/* Incidents Table */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px] font-mono">
              <tr>
                <th className="py-3 px-4">Incident Code</th>
                <th className="py-3 px-4">Species & Type</th>
                <th className="py-3 px-4">Village & Range</th>
                <th className="py-3 px-4">Coordinates</th>
                <th className="py-3 px-4">Impact / Damage</th>
                <th className="py-3 px-4">Severity</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {isApiLoading && incidents.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <p className="font-semibold text-white">Loading incident records from FastAPI + PostGIS...</p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <FileSpreadsheet className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                    <p className="font-semibold text-white">
                      {apiError ? 'Incident records unavailable (Backend offline)' : 'No incidents found'}
                    </p>
                    <p className="text-slate-400 text-[11px] mt-0.5">
                      {apiError
                        ? 'Ensure the FastAPI + PostgreSQL backend is running and click Retry Backend Sync.'
                        : 'Try adjusting your search query, table filters, or global division/date filter.'}
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
                  </td>
                </tr>
              ) : (
                filtered.map((incident) => (
                  <tr key={incident.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-mono font-bold text-white">
                      <div className="flex flex-col gap-1">
                        <span>{incident.incidentCode}</span>
                        <span
                          className={`inline-block w-fit px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                            incident.isDemo
                              ? 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                              : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                          }`}
                        >
                          {incident.isDemo ? 'DEMO SEED' : 'OPERATIONAL DB'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-white">{incident.species}</div>
                      <div className="text-slate-400 text-[11px]">{incident.incidentType}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-200">{incident.village}</div>
                      <div className="text-slate-400 text-[11px]">{incident.forestRange}</div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-[11px] text-slate-400 whitespace-nowrap">
                      {formatCoordinates(incident.latitude, incident.longitude)}
                    </td>
                    <td className="py-3 px-4">
                      {incident.humanInjury !== 'None' && (
                        <div className="text-red-400 font-semibold flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> Injury: {incident.humanInjury}
                        </div>
                      )}
                      {incident.cropDamageEstimatedAcres > 0 && (
                        <div className="text-amber-400 font-mono tabular-nums">
                          Crop: {incident.cropDamageEstimatedAcres} ac
                        </div>
                      )}
                      {incident.livestockLossCount > 0 && (
                        <div className="text-purple-300 font-semibold">
                          Cattle: {incident.livestockLossCount} lost
                        </div>
                      )}
                      {incident.humanInjury === 'None' &&
                        incident.cropDamageEstimatedAcres === 0 &&
                        incident.livestockLossCount === 0 && (
                          <span className="text-slate-500">None reported</span>
                        )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          incident.severity === 'Critical'
                            ? 'bg-red-950 text-red-300 border border-red-800/60'
                            : incident.severity === 'High'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
                            : incident.severity === 'Moderate'
                            ? 'bg-yellow-950 text-yellow-300 border border-yellow-800/60'
                            : 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                        }`}
                      >
                        {incident.severity}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-200 border border-slate-700">
                        {incident.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => {
                          setDocketError(null);
                          setConfirmDeleteId(null);
                          setViewIncident(incident);
                        }}
                        className="bg-emerald-950 hover:bg-emerald-900 text-emerald-300 font-semibold px-2.5 py-1 rounded border border-emerald-800/60 transition"
                      >
                        View / Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL 1: RECORD NEW INCIDENT FORM */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs overflow-y-auto">
          <div className="bg-slate-900 rounded-2xl shadow-2xl border border-slate-800 w-full max-w-2xl my-8 overflow-hidden animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="bg-slate-950 border-b border-slate-800 text-white px-6 py-4 flex items-center justify-between">
              <div>
                <span className="text-emerald-400 font-mono text-xs uppercase font-bold tracking-wider">
                  Field Logging Desk • Form WICPS-1A
                </span>
                <h3 className="text-lg font-bold">Record Human-Wildlife Incident</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-md transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmit} noValidate className="p-6 space-y-4 text-xs text-slate-300">
              {formError && (
                <div
                  role="alert"
                  className="bg-red-950/80 border border-red-700/70 text-red-200 px-3.5 py-2.5 rounded-lg flex items-center gap-2 text-xs font-semibold"
                >
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Species */}
                <div>
                  <label className="block font-bold text-slate-200 mb-1">Wildlife Species *</label>
                  <select
                    value={formData.species}
                    onChange={(e) =>
                      setFormData({ ...formData, species: e.target.value as SpeciesType })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-medium text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  >
                    <option value="Asian Elephant">Asian Elephant</option>
                    <option value="Bengal Tiger">Bengal Tiger</option>
                    <option value="Indian Leopard">Indian Leopard</option>
                    <option value="Sloth Bear">Sloth Bear</option>
                    <option value="Wild Boar">Wild Boar</option>
                    <option value="Gaur">Gaur</option>
                  </select>
                </div>

                {/* Incident Type */}
                <div>
                  <label className="block font-bold text-slate-200 mb-1">
                    Incident Classification *
                  </label>
                  <select
                    value={formData.incidentType}
                    onChange={(e) =>
                      setFormData({ ...formData, incidentType: e.target.value as IncidentType })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-medium text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  >
                    <option value="Crop Depredation">Crop Depredation</option>
                    <option value="Human Injury / Attack">Human Injury / Attack</option>
                    <option value="Livestock Predation">Livestock Predation</option>
                    <option value="Property / House Damage">Property / House Damage</option>
                    <option value="Village Incursion">Village Incursion</option>
                    <option value="Infrastructure Breach">Infrastructure Breach</option>
                  </select>
                </div>

                {/* Date and Time */}
                <div>
                  <label className="block font-bold text-slate-200 mb-1">
                    Date & Time of Occurrence *
                  </label>
                  <input
                    type="datetime-local"
                    value={formData.dateTime}
                    onChange={(e) => setFormData({ ...formData, dateTime: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                    required
                  />
                </div>

                {/* Severity */}
                <div>
                  <label className="block font-bold text-slate-200 mb-1">
                    Assessed Severity Level *
                  </label>
                  <select
                    value={formData.severity}
                    onChange={(e) =>
                      setFormData({ ...formData, severity: e.target.value as IncidentSeverity })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-medium text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  >
                    <option value="Critical">Critical (Immediate QRT Threat)</option>
                    <option value="High">High (High Damage / Nearby)</option>
                    <option value="Moderate">Moderate (Crop Loss / Perimeter)</option>
                    <option value="Low">Low (Buffer sighting / browse)</option>
                  </select>
                </div>

                {/* Village */}
                <div>
                  <label className="block font-bold text-slate-200 mb-1">
                    Affected Village / Settlement *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Kadambur Fringe, Mangala"
                    value={formData.village}
                    onChange={(e) => setFormData({ ...formData, village: e.target.value })}
                    className={`w-full bg-slate-950 border rounded-lg p-2 text-slate-100 placeholder-slate-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden ${
                      formErrors.village ? 'border-red-500 bg-red-950/30' : 'border-slate-700'
                    }`}
                  />
                  {formErrors.village && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formErrors.village}
                    </span>
                  )}
                </div>

                {/* Forest Range */}
                <div>
                  <label className="block font-bold text-slate-200 mb-1">
                    Forest Range & Beat
                  </label>
                  <select
                    value={formData.forestRange}
                    onChange={(e) => setFormData({ ...formData, forestRange: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-medium text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  >
                    <option value="Hediyala Range (Beat 4)">Hediyala Range (Beat 4)</option>
                    <option value="Gundlupet Buffer">Gundlupet Buffer</option>
                    <option value="Omkar Range">Omkar Range</option>
                    <option value="Maddur Range">Maddur Range</option>
                    <option value="GS Betta Range">GS Betta Range</option>
                  </select>
                </div>

                {/* Latitude & Longitude */}
                <div>
                  <label className="block font-bold text-slate-200 mb-1">
                    Latitude (WGS84) *
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={Number.isNaN(formData.latitude) ? '' : formData.latitude}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        latitude: e.target.value === '' ? Number.NaN : parseFloat(e.target.value),
                      })
                    }
                    className={`w-full bg-slate-950 border rounded-lg p-2 font-mono text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden ${
                      formErrors.latitude ? 'border-red-500' : 'border-slate-700'
                    }`}
                  />
                  {formErrors.latitude && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formErrors.latitude}
                    </span>
                  )}
                </div>

                <div>
                  <label className="block font-bold text-slate-200 mb-1">
                    Longitude (WGS84) *
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={Number.isNaN(formData.longitude) ? '' : formData.longitude}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        longitude: e.target.value === '' ? Number.NaN : parseFloat(e.target.value),
                      })
                    }
                    className={`w-full bg-slate-950 border rounded-lg p-2 font-mono text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden ${
                      formErrors.longitude ? 'border-red-500' : 'border-slate-700'
                    }`}
                  />
                  {formErrors.longitude && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formErrors.longitude}
                    </span>
                  )}
                </div>

                {/* Human Injury */}
                <div>
                  <label className="block font-bold text-slate-200 mb-1">
                    Human Injury Status
                  </label>
                  <select
                    value={formData.humanInjury}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        humanInjury: e.target.value as Incident['humanInjury'],
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-medium text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  >
                    <option value="None">None</option>
                    <option value="Minor">Minor (First aid administered)</option>
                    <option value="Severe">Severe (Hospitalization required)</option>
                    <option value="Fatal">Fatal</option>
                  </select>
                </div>

                {/* Crop Damage */}
                <div>
                  <label className="block font-bold text-slate-200 mb-1">
                    Estimated Crop Loss (Acres)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="e.g. 2.5"
                    value={formData.cropDamageEstimatedAcres}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        cropDamageEstimatedAcres:
                          e.target.value === '' ? 0 : parseFloat(e.target.value),
                      })
                    }
                    className={`w-full bg-slate-950 border rounded-lg p-2 font-mono text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden ${
                      formErrors.cropDamageEstimatedAcres ? 'border-red-500' : 'border-slate-700'
                    }`}
                  />
                  {formErrors.cropDamageEstimatedAcres && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formErrors.cropDamageEstimatedAcres}
                    </span>
                  )}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block font-bold text-slate-200 mb-1">
                  Incident Narrative / Observation Details *
                </label>
                <textarea
                  rows={3}
                  placeholder="Provide precise details: herd dynamics, breach point, actions taken by villagers or range guards..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className={`w-full bg-slate-950 border rounded-lg p-2.5 text-slate-100 placeholder-slate-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden ${
                    formErrors.description ? 'border-red-500 bg-red-950/30' : 'border-slate-700'
                  }`}
                />
                {formErrors.description && (
                  <span className="text-red-400 text-[11px] mt-0.5 block">
                    {formErrors.description}
                  </span>
                )}
              </div>

              {/* Image Upload / URL */}
              <div>
                <label className="block font-bold text-slate-200 mb-1 flex items-center justify-between">
                  <span>Field Photo / Camera Evidence URL</span>
                  <span className="text-[10px] font-normal text-slate-400">
                    Pre-loaded or custom link
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-slate-950 rounded border border-slate-700 text-slate-400">
                    <Camera className="w-4 h-4" />
                  </div>
                  <input
                    type="url"
                    placeholder="https://..."
                    value={formData.imageUrl}
                    onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Status and Officer */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800">
                <div>
                  <label className="block font-bold text-slate-200 mb-1">Initial Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) =>
                      setFormData({ ...formData, status: e.target.value as IncidentStatus })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-medium text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  >
                    <option value="Reported">Reported</option>
                    <option value="Verified">Verified</option>
                    <option value="Patrol Dispatched">Patrol Dispatched</option>
                    <option value="Under Control">Under Control</option>
                    <option value="Resolved">Resolved</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-200 mb-1">
                    Assigned Field Officer
                  </label>
                  <input
                    type="text"
                    value={formData.assignedOfficer}
                    onChange={(e) => setFormData({ ...formData, assignedOfficer: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Form Buttons */}
              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-700 rounded-lg font-semibold text-slate-300 hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold shadow-sm transition flex items-center gap-2"
                >
                  {isSubmitting ? (
                    <span>Registering...</span>
                  ) : submitSuccess ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Registered!</span>
                    </>
                  ) : (
                    <span>Submit Incident Record</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: VIEW / UPDATE INCIDENT DETAIL */}
      {viewIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-slate-900 rounded-2xl shadow-2xl border border-slate-800 w-full max-w-xl overflow-hidden animate-in fade-in">
            <div className="bg-slate-950 border-b border-slate-800 text-white px-6 py-4 flex items-center justify-between">
              <div>
                <span className="text-emerald-400 font-mono text-xs uppercase font-bold tracking-wider">
                  Incident Docket • {viewIncident.incidentCode}
                </span>
                <h3 className="text-lg font-bold">{viewIncident.species} Conflict</h3>
              </div>
              <button
                onClick={() => setViewIncident(null)}
                className="text-slate-400 hover:text-white p-1 rounded-md transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs text-slate-300">
              {viewIncident.imageUrl && (
                <div className="rounded-xl overflow-hidden border border-slate-800">
                  <img
                    src={viewIncident.imageUrl}
                    alt={viewIncident.species}
                    className="w-full h-44 object-cover"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold">
                    Village & Range
                  </span>
                  <div className="font-bold text-white">{viewIncident.village}</div>
                  <div className="text-slate-400">{viewIncident.forestRange}</div>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold">
                    Coordinates
                  </span>
                  <div className="font-mono font-semibold text-slate-200">
                    {formatCoordinates(viewIncident.latitude, viewIncident.longitude)}
                  </div>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold">
                    Reported By
                  </span>
                  <div className="font-semibold text-slate-200">{viewIncident.reportedBy}</div>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold">
                    Current Status
                  </span>
                  <div className="font-bold text-emerald-400">{viewIncident.status}</div>
                </div>
              </div>

              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold">Description</span>
                <p className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-slate-200 mt-1 leading-relaxed">
                  {viewIncident.description}
                </p>
              </div>

              {/* Status Update Quick Buttons */}
              <div className="pt-2 border-t border-slate-800">
                <span className="text-slate-400 font-bold block mb-2">Change Status:</span>
                {docketError && (
                  <div
                    role="alert"
                    className="mb-2.5 bg-red-950/80 border border-red-700/70 text-red-200 px-3 py-2 rounded-lg text-[11px] font-semibold flex items-center gap-2"
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    <span>{docketError}</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      'Reported',
                      'Verified',
                      'Patrol Dispatched',
                      'Under Control',
                      'Resolved',
                      'Closed',
                    ] as IncidentStatus[]
                  ).map((status) => (
                    <button
                      key={status}
                      disabled={isUpdatingStatus}
                      onClick={async () => {
                        setIsUpdatingStatus(true);
                        setDocketError(null);
                        try {
                          await onUpdateStatus(viewIncident.id, status);
                          setViewIncident({ ...viewIncident, status });
                        } catch (err) {
                          setDocketError(
                            err instanceof Error
                              ? err.message
                              : 'Failed to update incident status.'
                          );
                        } finally {
                          setIsUpdatingStatus(false);
                        }
                      }}
                      className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition ${
                        viewIncident.status === status
                          ? 'bg-emerald-600 text-white border-emerald-500'
                          : 'bg-slate-950 text-slate-300 border-slate-700 hover:bg-slate-800'
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-2">
              {onDeleteIncident ? (
                confirmDeleteId === viewIncident.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-red-300 font-semibold">
                      Delete from database?
                    </span>
                    <button
                      type="button"
                      disabled={isUpdatingStatus}
                      onClick={async () => {
                        setIsUpdatingStatus(true);
                        setDocketError(null);
                        try {
                          await onDeleteIncident(viewIncident.id);
                          setConfirmDeleteId(null);
                          setViewIncident(null);
                        } catch (err) {
                          setDocketError(
                            err instanceof Error ? err.message : 'Failed to delete incident.'
                          );
                        } finally {
                          setIsUpdatingStatus(false);
                        }
                      }}
                      className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white font-semibold rounded text-[11px]"
                    >
                      Confirm Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(viewIncident.id)}
                    className="px-3 py-1.5 bg-red-950/70 hover:bg-red-900/70 border border-red-800/60 text-red-300 font-semibold rounded-lg text-xs transition"
                  >
                    Delete Record
                  </button>
                )
              ) : (
                <span />
              )}

              <button
                onClick={() => setViewIncident(null)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-lg text-xs transition"
              >
                Close Docket
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
