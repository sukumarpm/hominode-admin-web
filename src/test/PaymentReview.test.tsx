import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PaymentReviewSection, paymentReference } from '../components/PaymentReview';
import { hasValidV2PaymentProof, isV2PaymentProof, type Data } from '../models';

const noop = vi.fn();

function review(data: Data, canReview = true, paymentId?: string) {
  return render(
    <PaymentReviewSection
      data={data}
      paymentId={paymentId}
      canReview={canReview}
      busy={false}
      receipt=""
      onViewReceipt={noop}
      onVerify={noop}
      onReject={noop}
    />,
  );
}

const v2Proof = (overrides: Data = {}): Data => ({
  schemaVersion: 2,
  currency: 'INR',
  submittedAmountMinor: 123456,
  communityId: 'community-1',
  billId: 'bill-15',
  residentId: 'resident-8',
  userId: 'resident-8',
  id: 'proof-1',
  method: 'upi',
  provider: 'direct_upi',
  verificationMode: 'manual',
  evidenceType: 'receipt',
  status: 'pending',
  receiptPath: 'payment_receipts/community-1/bill-15/proof-1.jpg',
  paymentReference: 'UTR-938401',
  submittedAt: new Date('2026-09-02T12:00:00Z'),
  ...overrides,
});

it('detects only exact numeric V2 proof schema and validates the displayed proof scope', () => {
  expect(isV2PaymentProof(v2Proof())).toBe(true);
  expect(isV2PaymentProof(v2Proof({ schemaVersion: '2' }))).toBe(false);
  expect(hasValidV2PaymentProof(v2Proof(), 'proof-1')).toBe(true);
  expect(hasValidV2PaymentProof(v2Proof(), 'different-document')).toBe(false);
  expect(hasValidV2PaymentProof(v2Proof({ userId: 'someone-else' }), 'proof-1')).toBe(false);
  expect(hasValidV2PaymentProof(v2Proof({ currency: 'USD' }), 'proof-1')).toBe(false);
  expect(hasValidV2PaymentProof(v2Proof({ receiptPath: '' }), 'proof-1')).toBe(false);
});

it('shows valid V2 proof details using minor amount and V2 metadata only', () => {
  review(v2Proof({ amount: 1.23 }), true, 'proof-1');

  expect(screen.getByText('Submitted amount')).toBeInTheDocument();
  expect(screen.getByText('₹1,234.56')).toBeInTheDocument();
  expect(screen.getByText('UPI')).toBeInTheDocument();
  expect(screen.getByText('Direct UPI')).toBeInTheDocument();
  expect(screen.getByText('Manual')).toBeInTheDocument();
  expect(screen.getByText('Receipt')).toBeInTheDocument();
  expect(screen.getByText('UTR-938401')).toBeInTheDocument();
  expect(screen.getByText('bill-15')).toBeInTheDocument();
  expect(screen.getByText('resident-8')).toBeInTheDocument();
  expect(screen.getByText(/Sep 2, 2026/)).toBeInTheDocument();
  expect(screen.getByText('Pending')).toBeInTheDocument();
  expect(screen.queryByText('₹1.23')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'View receipt' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Verify payment' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Reject proof' })).toBeDisabled();
});

it('enables V2 Verify only after receipt is loaded in the current detail session', () => {
  const onViewReceipt = vi.fn();
  const onVerify = vi.fn();
  const props = {
    data: v2Proof(),
    paymentId: 'proof-1',
    canReview: true,
    busy: false,
    onViewReceipt,
    onVerify,
    onReject: vi.fn(),
  };
  const view = render(<PaymentReviewSection {...props} receipt="" />);
  expect(screen.getByRole('button', { name: 'Verify payment' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'View receipt' }));
  expect(onViewReceipt).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Verify payment' })).toBeDisabled();

  view.rerender(<PaymentReviewSection {...props} receipt="blob:loaded-receipt" />);
  expect(screen.getByRole('button', { name: 'Verify payment' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Verify payment' }));
  expect(onVerify).toHaveBeenCalledOnce();
});

it('requires a trimmed reason before V2 Reject and passes the trimmed reason', () => {
  const onReject = vi.fn();
  render(
    <PaymentReviewSection
      data={v2Proof()}
      paymentId="proof-1"
      canReview
      busy={false}
      receipt=""
      onViewReceipt={noop}
      onVerify={noop}
      onReject={onReject}
    />,
  );
  fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: '   ' } });
  expect(screen.getByRole('button', { name: 'Reject proof' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Rejection reason'), {
    target: { value: '  Receipt unreadable  ' },
  });
  expect(screen.getByRole('button', { name: 'Reject proof' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reject proof' }));
  expect(onReject).toHaveBeenCalledWith('Receipt unreadable');
});

it('shows no V2 review controls to non-admins or for failed proofs', () => {
  const { rerender } = render(
    <PaymentReviewSection
      data={v2Proof()}
      paymentId="proof-1"
      canReview={false}
      busy={false}
      receipt=""
      onViewReceipt={noop}
      onVerify={noop}
      onReject={noop}
    />,
  );
  expect(screen.queryByRole('button', { name: 'View receipt' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Verify payment' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reject proof' })).not.toBeInTheDocument();

  rerender(
    <PaymentReviewSection
      data={v2Proof({ status: 'failed' })}
      paymentId="proof-1"
      canReview
      busy={false}
      receipt=""
      onViewReceipt={noop}
      onVerify={noop}
      onReject={noop}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Verify payment' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reject proof' })).not.toBeInTheDocument();
});

it('keeps completed V2 wording specific to the proof, with no review controls', () => {
  review(v2Proof({ status: 'completed' }), true, 'proof-1');

  expect(screen.getByText('This payment proof is completed.')).toBeInTheDocument();
  expect(screen.getByText('Completed')).toBeInTheDocument();
  expect(screen.queryByText(/bill (is )?fully paid|bill settled/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Verify payment' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reject proof' })).not.toBeInTheDocument();
});

it('fails closed for malformed exact V2 without V1 financial or review fallback', () => {
  review(v2Proof({ currency: 'USD', amount: 999 }), true, 'proof-1');

  expect(screen.getByText('V2 payment proof unavailable')).toBeInTheDocument();
  expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'View receipt' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Verify payment' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reject proof' })).not.toBeInTheDocument();
});

it('displays Direct UPI proof metadata and the trimmed transaction reference', () => {
  review({
    amount: 125.5,
    method: 'upi',
    provider: 'direct_upi',
    verificationMode: 'manual',
    evidenceType: 'receipt',
    transactionId: '  UTR 938401  ',
    billId: 'bill-15',
    flatId: 'flat-4',
    userId: 'resident-8',
    paymentDate: new Date('2026-01-02T03:04:05Z'),
    status: 'pending',
  });

  expect(screen.getByText('UPI')).toBeInTheDocument();
  expect(screen.getByText('Direct UPI')).toBeInTheDocument();
  expect(screen.getByText('Manual')).toBeInTheDocument();
  expect(screen.getByText('Receipt')).toBeInTheDocument();
  expect(screen.getByText('UTR 938401')).toBeInTheDocument();
  expect(screen.getByText('₹125.50')).toBeInTheDocument();
  expect(screen.getByText('bill-15')).toBeInTheDocument();
  expect(screen.getByText('flat-4')).toBeInTheDocument();
  expect(screen.getByText('resident-8')).toBeInTheDocument();
  expect(screen.getByText('Pending')).toBeInTheDocument();
});

it.each([null, '', '   '])(
  'shows Not provided for an empty transaction reference (%s)',
  (value) => {
    review({ method: 'external', transactionId: value });
    expect(screen.getByText('Not provided')).toBeInTheDocument();
  },
);

it('renders legacy external proof without inventing Direct UPI metadata', () => {
  review({
    amount: 70,
    method: 'external',
    status: 'completed',
    transactionId: null,
    receiptPath: 'payment_receipts/community-1/bill-1/payment-1.jpg',
    billId: 'bill-1',
    flatId: 'flat-1',
    userId: 'resident-1',
  });

  expect(screen.getByText('External')).toBeInTheDocument();
  expect(screen.getAllByText('Not specified')).toHaveLength(4);
  expect(screen.queryByText('Direct UPI')).not.toBeInTheDocument();
  expect(screen.queryByText('Manual')).not.toBeInTheDocument();
  expect(screen.queryByText('Receipt', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText(/payment_receipts\//)).not.toBeInTheDocument();
});

it('shows Verify and Reject only for pending proofs, with receipt viewing when a path exists', () => {
  const { rerender } = review({
    status: 'pending',
    method: 'upi',
    provider: 'direct_upi',
    receiptPath: 'receipt/path.jpg',
  });
  expect(screen.getByRole('button', { name: 'Verify payment' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reject proof' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: 'Unreadable' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reject proof' }));
  expect(noop).toHaveBeenCalledWith('Unreadable');
  fireEvent.click(screen.getByRole('button', { name: 'View receipt' }));
  expect(noop).toHaveBeenCalled();

  for (const status of ['completed', 'failed']) {
    rerender(
      <PaymentReviewSection
        data={{ status, receiptPath: 'receipt/path.jpg' }}
        canReview
        busy={false}
        receipt=""
        onViewReceipt={noop}
        onVerify={noop}
        onReject={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Verify payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject proof' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View receipt' })).toBeInTheDocument();
  }
});

it('shows Admin-attested cash completion without proof controls or invented provider data', () => {
  review({
    amount: 1250,
    method: 'cash',
    status: 'completed',
    evidenceType: 'admin_attestation',
    billId: 'bill-22',
    flatId: 'flat-3',
    residentId: 'resident-4',
    paymentReference: 'CASH-204',
    recordedAt: new Date('2026-09-02T12:00:00Z'),
    settledBy: 'admin-private-uid',
  });

  expect(screen.getByText('Cash')).toBeInTheDocument();
  expect(screen.getByText('Completed')).toBeInTheDocument();
  expect(screen.getByText('Admin attestation')).toBeInTheDocument();
  expect(screen.getByText('CASH-204')).toBeInTheDocument();
  expect(screen.getByText('Recorded by Admin')).toBeInTheDocument();
  expect(screen.getByText('Recorded')).toBeInTheDocument();
  expect(screen.queryByText('Not specified')).not.toBeInTheDocument();
  expect(screen.queryByText('admin-private-uid')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'View receipt' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Verify payment' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reject proof' })).not.toBeInTheDocument();
});

it('never offers proof-review controls for cash payments', () => {
  review({ method: 'cash', status: 'pending' });
  expect(screen.queryByRole('button', { name: 'Verify payment' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reject proof' })).not.toBeInTheDocument();
});

it('shows completed UPI as Verified by Admin and keeps legacy methods readable', () => {
  const { rerender } = review({ method: 'upi', status: 'completed' });
  expect(screen.getByText('Verified by Admin')).toBeInTheDocument();

  rerender(
    <PaymentReviewSection
      data={{ method: 'manual', status: 'completed' }}
      canReview
      busy={false}
      receipt=""
      onViewReceipt={noop}
      onVerify={noop}
      onReject={noop}
    />,
  );
  expect(screen.getByText('Manual')).toBeInTheDocument();
  expect(screen.getByText('Recorded by Admin')).toBeInTheDocument();

  rerender(
    <PaymentReviewSection
      data={{ method: 'external', status: 'completed' }}
      canReview
      busy={false}
      receipt=""
      onViewReceipt={noop}
      onVerify={noop}
      onReject={noop}
    />,
  );
  expect(screen.getByText('External')).toBeInTheDocument();
});

it('uses transaction id, bill id, then document id as the payment list reference', () => {
  expect(paymentReference({ transactionId: '  UTR-1  ', billId: 'bill-1' }, 'payment-1')).toBe(
    'UTR-1',
  );
  expect(paymentReference({ transactionId: null, billId: 'bill-1' }, 'payment-1')).toBe('bill-1');
  expect(paymentReference({ transactionId: null, paymentReference: 'cash-ref' }, 'payment-1')).toBe(
    'cash-ref',
  );
  expect(paymentReference({ transactionId: '', billId: null }, 'payment-1')).toBe('payment-1');
});
