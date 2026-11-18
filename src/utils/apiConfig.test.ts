import test from 'node:test';
import assert from 'node:assert/strict';
import {
  API_URL_STORAGE_KEY,
  clearSavedApiBaseUrl,
  DEFAULT_LOCAL_API_BASE_URL,
  formatApiUnreachableMessage,
  isLocalhostUrl,
  isValidHttpApiUrl,
  normalizeApiBaseUrl,
  readSavedApiBaseUrl,
  resolveActiveApiBaseUrl,
  StorageLike,
  writeSavedApiBaseUrl,
} from './apiConfig';

function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

test('normalizeApiBaseUrl strips trailing slashes, appends /api/v1 for bare origin, and respects fallback', () => {
  assert.equal(normalizeApiBaseUrl('https://wicps.example.com/api/v1///'), 'https://wicps.example.com/api/v1');
  assert.equal(normalizeApiBaseUrl('https://concentrations-trim-you-publicly.trycloudflare.com'), 'https://concentrations-trim-you-publicly.trycloudflare.com/api/v1');
  assert.equal(normalizeApiBaseUrl('   '), DEFAULT_LOCAL_API_BASE_URL);
  assert.equal(normalizeApiBaseUrl('   ', ''), '');
  assert.equal(normalizeApiBaseUrl(undefined), DEFAULT_LOCAL_API_BASE_URL);
});

test('isValidHttpApiUrl and isLocalhostUrl validate protocol and loopback host', () => {
  assert.equal(isValidHttpApiUrl('http://localhost:8000/api/v1'), true);
  assert.equal(isValidHttpApiUrl('https://tunnel.example.com/api/v1'), true);
  assert.equal(isValidHttpApiUrl('ftp://localhost:8000'), false);
  assert.equal(isValidHttpApiUrl('not-a-url'), false);

  assert.equal(isLocalhostUrl('http://localhost:8000/api/v1'), true);
  assert.equal(isLocalhostUrl('http://127.0.0.1:8000/api/v1'), true);
  assert.equal(isLocalhostUrl('https://wicps-api.trycloudflare.com/api/v1'), false);
});

test('saved custom URL persists across reads and never falls back to localhost', () => {
  const storage = createMemoryStorage();
  assert.equal(resolveActiveApiBaseUrl({ storage }), DEFAULT_LOCAL_API_BASE_URL);

  const saved = writeSavedApiBaseUrl(
    'https://concentrations-trim-you-publicly.trycloudflare.com/api/v1/',
    storage
  );
  assert.equal(saved, 'https://concentrations-trim-you-publicly.trycloudflare.com/api/v1');
  assert.equal(
    readSavedApiBaseUrl(storage),
    'https://concentrations-trim-you-publicly.trycloudflare.com/api/v1'
  );
  assert.equal(
    resolveActiveApiBaseUrl({ envUrl: 'http://localhost:8000/api/v1', storage }),
    'https://concentrations-trim-you-publicly.trycloudflare.com/api/v1'
  );
  assert.equal(
    storage.getItem(API_URL_STORAGE_KEY),
    'https://concentrations-trim-you-publicly.trycloudflare.com/api/v1'
  );

  assert.throws(() => writeSavedApiBaseUrl('', storage));
  assert.equal(
    resolveActiveApiBaseUrl({ storage }),
    'https://concentrations-trim-you-publicly.trycloudflare.com/api/v1'
  );

  clearSavedApiBaseUrl(storage);
  storage.removeItem('wicps_settings_v1');
  assert.equal(resolveActiveApiBaseUrl({ storage }), DEFAULT_LOCAL_API_BASE_URL);
});

test('formatApiUnreachableMessage diagnoses HTTPS preview localhost vs HTTPS tunnel CORS', () => {
  const msg = formatApiUnreachableMessage({
    baseUrl: 'http://localhost:8000/api/v1',
    reason: 'Failed to fetch',
    pageProtocol: 'https:',
    pageOrigin: 'https://ais-dev-example.asia-northeast1.run.app',
  });
  assert.match(msg, /HTTPS/);
  assert.match(msg, /localhost:8000/);
  assert.match(msg, /FastAPI \/ PostGIS Bridge/);

  const tunnelMsg = formatApiUnreachableMessage({
    baseUrl: 'https://concentrations-trim-you-publicly.trycloudflare.com/api/v1',
    reason: 'Failed to fetch',
    pageProtocol: 'https:',
    pageOrigin: 'https://ais-dev-example.asia-northeast1.run.app',
  });
  assert.match(tunnelMsg, /CORS configuration/);
  assert.match(tunnelMsg, /OPTIONS preflight/);

  const localMsg = formatApiUnreachableMessage({
    baseUrl: 'http://localhost:8000/api/v1',
    reason: 'Failed to fetch',
    pageProtocol: 'http:',
    pageOrigin: 'http://localhost:3000',
  });
  assert.match(localMsg, /Ensure the FastAPI \+ PostGIS server is running/);
});
