import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthenticatedUserProfile,
  canManageAdmin,
  canReviewReid,
  clearStoredAuthSession,
  emitAuthUnauthorized,
  getStoredAuthToken,
  getStoredAuthUser,
  getUserInitials,
  hasMinimumRole,
  isProtectedApiUrl,
  onAuthUnauthorized,
  setStoredAuthSession,
} from './authStorage';

function makeUser(role: 'operator' | 'reviewer' | 'admin'): AuthenticatedUserProfile {
  const effectiveRoles =
    role === 'admin'
      ? ['admin', 'reviewer', 'operator']
      : role === 'reviewer'
      ? ['reviewer', 'operator']
      : ['operator'];
  return {
    id: 'user-1',
    subject: 'user-1',
    email: `${role}@wicps.test`,
    displayName: `Test ${role}`,
    role,
    roles: [role],
    effectiveRoles,
    authMethod: 'jwt_hs256',
  };
}

test('role hierarchy enforces operator < reviewer < admin', () => {
  const op = makeUser('operator');
  const rev = makeUser('reviewer');
  const adm = makeUser('admin');

  assert.equal(hasMinimumRole(null, 'operator'), false);
  assert.equal(hasMinimumRole(op, 'operator'), true);
  assert.equal(canReviewReid(op), false);
  assert.equal(canManageAdmin(op), false);

  assert.equal(hasMinimumRole(rev, 'operator'), true);
  assert.equal(canReviewReid(rev), true);
  assert.equal(canManageAdmin(rev), false);

  assert.equal(hasMinimumRole(adm, 'operator'), true);
  assert.equal(canReviewReid(adm), true);
  assert.equal(canManageAdmin(adm), true);
});

test('session state stores, clears, and triggers unauthorized listeners', () => {
  clearStoredAuthSession();
  assert.equal(getStoredAuthToken(), null);
  assert.equal(getStoredAuthUser(), null);

  const user = makeUser('reviewer');
  setStoredAuthSession('jwt.token.value', user);
  assert.equal(getStoredAuthToken(), 'jwt.token.value');
  assert.equal(getStoredAuthUser()?.email, 'reviewer@wicps.test');

  let triggered = 0;
  const unsubscribe = onAuthUnauthorized(() => {
    triggered += 1;
  });
  emitAuthUnauthorized();
  unsubscribe();

  assert.equal(triggered, 1);
  assert.equal(getStoredAuthToken(), null);
  assert.equal(getStoredAuthUser(), null);
});

test('isProtectedApiUrl distinguishes protected API endpoints from data/blob/external URLs', () => {
  assert.equal(isProtectedApiUrl('/api/v1/detections/123/image'), true);
  assert.equal(isProtectedApiUrl('https://api.example.com/api/v1/ingest/frames/1/image'), true);
  assert.equal(isProtectedApiUrl('blob:http://localhost:3000/abc'), false);
  assert.equal(isProtectedApiUrl('data:image/png;base64,AAAA'), false);
  assert.equal(isProtectedApiUrl('https://images.unsplash.com/photo-123'), false);
});

test('getUserInitials formats initials cleanly', () => {
  assert.equal(getUserInitials('Ananya Rao'), 'AR');
  assert.equal(getUserInitials('Operator'), 'OP');
  assert.equal(getUserInitials(''), 'OP');
});
