import { amount, dateOf, status, type Data, type Row } from './models';

function numberValue(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replaceAll(',', ''))
        : NaN;
  return Number.isFinite(n) ? n : null;
}

function minorAmount(data: Data, key: string): number | null {
  const value = numberValue(data[key]);
  return value == null ? null : value / 100;
}

function majorAmount(data: Data, key: string): number | null {
  const value = numberValue(data[key]);
  return value == null ? null : value;
}

export function billTotalAmount(data: Data): number {
  return minorAmount(data, 'amountMinor') ?? amount(data);
}

export function billPaidAmount(data: Data): number {
  const paid =
    minorAmount(data, 'paidAmountMinor') ??
    majorAmount(data, 'paidAmount') ??
    majorAmount(data, 'amountPaid');
  if (paid != null) return Math.max(0, paid);

  return ['paid', 'settled', 'approved', 'completed'].includes(status(data))
    ? billTotalAmount(data)
    : 0;
}

export function billCreditAmount(data: Data): number {
  return (
    minorAmount(data, 'creditAppliedMinor') ??
    majorAmount(data, 'creditApplied') ??
    0
  );
}

export function billOutstandingAmount(data: Data): number {
  const stored =
    minorAmount(data, 'outstandingAmountMinor') ??
    majorAmount(data, 'outstandingAmount') ??
    majorAmount(data, 'balanceAmount');

  if (stored != null) return Math.max(0, stored);

  return Math.max(0, billTotalAmount(data) - billPaidAmount(data) - billCreditAmount(data));
}

function dueAt(data: Data): Date | null {
  return dateOf(data.dueDate) ?? dateOf(data.dueDateKey);
}

export function billIsOverdue(data: Data, nowMs = Date.now()): boolean {
  if (billOutstandingAmount(data) <= 0) return false;
  if (status(data) === 'overdue') return true;
  const due = dueAt(data);
  return due != null && due.getTime() < nowMs;
}

export interface BillingReportMetrics {
  billed: number;
  collected: number;
  credited: number;
  pending: number;
  overdue: number;
  collectionRate: number;
  paidBills: number;
  partialBills: number;
  outstandingBills: number;
}

export function billingReportMetrics(
  rows: readonly Row[],
  nowMs = Date.now(),
): BillingReportMetrics {
  let billed = 0;
  let collected = 0;
  let credited = 0;
  let pending = 0;
  let overdue = 0;
  let paidBills = 0;
  let partialBills = 0;
  let outstandingBills = 0;

  for (const row of rows) {
    const data = row.data;
    const total = billTotalAmount(data);
    const paid = billPaidAmount(data);
    const credit = billCreditAmount(data);
    const outstanding = billOutstandingAmount(data);
    const state = status(data);

    billed += total;
    collected += paid;
    credited += credit;

    if (outstanding > 0) {
      outstandingBills += 1;
      if (billIsOverdue(data, nowMs)) overdue += outstanding;
      else pending += outstanding;
    }

    if (outstanding <= 0 || ['paid', 'settled', 'approved', 'completed'].includes(state)) {
      paidBills += 1;
    } else if (paid > 0 || state === 'partiallypaid') {
      partialBills += 1;
    }
  }

  return {
    billed,
    collected,
    credited,
    pending,
    overdue,
    collectionRate: billed > 0 ? Math.round((collected / billed) * 100) : 0,
    paidBills,
    partialBills,
    outstandingBills,
  };
}
