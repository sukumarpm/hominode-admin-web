import { RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PhoneNumberInput } from './components/PhoneNumberInput';
import { firebase } from './firebase';
import { APP_ROLE } from './role';
function friendlyPhoneAuthError(error: unknown): string {
  const code =
    typeof error === 'object' &&
      error !== null &&
      'code' in error
      ? String((error as { code?: unknown }).code)
      : '';

  switch (code) {
    case 'auth/invalid-phone-number':
      return 'Please enter a valid phone number.';

    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.';

    case 'auth/network-request-failed':
      return 'Unable to connect. Please check your internet connection and try again.';

    case 'auth/invalid-verification-code':
      return 'The verification code is incorrect. Please check the code and try again.';

    case 'auth/code-expired':
    case 'auth/session-expired':
      return 'The verification code has expired. Please request a new code.';

    case 'auth/captcha-check-failed':
    case 'auth/unauthorized-domain':
    case 'auth/app-not-authorized':
      return 'We could not verify this request. Please refresh the page and try again.';

    case 'auth/quota-exceeded':
      return 'Phone verification is temporarily unavailable. Please try again later.';

    default:
      return 'Unable to send the verification code. Please check the phone number and try again.';
  }
}
export function Login({ communityName }: { communityName?: string }) {
  const [phone, setPhone] = useState(''),
    [code, setCode] = useState(''),
    [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const verifier = useRef<RecaptchaVerifier | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      verifier.current?.clear();
      verifier.current = null;
    };
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (confirmation) {
        await confirmation.confirm(code);
      } else {
        if (!phone)
          throw Error('Enter a valid phone number.');
        verifier.current?.clear();
        verifier.current = new RecaptchaVerifier(firebase().auth, 'phone-recaptcha', {
          size: 'normal',
        });
        const result = await signInWithPhoneNumber(firebase().auth, phone, verifier.current);
        if (mounted.current) {
          setConfirmation(result);
          setMessage('A verification code has been sent to your phone.');
        }
      }
    } catch (e) {
      console.error('Admin phone authentication failed:', e);

      if (mounted.current) {
        setMessage(friendlyPhoneAuthError(e));
      }

      if (!confirmation) {
        verifier.current?.clear();
        verifier.current = null;
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <main className={'login-page ' + APP_ROLE}>
      <section className="login-story">
        <img src="/images/logo.png" alt="Hominode" />
        <div>
          <p className="eyebrow">SMART PLACE. BETTER LIVES.</p>
          <h1>
            {APP_ROLE === 'admin'
              ? 'A better community starts with you.'
              : 'Your home. Your community. Connected.'}
          </h1>
          <p>Welcome to {communityName || 'Hominode'}.</p>
        </div>
      </section>
      <section className="login-form">
        <div className="form-mark">
          <ShieldCheck />
        </div>
        <p className="eyebrow">{APP_ROLE} PORTAL</p>
        <h2>Welcome back</h2>
        <p>Sign in with your registered phone number.</p>
        <form onSubmit={submit}>
          <PhoneNumberInput
            label="Phone number"
            value={phone}
            onChange={setPhone}
            required
            disabled={busy || !!confirmation}
            defaultCountry="PH"
          />
          {confirmation && (
            <label>
              Verification code
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
              />
            </label>
          )}
          <div id="phone-recaptcha" hidden={!!confirmation} />
          <button className="primary" disabled={busy}>
            {busy ? 'Please wait…' : confirmation ? 'Verify & continue' : 'Send verification code'}
            <ArrowRight size={18} />
          </button>
          {confirmation && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setConfirmation(null);
                setCode('');
                setMessage('');
                verifier.current?.clear();
                verifier.current = null;
              }}
            >
              Use another number
            </button>
          )}
          {message && (
            <p role="status" className="form-message">
              {message}
            </p>
          )}
        </form>
        <p className="login-footnote">Secure access for your community.</p>
      </section>
    </main>
  );
}
