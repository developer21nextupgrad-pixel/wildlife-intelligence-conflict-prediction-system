import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CameraProtocol,
  CameraStatus,
  CameraZoneType,
  DevSampleIngestResult,
  RtspTestPullResult,
  ThermalCamera,
  ThermalCameraCreateResult,
  ThermalFrameRecord,
  VillageRiskProfile,
} from '../types';
import { apiBridge } from '../services/apiBridge';
import {
  maskRtspUrlCredentials,
  ThermalFrameFilterParams,
  validateThermalCameraForm,
  validateThermalSampleFile,
} from '../utils/apiMappers';
import {
  Activity,
  AlertTriangle,
  Camera as CameraIcon,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileVideo,
  Filter,
  Image as ImageIcon,
  KeyRound,
  Maximize2,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';

interface ThermalIngestionViewProps {
  villages: VillageRiskProfile[];
}

interface RegisterCameraFormState {
  cameraCode: string;
  name: string;
  villageId: string;
  zoneName: string;
  zoneType: CameraZoneType | '';
  protocol: CameraProtocol | '';
  latitude: string;
  longitude: string;
  streamUrl: string;
  isDevTest: boolean;
}

function buildEmptyCameraForm(): RegisterCameraFormState {
  return {
    cameraCode: '',
    name: '',
    villageId: '',
    zoneName: '',
    zoneType: '',
    protocol: '',
    latitude: '',
    longitude: '',
    streamUrl: '',
    isDevTest: false,
  };
}

interface RtspFormState {
  cameraId: string;
  rtspUrl: string;
  maxFrames: string;
  timeoutSeconds: string;
}

function buildEmptyRtspForm(): RtspFormState {
  return {
    cameraId: '',
    rtspUrl: '',
    maxFrames: '3',
    timeoutSeconds: '5',
  };
}

type InspectorViewMode = 'side-by-side' | 'raw' | 'processed';

const FRAMES_PAGE_SIZE = 20;

function formatUtcTimestamp(value?: string | null): string {
  if (!value) return 'Never';
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

function formatMetric(value: unknown, digits = 2): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toFixed(digits);
  }
  return 'N/A';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const ThermalIngestionView: React.FC<ThermalIngestionViewProps> = ({ villages }) => {
  const [cameras, setCameras] = useState<ThermalCamera[]>([]);
  const [frames, setFrames] = useState<ThermalFrameRecord[]>([]);
  const [totalFrames, setTotalFrames] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [page, setPage] = useState<number>(1);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [noticeBanner, setNoticeBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // One-time generated camera API key shown right after modal closes
  const [issuedCameraSecret, setIssuedCameraSecret] = useState<ThermalCameraCreateResult | null>(
    null
  );
  const [copiedTokenKey, setCopiedTokenKey] = useState<string | null>(null);

  // Filters
  const [filterCameraId, setFilterCameraId] = useState<string>('All');
  const [filterQcStatus, setFilterQcStatus] = useState<'all' | 'accepted' | 'rejected'>('all');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Inspector image mode & zoom preview modal
  const [inspectorViewMode, setInspectorViewMode] = useState<InspectorViewMode>('side-by-side');
  const [previewLightbox, setPreviewLightbox] = useState<{
    title: string;
    subtitle: string;
    url: string;
  } | null>(null);

  // Camera Registration Modal
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState<boolean>(false);
  const [cameraForm, setCameraForm] = useState<RegisterCameraFormState>(buildEmptyCameraForm);
  const [cameraFormError, setCameraFormError] = useState<string | null>(null);
  const [isSubmittingCamera, setIsSubmittingCamera] = useState<boolean>(false);

  // Dev Sample Upload Modal
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadMediaType, setUploadMediaType] = useState<'image' | 'video' | null>(null);
  const [uploadCameraId, setUploadCameraId] = useState<string>('');
  const [uploadTargetFps, setUploadTargetFps] = useState<string>('5.0');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [lastUploadResult, setLastUploadResult] = useState<DevSampleIngestResult | null>(null);

  // Camera Integration / RTSP Test Modal
  const [isRtspModalOpen, setIsRtspModalOpen] = useState<boolean>(false);
  const [rtspForm, setRtspForm] = useState<RtspFormState>(buildEmptyRtspForm);
  const [rtspError, setRtspError] = useState<string | null>(null);
  const [isTestingRtsp, setIsTestingRtsp] = useState<boolean>(false);
  const [rtspResult, setRtspResult] = useState<RtspTestPullResult | null>(null);

  // Per-camera status update & delete confirmation state
  const [updatingCameraId, setUpdatingCameraId] = useState<string | null>(null);
  const [cameraPendingDelete, setCameraPendingDelete] = useState<ThermalCamera | null>(null);
  const [cameraDeleteError, setCameraDeleteError] = useState<string | null>(null);
  const [isDeletingCamera, setIsDeletingCamera] = useState<boolean>(false);

  // Image loading errors for inspector
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  const activeFilters: ThermalFrameFilterParams = useMemo(
    () => ({
      cameraId: filterCameraId,
      qcPassed: filterQcStatus,
      dateFrom: filterDateFrom || undefined,
      dateTo: filterDateTo || undefined,
      search: searchQuery || undefined,
      page,
      pageSize: FRAMES_PAGE_SIZE,
    }),
    [filterCameraId, filterQcStatus, filterDateFrom, filterDateTo, searchQuery, page]
  );

  const loadData = useCallback(async (filtersToUse: ThermalFrameFilterParams) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [camList, framePage] = await Promise.all([
        apiBridge.getCameras(),
        apiBridge.getThermalFrames(filtersToUse),
      ]);
      setCameras(camList);
      setFrames(framePage.items);
      setTotalFrames(framePage.total);
      setTotalPages(Math.max(1, framePage.totalPages || 1));
      setSelectedFrameId((prev) => {
        if (prev && framePage.items.some((f) => f.id === prev)) {
          return prev;
        }
        return framePage.items[0]?.id ?? null;
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to load thermal ingestion cameras and frames.';
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(activeFilters);
  }, [loadData, activeFilters]);

  const selectedFrame = useMemo(
    () => frames.find((f) => f.id === selectedFrameId) ?? frames[0] ?? null,
    [frames, selectedFrameId]
  );

  const metrics = useMemo(() => {
    const accepted = frames.filter((f) => f.qcPassed).length;
    const rejected = frames.filter((f) => !f.qcPassed).length;
    const activeCameras = cameras.filter((c) => c.status === 'active').length;
    return {
      totalCameras: cameras.length,
      activeCameras,
      visibleFrames: frames.length,
      totalFrames,
      accepted,
      rejected,
    };
  }, [cameras, frames, totalFrames]);

  const copyText = async (tokenKey: string, value: string) => {
    let copied = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied && typeof document !== 'undefined') {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        copied = false;
      }
    }

    if (copied) {
      setCopiedTokenKey(tokenKey);
      setTimeout(() => {
        setCopiedTokenKey((cur) => (cur === tokenKey ? null : cur));
      }, 2000);
    } else {
      setNoticeBanner({
        type: 'error',
        message: 'Clipboard access blocked by browser. Copy the value manually.',
      });
    }
  };

  // --- Camera Registration Handlers ---
  const handleOpenRegisterModal = () => {
    setCameraForm(buildEmptyCameraForm());
    setCameraFormError(null);
    setIsRegisterModalOpen(true);
  };

  const handleUseSelectedVillageCoords = () => {
    const selected = villages.find((v) => v.id === cameraForm.villageId);
    if (!selected) return;
    setCameraForm((prev) => ({
      ...prev,
      latitude: String(selected.coordinates[0]),
      longitude: String(selected.coordinates[1]),
    }));
  };

  const handleSubmitCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationErr = validateThermalCameraForm({
      cameraCode: cameraForm.cameraCode,
      name: cameraForm.name,
      zoneName: cameraForm.zoneName,
      zoneType: cameraForm.zoneType,
      protocol: cameraForm.protocol,
      latitude: cameraForm.latitude,
      longitude: cameraForm.longitude,
    });
    if (validationErr) {
      setCameraFormError(validationErr);
      return;
    }

    const selectedVillage = villages.find((v) => v.id === cameraForm.villageId);

    setIsSubmittingCamera(true);
    setCameraFormError(null);
    try {
      const result = await apiBridge.registerCamera({
        cameraCode: cameraForm.cameraCode.trim(),
        name: cameraForm.name.trim(),
        villageId: cameraForm.villageId || undefined,
        villageName: selectedVillage?.name,
        zoneName: cameraForm.zoneName.trim(),
        zoneType: cameraForm.zoneType as CameraZoneType,
        protocol: cameraForm.protocol as CameraProtocol,
        latitude: Number(cameraForm.latitude),
        longitude: Number(cameraForm.longitude),
        streamMetadata: cameraForm.streamUrl.trim()
          ? { stream_url: cameraForm.streamUrl.trim() }
          : {},
        status: 'active',
        isDevTest: cameraForm.isDevTest,
      });

      // Close registration form immediately, refresh list & counters, and reveal one-time key banner
      setIsRegisterModalOpen(false);
      setCameraForm(buildEmptyCameraForm());
      setIssuedCameraSecret(result);
      setNoticeBanner({
        type: 'success',
        message: `Registered thermal camera ${result.cameraCode}. Copy its one-time X-Camera-Key credential from the banner below.`,
      });
      await loadData(activeFilters);
    } catch (err) {
      setCameraFormError(
        err instanceof Error ? err.message : 'Failed to register thermal camera.'
      );
    } finally {
      setIsSubmittingCamera(false);
    }
  };

  const handleCameraStatusChange = async (cameraId: string, nextStatus: CameraStatus) => {
    setUpdatingCameraId(cameraId);
    try {
      const updated = await apiBridge.updateCameraStatus(cameraId, nextStatus);
      setCameras((prev) => prev.map((c) => (c.id === cameraId ? updated : c)));
      setNoticeBanner({
        type: 'success',
        message: `Updated ${updated.cameraCode} status to ${updated.status}.`,
      });
    } catch (err) {
      setNoticeBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to update camera status.',
      });
    } finally {
      setUpdatingCameraId(null);
    }
  };

  const handleOpenDeleteCameraModal = (camera: ThermalCamera) => {
    setCameraDeleteError(null);
    setCameraPendingDelete(camera);
  };

  const handleConfirmDeleteCamera = async () => {
    if (!cameraPendingDelete || isDeletingCamera) return;

    const target = cameraPendingDelete;
    setIsDeletingCamera(true);
    setCameraDeleteError(null);
    try {
      const result = await apiBridge.deleteCamera(target.id);
      setCameraPendingDelete(null);

      if (issuedCameraSecret?.id === target.id) {
        setIssuedCameraSecret(null);
      }
      if (uploadCameraId === target.id) {
        setUploadCameraId('');
      }
      if (rtspForm.cameraId === target.id) {
        setRtspForm((prev) => ({ ...prev, cameraId: '' }));
      }

      const nextFilters: ThermalFrameFilterParams =
        filterCameraId === target.id
          ? { ...activeFilters, cameraId: 'All', page: 1 }
          : activeFilters;

      if (filterCameraId === target.id) {
        setFilterCameraId('All');
        setPage(1);
      } else {
        await loadData(nextFilters);
      }

      const preservedCount = result.preserved_frames ?? 0;
      setNoticeBanner({
        type: 'success',
        message:
          preservedCount > 0
            ? `Deleted thermal camera ${target.cameraCode} (${target.name}). ${preservedCount} historical thermal frame(s) and storage objects were preserved.`
            : `Deleted thermal camera ${target.cameraCode} (${target.name}).`,
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : `Failed to delete thermal camera ${target.cameraCode}.`;
      setCameraDeleteError(msg);
      setNoticeBanner({
        type: 'error',
        message: msg,
      });
    } finally {
      setIsDeletingCamera(false);
    }
  };

  // --- Sample Upload Handlers ---
  const handleOpenUploadModal = () => {
    setUploadFile(null);
    setUploadMediaType(null);
    setUploadCameraId('');
    setUploadTargetFps('5.0');
    setUploadError(null);
    setUploadProgress(0);
    setLastUploadResult(null);
    setIsUploadModalOpen(true);
  };

  const handleSelectUploadFile = (file: File | null) => {
    setLastUploadResult(null);
    setUploadProgress(0);
    if (!file) {
      setUploadFile(null);
      setUploadMediaType(null);
      setUploadError(null);
      return;
    }
    const validation = validateThermalSampleFile(file);
    if (!validation.valid) {
      setUploadFile(null);
      setUploadMediaType(null);
      setUploadError(validation.error);
      return;
    }
    setUploadFile(file);
    setUploadMediaType(validation.mediaType);
    setUploadError(null);
  };

  const handleSubmitUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      setUploadError(
        'Please select a valid thermal image (.png, .jpg, .jpeg, .tif/.tiff) or video (.mp4, .avi).'
      );
      return;
    }
    const validation = validateThermalSampleFile(uploadFile);
    if (!validation.valid) {
      setUploadError(validation.error);
      return;
    }

    const fps = Number(uploadTargetFps);
    if (validation.mediaType === 'video' && (!Number.isFinite(fps) || fps < 0.1 || fps > 30)) {
      setUploadError('Target extraction FPS must be between 0.1 and 30.');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    try {
      const result = await apiBridge.uploadDevSample({
        file: uploadFile,
        cameraId: uploadCameraId || undefined,
        targetFps: validation.mediaType === 'video' ? fps : undefined,
        onProgress: (pct) => setUploadProgress(pct),
      });
      setUploadProgress(100);
      setLastUploadResult(result);
      setNoticeBanner({
        type: 'success',
        message: `Processed ${result.extractedCount} frame(s) from ${uploadFile.name}: ${result.acceptedCount} accepted, ${result.rejectedCount} rejected.`,
      });
      const nextFilters: ThermalFrameFilterParams = { ...activeFilters, page: 1 };
      if (page !== 1) {
        setPage(1);
      } else {
        await loadData(nextFilters);
      }
      if (result.frames.length > 0) {
        setSelectedFrameId(result.frames[0].id);
      }
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Thermal sample upload and preprocessing failed.'
      );
    } finally {
      setIsUploading(false);
    }
  };

  // --- Camera Integration / RTSP Handlers ---
  const handleOpenRtspModal = (preselectedCameraId = '') => {
    setRtspForm({
      ...buildEmptyRtspForm(),
      cameraId: preselectedCameraId,
    });
    setRtspError(null);
    setRtspResult(null);
    setIsRtspModalOpen(true);
  };

  const handleSubmitRtspTest = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawUrl = rtspForm.rtspUrl.trim();
    if (!rawUrl || (!rawUrl.startsWith('rtsp://') && !rawUrl.startsWith('rtsps://'))) {
      setRtspError('Enter a valid rtsp:// or rtsps:// stream URL provided by the IoT team.');
      return;
    }
    const maxFrames = Number(rtspForm.maxFrames);
    const timeoutSeconds = Number(rtspForm.timeoutSeconds);
    if (!Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > 10) {
      setRtspError('Maximum frame count must be an integer between 1 and 10.');
      return;
    }
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 20) {
      setRtspError('Connection timeout must be between 1 and 20 seconds.');
      return;
    }

    setIsTestingRtsp(true);
    setRtspError(null);
    setRtspResult(null);
    try {
      const res = await apiBridge.testRtspPull({
        cameraId: rtspForm.cameraId || undefined,
        rtspUrl: rawUrl,
        maxFrames,
        timeoutSeconds,
      });
      setRtspResult(res);
      setNoticeBanner({
        type: 'success',
        message: `RTSP connection verified (${res.maskedRtspUrl}): pulled ${res.framesRetrieved} frame(s).`,
      });
      if (page !== 1) {
        setPage(1);
      } else {
        await loadData(activeFilters);
      }
      if (res.frames.length > 0) {
        setSelectedFrameId(res.frames[0].id);
      }
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'RTSP connectivity test failed.';
      setRtspError(maskRtspUrlCredentials(rawMsg));
    } finally {
      setIsTestingRtsp(false);
    }
  };

  const handleResetFilters = () => {
    setFilterCameraId('All');
    setFilterQcStatus('all');
    setFilterDateFrom('');
    setFilterDateTo('');
    setSearchQuery('');
    setPage(1);
  };

  const rawImageUrl = selectedFrame
    ? apiBridge.getThermalFrameImageUrl(selectedFrame.id, 'raw', true)
    : '';
  const rawOriginalDownloadUrl = selectedFrame
    ? apiBridge.getThermalFrameImageUrl(selectedFrame.id, 'raw', false)
    : '';
  const processedImageUrl =
    selectedFrame && selectedFrame.qcPassed && selectedFrame.processedObjectKey
      ? apiBridge.getThermalFrameImageUrl(selectedFrame.id, 'processed', false)
      : '';

  const activeEndpointUrl = apiBridge.getApiBaseUrl();

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      {/* Page Header & Primary Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-emerald-400 font-bold uppercase tracking-wider">
            <span>Stage 1 Ingestion Boundary</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>OpenCV + NumPy Preprocessing</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight mt-1">
            Thermal Camera Ingestion &amp; Preprocessing Console
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Register boundary cameras, validate incoming 8-bit/16-bit thermal frames and video clips, run Gaussian denoising + CLAHE + 640×640 letterbox preprocessing, and audit object storage artifacts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleOpenRegisterModal}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-sm transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Register Camera</span>
          </button>
          <button
            type="button"
            onClick={handleOpenUploadModal}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-700/50 text-xs font-bold rounded-xl transition cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>Upload Thermal Sample</span>
          </button>
          <button
            type="button"
            onClick={() => handleOpenRtspModal('')}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold rounded-xl transition cursor-pointer"
          >
            <Radio className="w-4 h-4 text-sky-400" />
            <span>Camera Integration</span>
          </button>
          <button
            type="button"
            onClick={() => loadData(activeFilters)}
            disabled={isLoading}
            aria-label="Refresh Thermal Ingestion Data"
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-semibold rounded-xl transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Honest Development / Phase 1 Scope Disclosure Banner */}
      <div
        role="note"
        className="bg-amber-950/35 border border-amber-700/50 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div className="flex items-start gap-2.5 text-xs text-amber-100">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-mono font-bold uppercase tracking-wider text-amber-300">
              DEVELOPMENT / TEST MODE — STAGE 1 INGESTION &amp; QC ONLY:
            </span>{' '}
            <span className="text-amber-100/90">
              Physical thermal camera hardware, mounting, power, and network availability belong to the IoT team. This console executes real OpenCV/NumPy quality validation and preprocessing only — no live camera stream is claimed without an explicit RTSP test pull, and zero YOLO wildlife detections or confidence scores are fabricated.
            </span>
          </div>
        </div>
        <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-amber-900/50 border border-amber-700/60 text-amber-200 shrink-0 self-start sm:self-center">
          Phase 1.1 Active
        </span>
      </div>

      {/* One-Time Issued Camera API Key Banner (shown only right after registration) */}
      {issuedCameraSecret && (
        <div
          role="region"
          aria-label="One-time generated camera API key"
          className="bg-emerald-950/55 border border-emerald-600/70 rounded-xl p-4 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-emerald-300 font-bold text-xs">
              <KeyRound className="w-4 h-4" />
              <span>
                One-Time Camera API Key Issued for {issuedCameraSecret.cameraCode} (
                {issuedCameraSecret.name})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIssuedCameraSecret(null)}
              aria-label="Dismiss issued API key banner"
              className="text-slate-400 hover:text-white p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-amber-200">{issuedCameraSecret.apiKeyNotice}</p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-slate-950 border border-slate-700 rounded-lg p-2.5">
            <code className="text-xs font-mono text-emerald-300 break-all flex-1">
              {issuedCameraSecret.apiKey}
            </code>
            <button
              type="button"
              onClick={() => copyText('camera-api-key', issuedCameraSecret.apiKey)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 self-start sm:self-auto"
            >
              {copiedTokenKey === 'camera-api-key' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Copied Key</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Key</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Feedback Banner */}
      {noticeBanner && (
        <div
          role="status"
          className={`rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs border ${
            noticeBanner.type === 'success'
              ? 'bg-emerald-950/50 border-emerald-700/60 text-emerald-100'
              : 'bg-red-950/60 border-red-700/60 text-red-100'
          }`}
        >
          <div className="flex items-center gap-2">
            {noticeBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            )}
            <span>{noticeBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setNoticeBanner(null)}
            aria-label="Dismiss notification"
            className="text-slate-400 hover:text-white p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Load Error Banner with Diagnostic Context & Retry */}
      {loadError && (
        <div
          role="alert"
          className="bg-red-950/60 border border-red-700/70 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-red-100"
        >
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="min-w-0 space-y-0.5">
              <div className="font-bold text-red-200">{loadError}</div>
              <div className="text-[11px] font-mono text-red-300/90 break-all">
                Active API Base URL: {activeEndpointUrl}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => loadData(activeFilters)}
            className="px-3 py-1.5 bg-red-800 hover:bg-red-700 text-white rounded-lg font-semibold shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Registered Cameras</span>
            <CameraIcon className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-white mt-2 font-mono">{metrics.totalCameras}</div>
          <div className="text-[11px] text-slate-400 mt-1">
            {metrics.activeCameras} active endpoints
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Ingested Frames</span>
            <Activity className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-black text-white mt-2 font-mono">{metrics.totalFrames}</div>
          <div className="text-[11px] text-slate-400 mt-1">
            Showing {metrics.visibleFrames} on page {page}/{totalPages}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>QC Accepted (Page)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400 mt-2 font-mono">
            {metrics.accepted}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">640×640 CLAHE PNG stored</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>QC Rejected (Page)</span>
            <XCircle className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl font-black text-red-400 mt-2 font-mono">{metrics.rejected}</div>
          <div className="text-[11px] text-slate-400 mt-1">Blank, low-res, or corrupted</div>
        </div>
      </div>

      {/* Registered Cameras Registry */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2 bg-slate-900/70">
          <div className="flex items-center gap-2">
            <CameraIcon className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white">Registered Thermal Boundary Cameras</h2>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            Auth: Salted PBKDF2 X-Camera-Key (hash never exposed)
          </span>
        </div>

        {cameras.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">
            No thermal cameras registered yet. Click{' '}
            <span className="text-emerald-300 font-semibold">Register Camera</span> to onboard an
            endpoint or use{' '}
            <span className="text-emerald-300 font-semibold">Upload Thermal Sample</span> in
            DEVELOPMENT / TEST MODE.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-mono uppercase text-slate-400 bg-slate-950/50">
                  <th className="py-2.5 px-4">Camera Code</th>
                  <th className="py-2.5 px-4">Name &amp; Zone</th>
                  <th className="py-2.5 px-4">Protocol</th>
                  <th className="py-2.5 px-4">Coordinates</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Last Heartbeat</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {cameras.map((cam) => (
                  <tr key={cam.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-2.5 px-4 font-mono font-semibold text-emerald-300">
                      <div className="flex items-center gap-2">
                        <span>{cam.cameraCode}</span>
                        {cam.isDevTest && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-700/50">
                            DEV TEST
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-white">{cam.name}</div>
                      <div className="text-[11px] text-slate-400">
                        {cam.zoneName} · <span className="font-mono">{cam.zoneType}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-300">{cam.protocol}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-400">
                      {cam.latitude.toFixed(4)}, {cam.longitude.toFixed(4)}
                    </td>
                    <td className="py-2.5 px-4">
                      <select
                        aria-label={`Status for ${cam.cameraCode}`}
                        value={cam.status}
                        disabled={updatingCameraId === cam.id}
                        onChange={(e) =>
                          handleCameraStatusChange(cam.id, e.target.value as CameraStatus)
                        }
                        className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                      >
                        <option value="active">active</option>
                        <option value="maintenance">maintenance</option>
                        <option value="offline">offline</option>
                      </select>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-400">
                      {formatUtcTimestamp(cam.lastHeartbeatAt)}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setFilterCameraId(cam.id);
                            setPage(1);
                          }}
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-[11px] font-medium transition cursor-pointer"
                        >
                          Filter Frames
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenRtspModal(cam.id)}
                          className="px-2 py-1 bg-sky-950 hover:bg-sky-900 text-sky-300 border border-sky-800/60 rounded-md text-[11px] font-medium transition cursor-pointer"
                        >
                          Test RTSP
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenDeleteCameraModal(cam)}
                          aria-label={`Delete camera ${cam.cameraCode}`}
                          title={`Delete ${cam.cameraCode}`}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-red-950/70 hover:bg-red-900/80 text-red-300 border border-red-800/60 rounded-md text-[11px] font-medium transition cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Filter Bar */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          <Filter className="w-3.5 h-3.5 text-emerald-400" />
          <span>Frame Audit Filters</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div>
            <label
              htmlFor="filter-camera"
              className="block text-[11px] font-mono text-slate-400 mb-1"
            >
              Camera
            </label>
            <select
              id="filter-camera"
              value={filterCameraId}
              onChange={(e) => {
                setFilterCameraId(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              <option value="All">All Cameras</option>
              {cameras.map((cam) => (
                <option key={cam.id} value={cam.id}>
                  {cam.cameraCode} ({cam.zoneName})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-qc" className="block text-[11px] font-mono text-slate-400 mb-1">
              QC Status
            </label>
            <select
              id="filter-qc"
              value={filterQcStatus}
              onChange={(e) => {
                setFilterQcStatus(e.target.value as 'all' | 'accepted' | 'rejected');
                setPage(1);
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              <option value="all">All Statuses</option>
              <option value="accepted">Accepted (Preprocessed)</option>
              <option value="rejected">Rejected (QC Failed)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="filter-date-from"
              className="block text-[11px] font-mono text-slate-400 mb-1"
            >
              Date From
            </label>
            <input
              id="filter-date-from"
              type="date"
              value={filterDateFrom}
              onChange={(e) => {
                setFilterDateFrom(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label
              htmlFor="filter-date-to"
              className="block text-[11px] font-mono text-slate-400 mb-1"
            >
              Date To
            </label>
            <input
              id="filter-date-to"
              type="date"
              value={filterDateTo}
              onChange={(e) => {
                setFilterDateTo(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label
              htmlFor="filter-search"
              className="block text-[11px] font-mono text-slate-400 mb-1"
            >
              Search Filename / Reason
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
              <input
                id="filter-search"
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="e.g. .tiff, blank, thermal..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={handleResetFilters}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filters</span>
            </button>
          </div>
        </div>
      </section>

      {/* Main Split: Frame List + Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left: Frame List + Pagination */}
        <section className="xl:col-span-5 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/70">
            <h2 className="text-sm font-bold text-white">
              Ingested Frames ({totalFrames})
            </h2>
            <span className="text-[11px] font-mono text-slate-400">
              Page {page} of {totalPages}
            </span>
          </div>

          {isLoading && frames.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              Loading thermal ingestion frames...
            </div>
          ) : frames.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 space-y-2 flex-1">
              <ImageIcon className="w-7 h-7 text-slate-600 mx-auto" />
              <div>No thermal frames match the current filters.</div>
              <div className="text-[11px] text-slate-500">
                Upload a thermal image or video clip using &ldquo;Upload Thermal Sample&rdquo; to
                inspect OpenCV preprocessing output.
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80 max-h-[620px] overflow-y-auto flex-1">
              {frames.map((frame) => {
                const isSelected = selectedFrame?.id === frame.id;
                return (
                  <button
                    key={frame.id}
                    type="button"
                    onClick={() => setSelectedFrameId(frame.id)}
                    className={`w-full text-left px-4 py-3 transition flex items-start justify-between gap-3 cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-950/45 border-l-4 border-l-emerald-500'
                        : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-white truncate max-w-[200px]">
                          {frame.sourceFilename || 'frame'}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                          #{frame.frameIndex}
                        </span>
                        {frame.pixelFormat === 'uint16_radiometric' && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800/60">
                            16-bit
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-emerald-300/90">
                          {frame.cameraCode || 'Archived Camera'}
                        </span>
                        {!frame.cameraId && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                            Deleted Camera
                          </span>
                        )}
                        <span>·</span>
                        <span>
                          {frame.width}×{frame.height}
                        </span>
                        <span>·</span>
                        <span className="font-mono">{frame.captureMode}</span>
                      </div>
                      {!frame.qcPassed && frame.rejectionReason && (
                        <div className="text-[11px] text-red-300 line-clamp-2">
                          {frame.rejectionReason}
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span
                        className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md uppercase ${
                          frame.qcPassed
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                            : 'bg-red-950 text-red-300 border border-red-700/60'
                        }`}
                      >
                        {frame.qcPassed ? 'QC Passed' : 'QC Rejected'}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">
                        {formatUtcTimestamp(frame.capturedAt)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Pagination Footer */}
          <div className="px-4 py-2.5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs">
            <span className="text-[11px] font-mono text-slate-400">
              Showing {frames.length} of {totalFrames}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={page <= 1 || isLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>
              <button
                type="button"
                disabled={page >= totalPages || isLoading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </section>

        {/* Right: Side-by-Side / Raw / Processed Frame Inspector */}
        <section className="xl:col-span-7 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-900/70">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-bold text-white">
                Side-by-Side Thermal Preprocessing Inspector
              </h2>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Raw / Processed / Side-by-Side Selector */}
              <div
                role="group"
                aria-label="Frame image variant selector"
                className="inline-flex rounded-lg bg-slate-950 border border-slate-800 p-0.5 text-[11px]"
              >
                <button
                  type="button"
                  onClick={() => setInspectorViewMode('side-by-side')}
                  className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                    inspectorViewMode === 'side-by-side'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Side-by-Side
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorViewMode('raw')}
                  className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                    inspectorViewMode === 'raw'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Raw Original
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorViewMode('processed')}
                  className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                    inspectorViewMode === 'processed'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Processed 640×640
                </button>
              </div>

              {selectedFrame && (
                <button
                  type="button"
                  onClick={() => copyText('frame-id', selectedFrame.id)}
                  className="text-[11px] font-mono text-slate-300 hover:text-white bg-slate-950 border border-slate-800 px-2 py-1 rounded-md flex items-center gap-1 cursor-pointer"
                  title="Copy full frame UUID"
                >
                  {copiedTokenKey === 'frame-id' ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Copied ID</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>ID: {selectedFrame.id.slice(0, 8)}…</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {!selectedFrame ? (
            <div className="p-10 text-center text-xs text-slate-400">
              Select a thermal frame from the left list to inspect original vs 640×640 CLAHE output
              and quality metrics.
            </div>
          ) : (
            <div className="p-4 space-y-5">
              {/* Rejection Reason Callout */}
              {!selectedFrame.qcPassed && (
                <div
                  role="alert"
                  className="bg-red-950/60 border border-red-700/70 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-red-100"
                >
                  <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-red-200">
                      Quality Validation Failed ({selectedFrame.processingStatus})
                    </div>
                    <div className="text-red-200/90 mt-0.5">
                      {selectedFrame.rejectionReason || 'Frame rejected by Stage 1 quality gate.'}
                    </div>
                  </div>
                </div>
              )}

              {/* Side-by-Side or Focused Variant Images */}
              <div
                className={`grid gap-4 ${
                  inspectorViewMode === 'side-by-side' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'
                }`}
              >
                {(inspectorViewMode === 'side-by-side' || inspectorViewMode === 'raw') && (
                  <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
                    <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between gap-2 text-[11px] font-mono">
                      <span className="text-slate-200 font-bold">Original Thermal Frame</span>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">
                          {selectedFrame.width}×{selectedFrame.height} · {selectedFrame.pixelFormat}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewLightbox({
                              title: `Original Thermal Frame (${selectedFrame.sourceFilename || selectedFrame.id})`,
                              subtitle: `${selectedFrame.width}×${selectedFrame.height} · ${selectedFrame.pixelFormat}`,
                              url: rawImageUrl,
                            })
                          }
                          aria-label="Open full original thermal preview"
                          className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                          title="Open full preview"
                        >
                          <Maximize2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div className="h-72 flex items-center justify-center bg-black p-2">
                      {brokenImages[`raw-${selectedFrame.id}`] ? (
                        <div className="text-center text-xs text-red-300 px-4">
                          Unable to decode browser preview for raw thermal artifact.
                        </div>
                      ) : (
                        <img
                          src={rawImageUrl}
                          alt={`Original thermal frame ${selectedFrame.sourceFilename || selectedFrame.id}`}
                          onError={() =>
                            setBrokenImages((prev) => ({
                              ...prev,
                              [`raw-${selectedFrame.id}`]: true,
                            }))
                          }
                          className="max-h-full max-w-full object-contain"
                        />
                      )}
                    </div>
                    <div className="px-3 py-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 font-mono">
                        {selectedFrame.pixelFormat === 'uint16_radiometric'
                          ? '8-bit display copy (16-bit TIFF intact)'
                          : 'Raw frame bytes'}
                      </span>
                      <a
                        href={rawOriginalDownloadUrl}
                        download={selectedFrame.sourceFilename || `raw_${selectedFrame.id}`}
                        className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200 font-semibold"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download Raw</span>
                      </a>
                    </div>
                  </div>
                )}

                {(inspectorViewMode === 'side-by-side' || inspectorViewMode === 'processed') && (
                  <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
                    <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between gap-2 text-[11px] font-mono">
                      <span className="text-emerald-300 font-bold">
                        Processed 640×640 CLAHE Frame
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">
                          {selectedFrame.qcPassed
                            ? `${selectedFrame.qcMetrics.processed_width ?? 640}×${
                                selectedFrame.qcMetrics.processed_height ?? 640
                              } PNG`
                            : 'Not generated'}
                        </span>
                        {selectedFrame.qcPassed && processedImageUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewLightbox({
                                title: `Processed 640×640 CLAHE Frame (${selectedFrame.sourceFilename || selectedFrame.id})`,
                                subtitle: `Gaussian 3x3 + CLAHE + Letterbox 640×640 PNG`,
                                url: processedImageUrl,
                              })
                            }
                            aria-label="Open full processed 640x640 preview"
                            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                            title="Open full preview"
                          >
                            <Maximize2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="h-72 flex items-center justify-center bg-black p-2">
                      {selectedFrame.qcPassed && processedImageUrl ? (
                        brokenImages[`proc-${selectedFrame.id}`] ? (
                          <div className="text-center text-xs text-red-300 px-4">
                            Processed frame image failed to load from object storage.
                          </div>
                        ) : (
                          <img
                            src={processedImageUrl}
                            alt={`Processed 640x640 CLAHE frame ${selectedFrame.sourceFilename || selectedFrame.id}`}
                            onError={() =>
                              setBrokenImages((prev) => ({
                                ...prev,
                                [`proc-${selectedFrame.id}`]: true,
                              }))
                            }
                            className="max-h-full max-w-full object-contain"
                          />
                        )
                      ) : (
                        <div className="text-center text-xs text-slate-400 px-4 space-y-1">
                          <XCircle className="w-6 h-6 text-red-400 mx-auto" />
                          <div className="font-semibold text-red-300">
                            No Processed Frame Generated
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Raw frame is preserved in object storage for audit; preprocessing was
                            skipped after QC rejection.
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="px-3 py-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 font-mono">
                        {selectedFrame.qcPassed ? 'Letterbox 640×640 PNG' : 'QC Rejected'}
                      </span>
                      {selectedFrame.qcPassed && processedImageUrl ? (
                        <a
                          href={processedImageUrl}
                          download={`processed_640x640_${selectedFrame.id}.png`}
                          className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200 font-semibold"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download PNG</span>
                        </a>
                      ) : (
                        <span className="text-slate-600 font-mono">Unavailable</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Quality Metrics Grid */}
              <div>
                <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-bold mb-2">
                  Quality &amp; Preprocessing Telemetry (OpenCV / NumPy)
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                    <div className="text-[10px] font-mono text-slate-400">Dimensions</div>
                    <div className="font-mono font-bold text-white mt-0.5">
                      {selectedFrame.width} × {selectedFrame.height}
                    </div>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                    <div className="text-[10px] font-mono text-slate-400">Bit Depth</div>
                    <div className="font-mono font-bold text-white mt-0.5">
                      {selectedFrame.qcMetrics.bit_depth ?? 'N/A'}-bit
                    </div>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                    <div className="text-[10px] font-mono text-slate-400">Laplacian Sharpness</div>
                    <div className="font-mono font-bold text-emerald-300 mt-0.5">
                      {formatMetric(selectedFrame.qcMetrics.sharpness_laplacian)}
                    </div>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                    <div className="text-[10px] font-mono text-slate-400">Dynamic Range</div>
                    <div className="font-mono font-bold text-white mt-0.5">
                      {formatMetric(selectedFrame.qcMetrics.dynamic_range, 1)}
                    </div>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                    <div className="text-[10px] font-mono text-slate-400">Mean / Std Intensity</div>
                    <div className="font-mono font-bold text-white mt-0.5">
                      {formatMetric(selectedFrame.qcMetrics.mean_intensity, 1)} /{' '}
                      {formatMetric(selectedFrame.qcMetrics.std_intensity, 2)}
                    </div>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                    <div className="text-[10px] font-mono text-slate-400">Denoise &amp; CLAHE</div>
                    <div className="font-mono font-bold text-white mt-0.5">
                      {selectedFrame.qcMetrics.clahe_applied
                        ? `Gaussian ${selectedFrame.qcMetrics.gaussian_denoise_kernel || '3x3'} + CLAHE`
                        : 'Skipped'}
                    </div>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                    <div className="text-[10px] font-mono text-slate-400">Normalization</div>
                    <div
                      className="font-mono font-bold text-sky-300 mt-0.5 break-all text-[11px]"
                      title={String(selectedFrame.qcMetrics.normalization_method || 'none')}
                    >
                      {String(selectedFrame.qcMetrics.normalization_method || 'none')}
                    </div>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                    <div className="text-[10px] font-mono text-slate-400">Blank / Uniform</div>
                    <div className="font-mono font-bold text-white mt-0.5">
                      {selectedFrame.qcMetrics.is_blank_or_uniform ? 'Yes (Rejected)' : 'No'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Object Storage Keys with Copy Actions */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2 text-[11px] font-mono">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-400">Raw Storage Key (Radiometric Preserved):</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-slate-200 break-all">{selectedFrame.rawObjectKey}</span>
                    <button
                      type="button"
                      onClick={() => copyText('raw-key', selectedFrame.rawObjectKey)}
                      aria-label="Copy raw storage key"
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0 cursor-pointer"
                    >
                      {copiedTokenKey === 'raw-key' ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-400">Processed Storage Key (640×640 PNG):</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-emerald-300 break-all">
                      {selectedFrame.processedObjectKey || 'None (QC failed)'}
                    </span>
                    {selectedFrame.processedObjectKey && (
                      <button
                        type="button"
                        onClick={() =>
                          copyText('proc-key', selectedFrame.processedObjectKey || '')
                        }
                        aria-label="Copy processed storage key"
                        className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0 cursor-pointer"
                      >
                        {copiedTokenKey === 'proc-key' ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Modal 1: Register Thermal Camera */}
      {isRegisterModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="register-camera-title"
            className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto shadow-2xl"
          >
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CameraIcon className="w-4 h-4 text-emerald-400" />
                <h2 id="register-camera-title" className="text-sm font-bold text-white">
                  Register Thermal Boundary Camera
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsRegisterModalOpen(false)}
                aria-label="Close Register Camera dialog"
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitCamera} className="p-5 space-y-4 text-xs">
              {cameraFormError && (
                <div
                  role="alert"
                  className="bg-red-950/60 border border-red-700/70 text-red-100 px-3 py-2 rounded-lg"
                >
                  {cameraFormError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="cam-code" className="block text-slate-300 font-semibold mb-1">
                    Camera ID / Code *
                  </label>
                  <input
                    id="cam-code"
                    type="text"
                    value={cameraForm.cameraCode}
                    onChange={(e) =>
                      setCameraForm((p) => ({ ...p, cameraCode: e.target.value }))
                    }
                    placeholder="e.g. CAM-BANDIPUR-01"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label htmlFor="cam-name" className="block text-slate-300 font-semibold mb-1">
                    Camera Name *
                  </label>
                  <input
                    id="cam-name"
                    type="text"
                    value={cameraForm.name}
                    onChange={(e) => setCameraForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. North Crop Perimeter Tower"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="cam-zone" className="block text-slate-300 font-semibold mb-1">
                    Zone Name *
                  </label>
                  <input
                    id="cam-zone"
                    type="text"
                    value={cameraForm.zoneName}
                    onChange={(e) => setCameraForm((p) => ({ ...p, zoneName: e.target.value }))}
                    placeholder="e.g. Mangala Crop Buffer"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label htmlFor="cam-village" className="block text-slate-300 font-semibold mb-1">
                    Village (Optional)
                  </label>
                  <div className="space-y-1">
                    <select
                      id="cam-village"
                      value={cameraForm.villageId}
                      onChange={(e) =>
                        setCameraForm((p) => ({ ...p, villageId: e.target.value }))
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                    >
                      <option value="">-- No Village Selected --</option>
                      {villages.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} ({v.district})
                        </option>
                      ))}
                    </select>
                    {cameraForm.villageId && (
                      <button
                        type="button"
                        onClick={handleUseSelectedVillageCoords}
                        className="text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold underline cursor-pointer"
                      >
                        Fill coordinates from selected village
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="cam-zone-type"
                    className="block text-slate-300 font-semibold mb-1"
                  >
                    Zone Type *
                  </label>
                  <select
                    id="cam-zone-type"
                    value={cameraForm.zoneType}
                    onChange={(e) =>
                      setCameraForm((p) => ({
                        ...p,
                        zoneType: e.target.value as CameraZoneType | '',
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Select Zone Type --</option>
                    <option value="crop_field">crop_field</option>
                    <option value="structure">structure</option>
                    <option value="perimeter_boundary">perimeter_boundary</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="cam-protocol"
                    className="block text-slate-300 font-semibold mb-1"
                  >
                    Protocol *
                  </label>
                  <select
                    id="cam-protocol"
                    value={cameraForm.protocol}
                    onChange={(e) =>
                      setCameraForm((p) => ({
                        ...p,
                        protocol: e.target.value as CameraProtocol | '',
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Select Protocol --</option>
                    <option value="http_push">http_push (POST /ingest/frames)</option>
                    <option value="rtsp">rtsp (IoT RTSP Pull)</option>
                    <option value="file_upload">file_upload (Sample / Batch)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="cam-lat" className="block text-slate-300 font-semibold mb-1">
                    Latitude *
                  </label>
                  <input
                    id="cam-lat"
                    type="number"
                    step="any"
                    value={cameraForm.latitude}
                    onChange={(e) =>
                      setCameraForm((p) => ({ ...p, latitude: e.target.value }))
                    }
                    placeholder="e.g. 11.6642"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label htmlFor="cam-lng" className="block text-slate-300 font-semibold mb-1">
                    Longitude *
                  </label>
                  <input
                    id="cam-lng"
                    type="number"
                    step="any"
                    value={cameraForm.longitude}
                    onChange={(e) =>
                      setCameraForm((p) => ({ ...p, longitude: e.target.value }))
                    }
                    placeholder="e.g. 76.6218"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="cam-stream" className="block text-slate-300 font-semibold mb-1">
                  Stream URL / Connection Metadata (Optional — credentials masked server-side)
                </label>
                <input
                  id="cam-stream"
                  type="text"
                  autoComplete="off"
                  value={cameraForm.streamUrl}
                  onChange={(e) =>
                    setCameraForm((p) => ({ ...p, streamUrl: e.target.value }))
                  }
                  placeholder="e.g. rtsp://10.0.4.25:554/thermal"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cameraForm.isDevTest}
                  onChange={(e) =>
                    setCameraForm((p) => ({ ...p, isDevTest: e.target.checked }))
                  }
                  className="rounded border-slate-600 bg-slate-950 text-emerald-500"
                />
                <span>Mark as Development / Test Endpoint (DEV TEST)</span>
              </label>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsRegisterModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCamera}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold disabled:opacity-50"
                >
                  {isSubmittingCamera ? 'Registering...' : 'Register & Generate Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Upload Thermal Sample */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-sample-title"
            className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl"
          >
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileVideo className="w-4 h-4 text-emerald-400" />
                <h2 id="upload-sample-title" className="text-sm font-bold text-white">
                  Upload Thermal Sample (DEVELOPMENT / TEST MODE)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsUploadModalOpen(false)}
                aria-label="Close Upload Thermal Sample dialog"
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitUpload} className="p-5 space-y-4 text-xs">
              <div className="bg-amber-950/40 border border-amber-700/50 text-amber-200 rounded-lg p-2.5 text-[11px]">
                <strong>DEVELOPMENT / TEST MODE:</strong> Supported formats: PNG, JPG/JPEG, TIFF
                (16-bit radiometric preserved, max 25 MB), MP4, and AVI (max 100 MB, bounded
                extraction at configured FPS).
              </div>

              {uploadError && (
                <div
                  role="alert"
                  className="bg-red-950/60 border border-red-700/70 text-red-100 px-3 py-2 rounded-lg"
                >
                  {uploadError}
                </div>
              )}

              <div>
                <label htmlFor="sample-file" className="block text-slate-300 font-semibold mb-1">
                  Thermal Media File *
                </label>
                <input
                  id="sample-file"
                  type="file"
                  accept=".png,.jpg,.jpeg,.tif,.tiff,.mp4,.avi"
                  onChange={(e) => handleSelectUploadFile(e.target.files?.[0] ?? null)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-emerald-700 file:text-white file:text-xs file:font-semibold"
                />
                {uploadFile && (
                  <div className="mt-1.5 text-[11px] font-mono text-emerald-300">
                    Selected: {uploadFile.name} ({formatFileSize(uploadFile.size)} ·{' '}
                    {uploadMediaType})
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="sample-camera"
                    className="block text-slate-300 font-semibold mb-1"
                  >
                    Camera / Test Mode
                  </label>
                  <select
                    id="sample-camera"
                    value={uploadCameraId}
                    onChange={(e) => setUploadCameraId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">
                      Development Sample Mode (DEV-SAMPLE-CAM-01)
                    </option>
                    {cameras.map((cam) => (
                      <option key={cam.id} value={cam.id}>
                        {cam.cameraCode} ({cam.zoneName})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="sample-fps" className="block text-slate-300 font-semibold mb-1">
                    Video Extraction FPS
                  </label>
                  <input
                    id="sample-fps"
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="30"
                    value={uploadTargetFps}
                    onChange={(e) => setUploadTargetFps(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {isUploading && (
                <div className="space-y-1.5 bg-slate-950 border border-slate-800 rounded-lg p-3">
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-300">
                    <span>
                      {uploadProgress < 100
                        ? `Uploading media (${uploadProgress}%)...`
                        : 'Running OpenCV QC & CLAHE preprocessing...'}
                    </span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {lastUploadResult && (
                <div className="bg-emerald-950/45 border border-emerald-700/60 rounded-xl p-3 space-y-1.5">
                  <div className="font-bold text-emerald-300">
                    Ingest Complete ({lastUploadResult.mediaType}) · {lastUploadResult.mode}
                  </div>
                  <div className="text-[11px] font-mono text-slate-200">
                    Extracted: {lastUploadResult.extractedCount} · Accepted:{' '}
                    {lastUploadResult.acceptedCount} · Rejected: {lastUploadResult.rejectedCount} ·
                    Storage: {lastUploadResult.storageBackend}
                  </div>
                  {lastUploadResult.videoSummary && (
                    <div className="text-[11px] font-mono text-slate-400">
                      Native FPS: {lastUploadResult.videoSummary.native_fps ?? 'N/A'} → Target FPS:{' '}
                      {lastUploadResult.videoSummary.target_fps ?? 'N/A'}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsUploadModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-semibold"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold disabled:opacity-50"
                >
                  {isUploading ? 'Processing...' : 'Ingest & Preprocess'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Camera Integration / Bounded RTSP Connectivity Test */}
      {isRtspModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rtsp-test-title"
            className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl"
          >
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-sky-400" />
                <h2 id="rtsp-test-title" className="text-sm font-bold text-white">
                  Camera Integration — Bounded RTSP Stream Test
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsRtspModalOpen(false)}
                aria-label="Close Camera Integration dialog"
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitRtspTest} className="p-5 space-y-4 text-xs">
              <div className="bg-slate-950 border border-slate-800 text-slate-300 rounded-lg p-2.5 text-[11px] space-y-1">
                <div>
                  Pulls a bounded number of frames with strict timeout limits via{' '}
                  <code className="text-sky-300">POST /api/v1/ingest/rtsp/test-pull</code>.
                  Credentials in RTSP URLs are masked in UI, logs, and backend responses.
                </div>
                <div className="text-amber-300/90">
                  IoT Boundary: Physical camera availability, power, and network routing to the RTSP
                  endpoint depend on the IoT team.
                </div>
              </div>

              {rtspError && (
                <div
                  role="alert"
                  className="bg-red-950/60 border border-red-700/70 text-red-100 px-3 py-2 rounded-lg break-all"
                >
                  {rtspError}
                </div>
              )}

              <div>
                <label htmlFor="rtsp-url" className="block text-slate-300 font-semibold mb-1">
                  RTSP Endpoint URL *
                </label>
                <input
                  id="rtsp-url"
                  type="text"
                  autoComplete="off"
                  value={rtspForm.rtspUrl}
                  onChange={(e) => setRtspForm((p) => ({ ...p, rtspUrl: e.target.value }))}
                  placeholder="rtsp://camera-host:554/thermal"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="rtsp-camera" className="block text-slate-300 font-semibold mb-1">
                    Camera (Optional)
                  </label>
                  <select
                    id="rtsp-camera"
                    value={rtspForm.cameraId}
                    onChange={(e) => setRtspForm((p) => ({ ...p, cameraId: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">Dev Test Bench</option>
                    {cameras.map((cam) => (
                      <option key={cam.id} value={cam.id}>
                        {cam.cameraCode}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="rtsp-max-frames"
                    className="block text-slate-300 font-semibold mb-1"
                  >
                    Max Frames (1–10)
                  </label>
                  <input
                    id="rtsp-max-frames"
                    type="number"
                    min="1"
                    max="10"
                    value={rtspForm.maxFrames}
                    onChange={(e) => setRtspForm((p) => ({ ...p, maxFrames: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="rtsp-timeout"
                    className="block text-slate-300 font-semibold mb-1"
                  >
                    Timeout (s)
                  </label>
                  <input
                    id="rtsp-timeout"
                    type="number"
                    step="0.5"
                    min="1"
                    max="20"
                    value={rtspForm.timeoutSeconds}
                    onChange={(e) =>
                      setRtspForm((p) => ({ ...p, timeoutSeconds: e.target.value }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {rtspResult && (
                <div className="bg-emerald-950/45 border border-emerald-700/60 rounded-xl p-3 space-y-1 text-[11px] font-mono">
                  <div className="text-emerald-300 font-bold">
                    Reachable: {rtspResult.maskedRtspUrl}
                  </div>
                  <div className="text-slate-200">
                    Retrieved: {rtspResult.framesRetrieved} · Accepted: {rtspResult.acceptedCount}{' '}
                    · Rejected: {rtspResult.rejectedCount}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsRtspModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-semibold"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isTestingRtsp}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl font-bold disabled:opacity-50"
                >
                  {isTestingRtsp ? 'Testing Connection...' : 'Test Connection / Test Pull'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 4: Full-Resolution Frame Preview Lightbox */}
      {previewLightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="lightbox-title"
            className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden shadow-2xl flex flex-col"
          >
            <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 id="lightbox-title" className="text-sm font-bold text-white truncate">
                  {previewLightbox.title}
                </h2>
                <div className="text-[11px] font-mono text-slate-400">
                  {previewLightbox.subtitle}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewLightbox(null)}
                aria-label="Close Full Frame Preview"
                className="text-slate-400 hover:text-white p-1.5 rounded-lg bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 bg-black flex items-center justify-center p-4 overflow-auto">
              <img
                src={previewLightbox.url}
                alt={previewLightbox.title}
                className="max-h-[75vh] max-w-full object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {/* Modal 5: Delete Registered Thermal Camera Confirmation */}
      {cameraPendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-camera-title"
            className="bg-slate-900 border border-red-800/70 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-red-400">
                  Camera Endpoint Removal
                </span>
                <h2 id="delete-camera-title" className="text-sm font-bold text-white mt-0.5">
                  Delete Thermal Camera
                </h2>
              </div>
              <button
                type="button"
                disabled={isDeletingCamera}
                onClick={() => setCameraPendingDelete(null)}
                aria-label="Close Delete Camera dialog"
                className="text-slate-400 hover:text-white p-1 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {cameraDeleteError && (
                <div
                  role="alert"
                  className="bg-red-950/70 border border-red-700/70 text-red-100 px-3 py-2 rounded-lg"
                >
                  {cameraDeleteError}
                </div>
              )}

              <p className="text-slate-300">
                Are you sure you want to delete this registered thermal camera from the database?
              </p>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono text-slate-400">Camera ID</span>
                  <span className="font-mono font-bold text-emerald-300">
                    {cameraPendingDelete.cameraCode}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono text-slate-400">Camera Name</span>
                  <span className="font-semibold text-white text-right">
                    {cameraPendingDelete.name}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono text-slate-400">Zone / Protocol</span>
                  <span className="text-slate-300 text-right">
                    {cameraPendingDelete.zoneName} · {cameraPendingDelete.protocol}
                  </span>
                </div>
              </div>

              <div className="bg-emerald-950/35 border border-emerald-800/50 text-emerald-200 rounded-lg p-2.5 text-[11px]">
                Historical thermal frames, QC metrics, audit records, and object storage artifacts associated with this camera will be preserved.
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  disabled={isDeletingCamera}
                  onClick={() => setCameraPendingDelete(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-semibold disabled:opacity-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeletingCamera}
                  onClick={handleConfirmDeleteCamera}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold disabled:opacity-50 cursor-pointer"
                >
                  {isDeletingCamera ? 'Deleting...' : 'Confirm Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
