import React, { useCallback, useEffect, useState } from 'react';
import { UserStaff } from '../types';
import { apiBridge } from '../services/apiBridge';
import {
  AuthenticatedUserProfile,
  canManageAdmin,
  UserAccountRecord,
  WicpsRole,
} from '../utils/authStorage';
import {
  Phone,
  Mail,
  Search,
  Users,
  ShieldCheck,
  UserPlus,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

interface UserManagementViewProps {
  currentUser?: AuthenticatedUserProfile | null;
  staff: UserStaff[];
}

export const UserManagementView: React.FC<UserManagementViewProps> = ({
  currentUser = null,
  staff,
}) => {
  const isAdmin = canManageAdmin(currentUser);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');

  // Platform RBAC Accounts state (Admin only)
  const [accounts, setAccounts] = useState<UserAccountRecord[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<WicpsRole>('operator');
  const [newPassword, setNewPassword] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const loadAccounts = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingAccounts(true);
    setAccountError(null);
    try {
      const list = await apiBridge.listUsers();
      setAccounts(list);
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Unable to load platform RBAC accounts.');
    } finally {
      setLoadingAccounts(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccountError(null);
    setAccountNotice(null);
    if (!newEmail.trim() || !newDisplayName.trim() || newPassword.length < 8) {
      setAccountError('Valid email, display name, and password (min. 8 characters) are required.');
      return;
    }
    setIsCreating(true);
    try {
      const created = await apiBridge.createUser({
        email: newEmail.trim(),
        username: newUsername.trim() || undefined,
        displayName: newDisplayName.trim(),
        role: newRole,
        password: newPassword,
      });
      setNewEmail('');
      setNewUsername('');
      setNewDisplayName('');
      setNewPassword('');
      setAccountNotice(`Created ${created.role} account for ${created.displayName} (${created.email}).`);
      await loadAccounts();
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Failed to create RBAC account.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRoleChange = async (userId: string, role: WicpsRole) => {
    setAccountError(null);
    setAccountNotice(null);
    try {
      const updated = await apiBridge.updateUser(userId, { role });
      setAccounts((prev) => prev.map((a) => (a.id === userId ? updated : a)));
      setAccountNotice(`Updated ${updated.displayName} role to ${updated.role}.`);
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Failed to update user role.');
    }
  };

  const handleToggleActive = async (acc: UserAccountRecord) => {
    setAccountError(null);
    setAccountNotice(null);
    try {
      const updated = await apiBridge.updateUser(acc.id, { isActive: !acc.isActive });
      setAccounts((prev) => prev.map((a) => (a.id === acc.id ? updated : a)));
      setAccountNotice(
        `${updated.displayName} is now ${updated.isActive ? 'active' : 'deactivated'}.`
      );
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Failed to update account status.');
    }
  };

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
      {/* Platform RBAC User Accounts Section */}
      {isAdmin ? (
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <div>
                <h2 className="text-sm font-bold text-white">
                  Platform RBAC User Accounts ({accounts.length})
                </h2>
                <p className="text-xs text-slate-400">
                  Manage authenticated JWT/OIDC platform roles (operator, reviewer, admin).
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={loadAccounts}
              disabled={loadingAccounts}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 rounded-xl text-xs font-semibold text-slate-200 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingAccounts ? 'animate-spin' : ''}`} />
              <span>Refresh Accounts</span>
            </button>
          </div>

          {accountError && (
            <div
              role="alert"
              className="bg-red-950/60 border border-red-800 rounded-xl p-3 text-xs text-red-200 flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{accountError}</span>
            </div>
          )}
          {accountNotice && (
            <div
              role="status"
              className="bg-emerald-950/60 border border-emerald-800 rounded-xl p-3 text-xs text-emerald-200 flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{accountNotice}</span>
            </div>
          )}

          <form
            onSubmit={handleCreateAccount}
            className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3 text-xs"
          >
            <div className="font-bold text-white flex items-center gap-1.5">
              <UserPlus className="w-4 h-4 text-emerald-400" />
              <span>Provision Platform Account</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label htmlFor="rbac-email" className="block text-[11px] font-mono text-slate-400 mb-1">
                  Email
                </label>
                <input
                  id="rbac-email"
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="reviewer@forestdivision.gov"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="rbac-username" className="block text-[11px] font-mono text-slate-400 mb-1">
                  Username (Optional)
                </label>
                <input
                  id="rbac-username"
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="bio-reviewer"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="rbac-display" className="block text-[11px] font-mono text-slate-400 mb-1">
                  Display Name
                </label>
                <input
                  id="rbac-display"
                  type="text"
                  required
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="Dr. Ananya Rao"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="rbac-role" className="block text-[11px] font-mono text-slate-400 mb-1">
                  RBAC Role
                </label>
                <select
                  id="rbac-role"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as WicpsRole)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
                >
                  <option value="operator">operator</option>
                  <option value="reviewer">reviewer</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div>
                <label htmlFor="rbac-password" className="block text-[11px] font-mono text-slate-400 mb-1">
                  Initial Password
                </label>
                <input
                  id="rbac-password"
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 8 chars"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isCreating}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-bold transition"
              >
                {isCreating ? 'Creating...' : 'Create RBAC Account'}
              </button>
            </div>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs" data-testid="rbac-accounts-table">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-mono uppercase text-slate-400 bg-slate-950/60">
                  <th className="py-2 px-3">User</th>
                  <th className="py-2 px-3">Username</th>
                  <th className="py-2 px-3">Role</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {accounts.map((acc) => {
                  const isSelf = currentUser?.id === acc.id;
                  return (
                    <tr key={acc.id} className="hover:bg-slate-800/40">
                      <td className="py-2 px-3">
                        <div className="font-bold text-white">{acc.displayName}</div>
                        <div className="text-[11px] font-mono text-slate-400">{acc.email}</div>
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-300">{acc.username}</td>
                      <td className="py-2 px-3">
                        <select
                          aria-label={`Role for ${acc.email}`}
                          value={acc.role}
                          disabled={isSelf}
                          onChange={(e) => handleRoleChange(acc.id, e.target.value as WicpsRole)}
                          className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 disabled:opacity-50"
                        >
                          <option value="operator">operator</option>
                          <option value="reviewer">reviewer</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[10px] border ${
                            acc.isActive
                              ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                              : 'bg-red-950 border-red-800 text-red-300'
                          }`}
                        >
                          {acc.isActive ? 'active' : 'inactive'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          disabled={isSelf}
                          onClick={() => handleToggleActive(acc)}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded-lg text-[11px] font-semibold"
                        >
                          {acc.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 text-xs text-slate-300 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            Signed in as <strong className="text-white">{currentUser?.displayName}</strong> (
            <span className="font-mono uppercase text-emerald-300">{currentUser?.role}</span>). Admin role is required to provision or modify platform RBAC accounts.
          </span>
        </div>
      )}

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
