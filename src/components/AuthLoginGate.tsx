import React, { useEffect, useState } from 'react';
import {
  KeyRound,
  Lock,
  Mail,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  AlertTriangle,
} from 'lucide-react';
import { apiBridge } from '../services/apiBridge';
import { AuthenticatedUserProfile, AuthStatusSummary } from '../utils/authStorage';

interface AuthLoginGateProps {
  onAuthenticated: (user: AuthenticatedUserProfile) => void;
}

export const AuthLoginGate: React.FC<AuthLoginGateProps> = ({ onAuthenticated }) => {
  const [authStatus, setAuthStatus] = useState<AuthStatusSummary | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [mode, setMode] = useState<'login' | 'setup' | 'oidc'>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupDisplayName, setSetupDisplayName] = useState('Division Administrator');
  const [setupPassword, setSetupPassword] = useState('');
  const [oidcToken, setOidcToken] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadStatus = async () => {
    setIsLoadingStatus(true);
    setStatusError(null);
    try {
      const status = await apiBridge.getAuthStatus();
      setAuthStatus(status);
      if (status.needsInitialSetup) {
        setMode('setup');
      } else if (!status.passwordLoginEnabled && status.oidcEnabled) {
        setMode('oidc');
      } else {
        setMode('login');
      }
    } catch (err) {
      setStatusError(
        err instanceof Error
          ? err.message
          : 'Unable to reach authentication service on FastAPI backend.'
      );
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!identifier.trim() || !password) {
      setFormError('Enter your registered email/username and password.');
      return;
    }
    setIsSubmitting(true);
    try {
      const profile = await apiBridge.login(identifier.trim(), password);
      onAuthenticated(profile);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBootstrapAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!setupEmail.trim() || !setupDisplayName.trim() || setupPassword.length < 8) {
      setFormError('Valid email, name, and password (minimum 8 characters) are required.');
      return;
    }
    setIsSubmitting(true);
    try {
      const profile = await apiBridge.bootstrapInitialAdmin({
        email: setupEmail.trim(),
        displayName: setupDisplayName.trim(),
        password: setupPassword,
      });
      onAuthenticated(profile);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Initial setup failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOidcTokenLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!oidcToken.trim()) {
      setFormError('Paste a valid OIDC / JWT Bearer token issued by your identity provider.');
      return;
    }
    setIsSubmitting(true);
    try {
      const profile = await apiBridge.authenticateWithToken(oidcToken.trim());
      onAuthenticated(profile);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Token verification failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-6 bg-slate-950 border-b border-slate-800 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-800 border border-emerald-400/40 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 font-bold">
              WICPS Security Perimeter
            </div>
            <h1 className="text-lg font-extrabold text-white tracking-tight">
              Wildlife Intelligence Platform Sign In
            </h1>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {isLoadingStatus ? (
            <div className="py-8 flex flex-col items-center justify-center text-xs text-slate-400 gap-3">
              <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
              <span>Verifying backend authentication policy...</span>
            </div>
          ) : statusError ? (
            <div className="bg-red-950/70 border border-red-800/70 rounded-xl p-4 space-y-3 text-xs">
              <div className="flex items-start gap-2 text-red-200">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Authentication Endpoint Unreachable</div>
                  <div className="text-red-300/90 mt-1">{statusError}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={loadStatus}
                className="w-full py-2 rounded-lg bg-red-800 hover:bg-red-700 text-white font-semibold transition flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Backend Connection</span>
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                {authStatus?.passwordLoginEnabled && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setFormError(null);
                    }}
                    className={`flex-1 py-1.5 px-2.5 rounded-lg font-semibold transition ${
                      mode === 'login'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Password Sign In
                  </button>
                )}
                {authStatus?.needsInitialSetup && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('setup');
                      setFormError(null);
                    }}
                    className={`flex-1 py-1.5 px-2.5 rounded-lg font-semibold transition ${
                      mode === 'setup'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Initial Admin Setup
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMode('oidc');
                    setFormError(null);
                  }}
                  className={`flex-1 py-1.5 px-2.5 rounded-lg font-semibold transition ${
                    mode === 'oidc'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {authStatus?.oidcEnabled ? 'OIDC / Bearer Token' : 'Bearer Token'}
                </button>
              </div>

              {formError && (
                <div
                  role="alert"
                  className="bg-red-950/70 border border-red-800/70 rounded-xl px-3.5 py-2.5 text-xs text-red-200 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {mode === 'setup' && authStatus?.needsInitialSetup && (
                <form onSubmit={handleBootstrapAdmin} className="space-y-3.5 text-xs">
                  <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl p-3 text-emerald-200 leading-relaxed">
                    <div className="font-bold flex items-center gap-1.5">
                      <UserPlus className="w-4 h-4 text-emerald-400" />
                      First-Time Environment Setup
                    </div>
                    <p className="mt-1 text-emerald-300/90">
                      Create the initial administrator account for this environment. Once created,
                      bootstrap setup is permanently locked.
                    </p>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Administrator Email
                    </label>
                    <input
                      type="email"
                      required
                      value={setupEmail}
                      onChange={(e) => setSetupEmail(e.target.value)}
                      placeholder="admin@forestdivision.gov"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-hidden focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Full Name / Designation
                    </label>
                    <input
                      type="text"
                      required
                      value={setupDisplayName}
                      onChange={(e) => setSetupDisplayName(e.target.value)}
                      placeholder="Division Forest Officer"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-hidden focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Password (min. 8 characters)
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={setupPassword}
                      onChange={(e) => setSetupPassword(e.target.value)}
                      placeholder="Enter strong administrator password"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-hidden focus:border-emerald-500"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold transition flex items-center justify-center gap-2"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>{isSubmitting ? 'Creating Admin...' : 'Create Initial Admin & Sign In'}</span>
                  </button>
                </form>
              )}

              {mode === 'login' && (
                <form onSubmit={handleLogin} className="space-y-3.5 text-xs">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Email or Username
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        autoComplete="username"
                        required
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder="officer@forestdivision.gov"
                        className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-hidden focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Password</label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                      <input
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-hidden focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold transition flex items-center justify-center gap-2"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>{isSubmitting ? 'Signing In...' : 'Authenticate & Enter Command'}</span>
                  </button>
                </form>
              )}

              {mode === 'oidc' && (
                <form onSubmit={handleOidcTokenLogin} className="space-y-3.5 text-xs">
                  {authStatus?.oidcIssuer && (
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-300">
                      <div className="font-semibold text-emerald-400">Configured OIDC Issuer</div>
                      <div className="font-mono text-[11px] mt-0.5 break-all">
                        {authStatus.oidcIssuer}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Signed JWT / OIDC Access Token
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                      <textarea
                        rows={4}
                        required
                        value={oidcToken}
                        onChange={(e) => setOidcToken(e.target.value)}
                        placeholder="eyJhbGciOi..."
                        className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono text-[11px] focus:outline-hidden focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold transition flex items-center justify-center gap-2"
                  >
                    <KeyRound className="w-4 h-4" />
                    <span>{isSubmitting ? 'Verifying Token...' : 'Verify Bearer Token'}</span>
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
