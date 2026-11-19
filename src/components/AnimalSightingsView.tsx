import React, { useEffect, useState } from 'react';
import { AnimalSighting, SpeciesType } from '../types';
import {
  Plus,
  Search,
  X,
  Navigation,
  AlertCircle,
  Eye,
  RotateCcw,
  Pencil,
  Check,
  Calendar,
  MapPin,
  ShieldCheck,
  Camera,
  Maximize2,
  Clock,
  User,
  Trash2,
} from 'lucide-react';
import { formatCoordinates } from '../utils/conflictCalculations';
import {
  DIVISION_OPTIONS,
  getBearingForDirection,
  validateSightingInput,
} from '../utils/wicpsFilters';

const SPECIES_OPTIONS: SpeciesType[] = [
  'Asian Elephant',
  'Bengal Tiger',
  'Indian Leopard',
  'Sloth Bear',
  'Wild Boar',
  'Gaur',
];

const FOREST_RANGE_PRESETS = [
  'Hediyala Range',
  'Gundlupet Buffer',
  'Omkar Range',
  'Maddur Range',
  'GS Betta Range',
];

const DIRECTION_OPTIONS: Array<{ value: AnimalSighting['movementDirection']; label: string }> = [
  { value: 'North', label: 'North (0°)' },
  { value: 'North-East', label: 'North-East (45°)' },
  { value: 'East', label: 'East (90°)' },
  { value: 'South-East', label: 'South-East (135°)' },
  { value: 'South', label: 'South (180°)' },
  { value: 'South-West', label: 'South-West (225°)' },
  { value: 'West', label: 'West (270°)' },
  { value: 'North-West', label: 'North-West (315°)' },
  { value: 'Stationary', label: 'Stationary (0°)' },
];

const BEHAVIOR_OPTIONS: AnimalSighting['behavior'][] = [
  'Moving towards village',
  'Foraging',
  'Near waterhole',
  'Aggressive / Agitated',
  'Resting',
];

interface SightingFormState {
  species: SpeciesType | '';
  timestamp: string;
  latitude: string;
  longitude: string;
  locationName: string;
  district: string;
  forestRange: string;
  herdSize: string;
  movementDirection: AnimalSighting['movementDirection'] | '';
  bearingDegrees: number | null;
  behavior: AnimalSighting['behavior'] | '';
  juvenilesPresent: boolean;
  observationDetails: string;
  observerName: string;
  observerRole: string;
  verifiedByForestGuard: boolean;
  photoUrl: string;
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

function formatReadableTimestamp(value?: string): string {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function buildDefaultCreateForm(): SightingFormState {
  return {
    species: '',
    timestamp: '',
    latitude: '',
    longitude: '',
    locationName: '',
    district: '',
    forestRange: '',
    herdSize: '',
    movementDirection: '',
    bearingDegrees: null,
    behavior: '',
    juvenilesPresent: false,
    observationDetails: '',
    observerName: '',
    observerRole: '',
    verifiedByForestGuard: false,
    photoUrl: '',
  };
}

function buildEditForm(sighting: AnimalSighting): SightingFormState {
  return {
    species: sighting.species,
    timestamp: toDatetimeLocalValue(sighting.timestamp),
    latitude: String(sighting.latitude),
    longitude: String(sighting.longitude),
    locationName: sighting.locationName,
    district: sighting.district || 'Bandipur Division',
    forestRange: sighting.forestRange || 'Hediyala Range',
    herdSize: String(sighting.herdSize),
    movementDirection: sighting.movementDirection,
    bearingDegrees: sighting.bearingDegrees,
    behavior: sighting.behavior,
    juvenilesPresent: sighting.juvenilesPresent,
    observationDetails: sighting.observationDetails,
    observerName: sighting.observerName,
    observerRole: sighting.observerRole,
    verifiedByForestGuard: sighting.verifiedByForestGuard,
    photoUrl: sighting.photoUrl || '',
  };
}

interface AnimalSightingsViewProps {
  sightings: AnimalSighting[];
  totalUnfilteredCount?: number;
  selectedDistrict?: string;
  dateRange?: string;
  onResetGlobalFilters?: () => void;
  onAddSighting: (sighting: Omit<AnimalSighting, 'id' | 'sightingCode'>) => Promise<void>;
  onUpdateSighting?: (
    id: string,
    sighting: Partial<Omit<AnimalSighting, 'id' | 'sightingCode'>>
  ) => Promise<void>;
  onDeleteSighting?: (id: string) => Promise<void>;
  isApiLoading?: boolean;
  apiError?: string | null;
  onRetrySync?: () => void;
}

export const AnimalSightingsView: React.FC<AnimalSightingsViewProps> = ({
  sightings,
  totalUnfilteredCount,
  selectedDistrict,
  dateRange,
  onResetGlobalFilters,
  onAddSighting,
  onUpdateSighting,
  onDeleteSighting,
  isApiLoading = false,
  apiError = null,
  onRetrySync,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSpecies, setFilterSpecies] = useState('All');

  // Create / Edit Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSighting, setEditingSighting] = useState<AnimalSighting | null>(null);
  const [formData, setFormData] = useState<SightingFormState>(buildDefaultCreateForm);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Delete confirmation modal state
  const [sightingPendingDelete, setSightingPendingDelete] = useState<AnimalSighting | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletingSighting, setIsDeletingSighting] = useState(false);

  // View Details & Lightbox state
  const [viewingSighting, setViewingSighting] = useState<AnimalSighting | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; caption: string } | null>(null);
  const [failedCardImages, setFailedCardImages] = useState<Record<string, boolean>>({});
  const [detailImageFailed, setDetailImageFailed] = useState(false);

  useEffect(() => {
    setDetailImageFailed(false);
  }, [viewingSighting?.id, viewingSighting?.photoUrl]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (lightboxImage) {
        setLightboxImage(null);
      } else if (sightingPendingDelete && !isDeletingSighting) {
        setSightingPendingDelete(null);
        setDeleteError(null);
      } else if (isModalOpen && !isSubmitting) {
        setIsModalOpen(false);
        setEditingSighting(null);
        setFormData(buildDefaultCreateForm());
      } else if (viewingSighting) {
        setViewingSighting(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxImage, sightingPendingDelete, isDeletingSighting, isModalOpen, isSubmitting, viewingSighting]);

  const showSuccessBanner = (message: string) => {
    setActionSuccess(message);
    setTimeout(() => {
      setActionSuccess((current) => (current === message ? null : current));
    }, 5000);
  };

  const filtered = sightings.filter((s) => {
    if (filterSpecies !== 'All' && s.species !== filterSpecies) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      const match =
        `${s.sightingCode} ${s.locationName} ${s.species} ${s.forestRange} ${s.district || ''} ${s.observerName} ${s.observationDetails}`.toLowerCase();
      if (!match.includes(q)) return false;
    }
    return true;
  });

  const handleOpenCreateModal = () => {
    setEditingSighting(null);
    setFormData(buildDefaultCreateForm());
    setFormErrors({});
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (sighting: AnimalSighting) => {
    setViewingSighting(null);
    setEditingSighting(sighting);
    setFormData(buildEditForm(sighting));
    setFormErrors({});
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleCloseFormModal = () => {
    if (isSubmitting) return;
    setIsModalOpen(false);
    setEditingSighting(null);
    setFormData(buildDefaultCreateForm());
    setFormErrors({});
    setFormError(null);
  };

  const handleConfirmDeleteSighting = async () => {
    if (!sightingPendingDelete || isDeletingSighting || !onDeleteSighting) return;
    setIsDeletingSighting(true);
    setDeleteError(null);
    const targetId = sightingPendingDelete.id;
    const targetCode = sightingPendingDelete.sightingCode;
    const targetSpecies = sightingPendingDelete.species;
    try {
      await onDeleteSighting(targetId);
      setSightingPendingDelete(null);
      if (viewingSighting?.id === targetId) {
        setViewingSighting(null);
      }
      showSuccessBanner(`Sighting ${targetCode} (${targetSpecies}) permanently deleted.`);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete sighting from backend database.'
      );
    } finally {
      setIsDeletingSighting(false);
    }
  };

  const handleDirectionChange = (dir: AnimalSighting['movementDirection'] | '') => {
    setFormData((prev) => ({
      ...prev,
      movementDirection: dir,
      bearingDegrees: dir ? getBearingForDirection(dir) : null,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const herdSizeNum = Number.parseInt(formData.herdSize, 10);
    const latNum = Number.parseFloat(formData.latitude);
    const lngNum = Number.parseFloat(formData.longitude);

    const errs = validateSightingInput({
      species: formData.species,
      timestamp: formData.timestamp,
      movementDirection: formData.movementDirection,
      behavior: formData.behavior,
      locationName: formData.locationName,
      observationDetails: formData.observationDetails,
      herdSize: herdSizeNum,
      latitude: latNum,
      longitude: lngNum,
      forestRange: formData.forestRange,
      district: formData.district,
      observerName: formData.observerName,
      observerRole: formData.observerRole,
      photoUrl: formData.photoUrl,
    });

    setFormErrors(errs);
    if (Object.keys(errs).length > 0) {
      setFormError(
        editingSighting
          ? 'Please correct the highlighted fields before saving your sighting changes.'
          : 'Please correct the highlighted fields before registering the sighting.'
      );
      return;
    }

    const direction = formData.movementDirection as AnimalSighting['movementDirection'];
    const payload: Omit<AnimalSighting, 'id' | 'sightingCode'> = {
      species: formData.species as SpeciesType,
      timestamp: fromDatetimeLocalValue(formData.timestamp),
      latitude: latNum,
      longitude: lngNum,
      locationName: formData.locationName.trim(),
      district: formData.district.trim(),
      forestRange: formData.forestRange.trim(),
      herdSize: herdSizeNum,
      movementDirection: direction,
      bearingDegrees:
        formData.bearingDegrees ?? getBearingForDirection(direction),
      behavior: formData.behavior as AnimalSighting['behavior'],
      juvenilesPresent: formData.juvenilesPresent,
      observationDetails: formData.observationDetails.trim(),
      observerName: formData.observerName.trim(),
      observerRole: formData.observerRole.trim(),
      verifiedByForestGuard: formData.verifiedByForestGuard,
      photoUrl: formData.photoUrl.trim(),
    };

    try {
      setIsSubmitting(true);
      setFormError(null);

      if (editingSighting) {
        if (!onUpdateSighting) {
          throw new Error('Sighting update handler is not configured.');
        }
        await onUpdateSighting(editingSighting.id, payload);
        const updatedCode = editingSighting.sightingCode;
        setIsModalOpen(false);
        setEditingSighting(null);
        setFormData(buildDefaultCreateForm());
        setFormErrors({});
        showSuccessBanner(`Sighting ${updatedCode} (${payload.species}) updated in PostgreSQL database.`);
      } else {
        await onAddSighting(payload);
        setIsModalOpen(false);
        setFormErrors({});
        setFormData(buildDefaultCreateForm());
        showSuccessBanner(`New ${payload.species} sighting registered in PostgreSQL database.`);
      }
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'Failed to save sighting observation to backend API. Form inputs preserved.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const isGloballyFiltered =
    totalUnfilteredCount !== undefined && sightings.length < totalUnfilteredCount;

  const availableForestRanges =
    !formData.forestRange || FOREST_RANGE_PRESETS.includes(formData.forestRange)
      ? FOREST_RANGE_PRESETS
      : [formData.forestRange, ...FOREST_RANGE_PRESETS];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-sky-400 font-bold uppercase tracking-wider">
            <span>Biological Field Tracking</span>
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
            <span>Wildlife Sightings Register</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            Animal Sightings & Movement Registry
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Log sightings, inspect full field observations, edit coordinates or herd telemetry, and track compass bearing vectors.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenCreateModal}
          className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs sm:text-sm font-semibold px-3.5 py-2 rounded-lg shadow-sm transition self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Log New Sighting</span>
        </button>
      </div>

      {/* Success Banner */}
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

      {/* Global filter notice */}
      {isGloballyFiltered && (
        <div className="bg-slate-900 border border-sky-800/60 px-4 py-2.5 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-slate-300">
            Showing <strong className="text-white font-mono">{sightings.length}</strong> of{' '}
            <strong className="text-white font-mono">{totalUnfilteredCount}</strong> sightings under active global filter (
            <span className="text-sky-300">{selectedDistrict}</span> •{' '}
            <span className="font-mono text-slate-200">{dateRange}</span>).
          </span>
          {onResetGlobalFilters && (
            <button
              type="button"
              onClick={onResetGlobalFilters}
              className="flex items-center gap-1 text-sky-400 hover:text-sky-300 font-semibold"
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
            aria-label="Search sightings"
            placeholder="Search sighting code, location landmark, range, observer..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-hidden"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label="Filter sightings by species"
            value={filterSpecies}
            onChange={(e) => setFilterSpecies(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-slate-200 font-medium focus:ring-1 focus:ring-sky-500 focus:outline-hidden"
          >
            <option value="All">All Wildlife Species</option>
            {SPECIES_OPTIONS.map((sp) => (
              <option key={sp} value={sp}>
                {sp}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Sightings Grid Cards */}
      {isApiLoading && sightings.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-300 text-xs">
          Loading wildlife sightings from FastAPI + PostGIS...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 text-xs">
          <Eye className="w-8 h-8 text-slate-500 mx-auto mb-2" />
          <div className="font-bold text-white text-sm">
            {apiError
              ? 'Wildlife sightings unavailable (Backend offline)'
              : 'No sightings match the active filters'}
          </div>
          <p className="mt-1">
            {apiError
              ? 'Ensure the FastAPI + PostgreSQL backend is running and click Retry Backend Sync.'
              : 'Try adjusting your species filter, search term, or global division/date window.'}
          </p>
          {apiError && onRetrySync && (
            <button
              type="button"
              onClick={onRetrySync}
              className="mt-3 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-300 rounded-lg font-semibold text-xs"
            >
              Retry Backend Sync
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((sighting) => {
            const hasCardPhoto =
              Boolean(sighting.photoUrl) && !failedCardImages[sighting.id];

            return (
              <div
                key={sighting.id}
                className="bg-slate-900 rounded-xl border border-slate-800 shadow-xs p-4 flex flex-col justify-between hover:border-sky-500/50 transition"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-mono text-sky-400 font-semibold">
                          {sighting.sightingCode} • {sighting.forestRange}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                            sighting.isDemo
                              ? 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                              : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                          }`}
                        >
                          {sighting.isDemo ? 'DEMO' : 'DB'}
                        </span>
                      </div>
                      <h3 className="font-bold text-white text-sm mt-0.5">{sighting.species}</h3>
                      <div className="text-slate-400 text-xs truncate">{sighting.locationName}</div>
                    </div>

                    <div className="flex flex-col items-end shrink-0">
                      <span className="bg-sky-950 text-sky-300 border border-sky-800/60 font-bold text-xs px-2 py-0.5 rounded-full font-mono tabular-nums">
                        Herd: {sighting.herdSize}
                      </span>
                      {sighting.juvenilesPresent && (
                        <span className="text-[10px] text-emerald-400 font-semibold mt-1">
                          + Juveniles
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Direction & Bearing Card */}
                  <div className="bg-slate-950 rounded-lg p-2.5 border border-slate-800 flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      <div className="w-7 h-7 rounded-full bg-sky-700 text-white flex items-center justify-center shrink-0">
                        <Navigation
                          className="w-4 h-4 transform"
                          style={{ transform: `rotate(${sighting.bearingDegrees}deg)` }}
                        />
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase font-bold">Heading</div>
                        <div className="font-bold text-slate-200 font-mono tabular-nums">
                          {sighting.movementDirection} ({sighting.bearingDegrees}°)
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">Behavior</div>
                      <div className="font-semibold text-slate-200">{sighting.behavior}</div>
                    </div>
                  </div>

                  {hasCardPhoto && sighting.photoUrl && (
                    <div className="rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
                      <img
                        src={sighting.photoUrl}
                        alt={`${sighting.species} sighting at ${sighting.locationName}`}
                        onError={() =>
                          setFailedCardImages((prev) => ({ ...prev, [sighting.id]: true }))
                        }
                        className="w-full h-28 object-cover"
                      />
                    </div>
                  )}

                  <p className="text-slate-300 text-xs bg-slate-950/60 p-2.5 rounded border border-slate-800 leading-relaxed line-clamp-3">
                    {sighting.observationDetails}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-800 mt-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span className="font-mono tabular-nums whitespace-nowrap shrink-0">
                      {formatCoordinates(sighting.latitude, sighting.longitude)}
                    </span>
                    <span className="font-medium text-slate-300 truncate min-w-0">
                      {sighting.observerName} ({sighting.observerRole})
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setViewingSighting(sighting)}
                      aria-label={`View details for ${sighting.sightingCode}`}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 text-slate-200 text-xs font-semibold transition"
                    >
                      <Eye className="w-3.5 h-3.5 text-sky-400" />
                      <span>View Details</span>
                    </button>

                    {onUpdateSighting && (
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(sighting)}
                        aria-label={`Edit sighting ${sighting.sightingCode}`}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-sky-800/70 bg-sky-950/60 hover:bg-sky-900/70 text-sky-300 text-xs font-semibold transition"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                    )}

                    {onDeleteSighting && (
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteError(null);
                          setSightingPendingDelete(sighting);
                        }}
                        aria-label={`Delete sighting ${sighting.sightingCode}`}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-900/60 bg-slate-950 hover:bg-red-950/70 text-red-300 text-xs font-semibold transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW SIGHTING DETAILS MODAL */}
      {viewingSighting && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sighting-details-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs overflow-y-auto"
        >
          <div className="bg-slate-900 rounded-2xl shadow-2xl border border-slate-800 w-full max-w-2xl my-8 overflow-hidden animate-in fade-in">
            {/* Modal Header */}
            <div className="bg-slate-950 border-b border-slate-800 text-white px-6 py-4 flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sky-400 font-mono text-xs uppercase font-bold tracking-wider">
                    Sighting Dossier • {viewingSighting.sightingCode}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                      viewingSighting.isDemo
                        ? 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                        : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                    }`}
                  >
                    {viewingSighting.isDemo ? 'DEMO SEED' : 'OPERATIONAL DB'}
                  </span>
                  {viewingSighting.verifiedByForestGuard && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-sky-950 text-sky-300 border border-sky-800/60">
                      <ShieldCheck className="w-3 h-3" /> Guard Verified
                    </span>
                  )}
                </div>
                <h3
                  id="sighting-details-modal-title"
                  className="text-lg font-bold text-white mt-1"
                >
                  {viewingSighting.species} — {viewingSighting.locationName}
                </h3>
                <p className="text-[11px] font-mono text-slate-400 mt-0.5 break-all">
                  Record ID: {viewingSighting.id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingSighting(null)}
                aria-label="Close sighting details"
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 text-xs text-slate-300 max-h-[75vh] overflow-y-auto">
              {/* Primary Telemetry & Location Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-sky-400" />
                    <span>Sighting Date & Time</span>
                  </div>
                  <div className="font-semibold text-white text-xs">
                    {formatReadableTimestamp(viewingSighting.timestamp)}
                  </div>
                  <div className="font-mono text-[10px] text-slate-400">
                    ISO: {viewingSighting.timestamp}
                  </div>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Herd Composition
                  </div>
                  <div className="font-bold text-white text-sm font-mono tabular-nums">
                    {viewingSighting.herdSize}{' '}
                    {viewingSighting.herdSize === 1 ? 'Individual' : 'Individuals'}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Calves / Cubs Present:{' '}
                    <span
                      className={
                        viewingSighting.juvenilesPresent
                          ? 'text-emerald-400 font-semibold'
                          : 'text-slate-300'
                      }
                    >
                      {viewingSighting.juvenilesPresent ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Location, Range & District</span>
                  </div>
                  <div className="font-bold text-white">{viewingSighting.locationName}</div>
                  <div className="text-slate-300">
                    {viewingSighting.forestRange}
                    {viewingSighting.district ? ` • ${viewingSighting.district}` : ''}
                  </div>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Coordinates (WGS84)
                  </div>
                  <div className="font-mono font-semibold text-white tabular-nums">
                    {formatCoordinates(viewingSighting.latitude, viewingSighting.longitude)}
                  </div>
                  <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                    Lat: {viewingSighting.latitude.toFixed(4)} • Lng:{' '}
                    {viewingSighting.longitude.toFixed(4)}
                  </div>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Navigation
                      className="w-3.5 h-3.5 text-sky-400"
                      style={{ transform: `rotate(${viewingSighting.bearingDegrees}deg)` }}
                    />
                    <span>Animal Heading & Behaviour</span>
                  </div>
                  <div className="font-bold text-white font-mono">
                    {viewingSighting.movementDirection} ({viewingSighting.bearingDegrees}°)
                  </div>
                  <div className="text-slate-300">Behaviour: {viewingSighting.behavior}</div>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-amber-400" />
                    <span>Observer / Reporting Officer</span>
                  </div>
                  <div className="font-bold text-white">{viewingSighting.observerName}</div>
                  <div className="text-slate-300">
                    {viewingSighting.observerRole} •{' '}
                    {viewingSighting.verifiedByForestGuard
                      ? 'Forest Guard Verified'
                      : 'Unverified Field Report'}
                  </div>
                </div>
              </div>

              {/* Description / Notes */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Observation Notes & Field Description
                </div>
                <p className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {viewingSighting.observationDetails}
                </p>
              </div>

              {/* Uploaded Sighting Image */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5 text-sky-400" />
                    <span>Uploaded Sighting Evidence</span>
                  </span>
                  {viewingSighting.photoUrl && !detailImageFailed && (
                    <button
                      type="button"
                      onClick={() =>
                        setLightboxImage({
                          url: viewingSighting.photoUrl!,
                          caption: `${viewingSighting.sightingCode} • ${viewingSighting.species} at ${viewingSighting.locationName}`,
                        })
                      }
                      className="flex items-center gap-1 text-sky-400 hover:text-sky-300 font-semibold text-[11px]"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                      <span>Open Larger Preview</span>
                    </button>
                  )}
                </div>

                {viewingSighting.photoUrl && !detailImageFailed ? (
                  <button
                    type="button"
                    onClick={() =>
                      setLightboxImage({
                        url: viewingSighting.photoUrl!,
                        caption: `${viewingSighting.sightingCode} • ${viewingSighting.species} at ${viewingSighting.locationName}`,
                      })
                    }
                    aria-label="Open enlarged sighting image preview"
                    className="group relative block w-full rounded-xl overflow-hidden border border-slate-800 bg-slate-950 focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                  >
                    <img
                      src={viewingSighting.photoUrl}
                      alt={`${viewingSighting.species} field evidence`}
                      onError={() => setDetailImageFailed(true)}
                      className="w-full max-h-64 object-cover group-hover:opacity-90 transition"
                    />
                    <span className="absolute bottom-2 right-2 bg-slate-950/85 border border-slate-700 text-slate-100 text-[11px] font-semibold px-2.5 py-1 rounded-md flex items-center gap-1">
                      <Maximize2 className="w-3 h-3 text-sky-400" />
                      <span>Click to enlarge</span>
                    </span>
                  </button>
                ) : (
                  <div className="bg-slate-950 border border-dashed border-slate-800 rounded-xl p-4 text-center text-slate-400 text-xs">
                    {detailImageFailed
                      ? `Unable to load image preview from URL (${viewingSighting.photoUrl}).`
                      : 'No sighting image attached to this record.'}
                  </div>
                )}
              </div>

              {/* Record Audit Timestamps */}
              {(viewingSighting.createdAt || viewingSighting.updatedAt) && (
                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    <span>
                      Created:{' '}
                      <strong className="text-slate-200 font-mono">
                        {formatReadableTimestamp(viewingSighting.createdAt)}
                      </strong>
                    </span>
                  </div>
                  <div>
                    Last Updated:{' '}
                    <strong className="text-slate-200 font-mono">
                      {formatReadableTimestamp(viewingSighting.updatedAt)}
                    </strong>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-950 border-t border-slate-800 px-6 py-3.5 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setViewingSighting(null)}
                className="px-4 py-2 border border-slate-700 rounded-lg font-semibold text-xs text-slate-300 hover:bg-slate-800 transition"
              >
                Close
              </button>
              {onUpdateSighting && (
                <button
                  type="button"
                  onClick={() => handleOpenEditModal(viewingSighting)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-bold text-xs shadow-sm transition"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Edit Sighting</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* IMAGE LIGHTBOX MODAL */}
      {lightboxImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged sighting image preview"
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-xs"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="relative max-w-4xl w-full bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800">
              <span className="text-xs font-semibold text-slate-200 truncate">
                {lightboxImage.caption}
              </span>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                aria-label="Close enlarged image preview"
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-3 bg-slate-950 flex items-center justify-center">
              <img
                src={lightboxImage.url}
                alt={lightboxImage.caption}
                className="max-h-[75vh] w-auto max-w-full rounded-lg object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {/* CREATE / EDIT SIGHTING MODAL */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sighting-form-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs overflow-y-auto"
        >
          <div className="bg-slate-900 rounded-2xl shadow-2xl border border-slate-800 w-full max-w-2xl my-8 overflow-hidden animate-in fade-in">
            <div className="bg-slate-950 border-b border-slate-800 text-white px-6 py-4 flex items-center justify-between">
              <div>
                <span className="text-sky-400 font-mono text-xs uppercase font-bold tracking-wider">
                  {editingSighting
                    ? `Modify Field Telemetry • ${editingSighting.sightingCode}`
                    : 'Field Telemetry • Form WICPS-2B'}
                </span>
                <h3 id="sighting-form-modal-title" className="text-lg font-bold">
                  {editingSighting ? 'Edit Animal Sighting' : 'Record Animal Sighting'}
                </h3>
              </div>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleCloseFormModal}
                aria-label="Close sighting form"
                className="text-slate-400 hover:text-white p-1 rounded-md transition disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              noValidate
              className="p-6 space-y-4 text-xs text-slate-300 max-h-[80vh] overflow-y-auto"
            >
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
                <div>
                  <label htmlFor="sighting-species-select" className="block font-bold text-slate-200 mb-1">
                    Species *
                  </label>
                  <select
                    id="sighting-species-select"
                    value={formData.species}
                    onChange={(e) =>
                      setFormData({ ...formData, species: e.target.value as SpeciesType | '' })
                    }
                    className={`w-full bg-slate-950 border rounded-lg p-2 font-medium text-slate-100 focus:ring-1 focus:ring-sky-500 focus:outline-hidden ${
                      formErrors.species ? 'border-red-500' : 'border-slate-700'
                    }`}
                  >
                    <option value="">Select wildlife species...</option>
                    {SPECIES_OPTIONS.map((sp) => (
                      <option key={sp} value={sp}>
                        {sp}
                      </option>
                    ))}
                  </select>
                  {formErrors.species && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formErrors.species}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="sighting-herd-input" className="block font-bold text-slate-200 mb-1">
                    Herd Count *
                  </label>
                  <input
                    id="sighting-herd-input"
                    type="number"
                    min="1"
                    max="500"
                    placeholder="e.g. 4"
                    value={formData.herdSize}
                    onChange={(e) => setFormData({ ...formData, herdSize: e.target.value })}
                    className={`w-full bg-slate-950 border rounded-lg p-2 font-mono text-slate-100 placeholder-slate-500 focus:ring-1 focus:ring-sky-500 focus:outline-hidden ${
                      formErrors.herdSize ? 'border-red-500' : 'border-slate-700'
                    }`}
                    required
                  />
                  {formErrors.herdSize && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formErrors.herdSize}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="sighting-timestamp-input" className="block font-bold text-slate-200 mb-1">
                    Sighting Date & Time *
                  </label>
                  <input
                    id="sighting-timestamp-input"
                    type="datetime-local"
                    value={formData.timestamp}
                    onChange={(e) => setFormData({ ...formData, timestamp: e.target.value })}
                    className={`w-full bg-slate-950 border rounded-lg p-2 font-mono text-slate-100 focus:ring-1 focus:ring-sky-500 focus:outline-hidden ${
                      formErrors.timestamp ? 'border-red-500' : 'border-slate-700'
                    }`}
                    required
                  />
                  {formErrors.timestamp && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formErrors.timestamp}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="sighting-behavior-select" className="block font-bold text-slate-200 mb-1">
                    Observed Behavior *
                  </label>
                  <select
                    id="sighting-behavior-select"
                    value={formData.behavior}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        behavior: e.target.value as AnimalSighting['behavior'] | '',
                      })
                    }
                    className={`w-full bg-slate-950 border rounded-lg p-2 font-medium text-slate-100 focus:ring-1 focus:ring-sky-500 focus:outline-hidden ${
                      formErrors.behavior ? 'border-red-500' : 'border-slate-700'
                    }`}
                  >
                    <option value="">Select observed behavior...</option>
                    {BEHAVIOR_OPTIONS.map((beh) => (
                      <option key={beh} value={beh}>
                        {beh}
                      </option>
                    ))}
                  </select>
                  {formErrors.behavior && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formErrors.behavior}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="sighting-direction-select" className="block font-bold text-slate-200 mb-1">
                    Movement Direction * (Bearing:{' '}
                    {formData.bearingDegrees !== null ? `${formData.bearingDegrees}°` : '—'})
                  </label>
                  <select
                    id="sighting-direction-select"
                    aria-label="Movement Direction"
                    value={formData.movementDirection}
                    onChange={(e) =>
                      handleDirectionChange(
                        e.target.value as AnimalSighting['movementDirection'] | ''
                      )
                    }
                    className={`w-full bg-slate-950 border rounded-lg p-2 font-medium text-slate-100 focus:ring-1 focus:ring-sky-500 focus:outline-hidden ${
                      formErrors.movementDirection ? 'border-red-500' : 'border-slate-700'
                    }`}
                  >
                    <option value="">Select movement direction...</option>
                    {DIRECTION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {formErrors.movementDirection && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formErrors.movementDirection}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="sighting-range-select" className="block font-bold text-slate-200 mb-1">
                    Forest Range *
                  </label>
                  <select
                    id="sighting-range-select"
                    aria-label="Forest Range"
                    value={formData.forestRange}
                    onChange={(e) => setFormData({ ...formData, forestRange: e.target.value })}
                    className={`w-full bg-slate-950 border rounded-lg p-2 font-medium text-slate-100 focus:ring-1 focus:ring-sky-500 focus:outline-hidden ${
                      formErrors.forestRange ? 'border-red-500' : 'border-slate-700'
                    }`}
                  >
                    <option value="">Select forest range...</option>
                    {availableForestRanges.map((rng) => (
                      <option key={rng} value={rng}>
                        {rng}
                      </option>
                    ))}
                  </select>
                  {formErrors.forestRange && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formErrors.forestRange}
                    </span>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="sighting-district-input" className="block font-bold text-slate-200 mb-1">
                    District / Wildlife Division *
                  </label>
                  <input
                    id="sighting-district-input"
                    type="text"
                    list="sighting-division-suggestions"
                    value={formData.district}
                    onChange={(e) => setFormData({ ...formData, district: e.target.value })}
                    placeholder="e.g. Bandipur Division"
                    className={`w-full bg-slate-950 border rounded-lg p-2 text-slate-100 focus:ring-1 focus:ring-sky-500 focus:outline-hidden ${
                      formErrors.district ? 'border-red-500' : 'border-slate-700'
                    }`}
                  />
                  <datalist id="sighting-division-suggestions">
                    {DIVISION_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id} />
                    ))}
                  </datalist>
                  {formErrors.district && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formErrors.district}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="sighting-lat-input" className="block font-bold text-slate-200 mb-1">
                    Latitude (WGS84) *
                  </label>
                  <input
                    id="sighting-lat-input"
                    aria-label="Sighting Latitude"
                    type="number"
                    step="0.0001"
                    placeholder="e.g. 11.6680"
                    value={formData.latitude}
                    onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                    className={`w-full bg-slate-950 border rounded-lg p-2 font-mono text-slate-100 placeholder-slate-500 focus:ring-1 focus:ring-sky-500 focus:outline-hidden ${
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
                  <label htmlFor="sighting-lng-input" className="block font-bold text-slate-200 mb-1">
                    Longitude (WGS84) *
                  </label>
                  <input
                    id="sighting-lng-input"
                    aria-label="Sighting Longitude"
                    type="number"
                    step="0.0001"
                    placeholder="e.g. 76.6120"
                    value={formData.longitude}
                    onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                    className={`w-full bg-slate-950 border rounded-lg p-2 font-mono text-slate-100 placeholder-slate-500 focus:ring-1 focus:ring-sky-500 focus:outline-hidden ${
                      formErrors.longitude ? 'border-red-500' : 'border-slate-700'
                    }`}
                  />
                  {formErrors.longitude && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formErrors.longitude}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="sighting-observer-name-input" className="block font-bold text-slate-200 mb-1">
                    Observer Name *
                  </label>
                  <input
                    id="sighting-observer-name-input"
                    aria-label="Observer Name"
                    type="text"
                    placeholder="e.g. Beat Guard R. Kumar"
                    value={formData.observerName}
                    onChange={(e) => setFormData({ ...formData, observerName: e.target.value })}
                    className={`w-full bg-slate-950 border rounded-lg p-2 text-slate-100 placeholder-slate-500 focus:ring-1 focus:ring-sky-500 focus:outline-hidden ${
                      formErrors.observerName ? 'border-red-500' : 'border-slate-700'
                    }`}
                  />
                  {formErrors.observerName && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formErrors.observerName}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="sighting-observer-role-input" className="block font-bold text-slate-200 mb-1">
                    Observer Role *
                  </label>
                  <input
                    id="sighting-observer-role-input"
                    aria-label="Observer Role"
                    type="text"
                    placeholder="e.g. Forest Guard"
                    value={formData.observerRole}
                    onChange={(e) => setFormData({ ...formData, observerRole: e.target.value })}
                    className={`w-full bg-slate-950 border rounded-lg p-2 text-slate-100 placeholder-slate-500 focus:ring-1 focus:ring-sky-500 focus:outline-hidden ${
                      formErrors.observerRole ? 'border-red-500' : 'border-slate-700'
                    }`}
                  />
                  {formErrors.observerRole && (
                    <span className="text-red-400 text-[11px] mt-0.5 block">
                      {formErrors.observerRole}
                    </span>
                  )}
                </div>

                <div className="sm:col-span-2 flex flex-wrap items-center gap-6">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.juvenilesPresent}
                      onChange={(e) =>
                        setFormData({ ...formData, juvenilesPresent: e.target.checked })
                      }
                      className="w-4 h-4 accent-sky-500 rounded border-slate-700 bg-slate-950"
                    />
                    <span className="font-semibold text-slate-200">
                      Calves / Cubs present in group
                    </span>
                  </label>

                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.verifiedByForestGuard}
                      onChange={(e) =>
                        setFormData({ ...formData, verifiedByForestGuard: e.target.checked })
                      }
                      className="w-4 h-4 accent-emerald-500 rounded border-slate-700 bg-slate-950"
                    />
                    <span className="font-semibold text-slate-200">
                      Verified by Forest Guard
                    </span>
                  </label>
                </div>
              </div>

              <div>
                <label htmlFor="sighting-location-input" className="block font-bold text-slate-200 mb-1">
                  Location Landmark / Sector *
                </label>
                <input
                  id="sighting-location-input"
                  aria-label="Location Landmark"
                  type="text"
                  placeholder="e.g. Sector 4B Stream Checkdam, Beat 12 Teak Ridge"
                  value={formData.locationName}
                  onChange={(e) => setFormData({ ...formData, locationName: e.target.value })}
                  className={`w-full bg-slate-950 border rounded-lg p-2 text-slate-100 placeholder-slate-500 focus:ring-1 focus:ring-sky-500 focus:outline-hidden ${
                    formErrors.locationName ? 'border-red-500' : 'border-slate-700'
                  }`}
                />
                {formErrors.locationName && (
                  <span className="text-red-400 text-[11px] mt-0.5 block">
                    {formErrors.locationName}
                  </span>
                )}
              </div>

              <div>
                <label htmlFor="sighting-details-textarea" className="block font-bold text-slate-200 mb-1">
                  Observation Details *
                </label>
                <textarea
                  id="sighting-details-textarea"
                  aria-label="Observation Details"
                  rows={3}
                  placeholder="Record herd dynamics, proximity to boundary, presence of radio collar, etc..."
                  value={formData.observationDetails}
                  onChange={(e) =>
                    setFormData({ ...formData, observationDetails: e.target.value })
                  }
                  className={`w-full bg-slate-950 border rounded-lg p-2.5 text-slate-100 placeholder-slate-500 focus:ring-1 focus:ring-sky-500 focus:outline-hidden ${
                    formErrors.observationDetails ? 'border-red-500' : 'border-slate-700'
                  }`}
                />
                {formErrors.observationDetails && (
                  <span className="text-red-400 text-[11px] mt-0.5 block">
                    {formErrors.observationDetails}
                  </span>
                )}
              </div>

              <div>
                <label
                  htmlFor="sighting-photo-url-input"
                  className="block font-bold text-slate-200 mb-1 flex items-center justify-between gap-2"
                >
                  <span>Field Photo / Camera Evidence URL (Optional)</span>
                  <span className="text-[10px] font-normal text-slate-400">
                    Max 512 chars (existing URL preserved on edit)
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-slate-950 rounded-lg border border-slate-700 text-slate-400 shrink-0">
                    <Camera className="w-4 h-4" />
                  </div>
                  <input
                    id="sighting-photo-url-input"
                    aria-label="Sighting Photo URL"
                    type="url"
                    placeholder="https://... (optional)"
                    value={formData.photoUrl}
                    onChange={(e) => setFormData({ ...formData, photoUrl: e.target.value })}
                    className={`w-full bg-slate-950 border rounded-lg p-2 text-xs text-slate-100 focus:ring-1 focus:ring-sky-500 focus:outline-hidden ${
                      formErrors.photoUrl ? 'border-red-500' : 'border-slate-700'
                    }`}
                  />
                  {formData.photoUrl && (
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, photoUrl: '' })}
                      className="px-2.5 py-2 border border-slate-700 rounded-lg text-[11px] font-semibold text-slate-300 hover:bg-slate-800 shrink-0"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {formErrors.photoUrl && (
                  <span className="text-red-400 text-[11px] mt-0.5 block">
                    {formErrors.photoUrl}
                  </span>
                )}
                {formData.photoUrl.trim() && !formErrors.photoUrl && (
                  <div className="mt-2 rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
                    <img
                      src={formData.photoUrl.trim()}
                      alt="Sighting evidence preview"
                      className="w-full max-h-36 object-cover"
                    />
                  </div>
                )}
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleCloseFormModal}
                  className="px-4 py-2 border border-slate-700 rounded-lg font-semibold text-slate-300 hover:bg-slate-800 transition disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-bold shadow-sm transition disabled:opacity-60"
                >
                  {isSubmitting
                    ? editingSighting
                      ? 'Saving Changes...'
                      : 'Recording...'
                    : editingSighting
                    ? 'Save Sighting Changes'
                    : 'Register Sighting'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* DELETE SIGHTING CONFIRMATION MODAL */}
      {sightingPendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-sighting-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs"
        >
          <div className="bg-slate-900 rounded-2xl shadow-2xl border border-red-800/70 w-full max-w-md p-6 space-y-4 animate-in fade-in">
            <div className="border-b border-slate-800 pb-3">
              <span className="text-xs font-mono font-bold text-red-400 uppercase">
                Permanent Database Action
              </span>
              <h3 id="delete-sighting-dialog-title" className="text-base font-bold text-white mt-1">
                Confirm Sighting Deletion
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
                Are you sure you want to permanently delete this animal sighting record from PostgreSQL? This action cannot be undone.
              </p>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1">
                <div className="font-bold text-white">
                  {sightingPendingDelete.sightingCode} — {sightingPendingDelete.species}
                </div>
                <div className="text-slate-400">
                  {sightingPendingDelete.locationName} • {sightingPendingDelete.forestRange}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={isDeletingSighting}
                onClick={() => {
                  setSightingPendingDelete(null);
                  setDeleteError(null);
                }}
                className="px-4 py-2 border border-slate-700 rounded-lg text-slate-300 font-semibold text-xs hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingSighting}
                onClick={handleConfirmDeleteSighting}
                className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold transition shadow-sm disabled:opacity-60"
              >
                {isDeletingSighting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
