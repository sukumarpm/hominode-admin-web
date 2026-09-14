import { getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
export function firebaseConfig(env: Record<string, string | undefined>) {
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    appId: env.VITE_FIREBASE_APP_ID || '1:551984029668:web:5845083359a375d90db1f1',
    projectId: 'hominode-prod',
    authDomain: 'hominode-prod.firebaseapp.com',
    storageBucket: 'hominode-prod.firebasestorage.app',
    messagingSenderId: '551984029668',
  };
}
function initialize() {
  const app = getApps()[0] || initializeApp(firebaseConfig(import.meta.env));

  // Local development only: use Firebase App Check debug provider.
  // Production builds continue using reCAPTCHA Enterprise normally.
  if (import.meta.env.DEV) {
    (
      globalThis as typeof globalThis & {
        FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
      }
    ).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }

  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(
      import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY ||
        '6LfLtJstAAAAAFM2jk9KvFB-2f7zUr9DCNIl7HqN',
    ),
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
// No debug App Check provider, emulator bypass or appVerificationDisabledForTesting.
