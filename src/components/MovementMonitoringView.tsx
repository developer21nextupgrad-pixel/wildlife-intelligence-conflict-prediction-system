import React, { useEffect, useState } from 'react';
import { TelemetryCollar } from '../types';
import {
  Radio,
  Battery,
  Camera,
  RefreshCw,
} from 'lucide-react';
import { formatCoordinates } from '../utils/conflictCalculations';

interface MovementMonitoringViewProps {
  telemetry: TelemetryCollar[];
}

export const MovementMonitoringView: React.FC<MovementMonitoringViewProps> = ({ telemetry }) => {
  const [selectedCollar, setSelectedCollar] = useState<TelemetryCollar | null>(
    telemetry[0] ?? null
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedLabel, setLastRefreshedLabel] = useState<string>('Demo Feed Active');

  useEffect(() => {
    if (telemetry.length === 0) {
      setSelectedCollar(null);
      return;
    }
    if (!selectedCollar || !telemetry.some((t) => t.id === selectedCollar.id)) {
      setSelectedCollar(telemetry[0]);
    }
  }, [telemetry, selectedCollar]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      setLastRefreshedLabel(`Demo ping refreshed at ${new Date().toLocaleTimeString()}`);
    }, 500);
  };

  const breachedCollars = telemetry.filter((c) => c.status === 'Geo-fence Breached');
  const approachingCollars = telemetry.filter((c) => c.status === 'Approaching Boundary');
  const avgBattery =
    telemetry.length > 0
      ? Math.round(telemetry.reduce((sum, c) => sum + c.collarBattery, 0) / telemetry.length)
      : 0;

  const cameraTrapEvents = [
    {
      id: 'ct-1',
      cameraName: 'Grid CT-18 (Mangala Gully)',
      species: 'Indian Leopard',
      confidence: 96,
      timestamp: 'Sample Event • 04:48 IST',
      imageUrl:
        'https://images.unsplash.com/photo-1456926631375-92c8ce872def?auto=format&fit=crop&w=400&q=80',
      action: 'Demo Alert: Logged for Beat Guard review',
    },
    {
      id: 'ct-2',
      cameraName: 'Grid CT-09 (Hediyala Stream)',
      species: 'Asian Elephant (Herd of 8)',
      confidence: 99,
      timestamp: 'Sample Event • 05:10 IST',
      imageUrl:
        'https://images.unsplash.com/photo-1557050543-4d5f4e07ef46?auto=format&fit=crop&w=400&q=80',
      action: 'Demo Alert: QRT Patrol notified of stream crossing',
    },
    {
      id: 'ct-3',
      cameraName: 'Grid CT-24 (Omkar Salt Lick)',
      species: 'Bengal Tiger (T-114)',
      confidence: 98,
      timestamp: 'Sample Event • 03:40 IST',
      imageUrl:
        'https://images.unsplash.com/photo-1561731216-c3a4d99437d5?auto=format&fit=crop&w=400&q=80',
      action: 'Demo Alert: Logged into Core Sanctuary Register',
    },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-sky-400 font-bold uppercase tracking-wider">
            <span>Simulated Telemetry Grid</span>
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
            <span>Prototype Animal Movement Feed (DEMO)</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            Wildlife Movement & Geofence Telemetry
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Simulated GPS collar tracks, virtual boundary alerts, and sample camera-trap detections ({lastRefreshedLabel}).
          </p>
        </div>

        <button
          onClick={handleRefresh}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs sm:text-sm font-semibold px-3 py-2 rounded-lg border border-slate-700 shadow-xs transition self-start sm:self-auto"
        >
          <RefreshCw className={`w-4 h-4 text-sky-400 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>Refresh Demo Feed</span>
        </button>
      </div>

      {/* Top Telemetry KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xs">
          <div className="text-slate-400 text-xs font-bold uppercase">Filtered Radiocollars</div>
          <div className="text-2xl font-extrabold text-white font-mono tabular-nums mt-1">
            {telemetry.length} Units
          </div>
          <div className="text-[11px] text-emerald-400 font-semibold mt-1 flex items-center gap-1 font-mono tabular-nums">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Avg Battery: {avgBattery}%
          </div>
        </div>

        <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xs">
          <div className="text-slate-400 text-xs font-bold uppercase">Geofence Breaches</div>
          <div className="text-2xl font-extrabold text-amber-400 font-mono tabular-nums mt-1">
            {breachedCollars.length} Breach{breachedCollars.length === 1 ? '' : 'es'}
          </div>
          <div className="text-[11px] text-amber-300 font-semibold mt-1 truncate">
            {breachedCollars[0]
              ? `Collar #${breachedCollars[0].animalId} (${breachedCollars[0].animalName})`
              : `${approachingCollars.length} Approaching Boundary`}
          </div>
        </div>

        <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-bold uppercase">Sample Camera Detections</span>
            <span className="text-[9px] font-mono bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">DEMO</span>
          </div>
          <div className="text-2xl font-extrabold text-white font-mono tabular-nums mt-1">
            {cameraTrapEvents.length} Samples
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Static prototype reference grid
          </div>
        </div>

        <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-bold uppercase">Approaching Boundary</span>
            <span className="text-[9px] font-mono bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">FILTERED</span>
          </div>
          <div className="text-2xl font-extrabold text-sky-400 font-mono tabular-nums mt-1">
            {approachingCollars.length} Collars
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Within peripheral corridor buffer
          </div>
        </div>
      </div>

      {/* Main Telemetry & Collar Tracking Interface */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Collars List */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xs p-5 space-y-3">
          <h3 className="font-bold text-sm text-white flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-purple-400" />
              Collared Individuals (Demo)
            </span>
            <span className="text-[11px] font-mono text-slate-400">{telemetry.length} Units</span>
          </h3>

          {telemetry.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 bg-slate-950 rounded-xl border border-slate-800">
              No telemetry collars match the active division filter.
            </div>
          ) : (
            <div className="space-y-2.5">
              {telemetry.map((collar) => (
                <div
                  key={collar.id}
                  onClick={() => setSelectedCollar(collar)}
                  className={`p-3.5 rounded-xl border transition cursor-pointer text-xs ${
                    selectedCollar?.id === collar.id
                      ? 'border-purple-500 bg-purple-950/30 shadow-xs'
                      : 'border-slate-800 bg-slate-950/60 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-mono text-[10px] text-purple-300 font-bold bg-purple-950 px-1.5 py-0.5 rounded border border-purple-800/60">
                        TAG #{collar.animalId}
                      </span>
                      <h4 className="font-bold text-white text-sm mt-1">{collar.animalName}</h4>
                      <div className="text-slate-400">{collar.species}</div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                        collar.status === 'Geo-fence Breached'
                          ? 'bg-red-950 text-red-300 border border-red-800/60'
                          : collar.status === 'Approaching Boundary'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
                          : 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                      }`}
                    >
                      {collar.status}
                    </span>
                  </div>

                  <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
                    <span className="flex items-center gap-1">
                      <Battery className="w-3.5 h-3.5 text-slate-500" /> {collar.collarBattery}%
                    </span>
                    <span>Speed: {collar.speedKmH} km/h</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Center: Selected Collar Telemetry Details */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xs p-6 space-y-4 lg:col-span-2">
          {selectedCollar ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between border-b border-slate-800 pb-3">
                <div>
                  <span className="font-mono text-xs text-purple-400 font-bold">
                    SIMULATED BEACON • {selectedCollar.animalId}
                  </span>
                  <h3 className="text-xl font-extrabold text-white">{selectedCollar.animalName}</h3>
                  <div className="text-xs text-slate-400">{selectedCollar.species}</div>
                </div>

                <div className="text-right">
                  <div className="text-xs font-semibold text-slate-400">Sample Ping Label</div>
                  <div className="text-xs font-mono font-bold text-emerald-400">
                    {selectedCollar.lastPingTime}
                  </div>
                </div>
              </div>

              {/* Stats Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-xs">
                <div>
                  <div className="text-slate-400 text-[10px] uppercase font-bold">Collar Battery</div>
                  <div className="font-extrabold text-white font-mono tabular-nums text-sm mt-0.5">
                    {selectedCollar.collarBattery}%
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 text-[10px] uppercase font-bold">Current Speed</div>
                  <div className="font-extrabold text-white font-mono tabular-nums text-sm mt-0.5">
                    {selectedCollar.speedKmH} km/h
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 text-[10px] uppercase font-bold">Heading Vector</div>
                  <div className="font-semibold text-slate-200 text-xs mt-0.5">
                    {selectedCollar.direction}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 text-[10px] uppercase font-bold">Boundary Status</div>
                  <div className="font-bold text-amber-400 text-xs mt-0.5">
                    {selectedCollar.status}
                  </div>
                </div>
              </div>

              {/* Waypoints Trail */}
              <div>
                <h4 className="text-xs font-bold uppercase text-slate-300 mb-2">
                  Sample GPS Breadcrumb Waypoints
                </h4>
                <div className="space-y-1.5 text-xs font-mono">
                  {selectedCollar.trail.map((pt, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 rounded bg-slate-950 border border-slate-800"
                    >
                      <span className="text-slate-400">Waypoint #{idx + 1}</span>
                      <span className="font-bold text-slate-200">{formatCoordinates(pt[0], pt[1])}</span>
                      <span className="text-[10px] text-emerald-400 font-sans font-semibold">
                        Demo Log
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-purple-950/40 rounded-xl border border-purple-800/60 text-xs text-purple-200">
                <span className="font-bold">Geofence Protocol (Prototype Rule):</span> When a tracked collar crosses within 500m of a village perimeter in production, an operator triage alert is generated for Beat Guard verification.
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 text-xs">
              Select a telemetry collar or adjust the division filter to view movement waypoints.
            </div>
          )}
        </div>
      </div>

      {/* Camera Trap AI Live Trigger Feed */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xs p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <Camera className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="font-bold text-sm text-white">Camera Trap Detections (Demo Samples)</h3>
              <p className="text-xs text-slate-400">
                Illustrative camera-trap events demonstrating perimeter trail verification
              </p>
            </div>
          </div>
          <span className="text-xs font-mono font-semibold text-amber-300 bg-amber-950 px-2 py-0.5 rounded border border-amber-800/60">
            DEMO SAMPLES
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {cameraTrapEvents.map((evt) => (
            <div
              key={evt.id}
              className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden shadow-xs text-xs flex flex-col justify-between"
            >
              <div>
                <div className="relative h-36 bg-slate-800">
                  <img src={evt.imageUrl} alt={evt.species} className="w-full h-full object-cover" />
                  <div className="absolute top-2 right-2 bg-slate-950/90 text-emerald-300 border border-slate-700 text-[10px] font-mono px-2 py-0.5 rounded font-bold">
                    Demo Match: {evt.confidence}%
                  </div>
                </div>

                <div className="p-3 space-y-1">
                  <div className="font-bold text-white text-sm">{evt.species}</div>
                  <div className="text-slate-400 text-[11px]">{evt.cameraName}</div>
                  <div className="text-slate-400 text-[10px] font-mono">{evt.timestamp}</div>
                </div>
              </div>

              <div className="p-3 pt-0">
                <div className="text-[11px] text-emerald-300 bg-emerald-950/50 p-2 rounded border border-emerald-800/60 font-medium">
                  {evt.action}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
