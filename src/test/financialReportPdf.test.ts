import { describe, expect, it } from 'vitest';
import { createFinancialReportPdf, type FinancialPdfInput } from '../financialReportPdf';
import type { DetailedFinancialReport, DetailedFinancialReportRow } from '../actions';

function row(index: number): DetailedFinancialReportRow {
  return {
    residentId: `resident-${index}`,
    identity: { name: `Resident ${index} with a deliberately long account holder name`, phone: '+919876543210', unit: `Tower A / Unit ${index}`, residentType: 'owner', deleted: false },
    bills: [{ billId: `bill-${index}`, chargeCategory: index % 2 ? 'corpus_fund' : 'maintenance', description: `Monthly maintenance charge with a long description for row ${index}`, billingPeriod: '2026-10', amountMinor: 12500, paidMinor: 5000, creditAppliedMinor: 500, outstandingMinor: 7000, status: 'partially_paid', settlements: [{ transactionId: `tx-${index}`, amountMinor: 5000, receivedAmountMinor: 7000, method: 'upi', reference: `ref-${index}`, receivedAtMs: 1760000000000, createdAtMs: 1760000001000 }] }],
    payments: [{ transactionId: `tx-${index}`, amountMinor: 5000, receivedAmountMinor: 7000, method: 'upi', reference: `ref-${index}`, receivedAtMs: 1760000000000, createdAtMs: 1760000001000 }],
    billedMinor: 12500, paidMinor: 5000, creditAppliedMinor: 500, availableCreditMinor: 300, outstandingMinor: 7000, paymentStatus: 'partially_paid',
  };
}

function input(rows: DetailedFinancialReportRow[], overrides: Partial<FinancialPdfInput> = {}): FinancialPdfInput {
  const totals = rows.reduce((result, item) => ({
    residentsCount: result.residentsCount + 1,
    billedMinor: result.billedMinor + item.billedMinor,
    paidMinor: result.paidMinor + item.paidMinor,
    creditAppliedMinor: result.creditAppliedMinor + item.creditAppliedMinor,
    outstandingMinor: result.outstandingMinor + item.outstandingMinor,
    availableCreditMinor: result.availableCreditMinor + item.availableCreditMinor,
  }), { residentsCount: 0, billedMinor: 0, paidMinor: 0, creditAppliedMinor: 0, outstandingMinor: 0, availableCreditMinor: 0 });
  const report: DetailedFinancialReport = { success: true, schemaVersion: 1, communityId: 'community-1', reportingPeriod: { fromMs: 0, toMs: 1, from: 'from', to: 'to' }, generatedAtMs: 1760000000000, reportType: rows.length === 1 ? 'individual' : 'all', rows, coverageWarnings: [], totals };
  return { report, rows, mode: rows.length === 1 ? 'individual' : 'all', communityName: 'Hominode Test Community', generatedAt: new Date(1760000000000), timeZone: 'Asia/Manila', filters: { from: '2026-10-01', to: '2026-10-31', duesOnly: false, category: 'all', search: '', privacySafe: false }, ...overrides };
}

describe('financial report PDF', () => {
  it('creates a valid one-page A4 PDF for an empty report', async () => {
    const result = await createFinancialReportPdf(input([]));
    expect(result.pageCount).toBe(1);
    expect(result.blob.type).toBe('application/pdf');
    const prefix = await new Promise<string>((resolve) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
      reader.readAsText(result.blob.slice(0, 5));
    });
    expect(prefix).toBe('%PDF-');
  });

  it('paginates long synthetic reports and includes complete records', async () => {
    const rows = Array.from({ length: 140 }, (_, index) => row(index + 1));
    const result = await createFinancialReportPdf(input(rows));
    expect(result.pageCount).toBeGreaterThan(1);
    expect(result.blob.size).toBeGreaterThan(10000);
  });

  it('reports the exact actual page count at and above the 20-page threshold', async () => {
    let low = 0;
    let high = 800;
    while (low < high) {
      const count = Math.floor((low + high) / 2);
      const result = await createFinancialReportPdf(input(Array.from({ length: count }, (_, index) => row(index + 1))));
      if (result.pageCount >= 20) high = count;
      else low = count + 1;
    }
    let twenty = await createFinancialReportPdf(input(Array.from({ length: low }, (_, index) => row(index + 1))));
    while (twenty.pageCount > 20 && low > 0) {
      low--;
      twenty = await createFinancialReportPdf(input(Array.from({ length: low }, (_, index) => row(index + 1))));
    }
    while (twenty.pageCount < 20) {
      low++;
      twenty = await createFinancialReportPdf(input(Array.from({ length: low }, (_, index) => row(index + 1))));
    }
    expect(twenty.pageCount).toBe(20);
    let twentyOne = await createFinancialReportPdf(input(Array.from({ length: low + 1 }, (_, index) => row(index + 1))));
    let overCount = low + 1;
    while (twentyOne.pageCount === 20) {
      overCount++;
      twentyOne = await createFinancialReportPdf(input(Array.from({ length: overCount }, (_, index) => row(index + 1))));
    }
    expect(twentyOne.pageCount).toBe(21);
  });

  it('keeps privacy-safe statements limited to the unit and due amount register', async () => {
    const data = input([row(1)], { mode: 'all', filters: { from: '', to: '', duesOnly: true, category: 'maintenance', search: 'Tower A', privacySafe: true } });
    const result = await createFinancialReportPdf(data);
    expect(result.pageCount).toBe(1);
    expect(result.blob.size).toBeGreaterThan(1000);
  });
});
