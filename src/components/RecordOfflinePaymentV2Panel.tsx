import { useEffect, useRef, useState, type FormEvent } from 'react';
import { recordOfflinePaymentV2 } from '../actions';
import {
  createOfflinePaymentAttemptV2,
  loadOfflinePaymentAttemptV2,
  parseOfflinePaymentAmountToMinorUnits,
  saveOfflinePaymentAttemptV2,
  type OfflinePaymentAttemptV2,
  type OfflinePaymentMethodV2,
  type OfflinePaymentResultV2,
} from '../offlinePaymentV2';
import {
  classifyV2Bill,
  formatInrMinorUnits,
  hasValidV2BillFinancials,
  str,
  type Row,
  type Session,
} from '../models';

const methods: { label: string; value: OfflinePaymentMethodV2 }[] = [
  { label: 'Cash', value: 'cash' },
  { label: 'Bank Transfer', value: 'bank_transfer' },
  { label: 'Cheque', value: 'cheque' },
];

type AttemptInput = Omit<OfflinePaymentAttemptV2, 'idempotencyKey'>;
type PanelStatus = 'checking' | 'ready' | 'recovery-error';

export function RecordOfflinePaymentV2Panel({
  session,
  bill,
  proofsLoading,
  proofsError,
  hasPendingProof,
  onRecorded,
  onClose,
  createAttempt = createOfflinePaymentAttemptV2,
  loadAttempt = loadOfflinePaymentAttemptV2,
  saveAttempt = saveOfflinePaymentAttemptV2,
  submitPayment = recordOfflinePaymentV2,
}: {
  session: Session;
  bill: Row;
  proofsLoading: boolean;
  proofsError: string;
  hasPendingProof: boolean;
  onRecorded: () => void;
  onClose?: () => void;
  createAttempt?: (input: AttemptInput) => OfflinePaymentAttemptV2;
  loadAttempt?: typeof loadOfflinePaymentAttemptV2;
  saveAttempt?: typeof saveOfflinePaymentAttemptV2;
  submitPayment?: typeof recordOfflinePaymentV2;
}) {
  const [storageStatus, setStorageStatus] = useState<PanelStatus>('checking');
  const [savedAttempt, setSavedAttempt] = useState<OfflinePaymentAttemptV2 | null>(null);
  const [recoveryVisible, setRecoveryVisible] = useState(true);
  const [open, setOpen] = useState(false);
  const [amountText, setAmountText] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<OfflinePaymentMethodV2>('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<OfflinePaymentResultV2 | null>(null);
  const [completedAttempt, setCompletedAttempt] = useState<OfflinePaymentAttemptV2 | null>(null);
  const newAttemptStarted = useRef(false);
  const retryInFlight = useRef(false);

  const data = bill.data;
  const communityId = str(data.communityId);
  const residentId = str(data.residentId);
  const billCommunityMatches = communityId !== '' && communityId === session.community?.id;
  const financiallyEligible =
    session.role === 'admin' &&
    billCommunityMatches &&
    !!residentId &&
    !residentId.includes('/') &&
    !communityId.includes('/') &&
    hasValidV2BillFinancials(data) &&
    classifyV2Bill(data) === 'current' &&
    typeof data.outstandingAmountMinor === 'number' &&
    data.outstandingAmountMinor > 0;

  useEffect(() => {
    if (!financiallyEligible) {
      setStorageStatus('ready');
      setSavedAttempt(null);
      return;
    }
    try {
      setSavedAttempt(loadAttempt(communityId, residentId));
      setStorageStatus('ready');
    } catch {
      setSavedAttempt(null);
      setStorageStatus('recovery-error');
    }
  }, [communityId, financiallyEligible, loadAttempt, residentId]);

  async function submitSavedAttempt(attempt: OfflinePaymentAttemptV2) {
    if (retryInFlight.current) return;
    retryInFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await submitPayment(session, attempt);
      setCompletedAttempt(attempt);
      setSuccess(result);
      setSavedAttempt(null);
      try {
        onRecorded();
      } catch {
        // The payment is confirmed even if the view refresh callback fails.
      }
    } catch {
      setError(
        'The payment result is unresolved. The request may have reached the server. The exact saved attempt has been preserved. Retry the saved payment to recover the result.',
      );
    } finally {
      retryInFlight.current = false;
      setBusy(false);
    }
  }

  async function submitNewAttempt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      busy ||
      newAttemptStarted.current ||
      !financiallyEligible ||
      storageStatus !== 'ready' ||
      savedAttempt
    ) return;
    setError('');
    const amountMinor = parseOfflinePaymentAmountToMinorUnits(amountText);
    if (amountMinor === null) {
      setError('Enter a valid payment amount greater than ₹0 with up to two decimal places.');
      return;
    }
    const paymentReferenceTrimmed = paymentReference.trim();
    if (paymentReferenceTrimmed.length > 200) {
      setError('The reference must be 200 characters or fewer.');
      return;
    }

    let attempt: OfflinePaymentAttemptV2;
    newAttemptStarted.current = true;
    try {
      attempt = createAttempt({
        communityId,
        residentId,
        amountMinor,
        paymentMethod,
        paymentReference: paymentReferenceTrimmed || null,
      });
      saveAttempt(attempt);
    } catch (failure) {
      newAttemptStarted.current = false;
      setError(
        failure instanceof Error
          ? `The payment attempt could not be saved. No payment was submitted. ${failure.message}`
          : 'The payment attempt could not be saved. No payment was submitted.',
      );
      return;
    }

    setSavedAttempt(attempt);
    setOpen(false);
    await submitSavedAttempt(attempt);
  }

  if (session.role !== 'admin') return null;
  if (success && completedAttempt) {
    const methodLabel = methods.find((method) => method.value === completedAttempt.paymentMethod)?.label;
    return (
      <section className="record-payment-panel" aria-label="V2 offline payment result">
        {success.alreadyCompleted ? (
          <p role="status">
            This previously submitted payment was already completed. The saved request was recovered
            safely.
          </p>
        ) : (
          <p role="status">Offline payment recorded successfully.</p>
        )}
        <dl>
          <div><dt>Transaction ID</dt><dd>{success.transactionId}</dd></div>
          <div><dt>Recorded amount</dt><dd>{formatInrMinorUnits(completedAttempt.amountMinor)}</dd></div>
          <div><dt>Payment method</dt><dd>{methodLabel}</dd></div>
          <div><dt>Allocations</dt><dd>{success.allocations.length}</dd></div>
          {success.allocations.map((allocation) => (
            <div key={`${allocation.billId}-${allocation.amountMinor}`}>
              <dt>Bill {allocation.billId}</dt>
              <dd>{formatInrMinorUnits(allocation.amountMinor)}</dd>
            </div>
          ))}
          <div><dt>Excess resident credit</dt><dd>{formatInrMinorUnits(success.excessCreditMinor)}</dd></div>
        </dl>
      </section>
    );
  }

  if (!financiallyEligible)
    return <p role="status">Offline payment unavailable for this V2 bill.</p>;
  if (proofsLoading || proofsError)
    return (
      <p role="status">Offline payment unavailable while payment proof status is being checked.</p>
    );
  if (hasPendingProof)
    return <p role="status">Offline payment unavailable while a payment proof is pending.</p>;

  if (storageStatus === 'checking')
    return <p role="status">Checking for an unresolved offline payment…</p>;
  if (storageStatus === 'recovery-error')
    return (
      <p role="alert">
        A saved offline payment attempt could not be read safely. No new payment can be started.
      </p>
    );

  if (savedAttempt && !recoveryVisible) {
    return (
      <section className="record-payment-panel" aria-label="Unresolved offline payment">
        <p>An unresolved offline payment remains saved for this resident.</p>
        <button type="button" onClick={() => setRecoveryVisible(true)}>Resume Saved Payment</button>
      </section>
    );
  }

  if (savedAttempt) {
    const methodLabel = methods.find((method) => method.value === savedAttempt.paymentMethod)?.label;
    return (
      <section className="record-payment-panel" aria-label="Unresolved offline payment">
        <h3>Unresolved Offline Payment</h3>
        <p>The saved request must be retried to recover its result.</p>
        <dl>
          <div><dt>Amount</dt><dd>{formatInrMinorUnits(savedAttempt.amountMinor)}</dd></div>
          <div><dt>Payment method</dt><dd>{methodLabel}</dd></div>
          <div><dt>Reference</dt><dd>{savedAttempt.paymentReference || 'Not provided'}</dd></div>
        </dl>
        {error && <p role="alert">{error}</p>}
        <div className="button-row">
          <button type="button" className="primary" disabled={busy} onClick={() => void submitSavedAttempt(savedAttempt)}>
            {busy ? 'Retrying…' : 'Retry Saved Payment'}
          </button>
          <button type="button" disabled={busy} onClick={() => onClose ? onClose() : setRecoveryVisible(false)}>
            Close
          </button>
        </div>
        {!recoveryVisible && (
          <button type="button" onClick={() => setRecoveryVisible(true)}>Resume Saved Payment</button>
        )}
      </section>
    );
  }

  if (!open) {
    return (
      <section className="record-payment-panel" aria-label="Record V2 offline payment">
        <button type="button" className="primary" onClick={() => setOpen(true)}>
          Record Offline Payment
        </button>
        {error && <p role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <section className="record-payment-panel" aria-label="Record V2 offline payment">
      <form className="record-payment-form" onSubmit={(event) => void submitNewAttempt(event)}>
        <h3>Record Offline Payment</h3>
        <dl>
          <div><dt>Resident</dt><dd>{str(data.residentName) || str(data.userName) || residentId}</dd></div>
          <div><dt>Unit / flat</dt><dd>{str(data.flatLabel) || str(data.flatId) || 'Not specified'}</dd></div>
          <div><dt>Selected bill reference</dt><dd>{bill.id}</dd></div>
          <div><dt>Selected bill outstanding (context only)</dt><dd>{formatInrMinorUnits(data.outstandingAmountMinor)}</dd></div>
        </dl>
        <p>
          This payment is applied to the resident&apos;s oldest eligible outstanding bills first. It
          may not apply only to the bill shown here. Any excess becomes resident credit.
        </p>
        <fieldset disabled={busy}>
          <label>
            Payment amount (₹)
            <input
              aria-label="Payment amount (₹)"
              inputMode="decimal"
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            Payment method
            <select
              aria-label="Payment method"
              value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.target.value as OfflinePaymentMethodV2)}
            >
              {methods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
            </select>
          </label>
          <label>
            Reference / receipt number (optional)
            <input
              aria-label="Reference / receipt number (optional)"
              value={paymentReference}
              maxLength={200}
              onChange={(event) => setPaymentReference(event.target.value)}
              autoComplete="off"
            />
          </label>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <div className="button-row">
          <button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit Offline Payment'}
          </button>
        </div>
      </form>
    </section>
  );
}
