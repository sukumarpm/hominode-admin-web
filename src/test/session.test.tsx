import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';
import { SessionProvider, useAuth } from '../session';
import { APP_ROLE } from '../role';
import { adminData, residentData } from './fixtures';
import { type Data } from '../models';
type User = {
  uid: string;
  phoneNumber: string;
  getIdTokenResult: () => Promise<{ signInProvider: string }>;
};
type Snap = { exists: () => boolean; data: () => Data };
const m = vi.hoisted(() => ({
  authCallback: undefined as undefined | ((user: User | null) => Promise<void> | void),
  listeners: new Map<
    string,
    { next: (snap: Snap) => void; error: (error: Error) => void; stop: ReturnType<typeof vi.fn> }
  >(),
  stopAuth: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../firebase', () => ({
  firebase: () => ({
    auth: { currentUser: { uid: APP_ROLE === 'admin' ? 'admin-1' : 'resident-1' } },
    db: {},
  }),
}));
vi.mock('firebase/auth', () => ({
  onIdTokenChanged: (_auth: unknown, callback: typeof m.authCallback) => {
    m.authCallback = callback;
    return m.stopAuth;
  },
  signOut: m.signOut,
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => col + '/' + id,
  onSnapshot: (path: string, next: (snap: Snap) => void, error: (error: Error) => void) => {
    const listener = { next, error, stop: vi.fn() };
    m.listeners.set(path, listener);
    return listener.stop;
  },
}));
function Probe() {
  const a = useAuth();
  return (
    <>
      <span>
        {a.loading
          ? 'Loading'
          : a.session
            ? 'Authorized ' + a.session.community?.id
            : a.authenticated
              ? 'Denied'
              : 'Signed out'}
      </span>
      <p>{a.error}</p>
      <button onClick={() => void a.signOut().catch(() => {})}>Sign out</button>
    </>
  );
}
const profile = APP_ROLE === 'admin' ? adminData : residentData;
function send(path: string, data: Data) {
  act(() => m.listeners.get(path)!.next({ exists: () => true, data: () => data }));
}
async function authorize() {
  await act(() =>
    m.authCallback!({
      uid: String(profile.uid),
      phoneNumber: '+639171234567',
      getIdTokenResult: async () => ({ signInProvider: 'phone' }),
    }),
  );
  send((APP_ROLE === 'admin' ? 'admins/' : 'users/') + profile.uid, profile);
  send('communities/community-1', { name: 'Green Valley', slug: 'green-valley', isActive: true });
  if (APP_ROLE === 'admin')
    send('communities/community-2', { name: 'Sunridge', slug: 'sunridge', isActive: true });
}
beforeEach(() => {
  m.listeners.clear();
  vi.clearAllMocks();
  m.signOut.mockResolvedValue(undefined);
});
it('resolves persisted authorized selection and responds to profile revocation', async () => {
  localStorage.setItem('hominode_web_active_tenant_' + profile.uid, 'community-1');
  const view = render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  await authorize();
  expect(await screen.findByText('Authorized community-1')).toBeInTheDocument();
  send((APP_ROLE === 'admin' ? 'admins/' : 'users/') + profile.uid, {
    ...profile,
    isActive: false,
  });
  expect(
    await screen.findByText('Your account is inactive. Contact your community administrator.'),
  ).toBeInTheDocument();
  expect(screen.queryByText('Authorized community-1')).not.toBeInTheDocument();
  view.unmount();
  expect(m.stopAuth).toHaveBeenCalledOnce();
  for (const l of m.listeners.values()) expect(l.stop).toHaveBeenCalled();
});
it('sign out clears resolved state and stored tenant only after auth succeeds', async () => {
  const key = 'hominode_web_active_tenant_' + profile.uid;
  localStorage.setItem(key, 'community-1');
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  await authorize();
  m.signOut.mockImplementation(async () => {
    expect(screen.getByText('Authorized community-1')).toBeInTheDocument();
    await m.authCallback!(null);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(screen.getByText('Signed out')).toBeInTheDocument());
  expect(m.signOut).toHaveBeenCalledOnce();
  expect(localStorage.getItem(key)).toBeNull();
});
it('does not report sign-out success when auth sign-out fails', async () => {
  localStorage.setItem('hominode_web_active_tenant_' + profile.uid, 'community-1');
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  await authorize();
  m.signOut.mockRejectedValue(Error('Sign out unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(m.signOut).toHaveBeenCalledOnce());
  expect(screen.getByText('Authorized community-1')).toBeInTheDocument();
});
it('rejects a non-phone authentication session before reading profiles', async () => {
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  await act(() =>
    m.authCallback!({
      uid: String(profile.uid),
      phoneNumber: '+639171234567',
      getIdTokenResult: async () => ({ signInProvider: 'password' }),
    }),
  );
  expect(await screen.findByText('Sign in with your registered phone number.')).toBeInTheDocument();
  expect(m.listeners.size).toBe(0);
});
