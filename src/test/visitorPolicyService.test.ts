import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeSession } from './fixtures';
import { decideVisitor, loadVisitorPolicy, saveVisitorPolicy,
  loadVisitorDecisionContext, watchVisitorDecisionContext,
  visitorPolicyReadTimeoutMs, VisitorPolicySaveError } from '../visitorPolicyService';
import type { VisitorPolicyResponse } from '../visitorPolicy';
const m = vi.hoisted(() => ({ call: vi.fn(), authority: vi.fn(), get: vi.fn(), watch: vi.fn() }));
vi.mock('../firebase', () => ({ call: m.call, firebase: () => ({ db: {} }) }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`,
  getDocFromServer: m.get, onSnapshot: m.watch,
}));
vi.mock('../actions', () => ({ currentAuthority: m.authority }));
const fixture: VisitorPolicyResponse = {
  communityId: 'community-1',
  timeZone: 'Asia/Manila',
  writeRevision: 4,
  pendingSchedule: null,
  rolloutReady: true,
  serverTime: Date.UTC(2026, 10, 9, 0, 30),
  policy: {
    schemaVersion: 1,
    enabled: false,
    timeZone: 'Asia/Manila',
    revision: 4,
    approvalMode: 'tenant_approval_required',
    emergency: null,
    pets: { mode: 'allowed', normalMode: 'allowed', restriction: null },
  },
};
let loaded: VisitorPolicyResponse;
fixture.policy.enabled = true;
beforeEach(() => {
  vi.clearAllMocks();
  m.authority.mockImplementation(async (session) => session);
  loaded = structuredClone(fixture);
  m.call.mockImplementation(async (name) =>
    name === 'getCommunityVisitorPolicy' ? structuredClone(loaded) : {},
  );
});
afterEach(() => vi.useRealTimers());
it('loads and saves enabled settings with the current contract, then re-reads confirmed policy', async () => {
  const session = makeSession('admin');
  expect(await loadVisitorPolicy(session)).toEqual(fixture);
  await saveVisitorPolicy(session, fixture.policy, 4);
  expect(m.call).toHaveBeenCalledWith('getCommunityVisitorPolicy', { communityId: 'community-1' });
  const input = {
    schemaVersion: 1,
    timeZone: 'Asia/Manila',
    approvalMode: 'tenant_approval_required',
    emergency: null,
    pets: { mode: 'allowed', normalMode: 'allowed', restriction: null },
  };
  expect(m.call).toHaveBeenCalledWith('updateCommunityVisitorPolicy', {
    communityId: 'community-1',
    policy: { ...input, enabled: true },
    expectedRevision: 4,
  });
  expect(
    m.call.mock.calls.find(([name]) => name === 'updateCommunityVisitorPolicy')![1],
  ).not.toHaveProperty('effectiveAt');
  expect(m.call.mock.calls.at(-1)![0]).toBe('getCommunityVisitorPolicy');
});
it.each(['approve', 'reject', 'revoke'] as const)('uses decideVisitorInvitation for %s with the displayed revision', async action => {
  await decideVisitor(
    makeSession('admin'),
    { id: 'visitor-1', data: { communityId: 'community-1', authorizationRevision: 7 } },
    action,
  );
  expect(m.call).toHaveBeenCalledWith('decideVisitorInvitation', {
    communityId: 'community-1',
    visitorId: 'visitor-1',
    action,
    expectedRevision: 7,
  });
});
it('rejects non-Admin, foreign visitors and mismatched policy responses', async () => {
  await expect(loadVisitorPolicy(makeSession())).rejects.toThrow(/Admin/);
  await expect(
    decideVisitor(
      makeSession('admin'),
      { id: 'visitor-1', data: { communityId: 'community-2' } },
      'reject',
    ),
  ).rejects.toThrow(/outside/);
  m.call.mockResolvedValue({ ...fixture, communityId: 'community-2' });
  await expect(loadVisitorPolicy(makeSession('admin'))).rejects.toThrow(/outside/);
});

it('replaces a pending schedule using writeRevision, canonical zone, and effectiveAt', async () => {
  const effectiveAt = loaded.serverTime + 3600_000;
  loaded.writeRevision = 7;
  loaded.pendingSchedule = {
    effectiveAt,
    revision: 7,
    policy: { ...loaded.policy, enabled: true },
  };
  await saveVisitorPolicy(
    makeSession('admin'),
    { ...loaded.policy, timeZone: 'Europe/London' },
    7,
    effectiveAt + 60_000,
  );
  expect(m.call).toHaveBeenCalledWith('updateCommunityVisitorPolicy', {
    communityId: 'community-1',
    expectedRevision: 7,
    effectiveAt: effectiveAt + 60_000,
    policy: expect.objectContaining({ enabled: true, timeZone: 'Asia/Manila' }),
  });
  expect(m.call.mock.calls.at(-1)![0]).toBe('getCommunityVisitorPolicy');
});

it('keeps the displayed revision and rejects a stale editor instead of adopting a newer revision', async () => {
  loaded.writeRevision = 8;
  await expect(saveVisitorPolicy(makeSession('admin'), loaded.policy, 7)).rejects.toMatchObject({
    code: 'functions/aborted',
  });
  expect(m.call.mock.calls.every(([name]) => name === 'getCommunityVisitorPolicy')).toBe(true);
});

it('does not submit an enabled policy when rollout readiness is false or missing', async () => {
  for (const ready of [false, undefined]) {
    m.call.mockResolvedValue({ ...loaded, rolloutReady: ready });
    await expect(saveVisitorPolicy(makeSession('admin'), loaded.policy, 4)).rejects.toThrow(
      /blocked.*rollout/,
    );
  }
  expect(m.call.mock.calls.every(([name]) => name === 'getCommunityVisitorPolicy')).toBe(true);
});

it('rejects missing or invalid canonical zones instead of accepting a client policy zone', async () => {
  for (const zone of [null, 'Invalid/Zone', '+08:00']) {
    loaded.timeZone = zone;
    await expect(saveVisitorPolicy(makeSession('admin'), fixture.policy, 4)).rejects.toThrow(
      /time zone/,
    );
  }
  expect(m.call.mock.calls.every(([name]) => name === 'getCommunityVisitorPolicy')).toBe(true);
});

it('rejects past, current, and malformed absolute schedule instants against server time', async () => {
  for (const effectiveAt of [loaded.serverTime - 1, loaded.serverTime, NaN, Infinity, 1.5]) {
    await expect(
      saveVisitorPolicy(makeSession('admin'), loaded.policy, 4, effectiveAt),
    ).rejects.toThrow(/future/);
  }
  expect(m.call.mock.calls.every(([name]) => name === 'getCommunityVisitorPolicy')).toBe(true);
});

it('fails closed for an old response without the authoritative write revision or schedule contract', async () => {
  for (const value of [
    { ...loaded, writeRevision: undefined },
    { ...loaded, pendingSchedule: undefined },
  ]) {
    m.call.mockResolvedValue(value);
    await expect(loadVisitorPolicy(makeSession('admin'))).rejects.toThrow(/response is incomplete/);
  }
});

it('propagates a backend revision race and never reports a successful reread', async () => {
  m.call.mockImplementation(async (name) => {
    if (name === 'updateCommunityVisitorPolicy')
      throw Object.assign(Error('stale'), { code: 'functions/aborted' });
    return loaded;
  });
  await expect(saveVisitorPolicy(makeSession('admin'), loaded.policy, 4)).rejects.toMatchObject({
    code: 'functions/aborted',
  });
  expect(m.call.mock.calls.map(([name]) => name)).toEqual([
    'getCommunityVisitorPolicy',
    'updateCommunityVisitorPolicy',
  ]);
});

it('rechecks Admin authority before writing after a policy load', async () => {
  const session = makeSession('admin');
  m.authority
    .mockResolvedValueOnce(session)
    .mockResolvedValueOnce({ ...session, community: { ...session.community, id: 'community-2' } });
  await expect(saveVisitorPolicy(session, loaded.policy, 4)).rejects.toThrow(/access changed/);
  expect(m.call).toHaveBeenCalledTimes(1);
});

it('rejects a community change while the load response is in flight', async () => {
  const session = makeSession('admin');
  m.call.mockImplementation(async () => {
    session.community = session.communities[1];
    return loaded;
  });
  await expect(loadVisitorPolicy(session)).rejects.toThrow(/outside/);
});

it('permits immediate and scheduled OFF saves without rollout readiness', async () => {
  m.call.mockImplementation(async name => name === 'getCommunityVisitorPolicy' ? {...loaded, rolloutReady: false} : {});
  const s = makeSession('admin');
  for (const effectiveAt of [undefined, loaded.serverTime + 3600000]) {
    await saveVisitorPolicy(s, {...loaded.policy, enabled: false}, 4, effectiveAt);
    expect(m.call).toHaveBeenCalledWith('updateCommunityVisitorPolicy', expect.objectContaining({
      policy: expect.objectContaining({enabled: false}),
      ...(effectiveAt == null ? {} : {effectiveAt}),
    }));
  }
});

it('uses the current scoped host classification rather than the creation snapshot', async () => {
  const row = { id: 'visitor-1', data: { communityId: 'community-1', hostUserId: 'resident-1',
    visitorPolicySnapshot: { residentType: 'owner' } } };
  m.get.mockResolvedValue({ data: () => ({ communityId: 'community-1', residentType: 'tenant' }) });
  expect(await loadVisitorDecisionContext(makeSession('admin'), row))
    .toEqual({ config: fixture, residentType: 'tenant' });
  expect(m.get).toHaveBeenCalledWith('users/resident-1');
  m.get.mockResolvedValue({ data: () => ({ communityId: 'foreign', residentType: 'tenant' }) });
  expect((await loadVisitorDecisionContext(makeSession('admin'), row)).residentType).toBeUndefined();
});

it('watches policy and host updates and cleans up both subscriptions', () => {
  const stop = vi.fn(), changed = vi.fn(), error = vi.fn();
  m.watch.mockReturnValue(stop);
  const unsubscribe = watchVisitorDecisionContext(makeSession('admin'), {
    id: 'visitor-1', data: { communityId: 'community-1', hostUserId: 'resident-1' },
  }, changed, error);
  expect(m.watch.mock.calls.map(([ref]) => ref)).toEqual(['communities/community-1', 'users/resident-1']);
  m.watch.mock.calls.forEach(([, update]) => update());
  expect(changed).toHaveBeenCalledTimes(2);
  unsubscribe();
  expect(stop).toHaveBeenCalledTimes(2);
});

for (const stage of ['initial authority', 'write authority'] as const)
  it(`times out stalled ${stage} without submitting a late write`, async () => {
    vi.useFakeTimers();
    const session = makeSession('admin');
    let finish!: (value: typeof session) => void;
    const stalled = new Promise<typeof session>(resolve => { finish = resolve; });
    if (stage === 'write authority') m.authority.mockResolvedValueOnce(session);
    m.authority.mockReturnValueOnce(stalled);
    const pending = expect(saveVisitorPolicy(session, loaded.policy, 4))
      .rejects.toMatchObject({ code: 'functions/deadline-exceeded' });
    await vi.advanceTimersByTimeAsync(visitorPolicyReadTimeoutMs);
    await pending;
    finish(session);
    await vi.advanceTimersByTimeAsync(0);
    expect(m.call.mock.calls.every(([name]) => name === 'getCommunityVisitorPolicy')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

it('bounds a stalled preflight callable and does not continue to the write after a late read', async () => {
  vi.useFakeTimers();
  let finish!: (value: VisitorPolicyResponse) => void;
  m.call.mockReturnValueOnce(new Promise<VisitorPolicyResponse>(resolve => { finish = resolve; }));
  const pending = expect(saveVisitorPolicy(makeSession('admin'), loaded.policy, 4))
    .rejects.toMatchObject({ code: 'functions/deadline-exceeded' });
  await vi.advanceTimersByTimeAsync(visitorPolicyReadTimeoutMs);
  await pending;
  finish(loaded);
  await vi.advanceTimersByTimeAsync(0);
  expect(m.call.mock.calls.map(([name]) => name)).toEqual(['getCommunityVisitorPolicy']);
});

for (const stage of ['authority', 'callable'] as const)
  it(`reports a confirmed save when its reload ${stage} stalls`, async () => {
    vi.useFakeTimers();
    const session = makeSession('admin');
    if (stage === 'authority')
      m.authority.mockResolvedValueOnce(session).mockResolvedValueOnce(session)
        .mockReturnValueOnce(new Promise(() => {}));
    else {
      let reads = 0;
      m.call.mockImplementation(async name => {
        if (name !== 'getCommunityVisitorPolicy') return {};
        return ++reads === 1 ? loaded : new Promise(() => {});
      });
    }
    const pending = expect(saveVisitorPolicy(session, loaded.policy, 4))
      .rejects.toMatchObject({ writeOutcome: 'confirmed', message: expect.stringContaining('was saved') });
    await vi.advanceTimersByTimeAsync(visitorPolicyReadTimeoutMs);
    await pending;
    expect(m.call.mock.calls.filter(([name]) => name === 'updateCommunityVisitorPolicy')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

it('distinguishes a confirmed write followed by a rejected reload', async () => {
  let reads = 0;
  m.call.mockImplementation(async name => {
    if (name !== 'getCommunityVisitorPolicy') return {};
    if (++reads === 1) return loaded;
    throw Object.assign(Error('Reload unavailable'), { code: 'functions/unavailable' });
  });
  await expect(saveVisitorPolicy(makeSession('admin'), loaded.policy, 4))
    .rejects.toBeInstanceOf(VisitorPolicySaveError);
  expect(m.call.mock.calls.filter(([name]) => name === 'updateCommunityVisitorPolicy')).toHaveLength(1);
});

it('reports an uncertain write timeout without retrying or continuing after late success', async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  m.call.mockImplementation(async name => name === 'getCommunityVisitorPolicy'
    ? loaded : new Promise(resolve => { finish = resolve; }));
  const pending = expect(saveVisitorPolicy(makeSession('admin'), loaded.policy, 4))
    .rejects.toMatchObject({ writeOutcome: 'unknown', message: expect.stringContaining('may have been saved') });
  await vi.advanceTimersByTimeAsync(visitorPolicyReadTimeoutMs);
  await pending;
  finish({});
  await vi.advanceTimersByTimeAsync(0);
  expect(m.call.mock.calls.map(([name]) => name)).toEqual([
    'getCommunityVisitorPolicy', 'updateCommunityVisitorPolicy',
  ]);
});

it.each(['permission-denied', 'invalid-argument', 'failed-precondition'])(
  'preserves the backend %s rejection without claiming a successful write', async code => {
    const error = Object.assign(Error('Rejected write'), { code: `functions/${code}` });
    m.call.mockImplementation(async name => {
      if (name === 'updateCommunityVisitorPolicy') throw error;
      return loaded;
    });
    await expect(saveVisitorPolicy(makeSession('admin'), loaded.policy, 4)).rejects.toBe(error);
    expect(m.call.mock.calls.map(([name]) => name)).toEqual([
      'getCommunityVisitorPolicy', 'updateCommunityVisitorPolicy',
    ]);
  },
);

it('cancels preflight on screen unmount without sending a later mutation', async () => {
  let finish!: (value: ReturnType<typeof makeSession>) => void;
  const session = makeSession('admin'), controller = new AbortController();
  m.authority.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const pending = expect(saveVisitorPolicy(session, loaded.policy, 4, undefined, controller.signal))
    .rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await pending;
  finish(session);
  await Promise.resolve();
  expect(m.call).not.toHaveBeenCalled();
});
