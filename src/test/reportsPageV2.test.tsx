import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingV2FinancialReport, DetailedFinancialReport } from '../actions';
import type { Session } from '../models';
import { ReportsPage } from '../pages';
import { AuthContext, type AuthState } from '../session';
import { makeSession } from './fixtures';

const reportActions = vi.hoisted(() => ({ getReport: vi.fn(), getDetailedReport: vi.fn(), getResidents: vi.fn() }));
const rowMocks = vi.hoisted(() => ({ useRows: vi.fn() }));
const pdfMocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('../financialReportPdf', () => ({ createFinancialReportPdf: pdfMocks.create }));

vi.mock('../actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../actions')>();
  return { ...actual, getBillingV2FinancialReport: reportActions.getReport, getAdminBillingV2DetailedReport: reportActions.getDetailedReport, getAdminFinancialResidents: reportActions.getResidents };
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
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['logo']) })));
  reportActions.getReport.mockReset();
  reportActions.getDetailedReport.mockReset();
  reportActions.getResidents.mockReset();
  rowMocks.useRows.mockReset();
  pdfMocks.create.mockReset();
  pdfMocks.create.mockResolvedValue({ blob: new Blob(['%PDF-'], { type: 'application/pdf' }), pageCount: 1 });
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

afterEach(() => vi.unstubAllGlobals());

function detailedReport(communityId: string): DetailedFinancialReport {
  return {
    success: true as const, schemaVersion: 1 as const, communityId,
    reportingPeriod: {fromMs: 0, toMs: 1, from: 'from', to: 'to'}, generatedAtMs: 1760000000000,
    reportType: 'all' as const,
    totals: {residentsCount: 2, billedMinor: 30000, paidMinor: 20000, creditAppliedMinor: 0, availableCreditMinor: 0, outstandingMinor: 10000},
    rows: [
      {residentId: 'active', identity: {name: 'Active Resident', phone: '+639171111111', unit: 'A-01', residentType: 'owner', deleted: false}, bills: [{billId: 'b1', description: 'Maintenance', billingPeriod: '2026-10', amountMinor: 10000, paidMinor: 5000, outstandingMinor: 5000, status: 'partially_paid', settlements: [{transactionId: 'tx1', amountMinor: 5000, receivedAmountMinor: 5000, method: 'cash', reference: 'CASH-1', receivedAtMs: 1760000000000, createdAtMs: 1760000000000}]}], payments: [], billedMinor: 10000, paidMinor: 5000, creditAppliedMinor: 0, availableCreditMinor: 0, outstandingMinor: 5000, paymentStatus: 'partially_paid'},
      {residentId: 'deleted', identity: {name: 'Former Resident', phone: '+639172222222', unit: 'B-02', residentType: 'tenant', deleted: true}, bills: [], payments: [], billedMinor: 20000, paidMinor: 15000, creditAppliedMinor: 0, availableCreditMinor: 0, outstandingMinor: 5000, paymentStatus: 'partially_paid'},
    ],
  };
}

describe('ReportsPage Billing V2 financial report', () => {
  it('requires an actual resident selection and sends its stable ID for same-name residents', async () => {
    const session = makeSession('admin');
    const report = detailedReport(session.community!.id);
    report.rows[0].identity = {name: 'test acct 6', phone: '+919500000000', unit: 'P016', residentType: 'owner', deleted: false};
    report.rows[1].identity = {name: 'test acct 6', phone: '+16505553436', unit: 'V015', residentType: 'owner', deleted: true};
    reportActions.getReport.mockResolvedValue(financialReport(session.community!.id, currentLocalMonth()));
    reportActions.getResidents.mockResolvedValue(report.rows.map(({residentId, identity}) => ({residentId, identity})));
    reportActions.getDetailedReport.mockResolvedValue({...report, reportType: 'individual', rows: [report.rows[1]]});
    renderReports(session);
    expect(screen.getByRole('button', {name: 'Generate Report'})).toBeVisible();
    expect(screen.queryByLabelText('Search resident')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Report Type'), {target: {value: 'individual'}});
    expect(screen.queryByRole('button', {name: 'Generate Report'})).not.toBeInTheDocument();
    await screen.findByRole('option', {name: 'test acct 6 · +16505553436 · V015 · Deleted'});
    fireEvent.change(screen.getByLabelText('Search resident'), {target: {value: 'test acct 6'}});
    expect(within(screen.getByRole('listbox', {name: 'Residents'})).getAllByRole('option')).toHaveLength(2);
    expect(screen.queryByRole('button', {name: 'Generate Report'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', {name: 'test acct 6 · +16505553436 · V015 · Deleted'}));
    fireEvent.click(screen.getByRole('button', {name: 'Generate Report'}));
    await waitFor(() => expect(reportActions.getDetailedReport).toHaveBeenCalledWith(session, {fromMs: 0, toMs: 253402300799999}, 'deleted'));
    expect(await screen.findByRole('heading', {name: 'test acct 6 (Deleted)'})).toBeInTheDocument();
  });
  it('generates all-resident report without standalone resident headings and displays ledger totals', async () => {
    const session = makeSession('admin');
    reportActions.getReport.mockResolvedValue(financialReport(session.community!.id, currentLocalMonth()));
    reportActions.getDetailedReport.mockResolvedValue(detailedReport(session.community!.id));
    renderReports(session);
    fireEvent.click(screen.getByRole('button', {name: 'Generate Report'}));
    expect(await screen.findByRole('heading', {name: 'Dues register'})).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Payment allocations'})).toBeInTheDocument();
    expect(screen.queryByRole('heading', {name: 'Former Resident (Deleted)'})).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', {name: 'Active Resident (Active)'})).not.toBeInTheDocument();
    const totals = within(screen.getByLabelText('Resident report totals'));
    expect(totals.getByText('₹300.00')).toBeInTheDocument();
    expect(totals.getByText('₹200.00')).toBeInTheDocument();
    expect(totals.getByText('₹100.00')).toBeInTheDocument();
    expect(screen.getByRole('cell', {name: 'cash / CASH-1'})).toBeInTheDocument();
    expect(reportActions.getDetailedReport).toHaveBeenCalledWith(session, expect.objectContaining({fromMs: 0, toMs: 253402300799999}), undefined);
  });

  it('keeps filtering and both exports available in All Residents mode', async () => {
    const session = makeSession('admin');
    reportActions.getReport.mockResolvedValue(financialReport(session.community!.id, currentLocalMonth()));
    reportActions.getDetailedReport.mockResolvedValue(detailedReport(session.community!.id));
    const oldCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const oldRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:resident-report') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      renderReports(session);
      fireEvent.click(screen.getByRole('button', {name: 'Generate Report'}));
      await screen.findByRole('heading', {name: 'Dues register'});
      expect(screen.getAllByRole('cell', {name: 'Active Resident'}).length).toBeGreaterThan(0);

      fireEvent.change(screen.getByLabelText('Search dues'), {target: {value: 'no matching charge'}});
      expect(await screen.findByText('No charges match the selected filters.')).toBeInTheDocument();
      expect(screen.getByRole('button', {name: 'Export CSV'})).toBeEnabled();
      expect(screen.getByRole('button', {name: 'Export PDF'})).toBeEnabled();

      fireEvent.click(screen.getByRole('button', {name: 'Export CSV'}));
      await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', {name: 'Export PDF'}));
      await waitFor(() => expect(pdfMocks.create).toHaveBeenCalledWith(expect.objectContaining({rows: expect.any(Array), mode: 'all'})));
    } finally {
      if (oldCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', oldCreateObjectURL); else Reflect.deleteProperty(URL, 'createObjectURL');
      if (oldRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', oldRevokeObjectURL); else Reflect.deleteProperty(URL, 'revokeObjectURL');
      click.mockRestore();
    }
  });

  it('downloads a 20-page PDF without a warning and confirms the actual page count above the threshold', async () => {
    const session = makeSession('admin');
    reportActions.getReport.mockResolvedValue(financialReport(session.community!.id, currentLocalMonth()));
    reportActions.getDetailedReport.mockResolvedValue(detailedReport(session.community!.id));
    const oldCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const createObjectURL = vi.fn(() => 'blob:financial-pdf');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      const { unmount } = renderReports(session);
      fireEvent.click(screen.getByRole('button', { name: 'Generate Report' }));
      await screen.findByRole('button', { name: 'Export PDF' });
      pdfMocks.create.mockResolvedValueOnce({ blob: new Blob(['twenty'], { type: 'application/pdf' }), pageCount: 20 });
      fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
      await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
      expect(fetch).toHaveBeenCalledWith('/images/hominode-report-logo.png');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      pdfMocks.create.mockResolvedValueOnce({ blob: new Blob(['twenty-one'], { type: 'application/pdf' }), pageCount: 21 });
      fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
      expect(await screen.findByRole('dialog', { name: 'Large PDF report' })).toHaveTextContent('21 pages');
      expect(pdfMocks.create).toHaveBeenCalledTimes(2);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(click).toHaveBeenCalledTimes(1);

      pdfMocks.create.mockResolvedValueOnce({ blob: new Blob(['twenty-one-again'], { type: 'application/pdf' }), pageCount: 21 });
      fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
      expect(await screen.findByRole('dialog', { name: 'Large PDF report' })).toHaveTextContent('21 pages');
      expect(pdfMocks.create).toHaveBeenCalledTimes(3);
      fireEvent.click(screen.getByRole('button', { name: 'Download PDF anyway' }));
      await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
      expect(pdfMocks.create).toHaveBeenCalledTimes(3);
      unmount();
    } finally {
      if (oldCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', oldCreateObjectURL); else Reflect.deleteProperty(URL, 'createObjectURL');
      click.mockRestore();
    }
  });

  it('prevents duplicate PDF generation and allows retry after a generation failure', async () => {
    const session = makeSession('admin');
    reportActions.getReport.mockResolvedValue(financialReport(session.community!.id, currentLocalMonth()));
    reportActions.getDetailedReport.mockResolvedValue(detailedReport(session.community!.id));
    const oldCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const createObjectURL = vi.fn(() => 'blob:financial-pdf');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let finish!: (value: { blob: Blob; pageCount: number }) => void;
    try {
      renderReports(session);
      fireEvent.click(screen.getByRole('button', { name: 'Generate Report' }));
      await screen.findByRole('button', { name: 'Export PDF' });
      pdfMocks.create.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      const button = screen.getByRole('button', { name: 'Export PDF' });
      fireEvent.click(button);
      fireEvent.click(button);
      await waitFor(() => expect(pdfMocks.create).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: 'Generating PDF…' })).toBeDisabled();
      finish({ blob: new Blob(['%PDF-'], { type: 'application/pdf' }), pageCount: 1 });
      await waitFor(() => expect(click).toHaveBeenCalledTimes(1));

      pdfMocks.create.mockRejectedValueOnce(new Error('synthetic failure'));
      fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('PDF generation failed');
      pdfMocks.create.mockResolvedValueOnce({ blob: new Blob(['retry'], { type: 'application/pdf' }), pageCount: 1 });
      fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
      await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
    } finally {
      if (oldCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', oldCreateObjectURL); else Reflect.deleteProperty(URL, 'createObjectURL');
      click.mockRestore();
    }
  });

  it('exports canonical resident totals and receipt timestamps for all residents and a selected deleted resident', async () => {
    const session = makeSession('admin');
    const response = detailedReport(session.community!.id);
    response.rows[0].identity.name = '=SUM(1,1)';
    response.rows[0].bills[0].chargeCategory = 'Maintenance';
    response.coverageWarnings = ['Some legacy payments need reconciliation.'];
    // A retained resident can have no bills in the selected range and still
    // have receipt activity and available credit that must survive export.
    response.rows[1].payments = [{transactionId: 'old-bill-payment', amountMinor: 0, receivedAmountMinor: 18000, method: 'cash', reference: 'FORMER-RECEIPT', receivedAtMs: 1760000000000, createdAtMs: 1760000001000}];
    response.rows[1].availableCreditMinor = 3000;
    response.totals.availableCreditMinor = 3000;
    reportActions.getReport.mockResolvedValue(financialReport(session.community!.id, currentLocalMonth()));
    reportActions.getDetailedReport.mockResolvedValue(response);
    reportActions.getResidents.mockResolvedValue(response.rows.map(({residentId, identity}) => ({residentId, identity})));
    renderReports(session);
    fireEvent.click(screen.getByRole('button', {name: 'Generate Report'}));
    await screen.findByRole('heading', {name: 'Dues register'});
    const blobs: Blob[] = [];
    const oldCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const oldRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:detailed'; })});
    Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: vi.fn()});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const readCsv = (blob: Blob) => new Promise<string>((resolve) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob);
    });
    try {
      fireEvent.click(screen.getByRole('button', {name: 'Export CSV'}));
      const allCsv = await readCsv(blobs[0]);
      expect(allCsv).toContain('"Record type","Community","Report from","Report to","Generated at"');
      expect(allCsv).toContain('"allocation"');
      expect(allCsv).toContain('"receipt"');
      expect(allCsv).toContain('"Maintenance"');
      expect(allCsv).toContain('"coverage_warning"');
      expect(allCsv).toContain('"100.00"');
      expect(allCsv).toContain('"50.00"');
      expect(allCsv).toContain('"\'=SUM(1,1)"');
      expect(allCsv).toContain('"old-bill-payment"');
      expect(allCsv).toContain('"FORMER-RECEIPT"');
      expect(allCsv).not.toContain('"Total billed minor"');
      fireEvent.click(screen.getByLabelText('Privacy-safe notice export'));
      fireEvent.click(screen.getByRole('button', {name: 'Export CSV'}));
      const noticeCsv = await readCsv(blobs[1]);
      expect(noticeCsv).toContain('"A-01"');
      expect(noticeCsv).not.toContain('+639172222222');
      expect(noticeCsv).not.toContain('FORMER-RECEIPT');
      expect(noticeCsv).not.toContain('old-bill-payment');
      fireEvent.click(screen.getByLabelText('Privacy-safe notice export'));
      fireEvent.change(screen.getByLabelText('Report Type'), {target: {value: 'individual'}});
      expect(screen.queryByRole('button', {name: 'Generate Report'})).not.toBeInTheDocument();
      await screen.findByRole('option', {name: 'Former Resident · +639172222222 · B-02 · Deleted'});
      fireEvent.change(screen.getByLabelText('Search resident'), {target: {value: 'Former'}});
      expect(within(screen.getByRole('listbox', {name: 'Residents'})).getAllByRole('option')).toHaveLength(1);
      fireEvent.click(screen.getByRole('option', {name: 'Former Resident · +639172222222 · B-02 · Deleted'}));
      expect(screen.getByRole('button', {name: 'Generate Report'})).toBeEnabled();
      fireEvent.click(screen.getByRole('button', {name: 'Generate Report'}));
      await waitFor(() => expect(reportActions.getDetailedReport).toHaveBeenLastCalledWith(session, {fromMs: 0, toMs: 253402300799999}, 'deleted'));
      expect(screen.queryByRole('heading', {name: 'Active Resident (Active)'})).not.toBeInTheDocument();
      await screen.findByRole('heading', {name: 'Former Resident (Deleted)'});
      fireEvent.click(screen.getByRole('button', {name: 'Export CSV'}));
      const individualCsv = await readCsv(blobs[2]);
      expect(individualCsv).toContain('"receipt"');
      expect(individualCsv).toContain('FORMER-RECEIPT');
      expect(individualCsv).not.toContain('Active Resident');
    } finally {
      if (oldCreate) Object.defineProperty(URL, 'createObjectURL', oldCreate); else Reflect.deleteProperty(URL, 'createObjectURL');
      if (oldRevoke) Object.defineProperty(URL, 'revokeObjectURL', oldRevoke); else Reflect.deleteProperty(URL, 'revokeObjectURL');
      click.mockRestore();
    }
  });
  it('adds operational analytics without deriving financial totals from bill rows', async () => {
    const session = makeSession('admin');
    reportActions.getReport.mockResolvedValue(
      financialReport(session.community!.id, currentLocalMonth()),
    );
    const operationalRows: Record<string, Array<Record<string, unknown>>> = {
      billing: [{ amountMinor: 99999999, paidAmountMinor: 99999999, status: 'paid' }],
      units: [
        { status: 'occupied' },
        { status: 'vacant' },
        { status: 'reserved' },
        { status: 'maintenance' },
      ],
      complaints: [{ status: 'resolved' }, { status: 'closed' }, { status: 'open' }],
      deliveries: [{ status: 'collected' }, { status: 'delivered' }, { status: 'pending' }],
      bookings: [{ status: 'confirmed' }],
    };
    rowMocks.useRows.mockImplementation((_session: Session, module: string) => ({
      rows: (operationalRows[module] ?? []).map((data, index) => ({ id: String(index), data })),
      loading: false,
      error: '',
    }));
    renderReports(session);
    expect(await screen.findByText('₹1,234.56')).toBeInTheDocument();
    expect(screen.queryByText('₹9,99,999.99')).not.toBeInTheDocument();
    const occupancy = screen.getByRole('heading', { name: 'Community Occupancy' }).parentElement!.parentElement!;
    expect(within(occupancy).getByText('25%')).toBeInTheDocument();
    const complaints = screen.getByRole('heading', { name: 'Complaint resolution' }).parentElement!.parentElement!;
    expect(within(complaints).getByText('67%')).toBeInTheDocument();
    const deliveries = screen.getByRole('heading', { name: 'Delivery activity' }).parentElement!.parentElement!;
    expect(within(deliveries).getByText('Completed / collected').parentElement).toHaveTextContent(
      '2',
    );
    expect(screen.getByRole('heading', { name: 'Bookings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export summary' })).toBeEnabled();
  });

  it.each(['units', 'deliveries', 'bookings'])(
    'blocks incomplete operational exports when %s is loading or fails, without blocking canonical finance',
    async (module) => {
      const session = makeSession('admin');
      reportActions.getReport.mockResolvedValue(
        financialReport(session.community!.id, currentLocalMonth()),
      );
      let loading = true;
      rowMocks.useRows.mockImplementation((_session: Session, requested: string) => ({
        rows: [],
        loading: requested === module && loading,
        error: requested === module && !loading ? 'Operational data unavailable.' : '',
      }));
      const view = renderReports(session);
      expect(await screen.findByText('₹1,234.56')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Export summary' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Export financial CSV' })).toBeEnabled();
      loading = false;
      view.rerender(
        <AuthContext value={authState(session)}>
          <ReportsPage />
        </AuthContext>,
      );
      expect(screen.getByRole('button', { name: 'Export summary' })).toBeDisabled();
      expect(screen.getByText(/Some analytics are unavailable/)).toBeInTheDocument();
      expect(screen.getByText('₹1,234.56')).toBeInTheDocument();
      if (module === 'units') expect(screen.queryByText('Occupancy rate')).not.toBeInTheDocument();
      if (module === 'deliveries')
        expect(screen.queryByText('Completed / collected')).not.toBeInTheDocument();
    },
  );

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
      'bookings',
      'complaints',
      'deliveries',
      'residents',
      'units',
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
