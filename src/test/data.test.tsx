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

it('does not republish stale notices after a notice listener loses permission', async () => {
  const { call } = await import('../firebase');
  vi.mocked(call).mockResolvedValue({
    communityId: 'community-1',
    flatId: 'unit-1',
    noticeIds: ['notice-1', 'notice-2'],
  });
  const start = m.listeners.length;
  const session = makeSession();
  const { result, unmount } = renderHook(() => useRows(session, 'notices'));
  await act(async () => {
    await Promise.resolve();
  });
  const first = m.listeners[start],
    second = m.listeners[start + 1];
  act(() => {
    first.next({
      exists: () => true,
      data: () => ({ communityId: 'community-1', title: 'First notice' }),
    });
    second.next({
      exists: () => true,
      data: () => ({ communityId: 'community-1', title: 'Second notice' }),
    });
  });
  expect(result.current.rows).toHaveLength(2);
  act(() => first.error(Error('Notice access revoked')));
  act(() =>
    second.next({
      exists: () => true,
      data: () => ({ communityId: 'community-1', title: 'Changed notice' }),
    }),
  );
  expect(result.current.rows).toHaveLength(0);
  expect(result.current.error).toBe('Notice access revoked');
  unmount();
});


it('subscribes Admin only to own-community recurring schedules', async () => {
  const firestore = await import('firebase/firestore');
  const session = makeSession('admin');
  const start = m.listeners.length;

  const { result, unmount } = renderHook(() =>
    useAdminV2RecurringSchedules(session, true),
  );

  const listener = m.listeners[start];

  expect(firestore.collection).toHaveBeenCalledWith(
    expect.anything(),
    'billingSchedules',
  );
  expect(firestore.where).toHaveBeenCalledWith(
    'communityId',
    '==',
    'community-1',
  );

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

  expect(result.current.rows.map((row) => row.id)).toEqual([
    'schedule-own',
  ]);

  unmount();
  expect(listener.stop).toHaveBeenCalledOnce();
});

it('does not subscribe residents to billingSchedules', () => {
  const start = m.listeners.length;

  const { result, unmount } = renderHook(() =>
    useAdminV2RecurringSchedules(
      makeSession('resident'),
      true,
    ),
  );

  expect(result.current).toEqual({
    rows: [],
    loading: false,
    error: '',
  });

  expect(m.listeners).toHaveLength(start);

  unmount();
});
