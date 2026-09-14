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
import { useRows } from '../data';
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
