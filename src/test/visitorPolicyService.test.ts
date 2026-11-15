import { beforeEach, expect, it, vi } from 'vitest';
import { makeSession } from './fixtures';
import { decideVisitor, loadVisitorPolicy, saveVisitorPolicy,
  loadVisitorDecisionContext, watchVisitorDecisionContext } from '../visitorPolicyService';
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
