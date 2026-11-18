import React, { useState } from 'react';
import { UserStaff } from '../types';
import { Phone, Mail, Search, Users } from 'lucide-react';

interface UserManagementViewProps {
  staff: UserStaff[];
}

export const UserManagementView: React.FC<UserManagementViewProps> = ({ staff }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');

  const filtered = staff.filter((user) => {
    if (filterRole !== 'All' && user.role !== filterRole) return false;
    if (filterStatus !== 'All' && user.status !== filterStatus) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      const match =
        `${user.name} ${user.badgeNumber} ${user.assignedBeat} ${user.role}`.toLowerCase();
      if (!match.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Filter and Search Bar */}
      <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl shadow-xl flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search officer name, badge number, assigned beat, role..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-hidden placeholder-slate-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-300 font-medium focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
          >
            <option value="All">All Department Roles</option>
            <option value="Divisional Forest Officer (DFO)">Divisional Forest Officer (DFO)</option>
            <option value="Range Forest Officer (RFO)">Range Forest Officer (RFO)</option>
            <option value="RRT Lead">RRT Lead</option>
            <option value="Wildlife Biologist">Wildlife Biologist</option>
            <option value="Beat Guard">Beat Guard</option>
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-300 font-medium focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
          >
            <option value="All">All Duty Statuses</option>
            <option value="On Duty">On Duty</option>
            <option value="Patrol Active">Patrol Active</option>
            <option value="Standby">Standby</option>
            <option value="On Leave">On Leave</option>
          </select>
        </div>
      </div>

      {/* Personnel Grid */}
      {filtered.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center text-xs text-slate-400">
          <Users className="w-8 h-8 text-slate-500 mx-auto mb-2" />
          <div className="font-bold text-white">No matching personnel found</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((user) => (
            <div
              key={user.id}
              className="bg-slate-900/80 rounded-2xl border border-slate-800/90 shadow-lg p-5 flex flex-col justify-between hover:border-emerald-500/50 hover:bg-slate-900 transition group"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-700 to-emerald-900 border border-emerald-500/40 text-emerald-200 font-bold font-mono text-sm flex items-center justify-center shrink-0 shadow-inner">
                      {user.avatarInitials}
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-sm group-hover:text-emerald-400 transition">
                        {user.name}
                      </h3>
                      <div className="text-emerald-400 text-xs font-medium">{user.role}</div>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md font-mono ${
                      user.status === 'Patrol Active'
                        ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
                        : user.status === 'On Duty'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {user.status}
                  </span>
                </div>

                <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800/80 text-xs space-y-1.5 font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 uppercase text-[10px]">Official Badge</span>
                    <span className="font-bold text-slate-300">{user.badgeNumber}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 uppercase text-[10px]">Assigned Beat</span>
                    <span className="font-semibold text-emerald-300 truncate max-w-[160px]">
                      {user.assignedBeat}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800/80 mt-4 text-xs text-slate-400 space-y-1.5">
                <div className="flex items-center space-x-2">
                  <Phone className="w-3.5 h-3.5 text-slate-500" />
                  <span className="font-mono text-slate-300">{user.contactNumber}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Mail className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-slate-400 truncate text-[11px]">{user.email}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
