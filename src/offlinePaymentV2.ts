export type OfflinePaymentMethodV2 = 'cash' | 'bank_transfer' | 'cheque';

export interface OfflinePaymentAttemptV2 {
  communityId: string;
  residentId: string;
  amountMinor: number;
  paymentMethod: OfflinePaymentMethodV2;
  paymentReference: string | null;
  idempotencyKey: string;
}

export interface OfflinePaymentAllocationV2 {
  billId: string;
  amountMinor: number;
}

export interface OfflinePaymentResultV2 {
  success: true;
  transactionId: string;
  allocations: OfflinePaymentAllocationV2[];
  excessCreditMinor: number;
  alreadyCompleted: boolean;
}

const ATTEMPT_FIELDS = [
  'communityId',
  'residentId',
  'amountMinor',
  'paymentMethod',
  'paymentReference',
  'idempotencyKey',
].sort();

function safeIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && !trimmed.includes('/') ? trimmed : null;
}

function safeMinorUnits(value: unknown, allowZero = false): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    (allowZero ? value >= 0 : value > 0)
  );
}

export function parseOfflinePaymentAmountToMinorUnits(value: string): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  try {
    const rupees = BigInt(match[1]);
    const paise = BigInt((match[2] || '').padEnd(2, '0') || '0');
    const minor = rupees * 100n + paise;
    return minor > 0n && minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
  } catch {
    return null;
  }
}

export function isOfflinePaymentIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/** Create a fresh backend-safe key using Web Crypto entropy. */
export function createOfflinePaymentIdempotencyKeyV2(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function')
    throw Error('Secure payment attempt identifiers are unavailable.');
  const bytes = new Uint8Array(24);
  cryptoApi.getRandomValues(bytes);
  return `offline_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function parseOfflinePaymentAttemptV2(value: unknown): OfflinePaymentAttemptV2 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join('\u0000') !== ATTEMPT_FIELDS.join('\u0000')) return null;

  const communityId = safeIdentifier(record.communityId);
  const residentId = safeIdentifier(record.residentId);
  const reference = record.paymentReference;
  const paymentReference =
    reference === null
      ? null
      : typeof reference === 'string' &&
          reference === reference.trim() &&
          reference.length > 0 &&
          reference.length <= 200
        ? reference
        : undefined;

  if (
    !communityId ||
    !residentId ||
    !safeMinorUnits(record.amountMinor) ||
    !['cash', 'bank_transfer', 'cheque'].includes(String(record.paymentMethod)) ||
    paymentReference === undefined ||
    !isOfflinePaymentIdempotencyKey(record.idempotencyKey)
  )
    return null;

  return {
    communityId,
    residentId,
    amountMinor: record.amountMinor,
    paymentMethod: record.paymentMethod as OfflinePaymentMethodV2,
    paymentReference,
    idempotencyKey: record.idempotencyKey,
  };
}

export function createOfflinePaymentAttemptV2(
  input: Omit<OfflinePaymentAttemptV2, 'idempotencyKey'>,
): OfflinePaymentAttemptV2 {
  const paymentReference =
    typeof input.paymentReference === 'string'
      ? input.paymentReference.trim() || null
      : input.paymentReference;
  const attempt = parseOfflinePaymentAttemptV2({
    ...input,
    communityId: typeof input.communityId === 'string' ? input.communityId.trim() : input.communityId,
    residentId: typeof input.residentId === 'string' ? input.residentId.trim() : input.residentId,
    paymentReference,
    idempotencyKey: createOfflinePaymentIdempotencyKeyV2(),
  });
  if (!attempt) throw Error('Offline payment details are invalid.');
  return attempt;
}

function attemptStorageKey(communityId: string, residentId: string): string {
  const community = safeIdentifier(communityId);
  const resident = safeIdentifier(residentId);
  if (!community || !resident) throw Error('A valid community and resident are required.');
  return `hominode:billing-v2:offline-payment:${encodeURIComponent(community)}:${encodeURIComponent(resident)}`;
}

function browserStorage(): Storage {
  if (typeof window === 'undefined' || !window.localStorage)
    throw Error('Payment attempt storage is unavailable.');
  return window.localStorage;
}

export function loadOfflinePaymentAttemptV2(
  communityId: string,
  residentId: string,
): OfflinePaymentAttemptV2 | null {
  const raw = browserStorage().getItem(attemptStorageKey(communityId, residentId));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw Error('A saved payment attempt is invalid and must be resolved safely.');
  }
  const attempt = parseOfflinePaymentAttemptV2(parsed);
  if (!attempt) throw Error('A saved payment attempt is invalid and must be resolved safely.');
  if (attempt.communityId !== communityId.trim() || attempt.residentId !== residentId.trim())
    throw Error('A saved payment attempt belongs to a different scope.');
  return attempt;
}

/** Persists before any callable attempt and never replaces an existing saved attempt. */
export function saveOfflinePaymentAttemptV2(
  attemptValue: unknown,
): OfflinePaymentAttemptV2 {
  const attempt = parseOfflinePaymentAttemptV2(attemptValue);
  if (!attempt) throw Error('Offline payment details are invalid.');
  const storage = browserStorage();
  const key = attemptStorageKey(attempt.communityId, attempt.residentId);
  if (storage.getItem(key) !== null)
    throw Error('An unresolved payment attempt already exists for this resident.');
  const serialized = JSON.stringify(attempt);
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized)
    throw Error('The payment attempt could not be saved safely.');
  return attempt;
}

/** Require an exact previously persisted attempt before retrying the callable. */
export function requireSavedOfflinePaymentAttemptV2(
  attemptValue: unknown,
): OfflinePaymentAttemptV2 {
  const attempt = parseOfflinePaymentAttemptV2(attemptValue);
  if (!attempt) throw Error('Offline payment details are invalid.');
  const saved = loadOfflinePaymentAttemptV2(attempt.communityId, attempt.residentId);
  if (!saved || ATTEMPT_FIELDS.some((field) => saved[field as keyof OfflinePaymentAttemptV2] !== attempt[field as keyof OfflinePaymentAttemptV2]))
    throw Error('Save this exact payment attempt before submitting it.');
  return saved;
}

export function parseOfflinePaymentResultV2(value: unknown): OfflinePaymentResultV2 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.success !== true ||
    typeof record.transactionId !== 'string' ||
    !record.transactionId.trim() ||
    !Array.isArray(record.allocations) ||
    !safeMinorUnits(record.excessCreditMinor, true) ||
    typeof record.alreadyCompleted !== 'boolean'
  )
    return null;

  const allocations = record.allocations.flatMap((item): OfflinePaymentAllocationV2[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const allocation = item as Record<string, unknown>;
    const billId = safeIdentifier(allocation.billId);
    if (!billId || !safeMinorUnits(allocation.amountMinor)) return [];
    return [{ billId, amountMinor: allocation.amountMinor }];
  });

  return {
    success: true,
    transactionId: record.transactionId.trim(),
    allocations,
    excessCreditMinor: record.excessCreditMinor,
    alreadyCompleted: record.alreadyCompleted,
  };
}

/** A saved request may be cleared only after a validated successful result. */
export function clearOfflinePaymentAttemptV2(
  communityId: string,
  residentId: string,
  result: unknown,
): void {
  if (!parseOfflinePaymentResultV2(result))
    throw Error('The payment attempt cannot be cleared without confirmed success.');
  browserStorage().removeItem(attemptStorageKey(communityId, residentId));
}
