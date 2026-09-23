import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Search, Menu, Bell, Building2, LogOut, X } from 'lucide-react';
import { useAuth } from './session';
import { adminNav, residentNav, platformNav, type Navigation } from './navigation';
import { useRows } from './data';
import { type Session } from './models';
import { canUseFeature } from './subscription';
import { useSubscription } from './subscriptionContext';
function InboxLink({ session, href }: { session: Session; href: string }) {
  const inbox = useRows(session, 'notifications');
  const unread = inbox.rows.filter((r) => r.data.isRead !== true).length;
  return (
    <Link
      className="icon-button notification-button"
      to={href}
      aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
    >
      <Bell size={24} />
      {unread > 0 && <span>{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}
export function Shell() {
  const { session, switchCommunity, signOut } = useAuth();
  if (!session) throw Error('Session is required.');
  return (
    <AuthenticatedShell session={session} switchCommunity={switchCommunity} signOut={signOut} />
  );
}
function AuthenticatedShell({
  session: s,
  switchCommunity,
  signOut,
}: {
  session: Session;
  switchCommunity: (id: string) => void;
  signOut: () => Promise<void>;
}) {
  const resident = s.role === 'resident';
  const base = resident ? '/' + s.community!.slug + '/' : '/';

  const subscription =
    s.role === 'admin' ? useSubscription() : { entitlement: null, loading: false, error: '' };

  const rawNav = resident ? residentNav : s.role === 'superAdmin' ? platformNav : adminNav;

  const nav =
    s.role !== 'admin'
      ? rawNav
      : rawNav.filter((item) => {
          if (item.path === 'events') {
            return canUseFeature(subscription.entitlement, 'events');
          }

          return true;
        });
  const [open, setOpen] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [search, setSearch] = useState(''),
    [logoutError, setLogoutError] = useState('');
  const location = useLocation(),
    navigate = useNavigate();
  const drawer = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    setOpen(false);
    setSearch('');
  }, [location.pathname]);
  useEffect(() => {
    if (open) drawer.current?.showModal();
    else drawer.current?.close();
  }, [open]);
  const matching = search.trim()
    ? nav.filter((n) => n.label.toLowerCase().includes(search.toLowerCase()))
    : [];
  const navigation = (items: Navigation[]) => (
    <nav aria-label="Main navigation">
      {items.map(({ path, label, icon: Icon }) => (
        <NavLink key={path} to={base + path} end>
          <Icon size={21} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
  const brand = (
    <Link className="brand" to={base + (resident ? '' : 'dashboard')}>
      <img src="/images/logo.png" alt="" />
      <strong>HOMINODE</strong>
      <span>Smart living. Better lives.</span>
    </Link>
  );
  const logout = async () => {
    try {
      await signOut();
    } catch {
      setLogoutError('Sign out could not be completed. Please retry.');
    }
  };
  return (
    <div
      className={'app ' + (resident ? 'resident' : 'admin') + (collapsed ? ' collapsed' : '')}
      data-testid="app-shell"
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        {brand}
        {navigation(nav)}
        <div className="sidebar-profile">
          <Link to={base + 'profile'}>
            <span className="avatar">{s.profile.name.slice(0, 2).toUpperCase()}</span>
            <span>
              <strong>{s.profile.name}</strong>
              <small>{s.profile.flatLabel || s.community?.name || 'Platform Admin'}</small>
            </span>
          </Link>
          <button onClick={logout}>
            <LogOut size={18} />
            <span>Log out</span>
          </button>
        </div>
      </aside>
      <dialog ref={drawer} className="mobile-drawer" onCancel={() => setOpen(false)}>
        <button
          className="icon-button drawer-close"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        >
          <X />
        </button>
        {brand}
        {navigation(nav)}
        <button onClick={logout}>
          <LogOut /> Log out
        </button>
      </dialog>
      <div className="workspace">
        <header className="toolbar">
          <button
            className="icon-button desktop-menu"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            <Menu />
          </button>
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <Menu />
          </button>
          <div className="global-search">
            <Search size={19} />
            <input
              aria-label="Find a page"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                resident
                  ? 'Find visitors, facilities, notices…'
                  : 'Find residents, visitors, reports…'
              }
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearch('');
                if (e.key === 'Enter' && matching[0]) navigate(base + matching[0].path);
              }}
            />
            {search && (
              <div className="search-results">
                {matching.length ? (
                  matching.map((item) => (
                    <Link key={item.path} to={base + item.path}>
                      {item.label}
                    </Link>
                  ))
                ) : (
                  <p>No matching pages</p>
                )}
              </div>
            )}
          </div>
          <div className="toolbar-end">
            {s.role === 'admin' ? (
              <label className="community-select">
                <Building2 size={20} />
                <span className="sr-only">Selected community</span>
                <select
                  aria-label="Selected community"
                  value={s.community?.id || ''}
                  onChange={(e) => switchCommunity(e.target.value)}
                >
                  {s.communities.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="community-name">
                <Building2 size={20} />
                {s.community?.name || 'Hominode platform'}
              </span>
            )}
            {s.role !== 'superAdmin' && <InboxLink session={s} href={base + 'notifications'} />}
            <Link to={base + 'profile'} className="avatar toolbar-avatar" aria-label="My profile">
              {s.profile.name.slice(0, 2).toUpperCase()}
            </Link>
          </div>
        </header>
        {logoutError && <p role="alert">{logoutError}</p>}
        <main id="main-content" tabIndex={-1}>
          <div key={s.community?.id || 'platform'} className="route-content">
            <Outlet />
          </div>
        </main>
        <footer className="site-footer">
          HOMINODE <span>Smart place. Better lives.</span>
        </footer>
      </div>
    </div>
  );
}
