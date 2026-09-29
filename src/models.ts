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
