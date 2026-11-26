import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AnimalDetectionItem,
  AnimalDetectionRecord,
  ThermalCamera,
  VillageRiskProfile,
} from '../types';
import { apiBridge } from '../services/apiBridge';
import {
  clampBoundingBoxPercent,
  formatDetectionSpeciesDisplay,
  validateAnimalDetectionFile,
} from '../utils/apiMappers';
import {
  buildDeterministicUploadKey,
  formatReidDecisionBadge,
  formatSightingLinkBanner,
  validateLocationContextInputs,
} from '../utils/animalIntelligence';
import { AnimalRegistryTab } from './AnimalRegistryTab';
import { ReidReviewQueueTab } from './ReidReviewQueueTab';
import { AlertsOfficersIotTab } from './AlertsOfficersIotTab';
import { AuthImage } from './AuthImage';
import { AuthenticatedUserProfile } from '../utils/authStorage';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FileImage,
  Fingerprint,
  HelpCircle,
  Info,
  Loader2,
  MapPin,
  Radio,
  RefreshCw,
  ScanSearch,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';

const BOX_PALETTE = [
  {
    border: 'border-emerald-400',
    bg: 'bg-emerald-500/15',
    badge: 'bg-emerald-600 text-white border-emerald-400',
    accentText: 'text-emerald-300',
  },
  {
    border: 'border-amber-400',
    bg: 'bg-amber-500/15',
    badge: 'bg-amber-600 text-white border-amber-400',
    accentText: 'text-amber-300',
  },
  {
    border: 'border-cyan-400',
    bg: 'bg-cyan-500/15',
    badge: 'bg-cyan-600 text-white border-cyan-400',
    accentText: 'text-cyan-300',
  },
  {
    border: 'border-violet-400',
    bg: 'bg-violet-500/15',
    badge: 'bg-violet-600 text-white border-violet-400',
    accentText: 'text-violet-300',
  },
  {
    border: 'border-rose-400',
    bg: 'bg-rose-500/15',
    badge: 'bg-rose-600 text-white border-rose-400',
    accentText: 'text-rose-300',
  },
];

const COUNTRY_OPTIONS = [
  { code: 'IND', label: 'IND — India (Bandipur / Reserve Geofence)' },
  { code: '', label: 'Global (No Country Geofence Prior)' },
  { code: 'NPL', label: 'NPL — Nepal' },
  { code: 'KEN', label: 'KEN — Kenya' },
  { code: 'TZA', label: 'TZA — Tanzania' },
  { code: 'ZAF', label: 'ZAF — South Africa' },
  { code: 'IDN', label: 'IDN — Indonesia' },
  { code: 'USA', label: 'USA — United States' },
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTimestamp(value?: string | null): string {
  if (!value) return 'Unknown time';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function getStatusBadgeProps(status: AnimalDetectionRecord['processingStatus']): {
  label: string;
  classes: string;
} {
  switch (status) {
    case 'completed':
      return {
        label: 'Species Identified',
        classes: 'bg-emerald-950/80 text-emerald-300 border-emerald-700/70',
      };
    case 'needs_review':
      return {
        label: 'Unknown / Needs Review',
        classes: 'bg-amber-950/80 text-amber-300 border-amber-700/70',
      };
    case 'no_animal_detected':
      return {
        label: 'No Animal Detected',
        classes: 'bg-slate-800 text-slate-300 border-slate-700',
      };
    case 'failed':
    default:
      return {
        label: 'Failed',
        classes: 'bg-red-950/80 text-red-300 border-red-700/70',
      };
  }
}

type IntelligenceSubTab = 'upload' | 'registry' | 'review' | 'intelligence';

interface AnimalDetectionViewProps {
  currentUser?: AuthenticatedUserProfile | null;
  villages?: VillageRiskProfile[];
  onDataIntegrated?: () => Promise<void> | void;
}

function getReidBadgeClasses(tone: 'emerald' | 'sky' | 'amber' | 'rose' | 'slate'): string {
  switch (tone) {
    case 'emerald':
      return 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80';
    case 'sky':
      return 'bg-sky-950/80 text-sky-300 border-sky-700/80';
    case 'amber':
      return 'bg-amber-950/80 text-amber-300 border-amber-700/80';
    case 'rose':
      return 'bg-rose-950/80 text-rose-300 border-rose-700/80';
    default:
      return 'bg-slate-900 text-slate-300 border-slate-700';
  }
}

export const AnimalDetectionView: React.FC<AnimalDetectionViewProps> = ({
  currentUser = null,
  villages = [],
  onDataIntegrated,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activeSubTab, setActiveSubTab] = useState<IntelligenceSubTab>('upload');
  const [cameras, setCameras] = useState<ThermalCamera[]>([]);

  const [history, setHistory] = useState<AnimalDetectionRecord[]>([]);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [eligibleClearCount, setEligibleClearCount] = useState<number>(0);
  const [historyPage, setHistoryPage] = useState<number>(1);
  const [historyTotalPages, setHistoryTotalPages] = useState<number>(1);
  const HISTORY_PAGE_SIZE = 10;
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);

  // History deletion / clear-all confirmation state
  const [deleteTarget, setDeleteTarget] = useState<AnimalDetectionRecord | null>(null);
  const [isDeletingSingle, setIsDeletingSingle] = useState<boolean>(false);
  const [isClearAllModalOpen, setIsClearAllModalOpen] = useState<boolean>(false);
  const [isClearingAll, setIsClearingAll] = useState<boolean>(false);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('All');

  // Upload & local preview state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [uploadAttemptSalt, setUploadAttemptSalt] = useState<string>('');
  const [countryCode, setCountryCode] = useState<string>('IND');
  const [cameraId, setCameraId] = useState<string>('');
  const [villageId, setVillageId] = useState<string>('');
  const [latitudeInput, setLatitudeInput] = useState<string>('');
  const [longitudeInput, setLongitudeInput] = useState<string>('');
  const [locationName, setLocationName] = useState<string>('');
  const [capturedAt, setCapturedAt] = useState<string>('');
  const [autoCreateSighting, setAutoCreateSighting] = useState<boolean>(true);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  const [uploadStage, setUploadStage] = useState<
    'idle' | 'uploading' | 'analyzing' | 'completed' | 'error'
  >('idle');
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  // Active inspection record & bounding box controls
  const [activeRecord, setActiveRecord] = useState<AnimalDetectionRecord | null>(null);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState<boolean>(true);
  const [highlightedBoxIndex, setHighlightedBoxIndex] = useState<number | null>(null);

  useEffect(() => {
    apiBridge
      .getCameras()
      .then((list) => setCameras(list))
      .catch(() => setCameras([]));
  }, []);

  const fetchDetections = useCallback(
    async (selectNewestIfEmpty = false, targetPage?: number) => {
      const requestedPage = targetPage ?? historyPage;
      setIsLoadingHistory(true);
      setHistoryError(null);
      try {
        const res = await apiBridge.getAnimalDetections({
          page: requestedPage,
          pageSize: HISTORY_PAGE_SIZE,
          processingStatus: statusFilter,
          search: searchQuery,
        });
        if (res.items.length === 0 && requestedPage > 1 && res.total > 0) {
          const fallbackPage = Math.max(1, res.totalPages);
          setHistoryPage(fallbackPage);
          const retryRes = await apiBridge.getAnimalDetections({
            page: fallbackPage,
            pageSize: HISTORY_PAGE_SIZE,
            processingStatus: statusFilter,
            search: searchQuery,
          });
          setHistory(retryRes.items);
          setTotalRecords(retryRes.total);
          setHistoryTotalPages(Math.max(1, retryRes.totalPages));
          setEligibleClearCount(retryRes.eligibleClearCount);
          if (selectNewestIfEmpty && retryRes.items.length > 0) {
            setActiveRecord((prev) => prev ?? retryRes.items[0]);
          }
          return;
        }
        setHistory(res.items);
        setTotalRecords(res.total);
        setHistoryTotalPages(Math.max(1, res.totalPages));
        setEligibleClearCount(res.eligibleClearCount);
        if (selectNewestIfEmpty && res.items.length > 0) {
          setActiveRecord((prev) => prev ?? res.items[0]);
        }
      } catch (err) {
        setHistoryError(
          err instanceof Error ? err.message : 'Failed to load persisted detection results.'
        );
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [historyPage, searchQuery, statusFilter]
  );

  useEffect(() => {
    fetchDetections(true);
  }, [fetchDetections]);

  const handleConfirmSingleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeletingSingle(true);
    setHistoryError(null);
    setHistoryNotice(null);
    try {
      const res = await apiBridge.deleteAnimalDetection(
        deleteTarget.id,
        'Removed from Previous Detection Results by authorized user'
      );
      const removedId = deleteTarget.id;
      const removedLabel = deleteTarget.primarySpecies || deleteTarget.sourceFilename;
      setDeleteTarget(null);
      if (activeRecord?.id === removedId) {
        setActiveRecord(null);
      }
      setHistoryNotice(
        res.storagePreservedReason
          ? `Removed "${removedLabel}" from detection history (linked wildlife evidence preserved).`
          : `Removed "${removedLabel}" from detection history.`
      );
      await fetchDetections(false);
    } catch (err) {
      setHistoryError(
        err instanceof Error ? err.message : 'Failed to remove detection record.'
      );
    } finally {
      setIsDeletingSingle(false);
    }
  };

  const handleConfirmClearAll = async () => {
    setIsClearingAll(true);
    setHistoryError(null);
    setHistoryNotice(null);
    try {
      const res = await apiBridge.clearAnimalDetectionHistory({
        processingStatus: statusFilter,
        search: searchQuery,
        reason: 'Bulk cleared Previous Detection Results by authorized user',
      });
      setIsClearAllModalOpen(false);
      setActiveRecord(null);
      setHistoryPage(1);
      if (res.clearedCount === 0) {
        setHistoryNotice('No eligible detection records were available to clear.');
      } else {
        const preservedNote =
          res.storageObjectsPreserved > 0
            ? ` Linked sightings, alerts, and Re-ID evidence (${res.storageObjectsPreserved} asset${
                res.storageObjectsPreserved === 1 ? '' : 's'
              }) were preserved.`
            : '';
        const skippedNote =
          res.skippedUnauthorizedCount > 0
            ? ` ${res.skippedUnauthorizedCount} record(s) owned by other operators were left untouched.`
            : '';
        setHistoryNotice(
          `Cleared ${res.clearedCount} detection record${res.clearedCount === 1 ? '' : 's'} from history.${preservedNote}${skippedNote}`
        );
      }
      await fetchDetections(false, 1);
    } catch (err) {
      setHistoryError(
        err instanceof Error ? err.message : 'Failed to clear detection history.'
      );
    } finally {
      setIsClearingAll(false);
    }
  };

  // Revoke object URL on change/unmount
  useEffect(() => {
    return () => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    };
  }, [localPreviewUrl]);

  const handleSelectFile = (file: File | null) => {
    setUploadError(null);
    setUploadNotice(null);
    if (!file) return;

    const check = validateAnimalDetectionFile({ name: file.name, size: file.size });
    if (!check.valid) {
      setSelectedFile(null);
      setLocalPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setUploadStage('error');
      setUploadError(check.error);
      return;
    }

    const preview = URL.createObjectURL(file);
    setLocalPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return preview;
    });
    setSelectedFile(file);
    setUploadAttemptSalt(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    setUploadStage('idle');
    setUploadProgress(0);
    setHighlightedBoxIndex(null);
  };

  const handleClearSelection = () => {
    setSelectedFile(null);
    setUploadAttemptSalt('');
    setLocalPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setUploadStage('idle');
    setUploadProgress(0);
    setUploadError(null);
    setUploadNotice(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRunDetection = async () => {
    if (!selectedFile) {
      setUploadStage('error');
      setUploadError('Choose a JPG, JPEG, or PNG animal image before running detection.');
      return;
    }

    const gpsValidation = validateLocationContextInputs({
      latitude: latitudeInput,
      longitude: longitudeInput,
    });
    if (!gpsValidation.valid) {
      setUploadStage('error');
      setUploadError(gpsValidation.error);
      return;
    }

    setUploadError(null);
    setUploadNotice(null);
    setUploadStage('uploading');
    setUploadProgress(0);
    setHighlightedBoxIndex(null);

    const idempotencyKey = buildDeterministicUploadKey(
      selectedFile,
      uploadAttemptSalt || 'default'
    );

    try {
      const result = await apiBridge.uploadAnimalDetectionImage({
        file: selectedFile,
        countryCode,
        cameraId: cameraId || undefined,
        villageId: villageId || undefined,
        latitude: gpsValidation.latitude,
        longitude: gpsValidation.longitude,
        locationName: locationName.trim() || undefined,
        capturedAt: capturedAt ? new Date(capturedAt).toISOString() : undefined,
        autoCreateSighting,
        idempotencyKey,
        onProgress: (pct) => {
          setUploadProgress(pct);
          if (pct >= 100) {
            setUploadStage('analyzing');
          }
        },
      });

      setUploadStage('completed');
      setActiveRecord(result);
      setLocalPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setSelectedFile(null);
      setUploadAttemptSalt('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      const idCodes = result.detections
        .map((d) => d.animalCode)
        .filter((code): code is string => Boolean(code));
      const idSummary = idCodes.length > 0 ? ` • Individual ID: ${idCodes.join(', ')}` : '';
      const alertSummary =
        (result.generatedAlerts?.length ?? 0) > 0
          ? ` • ${result.generatedAlerts?.length} alert(s) triggered`
          : '';

      if (result.animalCount === 0) {
        setUploadNotice(
          `Processed "${result.sourceFilename}" in ${result.inferenceDurationMs} ms — no wildlife animals detected.`
        );
      } else if (result.processingStatus === 'needs_review') {
        setUploadNotice(
          `Processed "${result.sourceFilename}" (${result.animalCount} detection${
            result.animalCount > 1 ? 's' : ''
          }) — marked Unknown / Needs Review due to low species confidence.`
        );
      } else {
        setUploadNotice(
          `Identified ${result.primarySpecies} (${Math.round(
            (result.primaryConfidence ?? 0) * 100
          )}%)${idSummary}${alertSummary} in ${result.inferenceDurationMs} ms.`
        );
      }

      setHistoryPage(1);
      await fetchDetections(false, 1);
      if (result.generatedSightingId || (result.generatedAlerts?.length ?? 0) > 0) {
        await onDataIntegrated?.();
      }
    } catch (err) {
      setUploadStage('error');
      setUploadError(
        err instanceof Error ? err.message : 'Animal detection failed. Verify FastAPI backend.'
      );
    }
  };

  const handleSelectHistoryRecord = (record: AnimalDetectionRecord) => {
    setActiveRecord(record);
    setHighlightedBoxIndex(null);
    // Clear unsent local file preview so user immediately sees the stored persisted image
    setSelectedFile(null);
    setLocalPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setUploadError(null);
  };

  const isBusy = uploadStage === 'uploading' || uploadStage === 'analyzing';
  const showingLocalDraftPreview = Boolean(localPreviewUrl && selectedFile);
  const inspectedImageUrl = showingLocalDraftPreview
    ? localPreviewUrl
    : activeRecord?.imageUrl || null;
  const inspectedDetections: AnimalDetectionItem[] = useMemo(() => {
    if (showingLocalDraftPreview || !activeRecord) return [];
    return activeRecord.detections;
  }, [showingLocalDraftPreview, activeRecord]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 font-bold uppercase tracking-wider">
            <ScanSearch className="w-3.5 h-3.5" />
            <span>WICPS Phase 1-3 Wildlife Intelligence</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>MegaDetector + SpeciesNet + MegaDescriptor Re-ID</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight mt-1">
            Animal Detection, Re-Identification & Intelligence
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Upload wildlife imagery for species detection, individual MegaDescriptor-T-224 visual Re-ID, geospatial sighting linking, and alert rule evaluation.
          </p>
        </div>

        <button
          type="button"
          onClick={() => fetchDetections(false)}
          disabled={isLoadingHistory}
          aria-label="Refresh Detection History"
          className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingHistory ? 'animate-spin' : ''}`} />
          <span>Refresh History ({totalRecords})</span>
        </button>
      </div>

      {/* Accessible Sub-Tabs */}
      <div
        role="tablist"
        aria-label="Wildlife Intelligence Modules"
        className="flex flex-wrap items-center gap-2 bg-slate-900/90 border border-slate-800 p-1.5 rounded-2xl"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'upload'}
          onClick={() => setActiveSubTab('upload')}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition ${
            activeSubTab === 'upload'
              ? 'bg-emerald-600 text-white shadow'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <ScanSearch className="w-3.5 h-3.5" />
          <span>Image Analysis & Upload</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'registry'}
          onClick={() => setActiveSubTab('registry')}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition ${
            activeSubTab === 'registry'
              ? 'bg-emerald-600 text-white shadow'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Fingerprint className="w-3.5 h-3.5" />
          <span>Animal Registry & Profiles</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'review'}
          onClick={() => setActiveSubTab('review')}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition ${
            activeSubTab === 'review'
              ? 'bg-emerald-600 text-white shadow'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <UserCheck className="w-3.5 h-3.5" />
          <span>Matches & Review</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'intelligence'}
          onClick={() => setActiveSubTab('intelligence')}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition ${
            activeSubTab === 'intelligence'
              ? 'bg-emerald-600 text-white shadow'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Radio className="w-3.5 h-3.5" />
          <span>Alerts, Officers & IoT Contract</span>
        </button>
      </div>

      {activeSubTab === 'registry' && <AnimalRegistryTab />}
      {activeSubTab === 'review' && (
        <ReidReviewQueueTab
          currentUser={currentUser}
          onReviewCompleted={() => {
            fetchDetections(false);
            onDataIntegrated?.();
          }}
        />
      )}
      {activeSubTab === 'intelligence' && (
        <AlertsOfficersIotTab
          currentUser={currentUser}
          villages={villages}
          cameras={cameras}
        />
      )}

      {activeSubTab === 'upload' && (
        <>
          {/* Honest Model & Scope Banner */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="flex items-start gap-3">
              <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <div className="space-y-1 text-slate-300">
                <div>
                  <span className="font-bold text-white">Active ML & Re-ID Stack:</span>{' '}
                  <span className="font-mono text-emerald-300">
                    MegaDetector v5a (MIT) + Google SpeciesNet v4.0.3a (Apache-2.0) + BVRA/MegaDescriptor-T-224 (CC-BY-NC-4.0)
                  </span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  MegaDescriptor cosine similarity is a probabilistic visual matching aid, never biological proof — ambiguous or low-quality crops route to human verification. Calibrated for RGB/IR imagery (radiometric thermal frames not verified).
                </p>
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2 font-mono text-[11px] bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-lg text-slate-300">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>768-D Vector Re-ID Active</span>
            </div>
          </div>

          {/* Main Split Workspace */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column: Uploader + Persisted History */}
        <div className="xl:col-span-5 space-y-6">
          {/* Upload Card */}
          <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Upload className="w-4 h-4 text-emerald-400" />
                <span>Manual Animal Image Upload</span>
              </h2>
              <span className="text-[11px] font-mono text-slate-400">JPG, JPEG, PNG • Max 25 MB</span>
            </div>

            {/* Dropzone */}
            <label
              htmlFor="animal-detection-file-input"
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOver(true);
              }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingOver(false);
                const dropped = e.dataTransfer.files?.[0] || null;
                handleSelectFile(dropped);
              }}
              className={`block border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition ${
                isDraggingOver
                  ? 'border-emerald-400 bg-emerald-950/30'
                  : 'border-slate-700 hover:border-emerald-500/70 bg-slate-950/60'
              }`}
            >
              <input
                ref={fileInputRef}
                id="animal-detection-file-input"
                type="file"
                accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                className="sr-only"
                disabled={isBusy}
                onChange={(e) => handleSelectFile(e.target.files?.[0] || null)}
              />
              <FileImage className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <div className="text-xs font-semibold text-white">
                {selectedFile ? selectedFile.name : 'Click to select or drop an animal image'}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {selectedFile
                  ? `${formatFileSize(selectedFile.size)} — Preview ready in inspector`
                  : 'Upload images one after another; all detections persist automatically'}
              </div>
            </label>

            {/* Country Geofence & WICPS Geospatial Context */}
            <div className="space-y-3 bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
              <div className="space-y-1">
                <label
                  htmlFor="speciesnet-country-select"
                  className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 font-mono"
                >
                  SpeciesNet Geofence Prior (Country)
                </label>
                <select
                  id="speciesnet-country-select"
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  disabled={isBusy}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                >
                  {COUNTRY_OPTIONS.map((opt) => (
                    <option key={opt.code || 'GLOBAL'} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label
                    htmlFor="detection-camera-select"
                    className="block text-[10px] font-mono uppercase text-slate-400 mb-1"
                  >
                    Camera Trap (Optional)
                  </label>
                  <select
                    id="detection-camera-select"
                    value={cameraId}
                    onChange={(e) => setCameraId(e.target.value)}
                    disabled={isBusy}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">None (Manual Upload)</option>
                    {cameras.map((cam) => (
                      <option key={cam.id} value={cam.id}>
                        {cam.cameraCode} — {cam.zoneName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="detection-village-select"
                    className="block text-[10px] font-mono uppercase text-slate-400 mb-1"
                  >
                    Nearest Village (Optional)
                  </label>
                  <select
                    id="detection-village-select"
                    value={villageId}
                    onChange={(e) => setVillageId(e.target.value)}
                    disabled={isBusy}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">None (Require GPS if linking)</option>
                    {villages.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.district})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label htmlFor="detection-lat-input" className="block text-[10px] font-mono text-slate-400 mb-1">
                    Latitude
                  </label>
                  <input
                    id="detection-lat-input"
                    type="text"
                    value={latitudeInput}
                    onChange={(e) => setLatitudeInput(e.target.value)}
                    placeholder="e.g., 11.662"
                    disabled={isBusy}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="detection-lng-input" className="block text-[10px] font-mono text-slate-400 mb-1">
                    Longitude
                  </label>
                  <input
                    id="detection-lng-input"
                    type="text"
                    value={longitudeInput}
                    onChange={(e) => setLongitudeInput(e.target.value)}
                    placeholder="e.g., 76.628"
                    disabled={isBusy}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100"
                  />
                </div>
                <div className="col-span-2">
                  <label htmlFor="detection-location-name" className="block text-[10px] font-mono text-slate-400 mb-1">
                    Location Label (Optional)
                  </label>
                  <input
                    id="detection-location-name"
                    type="text"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    placeholder="e.g., Mangala East Fireline"
                    disabled={isBusy}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100"
                  />
                </div>
              </div>

              <div className="text-[11px] font-mono text-slate-400 px-0.5" data-testid="gps-context-hint">
                {latitudeInput.trim() || longitudeInput.trim()
                  ? 'Manual GPS coordinates will anchor the generated Sighting.'
                  : cameraId || villageId
                  ? 'Location resolves automatically from selected Camera/Village GPS.'
                  : 'No Camera/Village/GPS selected — upload skips Sighting creation (no fake GPS).'}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
                <div>
                  <label htmlFor="detection-captured-at" className="block text-[10px] font-mono text-slate-400 mb-1">
                    Captured Time (Optional)
                  </label>
                  <input
                    id="detection-captured-at"
                    type="datetime-local"
                    value={capturedAt}
                    onChange={(e) => setCapturedAt(e.target.value)}
                    disabled={isBusy}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100"
                  />
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer pt-3 sm:pt-4">
                  <input
                    type="checkbox"
                    checked={autoCreateSighting}
                    onChange={(e) => setAutoCreateSighting(e.target.checked)}
                    disabled={isBusy}
                  />
                  <span>Auto-create Sighting & evaluate Alert Rules</span>
                </label>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleRunDetection}
                disabled={isBusy || !selectedFile}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-xl text-xs font-bold transition shadow-sm"
              >
                {isBusy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>
                      {uploadStage === 'uploading'
                        ? `Uploading ${uploadProgress}%...`
                        : 'Running MegaDetector + SpeciesNet...'}
                    </span>
                  </>
                ) : (
                  <>
                    <ScanSearch className="w-4 h-4" />
                    <span>Detect & Identify Species</span>
                  </>
                )}
              </button>

              {selectedFile && !isBusy && (
                <button
                  type="button"
                  onClick={handleClearSelection}
                  aria-label="Clear selected image"
                  className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Upload / Processing Progress Bar */}
            {isBusy && (
              <div className="space-y-1.5 pt-1" role="status" aria-live="polite">
                <div className="flex justify-between text-[11px] font-mono text-slate-300">
                  <span>
                    {uploadStage === 'uploading'
                      ? 'Streaming image to FastAPI...'
                      : 'Running CPU PyTorch inference (MegaDetector + SpeciesNet)...'}
                  </span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-300 ${
                      uploadStage === 'analyzing'
                        ? 'bg-emerald-400 animate-pulse w-full'
                        : 'bg-emerald-500'
                    }`}
                    style={
                      uploadStage === 'uploading' ? { width: `${uploadProgress}%` } : undefined
                    }
                  />
                </div>
              </div>
            )}

            {/* Error or Success Status Notice */}
            {uploadError && (
              <div
                role="alert"
                className="bg-red-950/60 border border-red-800/80 text-red-200 rounded-xl p-3 text-xs flex items-start gap-2.5"
              >
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
            )}

            {uploadNotice && !uploadError && (
              <div
                role="status"
                className="bg-emerald-950/50 border border-emerald-800/70 text-emerald-200 rounded-xl p-3 text-xs flex items-start gap-2.5"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{uploadNotice}</span>
              </div>
            )}
          </section>

          {/* Persisted Previous Detections History */}
          <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-sm font-bold text-white">Previous Detection Results</h2>
                <span className="text-[11px] font-mono text-slate-400">
                  {totalRecords} total
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setHistoryError(null);
                  setIsClearAllModalOpen(true);
                }}
                disabled={isLoadingHistory || isClearingAll || eligibleClearCount === 0}
                data-testid="clear-all-detections-button"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-950 hover:border-red-500/70 hover:bg-red-950/50 hover:text-red-200 disabled:opacity-40 disabled:pointer-events-none text-[11px] font-semibold text-slate-300 transition"
                title={
                  eligibleClearCount > 0
                    ? `Clear ${eligibleClearCount} eligible detection record(s)`
                    : 'No eligible detection records to clear'
                }
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear All{eligibleClearCount > 0 ? ` (${eligibleClearCount})` : ''}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setHistoryPage(1);
                    setSearchQuery(e.target.value);
                  }}
                  placeholder="Search filename or species..."
                  aria-label="Search previous detections"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => {
                  setHistoryPage(1);
                  setStatusFilter(e.target.value);
                }}
                aria-label="Filter detection status"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
              >
                <option value="All">All Statuses</option>
                <option value="completed">Species Identified</option>
                <option value="no_animal_detected">No Animal Detected</option>
                <option value="needs_review">Unknown / Needs Review</option>
              </select>
            </div>

            {historyError && (
              <div
                role="alert"
                className="bg-red-950/60 border border-red-800 text-red-200 rounded-xl p-3 text-xs flex items-start justify-between gap-2"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{historyError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryError(null)}
                  aria-label="Dismiss history error"
                  className="text-red-300 hover:text-white shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {historyNotice && !historyError && (
              <div
                role="status"
                className="bg-emerald-950/50 border border-emerald-800/70 text-emerald-200 rounded-xl p-3 text-xs flex items-start justify-between gap-2"
              >
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{historyNotice}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryNotice(null)}
                  aria-label="Dismiss history notice"
                  className="text-emerald-300 hover:text-white shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {isLoadingHistory ? (
              <div className="py-10 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                <span>Loading persisted detections...</span>
              </div>
            ) : history.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400 bg-slate-950/50 rounded-xl border border-slate-800/80 px-4">
                {searchQuery.trim() || statusFilter !== 'All'
                  ? 'No detection records match the current search or status filter.'
                  : 'No animal detections recorded yet. Upload a JPG or PNG image above to begin.'}
              </div>
            ) : (
              <>
                <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1" data-testid="detection-history-list">
                  {history.map((item) => {
                    const isSelected = !showingLocalDraftPreview && activeRecord?.id === item.id;
                    const badge = getStatusBadgeProps(item.processingStatus);
                    const primaryCode = item.detections.find((d) => d.animalCode)?.animalCode;
                    const alertCount = item.generatedAlerts?.length ?? item.generatedAlertIds?.length ?? 0;
                    const canRemove = Boolean(item.canDelete);
                    return (
                      <div
                        key={item.id}
                        data-testid={`detection-history-card-${item.id}`}
                        className={`w-full rounded-xl border transition flex items-center gap-1.5 pr-2 ${
                          isSelected
                            ? 'bg-emerald-950/40 border-emerald-500/70'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectHistoryRecord(item)}
                          aria-label={`Inspect detection ${item.sourceFilename} (${
                            item.primarySpecies || badge.label
                          })`}
                          className="flex-1 min-w-0 text-left p-2.5 flex items-center gap-3 focus:outline-hidden focus:ring-1 focus:ring-emerald-500 rounded-l-xl"
                        >
                          <AuthImage
                            src={item.imageUrl}
                            alt={item.sourceFilename}
                            className="w-14 h-14 rounded-lg object-cover bg-slate-900 border border-slate-800 shrink-0"
                            loading="lazy"
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-white truncate">
                                {item.primarySpecies || badge.label}
                                {primaryCode ? (
                                  <span className="ml-1.5 font-mono text-sky-300">[{primaryCode}]</span>
                                ) : null}
                              </span>
                              {item.primaryConfidence !== null &&
                                item.primaryConfidence !== undefined && (
                                  <span className="text-[11px] font-mono text-emerald-300 shrink-0">
                                    {(item.primaryConfidence * 100).toFixed(1)}%
                                  </span>
                                )}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate">
                              {item.sourceFilename}
                            </div>
                            <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-slate-400">
                              <div className="flex items-center gap-1.5">
                                <span className={`px-1.5 py-0.5 rounded border ${badge.classes}`}>
                                  {item.animalCount} {item.animalCount === 1 ? 'animal' : 'animals'}
                                </span>
                                {alertCount > 0 && (
                                  <span className="px-1.5 py-0.5 rounded border border-red-700 bg-red-950 text-red-300">
                                    {alertCount} Alert{alertCount > 1 ? 's' : ''}
                                  </span>
                                )}
                              </div>
                              <span>{formatTimestamp(item.createdAt)}</span>
                            </div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setHistoryError(null);
                            setDeleteTarget(item);
                          }}
                          disabled={!canRemove || isDeletingSingle || isClearingAll}
                          aria-label={`Delete detection ${item.sourceFilename}`}
                          title={
                            canRemove
                              ? `Remove ${item.sourceFilename} from detection history`
                              : 'Only the uploader, a reviewer, or an administrator can remove this record'
                          }
                          data-testid={`delete-detection-${item.id}`}
                          className="p-2 rounded-lg text-slate-400 hover:text-red-300 hover:bg-red-950/60 border border-transparent hover:border-red-800/60 disabled:opacity-30 disabled:pointer-events-none transition shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination Controls */}
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
                  <span>
                    Page {historyPage} of {historyTotalPages} • Showing {history.length} of {totalRecords}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                      disabled={historyPage <= 1 || isLoadingHistory}
                      aria-label="Previous detection history page"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 disabled:opacity-40 disabled:pointer-events-none transition"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Prev</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
                      disabled={historyPage >= historyTotalPages || isLoadingHistory}
                      aria-label="Next detection history page"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 disabled:opacity-40 disabled:pointer-events-none transition"
                    >
                      <span>Next</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>

        {/* Right Column: Image Inspector, Bounding Boxes & Per-Animal Species Breakdown */}
        <section className="xl:col-span-7 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-5">
          {!inspectedImageUrl ? (
            <div className="py-24 text-center space-y-3">
              <ScanSearch className="w-12 h-12 text-slate-600 mx-auto" />
              <div className="text-sm font-bold text-slate-300">
                Select an image or previous record to inspect detections
              </div>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Uploaded wildlife photos are stored persistently and annotated with MegaDetector
                bounding boxes plus Google SpeciesNet classifications.
              </p>
            </div>
          ) : (
            <>
              {/* Inspector Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div className="min-w-0">
                  <div className="text-xs font-mono text-slate-400">
                    {showingLocalDraftPreview
                      ? 'LOCAL PREVIEW (NOT YET ANALYZED)'
                      : `DETECTION RECORD • ${activeRecord?.id.slice(0, 8)}`}
                  </div>
                  <h2 className="text-base font-bold text-white truncate mt-0.5">
                    {showingLocalDraftPreview
                      ? selectedFile?.name
                      : activeRecord?.sourceFilename}
                  </h2>
                </div>

                {!showingLocalDraftPreview && activeRecord && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowBoundingBoxes((prev) => !prev)}
                      aria-pressed={showBoundingBoxes}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition"
                    >
                      {showBoundingBoxes ? (
                        <>
                          <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                          <span>Hide Boxes</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Show Boxes</span>
                        </>
                      )}
                    </button>

                    {(() => {
                      const badge = getStatusBadgeProps(activeRecord.processingStatus);
                      return (
                        <span
                          data-testid="active-detection-status"
                          className={`px-2.5 py-1 rounded-lg border text-xs font-bold font-mono ${badge.classes}`}
                        >
                          {badge.label}
                        </span>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Aspect-ratio Exact Bounding Box Canvas */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex justify-center items-center overflow-hidden">
                <div className="relative inline-block max-w-full" data-testid="detection-canvas">
                  <AuthImage
                    src={inspectedImageUrl}
                    alt={
                      showingLocalDraftPreview
                        ? selectedFile?.name || 'Local preview'
                        : activeRecord?.sourceFilename || 'Detected wildlife'
                    }
                    className="block max-w-full max-h-[500px] w-auto h-auto rounded-lg select-none"
                  />

                  {!showingLocalDraftPreview &&
                    showBoundingBoxes &&
                    inspectedDetections.map((det) => {
                      const palette = BOX_PALETTE[(det.index - 1) % BOX_PALETTE.length];
                      const coords = clampBoundingBoxPercent(det.bbox);
                      const display = formatDetectionSpeciesDisplay(det);
                      const isHighlighted = highlightedBoxIndex === det.index;
                      const labelInsideBottom = coords.topPct < 7;

                      return (
                        <button
                          key={det.index}
                          type="button"
                          onClick={() =>
                            setHighlightedBoxIndex((prev) => (prev === det.index ? null : det.index))
                          }
                          aria-label={`Select bounding box #${det.index} ${display.label}`}
                          data-testid={`bbox-overlay-${det.index}`}
                          style={{
                            left: `${coords.leftPct}%`,
                            top: `${coords.topPct}%`,
                            width: `${coords.widthPct}%`,
                            height: `${coords.heightPct}%`,
                          }}
                          className={`absolute border-2 cursor-pointer transition-all text-left ${
                            palette.border
                          } ${isHighlighted ? `${palette.bg} ring-2 ring-white/80` : ''}`}
                        >
                          <div
                            className={`absolute left-0 ${
                              labelInsideBottom ? 'top-1' : '-top-6'
                            } px-1.5 py-0.5 rounded text-[10px] font-bold font-mono border shadow whitespace-nowrap max-w-[260px] truncate ${
                              palette.badge
                            }`}
                          >
                            #{det.index} {display.label} {Math.round(det.speciesConfidence * 100)}%
                            {det.animalCode ? ` • ${det.animalCode}` : ''}
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>

              {/* Draft Preview Prompt */}
              {showingLocalDraftPreview && selectedFile && (
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="text-slate-300">
                    Local preview loaded ({formatFileSize(selectedFile.size)}). Click{' '}
                    <span className="font-bold text-emerald-300">Detect & Identify Species</span> to
                    upload and run MegaDetector + SpeciesNet inference.
                  </div>
                </div>
              )}

              {/* Persisted Record Telemetry & Detections Breakdown */}
              {!showingLocalDraftPreview && activeRecord && (
                <div className="space-y-4">
                  {/* Metadata Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
                      <div className="text-[10px] font-mono uppercase text-slate-400">
                        Animals Detected
                      </div>
                      <div
                        className="text-lg font-black text-white mt-0.5 font-mono"
                        data-testid="active-animal-count"
                      >
                        {activeRecord.animalCount}
                      </div>
                    </div>
                    <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
                      <div className="text-[10px] font-mono uppercase text-slate-400">
                        Primary Species
                      </div>
                      <div
                        className="text-xs sm:text-sm font-bold text-emerald-300 break-words leading-snug mt-1"
                        title={activeRecord.primarySpecies || undefined}
                        data-testid="active-primary-species"
                      >
                        {activeRecord.primarySpecies || 'None'}
                      </div>
                    </div>
                    <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
                      <div className="text-[10px] font-mono uppercase text-slate-400">
                        Image Size
                      </div>
                      <div className="text-sm font-bold text-slate-200 font-mono mt-1">
                        {activeRecord.width}×{activeRecord.height}
                      </div>
                    </div>
                    <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
                      <div className="text-[10px] font-mono uppercase text-slate-400">
                        Inference Latency
                      </div>
                      <div className="text-sm font-bold text-slate-200 font-mono mt-1">
                        {activeRecord.inferenceDurationMs} ms
                      </div>
                    </div>
                  </div>

                  {/* WICPS Geospatial Sighting & Triggered Alerts Integration Summary */}
                  {(() => {
                    const sightingBanner = formatSightingLinkBanner(
                      activeRecord.sightingIntegrationStatus,
                      activeRecord.generatedSightingId
                    );
                    const bannerClasses =
                      sightingBanner.tone === 'emerald'
                        ? 'bg-emerald-950/40 border-emerald-800/70 text-emerald-200'
                        : sightingBanner.tone === 'amber'
                        ? 'bg-amber-950/40 border-amber-800/70 text-amber-200'
                        : 'bg-slate-950/70 border-slate-800 text-slate-300';
                    return (
                      <div className={`rounded-xl border p-3 text-xs space-y-2 ${bannerClasses}`} data-testid="sighting-link-banner">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 shrink-0" />
                            <span>{sightingBanner.title}</span>
                          </span>
                          {activeRecord.locationName && (
                            <span className="font-mono text-[11px]">
                              {activeRecord.locationName}
                              {activeRecord.latitude !== null && activeRecord.latitude !== undefined
                                ? ` (${activeRecord.latitude.toFixed(4)}, ${activeRecord.longitude?.toFixed(4)})`
                                : ''}
                            </span>
                          )}
                        </div>
                        {(activeRecord.generatedAlerts?.length ?? 0) > 0 && (
                          <div className="space-y-1.5 pt-1 border-t border-slate-800/70">
                            {activeRecord.generatedAlerts?.map((al) => (
                              <div
                                key={al.id}
                                className="flex flex-wrap items-center justify-between gap-2 bg-red-950/50 border border-red-800/70 rounded-lg px-2.5 py-1.5 text-red-100"
                              >
                                <span className="font-bold flex items-center gap-1.5">
                                  <BellRing className="w-3.5 h-3.5 text-red-400" />
                                  <span>[{al.severity}] {al.title}</span>
                                </span>
                                <span className="font-mono text-[10px] text-red-200">
                                  {al.assignedOfficer ? `Assigned: ${al.assignedOfficer}` : al.affectedVillage}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Graceful No-Animal State */}
                  {activeRecord.animalCount === 0 && (
                    <div className="bg-slate-950/70 border border-slate-700/80 rounded-xl p-4 flex items-start gap-3 text-xs text-slate-300">
                      <HelpCircle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-white">No Animal Detected</div>
                        <p className="text-slate-400 mt-1">
                          MegaDetector v5 did not find any wildlife bounding boxes above the{' '}
                          {Math.round(activeRecord.modelMetadata.minDetectionConfidence * 100)}%
                          detection threshold. The image and empty result were saved to history.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Individual Detected Animals & Confidence Breakdown */}
                  {activeRecord.detections.length > 0 && (
                    <div className="space-y-2.5">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">
                        Detected Objects & Confidence Breakdown ({activeRecord.detections.length})
                      </h3>
                      <div className="space-y-3">
                        {activeRecord.detections.map((det) => {
                          const palette = BOX_PALETTE[(det.index - 1) % BOX_PALETTE.length];
                          const display = formatDetectionSpeciesDisplay(det);
                          return (
                            <div
                              key={det.index}
                              onMouseEnter={() => setHighlightedBoxIndex(det.index)}
                              onMouseLeave={() => setHighlightedBoxIndex(null)}
                              className="bg-slate-950/80 border border-slate-800 hover:border-slate-700 rounded-xl p-4 space-y-3 transition"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="flex items-center gap-2.5">
                                  <span
                                    className={`px-2 py-0.5 rounded text-xs font-bold font-mono border ${palette.badge}`}
                                  >
                                    #{det.index}
                                  </span>
                                  <div>
                                    <div className="text-sm font-bold text-white flex items-center gap-2">
                                      <span>{display.label}</span>
                                      {det.needsReview && (
                                        <ShieldAlert className="w-4 h-4 text-amber-400" />
                                      )}
                                    </div>
                                    {display.subtitle && (
                                      <div className="text-xs text-slate-400 italic">
                                        {display.subtitle}
                                        {det.taxonomicLevel ? ` • ${det.taxonomicLevel}` : ''}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="text-right font-mono text-[11px] text-slate-400">
                                  <div>
                                    Box: ({det.bbox.pixelXmin}, {det.bbox.pixelYmin}) •{' '}
                                    {det.bbox.pixelWidth}×{det.bbox.pixelHeight}px
                                  </div>
                                  <div className="text-[10px] text-slate-500">
                                    Source: {det.predictionSource || 'speciesnet'} • Country:{' '}
                                    {activeRecord.countryCode || 'Global'}
                                  </div>
                                </div>
                              </div>

                              {/* Separate Detector vs Species Confidence Bars */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                <div className="space-y-1">
                                  <div className="flex justify-between font-mono text-[11px]">
                                    <span className="text-slate-400">Detector (MegaDetector)</span>
                                    <span className="text-sky-300 font-bold">
                                      {(det.detectorConfidence * 100).toFixed(1)}%
                                    </span>
                                  </div>
                                  <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-sky-500 rounded-full"
                                      style={{
                                        width: `${Math.min(100, Math.round(det.detectorConfidence * 100))}%`,
                                      }}
                                    />
                                  </div>
                                </div>

                                <div className="space-y-1">
                                  <div className="flex justify-between font-mono text-[11px]">
                                    <span className="text-slate-400">Species (SpeciesNet)</span>
                                    <span
                                      className={`font-bold ${
                                        det.needsReview ? 'text-amber-300' : 'text-emerald-300'
                                      }`}
                                    >
                                      {(det.speciesConfidence * 100).toFixed(1)}%
                                    </span>
                                  </div>
                                  <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${
                                        det.needsReview ? 'bg-amber-500' : 'bg-emerald-500'
                                      }`}
                                      style={{
                                        width: `${Math.min(100, Math.round(det.speciesConfidence * 100))}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Phase 2 MegaDescriptor Re-ID & Crop Quality + Candidates */}
                              <div className="pt-2 border-t border-slate-800/80 space-y-2.5 text-[11px]">
                                {(() => {
                                  const reidBadge = formatReidDecisionBadge({
                                    decision: det.reidDecision,
                                    reviewStatus: det.reidReviewStatus,
                                    animalCode: det.animalCode,
                                    similarityScore: det.reidSimilarityScore,
                                  });
                                  return (
                                    <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/70 border border-slate-800 rounded-lg p-2.5">
                                      <div className="flex items-center gap-2.5 min-w-0">
                                        {det.cropImageUrl && (
                                          <AuthImage
                                            src={det.cropImageUrl}
                                            alt={`Crop #${det.index}`}
                                            className="w-11 h-11 rounded-md object-cover border border-slate-700 shrink-0"
                                          />
                                        )}
                                        <div className="space-y-0.5 min-w-0">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span
                                              className={`px-2 py-0.5 rounded border font-mono font-bold text-[10px] ${getReidBadgeClasses(
                                                reidBadge.tone
                                              )}`}
                                            >
                                              {reidBadge.label}
                                            </span>
                                            {reidBadge.similarityText && (
                                              <span className="font-mono text-sky-300 text-[10px]">
                                                {reidBadge.similarityText}
                                              </span>
                                            )}
                                          </div>
                                          {det.reidReviewReason && (
                                            <div className="text-[10px] text-slate-400 truncate">
                                              {det.reidReviewReason}
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      {det.cropQuality && (
                                        <div className="text-right font-mono text-[10px] text-slate-400 shrink-0">
                                          <div>
                                            Crop: {det.cropQuality.width}×{det.cropQuality.height}px • Blur {det.cropQuality.blurScore.toFixed(1)}
                                          </div>
                                          <div className={det.cropQuality.passed ? 'text-emerald-400' : 'text-amber-400'}>
                                            {det.cropQuality.passed ? 'QC Passed (Ref Stored)' : 'Low QC -> Manual Review'}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}

                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {det.topCandidates.slice(0, 3).map((cand, idx) => (
                                      <span
                                        key={`${cand.speciesLabel}-${idx}`}
                                        className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 font-mono"
                                      >
                                        {cand.speciesLabel} {(cand.confidence * 100).toFixed(1)}%
                                      </span>
                                    ))}
                                  </div>

                                  {det.reidTopCandidates && det.reidTopCandidates.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="text-[10px] font-mono text-slate-500">Re-ID Candidates:</span>
                                      {det.reidTopCandidates.slice(0, 3).map((rc) => (
                                        <span
                                          key={rc.animalIdentityId}
                                          className="px-1.5 py-0.5 rounded bg-sky-950/60 border border-sky-800/60 text-sky-300 font-mono text-[10px]"
                                        >
                                          {rc.animalCode} {(rc.similarityScore * 100).toFixed(1)}%
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>
        </>
      )}

      {/* Single Detection Delete Confirmation Dialog */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-detection-modal-title"
          data-testid="delete-detection-modal"
        >
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-800 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-950/80 border border-red-800/70 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4 text-red-400" />
                </div>
                <div>
                  <h3 id="delete-detection-modal-title" className="text-sm font-bold text-white">
                    Remove Detection Record?
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    This archives the selected entry from Previous Detection Results.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isDeletingSingle && setDeleteTarget(null)}
                disabled={isDeletingSingle}
                aria-label="Close delete confirmation"
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Detected Species</span>
                  <span className="font-bold text-white">
                    {deleteTarget.primarySpecies || getStatusBadgeProps(deleteTarget.processingStatus).label}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Source File</span>
                  <span className="font-mono text-slate-200 truncate max-w-[220px]">
                    {deleteTarget.sourceFilename}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Recorded At</span>
                  <span className="font-mono text-slate-300">
                    {formatTimestamp(deleteTarget.createdAt)}
                  </span>
                </div>
              </div>

              <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-3 text-emerald-200/90 leading-relaxed">
                Any linked wildlife sightings, conflict alerts, incidents, and Re-ID profiles remain
                preserved in the database for audit and conservation integrity.
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-950/60 border-t border-slate-800 flex items-center justify-end gap-2.5 text-xs">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeletingSingle}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSingleDelete}
                disabled={isDeletingSingle}
                data-testid="confirm-delete-detection-button"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold transition"
              >
                {isDeletingSingle ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Removing...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove Record</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear All Detection History Confirmation Dialog */}
      {isClearAllModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-all-detections-modal-title"
          data-testid="clear-all-detections-modal"
        >
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-800 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-950/80 border border-red-800/70 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                </div>
                <div>
                  <h3 id="clear-all-detections-modal-title" className="text-sm font-bold text-white">
                    Clear Detection History?
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Review the scope before archiving records from Previous Detection Results.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isClearingAll && setIsClearAllModalOpen(false)}
                disabled={isClearingAll}
                aria-label="Close clear all confirmation"
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <div className="bg-red-950/40 border border-red-800/60 rounded-xl p-3.5 text-red-100 leading-relaxed">
                This action will remove{' '}
                <strong className="font-mono text-white" data-testid="clear-all-affected-count">
                  {eligibleClearCount}
                </strong>{' '}
                eligible detection record{eligibleClearCount === 1 ? '' : 's'} from your visible
                history
                {searchQuery.trim() || statusFilter !== 'All'
                  ? ' matching your active search/status filters'
                  : ''}
                .
              </div>

              <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-3 text-emerald-200/90 leading-relaxed">
                Records are soft-archived with an audit trail. Linked wildlife sightings, conflict
                alerts, incidents, and Re-ID evidence remain intact and will not be deleted.
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-950/60 border-t border-slate-800 flex items-center justify-end gap-2.5 text-xs">
              <button
                type="button"
                onClick={() => setIsClearAllModalOpen(false)}
                disabled={isClearingAll}
                data-testid="cancel-clear-all-button"
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClearAll}
                disabled={isClearingAll || eligibleClearCount === 0}
                data-testid="confirm-clear-all-button"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold transition"
              >
                {isClearingAll ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Clearing History...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear {eligibleClearCount} Record{eligibleClearCount === 1 ? '' : 's'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
