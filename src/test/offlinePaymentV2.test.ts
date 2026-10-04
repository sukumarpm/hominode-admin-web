import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearOfflinePaymentAttemptV2,
  createOfflinePaymentAttemptV2,
  createOfflinePaymentIdempotencyKeyV2,
  isOfflinePaymentIdempotencyKey,
  loadOfflinePaymentAttemptV2,
  parseOfflinePaymentAmountToMinorUnits,
  parseOfflinePaymentAttemptV2,
  parseOfflinePaymentResultV2,
  requireSavedOfflinePaymentAttemptV2,
  saveOfflinePaymentAttemptV2,
  type OfflinePaymentAttemptV2,
} from '../offlinePaymentV2';

const attempt: OfflinePaymentAttemptV2 = {
  communityId: 'community-1',
  residentId: 'resident-1',
  amountMinor: 120050,
  paymentMethod: 'bank_transfer',
  paymentReference: 'REF-1',
  idempotencyKey: 'offline_key-1',
};

const success = {
  success: true,
  transactionId: 'txn-1',
  allocations: [{ billId: 'bill-1', amountMinor: 120000 }],
  excessCreditMinor: 50,
  alreadyCompleted: false,
};

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Billing V2 offline payment safe foundation', () => {
  it.each([
    ['1200', 120000],
    ['1200.5', 120050],
    ['1200.50', 120050],
    ['0.01', 1],
    [' 1200.50 ', 120050],
  ])('parses INR amount %s using integer minor units', (input, expected) => {
    expect(parseOfflinePaymentAmountToMinorUnits(input)).toBe(expected);
  });

  it.each(['0', '0.00', '-1', '+1', '1.001', '1.', '.50', '1,200', '1e3', '1 2', '']) (
    'rejects malformed or non-positive INR amount %j',
    (input) => expect(parseOfflinePaymentAmountToMinorUnits(input)).toBeNull(),
  );

  it('rejects amounts above the safe integer minor-unit limit', () => {
    expect(parseOfflinePaymentAmountToMinorUnits('90071992547409.92')).toBeNull();
  });

  it('generates a backend-safe key with Web Crypto entropy', () => {
    const key = createOfflinePaymentIdempotencyKeyV2();
    expect(isOfflinePaymentIdempotencyKey(key)).toBe(true);
    expect(key).not.toBe(createOfflinePaymentIdempotencyKeyV2());
    expect(isOfflinePaymentIdempotencyKey('x'.repeat(129))).toBe(false);
    expect(isOfflinePaymentIdempotencyKey('bad key')).toBe(false);
  });

  it('creates one complete six-field attempt with a fresh key', () => {
    const created = createOfflinePaymentAttemptV2({
      communityId: ' community-1 ',
      residentId: 'resident-1',
      amountMinor: 1,
      paymentMethod: 'cash',
      paymentReference: ' RCPT-1 ',
    });
    expect(Object.keys(created).sort()).toEqual([
      'amountMinor',
      'communityId',
      'idempotencyKey',
      'paymentMethod',
      'paymentReference',
      'residentId',
    ]);
    expect(created.communityId).toBe('community-1');
    expect(created.paymentReference).toBe('RCPT-1');
    expect(localStorage.length).toBe(0);
  });

  it.each([
    ['extra field', { ...attempt, billId: 'bill-1' }],
    ['missing field', { ...attempt, idempotencyKey: undefined }],
    ['bad community', { ...attempt, communityId: ' / ' }],
    ['bad resident', { ...attempt, residentId: '' }],
    ['zero amount', { ...attempt, amountMinor: 0 }],
    ['fractional amount', { ...attempt, amountMinor: 1.5 }],
    ['unsafe amount', { ...attempt, amountMinor: Number.MAX_SAFE_INTEGER + 1 }],
    ['bad method', { ...attempt, paymentMethod: 'upi' }],
    ['empty reference', { ...attempt, paymentReference: '  ' }],
    ['long reference', { ...attempt, paymentReference: 'x'.repeat(201) }],
    ['bad key', { ...attempt, idempotencyKey: 'not safe!' }],
  ])('rejects persisted attempts with %s', (_label, value) => {
    expect(parseOfflinePaymentAttemptV2(value)).toBeNull();
  });

  it('round-trips a persisted attempt in the community and resident scope', () => {
    expect(saveOfflinePaymentAttemptV2(attempt)).toEqual(attempt);
    expect(loadOfflinePaymentAttemptV2('community-1', 'resident-1')).toEqual(attempt);
    expect(loadOfflinePaymentAttemptV2('community-1', 'resident-2')).toBeNull();
    expect(requireSavedOfflinePaymentAttemptV2(attempt)).toEqual(attempt);
  });

  it('does not replace an unresolved attempt with a fresh key or terms', () => {
    saveOfflinePaymentAttemptV2(attempt);
    const replacement = { ...attempt, amountMinor: 1, idempotencyKey: 'fresh-key' };
    expect(() => saveOfflinePaymentAttemptV2(replacement)).toThrow('already exists');
    expect(() => requireSavedOfflinePaymentAttemptV2(replacement)).toThrow('exact payment attempt');
    expect(loadOfflinePaymentAttemptV2('community-1', 'resident-1')).toEqual(attempt);
  });

  it('fails closed for malformed saved storage and storage write failures', () => {
    const key = 'hominode:billing-v2:offline-payment:community-1:resident-1';
    localStorage.setItem(key, '{malformed');
    expect(() => loadOfflinePaymentAttemptV2('community-1', 'resident-1')).toThrow('invalid');
    localStorage.clear();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Error('quota');
    });
    expect(() => saveOfflinePaymentAttemptV2(attempt)).toThrow('quota');
    expect(() => requireSavedOfflinePaymentAttemptV2(attempt)).toThrow();
  });

  it('validates complete successful callable results and supports all-credit payments', () => {
    expect(parseOfflinePaymentResultV2(success)).toEqual({
      success: true,
      transactionId: 'txn-1',
      allocations: [{ billId: 'bill-1', amountMinor: 120000 }],
      excessCreditMinor: 50,
      alreadyCompleted: false,
    });
    expect(parseOfflinePaymentResultV2({ ...success, success: false })).toBeNull();
    expect(parseOfflinePaymentResultV2({ ...success, transactionId: '' })).toBeNull();
    expect(parseOfflinePaymentResultV2({ ...success, allocations: null })).toBeNull();
    expect(parseOfflinePaymentResultV2({ ...success, excessCreditMinor: -1 })).toBeNull();
    expect(parseOfflinePaymentResultV2({ ...success, alreadyCompleted: 'true' })).toBeNull();
    expect(
      parseOfflinePaymentResultV2({
        ...success,
        allocations: [],
        excessCreditMinor: 120050,
      })?.allocations,
    ).toEqual([]);
  });

  it.each([
    ['malformed allocation in otherwise valid list', [{ billId: 'bill-1', amountMinor: 120000 }, null]],
    ['missing bill ID', [{ amountMinor: 120000 }]],
    ['blank bill ID', [{ billId: ' ', amountMinor: 120000 }]],
    ['duplicate bill IDs', [{ billId: 'bill-1', amountMinor: 60000 }, { billId: 'bill-1', amountMinor: 60000 }]],
    ['zero allocation', [{ billId: 'bill-1', amountMinor: 0 }]],
    ['negative allocation', [{ billId: 'bill-1', amountMinor: -1 }]],
    ['fractional allocation', [{ billId: 'bill-1', amountMinor: 1.5 }]],
    ['unsafe allocation', [{ billId: 'bill-1', amountMinor: Number.MAX_SAFE_INTEGER + 1 }]],
  ])('rejects %s without dropping malformed entries', (_label, allocations) => {
    expect(parseOfflinePaymentResultV2({ ...success, allocations })).toBeNull();
  });

  it('clears only after validated success, including already-completed success', () => {
    saveOfflinePaymentAttemptV2(attempt);
    expect(() => clearOfflinePaymentAttemptV2('community-1', 'resident-1', { success: false })).toThrow(
      'confirmed success',
    );
    expect(loadOfflinePaymentAttemptV2('community-1', 'resident-1')).toEqual(attempt);
    clearOfflinePaymentAttemptV2('community-1', 'resident-1', {
      ...success,
      alreadyCompleted: true,
    });
    expect(loadOfflinePaymentAttemptV2('community-1', 'resident-1')).toBeNull();
  });
});
