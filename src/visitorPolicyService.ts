import { doc, getDocFromServer, onSnapshot } from 'firebase/firestore';
import { call, firebase } from './firebase';
import { currentAuthority } from './actions';
import { assertScope } from './policy';
import type { Row, Session } from './models';
import {
  policyInput,
  visitorTimeZoneError,
  type VisitorPolicyInput,
  type VisitorPolicyResponse,
  type VisitorDecision,
} from './visitorPolicy';

export const visitorPolicyReadTimeoutMs = 15_000;
export const visitorPolicySaveTimeoutMs = 65_000;

export class VisitorPolicySaveError extends Error {
  constructor(readonly writeOutcome: 'confirmed' | 'unknown', readonly cause: unknown) {
    super(writeOutcome === 'confirmed'
      ? 'Visitor policy was saved, but the current settings could not be reloaded. Use Reload policy before saving again.'
      : 'The save result could not be confirmed. The policy may have been saved. Use Reload policy before saving again; do not resubmit the save.');
  }
}

/** Bound SDK waits without allowing timed-out preflight reads to send a later write. */
export function visitorPolicyRequest<T>(
  request: (signal: AbortSignal) => Promise<T>,
  { signal, timeoutMs = visitorPolicyReadTimeoutMs, timeoutMessage =
    'Visitor policy request timed out. Use Reload policy to refresh.' }: {
    signal?: AbortSignal;
    timeoutMs?: number;
    timeoutMessage?: string;
  } = {},
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(Object.assign(Error(timeoutMessage), {
    code: 'functions/deadline-exceeded',
  })), timeoutMs);
  let aborted = () => {};
  return new Promise<T>((resolve, reject) => {
    aborted = () => reject(controller.signal.reason);
    if (controller.signal.aborted) { aborted(); return; }
    controller.signal.addEventListener('abort', aborted, { once: true });
    try {
      controller.signal.throwIfAborted();
      Promise.resolve(request(controller.signal)).then(resolve, reject);
    } catch (error) {
      reject(error);
    }
  }).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', aborted);
  });
}

async function adminScope(session: Session, signal?: AbortSignal) {
  if (session.role !== 'admin' || session.profile.role !== 'admin')
    throw Error('A Community Admin is required.');
  const id = assertScope(session);
  const fresh = await visitorPolicyRequest(() => currentAuthority(session), {
    signal, timeoutMessage: 'Community access verification timed out. Use Reload policy to refresh.',
  });
  if (
    fresh.role !== 'admin' ||
    fresh.community.id !== id ||
    !fresh.profile.authorizedCommunityIds.includes(id)
  )
    throw Error('Community access changed. Reload before continuing.');
  return id;
}
export function loadVisitorPolicy(session: Session, signal?: AbortSignal): Promise<VisitorPolicyResponse> {
  return visitorPolicyRequest(async readSignal => {
    const communityId = await adminScope(session, readSignal);
    readSignal.throwIfAborted();
    const result = await call<VisitorPolicyResponse>('getCommunityVisitorPolicy', { communityId });
    if (result.communityId !== communityId || assertScope(session) !== communityId)
      throw Error('Policy is outside your community.');
    if (
      !Number.isSafeInteger(result.writeRevision) ||
      result.writeRevision < 0 ||
      !Number.isSafeInteger(result.serverTime) ||
      result.pendingSchedule === undefined
    ) {
      throw Error(
        'Visitor policy response is incomplete. Reload settings after the service is updated.',
      );
    }
    return result;
  }, { signal });
}
export async function saveVisitorPolicy(
  session: Session,
  policy: VisitorPolicyInput,
  expectedRevision: number,
  effectiveAt?: number,
  signal?: AbortSignal,
) {
  const config = await loadVisitorPolicy(session, signal);
  const receivedAt = performance.now();
  if (policy.enabled && config.rolloutReady !== true)
    throw Error('Saving is blocked until visitor policy rollout is ready for this community.');
  const zoneError = visitorTimeZoneError(config.timeZone);
  if (zoneError) throw Error(zoneError);
  if (expectedRevision !== config.writeRevision)
    throw Object.assign(Error('Visitor policy changed. Reload before saving.'), {
      code: 'functions/aborted',
    });
  const communityId = await adminScope(session, signal);
  if (config.communityId !== communityId) throw Error('Policy is outside your community.');
  if (
    effectiveAt != null &&
    (!Number.isSafeInteger(effectiveAt) ||
      effectiveAt <= config.serverTime + Math.max(0, performance.now() - receivedAt))
  )
    throw Error('Choose a future policy effective time.');
  try {
    await visitorPolicyRequest(() => call('updateCommunityVisitorPolicy', {
      communityId,
      policy: { ...policyInput(policy), timeZone: config.timeZone },
      expectedRevision,
      ...(effectiveAt == null ? {} : { effectiveAt }),
    }), { signal });
  } catch (error) {
    const code = String((error as { code?: string })?.code).split('/').at(-1);
    if (['aborted', 'invalid-argument', 'failed-precondition', 'permission-denied', 'unauthenticated',
      'not-found', 'unimplemented', 'already-exists', 'out-of-range'].includes(code ?? '')) throw error;
    throw new VisitorPolicySaveError('unknown', error);
  }
  try {
    return await loadVisitorPolicy(session, signal);
  } catch (error) {
    throw new VisitorPolicySaveError('confirmed', error);
  }
}
export async function decideVisitor(session: Session, row: Row, action: VisitorDecision) {
  const communityId = await adminScope(session);
  if (row.data.communityId !== communityId) throw Error('Visitor is outside your community.');
  return call('decideVisitorInvitation', {
    communityId,
    visitorId: row.id,
    action,
    expectedRevision: row.data.authorizationRevision ?? 0,
  });
}
export async function loadVisitorDecisionContext(session: Session, row: Row) {
  const config = await loadVisitorPolicy(session);
  if (row.data.communityId !== config.communityId) throw Error('Visitor is outside your community.');
  const hostId = row.data.hostUserId ?? row.data.residentId;
  const host = typeof hostId === 'string' && hostId && !hostId.includes('/')
    ? (await getDocFromServer(doc(firebase().db, 'users', hostId))).data() : undefined;
  // Current host identity is advisory here; the decision callable authorizes it again.
  const residentType = host?.communityId === config.communityId
    ? String(host.residentType ?? host.ownershipType ?? '') : undefined;
  return { config, residentType };
}
export function watchVisitorDecisionContext(
  session: Session, row: Row, changed: () => void, error: (error: Error) => void,
) {
  if (session.role !== 'admin' || row.data.communityId !== assertScope(session))
    throw Error('Visitor is outside your community.');
  const stopPolicy = watchVisitorPolicy(session, changed, error);
  const hostId = row.data.hostUserId ?? row.data.residentId;
  let stopHost = () => {};
  try {
    if (typeof hostId === 'string' && hostId && !hostId.includes('/'))
      stopHost = onSnapshot(doc(firebase().db, 'users', hostId), changed, error);
  } catch (e) {
    stopPolicy();
    throw e;
  }
  return () => { stopPolicy(); stopHost(); };
}
export function watchVisitorPolicy(
  session: Session,
  changed: () => void,
  error: (error: Error) => void,
) {
  const communityId = assertScope(session);
  return onSnapshot(doc(firebase().db, 'communities', communityId), () => changed(), error);
}
export function visitorError(error: unknown) {
  const code =
    typeof error === 'object' && error != null && 'code' in error ? String(error.code) : '';
  if (code.endsWith('aborted'))
    return 'This record changed on another device. Reload, review the latest state, and try again.';
  if (code.endsWith('permission-denied') || code.endsWith('unauthenticated'))
    return 'Community access denied. Sign in again or contact your Community Admin.';
  return error instanceof Error
    ? error.message
    : 'The request could not be completed. Please retry.';
}
