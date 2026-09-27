import { dateLabel, first, money, str, type Data } from '../models';
import { useState } from 'react';

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

function providerLabel(value: unknown, isAdminAttestation: boolean): string {
  if (str(value).toLowerCase() === 'direct_upi') return 'Direct UPI';
  if (!str(value) && isAdminAttestation) return '';
  return formattedValue(value);
}

export function PaymentReviewDetails({ data }: { data: Data }) {
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
  const values: [string, string][] = [
    ['Amount', paymentAmount],
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
      'Transaction / Reference No.',
      str(data.transactionId) || str(data.paymentReference) || 'Not provided',
    ],
    ['Bill reference', str(data.billId) || 'Not specified'],
    ['Unit / flat reference', first(data, ['flatLabel', 'flatId']) || 'Not specified'],
    [
      'Resident reference',
      first(data, ['residentName', 'userName', 'residentId', 'userId']) || 'Not specified',
    ],
    [
      isAdminAttestation ? 'Recorded' : 'Submitted',
      submitted === '—' ? 'Not specified' : submitted,
    ],
    ['Status', formattedValue(data.status)],
    ...(str(data.status).toLowerCase() === 'completed' && paymentAttributionLabel(method)
      ? ([['Settlement attribution', paymentAttributionLabel(method)]] as [string, string][])
      : []),
  ];

  return (
    <dl className="detail-fields payment-review-fields">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PaymentReviewSection({
  data,
  canReview,
  busy,
  receipt,
  onViewReceipt,
  onVerify,
  onReject,
}: {
  data: Data;
  canReview: boolean;
  busy: boolean;
  receipt: string;
  onViewReceipt: () => void;
  onVerify: () => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const isPending = str(data.status) === 'pending';
  const paymentMethod = str(data.method ?? data.paymentMethod).toLowerCase();
  const isAdminAttestedMethod = ['cash', 'bank_transfer', 'cheque', 'manual'].includes(
    paymentMethod,
  );
  const hasReceipt = !!str(data.receiptPath);

  return (
    <section className="payment-review-section" aria-label="Payment review">
      <PaymentReviewDetails data={data} />
      {hasReceipt && (
        <button type="button" onClick={onViewReceipt} disabled={busy}>
          View receipt
        </button>
      )}
      {receipt && <img className="receipt-image" src={receipt} alt="Payment receipt" />}
      {canReview && isPending && !isAdminAttestedMethod && (
        <div className="payment-review-controls">
          <button type="button" className="primary" onClick={onVerify} disabled={busy}>
            Verify payment
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
