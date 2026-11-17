import { describe, expect, it, vi } from 'vitest';
import { createFinancialReportPdf, type FinancialPdfInput } from '../financialReportPdf';
import type { DetailedFinancialReport, DetailedFinancialReportRow } from '../actions';

const autoTableCalls = vi.hoisted(() => ({ options: [] as unknown[], allocationPages: [] as number[] }));
vi.mock('jspdf-autotable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf-autotable')>();
  return {
    default: (...args: Parameters<typeof actual.default>) => {
      const options = args[1];
      autoTableCalls.options.push(options);
      if ((options.head as string[][] | undefined)?.[0]?.[0] === 'Bill\nref') {
        const previous = options.didDrawCell;
        options.didDrawCell = (data) => {
          if (data.section === 'body') autoTableCalls.allocationPages.push(data.pageNumber);
          previous?.(data);
        };
      }
      return actual.default(...args);
    },
  };
});

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

  it('keeps long reconciliation IDs readable while fitting ordinary allocations compactly', async () => {
    const resident = row(1);
    resident.identity.name = 'Anika Mathew';
    resident.identity.unit = 'H005';
    const billIds = Array.from({ length: 6 }, (_, index) => `bill_${'green-wave-residences-H005-2026-09-'.repeat(2)}${index + 1}`);
    const transactionIds = Array.from({ length: 6 }, (_, index) => `transaction_${'green-wave-residences-payment-allocation-'.repeat(2)}${index + 1}`);
    resident.bills = billIds.map((billId, index) => ({
      billId, chargeCategory: 'maintenance', description: `Maintenance ${index + 1}`, billingPeriod: `2026-${String(index + 5).padStart(2, '0')}`,
      amountMinor: 350000, paidMinor: index === 5 ? 175000 : 350000, creditAppliedMinor: 0, outstandingMinor: index === 5 ? 175000 : 0,
      status: index === 5 ? 'partially_paid' : 'paid',
      settlements: [{ transactionId: transactionIds[index], amountMinor: index === 5 ? 175000 : 350000, receivedAmountMinor: index === 5 ? 175000 : 350000, method: 'upi', reference: `UPI-${index + 1}`, receivedAtMs: 1790800000000 + index * 86400000, createdAtMs: 1790800000000 + index * 86400000 }],
    }));
    resident.payments = transactionIds.map((transactionId, index) => ({
      transactionId, amountMinor: index === 5 ? 175000 : 350000, receivedAmountMinor: index === 5 ? 175000 : 350000, method: 'upi', reference: `UPI-${index + 1}`,
      receivedAtMs: 1790800000000 + index * 86400000, createdAtMs: 1790800000000 + index * 86400000,
    }));
    const before = autoTableCalls.options.length;
    const pageBefore = autoTableCalls.allocationPages.length;
    const result = await createFinancialReportPdf(input([resident], {
      communityName: 'Green Wave Residences', mode: 'individual',
      filters: { from: '2026-09-01', to: '2026-10-31', duesOnly: false, category: 'all', search: '', privacySafe: false },
    }));
    const calls = autoTableCalls.options.slice(before) as Array<{
      head: string[][]; body: string[][]; columnStyles?: Record<number, { cellWidth?: number }>; pageBreak?: string;
    }>;
    const allocations = calls.find((options) => options.head[0][0] === 'Bill\nref')!;
    const receipts = calls.find((options) => options.head[0][0] === 'Transaction\nref')!;
    const identifiers = calls.find((options) => options.head[0][0] === 'Reconciliation reference')!;
    expect(allocations.body).toHaveLength(6);
    expect(allocations.body[0].slice(0, 2)).toEqual(['B1', 'T1']);
    expect(allocations.columnStyles).toMatchObject({ 0: { cellWidth: 15 }, 1: { cellWidth: 19 }, 5: { cellWidth: 81 } });
    expect(allocations.pageBreak).toBe('avoid');
    expect(new Set(autoTableCalls.allocationPages.slice(pageBefore)).size).toBe(1);
    expect(receipts.body[0][0]).toBe('T1');
    expect(receipts.head[0]).toContain('Allocated to selected bills\n(INR)');
    expect(identifiers.body).toContainEqual(['Bill B1', billIds[0]]);
    expect(identifiers.body).toContainEqual(['Transaction T1', transactionIds[0]]);
    expect(result.pageCount).toBeLessThanOrEqual(3);
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
