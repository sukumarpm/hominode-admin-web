import { describe, expect, it } from 'vitest';
import { billingReportMetrics } from '../reportMetrics';
import type { Row } from '../models';

function row(id: string, data: Row['data']): Row {
  return { id, data };
}

describe('billing report metrics', () => {
  it('uses V2 paid and outstanding minor-unit fields for partial payments', () => {
    const metrics = billingReportMetrics(
      [
        row('paid', {
          amountMinor: 350000,
          paidAmountMinor: 350000,
          outstandingAmountMinor: 0,
          creditAppliedMinor: 0,
          status: 'paid',
          dueDateKey: '2026-05-10',
        }),
        row('partial', {
          amountMinor: 350000,
          paidAmountMinor: 175000,
          outstandingAmountMinor: 175000,
          creditAppliedMinor: 0,
          status: 'partially_paid',
          dueDateKey: '2026-10-10',
        }),
        row('overdue', {
          amountMinor: 350000,
          paidAmountMinor: 0,
          outstandingAmountMinor: 350000,
          creditAppliedMinor: 0,
          status: 'pending',
          dueDateKey: '2026-06-10',
        }),
      ],
      Date.parse('2026-10-07T12:00:00Z'),
    );

    expect(metrics).toEqual({
      billed: 10500,
      collected: 5250,
      credited: 0,
      pending: 1750,
      overdue: 3500,
      collectionRate: 50,
      paidBills: 1,
      partialBills: 1,
      outstandingBills: 2,
    });
  });

  it('keeps legacy paid bills compatible when minor-unit fields are absent', () => {
    const metrics = billingReportMetrics([
      row('legacy-paid', { amount: 1200, status: 'paid' }),
      row('legacy-due', { amount: 800, status: 'pending' }),
    ]);

    expect(metrics.billed).toBe(2000);
    expect(metrics.collected).toBe(1200);
    expect(metrics.pending + metrics.overdue).toBe(800);
    expect(metrics.paidBills).toBe(1);
  });
});
