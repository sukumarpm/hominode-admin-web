import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingV2FinancialReport } from '../actions';
import type { Session } from '../models';
import { ReportsPage } from '../pages';
import { AuthContext, type AuthState } from '../session';
import { makeSession } from './fixtures';

const reportActions = vi.hoisted(() => ({ getReport: vi.fn() }));
const rowMocks = vi.hoisted(() => ({ useRows: vi.fn() }));

vi.mock('../actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../actions')>();
  return { ...actual, getBillingV2FinancialReport: reportActions.getReport };
});

vi.mock('../data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data')>();
  return { ...actual, useRows: rowMocks.useRows };
});

function financialReport(communityId: string, billingPeriod: string): BillingV2FinancialReport {
  return {
    success: true,
    schemaVersion: 1,
    communityId,
    billingPeriod,
    generatedAtMs: Date.parse('2026-10-03T04:05:06.000Z'),
    liabilitySummary: {
      billsCount: 9,
      billedMinor: 123456,
      paidAllocationMinor: 40000,
      creditAppliedMinor: 1234,
      outstandingMinor: 82222,
      overdueOutstandingMinor: 22222,
      statusCounts: { pending: 1, partially_paid: 2, paid: 3, overdue: 4 },
    },
    collectionActivity: {
      transactionCount: 7,
      totalReceivedMinor: 51234,
      methods: {
        upi: { count: 2, totalMinor: 20100 },
        cash: { count: 1, totalMinor: 5000 },
        bank_transfer: { count: 3, totalMinor: 30000 },
        cheque: { count: 1, totalMinor: 6134 },
      },
    },
    creditPosition: {
      accountsCount: 8,
      residentsWithCreditCount: 5,
      totalAvailableCreditMinor: 98765,
    },
  };
}

function currentLocalMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function withCommunity(session: Session, communityId: string): Session {
  const community = session.communities.find((item) => item.id === communityId);
  if (!community) throw Error('Fixture community missing');
  return { ...session, community };
}

function authState(session: Session): AuthState {
  return {
    session,
    loading: false,
    error: '',
    authenticated: true,
    signOut: vi.fn(async () => {}),
    switchCommunity: vi.fn(),
  };
}

function renderReports(session: Session) {
  return render(
    <AuthContext value={authState(session)}>
      <ReportsPage />
    </AuthContext>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  reportActions.getReport.mockReset();
  rowMocks.useRows.mockReset();
  rowMocks.useRows.mockImplementation((_session: Session, module: string) => ({
    rows: Array.from(
      {
        length:
          { billing: 4, residents: 11, visitors: 12, complaints: 13 }[module as 'billing'] ?? 0,
      },
      (_, index) => ({ id: String(index), data: {} }),
    ),
    loading: false,
    error: '',
  }));
});

describe('ReportsPage Billing V2 financial report', () => {
  it('requests the current local month for the selected community and renders canonical values in minor-unit INR', async () => {
    const session = makeSession('admin');
    const communityId = session.community!.id;
    const month = currentLocalMonth();
    reportActions.getReport.mockResolvedValue(financialReport(communityId, month));

    renderReports(session);

    await waitFor(() => expect(reportActions.getReport).toHaveBeenCalledWith(session, month));
    expect(screen.getByRole('heading', { name: 'Financial Reports' })).toBeInTheDocument();
    expect(
      screen.getByText('Billing, collections and payment insights for your community.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Total billed')).toBeInTheDocument();
    expect(screen.getByText('Collections received')).toBeInTheDocument();
    expect(screen.getByText('Outstanding')).toBeInTheDocument();
    expect(screen.getByText('Available credit')).toBeInTheDocument();
    expect(await screen.findByText('₹1,234.56')).toBeInTheDocument();
    expect(screen.getByText('₹400.00')).toBeInTheDocument();
    expect(screen.getByText('₹12.34')).toBeInTheDocument();
    expect(screen.getByText('₹822.22')).toBeInTheDocument();
    expect(screen.getByText('₹222.22')).toBeInTheDocument();
    expect(screen.getByText('₹512.34')).toBeInTheDocument();
    expect(screen.getByText('₹987.65')).toBeInTheDocument();
    const upiRow = screen.getByText('UPI').closest('.financial-report-method-row');
    const cashRow = screen.getByText('Cash').closest('.financial-report-method-row');
    const bankTransferRow = screen
      .getByText('Bank transfer')
      .closest('.financial-report-method-row');
    const chequeRow = screen.getByText('Cheque').closest('.financial-report-method-row');
    expect(upiRow).toHaveTextContent('2 transactions');
    expect(upiRow).toHaveTextContent('₹201.00');
    expect(cashRow).toHaveTextContent('1 transaction');
    expect(cashRow).toHaveTextContent('₹50.00');
    expect(bankTransferRow).toHaveTextContent('3 transactions');
    expect(bankTransferRow).toHaveTextContent('₹300.00');
    expect(chequeRow).toHaveTextContent('1 transaction');
    expect(chequeRow).toHaveTextContent('₹61.34');
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Partially paid')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('Paid allocations')).toBeInTheDocument();
    expect(screen.getByText('Credit applied')).toBeInTheDocument();
    expect(screen.getByText('Overdue outstanding')).toBeInTheDocument();
    expect(screen.getByText('Transaction count')).toBeInTheDocument();
    expect(screen.getByText('Accounts count')).toBeInTheDocument();
    expect(screen.getByText('Residents with available credit')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bill status' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Payment methods' })).toBeInTheDocument();
    expect([...new Set(rowMocks.useRows.mock.calls.map(([, module]) => module))].sort()).toEqual([
      'billing',
      'complaints',
      'residents',
      'visitors',
    ]);
  });

  it('renders zero bills and zero collections without invalid proportion widths', async () => {
    const session = makeSession('admin');
    const report = financialReport(session.community!.id, currentLocalMonth());
    report.liabilitySummary.billsCount = 0;
    report.liabilitySummary.statusCounts = {
      pending: 0,
      partially_paid: 0,
      paid: 0,
      overdue: 0,
    };
    report.collectionActivity.totalReceivedMinor = 0;
    report.collectionActivity.methods = {
      upi: { count: 0, totalMinor: 0 },
      cash: { count: 0, totalMinor: 0 },
      bank_transfer: { count: 0, totalMinor: 0 },
      cheque: { count: 0, totalMinor: 0 },
    };
    reportActions.getReport.mockResolvedValue(report);

    renderReports(session);

    expect(await screen.findByRole('heading', { name: 'Financial Reports' })).toBeInTheDocument();
    expect(
      document.querySelector('.financial-report-status-row .financial-report-track > span'),
    ).toHaveStyle({ width: '0%' });
    expect(
      document.querySelector('.financial-report-method-row .financial-report-track > span'),
    ).toHaveStyle({ width: '0%' });
  });

  it('requests a changed month and hides old figures until the new canonical response arrives', async () => {
    const session = makeSession('admin');
    const pendingNext = deferred<BillingV2FinancialReport>();
    reportActions.getReport
      .mockResolvedValueOnce(financialReport(session.community!.id, currentLocalMonth()))
      .mockReturnValueOnce(pendingNext.promise);
    renderReports(session);
    expect(await screen.findByText('₹1,234.56')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Billing period'), { target: { value: '2026-09' } });

    await waitFor(() =>
      expect(reportActions.getReport).toHaveBeenLastCalledWith(session, '2026-09'),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading financial report');
    expect(screen.queryByText('₹1,234.56')).not.toBeInTheDocument();
    await act(async () => pendingNext.resolve(financialReport(session.community!.id, '2026-09')));
    expect(await screen.findByText('₹1,234.56')).toBeInTheDocument();
  });

  it('clears old figures on failure and shows a safe error without zero fallback', async () => {
    const session = makeSession('admin');
    reportActions.getReport.mockResolvedValueOnce(
      financialReport(session.community!.id, currentLocalMonth()),
    );
    renderReports(session);
    expect(await screen.findByText('₹1,234.56')).toBeInTheDocument();
    reportActions.getReport.mockRejectedValueOnce(new Error('private backend details'));

    fireEvent.change(screen.getByLabelText('Billing period'), { target: { value: '2026-09' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Financial report is unavailable.');
    expect(screen.queryByText('₹1,234.56')).not.toBeInTheDocument();
    expect(screen.queryByText('₹0.00')).not.toBeInTheDocument();
    expect(screen.queryByText('private backend details')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export financial CSV' })).toBeDisabled();
  });

  it('keeps the financial CSV disabled until success and exports only canonical summary fields', async () => {
    const session = makeSession('admin');
    const pending = deferred<BillingV2FinancialReport>();
    reportActions.getReport.mockReturnValueOnce(pending.promise);
    const { container } = renderReports(session);
    const exportButton = screen.getByRole('button', { name: 'Export financial CSV' });
    expect(exportButton).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export summary' })).toBeEnabled();

    const previousCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const previousRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    const createObjectURL = vi.fn(() => 'blob:report');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let exportedBlob: Blob | undefined;
    createObjectURL.mockImplementation((blob?: Blob | MediaSource) => {
      exportedBlob = blob as Blob;
      return 'blob:report';
    });
    await act(async () =>
      pending.resolve(financialReport(session.community!.id, currentLocalMonth())),
    );
    expect(await screen.findByRole('button', { name: 'Export financial CSV' })).toBeEnabled();
    fireEvent.click(exportButton);
    await waitFor(() => expect(click).toHaveBeenCalled());
    const csv = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(exportedBlob!);
    });
    expect(csv).toContain('community id');
    expect(csv).toContain(session.community!.id);
    expect(csv).toContain(session.community!.name);
    expect(csv).toContain(currentLocalMonth());
    expect(csv).toContain('2026-10-03T04:05:06.000Z');
    expect(csv).toContain('"total billed minor","123456"');
    expect(csv).toContain('"collections received minor","51234"');
    expect(csv).toContain('"bank transfer amount minor","30000"');
    expect(csv).toContain('"total available resident credit minor","98765"');
    expect(csv).not.toContain('resident statement');
    if (previousCreateObjectURL)
      Object.defineProperty(URL, 'createObjectURL', previousCreateObjectURL);
    else Reflect.deleteProperty(URL, 'createObjectURL');
    if (previousRevokeObjectURL)
      Object.defineProperty(URL, 'revokeObjectURL', previousRevokeObjectURL);
    else Reflect.deleteProperty(URL, 'revokeObjectURL');
    click.mockRestore();
    expect(container.querySelectorAll('input[type="month"]')).toHaveLength(1);
  });

  it('preserves operational counts and the existing summary export', async () => {
    const session = makeSession('admin');
    reportActions.getReport.mockResolvedValue(
      financialReport(session.community!.id, currentLocalMonth()),
    );
    renderReports(session);
    expect(screen.getByRole('heading', { name: 'Residents' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Visitors' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Complaints' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bills' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export summary' })).toBeEnabled();
    expect(await screen.findByRole('heading', { name: 'Financial Reports' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Community overview' })).toBeInTheDocument();
  });

  it('does not let an older period response replace the latest selected period', async () => {
    const session = makeSession('admin');
    const currentMonth = currentLocalMonth();
    const [year, month] = currentMonth.split('-').map(Number);
    const previousDate = new Date(year, month - 2, 1);
    const previousMonth = `${previousDate.getFullYear()}-${String(
      previousDate.getMonth() + 1,
    ).padStart(2, '0')}`;

    const oldRequest = deferred<BillingV2FinancialReport>();
    const latestRequest = deferred<BillingV2FinancialReport>();

    reportActions.getReport
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(latestRequest.promise);

    renderReports(session);

    fireEvent.change(screen.getByLabelText('Billing period'), {
      target: { value: previousMonth },
    });

    await waitFor(() => expect(reportActions.getReport).toHaveBeenCalledTimes(2));

    // Latest selected period has a clearly different billed amount.
    const latestReport = financialReport(session.community!.id, previousMonth);
    latestReport.liabilitySummary.billedMinor = 222222;

    await act(async () => latestRequest.resolve(latestReport));

    expect(await screen.findByText('₹2,222.22')).toBeInTheDocument();

    // The older request finishes later with a different value.
    // It must NOT replace the latest selected-period report.
    const oldReport = financialReport(session.community!.id, currentMonth);
    oldReport.liabilitySummary.billedMinor = 999999;

    await act(async () => oldRequest.resolve(oldReport));

    expect(screen.getByLabelText('Billing period')).toHaveValue(previousMonth);
    expect(screen.getByText('₹2,222.22')).toBeInTheDocument();
    expect(screen.queryByText('₹9,999.99')).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Export financial CSV' })).toBeEnabled();
  });

  it('reloads and clears the displayed report when the selected community changes', async () => {
    const firstSession = makeSession('admin');
    const otherCommunityId = firstSession.communities.find(
      (item) => item.id !== firstSession.community!.id,
    )!.id;
    const firstReport = financialReport(firstSession.community!.id, currentLocalMonth());
    const nextRequest = deferred<BillingV2FinancialReport>();
    reportActions.getReport
      .mockResolvedValueOnce(firstReport)
      .mockReturnValueOnce(nextRequest.promise);
    const view = renderReports(firstSession);
    expect(await screen.findByText('₹1,234.56')).toBeInTheDocument();

    view.rerender(
      <AuthContext value={authState(withCommunity(firstSession, otherCommunityId))}>
        <ReportsPage />
      </AuthContext>,
    );

    await waitFor(() =>
      expect(reportActions.getReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ community: expect.objectContaining({ id: otherCommunityId }) }),
        currentLocalMonth(),
      ),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading financial report');
    expect(screen.queryByText('₹1,234.56')).not.toBeInTheDocument();
    await act(async () =>
      nextRequest.resolve(financialReport(otherCommunityId, currentLocalMonth())),
    );
    expect(await screen.findByText('₹1,234.56')).toBeInTheDocument();
  });
});
