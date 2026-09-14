import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onIdTokenChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { firebase } from './firebase';
import { APP_ROLE } from './role';
import { parseCommunity, parseProfile, assertResident, selectCommunity } from './policy';
import { type Community, type Session } from './models';
export interface AuthState {
  session: Session | null;
  loading: boolean;
  error: string;
  authenticated: boolean;
  switchCommunity: (id: string) => void;
  signOut: () => Promise<void>;
}
export const AuthContext = createContext<AuthState | null>(null);
export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) throw Error('Missing session provider');
  return value;
};
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    session: Session | null;
    loading: boolean;
    error: string;
    authenticated: boolean;
  }>({ session: null, loading: true, error: '', authenticated: false });
  useEffect(() => {
    let alive = true,
      version = 0,
      profileVersion = 0;
    let stops: (() => void)[] = [];
    const clear = () => {
      stops.forEach((s) => s());
      stops = [];
    };
    const fail = (e: unknown) => {
      if (alive)
        setState((v) => ({
          ...v,
          session: null,
          loading: false,
          error: e instanceof Error ? e.message : 'Your access could not be verified.',
        }));
    };
    const stop = onIdTokenChanged(
      firebase().auth,
      async (user) => {
        const current = ++version;
        clear();
        setState({ session: null, loading: !!user, error: '', authenticated: !!user });
        if (!user) return;
        try {
          const token = await user.getIdTokenResult();
          if (!alive || current !== version) return;
          if (token.signInProvider !== 'phone')
            throw Error('Sign in with your registered phone number.');
          let tenantStops: (() => void)[] = [];
          stops.push(() => tenantStops.forEach((s) => s()));
          stops.push(
            onSnapshot(
              doc(firebase().db, APP_ROLE === 'admin' ? 'admins' : 'users', user.uid),
              (snapshot) => {
                if (!alive || current !== version) return;
                const revision = ++profileVersion;
                tenantStops.forEach((s) => s());
                tenantStops = [];
                // Profile changes revoke existing page data before resolving new authority.
                setState({ session: null, loading: true, error: '', authenticated: true });
                try {
                  if (!snapshot.exists())
                    throw Error(
                      'No account is linked to this phone number. Contact your community administrator.',
                    );
                  const p = parseProfile(
                    user.uid,
                    snapshot.data(),
                    APP_ROLE,
                    user.phoneNumber || '',
                  );
                  if (p.role === 'superAdmin') {
                    setState({
                      session: {
                        uid: user.uid,
                        role: p.role,
                        profile: p,
                        communities: [],
                        community: null,
                      },
                      loading: false,
                      error: '',
                      authenticated: true,
                    });
                    return;
                  }
                  const ids = p.role === 'admin' ? p.authorizedCommunityIds : [p.communityId];
                  const tenants = new Map<string, Community>();
                  const pending = new Set(ids);
                  const publish = () => {
                    if (
                      !alive ||
                      current !== version ||
                      revision !== profileVersion ||
                      pending.size
                    )
                      return;
                    const communities = [...tenants.values()];
                    if (!communities.length) {
                      fail(Error('No authorized active communities are available.'));
                      return;
                    }
                    if (p.role === 'resident') {
                      try {
                        assertResident(p, communities[0]);
                      } catch (e) {
                        fail(e);
                        return;
                      }
                    }
                    const persisted = localStorage.getItem(
                      'hominode_web_active_tenant_' + user.uid,
                    );
                    const community =
                      communities.find((c) => c.id === persisted) ||
                      (communities.length === 1 ? communities[0] : null);
                    if (persisted && !communities.some((c) => c.id === persisted))
                      localStorage.removeItem('hominode_web_active_tenant_' + user.uid);
                    setState({
                      session: { uid: user.uid, role: p.role, profile: p, communities, community },
                      loading: false,
                      error: '',
                      authenticated: true,
                    });
                  };
                  for (const id of ids)
                    tenantStops.push(
                      onSnapshot(
                        doc(firebase().db, 'communities', id),
                        (snap) => {
                          pending.delete(id);
                          try {
                            tenants.set(id, parseCommunity(id, snap.data() || {}));
                          } catch {
                            tenants.delete(id);
                          }
                          publish();
                        },
                        () => {
                          pending.delete(id);
                          tenants.delete(id);
                          publish();
                        },
                      ),
                    );
                } catch (e) {
                  fail(e);
                }
              },
              (error) => {
                if (alive && current === version) fail(error);
              },
            ),
          );
        } catch (e) {
          if (alive && current === version) fail(e);
        }
      },
      fail,
    );
    return () => {
      alive = false;
      ++version;
      stop();
      clear();
    };
  }, []);
  const switchCommunity = (id: string) => {
    if (!state.session) return;
    const session = selectCommunity(state.session, id);
    localStorage.setItem('hominode_web_active_tenant_' + session.uid, id);
    setState({ ...state, session });
  };
  const signOut = async () => {
    const uid = firebase().auth.currentUser?.uid;
    await firebaseSignOut(firebase().auth);
    if (uid) localStorage.removeItem('hominode_web_active_tenant_' + uid);
    setState({ session: null, loading: false, error: '', authenticated: false });
  };
  return <AuthContext value={{ ...state, switchCommunity, signOut }}>{children}</AuthContext>;
}
