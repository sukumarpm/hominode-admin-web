import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { type Session } from '../models';
import { RecordPaymentPanel } from '../components/RecordPaymentPanel';
import { makeSession } from './fixtures';

const admin = makeSession('admin');
const unsettledBill = {
  id: 'bill-1',
  data: {
    communityId: 'community-1',
    status: 'pending',
    residentName: 'Test Resident',
    flatLabel: 'Tower A · 1203',
    amount: 1250.5,
  },
};

function panel(
  bill: typeof unsettledBill = unsettledBill,
  submitPayment = vi.fn(
    async (
      _session: Session,
      _input: {
        billId: string;
        paymentMethod: 'cash' | 'bank_transfer' | 'cheque';
        paymentReference: string;
      },
    ) => {
      void _session;
      void _input;
    },
  ),
) {
  const onRecorded = vi.fn();
  render(
    <RecordPaymentPanel
      session={admin}
      bill={bill}
      submitPayment={submitPayment}
      onRecorded={onRecorded}
    />,
  );
  return { onRecorded, submitPayment };
}

it('offers Record Payment only for unsettled pending or overdue bills', () => {
  const settled = [
    { ...unsettledBill, data: { ...unsettledBill.data, status: 'paid' } },
    { ...unsettledBill, data: { ...unsettledBill.data, paymentId: 'payment-1' } },
    { ...unsettledBill, data: { ...unsettledBill.data, paidAt: new Date() } },
    { ...unsettledBill, data: { ...unsettledBill.data, paidAmount: 1250 } },
  ];
  for (const bill of settled) {
    const view = render(<RecordPaymentPanel session={admin} bill={bill} onRecorded={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Record Payment' })).not.toBeInTheDocument();
    view.unmount();
  }

  panel({ ...unsettledBill, data: { ...unsettledBill.data, status: 'overdue' } });
  expect(screen.getByRole('button', { name: 'Record Payment' })).toBeInTheDocument();
});

it('shows the authoritative bill amount read-only and offers only offline methods', () => {
  panel();
  fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));

  expect(screen.getByText('Test Resident')).toBeInTheDocument();
  expect(screen.getByText('Tower A · 1203')).toBeInTheDocument();
  expect(screen.getByText('bill-1')).toBeInTheDocument();
  expect(screen.getByLabelText('Bill amount')).toHaveTextContent('₹1,250.50');
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
    'Cash',
    'Bank Transfer',
    'Cheque',
  ]);
  expect(screen.queryByRole('option', { name: /manual|upi|other/i })).not.toBeInTheDocument();
});

it('trims reference, caps it at 200 characters, and sends no client amount', async () => {
  const { submitPayment, onRecorded } = panel();
  fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));

  const reference = screen.getByLabelText('Reference / receipt number (optional)');
  expect(reference).toHaveAttribute('maxLength', '200');
  fireEvent.change(reference, { target: { value: '  CASH-204  ' } });
  fireEvent.change(screen.getByLabelText('Payment method'), {
    target: { value: 'bank_transfer' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'Confirm Bank Transfer Received' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Confirm Bank Transfer Received' }));
  expect(submitPayment).toHaveBeenCalledWith(admin, {
    billId: 'bill-1',
    paymentMethod: 'bank_transfer',
    paymentReference: 'CASH-204',
  });
  expect(submitPayment.mock.calls[0][1]).not.toHaveProperty('amount');
  expect(
    await screen.findByText('Bank Transfer payment recorded successfully.'),
  ).toBeInTheDocument();
  expect(onRecorded).toHaveBeenCalledOnce();
});

it('keeps the bill unsettled in the UI and reports server failure safely', async () => {
  const submitPayment = vi.fn(
    async (
      _session: Session,
      _input: {
        billId: string;
        paymentMethod: 'cash' | 'bank_transfer' | 'cheque';
        paymentReference: string;
      },
    ) => {
      void _session;
      void _input;
      throw Error('Payment could not be recorded. Refresh the bill and try again.');
    },
  );
  panel(unsettledBill, submitPayment);
  fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Cash Received' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Payment could not be recorded. Refresh the bill and try again.',
  );
  expect(screen.getByRole('button', { name: 'Confirm Cash Received' })).toBeInTheDocument();
});
