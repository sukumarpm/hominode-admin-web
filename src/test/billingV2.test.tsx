import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  createRecurringBillingScheduleV2,
  normalizeRecurringBillingScheduleRequest,
  parseRecurringAmountInrToMinorUnits,
} from '../actions';
import {
  useAdminV2PaymentProofs,
  useAdminV2RecurringSchedules,
  useRows,
  type Module,
  type Resource,
} from '../data';
import {
  classifyV2Bill,
  formatInrMinorUnits,
  hasValidV2RecurringSchedule,
  hasValidV2BillFinancials,
  isV2Bill,
  money,
  nextRecurringBillingPeriod,
  recurringScheduleTotalMinor,
  type Data,
  type Row,
} from '../models';
import { ModulePage, V2BillFinancialSummary } from '../pages';
import {
  CreateRecurringScheduleModal,
  recurringScheduleAttemptStorageKey,
} from '../components/CreateRecurringScheduleModal';
import { AuthContext } from '../session';
import { makeSession } from './fixtures';

vi.mock('../firebase', () => ({
  call: vi.fn(),
  firebase: vi.fn(() => {
    throw Error('No live Firebase in UI tests');
  }),
}));
vi.mock('../data', async () => ({
  ...(await vi.importActual<typeof import('../data')>('../data')),
  useRows: vi.fn(),
  useAdminV2PaymentProofs: vi.fn(),
  useAdminV2RecurringSchedules: vi.fn(),
}));
vi.mock('../subscriptionContext', () => ({
  useSubscription: () => ({ entitlement: null, loading: false, error: '' }),
  SubscriptionProvider: ({ children }: { children: ReactNode }) => children,
}));

const v2Bill: Data = {
  schemaVersion: 2,
  currency: 'INR',
  amountMinor: 250000,
  paidAmountMinor: 100000,
  creditAppliedMinor: 30000,
  outstandingAmountMinor: 120000,
  currentRevisionId: 'revision-1',
  billingPeriod: '2026-09',
  chargeLines: [{ label: 'Maintenance', amountMinor: 250000 }],
  status: 'partially_paid',
  title: 'September maintenance',
  communityId: 'community-1',
  residentId: 'resident-1',
  residentName: 'Test Resident',
  flatId: 'unit-1',
  flatLabel: 'Tower A · 1203',
};

function validV2(overrides: Partial<Data> = {}): Data {
  return { ...v2Bill, ...overrides };
}

function row(data: Data, id = 'bill-1'): Row {
  return { id, data };
}

function renderBilling(
  rows: Row[],
  proofRows: Row[] = [],
  proofState: Partial<Resource> = {},
  session = makeSession('admin'),
  scheduleState: Partial<Resource> = {},
  moduleRows: Partial<Record<Module, Row[]>> = {},
) {
  vi.mocked(useRows).mockImplementation((_session, module: Module): Resource => ({
    rows: moduleRows[module] ?? (module === 'billing' ? rows : []),
    loading: false,
    error: '',
  }));
  vi.mocked(useAdminV2PaymentProofs).mockReturnValue({
    rows: proofRows,
    loading: false,
    error: '',
    ...proofState,
  });
  vi.mocked(useAdminV2RecurringSchedules).mockReturnValue({
    rows: [],
    loading: false,
    error: '',
    ...scheduleState,
  });
  return render(
    <MemoryRouter>
      <AuthContext
        value={{
          session,
          loading: false,
          error: '',
          authenticated: true,
          signOut: vi.fn(),
          switchCommunity: vi.fn(),
        }}
      >
        <ModulePage module="billing" />
      </AuthContext>
    </MemoryRouter>,
  );
}

function renderPayments(v1Rows: Row[], v2Rows: Row[]) {
  const session = makeSession('admin');
  vi.mocked(useRows).mockImplementation((_session, module: Module): Resource => ({
    rows: module === 'payments' ? v1Rows : [],
    loading: false,
    error: '',
  }));
  vi.mocked(useAdminV2PaymentProofs).mockReturnValue({
    rows: v2Rows,
    loading: false,
    error: '',
  });
  return render(
    <MemoryRouter>
      <AuthContext
        value={{
          session,
          loading: false,
          error: '',
          authenticated: true,
          signOut: vi.fn(),
          switchCommunity: vi.fn(),
        }}
      >
        <ModulePage module="payments" />
      </AuthContext>
    </MemoryRouter>,
  );
}

function mockRows(moduleRows: Partial<Record<Module, Row[]>> = {}) {
  vi.mocked(useRows).mockImplementation((_session, module: Module): Resource => ({
    rows: moduleRows[module] ?? [],
    loading: false,
    error: '',
  }));
}

describe('Admin Web Billing V2 bill foundation', () => {
  it('detects only numeric schemaVersion 2', () => {
    expect(isV2Bill(validV2())).toBe(true);
    expect(isV2Bill({ ...validV2(), schemaVersion: '2' })).toBe(false);
  });

  it('validates INR projection equality, revision, and safe integer bounds', () => {
    expect(hasValidV2BillFinancials(validV2())).toBe(true);
    expect(hasValidV2BillFinancials(validV2({ outstandingAmountMinor: 120001 }))).toBe(false);
    expect(hasValidV2BillFinancials(validV2({ currency: 'USD' }))).toBe(false);
    expect(hasValidV2BillFinancials(validV2({ amountMinor: Number.MAX_SAFE_INTEGER + 1 }))).toBe(
      false,
    );
    expect(hasValidV2BillFinancials(validV2({ currentRevisionId: '  ' }))).toBe(false);
  });

  it('formats safe paise values through integer rupees and paise', () => {
    expect(formatInrMinorUnits(0)).toBe('₹0.00');
    expect(formatInrMinorUnits(1)).toBe('₹0.01');
    expect(formatInrMinorUnits(120050)).toBe('₹1,200.50');
    expect(formatInrMinorUnits(123456789)).toBe('₹12,34,567.89');
    expect(formatInrMinorUnits(-1)).toBe('—');
    expect(formatInrMinorUnits(Number.MAX_SAFE_INTEGER + 1)).toBe('—');
  });

  it('classifies partial liability as current and zero outstanding as history', () => {
    expect(classifyV2Bill(validV2())).toBe('current');
    expect(classifyV2Bill(validV2({ status: 'overdue' }))).toBe('current');
    expect(
      classifyV2Bill(
        validV2({
          status: 'paid',
          paidAmountMinor: 250000,
          creditAppliedMinor: 0,
          outstandingAmountMinor: 0,
        }),
      ),
    ).toBe('history');
    expect(
      classifyV2Bill(
        validV2({
          status: 'pending',
          paidAmountMinor: 250000,
          creditAppliedMinor: 0,
          outstandingAmountMinor: 0,
        }),
      ),
    ).toBe('history');
    expect(classifyV2Bill(validV2({ status: 'paid' }))).toBe('unavailable');
    expect(classifyV2Bill(validV2({ currency: 'USD' }))).toBe('unavailable');
  });

  it('keeps V1 pending, overdue, paid, and decimal money behavior', () => {
    expect(isV2Bill({ schemaVersion: '2' })).toBe(false);
    expect(money(1234.5)).toBe('₹1,234.50');
    expect(classifyV2Bill({ status: 'pending', amount: 1234.5 })).toBe('unavailable');
    expect(classifyV2Bill({ status: 'overdue', amount: 1234.5 })).toBe('unavailable');
    expect(classifyV2Bill({ status: 'paid', amount: 1234.5 })).toBe('unavailable');
  });

  it('renders V2 authoritative balances and charge lines', () => {
    render(<V2BillFinancialSummary data={validV2()} />);
    expect(screen.getByText('Total')).toBeTruthy();
    expect(screen.getAllByText('₹2,500.00')).toHaveLength(2);
    expect(screen.getByText('Paid')).toBeTruthy();
    expect(screen.getByText('₹1,000.00')).toBeTruthy();
    expect(screen.getByText('Credit applied')).toBeTruthy();
    expect(screen.getByText('₹300.00')).toBeTruthy();
    expect(screen.getByText('Outstanding')).toBeTruthy();
    expect(screen.getByText('₹1,200.00')).toBeTruthy();
    expect(screen.getByText('Maintenance')).toBeTruthy();
    expect(screen.getByText('Billing period: 2026-09')).toBeTruthy();
  });

  it('fails closed in V2 display when currency or financial projection is invalid', () => {
    const { rerender } = render(<V2BillFinancialSummary data={validV2({ currency: 'USD' })} />);
    expect(screen.getByText('V2 financial details unavailable')).toBeTruthy();
    expect(screen.queryByText(/₹/)).toBeNull();
    rerender(<V2BillFinancialSummary data={validV2({ outstandingAmountMinor: 999 })} />);
    expect(screen.getByText('V2 financial details unavailable')).toBeTruthy();
    expect(screen.queryByText(/₹/)).toBeNull();
  });

  it('shows the V2 offline-payment action without invoking the V1 RecordPaymentPanel', async () => {
    renderBilling([row(validV2())]);
    expect(screen.getAllByText('₹2,500.00')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /View September maintenance/ }));
    expect(await screen.findByRole('button', { name: 'Record Offline Payment' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record Payment' })).toBeNull();
    expect(vi.mocked(useAdminV2PaymentProofs).mock.calls.at(-1)?.[1]).toBe(true);
  });

  it('does not enable the Admin proof subscription for resident billing', () => {
    renderBilling([row(validV2())], [], {}, makeSession('resident'));
    expect(vi.mocked(useAdminV2PaymentProofs).mock.calls.at(-1)?.[1]).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /View details/ }));
    expect(screen.queryByRole('button', { name: 'Record Offline Payment' })).toBeNull();
  });

  it('blocks offline payment while any exact V2 pending proof exists for the bill, even if malformed', () => {
    renderBilling([row(validV2())], [row({ schemaVersion: 2, billId: 'bill-1', status: 'pending' }, 'proof-1')]);
    fireEvent.click(screen.getByRole('button', { name: /View September maintenance/ }));
    expect(screen.getByText(/a payment proof is pending/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record Offline Payment' })).toBeNull();
  });

  it.each(['failed', 'completed'])('does not block offline payment for an exact V2 %s proof', async (proofStatus) => {
    renderBilling(
      [row(validV2())],
      [row({ schemaVersion: 2, billId: 'bill-1', status: proofStatus }, 'proof-1')],
    );
    fireEvent.click(screen.getByRole('button', { name: /View September maintenance/ }));
    expect(await screen.findByRole('button', { name: 'Record Offline Payment' })).toBeTruthy();
  });

  it('blocks the V2 offline action while proof subscription is loading or failed', () => {
    const loadingView = renderBilling([row(validV2())], [], { loading: true });
    fireEvent.click(screen.getByRole('button', { name: /View September maintenance/ }));
    expect(screen.getByText(/payment proof status is being checked/i)).toBeTruthy();
    loadingView.unmount();
    renderBilling([row(validV2())], [], { error: 'permission denied' });
    fireEvent.click(screen.getByRole('button', { name: /View September maintenance/ }));
    expect(screen.getByText(/payment proof status is being checked/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record Offline Payment' })).toBeNull();
  });

  it('keeps V1 amount display and V1 Record Payment panel', () => {
    renderBilling([
      row({
        title: 'V1 maintenance',
        amount: 1234.5,
        status: 'pending',
        communityId: 'community-1',
        flatLabel: 'Tower A · 1203',
      }),
    ]);
    expect(screen.getByText('₹1,234.50')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /View V1 maintenance/ }));
    expect(screen.getByRole('button', { name: 'Record Payment' })).toBeTruthy();
  });

  it('does not display malformed V2 rupees or V1 payment action', () => {
    renderBilling([row(validV2({ currency: 'USD' }))]);
    expect(screen.getByText('V2 financial details unavailable')).toBeTruthy();
    expect(screen.queryByText(/₹/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /View September maintenance/ }));
    expect(screen.getByText('Offline payment unavailable for this V2 bill.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record Payment' })).toBeNull();
  });

  it('adds no direct writes to V2 financial ledger collections', () => {
    const source = readFileSync('src/pages.tsx', 'utf8');
    for (const collection of [
      'paymentTransactions',
      'paymentAllocations',
      'residentCreditEntries',
      'residentFinancialAccounts',
      'paymentSettlementsV2',
    ]) {
      expect(source).not.toContain(`collection('${collection}')`);
      expect(source).not.toContain(`collection("${collection}")`);
    }
  });

  it('merges V1 and V2 proof rows and selects V2 by source when document IDs collide', () => {
    renderPayments(
      [
        row(
          {
            title: 'Legacy payment',
            communityId: 'community-1',
            amount: 765.43,
            method: 'external',
            status: 'pending',
          },
          'shared-payment-id',
        ),
      ],
      [
        row(
          {
            schemaVersion: 2,
            id: 'shared-payment-id',
            communityId: 'community-1',
            currency: 'INR',
            submittedAmountMinor: 123456,
            billId: 'bill-v2-1',
            residentId: 'resident-v2-1',
            userId: 'resident-v2-1',
            method: 'upi',
            provider: 'direct_upi',
            evidenceType: 'receipt',
            verificationMode: 'manual',
            status: 'pending',
            receiptPath: 'payment_receipts/community-1/bill-v2-1/shared-payment-id.jpg',
            paymentReference: 'UTR-V2-1',
            submittedAt: new Date('2026-09-02T12:00:00Z'),
            title: 'Direct UPI proof',
          },
          'shared-payment-id',
        ),
      ],
    );

    const legacyRow = screen
      .getByRole('button', { name: 'View Legacy payment' })
      .closest('tr')!;
    const v2Row = screen.getByRole('button', { name: 'View Direct UPI proof' }).closest('tr')!;
    expect(legacyRow.cells[1].textContent).toBe('₹765.43');
    expect(v2Row.cells[1].textContent).toBe('₹1,234.56');

    fireEvent.click(screen.getByRole('button', { name: 'View Direct UPI proof' }));
    expect(screen.getAllByText('UTR-V2-1')).toHaveLength(2);
    expect(screen.getAllByText('₹1,234.56')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Verify payment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject proof' })).toBeDisabled();
  });

  it('shows unavailable for malformed V2 list/detail data without V1 amount fallback', () => {
    renderPayments(
      [],
      [
        row(
          {
            schemaVersion: 2,
            id: 'bad-proof',
            currency: 'INR',
            submittedAmountMinor: '12500',
            amount: 125,
            communityId: 'community-1',
            billId: 'bill-1',
            residentId: 'resident-1',
            userId: 'resident-1',
            method: 'upi',
            provider: 'direct_upi',
            evidenceType: 'receipt',
            status: 'pending',
            receiptPath: 'receipt.jpg',
            title: 'Malformed V2 proof',
          },
          'bad-proof',
        ),
      ],
    );
    const proofRow = screen
      .getByRole('button', { name: 'View Malformed V2 proof' })
      .closest('tr')!;
    expect(proofRow.cells[1].textContent).toBe('—');
    fireEvent.click(screen.getByRole('button', { name: 'View Malformed V2 proof' }));
    expect(screen.getByText('V2 payment proof unavailable')).toBeInTheDocument();
    expect(screen.queryByText('₹125.00')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject proof' })).not.toBeInTheDocument();
  });

  it('routes valid V2 and V1 review actions only to their versioned callables', () => {
    const source = readFileSync('src/pages.tsx', 'utf8');
    const verifyStart = source.indexOf('onVerify={() =>');
    const rejectStart = source.indexOf('onReject={(rejectionReason) =>', verifyStart);
    const verify = source.slice(verifyStart, rejectStart);
    const rejectEnd = source.indexOf('\n            }', rejectStart);
    const reject = source.slice(rejectStart, rejectEnd);

    expect(verify).toContain('if (isV2PaymentProof(d))');
    expect(verify).toContain('if (!hasValidV2PaymentProof(d, row.id)) return;');
    expect(verify).toContain("call('verifyPaymentProofV2', { paymentId: row.id })");
    expect(verify).toContain("call('verifyPaymentProof', { paymentId: row.id })");
    expect(verify).not.toContain('billId:');
    expect(
      verify.indexOf('if (!hasValidV2PaymentProof(d, row.id)) return;'),
    ).toBeLessThan(verify.indexOf("call('verifyPaymentProofV2'"));

    expect(reject).toContain('if (!hasValidV2PaymentProof(d, row.id) || !rejectionReason.trim()) return;');
    expect(reject).toContain("call('rejectPaymentProofV2'");
    expect(reject).toContain('paymentId: row.id');
    expect(reject).toContain('rejectionReason: rejectionReason.trim()');
    expect(reject).toContain("call('rejectPaymentProof'");
    expect(reject).not.toContain('billId:');
  });

  it('keeps this checkpoint free of V2 offline-payment wiring', () => {
    const source = readFileSync('src/pages.tsx', 'utf8');
    expect(source).not.toContain('recordOfflinePaymentV2');
  });
});


function validRecurringSchedule(overrides: Partial<Data> = {}): Data {
  return {
    schemaVersion: 2,
    id: 'schedule-1',
    communityId: 'community-1',
    currency: 'INR',
    frequency: 'monthly',
    status: 'active',
    scope: 'community',
    generationDay: 5,
    dueDay: 20,
    startBillingPeriod: '2026-09',
    endBillingPeriod: null,
    currentRevisionId: 'schedule-revision-1',
    revisionNo: 1,
    chargeLines: [{ label: 'Maintenance', amountMinor: 250000 }],
    generatedThroughBillingPeriod: null,
    generationInProgressBillingPeriod: null,
    name: 'Monthly maintenance',
    ...overrides,
  };
}

describe('Admin Web recurring schedule dashboard', () => {
  it.each([
    ['active', 'Active'],
    ['paused', 'Paused'],
    ['stopped', 'Stopped'],
  ])('renders %s schedule status', (scheduleStatus, expectedLabel) => {
    renderBilling(
      [],
      [],
      {},
      makeSession('admin'),
      {
        rows: [
          row(
            validRecurringSchedule({ status: scheduleStatus }),
            'schedule-1',
          ),
        ],
      },
    );

    expect(screen.getByText('Recurring Billing')).toBeTruthy();
    expect(screen.getByText(expectedLabel)).toBeTruthy();
  });

  it.each([
    [
      { scope: 'community' },
      'Entire Community',
    ],
    [
      { scope: 'building', buildingId: 'tower-1' },
      'Building · tower-1',
    ],
    [
      { scope: 'unit', buildingId: 'tower-1', flatId: 'unit-1' },
      'Individual Unit · tower-1 · unit-1',
    ],
    [
      { scope: 'units', flatIds: ['unit-1', 'unit-2'] },
      'Selected Units · unit-1, unit-2',
    ],
  ])('renders recurring scope %o', (scopeFields, expectedText) => {
    renderBilling(
      [],
      [],
      {},
      makeSession('admin'),
      {
        rows: [
          row(
            validRecurringSchedule(scopeFields),
            'schedule-1',
          ),
        ],
      },
    );

    expect(screen.getByText(expectedText)).toBeTruthy();
  });

  it('accepts selected-units schedules without a buildingId', () => {
    const schedule = validRecurringSchedule({
      scope: 'units',
      flatIds: ['unit-a', 'unit-b'],
    });

    expect(hasValidV2RecurringSchedule(schedule, 'schedule-1')).toBe(true);
  });

  it('formats recurring charge lines and total only from integer minor units', () => {
    const schedule = validRecurringSchedule({
      chargeLines: [
        { label: 'Maintenance', amountMinor: 250000 },
        { label: 'Security', amountMinor: 1250 },
      ],
    });

    expect(recurringScheduleTotalMinor(schedule)).toBe(251250);

    renderBilling(
      [],
      [],
      {},
      makeSession('admin'),
      { rows: [row(schedule, 'schedule-1')] },
    );

    expect(screen.getByText('Maintenance')).toBeTruthy();
    expect(screen.getByText('Security')).toBeTruthy();
    expect(screen.getByText('₹2,500.00')).toBeTruthy();
    expect(screen.getByText('₹12.50')).toBeTruthy();
    expect(screen.getByText('₹2,512.50')).toBeTruthy();
  });

  it('uses startBillingPeriod when nothing has generated yet', () => {
    expect(
      nextRecurringBillingPeriod(
        validRecurringSchedule({
          startBillingPeriod: '2026-09',
          generatedThroughBillingPeriod: null,
        }),
      ),
    ).toBe('2026-09');
  });

  it('uses exactly the next month after generatedThroughBillingPeriod', () => {
    expect(
      nextRecurringBillingPeriod(
        validRecurringSchedule({
          startBillingPeriod: '2026-01',
          generatedThroughBillingPeriod: '2026-11',
        }),
      ),
    ).toBe('2026-12');
  });

  it('rolls December into January of the next year', () => {
    expect(
      nextRecurringBillingPeriod(
        validRecurringSchedule({
          generatedThroughBillingPeriod: '2026-12',
        }),
      ),
    ).toBe('2027-01');
  });

  it('shows open-ended and in-progress schedule state', () => {
    renderBilling(
      [],
      [],
      {},
      makeSession('admin'),
      {
        rows: [
          row(
            validRecurringSchedule({
              endBillingPeriod: null,
              generationInProgressBillingPeriod: '2026-09',
            }),
            'schedule-1',
          ),
        ],
      },
    );

    expect(screen.getByText('Open-ended')).toBeTruthy();
    expect(screen.getByText('Generation in progress: 2026-09')).toBeTruthy();
  });

  it('shows attention instead of claiming an old missed period will catch up', () => {
    renderBilling(
      [],
      [],
      {},
      makeSession('admin'),
      {
        rows: [
          row(
            validRecurringSchedule({
              startBillingPeriod: '2020-01',
              generatedThroughBillingPeriod: null,
            }),
            'schedule-1',
          ),
        ],
      },
    );

    expect(
      screen.getByText('Previous billing period requires attention.'),
    ).toBeTruthy();
  });

  it.each([
    [{ currency: 'USD' }, 'invalid currency'],
    [{ generationDay: 0 }, 'invalid generation day'],
    [{ generationDay: 20, dueDay: 10 }, 'due day before generation day'],
    [{ currentRevisionId: '   ' }, 'missing revision'],
    [
      { chargeLines: [{ label: 'Maintenance', amountMinor: '250000' }] },
      'non-integer charge value',
    ],
    [{ id: 'different-schedule' }, 'document identity mismatch'],
  ])('fails closed for %s', (overrides, _label) => {
    expect(
      hasValidV2RecurringSchedule(
        validRecurringSchedule(overrides),
        'schedule-1',
      ),
    ).toBe(false);
  });

  it('renders malformed recurring records as unavailable', () => {
    renderBilling(
      [],
      [],
      {},
      makeSession('admin'),
      {
        rows: [
          row(
            validRecurringSchedule({ currency: 'USD' }),
            'schedule-1',
          ),
        ],
      },
    );

    expect(
      screen.getByText('Recurring schedule details unavailable.'),
    ).toBeTruthy();
    expect(screen.queryByText('₹2,500.00')).toBeNull();
  });

  it('shows recurring loading state without affecting the rest of Billing', () => {
    renderBilling([], [], {}, makeSession('admin'), { loading: true });

    expect(
      screen.getByText('Loading recurring schedules…'),
    ).toBeTruthy();
  });

  it('shows recurring empty state', () => {
    renderBilling([], [], {}, makeSession('admin'), { rows: [] });

    expect(
      screen.getByText('No recurring billing schedules yet.'),
    ).toBeTruthy();
  });

  it('isolates recurring read errors from the existing bill list', () => {
    renderBilling(
      [row(validV2())],
      [],
      {},
      makeSession('admin'),
      { error: 'permission denied' },
    );

    expect(
      screen.getByText(
        'Recurring billing schedules could not be loaded.',
      ),
    ).toBeTruthy();

    expect(
      screen.getByRole('button', {
        name: /View September maintenance/,
      }),
    ).toBeTruthy();
  });

  it('does not expose recurring schedules on the resident Billing page', () => {
    renderBilling(
      [],
      [],
      {},
      makeSession('resident'),
      {
        rows: [
          row(validRecurringSchedule(), 'schedule-1'),
        ],
      },
    );

    expect(screen.queryByText('Recurring Billing')).toBeNull();

    expect(
      vi.mocked(useAdminV2RecurringSchedules).mock.calls.at(-1)?.[1],
    ).toBe(false);
  });

  it('exposes only recurring create control in this phase', () => {
    renderBilling(
      [],
      [],
      {},
      makeSession('admin'),
      {
        rows: [
          row(validRecurringSchedule(), 'schedule-1'),
        ],
      },
    );

    expect(
      screen.getByRole('button', { name: 'Create Recurring Schedule' }),
    ).toBeTruthy();

    for (const name of [
      'Edit',
      'Pause',
      'Resume',
      'Stop',
      'Generate Now',
      'Retry',
      'Reconcile',
    ]) {
      expect(
        screen.queryByRole('button', { name }),
      ).toBeNull();
    }
  });

  it('does not wire recurring mutation callables into the display-only component', () => {
    const source = readFileSync(
      'src/components/RecurringSchedules.tsx',
      'utf8',
    );

    expect(source).not.toMatch(/createBillingScheduleV2/);
    expect(source).not.toMatch(/reviseBillingScheduleV2/);
    expect(source).not.toMatch(/pauseBillingScheduleV2/);
    expect(source).not.toMatch(/resumeBillingScheduleV2/);
    expect(source).not.toMatch(/stopBillingScheduleV2/);
    expect(source).not.toMatch(/\bcall\s*\(/);
  });
});

function recurringCreateRequest(
  overrides: Record<string, unknown> = {},
) {
  return normalizeRecurringBillingScheduleRequest({
    schemaVersion: 2,
    communityId: 'community-1',
    currency: 'INR',
    frequency: 'monthly',
    idempotencyKey: 'schedule_test_key_1',
    scope: 'community',
    generationDay: 1,
    dueDay: 1,
    startBillingPeriod: '2026-10',
    endBillingPeriod: null,
    chargeLines: [
      {
        lineId: 'line-1',
        code: 'maintenance',
        label: 'Maintenance',
        amountMinor: 10000,
      },
    ],
    ...overrides,
  });
}

describe('Admin Web recurring schedule create action contract', () => {
  it('calls createBillingScheduleV2 with normalized schemaVersion 2 INR monthly payload', async () => {
    const session = makeSession('admin');
    const payload = recurringCreateRequest({
      dueDay: 20,
      chargeLines: [
        { lineId: 'line-b', code: 'security', label: 'Security', amountMinor: 2500 },
        { lineId: 'line-a', code: 'maintenance', label: 'Maintenance', amountMinor: 10000 },
      ],
    });
    const invokeCall = vi.fn().mockResolvedValue({
      success: true,
      scheduleId: 'schedule-1',
      revisionId: 'rev-1',
      revisionNo: 1,
      alreadyCompleted: false,
    });

    const result = await createRecurringBillingScheduleV2(session, payload, {
      resolveAuthority: async () => ({ ...session, community: session.community! }),
      invokeCall,
    });

    expect(invokeCall).toHaveBeenCalledWith('createBillingScheduleV2', payload);
    expect((invokeCall.mock.calls[0]?.[1] as Record<string, unknown>).schemaVersion).toBe(2);
    expect((invokeCall.mock.calls[0]?.[1] as Record<string, unknown>).currency).toBe('INR');
    expect((invokeCall.mock.calls[0]?.[1] as Record<string, unknown>).frequency).toBe('monthly');
    expect(payload.chargeLines.map((line) => line.lineId)).toEqual(['line-a', 'line-b']);
    expect(result).toEqual({
      success: true,
      scheduleId: 'schedule-1',
      revisionId: 'rev-1',
      revisionNo: 1,
      alreadyCompleted: false,
    });
  });

  it('normalizes scope property presence for community', () => {
    const payload = recurringCreateRequest({ scope: 'community' });
    expect(payload.scope).toBe('community');
    expect(Object.hasOwn(payload, 'buildingId')).toBe(false);
    expect(Object.hasOwn(payload, 'flatId')).toBe(false);
    expect(Object.hasOwn(payload, 'flatIds')).toBe(false);
  });

  it('normalizes scope property presence for building', () => {
    const payload = recurringCreateRequest({ scope: 'building', buildingId: 'tower-1' });
    expect(payload.scope).toBe('building');
    expect(Object.hasOwn(payload, 'buildingId')).toBe(true);
    expect(Object.hasOwn(payload, 'flatId')).toBe(false);
    expect(Object.hasOwn(payload, 'flatIds')).toBe(false);
  });

  it('normalizes scope property presence for unit', () => {
    const payload = recurringCreateRequest({
      scope: 'unit',
      buildingId: 'tower-1',
      flatId: 'unit-1',
    });
    expect(payload.scope).toBe('unit');
    expect(Object.hasOwn(payload, 'buildingId')).toBe(true);
    expect(Object.hasOwn(payload, 'flatId')).toBe(true);
    expect(Object.hasOwn(payload, 'flatIds')).toBe(false);
  });

  it('normalizes scope property presence for units', () => {
    const payload = recurringCreateRequest({ scope: 'units', flatIds: ['unit-2', 'unit-1'] });
    expect(payload.scope).toBe('units');
    expect(Object.hasOwn(payload, 'buildingId')).toBe(false);
    expect(Object.hasOwn(payload, 'flatId')).toBe(false);
    expect(Object.hasOwn(payload, 'flatIds')).toBe(true);
  });

  it('accepts selected units across buildings without requiring buildingId', () => {
    const payload = recurringCreateRequest({
      scope: 'units',
      flatIds: ['tower-b-unit-2204', 'tower-a-unit-101', 'tower-b-unit-2204'],
    });
    expect(payload.scope).toBe('units');
    if (payload.scope !== 'units') throw new Error('Expected units scope.');
    expect(payload.flatIds).toEqual(['tower-a-unit-101', 'tower-b-unit-2204']);
  });

  it('normalizes standard and custom charge payloads', () => {
    const payload = recurringCreateRequest({
      chargeLines: [
        {
          lineId: 'line-2',
          code: 'custom',
          label: '  Gym   Fee ',
          amountMinor: 250,
        },
        {
          lineId: 'line-1',
          code: 'water',
          label: 'Water',
          amountMinor: 10000,
        },
      ],
    });
    expect(payload.chargeLines).toEqual([
      { lineId: 'line-1', code: 'water', label: 'Water', amountMinor: 10000 },
      { lineId: 'line-2', code: 'custom', label: 'Gym Fee', amountMinor: 250 },
    ]);
  });

  it('rejects duplicate lineId, duplicate labels, and reserved custom labels', () => {
    expect(() =>
      recurringCreateRequest({
        chargeLines: [
          { lineId: 'line-1', code: 'maintenance', label: 'Maintenance', amountMinor: 10000 },
          { lineId: 'line-1', code: 'water', label: 'Water', amountMinor: 1000 },
        ],
      }),
    ).toThrow('Recurring charge lines must use unique line IDs.');

    expect(() =>
      recurringCreateRequest({
        chargeLines: [
          { lineId: 'line-1', code: 'custom', label: 'Gym Fee', amountMinor: 10000 },
          { lineId: 'line-2', code: 'custom', label: ' gym    fee ', amountMinor: 1000 },
        ],
      }),
    ).toThrow('Recurring charge lines must use unique labels.');

    expect(() =>
      recurringCreateRequest({
        chargeLines: [
          { lineId: 'line-1', code: 'custom', label: 'maintenance', amountMinor: 10000 },
        ],
      }),
    ).toThrow('Custom charge label cannot reuse a standard charge label.');
  });

  it('rejects more than 20 charge lines', () => {
    const lines = Array.from({ length: 21 }, (_, index) => ({
      lineId: `line-${index + 1}`,
      code: 'custom',
      label: `Custom ${index + 1}`,
      amountMinor: 100,
    }));
    expect(() => recurringCreateRequest({ chargeLines: lines })).toThrow(
      'Recurring schedules can include at most 20 charge lines.',
    );
  });

  it.each([
    [{ generationDay: 0 }, 'Generation day must be an integer from 1 to 28.'],
    [{ dueDay: 29 }, 'Due day must be an integer from 1 to 28.'],
    [{ generationDay: 10, dueDay: 9 }, 'Due day must be the same as or after generation day.'],
    [{ startBillingPeriod: '2026-13' }, 'Start billing period must be in YYYY-MM format.'],
    [{ startBillingPeriod: '1999-12' }, 'Start billing period year must be between 2000 and 2100.'],
    [{ startBillingPeriod: '2101-01' }, 'Start billing period year must be between 2000 and 2100.'],
    [
      { endBillingPeriod: '2026-01', startBillingPeriod: '2026-10' },
      'End billing period must be the same as or after start billing period.',
    ],
    [{ communityId: 'bad\nid' }, 'Community must be a valid document ID.'],
  ])('rejects invalid recurring schedule shape %#', (overrides, message) => {
    expect(() => recurringCreateRequest(overrides)).toThrow(message);
  });

  it('maps open-ended end period to null', () => {
    const payload = recurringCreateRequest({ endBillingPeriod: null });
    expect(payload.endBillingPeriod).toBeNull();
  });

  it('rejects malformed callable responses', async () => {
    const session = makeSession('admin');
    await expect(
      createRecurringBillingScheduleV2(session, recurringCreateRequest(), {
        resolveAuthority: async () => ({ ...session, community: session.community! }),
        invokeCall: async () => ({ success: true, scheduleId: '', revisionId: 'rev', revisionNo: 1, alreadyCompleted: false }),
      }),
    ).rejects.toThrow('The recurring schedule response could not be validated.');
  });
});

describe('Admin Web recurring INR parser', () => {
  it.each([
    ['100', 10000],
    ['100.5', 10050],
    ['100.50', 10050],
  ])('parses %s into minor units', (input, expected) => {
    expect(parseRecurringAmountInrToMinorUnits(input)).toBe(expected);
  });

  it.each(['', '0', '-1', '1.234', '1e2', '1,000.00'])('rejects invalid amount %s', (input) => {
    expect(parseRecurringAmountInrToMinorUnits(input)).toBeNull();
  });

  it('rejects numeric overflow and aggregate overflow', () => {
    expect(parseRecurringAmountInrToMinorUnits('90071992547409.92')).toBeNull();
    expect(() =>
      recurringCreateRequest({
        chargeLines: [
          {
            lineId: 'line-1',
            code: 'custom',
            label: 'A',
            amountMinor: Number.MAX_SAFE_INTEGER,
          },
          {
            lineId: 'line-2',
            code: 'custom',
            label: 'B',
            amountMinor: 1,
          },
        ],
      }),
    ).toThrow('Recurring charge total exceeds the safe integer limit.');
  });
});

describe('Admin Web recurring schedule create modal', () => {
  it('shows Create Recurring Schedule to admins and hides it for residents', () => {
    const adminView = renderBilling([], [], {}, makeSession('admin'));
    expect(screen.getByRole('button', { name: 'Create Recurring Schedule' })).toBeTruthy();
    adminView.unmount();

    renderBilling([], [], {}, makeSession('resident'));
    expect(screen.queryByRole('button', { name: 'Create Recurring Schedule' })).toBeNull();
  });

  it('blocks double submit and persists unresolved request before callable', async () => {
    mockRows();
    const session = makeSession('admin');
    const saved: ReturnType<typeof recurringCreateRequest>[] = [];
    const savedKeys: string[] = [];
    let resolveSubmit!: (value: {
      success: true;
      scheduleId: string;
      revisionId: string;
      revisionNo: 1;
      alreadyCompleted: boolean;
    }) => void;
    const submitSchedule = vi.fn(
      () =>
        new Promise<{ success: true; scheduleId: string; revisionId: string; revisionNo: 1; alreadyCompleted: boolean }>((resolve) => {
          resolveSubmit = resolve;
        }),
    );

    render(
      <CreateRecurringScheduleModal
        s={session}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        loadAttempt={() => null}
        saveAttempt={(storageKey, attempt) => {
          savedKeys.push(storageKey);
          saved.push(attempt);
        }}
        clearAttempt={vi.fn()}
        createIdempotencyKey={() => 'schedule_modal_key'}
        submitSchedule={submitSchedule}
      />,
    );

    fireEvent.change(screen.getByLabelText('Amount (INR)'), { target: { value: '100.50' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Recurring Schedule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submitting…' }));

    expect(saved).toHaveLength(1);
    expect(saved[0].idempotencyKey).toBe('schedule_modal_key');
    expect(saved[0].chargeLines[0].lineId).toBe('line-1');
    expect(savedKeys).toEqual([recurringScheduleAttemptStorageKey('admin-1', 'community-1')]);
    expect(submitSchedule).toHaveBeenCalledTimes(1);

    resolveSubmit({
      success: true,
      scheduleId: 'schedule-1',
      revisionId: 'rev-1',
      revisionNo: 1,
      alreadyCompleted: false,
    });
  });

  it('retains unresolved request/key on ambiguous failure and retries exact payload', async () => {
    mockRows();
    const session = makeSession('admin');
    const savedPayload = recurringCreateRequest({ idempotencyKey: 'schedule_saved_key' });
    const submitSchedule = vi
      .fn()
      .mockRejectedValueOnce(Error('network timeout'))
      .mockResolvedValueOnce({
        success: true,
        scheduleId: 'schedule-1',
        revisionId: 'rev-1',
        revisionNo: 1,
        alreadyCompleted: true,
      });
    const clearAttempt = vi.fn();
    const onCreated = vi.fn();

    render(
      <CreateRecurringScheduleModal
        s={session}
        onClose={vi.fn()}
        onCreated={onCreated}
        loadAttempt={() => savedPayload}
        saveAttempt={vi.fn()}
        clearAttempt={clearAttempt}
        submitSchedule={submitSchedule}
      />,
    );

    expect(screen.getByText('Unresolved Recurring Schedule Request')).toBeTruthy();
    expect(screen.queryByLabelText('Scope')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry Saved Request' }));
    expect(submitSchedule).toHaveBeenCalledWith(session, savedPayload);
    expect(await screen.findByText(/unresolved/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry Saved Request' }));
    expect(submitSchedule).toHaveBeenLastCalledWith(session, savedPayload);
    expect(await screen.findByText(/already completed/i)).toBeTruthy();
    expect(clearAttempt).toHaveBeenCalledTimes(1);
    expect(clearAttempt).toHaveBeenCalledWith(recurringScheduleAttemptStorageKey('admin-1', 'community-1'));
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it('uses unresolved storage keys scoped by admin uid and community', () => {
    expect(recurringScheduleAttemptStorageKey('admin-1', 'community-1')).toBe(
      'hominode.billingV2.createRecurringSchedule.unresolved:admin-1:community-1',
    );
    expect(recurringScheduleAttemptStorageKey('admin-1', 'community-2')).toBe(
      'hominode.billingV2.createRecurringSchedule.unresolved:admin-1:community-2',
    );
    expect(recurringScheduleAttemptStorageKey('admin-2', 'community-1')).toBe(
      'hominode.billingV2.createRecurringSchedule.unresolved:admin-2:community-1',
    );
  });

  it('keeps V1 billing create modal flow available', () => {
    const source = readFileSync('src/pages.tsx', 'utf8');
    expect(source).toContain('<BillingCreateModal s={s} onClose={close} />');
  });

  it('wires recurring create success to recurring dashboard refresh', () => {
    const source = readFileSync('src/pages.tsx', 'utf8');
    expect(source).toContain('onCreated={() => setRevision((value) => value + 1)}');
  });
});
