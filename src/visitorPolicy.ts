import { dateOf, type Data } from './models';

export type ApprovalMode =
  'resident_authorized' | 'tenant_approval_required' | 'all_approval_required';
export type PetMode = 'allowed' | 'not_allowed' | 'temporarily_restricted';
export interface Period {
  startAt: number;
  endAt: number;
}
export interface VisitorPolicyInput {
  schemaVersion: 1;
  enabled: boolean;
  timeZone: string | null;
  approvalMode: ApprovalMode;
  emergency: Period | null;
  pets: { mode: PetMode; normalMode: 'allowed' | 'not_allowed'; restriction: Period | null };
}
export interface VisitorPolicyResponse {
  communityId: string;
  timeZone: string | null;
  policy: VisitorPolicyInput & { revision: number };
  writeRevision: number;
  pendingSchedule: { effectiveAt: number; revision: number; policy: VisitorPolicyInput } | null;
  serverTime: number;
  rolloutReady: boolean;
}
export function visitorTimeZoneError(zone: string | null): string | null {
  if (!zone) return 'The community time zone must be configured first.';
  try {
    // Intl also accepts fixed offsets; the mobile client requires an IANA zone.
    if (/^[+-]/.test(zone)) throw Error('An IANA community zone is required.');
    new Intl.DateTimeFormat('en', { timeZone: zone }).format(0);
    return null;
  } catch {
    return `Unsupported community time zone: ${zone}. Update it in Community Settings.`;
  }
}
export const approvalOptions: Record<ApprovalMode, string> = {
  resident_authorized: 'No Admin approval required',
  tenant_approval_required: 'Tenant invitations require approval',
  all_approval_required: 'All invitations require approval',
};
export const approvalDescriptions: Record<ApprovalMode, string> = {
  resident_authorized: 'Eligible owners and tenants can invite visitors directly.',
  tenant_approval_required:
    'Eligible owners invite directly. Tenant invitations wait for a Community Admin.',
  all_approval_required: 'All owner and tenant invitations wait for a Community Admin.',
};

function parts(ms: number, zone: string) {
  const entries = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(ms);
  const p = Object.fromEntries(entries.map((v) => [v.type, v.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function localSchedule(ms: number | undefined, zone: string | null) {
  return ms == null || !zone || visitorTimeZoneError(zone) ? '' : parts(ms, zone);
}
/** Reject skipped/repeated DST wall times instead of guessing a device offset. */
export function scheduleInstant(value: string, zone: string | null): number {
  const zoneError = visitorTimeZoneError(zone);
  if (zoneError) throw Error(zoneError);
  // Validation above rejects missing and unsupported community zones.
  const timeZone = zone!;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) throw Error('Enter a complete date and time.');
  const naive = Date.parse(value + ':00Z');
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== value)
    throw Error('Enter a valid date and time.');
  const offsets = new Set<number>();
  for (let h = -48; h <= 48; h += 6) {
    const sample = naive + h * 3600000;
    offsets.add(Date.parse(parts(sample, timeZone) + ':00Z') - sample);
  }
  const matches = [...offsets]
    .map((offset) => naive - offset)
    .filter((ms) => parts(ms, timeZone) === value);
  if (matches.length !== 1)
    throw Error(
      'This community-local time is skipped or repeated by daylight saving. Choose an unambiguous time.',
    );
  return matches[0];
}
export function futureSchedule(
  value: string,
  zone: string | null,
  serverTime: number,
  originalInstant?: number,
): number {
  const parsed = scheduleInstant(value, zone);
  // The controls display minutes; keep stored seconds when the time is unchanged.
  const instant =
    originalInstant != null && localSchedule(originalInstant, zone) === value
      ? originalInstant
      : parsed;
  if (instant <= serverTime) throw Error('Choose a future policy effective time.');
  return instant;
}
export function schedulePeriod(start: string, end: string, zone: string | null): Period {
  const startAt = scheduleInstant(start, zone),
    endAt = scheduleInstant(end, zone);
  if (endAt <= startAt) throw Error('End must be after start.');
  return { startAt, endAt };
}
export function periodStatus(period: Period | null, serverTime: number) {
  return !period
    ? 'Off'
    : serverTime < period.startAt
      ? 'Scheduled'
      : serverTime >= period.endAt
        ? 'Expired'
        : 'Active';
}
export function policyInput(policy: VisitorPolicyInput): VisitorPolicyInput {
  // Whitelist request keys; never echo revision/updatedAt/readiness to the server.
  return {
    schemaVersion: 1,
    enabled: policy.enabled,
    timeZone: policy.timeZone,
    approvalMode: policy.approvalMode,
    emergency: policy.emergency,
    pets: {
      mode: policy.pets.mode,
      normalMode: policy.pets.normalMode,
      restriction: policy.pets.restriction,
    },
  };
}
export type VisitorQueue = 'pending' | 'expected' | 'inside' | 'history';
export const visitorQueueNames: Record<VisitorQueue, string> = {
  pending: 'Pending approval',
  expected: 'Expected / authorized',
  inside: 'Inside',
  history: 'History',
};
export function visitorQueue(data: Data): VisitorQueue {
  const raw = String(data.status ?? data.visitStatus ?? '').toLowerCase();
  if (
    data.departure != null ||
    data.checkOutTime != null ||
    [
      'completed',
      'departed',
      'checked_out',
      'checked-out',
      'exited',
      'history',
      'cancelled',
      'canceled',
      'rejected',
      'denied',
      'entry_denied',
      'denied-entry',
    ].includes(raw) ||
    data.gateAccessStatus === 'denied' ||
    data.gateEntryDeniedAt != null
  )
    return 'history';
  if (
    data.actualArrival != null ||
    data.checkInTime != null ||
    ['inside', 'arrived', 'checked_in', 'entered', 'active'].includes(raw)
  )
    return 'inside';
  if (['rejected', 'revoked'].includes(String(data.authorizationState))) return 'history';
  if (data.authorizationState === 'pending_admin') return 'pending';
  return ['expected', 'pending', 'pendingapproval', 'pending_approval', 'approved'].includes(raw)
    ? 'expected'
    : 'history';
}
export function authorizationLabel(data: Data) {
  switch (data.authorizationState) {
    case 'pending_admin':
      return 'Pending Admin approval';
    case 'auto_authorized':
      return 'Resident authorized';
    case 'admin_authorized':
      return 'Admin authorized';
    case 'rejected':
      return 'Rejected';
    case 'revoked':
      return 'Revoked';
  }
  if ((data.visitorPolicySnapshot as Data | undefined)?.enforced === false)
    return 'Resident authorized';
  return data.isApproved === true
    ? 'Legacy approval recorded'
    : 'Legacy invitation — no Admin decision recorded';
}
export function visitorPhysicalLabel(data: Data) {
  const queue = visitorQueue(data);
  if (queue === 'inside') return 'Inside';
  if (
    data.departure != null ||
    data.checkOutTime != null ||
    ['completed', 'departed', 'checked_out', 'exited'].includes(String(data.status))
  )
    return 'Completed';
  if (['cancelled', 'canceled'].includes(String(data.status))) return 'Cancelled';
  if (data.gateAccessStatus === 'denied' || data.gateEntryDeniedAt != null) return 'Entry denied';
  if (queue === 'history') return 'Not checked in';
  return 'Expected — not checked in';
}
export function canDecideVisitor(data: Data) {
  return visitorDecisionActions(data).length > 0;
}
export type VisitorDecision = 'approve' | 'reject' | 'revoke';
export function visitorDecisionActions(
  data: Data,
  policy?: VisitorPolicyResponse['policy'],
  now = Date.now(),
  residentType?: string,
): ('approve' | 'reject' | 'reapprove' | 'revoke')[] {
  // Match the callable's lifecycle guard, including inconsistent legacy records.
  if (
    !['expected', 'pending', 'approved'].includes(String(data.status)) ||
    data.actualArrival != null || data.checkInTime != null ||
    data.departure != null || data.checkOutTime != null ||
    data.gateAccessStatus === 'denied' || data.gateEntryDeniedAt != null ||
    ['rejected', 'revoked'].includes(String(data.authorizationState))
  ) return [];
  const state = data.authorizationState;
  if (state === 'pending_admin' || (state == null && data.isApproved !== true))
    return ['approve', 'reject'];
  if (!['auto_authorized', 'admin_authorized'].includes(String(state)) && state != null)
    return [];
  const emergency = policy?.emergency;
  const emergencyActive = emergency != null && now >= emergency.startAt && now < emergency.endAt;
  const needsApproval = policy?.enabled && (emergencyActive ||
    policy.approvalMode === 'all_approval_required' ||
    (policy.approvalMode === 'tenant_approval_required' && residentType === 'tenant'));
  const approvedAt = dateOf(data.approvedAt)?.getTime();
  const current = state === 'admin_authorized' && data.authorizationManaged === true &&
    data.isApproved === true && typeof data.authorizationActorUid === 'string' &&
    data.authorizationActorUid.length > 0 && data.approvedBy === data.authorizationActorUid &&
    Number.isSafeInteger(policy?.revision) && policy!.revision > 0 &&
    data.authorizationPolicyRevision === policy!.revision && approvedAt != null && approvedAt <= now &&
    (!emergencyActive || approvedAt >= emergency!.startAt);
  return [...(needsApproval && !current ? ['reapprove' as const] : []), 'revoke'];
}
export function visitorTime(data: Data, zone?: unknown) {
  return communityDate(data.expectedArrival ?? data.expectedTime, zone);
}

export function communityZone(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw Error('Community timezone is not configured. Contact your Community Admin.');
  const zone = value.trim() === 'Asia/Calcutta' ? 'Asia/Kolkata' : value.trim();
  try {
    if (/^[+-]/.test(zone)) throw Error();
    new Intl.DateTimeFormat('en', { timeZone: zone }).format(0);
  } catch { throw Error(`Unsupported community timezone: ${value}. Contact your Community Admin.`); }
  return zone;
}
export function communityTimeLabel(value: unknown, at = Date.now()): string {
  try {
    const zone = communityZone(value);
    const abbreviation = new Intl.DateTimeFormat('en-IN', {timeZone: zone, timeZoneName: 'short'})
      .formatToParts(at).find(p => p.type === 'timeZoneName')?.value;
    return `Community time · ${zone} (${abbreviation})`;
  } catch (error) { return (error as Error).message; }
}
export function communityDate(value: unknown, zoneValue: unknown): string {
  const date = dateOf(value);
  if (!date) return '—';
  try {
    const zone = communityZone(zoneValue);
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: zone, year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
    }).format(date) + ` (${zone})`;
  } catch (error) { return (error as Error).message; }
}
