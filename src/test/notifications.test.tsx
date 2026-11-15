import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Notifications } from '../Notifications';
import { AuthContext, type AuthState } from '../session';
import { type Data, type Session } from '../models';
import { makeSession, secondCommunity } from './fixtures';

const mocks = vi.hoisted(() => ({
  listeners: [] as {
    next: (value: unknown) => void;
    error: (error: Error) => void;
    stop: ReturnType<typeof vi.fn>;
  }[],
  update: vi.fn(),
  where: vi.fn(),
}));
vi.mock('../actions', () => ({ updateScoped: mocks.update }));
vi.mock('../firebase', () => ({ firebase: () => ({ db: {} }), call: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  documentId: () => '__name__',
  query: vi.fn(),
  where: mocks.where,
  onSnapshot: vi.fn((_query, next, error) => {
    const listener = { next, error, stop: vi.fn() };
    mocks.listeners.push(listener);
    return listener.stop;
  }),
}));

const reference = 'HSP-' + 'A'.repeat(24);
const support: Data = {
  communityId: 'community-1',
  recipientId: 'admin-1',
  audience: 'admin',
  role: 'admin',
  appId: 'admin',
  title: 'Security request: Registered phone number',
  message: `Officer One (+639170000001)\n\nPlease update my phone number.\n\nReference: ${reference}`,
  metadata: { eventType: 'security_support_request', topic: 'phone_number', reference },
  type: 'general',
  isRead: false,
  createdAt: new Date('2026-11-08T10:30:00Z'),
};
function mount(session = makeSession('admin')) {
  const auth = (s: Session): AuthState => ({
    session: s,
    loading: false,
    error: '',
    authenticated: true,
    signOut: vi.fn(),
    switchCommunity: vi.fn(),
  });
  const view = render(
    <AuthContext value={auth(session)}>
      <Notifications />
    </AuthContext>,
  );
  return {
    ...view,
    changeSession: (s: Session) =>
      view.rerender(
        <AuthContext value={auth(s)}>
          <Notifications />
        </AuthContext>,
      ),
  };
}
function emit(...rows: Data[]) {
  act(() =>
    mocks.listeners
      .at(-1)!
      .next({ docs: rows.map((data, i) => ({ id: `notification-${i}`, data: () => data })) }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners = [];
  mocks.update.mockResolvedValue(undefined);
});

it('queries only the signed-in Admin and active community and displays full support content', () => {
  mount();
  for (const [field, value] of Object.entries({
    communityId: 'community-1',
    recipientId: 'admin-1',
    audience: 'admin',
    role: 'admin',
    appId: 'admin',
  }))
    expect(mocks.where).toHaveBeenCalledWith(field, '==', value);
  emit(
    support,
    { ...support, recipientId: 'admin-2', title: 'Private other Admin' },
    { ...support, communityId: 'community-2', title: 'Private other community' },
  );
  expect(screen.getByText('Security support request')).toBeInTheDocument();
  expect(screen.getByText(/Please update my phone number/)).toHaveTextContent('Officer One');
  expect(
    screen.getByText(`Reference: ${reference}`, { selector: '.notification-reference' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Unread')).toBeInTheDocument();
  expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-11-08T10:30:00.000Z');
  expect(screen.queryByText('Private other Admin')).not.toBeInTheDocument();
  expect(screen.queryByText('Private other community')).not.toBeInTheDocument();
});

it('never shows another Admin’s notification even when a snapshot contains it', () => {
  const s = makeSession('admin');
  mount({ ...s, uid: 'admin-2', profile: { ...s.profile, uid: 'admin-2' } });
  emit(support);
  expect(screen.getByText('You have no notifications in this community.')).toBeInTheDocument();
  expect(screen.queryByText(support.title as string)).not.toBeInTheDocument();
});

it('clears notifications and pending UI immediately on community or identity change', async () => {
  let fail!: (e: Error) => void;
  mocks.update.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  const session = makeSession('admin');
  const view = mount(session);
  emit(support);
  fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
  const old = mocks.listeners.at(-1)!;
  view.changeSession({ ...session, community: secondCommunity });
  expect(screen.queryByText(support.title as string)).not.toBeInTheDocument();
  expect(old.stop).toHaveBeenCalledOnce();
  act(() => old.next({ docs: [{ id: 'stale', data: () => support }] }));
  await act(async () => fail(Error('Stale request error')));
  expect(screen.queryByText('Stale request error')).not.toBeInTheDocument();
  emit(support);
  expect(screen.getByText('You have no notifications in this community.')).toBeInTheDocument();
  view.changeSession({
    ...session,
    uid: 'admin-2',
    profile: { ...session.profile, uid: 'admin-2' },
  });
  expect(screen.getByRole('status')).toBeInTheDocument();
  emit(support);
  expect(screen.queryByText(support.title as string)).not.toBeInTheDocument();
});

it('marks read only after confirmation and prevents duplicate submissions', async () => {
  let finish!: () => void;
  mocks.update.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const s = makeSession('admin');
  mount(s);
  emit(support);
  fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
  expect(screen.getByRole('button', { name: 'Marking as read…' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Marking as read…' }));
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith(s, 'notifications', 'notification-0', {});
  expect(screen.getByText('Unread')).toBeInTheDocument();
  await act(async () => finish());
  expect(screen.getByText('Read')).toBeInTheDocument();
});

it('keeps unread on a failed write and allows retry', async () => {
  mocks.update.mockRejectedValueOnce(Error('permission-denied'));
  mount();
  emit(support);
  fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Notification access was denied');
  expect(screen.getByText('Unread')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
  expect(await screen.findByText('Read')).toBeInTheDocument();
});

it('keeps existing notification types and body fields visible', () => {
  mount();
  emit(
    {
      ...support,
      metadata: {},
      type: 'payment',
      title: 'Payment received',
      message: 'Payment confirmed',
      isRead: true,
    },
    {
      ...support,
      metadata: {},
      type: 'chat',
      title: 'Community chat',
      message: undefined,
      body: 'A new message',
    },
  );
  expect(screen.getByText('Payment confirmed')).toBeInTheDocument();
  const chat = screen.getByRole('article', { name: 'Community chat' });
  expect(within(chat).getByText('A new message')).toBeInTheDocument();
  expect(within(chat).getByText('Unread')).toBeInTheDocument();
  expect(screen.queryByText('Security support request')).not.toBeInTheDocument();
});

it('renders loading and empty states, including an inbox containing only deleted items', () => {
  mount();
  expect(screen.getByRole('status', { name: 'Loading information' })).toBeInTheDocument();
  emit();
  expect(screen.getByText('You have no notifications in this community.')).toBeInTheDocument();
  emit({ ...support, deletedAt: new Date() });
  expect(screen.getByText('You have no notifications in this community.')).toBeInTheDocument();
});

it.each([
  ['permission-denied', 'Notification access was denied'],
  ['The query requires an index. Create it in the Firebase console.', 'check the required index'],
  ['Service unavailable', 'Service unavailable'],
])('handles %s explicitly, clears data, and retries', (error, expected) => {
  mount();
  emit(support);
  act(() => mocks.listeners.at(-1)!.error(Error(error)));
  expect(screen.getByRole('alert')).toHaveTextContent(expected);
  expect(screen.queryByText(support.title as string)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry notifications' }));
  expect(screen.getByRole('status')).toBeInTheDocument();
  emit(support);
  expect(screen.getByText(support.title as string)).toBeInTheDocument();
});

it('does not subscribe without an authorized Admin community', () => {
  const s = makeSession('admin');
  mount({ ...s, community: { ...secondCommunity, id: 'unauthorized' } });
  expect(screen.getByRole('alert')).toHaveTextContent('authorized Community Admin');
  expect(mocks.listeners).toHaveLength(0);
});
