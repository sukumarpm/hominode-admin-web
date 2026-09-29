import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useRows, type Module, type Resource } from '../data';
import {
  classifyV2Bill,
  formatInrMinorUnits,
  hasValidV2BillFinancials,
  isV2Bill,
  money,
  type Data,
  type Row,
} from '../models';
import { ModulePage, V2BillFinancialSummary } from '../pages';
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
  flatLabel: 'Tower A · 1203',
};

function validV2(overrides: Partial<Data> = {}): Data {
  return { ...v2Bill, ...overrides };
}

function row(data: Data, id = 'bill-1'): Row {
  return { id, data };
}

function renderBilling(rows: Row[]) {
  const session = makeSession('admin');
  vi.mocked(useRows).mockImplementation((_session, module: Module): Resource => ({
    rows: module === 'billing' ? rows : [],
    loading: false,
    error: '',
  }));
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

  it('shows the V2 action notice without invoking the V1 RecordPaymentPanel', () => {
    renderBilling([row(validV2())]);
    expect(screen.getAllByText('₹2,500.00')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /View September maintenance/ }));
    expect(
      screen.getByText('Billing V2 payment actions will be available in the next step.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record Payment' })).toBeNull();
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
    expect(screen.getByText('Payment actions unavailable for this V2 bill.')).toBeTruthy();
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
});
