import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Incident,
  AnimalSighting,
  VillageRiskProfile,
  RiskZone,
  TelemetryCollar,
  SpeciesType,
} from '../types';
import {
  Layers,
  Filter,
  X,
  AlertTriangle,
  Maximize2,
  Calendar,
  RotateCcw,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { formatCoordinates } from '../utils/conflictCalculations';
import {
  escapeHtml,
  matchesDateWindow,
  matchesDivisionOrRange,
} from '../utils/wicpsFilters';

interface GisRiskMapViewProps {
  incidents: Incident[];
  sightings: AnimalSighting[];
  villages: VillageRiskProfile[];
  riskZones: RiskZone[];
  telemetry: TelemetryCollar[];
  globalDistrict?: string;
  globalDateRange?: string;
  onResetGlobalFilters?: () => void;
  onSelectIncident?: (incident: Incident) => void;
  isApiLoading?: boolean;
  apiError?: string | null;
  onRetrySync?: () => void;
}

type SelectedMapFeature =
  | { type: 'incident'; data: Incident }
  | { type: 'sighting'; data: AnimalSighting }
  | { type: 'village'; data: VillageRiskProfile }
  | { type: 'collar'; data: TelemetryCollar }
  | { type: 'riskZone'; data: RiskZone };

export const GisRiskMapView: React.FC<GisRiskMapViewProps> = ({
  incidents,
  sightings,
  villages,
  riskZones,
  telemetry,
  globalDistrict,
  globalDateRange,
  onResetGlobalFilters,
  onSelectIncident,
  isApiLoading = false,
  apiError = null,
  onRetrySync,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layersGroupRef = useRef<{
    riskZones: L.LayerGroup;
    villages: L.LayerGroup;
    incidents: L.LayerGroup;
    sightings: L.LayerGroup;
    telemetry: L.LayerGroup;
    forestBoundary: L.LayerGroup;
  } | null>(null);

  // Filters
  const [selectedSpecies, setSelectedSpecies] = useState<string>('All');
  const [selectedRiskLevel, setSelectedRiskLevel] = useState<string>('All');
  const [selectedRange, setSelectedRange] = useState<string>('All');
  const [dateFilter, setDateFilter] = useState<string>('All');

  // Layer Visibility Toggles
  const [visibleLayers, setVisibleLayers] = useState({
    zones: true,
    villages: true,
    incidents: true,
    sightings: true,
    telemetry: true,
    forestBoundary: true,
  });

  // Selected Feature for Inspection Panel
  const [selectedFeature, setSelectedFeature] = useState<SelectedMapFeature | null>(null);

  // Compute filtered items per layer
  const filteredZones = riskZones.filter((zone) => {
    if (selectedRiskLevel !== 'All' && zone.riskLevel !== selectedRiskLevel) return false;
    if (selectedSpecies !== 'All' && zone.dominantSpecies !== selectedSpecies) return false;
    if (!matchesDivisionOrRange(selectedRange, [zone.range, zone.name, zone.district])) return false;
    return true;
  });

  const filteredVillages = villages.filter((village) => {
    if (selectedRiskLevel !== 'All' && village.riskLevel !== selectedRiskLevel) return false;
    if (
      !matchesDivisionOrRange(selectedRange, [
        village.name,
        village.forestRange || '',
        village.assignedRRT,
        village.district,
      ])
    ) {
      return false;
    }
    return true;
  });

  const filteredIncidents = incidents.filter((inc) => {
    if (selectedSpecies !== 'All' && inc.species !== selectedSpecies) return false;
    if (selectedRiskLevel !== 'All' && inc.severity !== selectedRiskLevel) return false;
    if (!matchesDivisionOrRange(selectedRange, [inc.forestRange, inc.village, inc.district])) {
      return false;
    }
    if (!matchesDateWindow(inc.dateTime, dateFilter)) return false;
    return true;
  });

  const filteredSightings = sightings.filter((sighting) => {
    if (selectedSpecies !== 'All' && sighting.species !== selectedSpecies) return false;
    if (!matchesDivisionOrRange(selectedRange, [sighting.forestRange, sighting.locationName])) {
      return false;
    }
    if (!matchesDateWindow(sighting.timestamp, dateFilter)) return false;
    return true;
  });

  const filteredTelemetry = telemetry.filter((collar) => {
    if (selectedSpecies !== 'All' && collar.species !== selectedSpecies) return false;
    if (!matchesDivisionOrRange(selectedRange, [collar.animalId, collar.animalName, collar.direction])) {
      return false;
    }
    return true;
  });

  const totalVisibleFeatures =
    (visibleLayers.zones ? filteredZones.length : 0) +
    (visibleLayers.villages ? filteredVillages.length : 0) +
    (visibleLayers.incidents ? filteredIncidents.length : 0) +
    (visibleLayers.sightings ? filteredSightings.length : 0) +
    (visibleLayers.telemetry ? filteredTelemetry.length : 0);

  // Initial Map Setup
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [11.668, 76.615],
        zoom: 12,
        zoomControl: false,
      });

      L.control.zoom({ position: 'topright' }).addTo(map);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);

      const zoneGroup = L.layerGroup().addTo(map);
      const villageGroup = L.layerGroup().addTo(map);
      const incidentGroup = L.layerGroup().addTo(map);
      const sightingGroup = L.layerGroup().addTo(map);
      const telemetryGroup = L.layerGroup().addTo(map);
      const boundaryGroup = L.layerGroup().addTo(map);

      layersGroupRef.current = {
        riskZones: zoneGroup,
        villages: villageGroup,
        incidents: incidentGroup,
        sightings: sightingGroup,
        telemetry: telemetryGroup,
        forestBoundary: boundaryGroup,
      };

      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        layersGroupRef.current = null;
      }
    };
  }, []);

  // Update Layers & Markers based on filters & data
  useEffect(() => {
    if (!mapInstanceRef.current || !layersGroupRef.current) return;

    const {
      riskZones: zoneGroup,
      villages: villageGroup,
      incidents: incidentGroup,
      sightings: sightingGroup,
      telemetry: telemetryGroup,
      forestBoundary: boundaryGroup,
    } = layersGroupRef.current;

    zoneGroup.clearLayers();
    villageGroup.clearLayers();
    incidentGroup.clearLayers();
    sightingGroup.clearLayers();
    telemetryGroup.clearLayers();
    boundaryGroup.clearLayers();

    // 1. Forest Boundary Polygon
    if (visibleLayers.forestBoundary) {
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
        color: '#10b981',
        weight: 2.5,
        dashArray: '6, 6',
        fillColor: '#10b981',
        fillOpacity: 0.08,
      })
        .bindTooltip('<b>Bandipur National Park & Tiger Reserve</b><br/>Protected Reserve Boundary', {
          sticky: true,
        })
        .addTo(boundaryGroup);
    }

    // 2. Risk Zones Polygons
    if (visibleLayers.zones) {
      filteredZones.forEach((zone) => {
        const color =
          zone.riskLevel === 'Critical'
            ? '#ef4444'
            : zone.riskLevel === 'High'
            ? '#f97316'
            : zone.riskLevel === 'Moderate'
            ? '#eab308'
            : '#22c55e';

        const poly = L.polygon(zone.polygonCoordinates, {
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.24,
        }).addTo(zoneGroup);

        poly.bindTooltip(
          `<div class="p-1">
            <span class="font-bold text-xs uppercase" style="color:${color}">${escapeHtml(zone.riskLevel)} CONFLICT ZONE</span>
            <div class="font-semibold text-sm">${escapeHtml(zone.name)}</div>
            <div class="text-xs text-slate-300">Risk Score: ${zone.riskScore}% • ${escapeHtml(zone.dominantSpecies)}</div>
          </div>`,
          { sticky: true }
        );

        poly.on('click', () => {
          setSelectedFeature({ type: 'riskZone', data: zone });
        });
      });
    }

    // 3. Villages
    if (visibleLayers.villages) {
      filteredVillages.forEach((village) => {
        const color =
          village.riskLevel === 'Critical'
            ? '#ef4444'
            : village.riskLevel === 'High'
            ? '#f97316'
            : village.riskLevel === 'Moderate'
            ? '#eab308'
            : '#22c55e';

        const customIcon = L.divIcon({
          className: 'custom-village-icon',
          html: `<div style="
            background-color: #0f172a; 
            border: 2px solid ${color}; 
            box-shadow: 0 2px 6px rgba(0,0,0,0.5); 
            border-radius: 9999px; 
            width: 26px; 
            height: 26px; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            font-size: 11px;
            color: #f8fafc;
          ">
            🏘️
          </div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });

        const marker = L.marker(village.coordinates, { icon: customIcon }).addTo(villageGroup);
        marker.bindTooltip(
          `<b>${escapeHtml(village.name)}</b><br/>Risk: <span style="color:${color}">${escapeHtml(village.riskLevel)} (${village.riskScore}%)</span><br/>Forest Dist: ${village.forestDistanceKm} km`,
          { sticky: true }
        );

        marker.on('click', () => {
          setSelectedFeature({ type: 'village', data: village });
        });
      });
    }

    // 4. Incidents
    if (visibleLayers.incidents) {
      filteredIncidents.forEach((inc) => {
        const speciesEmoji: Record<SpeciesType, string> = {
          'Asian Elephant': '🐘',
          'Bengal Tiger': '🐅',
          'Indian Leopard': '🐆',
          'Sloth Bear': '🐻',
          'Wild Boar': '🐗',
          Gaur: '🐂',
        };

        const bgBadge =
          inc.severity === 'Critical'
            ? '#b91c1c'
            : inc.severity === 'High'
            ? '#c2410c'
            : inc.severity === 'Moderate'
            ? '#a16207'
            : '#15803d';

        const iconHtml = `
          <div style="
            background: ${bgBadge}; 
            color: white; 
            border: 2px solid #ffffff; 
            border-radius: 8px; 
            width: 32px; 
            height: 32px; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            font-size: 16px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.45);
            cursor: pointer;
          ">
            ${speciesEmoji[inc.species] || '⚠️'}
          </div>
        `;

        const incidentIcon = L.divIcon({
          className: 'custom-incident-marker',
          html: iconHtml,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });

        const marker = L.marker([inc.latitude, inc.longitude], { icon: incidentIcon }).addTo(
          incidentGroup
        );

        marker.bindTooltip(
          `<div class="p-1">
            <span class="text-[10px] font-mono bg-slate-800 text-emerald-300 px-1 py-0.5 rounded">${escapeHtml(inc.incidentCode)}</span>
            <div class="font-bold text-xs mt-1">${escapeHtml(inc.species)} • ${escapeHtml(inc.incidentType)}</div>
            <div class="text-[11px] text-slate-300">${escapeHtml(inc.village)}</div>
            <div class="text-[10px] text-amber-300 font-semibold">${escapeHtml(inc.status)}</div>
          </div>`,
          { sticky: true }
        );

        marker.on('click', () => {
          setSelectedFeature({ type: 'incident', data: inc });
        });
      });
    }

    // 5. Animal Sightings
    if (visibleLayers.sightings) {
      filteredSightings.forEach((sighting) => {
        const sightingIcon = L.divIcon({
          className: 'custom-sighting-marker',
          html: `
            <div style="
              background: #0284c7; 
              color: white; 
              border: 2px solid #ffffff; 
              border-radius: 9999px; 
              width: 28px; 
              height: 28px; 
              display: flex; 
              align-items: center; 
              justify-content: center;
              font-size: 13px;
              box-shadow: 0 2px 6px rgba(0,0,0,0.4);
            ">
              👁️
            </div>
          `,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        const marker = L.marker([sighting.latitude, sighting.longitude], {
          icon: sightingIcon,
        }).addTo(sightingGroup);
        marker.bindTooltip(
          `<b>Sighting: ${escapeHtml(sighting.species)} (Herd: ${sighting.herdSize})</b><br/>Heading: ${escapeHtml(sighting.movementDirection)}<br/>${escapeHtml(sighting.locationName)}`,
          { sticky: true }
        );

        marker.on('click', () => {
          setSelectedFeature({ type: 'sighting', data: sighting });
        });
      });
    }

    // 6. Telemetry Collars
    if (visibleLayers.telemetry) {
      filteredTelemetry.forEach((collar) => {
        L.polyline(collar.trail, {
          color: '#a78bfa',
          weight: 2,
          dashArray: '4, 4',
        }).addTo(telemetryGroup);

        const collarIcon = L.divIcon({
          className: 'custom-collar-marker',
          html: `
            <div style="
              background: #6d28d9; 
              color: #ffffff; 
              border: 2px solid #c4b5fd; 
              border-radius: 9999px; 
              width: 26px; 
              height: 26px; 
              display: flex; 
              align-items: center; 
              justify-content: center;
              font-size: 11px;
              box-shadow: 0 0 10px #8b5cf6;
            ">
              📡
            </div>
          `,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });

        const marker = L.marker([collar.currentLat, collar.currentLng], {
          icon: collarIcon,
        }).addTo(telemetryGroup);
        marker.bindTooltip(
          `<b>Collar #${escapeHtml(collar.animalId)}</b>: ${escapeHtml(collar.animalName)}<br/>Speed: ${collar.speedKmH} km/h • ${escapeHtml(collar.status)}`,
          { sticky: true }
        );

        marker.on('click', () => {
          setSelectedFeature({ type: 'collar', data: collar });
        });
      });
    }
  }, [
    filteredZones,
    filteredVillages,
    filteredIncidents,
    filteredSightings,
    filteredTelemetry,
    visibleLayers,
  ]);

  const toggleLayer = (layerKey: keyof typeof visibleLayers) => {
    setVisibleLayers((prev) => ({ ...prev, [layerKey]: !prev[layerKey] }));
  };

  const handleResetMap = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([11.668, 76.615], 12);
    }
  };

  const handleResetAllMapFilters = () => {
    setSelectedSpecies('All');
    setSelectedRiskLevel('All');
    setSelectedRange('All');
    setDateFilter('All');
    onResetGlobalFilters?.();
  };

  return (
    <div className="relative w-full h-[calc(100vh-4rem)] flex flex-col bg-slate-950 text-slate-100">
      {/* Top Filter and Layer Control Toolbar */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 z-10 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        {/* Left: Species, Severity, Range & Date Filter dropdowns */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1 font-semibold text-emerald-400 mr-1">
            <Filter className="w-3.5 h-3.5" />
            <span>GIS Filters:</span>
          </div>

          <select
            aria-label="GIS Species Filter"
            value={selectedSpecies}
            onChange={(e) => setSelectedSpecies(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 font-medium focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
          >
            <option value="All">All Wildlife Species</option>
            <option value="Asian Elephant">Asian Elephant</option>
            <option value="Bengal Tiger">Bengal Tiger</option>
            <option value="Indian Leopard">Indian Leopard</option>
            <option value="Sloth Bear">Sloth Bear</option>
            <option value="Wild Boar">Wild Boar</option>
            <option value="Gaur">Gaur</option>
          </select>

          <select
            aria-label="GIS Risk Level Filter"
            value={selectedRiskLevel}
            onChange={(e) => setSelectedRiskLevel(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 font-medium focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
          >
            <option value="All">All Risk Severity</option>
            <option value="Critical">Critical Severity</option>
            <option value="High">High Severity</option>
            <option value="Moderate">Moderate Severity</option>
            <option value="Low">Low Severity</option>
          </select>

          <select
            aria-label="GIS Forest Range Filter"
            value={selectedRange}
            onChange={(e) => setSelectedRange(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 font-medium focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
          >
            <option value="All">All Forest Ranges</option>
            <option value="Hediyala Range">Hediyala Range</option>
            <option value="Gundlupet Buffer">Gundlupet Buffer</option>
            <option value="Omkar Range">Omkar Range</option>
            <option value="Maddur Range">Maddur Range</option>
            <option value="GS Betta Range">GS Betta Range</option>
          </select>

          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1">
            <Calendar className="w-3.5 h-3.5 text-emerald-400" />
            <select
              aria-label="GIS Date Filter"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-transparent text-slate-200 font-mono focus:outline-hidden"
            >
              <option value="All" className="bg-slate-950">All Dates (In Global Filter)</option>
              <option value="Live (Last 24 Hours)" className="bg-slate-950">Last 24 Hours</option>
              <option value="Last 7 Days" className="bg-slate-950">Last 7 Days</option>
              <option value="Last 30 Days" className="bg-slate-950">Last 30 Days</option>
            </select>
          </div>
        </div>

        {/* Right: Map Layers Toggles & Recenter */}
        <div className="flex items-center gap-2 text-xs">
          <div className="hidden sm:flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => toggleLayer('zones')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                visibleLayers.zones
                  ? 'bg-red-950 text-red-300 border border-red-800/60 font-bold'
                  : 'text-slate-500'
              }`}
            >
              Risk Zones ({filteredZones.length})
            </button>
            <button
              onClick={() => toggleLayer('villages')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                visibleLayers.villages
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60 font-bold'
                  : 'text-slate-500'
              }`}
            >
              Villages ({filteredVillages.length})
            </button>
            <button
              onClick={() => toggleLayer('incidents')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                visibleLayers.incidents
                  ? 'bg-amber-950 text-amber-300 border border-amber-800/60 font-bold'
                  : 'text-slate-500'
              }`}
            >
              Incidents ({filteredIncidents.length})
            </button>
            <button
              onClick={() => toggleLayer('sightings')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                visibleLayers.sightings
                  ? 'bg-sky-950 text-sky-300 border border-sky-800/60 font-bold'
                  : 'text-slate-500'
              }`}
            >
              Sightings ({filteredSightings.length})
            </button>
            <button
              onClick={() => toggleLayer('telemetry')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                visibleLayers.telemetry
                  ? 'bg-purple-950 text-purple-300 border border-purple-800/60 font-bold'
                  : 'text-slate-500'
              }`}
            >
              Collars ({filteredTelemetry.length})
            </button>
          </div>

          <button
            onClick={handleResetMap}
            className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 py-1.5 rounded-lg text-slate-200 font-medium transition"
            title="Recenter Map View"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Reset View</span>
          </button>
        </div>
      </div>

      {/* Map Body and Interactive Side Drawer */}
      <div className="relative flex-1 w-full h-full overflow-hidden">
        <div ref={mapContainerRef} className="w-full h-full z-0" />

        {/* Loading, Error, or Empty Results Overlay Banner */}
        {isApiLoading && villages.length === 0 && riskZones.length === 0 ? (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-slate-900/95 border border-emerald-700/70 rounded-xl px-4 py-3 shadow-xl flex items-center gap-3 text-xs">
            <Loader2 className="w-4 h-4 text-emerald-400 animate-spin shrink-0" />
            <span className="text-slate-200">
              Loading villages and GIS risk zones from FastAPI + PostGIS...
            </span>
          </div>
        ) : apiError && villages.length === 0 && riskZones.length === 0 ? (
          <div
            role="alert"
            className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-slate-900/95 border border-red-700/70 rounded-xl px-4 py-3 shadow-xl flex items-center gap-3 text-xs max-w-xl"
          >
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span className="text-red-200">
              Unable to load GIS villages &amp; risk zones from backend API ({apiError}).
            </span>
            {onRetrySync && (
              <button
                type="button"
                onClick={onRetrySync}
                className="flex items-center gap-1 bg-red-700 hover:bg-red-600 text-white px-2.5 py-1 rounded-md font-semibold transition shrink-0"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Retry API Sync</span>
              </button>
            )}
          </div>
        ) : (
          totalVisibleFeatures === 0 && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-slate-900/95 border border-amber-700/70 rounded-xl px-4 py-3 shadow-xl flex items-center gap-3 text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-slate-200">
                No GIS features match the active filters
                {globalDistrict ? ` (${globalDistrict}${globalDateRange ? ` • ${globalDateRange}` : ''})` : ''}.
              </span>
              <button
                onClick={handleResetAllMapFilters}
                className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded-md font-semibold transition"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Filters</span>
              </button>
            </div>
          )
        )}

        {/* Floating Legend Card */}
        <div className="absolute bottom-5 left-5 z-20 bg-slate-900/95 backdrop-blur-xs p-3.5 rounded-xl shadow-xl border border-slate-800 text-xs w-64 text-slate-200">
          <div className="font-bold text-white mb-2 flex items-center justify-between border-b border-slate-800 pb-1.5">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-emerald-400" /> GIS Legend
            </span>
            <span className="text-[10px] text-slate-400 font-mono">WGS 84</span>
          </div>

          <div className="space-y-1.5 text-[11px] text-slate-300">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-red-600/40 border border-red-500 inline-block"></span>
                <span>Critical Risk Zone</span>
              </span>
              <span className="text-[10px] text-red-400 font-semibold font-mono">&gt; 80%</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-amber-500/40 border border-amber-500 inline-block"></span>
                <span>High Risk Zone</span>
              </span>
              <span className="text-[10px] text-amber-400 font-semibold font-mono">60-80%</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-sm">🏘️</span>
              <span>Settlement / Village</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-sm">🐘</span>
              <span>Asian Elephant Incident</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-sm">🐆</span>
              <span>Carnivore Incident</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-sm">👁️</span>
              <span>Animal Sighting</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-sm">📡</span>
              <span>Telemetry Collar (Demo)</span>
            </div>

            <div className="pt-1.5 border-t border-slate-800 text-[10px] text-slate-400">
              Click any zone polygon or marker to inspect details.
            </div>
          </div>
        </div>

        {/* Selected Marker Inspection Drawer */}
        {selectedFeature && (
          <div className="absolute top-4 right-4 z-20 w-80 sm:w-96 bg-slate-900/95 backdrop-blur-md rounded-xl shadow-2xl border border-slate-800 overflow-hidden transition-all animate-in fade-in slide-in-from-right-4">
            {/* Header */}
            <div className="bg-slate-950 border-b border-slate-800 text-white p-3.5 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-emerald-400 font-mono text-xs uppercase font-bold tracking-wider">
                  GIS Inspect • {selectedFeature.type === 'riskZone' ? 'RISK ZONE' : selectedFeature.type.toUpperCase()}
                </span>
              </div>
              <button
                onClick={() => setSelectedFeature(null)}
                className="text-slate-400 hover:text-white p-1 rounded-md transition"
                aria-label="Close details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Feature Content */}
            <div className="p-4 max-h-[75vh] overflow-y-auto text-xs space-y-3.5 text-slate-300">
              {/* RISK ZONE FEATURE */}
              {selectedFeature.type === 'riskZone' && (() => {
                const zone = selectedFeature.data;
                const relatedVillages = villages.filter((v) =>
                  matchesDivisionOrRange(zone.range, [v.name, v.assignedRRT])
                );
                const relatedIncidents = incidents.filter((inc) =>
                  matchesDivisionOrRange(zone.range, [inc.forestRange, inc.village])
                );
                return (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-emerald-400 font-mono text-[11px] font-bold uppercase">
                          {zone.range} • {zone.district}
                        </span>
                        <h4 className="text-base font-bold text-white mt-0.5">{zone.name}</h4>
                        <div className="text-slate-400 text-[11px]">
                          Dominant Species: <span className="text-slate-200 font-semibold">{zone.dominantSpecies}</span>
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold font-mono shrink-0 ${
                          zone.riskLevel === 'Critical'
                            ? 'bg-red-950 text-red-300 border border-red-800/60'
                            : zone.riskLevel === 'High'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
                            : 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                        }`}
                      >
                        {zone.riskLevel} ({zone.riskScore}%)
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                      <div>
                        <div className="text-slate-400 text-[10px] uppercase font-bold">Zone Risk Score</div>
                        <div className="font-mono font-bold text-white">{zone.riskScore} / 100</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px] uppercase font-bold">Active Alerts</div>
                        <div className="font-mono font-bold text-amber-300">{zone.activeAlertCount} Logged</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px] uppercase font-bold">Verification Priority</div>
                        <div className="font-semibold text-emerald-300">
                          {zone.riskLevel === 'Critical'
                            ? 'Immediate Field Sweep'
                            : zone.riskLevel === 'High'
                            ? 'Pre-Dusk Check'
                            : 'Routine Beat Watch'}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px] uppercase font-bold">Center Coords</div>
                        <div className="font-mono text-[11px] text-slate-200">
                          {formatCoordinates(zone.centerCoordinates[0], zone.centerCoordinates[1])}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="text-slate-400 text-[10px] uppercase font-bold mb-1">
                        Primary Conflict Driver
                      </div>
                      <p className="text-slate-200 bg-slate-950 p-2.5 rounded-lg border border-slate-800 leading-relaxed">
                        {zone.primaryRiskFactor}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-slate-400 text-[10px] uppercase font-bold">
                        Nearby Settlements in Range ({relatedVillages.length})
                      </div>
                      {relatedVillages.length === 0 ? (
                        <div className="text-slate-500 text-[11px]">No settlements in filtered range.</div>
                      ) : (
                        <div className="space-y-1">
                          {relatedVillages.map((v) => (
                            <div
                              key={v.id}
                              className="flex items-center justify-between bg-slate-950 px-2.5 py-1.5 rounded border border-slate-800"
                            >
                              <span className="font-semibold text-slate-200">{v.name}</span>
                              <span className="font-mono text-[11px] text-amber-300">
                                {v.riskLevel} ({v.riskScore}%)
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-slate-400 text-[10px] uppercase font-bold">
                        Recent Incidents in Range ({relatedIncidents.length})
                      </div>
                      {relatedIncidents.length === 0 ? (
                        <div className="text-slate-500 text-[11px]">No incidents in active filter.</div>
                      ) : (
                        <div className="space-y-1">
                          {relatedIncidents.slice(0, 3).map((inc) => (
                            <div
                              key={inc.id}
                              className="flex items-center justify-between bg-slate-950 px-2.5 py-1.5 rounded border border-slate-800"
                            >
                              <span className="font-mono text-emerald-300">{inc.incidentCode}</span>
                              <span className="text-slate-300 truncate max-w-[160px]">{inc.species} • {inc.village}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}

              {/* INCIDENT FEATURE */}
              {selectedFeature.type === 'incident' && (
                <>
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-emerald-400 font-mono text-[11px] font-semibold">
                        {selectedFeature.data.incidentCode}
                      </span>
                      <h4 className="text-base font-bold text-white">
                        {selectedFeature.data.species}
                      </h4>
                      <div className="text-slate-400 font-medium">
                        {selectedFeature.data.incidentType}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        selectedFeature.data.severity === 'Critical'
                          ? 'bg-red-950 text-red-300 border border-red-800/60'
                          : selectedFeature.data.severity === 'High'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
                          : 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                      }`}
                    >
                      {selectedFeature.data.severity}
                    </span>
                  </div>

                  {selectedFeature.data.imageUrl && (
                    <div className="rounded-lg overflow-hidden border border-slate-800">
                      <img
                        src={selectedFeature.data.imageUrl}
                        alt="Wildlife field evidence"
                        className="w-full h-36 object-cover"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <div>
                      <div className="text-slate-400 text-[10px] uppercase font-bold">Village</div>
                      <div className="font-semibold text-white">{selectedFeature.data.village}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-[10px] uppercase font-bold">Range</div>
                      <div className="font-semibold text-white">{selectedFeature.data.forestRange}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-[10px] uppercase font-bold">Human Injury</div>
                      <div className="font-semibold text-white">{selectedFeature.data.humanInjury}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-[10px] uppercase font-bold">Crop Damage</div>
                      <div className="font-semibold text-white">
                        {selectedFeature.data.cropDamageEstimatedAcres > 0
                          ? `${selectedFeature.data.cropDamageEstimatedAcres} Acres`
                          : 'None'}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-slate-400 text-[10px] uppercase font-bold mb-1">
                      Field Incident Report
                    </div>
                    <p className="text-slate-200 bg-slate-950 p-2.5 rounded border border-slate-800 leading-relaxed">
                      {selectedFeature.data.description}
                    </p>
                  </div>

                  <div className="text-[11px] text-slate-400 space-y-1">
                    <div>
                      <span className="font-semibold text-slate-300">Coordinates:</span>{' '}
                      <span className="font-mono">
                        {formatCoordinates(selectedFeature.data.latitude, selectedFeature.data.longitude)}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-300">Assigned Officer:</span>{' '}
                      {selectedFeature.data.assignedOfficer || 'Not assigned'}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-300">Current Status:</span>{' '}
                      <span className="font-bold text-emerald-400">{selectedFeature.data.status}</span>
                    </div>
                  </div>

                  {onSelectIncident && (
                    <button
                      onClick={() => onSelectIncident(selectedFeature.data)}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg font-semibold transition"
                    >
                      Manage Incident Details
                    </button>
                  )}
                </>
              )}

              {/* SIGHTING FEATURE */}
              {selectedFeature.type === 'sighting' && (
                <>
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-sky-400 font-mono text-[11px]">
                        {selectedFeature.data.sightingCode}
                      </span>
                      <h4 className="text-base font-bold text-white">
                        {selectedFeature.data.species} Sighting
                      </h4>
                      <div className="text-sky-300 font-medium">
                        Herd Size: {selectedFeature.data.herdSize} Animals
                      </div>
                    </div>
                    <span className="bg-sky-950 text-sky-300 border border-sky-800/60 font-bold text-[10px] px-2 py-0.5 rounded">
                      {selectedFeature.data.verifiedByForestGuard ? 'VERIFIED' : 'FIELD LOG'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <div>
                      <div className="text-slate-400 text-[10px] uppercase font-bold">Movement Heading</div>
                      <div className="font-semibold text-white">
                        {selectedFeature.data.movementDirection} ({selectedFeature.data.bearingDegrees}°)
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-[10px] uppercase font-bold">Behavior</div>
                      <div className="font-semibold text-white">{selectedFeature.data.behavior}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-[10px] uppercase font-bold">Range</div>
                      <div className="font-semibold text-white">{selectedFeature.data.forestRange}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-[10px] uppercase font-bold">Observer</div>
                      <div className="font-semibold text-white">{selectedFeature.data.observerName}</div>
                    </div>
                  </div>

                  <div>
                    <div className="text-slate-400 text-[10px] uppercase font-bold mb-1">
                      Observation Notes
                    </div>
                    <p className="text-slate-200 bg-slate-950 p-2.5 rounded border border-slate-800 leading-relaxed">
                      {selectedFeature.data.observationDetails}
                    </p>
                  </div>

                  <div className="text-[11px] text-slate-400 font-mono">
                    Lat/Lng: {formatCoordinates(selectedFeature.data.latitude, selectedFeature.data.longitude)}
                  </div>
                </>
              )}

              {/* VILLAGE FEATURE */}
              {selectedFeature.type === 'village' && (
                <>
                  <div>
                    <h4 className="text-base font-bold text-white">{selectedFeature.data.name}</h4>
                    <div className="text-xs text-slate-400">Vulnerable Human Settlement</div>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Risk Assessment:</span>
                      <span className="font-bold text-red-400">
                        {selectedFeature.data.riskLevel} ({selectedFeature.data.riskScore}%)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Population / Homes:</span>
                      <span className="font-semibold text-slate-200">
                        {selectedFeature.data.population} residents ({selectedFeature.data.households} households)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Proximity to Forest:</span>
                      <span className="font-semibold text-slate-200">
                        {selectedFeature.data.forestDistanceKm} km
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Solar Fence Status:</span>
                      <span className="font-semibold text-amber-300">
                        {selectedFeature.data.fenceStatus}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Assigned Response Team:</span>
                      <span className="font-semibold text-emerald-300">
                        {selectedFeature.data.assignedRRT}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-1 border-t border-slate-800">
                      <span className="text-slate-400">Emergency Base:</span>
                      <span className="font-mono font-bold text-sky-400">
                        {selectedFeature.data.emergencyContact}
                      </span>
                    </div>
                  </div>
                </>
              )}

              {/* COLLAR TELEMETRY FEATURE */}
              {selectedFeature.type === 'collar' && (
                <>
                  <div>
                    <span className="text-purple-400 font-mono text-[11px] font-bold">
                      TAG #{selectedFeature.data.animalId} (DEMO)
                    </span>
                    <h4 className="text-base font-bold text-white">{selectedFeature.data.animalName}</h4>
                    <div className="text-xs text-slate-400">{selectedFeature.data.species}</div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 bg-slate-950 p-2.5 rounded-lg border border-purple-900/60">
                    <div>
                      <div className="text-slate-400 text-[10px] uppercase font-bold">Collar Battery</div>
                      <div className="font-semibold text-purple-300 font-mono">
                        {selectedFeature.data.collarBattery}%
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-[10px] uppercase font-bold">Speed</div>
                      <div className="font-semibold text-purple-300 font-mono">
                        {selectedFeature.data.speedKmH} km/h
                      </div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-slate-400 text-[10px] uppercase font-bold">Boundary Status</div>
                      <div className="font-bold text-amber-300">{selectedFeature.data.status}</div>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-400 font-mono">
                    Last Ping: {selectedFeature.data.lastPingTime}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
