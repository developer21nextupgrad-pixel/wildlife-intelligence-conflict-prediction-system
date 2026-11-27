import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Mail,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  User,
  UserPlus,
} from 'lucide-react';
import { apiBridge } from '../services/apiBridge';
import { AuthenticatedUserProfile, AuthStatusSummary } from '../utils/authStorage';
import {
  isValidEmailAddress,
  validateRegistrationForm,
  validateResetPasswordForm,
} from '../utils/authValidation';
import { PasswordInput } from './PasswordInput';

type AuthGateMode = 'login' | 'register' | 'forgot' | 'reset' | 'setup' | 'oidc';

interface AuthLoginGateProps {
  onAuthenticated: (user: AuthenticatedUserProfile) => void;
  initialAuthStatus?: AuthStatusSummary | null;
  initialResetRoute?: boolean;
  initialResetToken?: string | null;
  onExitResetFlow?: () => void;
}

export const AuthLoginGate: React.FC<AuthLoginGateProps> = ({
  onAuthenticated,
  initialAuthStatus = null,
  initialResetRoute = false,
  initialResetToken = null,
  onExitResetFlow,
}) => {
  const [authStatus, setAuthStatus] = useState<AuthStatusSummary | null>(initialAuthStatus);
  const [isLoadingStatus, setIsLoadingStatus] = useState(!initialAuthStatus && !initialResetRoute);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [mode, setMode] = useState<AuthGateMode>(() => {
    if (initialResetRoute) return 'reset';
    if (initialAuthStatus?.needsInitialSetup) return 'setup';
    if (initialAuthStatus && !initialAuthStatus.passwordLoginEnabled && initialAuthStatus.oidcEnabled) {
      return 'oidc';
    }
    return 'login';
  });

  // Login form state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  // Registration form state
  const [regFullName, setRegFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');

  // Forgot password form state
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotCooldownSec, setForgotCooldownSec] = useState(0);
  const forgotInFlightRef = useRef(false);

  // Reset password form state
  const [resetValidating, setResetValidating] = useState<boolean>(initialResetRoute);
  const [resetTokenValid, setResetTokenValid] = useState<boolean>(false);
  const [resetTokenError, setResetTokenError] = useState<string | null>(null);
  const [resetExpiresAt, setResetExpiresAt] = useState<string | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetCompleted, setResetCompleted] = useState(false);

  // Initial admin setup state
  const [setupEmail, setSetupEmail] = useState('');
  const [setupDisplayName, setSetupDisplayName] = useState('Division Administrator');
  const [setupPassword, setSetupPassword] = useState('');

  // OIDC / Bearer token state
  const [oidcToken, setOidcToken] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const clearFeedback = () => {
    setFormError(null);
    setFormSuccess(null);
  };

  const switchMode = (nextMode: AuthGateMode) => {
    if (mode === 'reset' && nextMode !== 'reset') {
      onExitResetFlow?.();
    }
    setForgotCooldownSec(0);
    clearFeedback();
    setMode(nextMode);
  };

  useEffect(() => {
    if (forgotCooldownSec <= 0) return;
    const timer = window.setInterval(() => {
      setForgotCooldownSec((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [forgotCooldownSec]);

  const applyStatus = (status: AuthStatusSummary) => {
    setAuthStatus(status);
    if (initialResetRoute) {
      setMode('reset');
      return;
    }
    if (status.authenticated && status.user) {
      onAuthenticated(status.user);
      return;
    }
    if (status.needsInitialSetup) {
      setMode('setup');
    } else if (!status.passwordLoginEnabled && status.oidcEnabled) {
      setMode('oidc');
    } else {
      setMode((prev) => (prev === 'register' || prev === 'forgot' ? prev : 'login'));
    }
  };

  const loadStatus = async () => {
    setIsLoadingStatus(true);
    setStatusError(null);
    try {
      const status = await apiBridge.getAuthStatus();
      applyStatus(status);
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
    if (initialAuthStatus) {
      applyStatus(initialAuthStatus);
      setIsLoadingStatus(false);
      return;
    }
    loadStatus();
  }, [initialAuthStatus, initialResetRoute]);

  useEffect(() => {
    if (!initialResetRoute) return;
    setMode('reset');
    setResetCompleted(false);
    clearFeedback();

    const cleanToken = (initialResetToken || '').trim();
    if (!cleanToken) {
      setResetValidating(false);
      setResetTokenValid(false);
      setResetTokenError(
        'No password reset token was provided in this link. Please request a new password reset email.'
      );
      return;
    }

    let active = true;
    setResetValidating(true);
    setResetTokenError(null);

    apiBridge
      .validatePasswordResetToken(cleanToken)
      .then((res) => {
        if (!active) return;
        setResetTokenValid(res.valid);
        setResetExpiresAt(res.expiresAt);
        if (!res.valid) {
          setResetTokenError(
            res.detail || 'This password reset link is invalid, expired, or has already been used.'
          );
        }
      })
      .catch((err) => {
        if (!active) return;
        setResetTokenValid(false);
        setResetTokenError(
          err instanceof Error
            ? err.message
            : 'Unable to verify password reset link right now.'
        );
      })
      .finally(() => {
        if (active) setResetValidating(false);
      });

    return () => {
      active = false;
    };
  }, [initialResetRoute, initialResetToken]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
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

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    const validationErr = validateRegistrationForm({
      fullName: regFullName,
      email: regEmail,
      password: regPassword,
      confirmPassword: regConfirmPassword,
    });
    if (validationErr) {
      setFormError(validationErr);
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await apiBridge.registerAccount({
        fullName: regFullName,
        email: regEmail,
        password: regPassword,
        confirmPassword: regConfirmPassword,
      });
      setIdentifier(created.email);
      setPassword('');
      setRegFullName('');
      setRegEmail('');
      setRegPassword('');
      setRegConfirmPassword('');
      setFormSuccess(created.message);
      setMode('login');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (forgotInFlightRef.current || isSubmitting || forgotCooldownSec > 0) {
      return;
    }
    clearFeedback();
    if (!isValidEmailAddress(forgotEmail)) {
      setFormError('Please enter a valid registered email address.');
      return;
    }

    forgotInFlightRef.current = true;
    setIsSubmitting(true);
    try {
      const res = await apiBridge.requestPasswordReset(forgotEmail);
      if (res.status === 'accepted') {
        setFormSuccess(res.message);
        setForgotCooldownSec(30);
      } else {
        setFormError('Password reset request could not be completed. Please try again.');
      }
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'Unable to send password reset email. Please check email service configuration or try again.'
      );
    } finally {
      forgotInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    const cleanToken = (initialResetToken || '').trim();
    if (!cleanToken) {
      setFormError('Missing reset token. Please request a new password reset link.');
      return;
    }

    const validationErr = validateResetPasswordForm({
      newPassword: resetNewPassword,
      confirmPassword: resetConfirmPassword,
    });
    if (validationErr) {
      setFormError(validationErr);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiBridge.resetPassword({
        token: cleanToken,
        newPassword: resetNewPassword,
        confirmPassword: resetConfirmPassword,
      });
      setResetNewPassword('');
      setResetConfirmPassword('');
      setResetCompleted(true);
      setFormSuccess(res.message);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to reset password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBootstrapAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
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
    clearFeedback();
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

  const headerTitle = (() => {
    switch (mode) {
      case 'register':
        return 'Create Operator Account';
      case 'forgot':
        return 'Account Password Recovery';
      case 'reset':
        return 'Set a New Password';
      case 'setup':
        return 'Initial Administrator Setup';
      default:
        return 'Wildlife Intelligence Platform Sign In';
    }
  })();

  const showTopModeTabs = mode === 'login' || mode === 'setup' || mode === 'oidc';

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
            <h1 className="text-lg font-extrabold text-white tracking-tight">{headerTitle}</h1>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {isLoadingStatus ? (
            <div className="py-8 flex flex-col items-center justify-center text-xs text-slate-400 gap-3">
              <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
              <span>Verifying backend authentication policy...</span>
            </div>
          ) : statusError && mode !== 'reset' ? (
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
              {showTopModeTabs && (
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                  {authStatus?.passwordLoginEnabled && (
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
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
                      onClick={() => switchMode('setup')}
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
                    onClick={() => switchMode('oidc')}
                    className={`flex-1 py-1.5 px-2.5 rounded-lg font-semibold transition ${
                      mode === 'oidc'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {authStatus?.oidcEnabled ? 'OIDC / Bearer Token' : 'Bearer Token'}
                  </button>
                </div>
              )}

              {formError && (
                <div
                  role="alert"
                  className="bg-red-950/70 border border-red-800/70 rounded-xl px-3.5 py-2.5 text-xs text-red-200 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {formSuccess && (
                <div
                  role="status"
                  className="bg-emerald-950/60 border border-emerald-700/70 rounded-xl px-3.5 py-2.5 text-xs text-emerald-200 flex items-start gap-2"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{formSuccess}</span>
                </div>
              )}

              {/* INITIAL ADMIN SETUP */}
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
                    <label
                      htmlFor="setup-admin-email"
                      className="block text-slate-300 font-semibold mb-1"
                    >
                      Administrator Email
                    </label>
                    <input
                      id="setup-admin-email"
                      type="email"
                      required
                      value={setupEmail}
                      onChange={(e) => setSetupEmail(e.target.value)}
                      placeholder="admin@forestdivision.gov"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-hidden focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="setup-admin-name"
                      className="block text-slate-300 font-semibold mb-1"
                    >
                      Full Name / Designation
                    </label>
                    <input
                      id="setup-admin-name"
                      type="text"
                      required
                      value={setupDisplayName}
                      onChange={(e) => setSetupDisplayName(e.target.value)}
                      placeholder="Division Forest Officer"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-hidden focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="setup-admin-password"
                      className="block text-slate-300 font-semibold mb-1"
                    >
                      Password (min. 8 characters)
                    </label>
                    <PasswordInput
                      id="setup-admin-password"
                      value={setupPassword}
                      onChange={setSetupPassword}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      placeholder="Enter strong administrator password"
                      toggleAriaLabelSubject="administrator password"
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

              {/* LOGIN */}
              {mode === 'login' && (
                <div className="space-y-4">
                  <form onSubmit={handleLogin} className="space-y-3.5 text-xs">
                    <div>
                      <label
                        htmlFor="login-identifier"
                        className="block text-slate-300 font-semibold mb-1"
                      >
                        Email or Username
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          id="login-identifier"
                          type="text"
                          autoComplete="username"
                          required
                          value={identifier}
                          onChange={(e) => setIdentifier(e.target.value)}
                          placeholder="officer@forestdivision.gov"
                          className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="login-password"
                        className="block text-slate-300 font-semibold mb-1"
                      >
                        Password
                      </label>
                      <PasswordInput
                        id="login-password"
                        value={password}
                        onChange={setPassword}
                        autoComplete="current-password"
                        required
                        placeholder="••••••••••••"
                        toggleAriaLabelSubject="login password"
                        testId="login-password-input"
                      />
                      <div className="mt-1.5 flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setForgotEmail(identifier.includes('@') ? identifier : '');
                            switchMode('forgot');
                          }}
                          className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 hover:underline focus:outline-hidden focus:underline transition"
                        >
                          Forgot Password?
                        </button>
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

                  {authStatus?.passwordLoginEnabled !== false && (
                    <div className="pt-4 border-t border-slate-800 space-y-2.5 text-center">
                      <p className="text-[11px] text-slate-400">
                        New field officer or wildlife analyst?
                      </p>
                      <button
                        type="button"
                        onClick={() => switchMode('register')}
                        data-testid="open-register-button"
                        className="w-full py-2.5 px-4 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 hover:border-emerald-500/60 text-emerald-300 hover:text-emerald-200 text-xs font-bold transition flex items-center justify-center gap-2"
                      >
                        <UserPlus className="w-4 h-4" />
                        <span>Create New Account</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* REGISTER NEW ACCOUNT */}
              {mode === 'register' && (
                <form onSubmit={handleRegister} className="space-y-3.5 text-xs" noValidate>
                  <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-slate-300 leading-relaxed">
                    Register for WICPS access. New accounts are provisioned with standard{' '}
                    <span className="font-mono text-emerald-400 font-semibold">Operator</span>{' '}
                    privileges; elevated roles are managed exclusively by a Division Administrator.
                  </div>

                  <div>
                    <label
                      htmlFor="register-full-name"
                      className="block text-slate-300 font-semibold mb-1"
                    >
                      Full Name
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="register-full-name"
                        type="text"
                        autoComplete="name"
                        required
                        minLength={2}
                        maxLength={160}
                        value={regFullName}
                        onChange={(e) => setRegFullName(e.target.value)}
                        placeholder="Dr. Meera Nair"
                        className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="register-email"
                      className="block text-slate-300 font-semibold mb-1"
                    >
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="register-email"
                        type="email"
                        autoComplete="email"
                        required
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="officer@forestdivision.gov"
                        className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="register-password"
                      className="block text-slate-300 font-semibold mb-1"
                    >
                      Password (min. 8 characters)
                    </label>
                    <PasswordInput
                      id="register-password"
                      value={regPassword}
                      onChange={setRegPassword}
                      autoComplete="new-password"
                      required
                      minLength={8}
                      placeholder="Create a strong password"
                      toggleAriaLabelSubject="registration password"
                      testId="register-password-input"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="register-confirm-password"
                      className="block text-slate-300 font-semibold mb-1"
                    >
                      Confirm Password
                    </label>
                    <PasswordInput
                      id="register-confirm-password"
                      value={regConfirmPassword}
                      onChange={setRegConfirmPassword}
                      autoComplete="new-password"
                      required
                      minLength={8}
                      placeholder="Re-enter your password"
                      toggleAriaLabelSubject="confirm password"
                      testId="register-confirm-password-input"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold transition flex items-center justify-center gap-2"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>{isSubmitting ? 'Creating Account...' : 'Create Account'}</span>
                  </button>

                  <div className="pt-2 border-t border-slate-800 flex justify-center">
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-emerald-300 transition"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back to Sign In</span>
                    </button>
                  </div>
                </form>
              )}

              {/* FORGOT PASSWORD */}
              {mode === 'forgot' && (
                <form onSubmit={handleForgotPassword} className="space-y-4 text-xs" noValidate>
                  <p className="text-slate-300 leading-relaxed">
                    Enter the email address registered with your WICPS account. If an active account
                    matches, we will send a single-use password reset link that expires shortly.
                  </p>

                  <div>
                    <label
                      htmlFor="forgot-email"
                      className="block text-slate-300 font-semibold mb-1"
                    >
                      Registered Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="forgot-email"
                        type="email"
                        autoComplete="email"
                        required
                        disabled={isSubmitting}
                        value={forgotEmail}
                        onChange={(e) => {
                          setForgotEmail(e.target.value);
                          if (forgotCooldownSec > 0) setForgotCooldownSec(0);
                        }}
                        placeholder="officer@forestdivision.gov"
                        className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 disabled:opacity-60 focus:outline-hidden focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting || forgotCooldownSec > 0}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold transition flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Mail className="w-4 h-4" />
                    )}
                    <span>
                      {isSubmitting
                        ? 'Sending Reset Link...'
                        : forgotCooldownSec > 0
                          ? `Resend Available in ${forgotCooldownSec}s`
                          : 'Send Password Reset Link'}
                    </span>
                  </button>

                  <div className="pt-2 border-t border-slate-800 flex justify-center">
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-emerald-300 transition"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back to Sign In</span>
                    </button>
                  </div>
                </form>
              )}

              {/* RESET PASSWORD (FROM EMAIL LINK) */}
              {mode === 'reset' && (
                <div className="space-y-4 text-xs">
                  {resetValidating ? (
                    <div className="py-6 flex flex-col items-center justify-center gap-2.5 text-slate-400">
                      <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
                      <span>Validating password reset link...</span>
                    </div>
                  ) : resetCompleted ? (
                    <div className="space-y-4">
                      <p className="text-slate-300 leading-relaxed">
                        Your password has been updated and the recovery link has been invalidated.
                      </p>
                      <button
                        type="button"
                        onClick={() => switchMode('login')}
                        className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition flex items-center justify-center gap-2"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>Return to Sign In</span>
                      </button>
                    </div>
                  ) : !resetTokenValid ? (
                    <div className="space-y-4">
                      <div
                        role="alert"
                        className="bg-red-950/70 border border-red-800/70 rounded-xl p-3.5 text-red-200 flex items-start gap-2.5"
                      >
                        <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold">Invalid or Expired Reset Link</div>
                          <p className="mt-1 text-red-200/90 leading-relaxed">
                            {resetTokenError ||
                              'This password reset link is invalid, expired, or has already been used.'}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          type="button"
                          onClick={() => switchMode('forgot')}
                          className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition"
                        >
                          Request New Reset Link
                        </button>
                        <button
                          type="button"
                          onClick={() => switchMode('login')}
                          className="flex-1 py-2.5 px-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold transition"
                        >
                          Back to Sign In
                        </button>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={handleResetPassword} className="space-y-3.5" noValidate>
                      <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl p-3 text-emerald-200 leading-relaxed">
                        Reset link verified. Choose a new password (minimum 8 characters) to restore
                        access to your WICPS account.
                        {resetExpiresAt && (
                          <div className="mt-1 text-[11px] font-mono text-emerald-300/80">
                            Link expires at {new Date(resetExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                      </div>

                      <div>
                        <label
                          htmlFor="reset-new-password"
                          className="block text-slate-300 font-semibold mb-1"
                        >
                          New Password (min. 8 characters)
                        </label>
                        <PasswordInput
                          id="reset-new-password"
                          value={resetNewPassword}
                          onChange={setResetNewPassword}
                          autoComplete="new-password"
                          required
                          minLength={8}
                          placeholder="Enter new password"
                          toggleAriaLabelSubject="new password"
                          testId="reset-new-password-input"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="reset-confirm-password"
                          className="block text-slate-300 font-semibold mb-1"
                        >
                          Confirm New Password
                        </label>
                        <PasswordInput
                          id="reset-confirm-password"
                          value={resetConfirmPassword}
                          onChange={setResetConfirmPassword}
                          autoComplete="new-password"
                          required
                          minLength={8}
                          placeholder="Confirm new password"
                          toggleAriaLabelSubject="confirm new password"
                          testId="reset-confirm-password-input"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold transition flex items-center justify-center gap-2"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>{isSubmitting ? 'Updating Password...' : 'Update Password'}</span>
                      </button>

                      <div className="pt-2 border-t border-slate-800 flex justify-center">
                        <button
                          type="button"
                          onClick={() => switchMode('login')}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-emerald-300 transition"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                          <span>Cancel & Return to Sign In</span>
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {/* OIDC / BEARER TOKEN */}
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
                    <label
                      htmlFor="oidc-token-input"
                      className="block text-slate-300 font-semibold mb-1"
                    >
                      Signed JWT / OIDC Access Token
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                      <textarea
                        id="oidc-token-input"
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
