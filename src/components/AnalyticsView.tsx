import React from 'react';
import { Incident, VillageRiskProfile } from '../types';
import {
  Clock,
  MapPin,
  Printer,
  Layers,
  ShieldCheck,
  RotateCcw,
  AlertTriangle,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

interface AnalyticsViewProps {
  incidents: Incident[];
  villages: VillageRiskProfile[];
  selectedDistrict?: string;
  dateRange?: string;
  onResetGlobalFilters?: () => void;
  isApiLoading?: boolean;
  apiError?: string | null;
  onRetrySync?: () => void;
}

const TIME_SLOTS = [
  { label: '00:00 - 03:00', start: 0, end: 3 },
  { label: '03:00 - 06:00', start: 3, end: 6 },
  { label: '06:00 - 09:00', start: 6, end: 9 },
  { label: '09:00 - 12:00', start: 9, end: 12 },
  { label: '12:00 - 15:00', start: 12, end: 15 },
  { label: '15:00 - 18:00', start: 15, end: 18 },
  { label: '18:00 - 21:00', start: 18, end: 21 },
  { label: '21:00 - 00:00', start: 21, end: 24 },
];

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  incidents,
  villages,
  selectedDistrict = 'Bandipur Division',
  dateRange = 'Last 30 Days',
  onResetGlobalFilters,
  isApiLoading = false,
  apiError = null,
  onRetrySync,
}) => {
  // 1. Diurnal Encounter Distribution derived from filtered incidents
  const timeOfDayData = TIME_SLOTS.map((slot) => {
    const count = incidents.filter((inc) => {
      const dt = new Date(inc.dateTime);
      if (Number.isNaN(dt.getTime())) return false;
      const hour = dt.getUTCHours();
      return hour >= slot.start && hour < slot.end;
    }).length;
    return { hour: slot.label, incidents: count };
  });

  const peakSlot = timeOfDayData.reduce(
    (best, cur) => (cur.incidents > best.incidents ? cur : best),
    timeOfDayData[0]
  );

  // 2. Exact Incident Type Distribution (no fake offsets)
  const typeDistribution = [
    {
      name: 'Crop Depredation',
      count: incidents.filter((i) => i.incidentType === 'Crop Depredation').length,
      color: '#10b981',
    },
    {
      name: 'Livestock Predation',
      count: incidents.filter((i) => i.incidentType === 'Livestock Predation').length,
      color: '#eab308',
    },
    {
      name: 'Village Incursion',
      count: incidents.filter((i) => i.incidentType === 'Village Incursion').length,
      color: '#0ea5e9',
    },
    {
      name: 'Infrastructure Breach',
      count: incidents.filter((i) => i.incidentType === 'Infrastructure Breach').length,
      color: '#a855f7',
    },
    {
      name: 'Human Injury / Attack',
      count: incidents.filter(
        (i) => i.incidentType === 'Human Injury / Attack' || i.humanInjury !== 'None'
      ).length,
      color: '#ef4444',
    },
  ];

  // 3. Response Status Breakdown derived strictly from filtered incidents
  const responseData = [
    {
      name: 'Resolved / Closed',
      value: incidents.filter((i) => i.status === 'Resolved' || i.status === 'Closed').length,
      color: '#10b981',
    },
    {
      name: 'Patrol / Active Control',
      value: incidents.filter(
        (i) => i.status === 'Patrol Dispatched' || i.status === 'Under Control'
      ).length,
      color: '#0ea5e9',
    },
    {
      name: 'Verified',
      value: incidents.filter((i) => i.status === 'Verified').length,
      color: '#eab308',
    },
    {
      name: 'Reported (Pending)',
      value: incidents.filter((i) => i.status === 'Reported').length,
      color: '#f97316',
    },
  ];

  // 4. Village Risk Rankings
  const villageRankings = villages
    .slice()
    .sort((a, b) => b.riskScore - a.riskScore)
    .map((v) => ({
      village: v.name,
      score: v.riskScore,
      incidents30d: v.recentIncidents30d,
    }));

  // Derived Summary KPIs
  const totalCropAcres = incidents.reduce((sum, i) => sum + i.cropDamageEstimatedAcres, 0);
  const totalInjuries = incidents.reduce((sum, i) => sum + i.humanInjuriesCount, 0);
  const fencedVillages = villages.filter((v) => v.activeSolarFence);
  const operationalFences = fencedVillages.filter((v) => v.fenceStatus === 'Operational').length;
  const fenceIntegrityPct =
    fencedVillages.length > 0
      ? ((operationalFences / fencedVillages.length) * 100).toFixed(1)
      : '0.0';
  const resolvedCount = responseData[0].value;
  const resolutionRatePct =
    incidents.length > 0 ? Math.round((resolvedCount / incidents.length) * 100) : 0;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 font-bold uppercase tracking-wider">
            <span>Spatial & Statistical Intelligence</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>Filtered Dataset Metrics</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            Human-Wildlife Conflict Analytics & Trend Reports
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Computed directly from active filters: <span className="text-emerald-300 font-semibold">{selectedDistrict}</span> •{' '}
            <span className="font-mono text-slate-300">{dateRange}</span>
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {onResetGlobalFilters &&
            (selectedDistrict !== 'Bandipur Division' || dateRange !== 'Last 30 Days') && (
              <button
                onClick={onResetGlobalFilters}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-700 transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Filters</span>
              </button>
            )}
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs sm:text-sm font-semibold px-3 py-2 rounded-lg border border-slate-700 shadow-xs transition"
          >
            <Printer className="w-4 h-4 text-slate-400" />
            <span>Print Report</span>
          </button>
        </div>
      </div>

      {/* Analytics Summary Stats (100% Derived from Filtered Data) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xs">
          <div className="text-slate-400 text-xs font-bold uppercase">Peak Shift (UTC)</div>
          <div className="text-2xl font-extrabold text-white font-mono tabular-nums mt-1">
            {incidents.length > 0 ? peakSlot.hour : 'No Data'}
          </div>
          <div className="text-[11px] text-amber-400 font-semibold mt-1 font-mono tabular-nums">
            {incidents.length > 0
              ? `${peakSlot.incidents} incident${peakSlot.incidents === 1 ? '' : 's'} in peak slot`
              : '0 incidents in active filter'}
          </div>
        </div>

        <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xs">
          <div className="text-slate-400 text-xs font-bold uppercase">Resolution Progress</div>
          <div className="text-2xl font-extrabold text-emerald-400 font-mono tabular-nums mt-1">
            {resolutionRatePct}%
          </div>
          <div className="text-[11px] text-slate-300 font-semibold mt-1 font-mono tabular-nums">
            {resolvedCount} of {incidents.length} incidents resolved/closed
          </div>
        </div>

        <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xs">
          <div className="text-slate-400 text-xs font-bold uppercase">Solar Fence Integrity</div>
          <div className="text-2xl font-extrabold text-amber-400 font-mono tabular-nums mt-1">
            {villages.length === 0 && isApiLoading
              ? 'Syncing...'
              : villages.length === 0 && apiError
              ? 'Offline'
              : `${fenceIntegrityPct}%`}
          </div>
          <div className="text-[11px] text-amber-300 font-semibold mt-1 font-mono tabular-nums">
            {villages.length === 0 && isApiLoading
              ? 'Fetching settlement telemetry'
              : villages.length === 0 && apiError
              ? 'Village API unreachable'
              : `${operationalFences} of ${fencedVillages.length} fenced settlements operational`}
          </div>
        </div>

        <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xs">
          <div className="text-slate-400 text-xs font-bold uppercase">Reported Impact</div>
          <div className="text-2xl font-extrabold text-white font-mono tabular-nums mt-1">
            {totalCropAcres.toFixed(1)} ac
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-mono tabular-nums">
            Crop loss • {totalInjuries} human injur{totalInjuries === 1 ? 'y' : 'ies'}
          </div>
        </div>
      </div>

      {/* Row 1: Diurnal Time-of-Day Curve & Incident Type Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Time of Day Heatmap Bar */}
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="mb-4">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-400" />
              Diurnal Conflict Curve (Filtered Incidents)
            </h3>
            <p className="text-xs text-slate-400">
              Incident timestamps grouped across 3-hour shifts (UTC)
            </p>
          </div>

          <div className="h-64 w-full">
            {incidents.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                No incidents match the active filters.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timeOfDayData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                  <XAxis
                    dataKey="hour"
                    angle={-25}
                    textAnchor="end"
                    interval={0}
                    tick={{ fontSize: 9, fill: '#94a3b8' }}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#020617',
                      borderColor: '#334155',
                      color: '#fff',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="incidents" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Chart 2: Incident Type Distribution */}
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="mb-4">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-400" />
              Conflict Categorization & Nature of Loss
            </h3>
            <p className="text-xs text-slate-400">
              Exact counts of filtered incidents by classification
            </p>
          </div>

          <div className="h-64 w-full">
            {incidents.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                No incidents match the active filters.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={typeDistribution}
                  layout="vertical"
                  margin={{ top: 5, right: 20, left: 30, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#1e293b" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={120}
                    tick={{ fontSize: 10, fill: '#cbd5e1' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#020617',
                      borderColor: '#334155',
                      color: '#fff',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {typeDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Village Risk Priority Ranking & Response Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Village Risk Ranking Bar */}
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-xs">
          <div className="mb-4">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <MapPin className="w-4 h-4 text-red-400" />
              Perimeter Settlements by Conflict Risk Score
            </h3>
            <p className="text-xs text-slate-400">
              Vulnerability ranking for settlements in the active division filter
            </p>
          </div>

          <div className="h-64 w-full">
            {villageRankings.length === 0 ? (
              isApiLoading ? (
                <div className="h-full flex items-center justify-center gap-2 text-xs text-slate-300">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                  <span>Loading village risk rankings from backend API...</span>
                </div>
              ) : apiError ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-xs text-red-300 text-center px-4">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                    <span>Unable to load settlement rankings ({apiError}).</span>
                  </div>
                  {onRetrySync && (
                    <button
                      type="button"
                      onClick={onRetrySync}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-800/80 hover:bg-red-700 text-white rounded font-semibold"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Retry Sync</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-slate-400">
                  No villages match the active division filter.
                </div>
              )
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={villageRankings} margin={{ top: 10, right: 10, left: -15, bottom: 25 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="village"
                    angle={-20}
                    textAnchor="end"
                    interval={0}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                  />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#020617',
                      borderColor: '#334155',
                      color: '#fff',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="score" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Operational Response Resolution Status */}
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="mb-4">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Incident Response & Operational Resolution
            </h3>
            <p className="text-xs text-slate-400">
              Status distribution of filtered incidents
            </p>
          </div>

          <div className="h-64 w-full flex items-center justify-center">
            {incidents.length === 0 ? (
              <div className="text-xs text-slate-400">No incidents match the active filters.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={responseData}
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    innerRadius={45}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {responseData.map((entry, index) => (
                      <Cell key={`pie-cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#020617',
                      borderColor: '#334155',
                      color: '#fff',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Legend
                    layout="horizontal"
                    verticalAlign="bottom"
                    align="center"
                    wrapperStyle={{ fontSize: '11px', paddingTop: '10px', color: '#94a3b8' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
