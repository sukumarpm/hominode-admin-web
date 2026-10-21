import { collection, where } from 'firebase/firestore';
import { renderHook, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { makeSession } from './fixtures';
const m = vi.hoisted(() => ({
  listeners: [] as {
    next: (value: unknown) => void;
    error: (error: Error) => void;
    stop: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock('../firebase', () => ({ firebase: () => ({ db: {} }), call: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  documentId: () => '__name__',
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn((_q, next, error) => {
    const listener = { next, error, stop: vi.fn() };
    m.listeners.push(listener);
    return listener.stop;
  }),
}));
import { useAdminV2PaymentProofs, useAdminV2RecurringSchedules, useRows } from '../data';
it('shares listeners, filters mismatched records and cleans up on unmount', () => {
  const s = makeSession();
  const first = renderHook(() => useRows(s, 'visitors'));
  const second = renderHook(() => useRows(s, 'visitors'));
  expect(m.listeners).toHaveLength(1);
  const l = m.listeners[0];
  act(() =>
    l.next({
      docs: [
        {
          id: 'own',
          data: () => ({
            communityId: 'community-1',
            hostUserId: s.uid,
            visitorName: 'Own visitor',
          }),
        },
        { id: 'foreign', data: () => ({ communityId: 'community-2', hostUserId: s.uid }) },
      ],
    }),
  );
  expect(first.result.current.rows.map((r) => r.id)).toEqual(['own']);
  expect(second.result.current.rows).toEqual(first.result.current.rows);
  first.unmount();
  expect(l.stop).not.toHaveBeenCalled();
  second.unmount();
  expect(l.stop).toHaveBeenCalledOnce();
});
it('clears old community results immediately when switching scope', () => {
  const first = makeSession('admin');
  const { result, rerender, unmount } = renderHook(({ s }) => useRows(s, 'visitors'), {
    initialProps: { s: first },
  });
  const l = m.listeners.at(-1)!;
  act(() => l.next({ docs: [{ id: 'one', data: () => ({ communityId: 'community-1' }) }] }));
  expect(result.current.rows).toHaveLength(1);
  rerender({ s: { ...first, community: first.communities[1] } });
  expect(result.current.rows).toHaveLength(0);
  expect(result.current.loading).toBe(true);
  expect(l.stop).toHaveBeenCalledOnce();
  const next = m.listeners.at(-1)!;
  act(() => next.error(Error('Access denied')));
  expect(result.current.error).toBe('Access denied');
  expect(result.current.rows).toHaveLength(0);
  unmount();
});

it('subscribes Admin only to community V2 proofs and preserves Firestore document IDs', async () => {
  const firestore = await import('firebase/firestore');
  const session = makeSession('admin');
  const start = m.listeners.length;
  const { result, unmount } = renderHook(() => useAdminV2PaymentProofs(session, true));
  const listener = m.listeners[start];

  expect(firestore.collection).toHaveBeenCalledWith(expect.anything(), 'paymentProofsV2');
  expect(firestore.where).toHaveBeenCalledWith('communityId', '==', 'community-1');
  act(() =>
    listener.next({
      docs: [
        {
          id: 'firestore-proof-id',
          data: () => ({ id: 'embedded-proof-id', communityId: 'community-1' }),
        },
        {
          id: 'foreign-proof-id',
          data: () => ({ communityId: 'community-2' }),
        },
      ],
    }),
  );

  expect(result.current.rows.map((row) => row.id)).toEqual(['firestore-proof-id']);
  expect(result.current.rows[0].data.id).toBe('embedded-proof-id');
  unmount();
  expect(listener.stop).toHaveBeenCalledOnce();
});

it('does not subscribe residents to paymentProofsV2', () => {
  const start = m.listeners.length;
  const { result, unmount } = renderHook(() =>
    useAdminV2PaymentProofs(makeSession('resident'), true),
  );
  expect(result.current).toEqual({ rows: [], loading: false, error: '' });
  expect(m.listeners).toHaveLength(start);
  unmount();
});

it.each(['resident', 'admin'] as const)(
  'does not republish stale notices after a notice listener loses permission (%s)',
  async (role) => {
    const { call } = await import('../firebase');
    vi.mocked(call).mockResolvedValue({
      communityId: 'community-1',
      flatId: 'unit-1',
      noticeIds: ['notice-1', 'notice-2'],
    });
    const start = m.listeners.length;
    const session = makeSession(role);
    const { result, unmount } = renderHook(() => useRows(session, 'notices'));
    await act(async () => {
      await Promise.resolve();
    });
    const listeners = m.listeners.slice(start);
    expect(listeners).toHaveLength(role === 'resident' ? 4 : 3);
    const notice = (id: string, title: string) => ({
      id,
      exists: () => true,
      data: () => ({ communityId: 'community-1', title, content: `${title} content` }),
    });
    act(() => {
      listeners[0].next({ docs: [] });
      if (role === 'resident') {
        listeners[1].next({ docs: [] });
        listeners[2].next(notice('notice-1', 'First notice'));
        listeners[3].next(notice('notice-2', 'Second notice'));
      } else {
        listeners[1].next({
          docs: [notice('notice-1', 'First notice'), notice('notice-2', 'Second notice')],
        });
        listeners[2].next({ docs: [] });
      }
    });
    expect(result.current.rows.map((row) => row.id).sort()).toEqual(['notice-1', 'notice-2']);
    const denied = Object.assign(Error('Notice access revoked'), { code: 'permission-denied' });
    act(() => listeners[role === 'resident' ? 2 : 1].error(denied));
    expect(result.current).toEqual({ rows: [], loading: false, error: 'Notice access revoked' });
    act(() => {
      // Simulate already queued callbacks even after the listeners are stopped.
      listeners[0].next({
        docs: [
          {
            id: 'announcement-1',
            data: () => ({
              communityId: 'community-1',
              status: 'published',
              title: 'Late announcement',
              content: 'Must remain hidden',
            }),
          },
        ],
      });
      if (role === 'resident') listeners[3].next(notice('notice-2', 'Changed notice'));
      else listeners[2].next({ docs: [notice('old-announcement', 'Changed notice')] });
    });
    expect(result.current).toEqual({ rows: [], loading: false, error: 'Notice access revoked' });
    listeners.forEach((listener) => expect(listener.stop).toHaveBeenCalledOnce());
    unmount();
    listeners.forEach((listener) => expect(listener.stop).toHaveBeenCalledOnce());
  },
);

it('subscribes Admin only to own-community recurring schedules', async () => {
  const firestore = await import('firebase/firestore');
  const session = makeSession('admin');
  const start = m.listeners.length;

  const { result, unmount } = renderHook(() => useAdminV2RecurringSchedules(session, true));

  const listener = m.listeners[start];

  expect(firestore.collection).toHaveBeenCalledWith(expect.anything(), 'billingSchedules');
  expect(firestore.where).toHaveBeenCalledWith('communityId', '==', 'community-1');

  act(() =>
    listener.next({
      docs: [
        {
          id: 'schedule-own',
          data: () => ({
            id: 'schedule-own',
            communityId: 'community-1',
          }),
        },
        {
          id: 'schedule-foreign',
          data: () => ({
            id: 'schedule-foreign',
            communityId: 'community-2',
          }),
        },
      ],
    }),
  );

  expect(result.current.rows.map((row) => row.id)).toEqual(['schedule-own']);

  unmount();
  expect(listener.stop).toHaveBeenCalledOnce();
});

it('does not subscribe residents to billingSchedules', () => {
  const start = m.listeners.length;

  const { result, unmount } = renderHook(() =>
    useAdminV2RecurringSchedules(makeSession('resident'), true),
  );

  expect(result.current).toEqual({
    rows: [],
    loading: false,
    error: '',
  });

  expect(m.listeners).toHaveLength(start);

  unmount();
});

it('does not start notice listeners when verification finishes after permission loss', async () => {
  const { call } = await import('../firebase');
  let resolveAccess!: (value: unknown) => void;
  vi.mocked(call).mockReturnValue(
    new Promise((resolve) => {
      resolveAccess = resolve;
    }),
  );
  const start = m.listeners.length;
  const session = makeSession();
  const { result, unmount } = renderHook(() => useRows(session, 'notices'));
  const listeners = m.listeners.slice(start);
  expect(listeners).toHaveLength(2);
  act(() =>
    listeners[0].error(Object.assign(Error('Access denied'), { code: 'permission-denied' })),
  );
  await act(async () => {
    resolveAccess({ communityId: 'community-1', flatId: 'unit-1', noticeIds: ['notice-1'] });
  });
  expect(m.listeners).toHaveLength(start + 2);
  expect(result.current).toEqual({ rows: [], loading: false, error: 'Access denied' });
  unmount();
  listeners.forEach((listener) => expect(listener.stop).toHaveBeenCalledOnce());
});

it.each([
  { communityId: 'community-2', flatId: 'unit-1' },
  { communityId: 'community-1', flatId: 'other-unit' },
])('rejects notice access for a mismatched scope: %j', async (scope) => {
  const { call } = await import('../firebase');
  vi.mocked(call).mockResolvedValue({ ...scope, noticeIds: ['notice-1'] });
  const start = m.listeners.length;
  const session = makeSession();
  const { result, unmount } = renderHook(() => useRows(session, 'notices'));
  await act(async () => {
    await Promise.resolve();
  });
  expect(result.current).toEqual({
    rows: [],
    loading: false,
    error: 'Community announcements could not be verified.',
  });
  expect(m.listeners).toHaveLength(start + 2);
  unmount();
  m.listeners.slice(start).forEach((listener) => expect(listener.stop).toHaveBeenCalledOnce());
});

it('scopes canonical and legacy Admin announcement listeners and filters canonical records by type', () => {
  const collectionStart = vi.mocked(collection).mock.calls.length;
  const filterStart = vi.mocked(where).mock.calls.length;
  const mounted = renderHook(() => useRows(makeSession('admin'), 'notices'));
  expect(
    vi
      .mocked(collection)
      .mock.calls.slice(collectionStart)
      .map((call) => call[1]),
  ).toEqual(['events_announcements', 'notices', 'announcements']);
  const filters = vi.mocked(where).mock.calls.slice(filterStart);
  expect(filters.filter((call) => call[0] === 'communityId')).toHaveLength(3);
  expect(
    filters
      .filter((call) => call[0] === 'communityId')
      .every((call) => call[1] === '==' && call[2] === 'community-1'),
  ).toBe(true);
  expect(filters).toContainEqual(['type', '==', 'announcement']);
  mounted.unmount();
});

it('reads active apartment image records only in the authorized community', async () => {
  const { useApartmentImages } = await import('../data');
  const firestore = await import('firebase/firestore');
  const start = m.listeners.length;
  const session = makeSession();
  const { result, unmount } = renderHook(() => useApartmentImages(session));
  expect(firestore.collection).toHaveBeenCalledWith(expect.anything(), 'apartmentImages');
  expect(firestore.where).toHaveBeenCalledWith('communityId', '==', 'community-1');
  expect(firestore.where).toHaveBeenCalledWith('status', '==', 'active');
  const listener = m.listeners[start];
  act(() =>
    listener.next({
      docs: [
        { id: 'own', data: () => ({ communityId: 'community-1', status: 'active' }) },
        { id: 'foreign', data: () => ({ communityId: 'community-2', status: 'active' }) },
        { id: 'inactive', data: () => ({ communityId: 'community-1', status: 'deleted' }) },
      ],
    }),
  );
  expect(result.current.rows.map((row) => row.id)).toEqual(['own']);
  unmount();
  expect(listener.stop).toHaveBeenCalledOnce();
});
it('gallery listener clears on community change and permission loss without stale republishing', async () => {
  const { useApartmentImages } = await import('../data');
  const session = makeSession('admin');
  const { result, rerender, unmount } = renderHook(({ s }) => useApartmentImages(s), {
    initialProps: { s: session },
  });
  const first = m.listeners.at(-1)!;
  act(() =>
    first.next({
      docs: [{ id: 'old', data: () => ({ communityId: 'community-1', status: 'active' }) }],
    }),
  );
  expect(result.current.rows).toHaveLength(1);
  rerender({ s: { ...session, community: session.communities[1] } });
  expect(result.current.rows).toHaveLength(0);
  expect(first.stop).toHaveBeenCalledOnce();
  const second = m.listeners.at(-1)!;
  act(() => second.error(Error('permission-denied')));
  act(() =>
    second.next({
      docs: [{ id: 'late', data: () => ({ communityId: 'community-2', status: 'active' }) }],
    }),
  );
  expect(result.current.rows).toHaveLength(0);
  expect(result.current.loading).toBe(false);
  unmount();
});
