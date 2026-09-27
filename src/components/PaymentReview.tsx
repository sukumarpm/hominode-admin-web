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
  return first(data, ['transactionId', 'billId'], paymentId);
}

export function paymentMethodLabel(value: unknown): string {
  const method = str(value).toLowerCase();
  if (method === 'upi') return 'UPI';
  if (method === 'external') return 'External';
  return formattedValue(value);
}

function providerLabel(value: unknown): string {
  if (str(value).toLowerCase() === 'direct_upi') return 'Direct UPI';
  return formattedValue(value);
}

export function PaymentReviewDetails({ data }: { data: Data }) {
  const paymentAmount =
    typeof data.amount === 'number' && Number.isFinite(data.amount)
      ? money(data.amount)
      : 'Not specified';
  const submitted = dateLabel(data.paymentDate ?? data.createdAt ?? data.submittedAt);
  const values: [string, string][] = [
    ['Amount', paymentAmount],
    ['Payment method', paymentMethodLabel(data.method)],
    ['Provider', providerLabel(data.provider)],
    ['Verification', formattedValue(data.verificationMode)],
    ['Evidence', formattedValue(data.evidenceType)],
    ['Transaction / Reference No.', str(data.transactionId) || 'Not provided'],
    ['Bill reference', str(data.billId) || 'Not specified'],
    ['Unit / flat reference', first(data, ['flatLabel', 'flatId']) || 'Not specified'],
    [
      'Resident reference',
      first(data, ['residentName', 'userName', 'residentId', 'userId']) || 'Not specified',
    ],
    ['Submitted', submitted === '—' ? 'Not specified' : submitted],
    ['Status', formattedValue(data.status)],
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
      {canReview && isPending && (
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
