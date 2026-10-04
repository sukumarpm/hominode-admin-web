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
      return <p role="status">V2 payment proof unavailable</p>;
    }
    const paymentValues: [string, string][] = [
      ['Payment method', 'UPI'],
      ['Provider', 'Direct UPI'],
      ['Verification', 'Manual'],
      ['Evidence', 'Receipt'],
      ['Submitted', dateLabel(data.submittedAt) === '—' ? 'Not specified' : dateLabel(data.submittedAt)],
    ];
    const identifierValues: [string, string][] = [
      ...(paymentId ? ([['Payment / Proof ID', paymentId]] as [string, string][]) : []),
      ['Payment reference', str(data.paymentReference) || 'Not provided'],
      ['Bill reference', str(data.billId)],
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
  onVerify: () => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const isV2 = isV2PaymentProof(data);
  const validV2 = isV2 && hasValidV2PaymentProof(data, paymentId);
  const isPending = str(data.status) === 'pending';
  const paymentMethod = str(data.method ?? data.paymentMethod).toLowerCase();
  const isAdminAttestedMethod = ['cash', 'bank_transfer', 'cheque', 'manual'].includes(
    paymentMethod,
  );
  const hasReceipt = !!str(data.receiptPath) && (!isV2 || validV2);
  const showReceiptButton = hasReceipt && (!isV2 || canReview);

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
          <button
            type="button"
            className="primary"
            onClick={onVerify}
            disabled={busy || !receipt}
          >
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
      {!isV2 && canReview && isPending && !isAdminAttestedMethod && (
        <div className="payment-review-controls">
          <h3>Review controls</h3>
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
