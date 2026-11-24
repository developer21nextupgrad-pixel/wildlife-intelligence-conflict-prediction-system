import React from 'react';
import { 
  LayoutDashboard, 
  MapPin, 
  Sparkles, 
  Compass, 
  FileSpreadsheet, 
  Eye, 
  Bell, 
  ShieldCheck, 
  BarChart3, 
  Settings,
  TreePine,
  ChevronLeft,
  ChevronRight,
  Thermometer,
  ScanSearch
} from 'lucide-react';

export interface NavItem {
  id: string;
  name: string;
  icon: React.ElementType;
  badge?: number | string;
  badgeColor?: string;
  tooltipText?: string;
}

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  counts: {
    incidents: number;
    sightings: number;
    alerts: number;
    collars: number;
    villages: number;
    patrols: number;
  };
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  connectionStatus?: 'connected' | 'offline' | 'syncing';
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  counts,
  isCollapsed = false,
  onToggleCollapse,
  connectionStatus = 'connected',
}) => {
  const navItems: NavItem[] = [
    {
      id: 'command-centre',
      name: 'Command Centre',
      icon: LayoutDashboard,
      tooltipText: 'Command Centre (Main Dashboard)',
    },
    {
      id: 'wildlife-risk-map',
      name: 'Wildlife Risk Map',
      icon: MapPin,
      badge: `${counts.villages} Hotspots`,
      badgeColor: 'bg-emerald-950 text-emerald-300 border border-emerald-800/60',
      tooltipText: 'Wildlife Risk Map (Full GIS View)',
    },
    {
      id: 'conflict-prediction',
      name: 'Conflict Prediction',
      icon: Sparkles,
      badge: 'DEMO',
      badgeColor: 'bg-purple-950 text-purple-300 border border-purple-800/60 font-mono',
      tooltipText: 'Conflict Prediction (AI Matrix)',
    },
    {
      id: 'animal-movement',
      name: 'Animal Movement',
      icon: Compass,
      badge: `${counts.collars} Active`,
      badgeColor: 'bg-sky-950 text-sky-300 border border-sky-800/60',
      tooltipText: 'Animal Movement (GPS & Corridors)',
    },
    {
      id: 'incident-management',
      name: 'Incident Management',
      icon: FileSpreadsheet,
      badge: counts.incidents,
      badgeColor: 'bg-amber-950 text-amber-300 border border-amber-800/60',
      tooltipText: 'Incident Management (Official Docket)',
    },
    {
      id: 'animal-sightings',
      name: 'Animal Sightings',
      icon: Eye,
      badge: counts.sightings,
      badgeColor: 'bg-emerald-950 text-emerald-300 border border-emerald-800/60',
      tooltipText: 'Animal Sightings (Field Observation)',
    },
    {
      id: 'alert-management',
      name: 'Alert Management',
      icon: Bell,
      badge: counts.alerts > 0 ? counts.alerts : undefined,
      badgeColor: 'bg-red-600 text-white font-bold',
      tooltipText: 'Alert Management (Urgent Triage)',
    },
    {
      id: 'patrol-operations',
      name: 'Patrol Operations',
      icon: ShieldCheck,
      badge: `${counts.patrols} Teams`,
      badgeColor: 'bg-emerald-900/80 text-emerald-200 border border-emerald-700/60',
      tooltipText: 'Patrol Operations (RRT Deployment)',
    },
    {
      id: 'analytics-reports',
      name: 'Analytics & Reports',
      icon: BarChart3,
      tooltipText: 'Analytics & Intelligence Reports',
    },
    {
      id: 'animal-detection',
      name: 'Animal Detection',
      icon: ScanSearch,
      badge: 'Phase 1-3',
      badgeColor: 'bg-emerald-950 text-emerald-300 border border-emerald-800/60 font-mono',
      tooltipText: 'Animal Detection, Re-Identification & Intelligence Integration',
    },
    {
      id: 'thermal-ingestion',
      name: 'Thermal Ingestion',
      icon: Thermometer,
      badge: 'Stage 1',
      badgeColor: 'bg-amber-950 text-amber-300 border border-amber-800/60 font-mono',
      tooltipText: 'Thermal Camera Ingestion & Frame QC (Stage 1)',
    },
    {
      id: 'administration',
      name: 'Administration',
      icon: Settings,
      tooltipText: 'Administration & System Bridge',
    },
  ];

  // Helper mapping for legacy tab IDs
  const normalizeTab = (tab: string) => {
    if (tab === 'dashboard') return 'command-centre';
    if (tab === 'gis-map') return 'wildlife-risk-map';
    if (tab === 'ai-prediction') return 'conflict-prediction';
    if (tab === 'movement') return 'animal-movement';
    if (tab === 'incidents') return 'incident-management';
    if (tab === 'sightings') return 'animal-sightings';
    if (tab === 'alerts') return 'alert-management';
    if (tab === 'patrols') return 'patrol-operations';
    if (tab === 'analytics') return 'analytics-reports';
    if (tab === 'detection' || tab === 'detections' || tab === 'species-id') {
      return 'animal-detection';
    }
    if (tab === 'thermal' || tab === 'ingestion') return 'thermal-ingestion';
    if (tab === 'settings' || tab === 'users') return 'administration';
    return tab;
  };

  const currentTab = normalizeTab(activeTab);

  return (
    <aside 
      className={`${
        isCollapsed ? 'w-20' : 'w-[268px]'
      } bg-slate-950 border-r border-slate-800/80 flex flex-col h-full shrink-0 select-none transition-all duration-300 relative z-30`}
    >
      {/* Top Forest Division Header */}
      <div className={`p-4 border-b border-slate-800/80 bg-slate-900/40 flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0 shadow-inner">
            <TreePine className="w-5 h-5 text-emerald-400" />
          </div>
          {!isCollapsed && (
            <div className="min-w-0">
              <div className="text-xs font-extrabold text-white tracking-wide truncate">
                Bandipur Reserve
              </div>
              <div className="text-[11px] text-emerald-400 font-mono flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span>Division Sector 4</span>
              </div>
            </div>
          )}
        </div>

        {/* Collapse / Expand Toggle Button */}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className={`p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition ${isCollapsed ? 'mt-2' : ''}`}
            title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            aria-label={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Navigation Section */}
      <nav className="flex-1 px-2.5 py-4 space-y-1 overflow-y-auto">
        {!isCollapsed && (
          <div className="px-3 pb-2 text-[10px] uppercase font-bold tracking-wider text-slate-500 font-mono">
            Navigation & Ops
          </div>
        )}

        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              title={isCollapsed ? item.tooltipText || item.name : undefined}
              className={`w-full flex items-center ${
                isCollapsed ? 'justify-center py-3' : 'justify-between px-2.5 py-2.5 gap-1.5'
              } rounded-xl text-[13px] font-medium transition group relative ${
                isActive
                  ? 'bg-emerald-600/90 text-white shadow-sm font-semibold border border-emerald-500/40'
                  : 'text-slate-300 hover:bg-slate-900 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 transition ${
                    isActive ? 'text-white' : 'text-slate-400 group-hover:text-emerald-400'
                  }`}
                />
                {!isCollapsed && <span className="truncate">{item.name}</span>}
              </div>

              {!isCollapsed && item.badge !== undefined && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-md uppercase tracking-wider shrink-0 font-medium ${
                    item.badgeColor || 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {item.badge}
                </span>
              )}

              {/* Collapsed Badge Dot Indicator */}
              {isCollapsed && item.badge !== undefined && (
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400"></span>
              )}
            </button>
          );
        })}
      </nav>

      {/* System Status Footer */}
      {!isCollapsed ? (
        <div className="p-3.5 border-t border-slate-800/80 bg-slate-900/30 text-[11px] text-slate-400 font-mono space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">FastAPI/PostGIS:</span>
            <span
              className={`font-semibold flex items-center gap-1 ${
                connectionStatus === 'syncing'
                  ? 'text-amber-400'
                  : connectionStatus === 'offline'
                  ? 'text-red-400'
                  : 'text-emerald-400'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  connectionStatus === 'syncing'
                    ? 'bg-amber-400 animate-pulse'
                    : connectionStatus === 'offline'
                    ? 'bg-red-400'
                    : 'bg-emerald-400'
                }`}
              ></span>{' '}
              {connectionStatus === 'syncing'
                ? 'Syncing'
                : connectionStatus === 'offline'
                ? 'Offline'
                : 'Connected'}
            </span>
          </div>
          <div className="text-[10px] text-slate-400 truncate">
            CRS: EPSG:4326 (WGS 84)
          </div>
        </div>
      ) : (
        <div className="p-3 border-t border-slate-800/80 flex justify-center">
          <span
            className={`w-2 h-2 rounded-full ${
              connectionStatus === 'syncing'
                ? 'bg-amber-400 animate-pulse'
                : connectionStatus === 'offline'
                ? 'bg-red-400'
                : 'bg-emerald-400'
            }`}
            title={`FastAPI/PostGIS: ${
              connectionStatus === 'syncing'
                ? 'Syncing'
                : connectionStatus === 'offline'
                ? 'Offline'
                : 'Connected'
            }`}
          ></span>
        </div>
      )}
    </aside>
  );
};
