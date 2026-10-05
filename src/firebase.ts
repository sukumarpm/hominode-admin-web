import { getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
function requiredConfig(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw Error(`Web authentication configuration is missing ${key}.`);
  return value;
}

// Require explicit public configuration in every mode, including production.
export function firebaseConfig(env: Record<string, string | undefined>) {
  return {
    apiKey: requiredConfig(env, 'VITE_FIREBASE_API_KEY'),
    appId: requiredConfig(env, 'VITE_FIREBASE_APP_ID'),
    projectId: 'hominode-prod',
    authDomain: 'hominode-prod.firebaseapp.com',
    storageBucket: 'hominode-prod.firebasestorage.app',
    messagingSenderId: '551984029668',
  };
}
function initialize() {
  // Validate before using even an existing Firebase app or initializing any service.
  const config = firebaseConfig(import.meta.env);
  const siteKey = requiredConfig(import.meta.env, 'VITE_RECAPTCHA_ENTERPRISE_SITE_KEY');
  const app = getApps()[0] || initializeApp(config);

  // Vite's built-in DEV flag is the only debug-provider gate.
  if (import.meta.env.DEV) {
    (
      globalThis as typeof globalThis & {
        FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
      }
    ).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }

  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
  return {
    app,
    auth: getAuth(app),
    db: getFirestore(app),
    functions: getFunctions(app, 'asia-southeast1'),
    storage: getStorage(app),
  };
}
let instance: ReturnType<typeof initialize> | undefined;
export const firebase = () => instance ?? (instance = initialize());
export async function call<T>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  return (await httpsCallable<Record<string, unknown>, T>(firebase().functions, name)(data)).data;
}
// Production never enables the App Check debug provider or Phone Auth bypasses.
