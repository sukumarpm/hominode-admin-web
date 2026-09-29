import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Row, Session } from '../models';
import {
  createOfflinePaymentAttemptV2,
  loadOfflinePaymentAttemptV2,
  saveOfflinePaymentAttemptV2,
  type OfflinePaymentAttemptV2,
  type OfflinePaymentResultV2,
} from '../offlinePaymentV2';
import { RecordOfflinePaymentV2Panel } from '../components/RecordOfflinePaymentV2Panel';
import { makeSession } from './fixtures';

const admin = makeSession('admin');
const result: OfflinePaymentResultV2 = {
  success: true,
  transactionId: 'txn-42',
  allocations: [
    { billId: 'bill-oldest', amountMinor: 100000 },
    { billId: 'bill-next', amountMinor: 20050 },
  ],
  excessCreditMinor: 50,
  alreadyCompleted: false,
};

function bill(overrides: Record<string, unknown> = {}): Row {
  return {
    id: 'bill-selected',
    data: {
      schemaVersion: 2,
      currency: 'INR',
      amountMinor: 250000,
      paidAmountMinor: 100000,
      creditAppliedMinor: 30000,
      outstandingAmountMinor: 120000,
      currentRevisionId: 'revision-1',
      billingPeriod: '2026-09',
      status: 'pending',
      communityId: 'community-1',
      residentId: 'resident-1',
      residentName: 'Test Resident',
      flatId: 'unit-1',
      flatLabel: 'Tower A · 1203',
      ...overrides,
    },
  };
}

const baseAttempt: OfflinePaymentAttemptV2 = {
  communityId: 'community-1',
  residentId: 'resident-1',
  amountMinor: 120050,
  paymentMethod: 'bank_transfer',
  paymentReference: 'REF-42',
  idempotencyKey: 'offline_attempt-42',
};

function panel(
  options: {
    currentBill?: Row;
    session?: Session;
    proofsLoading?: boolean;
    proofsError?: string;
    hasPendingProof?: boolean;
    submitPayment?: (session: Session, attempt: OfflinePaymentAttemptV2) => Promise<OfflinePaymentResultV2>;
    onRecorded?: () => void;
    onClose?: () => void;
    createAttempt?: typeof createOfflinePaymentAttemptV2;
    loadAttempt?: typeof loadOfflinePaymentAttemptV2;
    saveAttempt?: typeof saveOfflinePaymentAttemptV2;
  } = {},
) {
  const submitPayment = options.submitPayment || vi.fn(async () => result);
  const onRecorded = options.onRecorded || vi.fn();
  const view = render(
    <RecordOfflinePaymentV2Panel
      session={options.session || admin}
      bill={options.currentBill || bill()}
      proofsLoading={options.proofsLoading || false}
      proofsError={options.proofsError || ''}
      hasPendingProof={options.hasPendingProof || false}
      onRecorded={onRecorded}
      onClose={options.onClose}
      createAttempt={options.createAttempt}
      loadAttempt={options.loadAttempt}
      saveAttempt={options.saveAttempt}
      submitPayment={submitPayment as typeof import('../actions').recordOfflinePaymentV2}
    />,
  );
  return { ...view, submitPayment, onRecorded };
}

afterEach(() => localStorage.clear());

describe('RecordOfflinePaymentV2Panel', () => {
  it('shows the action for a valid current V2 bill, including partial balances', async () => {
    const { rerender } = panel();
    expect(await screen.findByRole('button', { name: 'Record Offline Payment' })).toBeTruthy();
    rerender(
      <RecordOfflinePaymentV2Panel
        session={admin}
        bill={bill({ status: 'partially_paid' })}
        proofsLoading={false}
        proofsError=""
        hasPendingProof={false}
        onRecorded={vi.fn()}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Record Offline Payment' })).toBeTruthy();
  });

  it.each([
    ['zero outstanding', bill({ paidAmountMinor: 250000, creditAppliedMinor: 0, outstandingAmountMinor: 0, status: 'paid' })],
    ['malformed balance', bill({ outstandingAmountMinor: 999 })],
    ['non-INR currency', bill({ currency: 'USD' })],
    ['settled status', bill({ status: 'paid', outstandingAmountMinor: 120000 })],
  ])('does not offer an action for %s', async (_name, currentBill) => {
    panel({ currentBill });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Record Offline Payment' })).toBeNull());
  });

  it('does not show an action to a non-admin', () => {
    panel({ session: makeSession('resident') });
    expect(screen.queryByRole('button', { name: 'Record Offline Payment' })).toBeNull();
  });

  it('fails closed while proof subscription loads, errors, or has a pending exact proof', () => {
    const view = panel({ proofsLoading: true });
    expect(screen.getByText(/payment proof status is being checked/i)).toBeTruthy();
    view.rerender(
      <RecordOfflinePaymentV2Panel session={admin} bill={bill()} proofsLoading={false} proofsError="permission denied" hasPendingProof={false} onRecorded={vi.fn()} />,
    );
    expect(screen.getByText(/payment proof status is being checked/i)).toBeTruthy();
    view.rerender(
      <RecordOfflinePaymentV2Panel session={admin} bill={bill()} proofsLoading={false} proofsError="" hasPendingProof onRecorded={vi.fn()} />,
    );
    expect(screen.getByText(/a payment proof is pending/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record Offline Payment' })).toBeNull();
  });

  it.each(['failed', 'completed'])('allows an eligible bill when its proof is %s, not pending', async (_status) => {
    panel({ hasPendingProof: false });
    expect(await screen.findByRole('button', { name: 'Record Offline Payment' })).toBeTruthy();
  });

  it('shows selected-bill outstanding as context and oldest-first allocation warning', async () => {
    panel();
    fireEvent.click(await screen.findByRole('button', { name: 'Record Offline Payment' }));
    expect(screen.getByText('Test Resident')).toBeTruthy();
    expect(screen.getByText('Tower A · 1203')).toBeTruthy();
    expect(screen.getByText('bill-selected')).toBeTruthy();
    expect(screen.getByText('Selected bill outstanding (context only)')).toBeTruthy();
    expect(screen.getByText('₹1,200.00')).toBeTruthy();
    expect(screen.getByText(/oldest eligible outstanding bills first/i)).toBeTruthy();
  });

  it('offers only the offline methods and limits optional reference to 200 characters', async () => {
    panel();
    fireEvent.click(await screen.findByRole('button', { name: 'Record Offline Payment' }));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Cash',
      'Bank Transfer',
      'Cheque',
    ]);
    expect(screen.getByLabelText('Reference / receipt number (optional)')).toHaveAttribute('maxLength', '200');
  });

  it('parses amount to integer minor units and persists before submitting without a billId', async () => {
    const submitPayment = vi.fn(async (_session: Session, attempt: OfflinePaymentAttemptV2) => {
      expect(loadOfflinePaymentAttemptV2('community-1', 'resident-1')).toEqual(attempt);
      return result;
    });
    const { onRecorded } = panel({ submitPayment });
    fireEvent.click(await screen.findByRole('button', { name: 'Record Offline Payment' }));
    fireEvent.change(screen.getByLabelText('Payment amount (₹)'), { target: { value: '1200.5' } });
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'cheque' } });
    fireEvent.change(screen.getByLabelText('Reference / receipt number (optional)'), {
      target: { value: ' REF-7 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Offline Payment' }));
    await waitFor(() => expect(submitPayment).toHaveBeenCalledOnce());
    expect(submitPayment).toHaveBeenCalledWith(admin, expect.objectContaining({
      communityId: 'community-1',
      residentId: 'resident-1',
      amountMinor: 120050,
      paymentMethod: 'cheque',
      paymentReference: 'REF-7',
      idempotencyKey: expect.stringMatching(/^[A-Za-z0-9_-]{1,128}$/),
    }));
    expect(submitPayment.mock.calls[0][1]).not.toHaveProperty('billId');
    expect(onRecorded).toHaveBeenCalledOnce();
  });

  it('does not create or submit an attempt for invalid amount input', async () => {
    const createAttempt = vi.fn(createOfflinePaymentAttemptV2);
    const saveAttempt = vi.fn(saveOfflinePaymentAttemptV2);
    const { submitPayment } = panel({ createAttempt, saveAttempt });
    fireEvent.click(await screen.findByRole('button', { name: 'Record Offline Payment' }));
    fireEvent.change(screen.getByLabelText('Payment amount (₹)'), { target: { value: '1,200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Offline Payment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('valid payment amount');
    expect(createAttempt).not.toHaveBeenCalled();
    expect(saveAttempt).not.toHaveBeenCalled();
    expect(submitPayment).not.toHaveBeenCalled();
  });

  it('allows Cancel before persistence without saving or submitting', async () => {
    const createAttempt = vi.fn(createOfflinePaymentAttemptV2);
    const saveAttempt = vi.fn(saveOfflinePaymentAttemptV2);
    const { submitPayment } = panel({ createAttempt, saveAttempt });
    fireEvent.click(await screen.findByRole('button', { name: 'Record Offline Payment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(localStorage.length).toBe(0);
    expect(createAttempt).not.toHaveBeenCalled();
    expect(saveAttempt).not.toHaveBeenCalled();
    expect(submitPayment).not.toHaveBeenCalled();
  });

  it('does not submit when attempt persistence fails', async () => {
    const saveAttempt = vi.fn(() => { throw Error('storage unavailable'); });
    const { submitPayment } = panel({ saveAttempt });
    fireEvent.click(await screen.findByRole('button', { name: 'Record Offline Payment' }));
    fireEvent.change(screen.getByLabelText('Payment amount (₹)'), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Offline Payment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No payment was submitted');
    expect(submitPayment).not.toHaveBeenCalled();
  });

  it('fails closed when saved-attempt recovery cannot read persisted state', async () => {
    panel({ loadAttempt: () => { throw Error('malformed storage'); } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A saved offline payment attempt could not be read safely',
    );
    expect(screen.queryByRole('button', { name: 'Record Offline Payment' })).toBeNull();
  });

  it('recovers the exact saved attempt, displays terms, retries it, and Close preserves it', async () => {
    saveOfflinePaymentAttemptV2(baseAttempt);
    const submitPayment = vi.fn(async () => result);
    const onClose = vi.fn();
    panel({ submitPayment, onClose });
    expect(await screen.findByText('Unresolved Offline Payment')).toBeTruthy();
    expect(screen.getByText('₹1,200.50')).toBeTruthy();
    expect(screen.getByText('Bank Transfer')).toBeTruthy();
    expect(screen.getByText('REF-42')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(loadOfflinePaymentAttemptV2('community-1', 'resident-1')).toEqual(baseAttempt);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Saved Payment' }));
    await waitFor(() => expect(submitPayment).toHaveBeenCalledOnce());
    expect(submitPayment).toHaveBeenCalledWith(admin, baseAttempt);
  });

  it('preserves an unresolved attempt after ambiguous failure and provides only retry/close', async () => {
    saveOfflinePaymentAttemptV2(baseAttempt);
    const submitPayment = vi.fn(async () => { throw Error('network timeout'); });
    panel({ submitPayment });
    fireEvent.click(await screen.findByRole('button', { name: 'Retry Saved Payment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The payment result is unresolved');
    expect(screen.getByRole('alert')).not.toHaveTextContent(/payment definitely failed/i);
    expect(loadOfflinePaymentAttemptV2('community-1', 'resident-1')).toEqual(baseAttempt);
    expect(screen.getByRole('button', { name: 'Retry Saved Payment' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record Offline Payment' })).toBeNull();
    expect(screen.queryByRole('button', { name: /discard|cancel payment|start over|new payment/i })).toBeNull();
  });

  it('shows confirmed transaction, usable allocations, amount, method and excess credit', async () => {
    const submitPayment = vi.fn(async () => result);
    panel({ submitPayment });
    fireEvent.click(await screen.findByRole('button', { name: 'Record Offline Payment' }));
    fireEvent.change(screen.getByLabelText('Payment amount (₹)'), { target: { value: '1200.50' } });
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'cheque' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Offline Payment' }));
    expect(await screen.findByText('txn-42')).toBeTruthy();
    expect(screen.getByText('Recorded amount')).toBeTruthy();
    expect(screen.getByText('Bill bill-oldest')).toBeTruthy();
    expect(screen.getByText('Bill bill-next')).toBeTruthy();
    expect(screen.getByText('Excess resident credit')).toBeTruthy();
    expect(screen.getByText('Allocations')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('₹0.50')).toBeTruthy();
    expect(screen.getByText('Cheque')).toBeTruthy();
  });

  it('uses safe recovery wording for alreadyCompleted success and refreshes billing', async () => {
    const onRecorded = vi.fn();
    const submitPayment = vi.fn(async () => ({ ...result, alreadyCompleted: true }));
    panel({ submitPayment, onRecorded });
    fireEvent.click(await screen.findByRole('button', { name: 'Record Offline Payment' }));
    fireEvent.change(screen.getByLabelText('Payment amount (₹)'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Offline Payment' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/previously submitted payment was already completed/i);
    expect(screen.queryByText(/second|new payment|bill paid|bill settled|fully paid/i)).toBeNull();
    expect(onRecorded).toHaveBeenCalledOnce();
  });

  it('contains no direct financial ledger write calls', () => {
    const source = readFileSync('src/components/RecordOfflinePaymentV2Panel.tsx', 'utf8');
    expect(source).not.toMatch(
      /paymentTransactions|paymentAllocations|residentCreditEntries|residentFinancialAccounts|paymentSettlementsV2|\b(addDoc|setDoc|updateDoc)\s*\(/,
    );
  });
});
