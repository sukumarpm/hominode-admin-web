import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getApps: vi.fn((): object[] => []),
  initializeApp: vi.fn(() => ({ name: 'test' })),
  initializeAppCheck: vi.fn(),
  getAuth: vi.fn(() => ({})),
  getFirestore: vi.fn(() => ({})),
  getFunctions: vi.fn(() => ({})),
  getStorage: vi.fn(() => ({})),
  provider: vi.fn(),
}));
vi.mock('firebase/app', () => ({ getApps: mocks.getApps, initializeApp: mocks.initializeApp }));
vi.mock('firebase/app-check', () => ({
  initializeAppCheck: mocks.initializeAppCheck,
  ReCaptchaEnterpriseProvider: class {
    constructor(key: string) {
      mocks.provider(key);
    }
  },
}));
vi.mock('firebase/auth', () => ({ getAuth: mocks.getAuth }));
vi.mock('firebase/firestore', () => ({ getFirestore: mocks.getFirestore }));
vi.mock('firebase/functions', () => ({ getFunctions: mocks.getFunctions, httpsCallable: vi.fn() }));
vi.mock('firebase/storage', () => ({ getStorage: mocks.getStorage }));

// Mock-only public configuration; these are not provisioned Firebase identifiers.
const config = {
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_APP_ID: 'test-app-id',
  VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: 'test-site-key',
};
const debugGlobal = globalThis as typeof globalThis & {
  FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
};
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getApps.mockReturnValue([]);
  vi.stubGlobal('FIREBASE_APPCHECK_DEBUG_TOKEN', undefined);
  vi.stubEnv('DEV', false);
  vi.stubEnv('PROD', true);
  for (const [key, value] of Object.entries(config)) vi.stubEnv(key, value);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('uses explicit production config and initializes Enterprise App Check before services only once', async () => {
  const { firebase } = await import('../firebase');
  expect(firebase()).toBe(firebase());
  expect(mocks.initializeApp).toHaveBeenCalledOnce();
  expect(mocks.initializeApp).toHaveBeenCalledWith(
    expect.objectContaining({
      apiKey: config.VITE_FIREBASE_API_KEY,
      appId: config.VITE_FIREBASE_APP_ID,
      projectId: 'hominode-prod',
    }),
  );
  expect(mocks.initializeAppCheck).toHaveBeenCalledOnce();
  expect(mocks.provider).toHaveBeenCalledWith(config.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY);
  expect(mocks.initializeAppCheck).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ isTokenAutoRefreshEnabled: true }),
  );
  for (const service of [mocks.getAuth, mocks.getFirestore, mocks.getFunctions, mocks.getStorage]) {
    expect(mocks.initializeAppCheck.mock.invocationCallOrder[0]).toBeLessThan(
      service.mock.invocationCallOrder[0],
    );
  }
  expect(mocks.getFunctions).toHaveBeenCalledWith(expect.anything(), 'asia-southeast1');
  expect(debugGlobal.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
});

for (const key of Object.keys(config)) {
  it.each([undefined, '', ' \t\n '])(
    `rejects missing/blank production ${key}: %j before initialization`,
    async (value) => {
      // An already initialized app must not bypass configuration validation either.
      mocks.getApps.mockReturnValue([{ name: 'existing' }]);
      vi.stubEnv(key, value);
      const { firebase } = await import('../firebase');
      expect(() => firebase()).toThrow(`Web authentication configuration is missing ${key}.`);
      expect(mocks.getApps).not.toHaveBeenCalled();
      expect(mocks.initializeApp).not.toHaveBeenCalled();
      expect(mocks.initializeAppCheck).not.toHaveBeenCalled();
      expect(mocks.provider).not.toHaveBeenCalled();
      for (const service of [
        mocks.getAuth,
        mocks.getFirestore,
        mocks.getFunctions,
        mocks.getStorage,
      ]) {
        expect(service).not.toHaveBeenCalled();
      }
    },
  );
}

it('ignores VITE_APPCHECK_DEBUG in production', async () => {
  vi.stubEnv('VITE_APPCHECK_DEBUG', 'true');
  const { firebase } = await import('../firebase');
  firebase();
  expect(debugGlobal.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
  expect(mocks.provider).toHaveBeenCalledWith(config.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY);
});
it('keeps debug App Check available only in DEV with explicit local config', async () => {
  vi.stubEnv('DEV', true);
  vi.stubEnv('PROD', false);
  vi.stubEnv('VITE_APPCHECK_DEBUG', 'false');
  mocks.initializeAppCheck.mockImplementationOnce(() => {
    expect(debugGlobal.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
  });
  const { firebase } = await import('../firebase');
  firebase();
  expect(mocks.initializeAppCheck).toHaveBeenCalledOnce();
});
