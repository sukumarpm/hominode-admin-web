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

async function adminScope(session: Session) {
  if (session.role !== 'admin' || session.profile.role !== 'admin')
    throw Error('A Community Admin is required.');
  const id = assertScope(session);
  const fresh = await currentAuthority(session);
  if (
    fresh.role !== 'admin' ||
    fresh.community.id !== id ||
    !fresh.profile.authorizedCommunityIds.includes(id)
  )
    throw Error('Community access changed. Reload before continuing.');
  return id;
}
export async function loadVisitorPolicy(session: Session): Promise<VisitorPolicyResponse> {
  const communityId = await adminScope(session);
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
}
export async function saveVisitorPolicy(
  session: Session,
  policy: VisitorPolicyInput,
  expectedRevision: number,
  effectiveAt?: number,
) {
  const config = await loadVisitorPolicy(session);
  const receivedAt = performance.now();
  if (policy.enabled && config.rolloutReady !== true)
    throw Error('Saving is blocked until visitor policy rollout is ready for this community.');
  const zoneError = visitorTimeZoneError(config.timeZone);
  if (zoneError) throw Error(zoneError);
  if (expectedRevision !== config.writeRevision)
    throw Object.assign(Error('Visitor policy changed. Reload before saving.'), {
      code: 'functions/aborted',
    });
  const communityId = await adminScope(session);
  if (config.communityId !== communityId) throw Error('Policy is outside your community.');
  if (
    effectiveAt != null &&
    (!Number.isSafeInteger(effectiveAt) ||
      effectiveAt <= config.serverTime + Math.max(0, performance.now() - receivedAt))
  )
    throw Error('Choose a future policy effective time.');
  await call('updateCommunityVisitorPolicy', {
    communityId,
    policy: { ...policyInput(policy), timeZone: config.timeZone },
    expectedRevision,
    ...(effectiveAt == null ? {} : { effectiveAt }),
  });
  return loadVisitorPolicy(session);
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
