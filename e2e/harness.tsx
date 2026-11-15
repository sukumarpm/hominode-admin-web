// Test-only entry point, excluded from production builds.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthContext } from '../src/session';
import { makeSession } from '../src/test/fixtures';
import { APP_ROLE } from '../src/role';
import { selectCommunity } from '../src/policy';
import { type Session } from '../src/models';
import { App } from '../src/App';
import '../src/styles.css';
import { VisitorPolicySettings } from '../src/VisitorPolicySettings';
import { VisitorDecisionActions } from '../src/VisitorDecisionActions';
import type { VisitorPolicyResponse } from '../src/visitorPolicy';
const visitorPolicyFixture: VisitorPolicyResponse = {
  communityId: 'community-1',
  timeZone: 'Asia/Manila',
  writeRevision: 4,
  pendingSchedule: null,
  rolloutReady: true, // Synthetic offline fixture only.
  serverTime: Date.UTC(2026, 10, 9, 0, 30),
  policy: {
    schemaVersion: 1,
    enabled: false,
    timeZone: 'Asia/Manila',
    revision: 4,
    approvalMode: 'tenant_approval_required',
    emergency: { startAt: Date.UTC(2026, 10, 9), endAt: Date.UTC(2026, 10, 9, 1) },
    pets: {
      mode: 'temporarily_restricted',
      normalMode: 'allowed',
      restriction: { startAt: Date.UTC(2026, 10, 10), endAt: Date.UTC(2026, 10, 11) },
    },
  },
};
const offlineLoad = async () => visitorPolicyFixture;
const offlineWatch = () => () => {};
function Harness() {
  const [session, setSession] = useState<Session | null>(makeSession(APP_ROLE));
  if (location.pathname === '/__visitor-policy-test' && session)
    return (
      <main style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
        <VisitorPolicySettings
          session={session}
          load={offlineLoad}
          save={async (_s, policy, revision, effectiveAt) => {
            Object.assign(visitorPolicyFixture, {
              writeRevision: revision + 1,
              policy:
                effectiveAt == null
                  ? { ...policy, revision: revision + 1 }
                  : visitorPolicyFixture.policy,
              pendingSchedule:
                effectiveAt == null ? null : { policy, revision: revision + 1, effectiveAt },
            });
            return structuredClone(visitorPolicyFixture);
          }}
          watch={offlineWatch}
        />
        <VisitorDecisionActions
          session={session}
          row={{
            id: 'visitor-1',
            data: {
              communityId: 'community-1',
              visitorName: 'Offline Guest',
              hostName: 'Policy Host',
              flatLabel: 'N014',
              status: 'expected',
              authorizationState: 'pending_admin',
              authorizationRevision: 7,
            },
          }}
          decide={async () => ({ authorizationState: 'admin_authorized' })}
        />
      </main>
    );
  return (
    <AuthContext
      value={{
        session,
        loading: false,
        error: '',
        authenticated: !!session,
        switchCommunity: (id) => setSession((s) => (s ? selectCommunity(s, id) : null)),
        signOut: async () => setSession(null),
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthContext>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
