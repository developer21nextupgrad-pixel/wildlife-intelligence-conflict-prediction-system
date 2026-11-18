import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import {
  Incident,
  AnimalSighting,
  VillageRiskProfile,
  AlertNotification,
  RiskZone,
  TelemetryCollar,
  PatrolOperation,
} from '../types';
import {
  FileSpreadsheet,
  Eye,
  AlertTriangle,
  Flame,
  ShieldCheck,
  MapPin,
  Clock,
  ChevronRight,
  Filter,
  Compass,
  Maximize2,
  Activity,
  Calendar,
  RotateCcw,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  LineChart,
  Line,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { formatCoordinates } from '../utils/conflictCalculations';
import {
  DATE_RANGE_OPTIONS,
  DIVISION_OPTIONS,
  escapeHtml,
} from '../utils/wicpsFilters';

interface DashboardViewProps {
  incidents: Incident[];
  sightings: AnimalSighting[];
  villages: VillageRiskProfile[];
  alerts: AlertNotification[];
  riskZones: RiskZone[];
  telemetry: TelemetryCollar[];
  patrols: PatrolOperation[];
  onNavigate: (tabId: string) => void;
  onOpenNewIncident: () => void;
  selectedDistrict: string;
  setSelectedDistrict: (district: string) => void;
  dateRange: string;
  setDateRange: (range: string) => void;
  onResetFilters?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  incidents,
  sightings,
  villages,
  alerts,
  riskZones,
  telemetry,
  patrols,
  onNavigate,
  onOpenNewIncident,
  selectedDistrict,
  setSelectedDistrict,
  dateRange,
  setDateRange,
  onResetFilters,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const dynamicLayerGroupRef = useRef<L.LayerGroup | null>(null);

  const highRiskVillages = villages.filter(
    (v) => v.riskLevel === 'Critical' || v.riskLevel === 'High'
  );
  const unackAlerts = alerts.filter((a) => !a.acknowledged);
  const activePatrols = patrols.filter(
    (p) => p.status === 'In Progress' || p.status === 'On Station'
  );

  const criticalOrHighIncidents = incidents.filter(
    (i) => i.severity === 'Critical' || i.severity === 'High'
  ).length;
  const totalObservedAnimals = sightings.reduce((sum, s) => sum + s.herdSize, 0);
  const topHighRiskVillageNames =
    highRiskVillages
      .slice(0, 2)
      .map((v) => v.name.split(' ')[0])
      .join(' & ') || 'None in filter';

  const isFilteredOut =
    incidents.length === 0 &&
    sightings.length === 0 &&
    villages.length === 0 &&
    alerts.length === 0;

  // Species-wise incident counts
  const speciesData = [
    {
      species: 'Asian Elephant',
      count: incidents.filter((i) => i.species === 'Asian Elephant').length,
      fill: '#10b981',
    },
    {
      species: 'Bengal Tiger',
      count: incidents.filter((i) => i.species === 'Bengal Tiger').length,
      fill: '#f97316',
    },
    {
      species: 'Indian Leopard',
      count: incidents.filter((i) => i.species === 'Indian Leopard').length,
      fill: '#eab308',
    },
    {
      species: 'Sloth Bear',
      count: incidents.filter((i) => i.species === 'Sloth Bear').length,
      fill: '#64748b',
    },
    {
      species: 'Wild Boar',
      count: incidents.filter((i) => i.species === 'Wild Boar').length,
      fill: '#a855f7',
    },
    {
      species: 'Gaur',
      count: incidents.filter((i) => i.species === 'Gaur').length,
      fill: '#0ea5e9',
    },
  ];

  // Monthly conflict trend (Jun-Oct demo baseline + current filtered period)
  const monthlyTrendData = [
    { month: 'Jun (Demo)', incidents: 12, sightings: 28 },
    { month: 'Jul (Demo)', incidents: 16, sightings: 34 },
    { month: 'Aug (Demo)', incidents: 21, sightings: 42 },
    { month: 'Sep (Demo)', incidents: 28, sightings: 58 },
    { month: 'Oct (Demo)', incidents: 35, sightings: 67 },
    {
      month: 'Active Filter',
      incidents: incidents.length,
      sightings: sightings.length,
    },
  ];

  // Risk distribution breakdown
  const riskDistData = [
    {
      name: 'Critical (>80%)',
      value: villages.filter((v) => v.riskLevel === 'Critical').length,
      color: '#ef4444',
    },
    {
      name: 'High (60-80%)',
      value: villages.filter((v) => v.riskLevel === 'High').length,
      color: '#f97316',
    },
    {
      name: 'Medium (40-60%)',
      value: villages.filter((v) => v.riskLevel === 'Moderate').length,
      color: '#eab308',
    },
    {
      name: 'Low (<40%)',
      value: villages.filter((v) => v.riskLevel === 'Low').length,
      color: '#10b981',
    },
  ];

  // Initialize base Leaflet map once
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [11.668, 76.615],
        zoom: 12,
        zoomControl: false,
        attributionControl: false,
      });

      L.control.zoom({ position: 'topright' }).addTo(map);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
      }).addTo(map);

      // Forest Boundary Polygon (static reference layer)
      const reserveBorderCoords: [number, number][] = [
        [11.605, 76.55],
        [11.64, 76.54],
        [11.72, 76.56],
        [11.745, 76.6],
        [11.73, 76.66],
        [11.67, 76.675],
        [11.61, 76.66],
        [11.595, 76.6],
      ];

      L.polygon(reserveBorderCoords, {
        color: '#059669',
        weight: 2,
        dashArray: '5, 5',
        fillColor: '#10b981',
        fillOpacity: 0.08,
      }).addTo(map);

      dynamicLayerGroupRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        dynamicLayerGroupRef.current = null;
      }
    };
  }, []);

  // Update dynamic filtered layers without tearing down the map
  useEffect(() => {
    const group = dynamicLayerGroupRef.current;
    const map = mapInstanceRef.current;
    if (!group || !map) return;

    group.clearLayers();

    // Risk Zones Polygons
    riskZones.forEach((zone) => {
      const color =
        zone.riskLevel === 'Critical'
          ? '#dc2626'
          : zone.riskLevel === 'High'
          ? '#ea580c'
          : zone.riskLevel === 'Moderate'
          ? '#ca8a04'
          : '#16a34a';

      L.polygon(zone.polygonCoordinates, {
        color,
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.25,
      })
        .bindTooltip(
          `<b>${escapeHtml(zone.name)}</b><br/>${escapeHtml(zone.riskLevel)} Risk (${zone.riskScore}%)`,
          { sticky: true }
        )
        .addTo(group);
    });

    // Village Markers
    villages.forEach((village) => {
      const color =
        village.riskLevel === 'Critical'
          ? '#ef4444'
          : village.riskLevel === 'High'
          ? '#f97316'
          : village.riskLevel === 'Moderate'
          ? '#eab308'
          : '#22c55e';

      const icon = L.divIcon({
        className: 'custom-village-icon',
        html: `<div style="
          background: #0f172a; 
          border: 2px solid ${color}; 
          border-radius: 9999px; 
          width: 24px; 
          height: 24px; 
          display: flex; 
          align-items: center; 
          justify-content: center;
          font-size: 11px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.5);
        ">🏘️</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      L.marker(village.coordinates, { icon })
        .bindTooltip(
          `<b>${escapeHtml(village.name)}</b><br/>Vulnerability: ${escapeHtml(village.riskLevel)} (${village.riskScore}%)`,
          { sticky: true }
        )
        .addTo(group);
    });

    // Incident Pins (all filtered incidents up to 12)
    incidents.slice(0, 12).forEach((inc) => {
      const speciesEmoji: Record<string, string> = {
        'Asian Elephant': '🐘',
        'Bengal Tiger': '🐅',
        'Indian Leopard': '🐆',
        'Sloth Bear': '🐻',
        'Wild Boar': '🐗',
        Gaur: '🐂',
      };

      const bg =
        inc.severity === 'Critical'
          ? '#dc2626'
          : inc.severity === 'High'
          ? '#ea580c'
          : '#059669';

      const icon = L.divIcon({
        className: 'custom-inc-icon',
        html: `<div style="
          background: ${bg}; 
          color: #fff; 
          border: 2px solid #ffffff; 
          border-radius: 8px; 
          width: 28px; 
          height: 28px; 
          display: flex; 
          align-items: center; 
          justify-content: center;
          font-size: 14px;
          box-shadow: 0 4px 8px rgba(0,0,0,0.4);
        ">${speciesEmoji[inc.species] || '⚠️'}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      L.marker([inc.latitude, inc.longitude], { icon })
        .bindTooltip(
          `<b>${escapeHtml(inc.incidentCode)}</b><br/>${escapeHtml(inc.species)} (${escapeHtml(inc.village)})`,
          { sticky: true }
        )
        .addTo(group);
    });
  }, [riskZones, villages, incidents]);

  // Prioritize geo-fence breached / approaching telemetry for display
  const sortedTelemetry = [...telemetry].sort((a, b) => {
    const rank = (s: TelemetryCollar['status']) =>
      s === 'Geo-fence Breached' ? 0 : s === 'Approaching Boundary' ? 1 : 2;
    return rank(a.status) - rank(b.status);
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Title & Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 font-bold uppercase tracking-wider">
            <span>Enterprise GIS Intelligence</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>Central Situation Command • DEMO</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            Wildlife Command Centre & Situation Room
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Active Filter: <span className="text-emerald-300 font-semibold">{selectedDistrict}</span> •{' '}
            <span className="font-mono text-slate-300">{dateRange}</span>
          </p>
        </div>

        {/* Date & District Filters Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300">
            <Filter className="w-3.5 h-3.5 text-emerald-400" />
            <select
              aria-label="Dashboard Division Filter"
              value={selectedDistrict}
              onChange={(e) => setSelectedDistrict(e.target.value)}
              className="bg-transparent font-medium focus:outline-hidden text-slate-200"
            >
              {DIVISION_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id} className="bg-slate-900">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300">
            <Calendar className="w-3.5 h-3.5 text-emerald-400" />
            <select
              aria-label="Dashboard Date Range Filter"
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="bg-transparent font-mono focus:outline-hidden text-slate-200"
            >
              {DATE_RANGE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id} className="bg-slate-900">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {(selectedDistrict !== 'Bandipur Division' || dateRange !== 'Last 30 Days') &&
            onResetFilters && (
              <button
                onClick={onResetFilters}
                className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-2.5 py-2 rounded-lg border border-slate-700 transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}

          <button
            onClick={onOpenNewIncident}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold px-3.5 py-2 rounded-lg shadow-sm transition active:scale-95 border border-emerald-400/40"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Log Incident</span>
          </button>
        </div>
      </div>

      {/* Empty Filter Banner if active selection yields zero records */}
      {isFilteredOut && (
        <div className="bg-slate-900 border border-amber-700/60 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              No records match the active filter combination (<strong>{selectedDistrict}</strong> •{' '}
              <strong>{dateRange}</strong>).
            </span>
          </div>
          {onResetFilters && (
            <button
              onClick={onResetFilters}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg transition self-start sm:self-auto"
            >
              Reset Global Filters
            </button>
          )}
        </div>
      )}

      {/* TOP 5 KPI CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* KPI 1: Total Incidents */}
        <div
          onClick={() => onNavigate('incident-management')}
          className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-xs hover:border-emerald-500/50 hover:bg-slate-900 transition cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Filtered Incidents
            </span>
            <div className="p-1.5 bg-emerald-950 text-emerald-400 rounded-md border border-emerald-800/60">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-white font-mono tabular-nums">
              {incidents.length}
            </span>
            <span className="text-[10px] text-amber-400 font-semibold font-mono tabular-nums">
              {criticalOrHighIncidents} High/Crit
            </span>
          </div>
          <div className="mt-2 text-[10px] text-slate-400 flex items-center justify-between pt-1.5 border-t border-slate-800/80">
            <span>{incidents.length === 0 ? 'No events in window' : 'In active filter'}</span>
            <span className="text-emerald-400 font-semibold group-hover:underline flex items-center">
              View <ChevronRight className="w-3 h-3" />
            </span>
          </div>
        </div>

        {/* KPI 2: Active Animal Sightings */}
        <div
          onClick={() => onNavigate('animal-sightings')}
          className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-xs hover:border-sky-500/50 hover:bg-slate-900 transition cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Filtered Sightings
            </span>
            <div className="p-1.5 bg-sky-950 text-sky-400 rounded-md border border-sky-800/60">
              <Eye className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-white font-mono tabular-nums">
              {sightings.length}
            </span>
            <span className="text-[10px] text-sky-400 font-semibold">Field Logs</span>
          </div>
          <div className="mt-2 text-[10px] text-slate-400 flex items-center justify-between pt-1.5 border-t border-slate-800/80">
            <span className="font-mono tabular-nums">{totalObservedAnimals} animals observed</span>
            <span className="text-sky-400 font-semibold group-hover:underline flex items-center">
              View <ChevronRight className="w-3 h-3" />
            </span>
          </div>
        </div>

        {/* KPI 3: High-Risk Locations */}
        <div
          onClick={() => onNavigate('wildlife-risk-map')}
          className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-xs hover:border-amber-500/50 hover:bg-slate-900 transition cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              High-Risk Locations
            </span>
            <div className="p-1.5 bg-amber-950 text-amber-400 rounded-md border border-amber-800/60">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-amber-400 font-mono tabular-nums">
              {highRiskVillages.length}
            </span>
            <span className="text-[10px] text-slate-400 font-mono tabular-nums">
              of {villages.length} settlements
            </span>
          </div>
          <div className="mt-2 text-[10px] text-slate-400 flex items-center justify-between pt-1.5 border-t border-slate-800/80">
            <span className="text-amber-300 truncate">{topHighRiskVillageNames}</span>
            <span className="text-amber-400 font-semibold group-hover:underline flex items-center shrink-0">
              Map <ChevronRight className="w-3 h-3" />
            </span>
          </div>
        </div>

        {/* KPI 4: Active Alerts */}
        <div
          onClick={() => onNavigate('alert-management')}
          className={`border p-4 rounded-xl shadow-xs transition cursor-pointer group ${
            unackAlerts.length > 0
              ? 'bg-red-950/40 border-red-800/80 hover:border-red-600'
              : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-red-400">
              Active Alerts
            </span>
            <div className="p-1.5 bg-red-950 text-red-400 rounded-md border border-red-800/60">
              <Flame className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-red-400 font-mono tabular-nums">
              {unackAlerts.length}
            </span>
            <span className="text-[10px] text-red-300 font-semibold">
              {unackAlerts.length > 0 ? 'Action Required' : 'All Clear'}
            </span>
          </div>
          <div className="mt-2 text-[10px] text-slate-400 flex items-center justify-between pt-1.5 border-t border-slate-800/80">
            <span className="font-mono tabular-nums">{alerts.length} in filter</span>
            <span className="text-red-400 font-bold group-hover:underline flex items-center">
              Triage <ChevronRight className="w-3 h-3" />
            </span>
          </div>
        </div>

        {/* KPI 5: Patrols in Progress */}
        <div
          onClick={() => onNavigate('patrol-operations')}
          className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-xs hover:border-emerald-500/50 hover:bg-slate-900 transition cursor-pointer group col-span-2 md:col-span-1"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Patrols Active
            </span>
            <div className="p-1.5 bg-emerald-950 text-emerald-400 rounded-md border border-emerald-800/60">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-emerald-400 font-mono tabular-nums">
              {activePatrols.length}
            </span>
            <span className="text-[10px] text-emerald-300 font-semibold">Active Teams</span>
          </div>
          <div className="mt-2 text-[10px] text-slate-400 flex items-center justify-between pt-1.5 border-t border-slate-800/80">
            <span className="font-mono tabular-nums">
              {activePatrols.reduce((a, b) => a + b.activePersonnel, 0)} Officers on field
            </span>
            <span className="text-emerald-400 font-semibold group-hover:underline flex items-center">
              Roster <ChevronRight className="w-3 h-3" />
            </span>
          </div>
        </div>
      </div>

      {/* CENTRAL SPLIT: Large Interactive GIS Map & Spatial Corridors */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Large GIS Map Canvas */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-md flex flex-col">
          <div className="p-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <MapPin className="w-4 h-4 text-emerald-400" />
              <span className="font-bold text-white uppercase tracking-wider font-mono">
                GIS Threat Map ({incidents.length} Incidents • {villages.length} Villages)
              </span>
            </div>

            <button
              onClick={() => onNavigate('wildlife-risk-map')}
              className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded text-[11px] font-semibold transition"
            >
              <Maximize2 className="w-3 h-3" />
              <span>Full Screen GIS</span>
            </button>
          </div>

          <div className="relative h-80 sm:h-96 w-full">
            <div ref={mapContainerRef} className="w-full h-full z-0" />

            <div className="absolute bottom-3 left-3 z-10 bg-slate-950/90 backdrop-blur-xs border border-slate-800 rounded-lg p-2.5 text-[11px] text-slate-300 space-y-1">
              <div className="font-bold text-white flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span>Filtered Layers: Boundary, Zones ({riskZones.length}), Villages ({villages.length}), Incidents ({incidents.length})</span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                Open Full Screen GIS for species, severity, date & range layer controls.
              </div>
            </div>
          </div>
        </div>

        {/* Right: Active Corridor Warning & Quick AI Forecast Trigger */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4 shadow-md">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <Compass className="w-4 h-4 text-emerald-400" />
                <span>Corridors & Collar Feed</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-800/60">
                {telemetry.length} COLLARS (DEMO)
              </span>
            </div>

            {sortedTelemetry.length === 0 ? (
              <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl text-xs text-slate-400 text-center">
                No telemetry collars match the selected division filter ({selectedDistrict}).
              </div>
            ) : (
              sortedTelemetry.slice(0, 2).map((collar) => {
                const isUrgent =
                  collar.status === 'Geo-fence Breached' ||
                  collar.status === 'Approaching Boundary';
                return (
                  <div
                    key={collar.id}
                    className={`p-3.5 rounded-xl space-y-1.5 border ${
                      collar.status === 'Geo-fence Breached'
                        ? 'bg-red-950/30 border-red-800/60'
                        : isUrgent
                        ? 'bg-amber-950/20 border-amber-800/50'
                        : 'bg-slate-950/70 border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[10px] font-extrabold uppercase px-1.5 py-0.2 rounded border ${
                          collar.status === 'Geo-fence Breached'
                            ? 'text-red-400 bg-red-950 border-red-800'
                            : isUrgent
                            ? 'text-amber-300 bg-amber-950 border-amber-800/70'
                            : 'text-emerald-300 bg-emerald-950 border-emerald-800/70'
                        }`}
                      >
                        {collar.status}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        Collar #{collar.animalId}
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-white">{collar.animalName}</h4>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {collar.species} • {collar.direction} ({collar.speedKmH} km/h)
                    </p>
                    <div className="text-[11px] font-mono text-slate-400">
                      {formatCoordinates(collar.currentLat, collar.currentLng)}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="pt-2 border-t border-slate-800 space-y-2">
            <button
              onClick={() => onNavigate('conflict-prediction')}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition shadow-xs flex items-center justify-center gap-2"
            >
              <Activity className="w-4 h-4" />
              <span>Launch AI Conflict Prediction</span>
            </button>
            <p className="text-[10px] text-slate-400 text-center font-mono">
              Simulated Prototype Engine (DEMO)
            </p>
          </div>
        </div>
      </div>

      {/* CHARTS ROW: Species Distribution, Monthly Trend, Risk Categorization */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Chart 1: Species-wise Incidents */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
            <div>
              <h3 className="font-bold text-sm text-white">Species Conflict Distribution</h3>
              <p className="text-xs text-slate-400">Filtered incidents by species</p>
            </div>
            <span className="text-[10px] font-mono text-slate-300 bg-slate-800 px-2 py-0.5 rounded">
              {incidents.length} Total
            </span>
          </div>

          <div className="h-60 w-full">
            {incidents.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400 text-center px-4">
                No incidents recorded in this division/date filter.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={speciesData}
                  layout="vertical"
                  margin={{ top: 5, right: 20, left: 15, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#1e293b" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis
                    dataKey="species"
                    type="category"
                    width={85}
                    tick={{ fontSize: 10, fill: '#cbd5e1' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#020617',
                      borderColor: '#334155',
                      color: '#fff',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {speciesData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Chart 2: Monthly Conflict Trend */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
            <div>
              <h3 className="font-bold text-sm text-white">Conflict Trend</h3>
              <p className="text-xs text-slate-400">
                Jun–Oct Demo Baseline vs Active Filter
              </p>
            </div>
            <span className="text-[10px] font-mono text-amber-300 bg-amber-950/70 px-2 py-0.5 rounded border border-amber-800/60">
              DEMO BASELINE
            </span>
          </div>

          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyTrendData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#94a3b8' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#020617',
                    borderColor: '#334155',
                    color: '#fff',
                    borderRadius: '8px',
                    fontSize: '11px',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="incidents"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="sightings"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  strokeDasharray="3 3"
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 3: Risk Distribution Donut */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
            <div>
              <h3 className="font-bold text-sm text-white">Risk Distribution Index</h3>
              <p className="text-xs text-slate-400">Perimeter vulnerability breakdown</p>
            </div>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800/60">
              {villages.length} Villages
            </span>
          </div>

          <div className="h-60 w-full flex items-center justify-center">
            {villages.length === 0 ? (
              <div className="text-xs text-slate-400 text-center px-4">
                No villages match the selected division filter.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={riskDistData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {riskDistData.map((entry, index) => (
                      <Cell key={`pie-cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#020617',
                      borderColor: '#334155',
                      color: '#fff',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                  />
                  <Legend
                    layout="horizontal"
                    verticalAlign="bottom"
                    align="center"
                    wrapperStyle={{ fontSize: '10px', paddingTop: '10px', color: '#94a3b8' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* BOTTOM TABLES: High Priority Locations & Recent Incident Activity Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* High-Priority Locations Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2.5">
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-400" />
                High-Priority Vulnerable Locations
              </h3>
              <button
                onClick={() => onNavigate('wildlife-risk-map')}
                className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1"
              >
                Inspect All on Map <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {villages.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400">
                No vulnerable settlements match the selected division filter.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="text-[10px] uppercase font-mono font-bold text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Village Settlement</th>
                      <th className="py-2.5 px-3">Forest Proximity</th>
                      <th className="py-2.5 px-3">Solar Fence</th>
                      <th className="py-2.5 px-3">Risk Level</th>
                      <th className="py-2.5 px-3 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {villages.slice(0, 5).map((v) => (
                      <tr key={v.id} className="hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-semibold text-white">{v.name}</td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-slate-400">
                          {v.forestDistanceKm} km
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`text-[10px] font-bold ${
                              v.fenceStatus === 'Breached'
                                ? 'text-red-400'
                                : v.fenceStatus === 'Maintenance Required'
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                            }`}
                          >
                            {v.fenceStatus}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.2 rounded uppercase ${
                              v.riskLevel === 'Critical'
                                ? 'bg-red-950 text-red-400 border border-red-800/60'
                                : v.riskLevel === 'High'
                                ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                                : 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                            }`}
                          >
                            {v.riskLevel}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-extrabold text-white">
                          {v.riskScore}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Recent Incident Activity Timeline Feed */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2.5">
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-400" />
                Recent Incident Activity Timeline
              </h3>
              <button
                onClick={() => onNavigate('incident-management')}
                className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1"
              >
                Official Register <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {incidents.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400">
                No incidents found for {selectedDistrict} ({dateRange}).
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80 text-xs">
                {incidents.slice(0, 4).map((inc) => (
                  <div key={inc.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-bold">
                          {inc.incidentCode}
                        </span>
                        <span className="font-bold text-white truncate">{inc.species}</span>
                        <span className="text-slate-500">•</span>
                        <span className="text-slate-300 truncate">{inc.village}</span>
                      </div>
                      <p className="text-slate-400 text-[11px] line-clamp-1">{inc.description}</p>
                    </div>

                    <div className="text-right shrink-0">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          inc.severity === 'Critical'
                            ? 'bg-red-950 text-red-400 border border-red-800/60'
                            : inc.severity === 'High'
                            ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                            : 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                        }`}
                      >
                        {inc.severity}
                      </span>
                      <div className="text-[10px] text-slate-400 font-mono mt-1">
                        {new Date(inc.dateTime).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
