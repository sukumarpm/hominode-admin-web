import { call } from './firebase';
import type { Session } from './models';

export type SubscriptionFeatures = Record<string, boolean>;

export interface CommunityEntitlement {
  communityId: string;
  planId: string;
  planName: string;
  status: string;
  startsAtMs: number | null;
  endsAtMs: number | null;
  features: SubscriptionFeatures;
  limits: Record<string, unknown>;
  schemaVersion: number;
}

export function canUseFeature(
  entitlement: CommunityEntitlement | null,
  feature: string,
  nowMs = Date.now(),
): boolean {
  if (!entitlement || entitlement.features?.[feature] !== true) return false;

  if (
    entitlement.startsAtMs != null &&
    (!Number.isFinite(entitlement.startsAtMs) || nowMs < entitlement.startsAtMs)
  ) {
    return false;
  }

  if (
    entitlement.endsAtMs != null &&
    (!Number.isFinite(entitlement.endsAtMs) || nowMs >= entitlement.endsAtMs)
  ) {
    return false;
  }

  if (entitlement.status === 'active') return true;

  if (
    (entitlement.status === 'trial' || entitlement.status === 'grace') &&
    entitlement.endsAtMs != null
  ) {
    return true;
  }

  return false;
}

export async function getCommunityEntitlement(
  session: Session,
): Promise<CommunityEntitlement | null> {
  if (session.role !== 'admin' || !session.community) return null;

  return call<CommunityEntitlement>('getCommunitySubscription', {
    communityId: session.community.id,
  });
}
