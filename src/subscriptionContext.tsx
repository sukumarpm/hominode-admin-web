import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import type { CommunityEntitlement } from './subscription';
import { getCommunityEntitlement } from './subscription';
import { useAuth } from './session';

interface SubscriptionState {
  entitlement: CommunityEntitlement | null;
  loading: boolean;
  error: string;
}

const SubscriptionContext = createContext<SubscriptionState | null>(null);

export function useSubscription() {
  const value = useContext(SubscriptionContext);
  if (!value) throw Error('Missing subscription provider');
  return value;
}

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();

  const [state, setState] = useState<SubscriptionState>({
    entitlement: null,
    loading: true,
    error: '',
  });

  useEffect(() => {
    let active = true;

    if (!session || session.role !== 'admin' || !session.community) {
      setState({
        entitlement: null,
        loading: false,
        error: '',
      });
      return () => {
        active = false;
      };
    }

    setState({
      entitlement: null,
      loading: true,
      error: '',
    });

    void getCommunityEntitlement(session)
      .then((entitlement) => {
        if (!active) return;
        setState({
          entitlement,
          loading: false,
          error: '',
        });
      })
      .catch((error: unknown) => {
        if (!active) return;

        setState({
          entitlement: null,
          loading: false,
          error:
            error instanceof Error ? error.message : 'Subscription access could not be verified.',
        });
      });

    return () => {
      active = false;
    };
  }, [session?.uid, session?.community?.id, session?.role]);

  return <SubscriptionContext value={state}>{children}</SubscriptionContext>;
}
