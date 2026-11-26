import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidEmailAddress,
  parseResetPasswordTokenFromUrl,
  validateRegistrationForm,
  validateResetPasswordForm,
} from './authValidation.ts';

test('isValidEmailAddress accepts valid emails and rejects malformed values', () => {
  assert.equal(isValidEmailAddress('ranger@forest.gov.in'), true);
  assert.equal(isValidEmailAddress('  Officer.One+wicps@example.org  '), true);
  assert.equal(isValidEmailAddress('not-an-email'), false);
  assert.equal(isValidEmailAddress('missing@tld'), false);
  assert.equal(isValidEmailAddress('spaces in@email.com'), false);
  assert.equal(isValidEmailAddress(''), false);
});

test('validateRegistrationForm checks full name, email, password length, and confirmation', () => {
  assert.equal(
    validateRegistrationForm({
      fullName: 'Meera Nair',
      email: 'meera.nair@forest.gov',
      password: 'SecurePassword123!',
      confirmPassword: 'SecurePassword123!',
    }),
    null
  );

  assert.match(
    validateRegistrationForm({
      fullName: 'A',
      email: 'meera@forest.gov',
      password: 'SecurePassword123!',
      confirmPassword: 'SecurePassword123!',
    }) || '',
    /at least 2 characters/i
  );

  assert.match(
    validateRegistrationForm({
      fullName: 'Meera Nair',
      email: 'bad-email',
      password: 'SecurePassword123!',
      confirmPassword: 'SecurePassword123!',
    }) || '',
    /valid email/i
  );

  assert.match(
    validateRegistrationForm({
      fullName: 'Meera Nair',
      email: 'meera@forest.gov',
      password: 'short',
      confirmPassword: 'short',
    }) || '',
    /at least 8 characters/i
  );

  assert.match(
    validateRegistrationForm({
      fullName: 'Meera Nair',
      email: 'meera@forest.gov',
      password: 'SecurePassword123!',
      confirmPassword: 'DifferentPassword123!',
    }) || '',
    /do not match/i
  );
});

test('validateResetPasswordForm enforces minimum length and matching confirmation', () => {
  assert.equal(
    validateResetPasswordForm({
      newPassword: 'UpdatedPassword99!',
      confirmPassword: 'UpdatedPassword99!',
    }),
    null
  );

  assert.match(
    validateResetPasswordForm({
      newPassword: '1234567',
      confirmPassword: '1234567',
    }) || '',
    /at least 8 characters/i
  );

  assert.match(
    validateResetPasswordForm({
      newPassword: 'UpdatedPassword99!',
      confirmPassword: 'MismatchPassword99!',
    }) || '',
    /do not match/i
  );
});

test('parseResetPasswordTokenFromUrl detects /reset-password path and token query param', () => {
  assert.deepEqual(
    parseResetPasswordTokenFromUrl('/reset-password', '?token=abc123tokenXYZ'),
    {
      isResetRoute: true,
      token: 'abc123tokenXYZ',
    }
  );

  assert.deepEqual(parseResetPasswordTokenFromUrl('/reset-password/', ''), {
    isResetRoute: true,
    token: null,
  });

  assert.deepEqual(parseResetPasswordTokenFromUrl('/', '?reset_token=fallbackToken99'), {
    isResetRoute: true,
    token: 'fallbackToken99',
  });

  assert.deepEqual(parseResetPasswordTokenFromUrl('/', ''), {
    isResetRoute: false,
    token: null,
  });
});
