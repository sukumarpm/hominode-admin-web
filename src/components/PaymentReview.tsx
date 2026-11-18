import {
  dateLabel,
  first,
  formatInrMinorUnits,
  hasValidV2PaymentProof,
  isV2PaymentProof,
  money,
  str,
  type Data,
} from '../models';
import { useRef, useState } from 'react';

const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;
export type ConfirmedBankCredit = {
  bankCreditReference: string;
  bankCreditDate: string;
  confirmedAmountMinor: number;
};

/** Parse rupees without floating-point rounding; blank or malformed input fails closed. */
export function parseInrRupeesToMinorUnits(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  try {
    const paise = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
    return paise > 0n && paise <= BigInt(MAX_SAFE_MINOR) ? Number(paise) : null;
  } catch {
    return null;
  }
}

export function paymentVerificationErrorMessage(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (
    message.includes('duplicate_payment_reference') ||
    message.includes('reference is already recorded')
  ) {
    return 'This payment reference is already recorded for the resident account. Check the bank record before retrying.';
  }
  if (
    message.includes('revision changed') ||
    message.includes('no longer an eligible liability') ||
    message.includes('outstanding liability')
  ) {
    return 'The bill balance changed after this proof was submitted. Refresh billing and review the current balance before verifying.';
  }
  if (message.includes('only pending') || message.includes('proof was not found')) {
    return 'This proof is no longer pending. Refresh the payment list.';
  }
  if (message.includes('receipt object does not exist') || message.includes('receipt evidence')) {
    return 'Receipt evidence is missing or unavailable. Ask the resident to resubmit it.';
  }
  if (
    message.includes('idempotency_conflict') ||
    message.includes('immutable_financial_conflict') ||
    message.includes('settlement response could not be confirmed')
  ) {
    return 'This proof may already have been reviewed with a different amount. Refresh its status and retry only with the same confirmed amount.';
  }
  return 'Payment verification failed. Check the proof and current bill balance, then retry.';
}

export function isConfirmedV2SettlementResponse(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const response = value as Record<string, unknown>;
  return (
    response.success === true &&
    typeof response.transactionId === 'string' &&
    response.transactionId.trim().length > 0
  );
}

function formattedValue(value: unknown): string {
  const normalized = str(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!normalized) return 'Not specified';
  return normalized
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function paymentReference(data: Data, paymentId: string): string {
  return first(data, ['transactionId', 'paymentReference', 'billId'], paymentId);
}

export function paymentMethodLabel(value: unknown): string {
  const method = str(value).toLowerCase();
  if (method === 'upi') return 'UPI';
  if (method === 'external') return 'External';
  return formattedValue(value);
}

export function paymentAttributionLabel(value: unknown): string {
  const method = str(value).toLowerCase();
  if (method === 'upi') return 'Verified by Admin';
  if (['cash', 'bank_transfer', 'cheque', 'manual'].includes(method)) return 'Recorded by Admin';
  return '';
}

function ReviewCard({
  title,
  values,
  className = '',
}: {
  title: string;
  values: [string, string][];
  className?: string;
}) {
  return (
    <section className={`payment-review-card ${className}`}>
      <h3>{title}</h3>
      <dl className="detail-fields payment-review-fields">
        {values.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function providerLabel(value: unknown, isAdminAttestation: boolean): string {
  if (str(value).toLowerCase() === 'direct_upi') return 'Direct UPI';
  if (!str(value) && isAdminAttestation) return '';
  return formattedValue(value);
}

export function PaymentReviewDetails({
  data,
  paymentId,
}: {
  data: Data;
  paymentId?: string;
}) {
  if (isV2PaymentProof(data)) {
    if (!hasValidV2PaymentProof(data, paymentId)) {
      return <p role="status">Payment proof unavailable</p>;
    }
    const paymentValues: [string, string][] = [
      ['Payment method', 'UPI'],
      ['Provider', 'Direct UPI'],
      ['Verification', 'Manual'],
      ['Evidence', data.evidenceType === 'bank_credit_report' ? 'Resident report — bank verification required' : 'Uploaded receipt'],
      ['Submitted', dateLabel(data.submittedAt) === '—' ? 'Not specified' : dateLabel(data.submittedAt)],
    ];
    const identifierValues: [string, string][] = [
      ...(paymentId ? ([['Payment / Proof ID', paymentId]] as [string, string][]) : []),
      ['Payment reference', str(data.paymentReference) || 'Not provided'],
      ['Bill reference', str(data.billId)],
      ['Bill revision submitted', str(data.submittedBillRevisionId) || 'Not specified'],
      ['Community reference', str(data.communityId)],
      ['Resident reference', str(data.residentId)],
    ];
    return (
      <>
        <div className="payment-review-groups">
          <ReviewCard
            title="Summary"
            className="payment-review-summary"
            values={[
              ['Submitted amount', formatInrMinorUnits(data.submittedAmountMinor)],
              [
                'Amount requirement',
                data.amountContractVersion === 2
                  ? 'Flexible; Admin confirms amount received'
                  : 'Exact outstanding balance',
              ],
              ['Status', formattedValue(data.status)],
            ]}
          />
          <ReviewCard title="Payment information" values={paymentValues} />
          <ReviewCard title="Identifiers" values={identifierValues} />
        </div>
        {data.status === 'completed' && (
          <p className="payment-proof-completion-note">This payment proof is completed.</p>
        )}
      </>
    );
  }

  const method = data.method ?? data.paymentMethod;
  const isAdminAttestation = str(data.evidenceType).toLowerCase() === 'admin_attestation';
  const provider = providerLabel(data.provider, isAdminAttestation);
  const paymentAmount =
    typeof data.amount === 'number' && Number.isFinite(data.amount)
      ? money(data.amount)
      : 'Not specified';
  const submitted = dateLabel(
    data.recordedAt ?? data.paidAt ?? data.paymentDate ?? data.createdAt ?? data.submittedAt,
  );
  const paymentValues: [string, string][] = [
    ['Payment method', paymentMethodLabel(method)],
    ...(provider ? ([['Provider', provider]] as [string, string][]) : []),
    ['Verification', isAdminAttestation ? 'Not applicable' : formattedValue(data.verificationMode)],
    [
      'Evidence',
      str(data.evidenceType).toLowerCase() === 'admin_attestation'
        ? 'Admin attestation'
        : formattedValue(data.evidenceType),
    ],
    [
      isAdminAttestation ? 'Recorded' : 'Submitted',
      submitted === '—' ? 'Not specified' : submitted,
    ],
    ...(str(data.status).toLowerCase() === 'completed' && paymentAttributionLabel(method)
      ? ([['Settlement attribution', paymentAttributionLabel(method)]] as [string, string][])
      : []),
  ];
  const identifierValues: [string, string][] = [
    ...(paymentId ? ([['Payment / Proof ID', paymentId]] as [string, string][]) : []),
    [
      'Transaction / Reference No.',
      str(data.transactionId) || str(data.paymentReference) || 'Not provided',
    ],
    ['Bill reference', str(data.billId) || 'Not specified'],
    ['Unit / flat reference', first(data, ['flatLabel', 'flatId']) || 'Not specified'],
    [
      'Resident reference',
      first(data, ['residentName', 'userName', 'residentId', 'userId']) || 'Not specified',
    ],
  ];

  return (
    <div className="payment-review-groups">
      <ReviewCard
        title="Summary"
        className="payment-review-summary"
        values={[
          ['Amount', paymentAmount],
          ['Status', formattedValue(data.status)],
        ]}
      />
      <ReviewCard title="Payment information" values={paymentValues} />
      <ReviewCard title="Identifiers" values={identifierValues} />
    </div>
  );
}

export function PaymentReviewSection({
  data,
  paymentId,
  canReview,
  busy,
  receipt,
  onViewReceipt,
  onVerify,
  onReject,
}: {
  data: Data;
  paymentId?: string;
  canReview: boolean;
  busy: boolean;
  receipt: string;
  onViewReceipt: () => void;
  onVerify: (confirmedAmountMinor?: number, bankCredit?: ConfirmedBankCredit) => void | Promise<void>;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [bankCreditReference, setBankCreditReference] = useState('');
  const [bankCreditDate, setBankCreditDate] = useState('');
  const [bankCreditAttested, setBankCreditAttested] = useState(false);
  const [receivedAmount, setReceivedAmount] = useState('');
  const [amountConfirmed, setAmountConfirmed] = useState(false);
  const [showAmountConfirmation, setShowAmountConfirmation] = useState(false);
  const [verifySubmitting, setVerifySubmitting] = useState(false);
  const verifyLock = useRef(false);
  const isV2 = isV2PaymentProof(data);
  const validV2 = isV2 && hasValidV2PaymentProof(data, paymentId);
  const flexibleAmountProof = validV2 && data.amountContractVersion === 2;
  const bankReported = validV2 && data.evidenceType === 'bank_credit_report';
  const unsupportedAmountContract =
    isV2 && data.amountContractVersion != null && data.amountContractVersion !== 2;
  const receivedMinor = parseInrRupeesToMinorUnits(receivedAmount);
  const claimedMinor =
    typeof data.submittedAmountMinor === 'number' ? data.submittedAmountMinor : null;
  const amountMismatch =
    receivedMinor != null && claimedMinor != null && receivedMinor !== claimedMinor;
  const isPending = str(data.status) === 'pending';
  const paymentMethod = str(data.method ?? data.paymentMethod).toLowerCase();
  const isAdminAttestedMethod = ['cash', 'bank_transfer', 'cheque', 'manual'].includes(
    paymentMethod,
  );
  const hasReceipt = !!str(data.receiptPath) && (!isV2 || validV2);
  const showReceiptButton = hasReceipt && (!isV2 || canReview);
  const bankReferenceValid = /^[A-Za-z0-9][A-Za-z0-9\\s./_:-]{3,199}$/.test(bankCreditReference.trim());
  const bankDateValid = /^\\d{4}-\\d{2}-\\d{2}$/.test(bankCreditDate) &&
    !Number.isNaN(Date.parse(bankCreditDate)) &&
    new Date(bankCreditDate + 'T00:00:00Z').toISOString().slice(0, 10) === bankCreditDate;
  const confirmedBankAmount = flexibleAmountProof ? receivedMinor : claimedMinor;
  const bankConfirmationReady = bankReferenceValid && bankDateValid &&
    confirmedBankAmount != null && confirmedBankAmount > 0 && bankCreditAttested;
  const handleVerify = (confirmedAmountMinor?: number, bankCredit?: ConfirmedBankCredit) => {
    if (verifyLock.current) return;
    verifyLock.current = true;
    setVerifySubmitting(true);
    void Promise.resolve(onVerify(confirmedAmountMinor, bankCredit)).finally(() => {
      verifyLock.current = false;
      setVerifySubmitting(false);
      setShowAmountConfirmation(false);
      setAmountConfirmed(false);
    });
  };

  return (
    <section className="payment-review-section" aria-label="Payment review">
      <PaymentReviewDetails data={data} paymentId={paymentId} />
      {showReceiptButton && (
        <button type="button" onClick={onViewReceipt} disabled={busy}>
          View receipt
        </button>
      )}
      {receipt && <img className="receipt-image" src={receipt} alt="Payment receipt" />}
      {validV2 && canReview && isPending && (
        <div className="payment-review-controls">
          <h3>Review controls</h3>
          {bankReported ? (
            <div className="bank-credit-review">
              <p role="status">Resident reported a UPI payment. The bill remains unpaid until bank credit is confirmed.</p>
              <p>Review the community receiving bank statement; amount and timestamp alone do not identify the payer.</p>
              <label>
                Bank transaction ID / UTR / RRN
                <input
                  aria-label="Bank credit transaction reference"
                  value={bankCreditReference}
                  maxLength={200}
                  onChange={(e) => setBankCreditReference(e.target.value)}
                  disabled={busy || verifySubmitting}
                  autoComplete="off"
                />
              </label>
              <label>
                Bank credit date
                <input
                  aria-label="Bank credit date"
                  type="date"
                  value={bankCreditDate}
                  onChange={(e) => setBankCreditDate(e.target.value)}
                  disabled={busy || verifySubmitting}
                />
              </label>
              {flexibleAmountProof ? (
                <label>
                  Amount credited (INR)
                  <input
                    aria-label="Bank amount credited in INR"
                    inputMode="decimal"
                    value={receivedAmount}
                    onChange={(e) => setReceivedAmount(e.target.value)}
                    disabled={busy || verifySubmitting}
                  />
                </label>
              ) : (
                <p>Required bank credit: {formatInrMinorUnits(claimedMinor)}</p>
              )}
              {amountMismatch && flexibleAmountProof && (
                <p role="status">Bank amount differs from resident claim. Settlement uses confirmed bank amount.</p>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={bankCreditAttested}
                  onChange={(e) => setBankCreditAttested(e.target.checked)}
                  disabled={busy || verifySubmitting}
                />
                I confirmed this exact transaction in the community bank and identified the correct resident.
              </label>
              <button
                type="button"
                className="primary"
                disabled={busy || verifySubmitting || !bankConfirmationReady}
                onClick={() => {
                  if (!bankConfirmationReady || confirmedBankAmount == null) return;
                  handleVerify(confirmedBankAmount, {
                    bankCreditReference: bankCreditReference.trim(),
                    bankCreditDate,
                    confirmedAmountMinor: confirmedBankAmount,
                  });
                }}
              >
                {verifySubmitting ? 'Verifying…' : 'Confirm bank credit and settle'}
              </button>
            </div>
          ) : flexibleAmountProof ? (
            <div className="flexible-payment-review">
              <label>
                Amount received (INR)
                <input
                  aria-label="Amount received in INR"
                  inputMode="decimal"
                  value={receivedAmount}
                  onChange={(event) => {
                    setReceivedAmount(event.target.value);
                    setAmountConfirmed(false);
                    setShowAmountConfirmation(false);
                  }}
                  placeholder="Enter amount from bank records"
                  disabled={busy || verifySubmitting}
                />
              </label>
              {receivedAmount && receivedMinor == null && (
                <p role="alert">Enter a positive INR amount with up to two decimal places.</p>
              )}
              {amountMismatch && (
                <p role="status">
                  Resident claimed {formatInrMinorUnits(claimedMinor)}; entered received amount is{' '}
                  {formatInrMinorUnits(receivedMinor)}. Settlement uses the amount you confirm.
                </p>
              )}
              {!showAmountConfirmation ? (
                <button
                  type="button"
                  className="primary"
                  onClick={() => setShowAmountConfirmation(true)}
                  disabled={busy || verifySubmitting || !receipt || receivedMinor == null}
                >
                  Review received amount
                </button>
              ) : (
                <div role="alertdialog" aria-label="Confirm received payment amount">
                  <p>Resident claim: {formatInrMinorUnits(claimedMinor)}</p>
                  <p>Amount received: {formatInrMinorUnits(receivedMinor)}</p>
                  {amountMismatch && (
                    <p role="alert">
                      The amounts differ. The confirmed amount will determine settlement.
                    </p>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      checked={amountConfirmed}
                      onChange={(event) => setAmountConfirmed(event.target.checked)}
                      disabled={busy || verifySubmitting}
                    />
                    I independently confirmed receipt against community bank records.
                  </label>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => handleVerify(receivedMinor ?? undefined)}
                    disabled={busy || verifySubmitting || !amountConfirmed || receivedMinor == null}
                  >
                    {verifySubmitting ? 'Verifying…' : 'Confirm and verify payment'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAmountConfirmation(false)}
                    disabled={busy || verifySubmitting}
                  >
                    Edit amount
                  </button>
                </div>
              )}
              {unsupportedAmountContract && (
                <p role="alert">Unsupported proof amount contract. Review is blocked.</p>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={() => handleVerify()}
              disabled={busy || verifySubmitting || !receipt || unsupportedAmountContract}
            >
              {verifySubmitting ? 'Verifying…' : 'Verify payment'}
            </button>
          )}
          <label>
            Rejection reason
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <button
            type="button"
            onClick={() => onReject(reason.trim())}
            disabled={!reason.trim() || busy || verifySubmitting}
          >
            Reject proof
          </button>
        </div>
      )}
      {!isV2 && canReview && isPending && !isAdminAttestedMethod && (
        <div className="payment-review-controls">
          <h3>Review controls</h3>
          <button
            type="button"
            className="primary"
            onClick={() => handleVerify()}
            disabled={busy || verifySubmitting}
          >
            {verifySubmitting ? 'Verifying…' : 'Verify payment'}
          </button>
          <label>
            Rejection reason
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <button
            type="button"
            onClick={() => onReject(reason.trim())}
            disabled={!reason.trim() || busy}
          >
            Reject proof
          </button>
        </div>
      )}
    </section>
  );
}
