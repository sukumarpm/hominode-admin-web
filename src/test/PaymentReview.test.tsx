import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PaymentReviewSection, paymentReference } from '../components/PaymentReview';
import { type Data } from '../models';

const noop = vi.fn();

function review(data: Data, canReview = true) {
  return render(
    <PaymentReviewSection
      data={data}
      canReview={canReview}
      busy={false}
      receipt=""
      onViewReceipt={noop}
      onVerify={noop}
      onReject={noop}
    />,
  );
}

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
  const { rerender } = review({ status: 'pending', receiptPath: 'receipt/path.jpg' });
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

it('uses transaction id, bill id, then document id as the payment list reference', () => {
  expect(paymentReference({ transactionId: '  UTR-1  ', billId: 'bill-1' }, 'payment-1')).toBe(
    'UTR-1',
  );
  expect(paymentReference({ transactionId: null, billId: 'bill-1' }, 'payment-1')).toBe('bill-1');
  expect(paymentReference({ transactionId: '', billId: null }, 'payment-1')).toBe('payment-1');
});
