import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { getBillingV2FinancialReport, type BillingV2FinancialReport } from '../actions';
import { makeSession } from './fixtures';

function resolvedAuthority(session: ReturnType<typeof makeSession>) {
  if (!session.community) throw Error('Test session is missing selected community.');
  return { ...session, community: session.community };
}

function validReport(): BillingV2FinancialReport {
  return {
    success: true,
    schemaVersion: 1,
    communityId: 'community-1',
    billingPeriod: '2026-10',
    generatedAtMs: 1760000000000,
    liabilitySummary: {
      billsCount: 12,
      billedMinor: 450000,
      paidAllocationMinor: 300000,
      creditAppliedMinor: 10000,
      outstandingMinor: 140000,
      overdueOutstandingMinor: 60000,
      statusCounts: {
        pending: 4,
        partially_paid: 3,
        paid: 3,
        overdue: 2,
      },
    },
    collectionActivity: {
      transactionCount: 11,
      totalReceivedMinor: 300000,
      methods: {
        upi: { count: 5, totalMinor: 170000 },
        cash: { count: 3, totalMinor: 70000 },
        bank_transfer: { count: 2, totalMinor: 50000 },
        cheque: { count: 1, totalMinor: 10000 },
      },
    },
    creditPosition: {
      accountsCount: 8,
      residentsWithCreditCount: 2,
      totalAvailableCreditMinor: 25000,
    },
  };
}

describe('Admin Web Billing V2 financial-report action contract', () => {
  it('calls getBillingV2FinancialReport callable with exact name and payload', async () => {
    const session = makeSession('admin');
    const invokeCall = vi.fn().mockResolvedValue(validReport());

    await getBillingV2FinancialReport(session, '2026-10', {
      resolveAuthority: async () => resolvedAuthority(session),
      invokeCall,
    });

    expect(invokeCall).toHaveBeenCalledTimes(1);
    expect(invokeCall).toHaveBeenCalledWith('getBillingV2FinancialReport', {
      communityId: 'community-1',
      billingPeriod: '2026-10',
    });
  });

  it('returns the validated canonical report when response is valid', async () => {
    const session = makeSession('admin');
    const response = validReport();

    const result = await getBillingV2FinancialReport(session, '2026-10', {
      resolveAuthority: async () => resolvedAuthority(session),
      invokeCall: async () => response,
    });

    expect(result).toEqual(response);
  });

  it('requires admin role', async () => {
    const session = makeSession('resident');
    const invokeCall = vi.fn();

    await expect(
      getBillingV2FinancialReport(session, '2026-10', {
        resolveAuthority: async () => resolvedAuthority(session),
        invokeCall,
      }),
    ).rejects.toThrow('An administrator is required.');
    expect(invokeCall).toHaveBeenCalledTimes(0);
  });

  it('requires selected authorized community', async () => {
    const session = makeSession('admin');
    const invokeCall = vi.fn();

    await expect(
      getBillingV2FinancialReport(session, '2026-10', {
        resolveAuthority: async () => ({
          ...resolvedAuthority(session),
          community: { ...resolvedAuthority(session).community, id: 'community-9' },
        }),
        invokeCall,
      }),
    ).rejects.toThrow('Select an authorized community.');
    expect(invokeCall).toHaveBeenCalledTimes(0);
  });

  it.each(['2026-1', '2026-13', '2026-00', '202610', '20A6-10', ' 2026-10', '2026-10 '])(
    'rejects invalid billing period %s',
    async (billingPeriod) => {
      const session = makeSession('admin');
      await expect(
        getBillingV2FinancialReport(session, billingPeriod, {
          resolveAuthority: async () => resolvedAuthority(session),
          invokeCall: async () => validReport(),
        }),
      ).rejects.toThrow('Billing period must be in YYYY-MM format.');
    },
  );

  it('rejects response community mismatch', async () => {
    const session = makeSession('admin');
    const response = validReport() as unknown as Record<string, unknown>;
    response.communityId = 'community-x';

    await expect(
      getBillingV2FinancialReport(session, '2026-10', {
        resolveAuthority: async () => resolvedAuthority(session),
        invokeCall: async () => response,
      }),
    ).rejects.toThrow('The Billing V2 financial report response could not be validated.');
  });

  it('rejects response billing period mismatch', async () => {
    const session = makeSession('admin');
    const response = validReport() as unknown as Record<string, unknown>;
    response.billingPeriod = '2026-09';

    await expect(
      getBillingV2FinancialReport(session, '2026-10', {
        resolveAuthority: async () => resolvedAuthority(session),
        invokeCall: async () => response,
      }),
    ).rejects.toThrow('The Billing V2 financial report response could not be validated.');
  });

  it('rejects wrong schemaVersion', async () => {
    const session = makeSession('admin');
    const response = validReport() as unknown as Record<string, unknown>;
    response.schemaVersion = 2;

    await expect(
      getBillingV2FinancialReport(session, '2026-10', {
        resolveAuthority: async () => resolvedAuthority(session),
        invokeCall: async () => response,
      }),
    ).rejects.toThrow('The Billing V2 financial report response could not be validated.');
  });

  it('rejects negative money values', async () => {
    const session = makeSession('admin');
    const response = validReport();
    response.liabilitySummary.billedMinor = -1;

    await expect(
      getBillingV2FinancialReport(session, '2026-10', {
        resolveAuthority: async () => resolvedAuthority(session),
        invokeCall: async () => response,
      }),
    ).rejects.toThrow('The Billing V2 financial report response could not be validated.');
  });

  it('rejects fractional money values', async () => {
    const session = makeSession('admin');
    const response = validReport();
    response.liabilitySummary.billedMinor = 100.5;

    await expect(
      getBillingV2FinancialReport(session, '2026-10', {
        resolveAuthority: async () => resolvedAuthority(session),
        invokeCall: async () => response,
      }),
    ).rejects.toThrow('The Billing V2 financial report response could not be validated.');
  });

  it('rejects unsafe integer values', async () => {
    const session = makeSession('admin');
    const response = validReport();
    response.generatedAtMs = Number.MAX_SAFE_INTEGER + 1;

    await expect(
      getBillingV2FinancialReport(session, '2026-10', {
        resolveAuthority: async () => resolvedAuthority(session),
        invokeCall: async () => response,
      }),
    ).rejects.toThrow('The Billing V2 financial report response could not be validated.');
  });

  it('rejects malformed status counts', async () => {
    const session = makeSession('admin');
    const response = validReport() as unknown as Record<string, unknown>;
    response.liabilitySummary = {
      ...(response.liabilitySummary as Record<string, unknown>),
      statusCounts: {
        pending: 4,
        partially_paid: 3,
        paid: '3',
        overdue: 2,
      },
    };

    await expect(
      getBillingV2FinancialReport(session, '2026-10', {
        resolveAuthority: async () => resolvedAuthority(session),
        invokeCall: async () => response,
      }),
    ).rejects.toThrow('The Billing V2 financial report response could not be validated.');
  });

  it('rejects malformed payment method summary', async () => {
    const session = makeSession('admin');
    const response = validReport() as unknown as Record<string, unknown>;
    const collectionActivity = response.collectionActivity as Record<string, unknown>;
    const methods = collectionActivity.methods as Record<string, unknown>;
    methods.upi = { count: 5, totalMinor: '170000' };

    await expect(
      getBillingV2FinancialReport(session, '2026-10', {
        resolveAuthority: async () => resolvedAuthority(session),
        invokeCall: async () => response,
      }),
    ).rejects.toThrow('The Billing V2 financial report response could not be validated.');
  });

  it('rejects malformed creditPosition', async () => {
    const session = makeSession('admin');
    const response = validReport() as unknown as Record<string, unknown>;
    response.creditPosition = {
      accountsCount: 8,
      residentsWithCreditCount: 2,
    };

    await expect(
      getBillingV2FinancialReport(session, '2026-10', {
        resolveAuthority: async () => resolvedAuthority(session),
        invokeCall: async () => response,
      }),
    ).rejects.toThrow('The Billing V2 financial report response could not be validated.');
  });

  it('surfaces callable failures safely', async () => {
    const session = makeSession('admin');

    await expect(
      getBillingV2FinancialReport(session, '2026-10', {
        resolveAuthority: async () => resolvedAuthority(session),
        invokeCall: async () => {
          throw Error('permission-denied');
        },
      }),
    ).rejects.toThrow('Billing V2 financial report request failed.');
  });

  it('keeps financial-ledger reconstruction out of actions', () => {
    const source = readFileSync('src/actions.ts', 'utf8');
    for (const collection of [
      'bills',
      'paymentTransactions',
      'paymentAllocations',
      'residentCreditEntries',
      'residentFinancialAccounts',
    ]) {
      expect(source).not.toContain(`collection('${collection}')`);
      expect(source).not.toContain(`collection("${collection}")`);
    }
  });
});
