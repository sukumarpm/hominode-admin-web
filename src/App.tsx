import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import { Boundary } from './components';
import { Dashboard } from './Dashboard';
import { type Module } from './data';
import { call } from './firebase';
import { Login } from './Login';
import { CommunityPage, ModulePage, ProfilePage, ReportsPage, UnsupportedPage } from './pages';
import { assertResident, validSlug } from './policy';
import { APP_ROLE } from './role';
import { useAuth } from './session';
import { Shell } from './Shell';
import { SosPage } from './SosPage';
import { canUseFeature } from './subscription';
import { SubscriptionProvider, useSubscription } from './subscriptionContext';

function Guard() {
  const a = useAuth();
  if (a.loading) return <Boundary title="Welcome to Hominode" message="Verifying your session…" />;
  if (a.error)
    return (
      <Boundary message={a.error}>
        <button className="primary" onClick={() => void a.signOut()}>
          Sign out
        </button>
      </Boundary>
    );
  if (!a.session) return <Login />;
  if (a.session.role === 'admin' && !a.session.community)
    return (
      <Boundary title="Select your community" message="Choose an authorized community to continue.">
        {a.session.communities.map((c) => (
          <button className="primary" key={c.id} onClick={() => a.switchCommunity(c.id)}>
            {c.name}
          </button>
        ))}
        <button onClick={() => void a.signOut()}>Sign out</button>
      </Boundary>
    );
  return <Outlet />;
}
function TenantGate() {
  const { tenant = '' } = useParams();
  const a = useAuth();
  const [resolved, setResolved] = useState<{
    slug: string;
    communityId: string;
    name: string;
    error: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    if (!validSlug(tenant)) {
      setResolved({ slug: tenant, communityId: '', name: '', error: 'Community not found.' });
      return;
    }
    void call<{ communityId: string; slug: string; name: string }>('resolveResidentCommunity', {
      slug: tenant,
    })
      .then((c) => {
        if (!c.communityId || c.slug !== tenant || !c.name)
          throw Error('Community could not be verified.');
        if (active) setResolved({ ...c, error: '' });
      })
      .catch(() => {
        if (active)
          setResolved({
            slug: tenant,
            communityId: '',
            name: '',
            error: 'This community is unavailable. Please check the address or try again later.',
          });
      });
    return () => {
      active = false;
    };
  }, [tenant]);
  if (!resolved || resolved.slug !== tenant)
    return <Boundary title="Welcome to Hominode" message="Finding your community…" />;
  if (resolved.error) return <Boundary message={resolved.error} />;
  if (a.loading) return <Boundary title={resolved.name} message="Verifying your session…" />;
  if (a.error)
    return (
      <Boundary message={a.error}>
        <button onClick={() => void a.signOut()}>Sign out</button>
      </Boundary>
    );
  if (!a.session) return <Login communityName={resolved.name} />;
  try {
    if (!a.session.community || a.session.community.id !== resolved.communityId)
      throw Error('This account does not belong to the community in this address.');
    assertResident(a.session.profile, a.session.community, tenant);
  } catch (e) {
    return (
      <Boundary message={e instanceof Error ? e.message : 'Community access denied.'}>
        <button onClick={() => void a.signOut()}>Sign out</button>
      </Boundary>
    );
  }
  return <Outlet />;
}
function FeatureGuard({ feature }: { feature: string }) {
  const { entitlement, loading } = useSubscription();

  if (loading) {
    return <Boundary title="Checking subscription" message="Verifying your community plan…" />;
  }

  if (!canUseFeature(entitlement, feature)) {
    return (
      <Boundary
        title="Feature unavailable"
        message="This feature is not included in the current community subscription."
      />
    );
  }

  return <Outlet />;
}
function PlatformGuard() {
  const { session } = useAuth();
  return session?.role === 'superAdmin' ? (
    <Outlet />
  ) : (
    <Boundary message="A platform administrator is required." />
  );
}
function OperationsGuard() {
  const { session } = useAuth();
  return session?.role === 'superAdmin' ? (
    <Boundary message="Platform accounts cannot access operational community data." />
  ) : (
    <Outlet />
  );
}
function Landing() {
  const [slug, setSlug] = useState('');
  return (
    <main className="landing">
      <img src="/images/logo.png" alt="Hominode" />
      <p className="eyebrow">SMART PLACE. BETTER LIVES.</p>
      <h1>
        Better community.
        <br />
        Happier living.
      </h1>
      <p>Your home and community, beautifully connected.</p>
      <form onSubmit={(e) => e.preventDefault()}>
        <label>
          Community address
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="e.g. green-valley"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {validSlug(slug) && (
          <Link className="primary" to={'/' + slug}>
            Open community →
          </Link>
        )}
      </form>
    </main>
  );
}
const adminModules: Record<string, Module> = {
  residents: 'residents',
  buildings: 'buildings',
  units: 'units',
  visitors: 'visitors',
  deliveries: 'deliveries',
  complaints: 'complaints',
  requests: 'complaints',
  facilities: 'facilities',
  bookings: 'bookings',
  billing: 'billing',
  payments: 'payments',
  notices: 'notices',
  events: 'events',
  parking: 'parking',
  'resident-vehicles': 'vehicles',
  notifications: 'notifications',
};
const residentModules: Record<string, Module> = {
  visitors: 'visitors',
  complaints: 'complaints',
  requests: 'complaints',
  facilities: 'facilities',
  bookings: 'bookings',
  bills: 'billing',
  payments: 'payments',
  notices: 'notices',
  events: 'events',
  community: 'community',
  messages: 'messages',
  documents: 'documents',
  vehicles: 'vehicles',
  notifications: 'notifications',
};
function LegacyAdmin() {
  const { '*': tail = '' } = useParams();
  const aliases: Record<string, string> = {
    '': 'dashboard',
    amenities: 'facilities',
    'platform-overview': 'dashboard',
    community: 'community',
    reports: 'reports',
    settings: 'settings',
    profile: 'profile',
    communities: 'communities',
    admins: 'admins',
  };
  return (
    <Navigate to={'/' + (aliases[tail] || (tail in adminModules ? tail : 'dashboard'))} replace />
  );
}
function LegacyResident() {
  const { tenant = '', '*': tail = '' } = useParams();
  const aliases: Record<string, string> = {
    '': '',
    unit: 'apartment',
    apartment: 'apartment',
    profile: 'profile',
    settings: 'settings',
    deliveries: 'deliveries',
    sos: 'sos',
  };
  return (
    <Navigate
      to={'/' + tenant + '/' + (aliases[tail] ?? (tail in residentModules ? tail : ''))}
      replace
    />
  );
}
export function App() {
  return (
    <Routes>
      {APP_ROLE === 'admin' ? (
        <Route element={<Guard />}>
          <Route
            element={
              <SubscriptionProvider>
                <Shell />
              </SubscriptionProvider>
            }
          >
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="admin/*" element={<LegacyAdmin />} />
            <Route path="super-admin/*" element={<LegacyAdmin />} />
            <Route path="login" element={<Navigate to="/dashboard" replace />} />
            <Route element={<OperationsGuard />}>
              {Object.entries(adminModules)
                .filter(([path]) => !['events', 'bookings'].includes(path))
                .map(([path, module]) => (
                  <Route
                    key={path}
                    path={path}
                    element={<ModulePage key={path} module={module} routeName={path} />}
                  />
                ))}

              <Route element={<FeatureGuard feature="events" />}>
                <Route path="events" element={<ModulePage module="events" routeName="events" />} />
              </Route>
              <Route element={<FeatureGuard feature="facilityBooking" />}>
                <Route
                  path="bookings"
                  element={<ModulePage module="bookings" routeName="bookings" />}
                />
              </Route>
              <Route path="community" element={<CommunityPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="sos" element={<SosPage />} />
            </Route>
            <Route element={<PlatformGuard />}>
              <Route path="communities" element={<ModulePage module="communities" />} />
              <Route path="admins" element={<ModulePage module="admins" />} />
            </Route>
            <Route path="profile" element={<ProfilePage />} />
            <Route path="settings" element={<ProfilePage settings />} />
            {Object.entries({
              amenities: 'facilities',
              visitor_management: 'visitors',
              parking_management: 'parking',
              resident_vehicles: 'resident-vehicles',
              admin: 'dashboard',
            }).map(([from, to]) => (
              <Route key={from} path={from} element={<Navigate to={'/' + to} replace />} />
            ))}
            <Route
              path="*"
              element={
                <UnsupportedPage
                  title="Page not found"
                  message="Choose a page from the navigation."
                />
              }
            />
          </Route>
        </Route>
      ) : (
        <>
          <Route index element={<Landing />} />
          <Route path=":tenant" element={<TenantGate />}>
            <Route element={<Shell />}>
              <Route index element={<Dashboard />} />
              {Object.entries(residentModules).map(([path, module]) => (
                <Route
                  key={path}
                  path={path}
                  element={<ModulePage key={path} module={module} routeName={path} />}
                />
              ))}
              <Route path="resident/*" element={<LegacyResident />} />
              <Route path="apartment" element={<ProfilePage apartment />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="settings" element={<ProfilePage settings />} />
              <Route path="sos" element={<SosPage />} />
              <Route
                path="deliveries"
                element={
                  <UnsupportedPage
                    title="Deliveries"
                    message="Delivery tracking is not yet available on this web portal. Contact your community security desk for delivery updates."
                  />
                }
              />
              <Route path="unit" element={<Navigate to="../apartment" replace />} />
              <Route path="login" element={<Navigate to=".." replace />} />
              <Route
                path="*"
                element={
                  <UnsupportedPage
                    title="Page not found"
                    message="Choose a page from your community navigation."
                  />
                }
              />
            </Route>
          </Route>
        </>
      )}
    </Routes>
  );
}
