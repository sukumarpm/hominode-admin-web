import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  initializeApp: vi.fn(() => ({ name: 'test' })),
  initializeAppCheck: vi.fn(),
  getAuth: vi.fn(() => ({})),
  getFirestore: vi.fn(() => ({})),
  getFunctions: vi.fn(() => ({})),
  getStorage: vi.fn(() => ({})),
  provider: vi.fn(),
}));
vi.mock('firebase/app', () => ({ getApps: () => [], initializeApp: mocks.initializeApp }));
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
import { firebase } from '../firebase';
it('initializes Enterprise App Check before services and only once', () => {
  expect(firebase()).toBe(firebase());
  expect(mocks.initializeApp).toHaveBeenCalledOnce();
  expect(mocks.initializeAppCheck).toHaveBeenCalledOnce();
  expect(mocks.provider).toHaveBeenCalledWith('6LfLtJstAAAAAFM2jk9KvFB-2f7zUr9DCNIl7HqN');
  expect(mocks.initializeAppCheck).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ isTokenAutoRefreshEnabled: true }),
  );
  expect(mocks.initializeAppCheck.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.getAuth.mock.invocationCallOrder[0],
  );
  expect(mocks.getFunctions).toHaveBeenCalledWith(expect.anything(), 'asia-southeast1');
});
