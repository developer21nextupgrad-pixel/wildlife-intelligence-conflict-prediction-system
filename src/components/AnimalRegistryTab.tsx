import React, { useCallback, useEffect, useState } from 'react';
import {
  AnimalIdentityDetail,
  AnimalIdentitySummary,
  AnimalSighting,
} from '../types';
import { apiBridge } from '../services/apiBridge';
import { AuthImage } from './AuthImage';
import {
  CheckCircle2,
  Clock,
  Fingerprint,
  Image as ImageIcon,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';

function formatDt(val?: string | null): string {
  if (!val) return '—';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return val;
  return d.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export const AnimalRegistryTab: React.FC = () => {
  const [animals, setAnimals] = useState<AnimalIdentitySummary[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState<string>('');
  const [speciesFilter, setSpeciesFilter] = useState<string>('All');
  const [verificationFilter, setVerificationFilter] = useState<string>('All');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AnimalIdentityDetail | null>(null);
  const [sightings, setSightings] = useState<AnimalSighting[]>([]);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);

  const loadAnimals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiBridge.getAnimalIdentities({
        page: 1,
        pageSize: 50,
        species: speciesFilter,
        verificationStatus: verificationFilter,
        search,
      });
      setAnimals(res.items);
      setTotal(res.total);
      setSelectedId((prev) => {
        if (prev && res.items.some((a) => a.id === prev)) return prev;
        return res.items[0]?.id || null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load animal registry.');
    } finally {
      setLoading(false);
    }
  }, [search, speciesFilter, verificationFilter]);

  useEffect(() => {
    loadAnimals();
  }, [loadAnimals]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setSightings([]);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    Promise.all([
      apiBridge.getAnimalIdentityDetail(selectedId),
      apiBridge.getAnimalIdentitySightings(selectedId),
    ])
      .then(([d, s]) => {
        if (!cancelled) {
          setDetail(d);
          setSightings(s);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null);
          setSightings([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <div className="space-y-4">
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ID (ELE-001) or species..."
              aria-label="Search animal registry"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <select
            value={speciesFilter}
            onChange={(e) => setSpeciesFilter(e.target.value)}
            aria-label="Filter registry by species"
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
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
            value={verificationFilter}
            onChange={(e) => setVerificationFilter(e.target.value)}
            aria-label="Filter registry by verification status"
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
          >
            <option value="All">All Verification States</option>
            <option value="provisional">Provisional (Auto)</option>
            <option value="confirmed">Human Confirmed</option>
          </select>
        </div>
        <button
          type="button"
          onClick={loadAnimals}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 rounded-xl text-xs font-semibold text-slate-200 transition self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh ({total})</span>
        </button>
      </div>

      {error && (
        <div role="alert" className="bg-red-950/60 border border-red-800 rounded-xl p-3 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-5 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Fingerprint className="w-4 h-4 text-sky-400" />
            <span>Tracked Individual Animals ({total})</span>
          </h2>

          {loading ? (
            <div className="py-10 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              <span>Loading individual profiles...</span>
            </div>
          ) : animals.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400 bg-slate-950/50 rounded-xl border border-slate-800 px-4">
              No individual animal identities registered yet. Upload an animal photo to assign the first ID.
            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1" data-testid="animal-registry-list">
              {animals.map((a) => {
                const active = selectedId === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelectedId(a.id)}
                    aria-label={`View profile for ${a.animalCode} (${a.species})`}
                    className={`w-full text-left p-3 rounded-xl border transition flex items-center gap-3 ${
                      active
                        ? 'bg-emerald-950/40 border-emerald-500/70'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {a.primaryCropUrl ? (
                      <AuthImage
                        src={a.primaryCropUrl}
                        alt={a.animalCode}
                        className="w-14 h-14 rounded-lg object-cover border border-slate-800 bg-slate-900 shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-lg border border-slate-800 bg-slate-900 flex items-center justify-center shrink-0">
                        <ImageIcon className="w-5 h-5 text-slate-600" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-black font-mono text-sky-300">
                          {a.animalCode}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-mono border ${
                            a.verificationStatus === 'confirmed'
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                              : 'bg-amber-950 text-amber-300 border-amber-700'
                          }`}
                        >
                          {a.verificationStatus}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-white truncate">{a.species}</div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                        <span>{a.totalSightings} sightings • {a.referenceImageCount} refs</span>
                        <span>{formatDt(a.lastSeenAt)}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="xl:col-span-7 bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
          {loadingDetail ? (
            <div className="py-16 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              <span>Loading individual profile...</span>
            </div>
          ) : !detail ? (
            <div className="py-16 text-center text-xs text-slate-400">
              Select an animal identity from the registry to inspect its reference crops, sightings, and review logs.
            </div>
          ) : (
            <div className="space-y-5" data-testid="animal-identity-detail">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-black font-mono text-sky-300">
                      {detail.animalCode}
                    </span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded font-mono border ${
                        detail.verificationStatus === 'confirmed'
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                          : 'bg-amber-950 text-amber-300 border-amber-700'
                      }`}
                    >
                      {detail.verificationStatus === 'confirmed'
                        ? 'Human Confirmed'
                        : 'Provisional (Probabilistic Match)'}
                    </span>
                  </div>
                  <div className="text-sm font-bold text-white mt-0.5">
                    {detail.species}
                    {detail.scientificName ? (
                      <span className="text-xs font-normal italic text-slate-400 ml-2">
                        ({detail.scientificName})
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="text-right text-[11px] font-mono text-slate-400 space-y-0.5">
                  <div>First Seen: {formatDt(detail.firstSeenAt)}</div>
                  <div>Last Seen: {formatDt(detail.lastSeenAt)}</div>
                </div>
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                  <div className="text-[10px] font-mono text-slate-400 uppercase">Total Sightings</div>
                  <div className="text-lg font-black text-white font-mono mt-0.5">{detail.totalSightings}</div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                  <div className="text-[10px] font-mono text-slate-400 uppercase">Reference Crops</div>
                  <div className="text-lg font-black text-emerald-300 font-mono mt-0.5">
                    {detail.referenceImageCount}
                  </div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                  <div className="text-[10px] font-mono text-slate-400 uppercase">Audit Reviews</div>
                  <div className="text-lg font-black text-sky-300 font-mono mt-0.5">
                    {detail.reviewLogs.length}
                  </div>
                </div>
              </div>

              {/* Crop Gallery */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">
                  Reference Crop Gallery ({detail.images.length})
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {detail.images.map((img) => (
                    <div
                      key={img.id}
                      className="bg-slate-950 border border-slate-800 rounded-xl p-2 space-y-1.5"
                    >
                      <AuthImage
                        src={img.cropImageUrl}
                        alt={`${detail.animalCode} crop ${img.detectionItemIndex}`}
                        className="w-full h-28 object-cover rounded-lg border border-slate-800"
                      />
                      <div className="text-[10px] font-mono text-slate-300 flex justify-between">
                        <span>{img.cropWidth}×{img.cropHeight}px</span>
                        <span className={img.isReference ? 'text-emerald-400' : 'text-slate-500'}>
                          {img.isReference ? 'Ref Vec' : 'Non-Ref'}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono truncate">
                        Blur var: {img.blurScore.toFixed(1)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Linked Sightings Timeline */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Linked Geospatial Sightings ({sightings.length})</span>
                </h3>
                {sightings.length === 0 ? (
                  <div className="text-xs text-slate-400 bg-slate-950/60 border border-slate-800 rounded-xl p-3">
                    No geospatial Sightings linked yet (detections uploaded without Camera/Village/GPS do not fabricate map sightings).
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sightings.map((s) => (
                      <div
                        key={s.id}
                        className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs flex flex-wrap justify-between gap-2"
                      >
                        <div>
                          <div className="font-bold text-white">
                            {s.sightingCode} — {s.locationName}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {s.forestRange} • GPS ({s.latitude.toFixed(4)}, {s.longitude.toFixed(4)})
                          </div>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{formatDt(s.timestamp)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Human Review Audit History */}
              {detail.reviewLogs.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                    <span>Identity Verification Audit Log ({detail.reviewLogs.length})</span>
                  </h3>
                  <div className="space-y-1.5">
                    {detail.reviewLogs.map((log) => (
                      <div
                        key={log.id}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-[11px] flex flex-wrap justify-between gap-2"
                      >
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="font-mono font-bold text-white uppercase">{log.action}</span>
                          <span className="text-slate-300">by {log.reviewedBy}</span>
                          {log.reason && <span className="text-slate-400">— {log.reason}</span>}
                        </div>
                        <span className="font-mono text-slate-500">{formatDt(log.reviewedAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
