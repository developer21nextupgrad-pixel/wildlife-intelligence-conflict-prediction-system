const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidEmailAddress(rawEmail: string): boolean {
  const email = (rawEmail || '').trim().toLowerCase();
  return email.length > 0 && email.length <= 255 && EMAIL_REGEX.test(email);
}

export interface RegistrationFormInput {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export function validateRegistrationForm(input: RegistrationFormInput): string | null {
  const fullName = (input.fullName || '').trim();
  const email = (input.email || '').trim();

  if (fullName.length < 2) {
    return 'Full name must be at least 2 characters long.';
  }
  if (fullName.length > 160) {
    return 'Full name must not exceed 160 characters.';
  }
  if (!isValidEmailAddress(email)) {
    return 'Please enter a valid email address.';
  }
  if (!input.password || input.password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (input.password.length > 256) {
    return 'Password must not exceed 256 characters.';
  }
  if (input.password !== input.confirmPassword) {
    return 'Password and Confirm Password do not match.';
  }
  return null;
}

export interface ResetPasswordFormInput {
  newPassword: string;
  confirmPassword: string;
}

export function validateResetPasswordForm(input: ResetPasswordFormInput): string | null {
  if (!input.newPassword || input.newPassword.length < 8) {
    return 'New password must be at least 8 characters long.';
  }
  if (input.newPassword.length > 256) {
    return 'New password must not exceed 256 characters.';
  }
  if (input.newPassword !== input.confirmPassword) {
    return 'New password and Confirm Password do not match.';
  }
  return null;
}

export interface ParsedResetRoute {
  isResetRoute: boolean;
  token: string | null;
}

export function parseResetPasswordTokenFromUrl(
  pathname: string,
  search: string
): ParsedResetRoute {
  const normalizedPath = (pathname || '').replace(/\/+$/, '');
  const params = new URLSearchParams(search || '');
  const rawToken = (params.get('token') || '').trim();

  if (normalizedPath === '/reset-password') {
    return {
      isResetRoute: true,
      token: rawToken || null,
    };
  }

  // Also support ?reset_token=... fallback if accessed on root URL
  const queryResetToken = (params.get('reset_token') || '').trim();
  if (queryResetToken) {
    return {
      isResetRoute: true,
      token: queryResetToken,
    };
  }

  return {
    isResetRoute: false,
    token: null,
  };
}
