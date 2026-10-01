export type Data = Record<string, unknown>;
export type Role = 'admin' | 'resident' | 'superAdmin';
export interface Community {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  ownerIdentityVerificationRequired: boolean;
  data: Data;
}

export interface DirectUpiConfig {
  enabled: boolean;
  vpa?: string;
  payeeName?: string;
}

export interface CommunityPaymentConfig {
  communityId: string;
  version: 1;
  directUpi: DirectUpiConfig;
  updatedBy?: string;
  updatedAt?: Date | null;
  configured: boolean;
}

export interface CommunityPaymentConfigInput {
  enabled: boolean;
  vpa?: string;
  payeeName?: string;
}

export interface Profile {
  uid: string;
  role: Role;
  name: string;
  phoneNumber: string;
  communityId: string;
  flatId: string;
  buildingId: string;
  flatLabel: string;
  authorizedCommunityIds: string[];
  data: Data;
}
export interface Session {
  uid: string;
  role: Role;
  profile: Profile;
  communities: Community[];
  community: Community | null;
}
export interface Row {
  id: string;
  data: Data;
}
/** V1 write fields only; existing amenity documents may contain additional legacy fields. */
export type FacilityPricingMode = 'free' | 'flat' | 'resident_type';

export interface FacilityImage {
  /** Public download URL. The first image in FacilityEditableFields.images is the primary image. */
  url: string;
  /** Firebase Storage object path used for scoped deletion and maintenance. */
  storagePath: string;
  /** Original file name, when available. */
  name?: string;
}

/** V1 write fields only; existing amenity documents may contain additional legacy fields. */
export interface FacilityEditableFields {
  name: string;
  type: string;
  description?: string;
  iconName?: string;
  /** Legacy/compatibility primary image URL. Kept synchronized with images[0] when images is written. */
  imageUrl?: string;
  /** Ordered gallery. images[0] is the primary image. Maximum six images. */
  images?: FacilityImage[];
  timeSlots: string[];
  isAvailable: boolean;

  // Pricing
  isFree: boolean;
  pricePerDay: number;
  pricingMode?: FacilityPricingMode;
  ownerPricePerDay?: number;
  tenantPricePerDay?: number;
}

export interface CreateFacilityInput extends Omit<FacilityEditableFields, 'timeSlots'> {
  buildingId: string;
  /** Omit or pass [] when no booking slots are offered. */
  timeSlots?: string[];
}

/** Omitted fields are preserved. Community, building, attribution and advanced fields are immutable here. */
export type UpdateFacilityInput = Partial<FacilityEditableFields>;
export interface VisitorDocument {
  communityId: string;
  hostUserId: string;
  flatId: string;
  visitorName: string;
  purpose: string;
  status: string;
  isApproved: boolean;
}
export interface ComplaintDocument {
  communityId: string;
  userId: string;
  residentId: string;
  flatId: string;
  title: string;
  description: string;
  category: string;
  status: 'pending' | 'inprogress' | 'completed';
}
export interface BillDocument {
  communityId: string;
  flatId: string;
  amount: number;
  status: string;
}
export type V2BillClassification = 'current' | 'history' | 'unavailable';
export interface SosDocument {
  communityId: string;
  residentUid: string;
  status: 'triggered' | 'acknowledged' | 'responding' | 'resolved' | 'cancelled';
}
export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
export const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? [
        ...new Set(
          v
            .filter((x): x is string => typeof x === 'string')
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ]
    : [];
export const first = (d: Data, keys: string[], fallback = '') =>
  keys.map((k) => str(d[k])).find(Boolean) || fallback;
export function dateOf(value: unknown): Date | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function')
    return value.toDate() as Date;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}
export const dateLabel = (value: unknown) =>
  dateOf(value)?.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) || '—';
export const money = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(value);

/** V2 is opt-in only when Firestore stores the numeric schema version. */
export function isV2Bill(data: Data): boolean {
  return data.schemaVersion === 2;
}

function safeMinor(value: unknown, allowZero: boolean): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0)
  );
}

export function hasValidV2BillFinancials(data: Data): boolean {
  if (!isV2Bill(data) || data.currency !== 'INR') return false;
  const { amountMinor, paidAmountMinor, creditAppliedMinor, outstandingAmountMinor } = data;
  if (
    !safeMinor(amountMinor, false) ||
    !safeMinor(paidAmountMinor, true) ||
    !safeMinor(creditAppliedMinor, true) ||
    !safeMinor(outstandingAmountMinor, true) ||
    paidAmountMinor > amountMinor ||
    creditAppliedMinor > amountMinor - paidAmountMinor ||
    outstandingAmountMinor !== amountMinor - paidAmountMinor - creditAppliedMinor ||
    typeof data.currentRevisionId !== 'string' ||
    !data.currentRevisionId.trim()
  ) {
    return false;
  }
  return true;
}

/** Formats paise by integer division and string assembly, without rupee floats. */
export function formatInrMinorUnits(value: unknown): string {
  if (!safeMinor(value, true)) return '—';
  const digits = String(value).padStart(3, '0');
  const rupeeDigits = digits.slice(0, -2);
  const paise = digits.slice(-2);
  const lastThreeRupees = rupeeDigits.slice(-3);
  const leadingRupees = rupeeDigits.slice(0, -3);
  const groups: string[] = [];
  for (let end = leadingRupees.length; end > 0; end -= 2) {
    groups.unshift(leadingRupees.slice(Math.max(0, end - 2), end));
  }
  const groupedRupees = [...groups, lastThreeRupees].filter(Boolean).join(',');
  return `₹${groupedRupees}.${paise}`;
}

export function classifyV2Bill(data: Data): V2BillClassification {
  if (!hasValidV2BillFinancials(data)) return 'unavailable';
  const billStatus = typeof data.status === 'string' ? data.status.trim().toLowerCase() : '';
  if (data.outstandingAmountMinor === 0) return 'history';
  if (['pending', 'overdue', 'partially_paid'].includes(billStatus)) return 'current';
  return 'unavailable';
}

export type V2RecurringScheduleStatus = 'active' | 'paused' | 'stopped';
export type V2RecurringScheduleScope = 'community' | 'building' | 'unit' | 'units';
const billingPeriodPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;
const recurringControlCharPattern = /[\u0000-\u001F\u007F]/;
const recurringChargeCodeToLabel = {
  maintenance: 'Maintenance',
  water: 'Water',
  parking: 'Parking',
  service: 'Service',
  electricity: 'Electricity',
  security: 'Security',
  other: 'Other',
} as const;
const recurringReservedLabels = new Set(
  Object.values(recurringChargeCodeToLabel).map((value) => value.toLowerCase()),
);

export function isBillingPeriod(value: unknown): value is string {
  return typeof value === 'string' && billingPeriodPattern.test(value);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isRecurringDocumentId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    !!value &&
    utf8ByteLength(value) <= 128 &&
    !value.includes('/') &&
    !recurringControlCharPattern.test(value) &&
    !/^\.{1,2}$/.test(value) &&
    !/^__.*__$/.test(value)
  );
}

function isRevisionBillingPeriod(value: unknown): value is string {
  if (!isBillingPeriod(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= 2000 && year <= 2100;
}

function normalizeCustomRecurringChargeLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function isV2RecurringSchedule(data: Data): boolean {
  return data.schemaVersion === 2;
}

function validScheduleChargeLines(value: unknown): value is { label: string; amountMinor: number }[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (line) =>
        !!line &&
        typeof line === 'object' &&
        !Array.isArray(line) &&
        !!str((line as Data).label) &&
        safeMinor((line as Data).amountMinor, false),
    ) &&
    value.reduce((total, line) => total + (line as Data).amountMinor as number, 0) <=
      Number.MAX_SAFE_INTEGER
  );
}

export function hasValidV2RecurringSchedule(data: Data, documentId?: string): boolean {
  if (!isV2RecurringSchedule(data)) return false;
  const generationDay = data.generationDay;
  const dueDay = data.dueDay;
  const revisionNo = data.revisionNo;
  const status = data.status;
  const scope = data.scope;
  const endPeriod = data.endBillingPeriod;
  const generatedThrough = data.generatedThroughBillingPeriod;
  const inProgress = data.generationInProgressBillingPeriod;
  const storedId = str(data.id);
  const expectedId = str(documentId);
  return (
    data.currency === 'INR' &&
    data.frequency === 'monthly' &&
    (!storedId || !expectedId || storedId === expectedId) &&
    !!str(data.communityId) &&
    (status === 'active' || status === 'paused' || status === 'stopped') &&
    (scope === 'community' || scope === 'building' || scope === 'unit' || scope === 'units') &&
    (scope !== 'building' || !!str(data.buildingId)) &&
    (scope !== 'unit' || (!!str(data.buildingId) && !!str(data.flatId))) &&
    (scope !== 'units' ||
      (Array.isArray(data.flatIds) &&
        data.flatIds.length > 0 &&
        data.flatIds.every((id) => typeof id === 'string' && !!id.trim()))) &&
    typeof generationDay === 'number' &&
    Number.isInteger(generationDay) &&
    generationDay >= 1 &&
    generationDay <= 28 &&
    typeof dueDay === 'number' &&
    Number.isInteger(dueDay) &&
    dueDay >= generationDay &&
    dueDay <= 28 &&
    isBillingPeriod(data.startBillingPeriod) &&
    (endPeriod == null || isBillingPeriod(endPeriod)) &&
    (endPeriod == null || (data.startBillingPeriod as string) <= (endPeriod as string)) &&
    !!str(data.currentRevisionId) &&
    typeof revisionNo === 'number' &&
    Number.isSafeInteger(revisionNo) &&
    revisionNo > 0 &&
    validScheduleChargeLines(data.chargeLines) &&
    (generatedThrough == null || isBillingPeriod(generatedThrough)) &&
    (inProgress == null || isBillingPeriod(inProgress))
  );
}

export function hasRevisionCompatibleV2RecurringSchedule(data: Data, documentId?: string): boolean {
  if (!hasValidV2RecurringSchedule(data, documentId)) return false;
  if (data.status !== 'active' && data.status !== 'paused') return false;
  if (!isRecurringDocumentId(data.communityId)) return false;
  if (documentId != null && !isRecurringDocumentId(documentId)) return false;
  if (!isRecurringDocumentId(data.currentRevisionId)) return false;
  if (!isRevisionBillingPeriod(data.startBillingPeriod)) return false;
  if (data.endBillingPeriod != null && !isRevisionBillingPeriod(data.endBillingPeriod)) return false;

  if (data.scope === 'building') {
    if (!isRecurringDocumentId(data.buildingId)) return false;
  } else if (data.scope === 'unit') {
    if (!isRecurringDocumentId(data.buildingId) || !isRecurringDocumentId(data.flatId)) return false;
  } else if (data.scope === 'units') {
    const flatIds = data.flatIds;
    if (
      !Array.isArray(flatIds) ||
      flatIds.length === 0 ||
      flatIds.length > 5000 ||
      flatIds.some((id) => !isRecurringDocumentId(id))
    ) {
      return false;
    }

    const normalizedFlatIds = [...new Set(flatIds as string[])].sort((a, b) =>
      a.localeCompare(b),
    );
    if (
      normalizedFlatIds.length !== flatIds.length ||
      normalizedFlatIds.some((id, index) => id !== flatIds[index])
    ) {
      return false;
    }
  }

  const chargeLines = data.chargeLines;
  if (!Array.isArray(chargeLines) || chargeLines.length === 0 || chargeLines.length > 20) return false;
  const seenLineIds = new Set<string>();
  const seenEffectiveLabels = new Set<string>();
  let totalMinor = 0n;
  for (const line of chargeLines) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return false;
    const item = line as Data;
    const lineId = item.lineId;
    if (!isRecurringDocumentId(lineId) || seenLineIds.has(lineId)) return false;
    seenLineIds.add(lineId);

    const code = item.code;
    if (
      code !== 'maintenance' &&
      code !== 'water' &&
      code !== 'parking' &&
      code !== 'service' &&
      code !== 'electricity' &&
      code !== 'security' &&
      code !== 'other' &&
      code !== 'custom'
    ) {
      return false;
    }

    if (typeof item.label !== 'string') return false;
    const storedLabel = item.label;
    let effectiveLabel = '';
    if (code === 'custom') {
      const normalized = normalizeCustomRecurringChargeLabel(storedLabel);
      if (!normalized || normalized.length > 80) return false;
      if (normalized !== storedLabel) return false;
      if (recurringReservedLabels.has(normalized.toLowerCase())) return false;
      effectiveLabel = normalized;
    } else {
      const canonical = recurringChargeCodeToLabel[code];
      if (storedLabel !== canonical) return false;
      effectiveLabel = canonical;
    }

    const labelKey = effectiveLabel.toLowerCase();
    if (seenEffectiveLabels.has(labelKey)) return false;
    seenEffectiveLabels.add(labelKey);

    if (
      typeof item.amountMinor !== 'number' ||
      !Number.isSafeInteger(item.amountMinor) ||
      item.amountMinor <= 0
    ) {
      return false;
    }
    totalMinor += BigInt(item.amountMinor);
    if (totalMinor > BigInt(Number.MAX_SAFE_INTEGER)) return false;
  }
  return true;
}

export function recurringScheduleTotalMinor(data: Data): number | null {
  if (!validScheduleChargeLines(data.chargeLines)) return null;
  const total = data.chargeLines.reduce(
    (sum, line) => sum + ((line as Data).amountMinor as number),
    0,
  );
  return Number.isSafeInteger(total) ? total : null;
}

export function nextRecurringBillingPeriod(data: Data): string | null {
  if (!isBillingPeriod(data.startBillingPeriod)) return null;
  const generatedThrough = data.generatedThroughBillingPeriod;
  if (generatedThrough == null) return data.startBillingPeriod;
  if (!isBillingPeriod(generatedThrough)) return null;
  const [year, month] = generatedThrough.split('-').map(Number);
  return month === 12
    ? `${String(year + 1).padStart(4, '0')}-01`
    : `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}`;
}

/** V2 payment proofs are identified only by their exact numeric schema marker. */
export function isV2PaymentProof(data: Data): boolean {
  return data.schemaVersion === 2;
}

export function hasValidV2PaymentProof(data: Data, documentId?: string): boolean {
  if (!isV2PaymentProof(data)) return false;
  const id = str(data.id);
  const rowId = str(documentId);
  const status = data.status;
  return (
    data.currency === 'INR' &&
    safeMinor(data.submittedAmountMinor, false) &&
    !!str(data.communityId) &&
    !!str(data.billId) &&
    !!str(data.residentId) &&
    data.userId === data.residentId &&
    (!id || !rowId || id === rowId) &&
    (data.id == null || !!id) &&
    data.method === 'upi' &&
    data.provider === 'direct_upi' &&
    data.evidenceType === 'receipt' &&
    (status === 'pending' || status === 'failed' || status === 'completed') &&
    (status !== 'pending' || !!str(data.receiptPath))
  );
}

export function amount(d: Data): number {
  for (const k of ['amount', 'totalAmount', 'billAmount', 'total', 'dueAmount']) {
    const v = d[k];
    const n =
      typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replaceAll(',', '')) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return 0;
}
export function status(d: Data): string {
  const raw = first(
    d,
    ['status', 'visitStatus', 'approvalStatus', 'paymentStatus'],
    d.isActive === true ? 'active' : d.isActive === false ? 'inactive' : '',
  )
    .toLowerCase()
    .replace(/[ _-]/g, '');
  if ('visitorName' in d || 'hostUserId' in d) {
    if (['rejected', 'cancelled'].includes(raw)) return raw;
    if (d.departure != null) return 'departed';
    if (d.actualArrival != null && d.isApproved === true) return 'inside';
    if (d.isApproved === true) return 'approved';
  }
  return raw;
}
