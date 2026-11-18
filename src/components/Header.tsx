import React, { useEffect, useRef, useState } from 'react';
import {
  ShieldAlert,
  Search,
  Bell,
  PlusCircle,
  Flame,
  ChevronRight,
  Check,
  X,
  MapPin,
} from 'lucide-react';
import { AlertNotification } from '../types';
import { DATE_RANGE_OPTIONS, DIVISION_OPTIONS } from '../utils/wicpsFilters';

interface HeaderProps {
  setActiveTab: (tab: string) => void;
  onNavigateAdmin: (subTab: 'personnel' | 'bridge') => void;
  unacknowledgedAlerts: AlertNotification[];
  onOpenNewIncident: () => void;
  selectedDistrict: string;
  setSelectedDistrict: (district: string) => void;
  dateRange: string;
  setDateRange: (range: string) => void;
  globalSearchQuery: string;
  onGlobalSearchChange: (query: string) => void;
  onGlobalSearchSubmit: (query: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  setActiveTab,
  onNavigateAdmin,
  unacknowledgedAlerts,
  onOpenNewIncident,
  selectedDistrict,
  setSelectedDistrict,
  dateRange,
  setDateRange,
  globalSearchQuery,
  onGlobalSearchChange,
  onGlobalSearchSubmit,
}) => {
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [headerSearchQuery, setHeaderSearchQuery] = useState(globalSearchQuery);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setHeaderSearchQuery(globalSearchQuery);
  }, [globalSearchQuery]);

  // Global Ctrl+K / Cmd+K shortcut to focus Header search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const criticalAlerts = unacknowledgedAlerts.filter((a) => a.severity === 'Critical');

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onGlobalSearchSubmit(headerSearchQuery.trim());
  };

  const handleSearchInputChange = (val: string) => {
    setHeaderSearchQuery(val);
    onGlobalSearchChange(val);
  };

  return (
    <header className="bg-slate-950 border-b border-slate-800/80 text-white sticky top-0 z-40 select-none shadow-md">
      {/* Top Urgent Alert Strip (Only visible when unacknowledged critical alert exists) */}
      {criticalAlerts.length > 0 && (
        <div className="bg-gradient-to-r from-red-700 via-red-600 to-red-800 text-white px-4 py-1.5 text-xs font-semibold flex items-center justify-between">
          <div className="flex items-center space-x-2 truncate">
            <span className="bg-white text-red-700 uppercase px-1.5 py-0.5 rounded text-[10px] tracking-wider font-extrabold flex items-center gap-1">
              <Flame className="w-3 h-3 text-red-600" /> ACTIVE ALERT (DEMO)
            </span>
            <span className="truncate">
              {criticalAlerts[0].title}: {criticalAlerts[0].affectedVillage} ({criticalAlerts[0].species})
            </span>
          </div>
          <button
            onClick={() => setActiveTab('alert-management')}
            className="flex items-center gap-1 bg-red-900/90 hover:bg-black text-white px-2.5 py-0.5 rounded text-[11px] font-bold transition whitespace-nowrap ml-2 border border-red-500/30"
          >
            Triage Alert <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Main Top Navigation Bar */}
      <div className="px-4 py-2.5 flex items-center justify-between gap-3">
        {/* Left: Department Identity & WICPS Brand Lockup */}
        <div className="flex items-center space-x-2.5 min-w-0 shrink">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-800 flex items-center justify-center shadow-inner border border-emerald-400/40 text-white shrink-0">
            <ShieldAlert className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold font-mono truncate">
                Forest Dept • Uttar Pradesh • India
              </span>
              <span className="hidden xl:inline-block bg-slate-900 text-slate-300 border border-slate-700/80 text-[9px] px-1.5 py-0.2 rounded font-mono shrink-0">
                GIS COMMAND • PROTOTYPE
              </span>
            </div>
            <h1 className="text-sm xl:text-base font-extrabold tracking-tight text-white flex items-center gap-1.5 truncate">
              <span className="truncate">Wildlife Intelligence & Conflict Prediction System</span>
              <span className="text-xs font-normal text-emerald-400 font-mono hidden md:inline shrink-0">
                (WICPS)
              </span>
            </h1>
          </div>
        </div>

        {/* Center: Global Search Bar and Contextual Filters */}
        <div className="hidden lg:flex items-center gap-2 flex-1 max-w-lg xl:max-w-xl min-w-0">
          <form onSubmit={handleSearchSubmit} className="relative flex-1 min-w-[160px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              ref={searchInputRef}
              type="text"
              aria-label="Global incident search"
              placeholder="Search incidents, villages... (Ctrl+K)"
              value={headerSearchQuery}
              onChange={(e) => handleSearchInputChange(e.target.value)}
              className="w-full pl-8 pr-14 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-emerald-500"
            />
            {headerSearchQuery ? (
              <button
                type="button"
                onClick={() => handleSearchInputChange('')}
                aria-label="Clear global search"
                className="absolute right-9 top-1.5 p-0.5 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : null}
            <span className="absolute right-1.5 top-1.5 text-[10px] font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 pointer-events-none">
              ⌘K
            </span>
          </form>

          {/* Quick Division Selector */}
          <select
            aria-label="Global Division Filter"
            value={selectedDistrict}
            onChange={(e) => setSelectedDistrict(e.target.value)}
            className="max-w-[175px] truncate bg-slate-900 border border-slate-800 text-slate-300 text-xs rounded-lg px-2 py-1.5 focus:outline-hidden focus:border-emerald-500"
          >
            {DIVISION_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id} className="bg-slate-900">
                {opt.label}
              </option>
            ))}
          </select>

          {/* Quick Date Range Selector */}
          <select
            aria-label="Global Date Range Filter"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="max-w-[140px] truncate bg-slate-900 border border-slate-800 text-slate-300 text-xs rounded-lg px-2 py-1.5 focus:outline-hidden focus:border-emerald-500 font-mono"
          >
            {DATE_RANGE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id} className="bg-slate-900">
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Right: Quick Report CTA, Notifications Popover, User Profile */}
        <div className="flex items-center space-x-2 shrink-0">
          {/* Quick Record Incident CTA */}
          <button
            onClick={onOpenNewIncident}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition active:scale-95 border border-emerald-400/30"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Log Incident</span>
            <span className="sm:hidden">Log</span>
          </button>

          {/* Notification Centre Bell with Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
              className="relative p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition"
              title="Notifications & Alerts"
              aria-label="View notifications"
            >
              <Bell className="w-4 h-4" />
              {unacknowledgedAlerts.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {unacknowledgedAlerts.length}
                </span>
              )}
            </button>

            {isNotificationsOpen && (
              <div className="absolute right-0 top-11 w-80 sm:w-96 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in">
                <div className="p-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white uppercase font-mono">
                      Alert Notification Feed
                    </span>
                    <span className="text-[10px] bg-red-950 text-red-400 px-1.5 py-0.2 rounded border border-red-800/60 font-mono">
                      {unacknowledgedAlerts.length} Unread
                    </span>
                  </div>
                  <button
                    onClick={() => setIsNotificationsOpen(false)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/80 text-xs">
                  {unacknowledgedAlerts.length === 0 ? (
                    <div className="p-6 text-center text-slate-400">
                      <Check className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
                      <div>All perimeter alerts clear in active filter</div>
                    </div>
                  ) : (
                    unacknowledgedAlerts.map((alert) => (
                      <div
                        key={alert.id}
                        onClick={() => {
                          setActiveTab('alert-management');
                          setIsNotificationsOpen(false);
                        }}
                        className="p-3 hover:bg-slate-800/60 transition cursor-pointer space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                              alert.severity === 'Critical'
                                ? 'bg-red-900/80 text-red-300'
                                : 'bg-amber-900/80 text-amber-300'
                            }`}
                          >
                            {alert.severity}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">{alert.alertTime}</span>
                        </div>
                        <div className="font-semibold text-slate-200 line-clamp-1">{alert.title}</div>
                        <div className="text-slate-400 text-[11px] flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-slate-500" />
                          <span>{alert.affectedVillage}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="p-2.5 bg-slate-950 border-t border-slate-800 text-center">
                  <button
                    onClick={() => {
                      setActiveTab('alert-management');
                      setIsNotificationsOpen(false);
                    }}
                    className="text-emerald-400 hover:text-emerald-300 text-xs font-semibold"
                  >
                    View All Active Alert Dockets →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* User Profile Pill & Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="flex items-center space-x-2 pl-2 border-l border-slate-800 text-xs hover:opacity-90 transition"
            >
              <div className="w-7 h-7 rounded-full bg-emerald-800/80 border border-emerald-400/50 flex items-center justify-center text-emerald-200 font-bold font-mono text-xs shadow-inner">
                DO
              </div>
              <div className="hidden md:block text-left leading-tight">
                <div className="font-semibold text-slate-200">Demo Duty Officer</div>
                <div className="text-[10px] text-emerald-400">DFO Session (Demo)</div>
              </div>
            </button>

            {isProfileOpen && (
              <div className="absolute right-0 top-11 w-64 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 overflow-hidden text-xs text-slate-300 animate-in fade-in">
                <div className="p-3.5 bg-slate-950 border-b border-slate-800">
                  <div className="font-bold text-white">Demo Duty Officer</div>
                  <div className="text-emerald-400 text-[11px]">Divisional Forest Officer (Demo Role)</div>
                  <div className="text-slate-400 text-[10px] font-mono mt-0.5">Session: Local Prototype</div>
                </div>

                <div className="p-2 space-y-1">
                  <button
                    onClick={() => {
                      onNavigateAdmin('personnel');
                      setIsProfileOpen(false);
                    }}
                    className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-800 transition"
                  >
                    Officer Directory & Staff
                  </button>
                  <button
                    onClick={() => {
                      onNavigateAdmin('bridge');
                      setIsProfileOpen(false);
                    }}
                    className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-800 transition"
                  >
                    System Architecture & API Bridge
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
