import { fireEvent, render, screen, waitFor, act, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VisitorPolicySettings } from '../VisitorPolicySettings';
import { VisitorDecisionActions } from '../VisitorDecisionActions';
import {
  VisitorPolicySaveError, visitorPolicyReadTimeoutMs, visitorPolicySaveTimeoutMs,
} from '../visitorPolicyService';
import {
  approvalOptions,
  authorizationLabel,
  futureSchedule,
  localSchedule,
  periodStatus,
  policyInput,
  scheduleInstant,
  visitorQueue,
  visitorDecisionActions,
  type VisitorPolicyResponse,
} from '../visitorPolicy';
import { makeSession, secondCommunity } from './fixtures';
import type { Row } from '../models';

const mock = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  decide: vi.fn(),
  changed: null as null | (() => void),
}));
vi.mock('../visitorPolicyService', async (original) => ({
  ...(await original<typeof import('../visitorPolicyService')>()),
  loadVisitorPolicy: mock.load,
  saveVisitorPolicy: mock.save,
  decideVisitor: mock.decide,
  watchVisitorPolicy: (_s: unknown, changed: () => void) => {
    mock.changed = changed;
    return () => {};
  },
}));
// Current getCommunityVisitorPolicy contract; no staged-only shared fixture.
const fixture: VisitorPolicyResponse = {
  communityId: 'community-1',
  timeZone: 'Asia/Manila',
  writeRevision: 4,
  pendingSchedule: null,
  rolloutReady: true,
  serverTime: Date.UTC(2026, 10, 9, 0, 30),
  policy: {
    schemaVersion: 1,
    enabled: true,
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
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
let loaded: VisitorPolicyResponse;
beforeEach(() => {
  vi.clearAllMocks();
  loaded = clone(fixture);
  mock.load.mockImplementation(async () => clone(loaded));
  mock.save.mockImplementation(async (_s, input, revision, effectiveAt) => {
    loaded = {
      ...loaded,
      writeRevision: revision + 1,
      policy: effectiveAt == null ? { ...input, revision: revision + 1 } : loaded.policy,
      pendingSchedule:
        effectiveAt == null ? null : { policy: input, revision: revision + 1, effectiveAt },
    };
    return clone(loaded);
  });
  mock.decide.mockResolvedValue({ authorizationState: 'admin_authorized' });
});
afterEach(() => vi.useRealTimers());
async function mount() {
  const view = render(<VisitorPolicySettings session={makeSession('admin')} />);
  await screen.findByLabelText('Approval policy');
  return view;
}
it('loads the current contract and offers the enforcement toggle with Save as the only action', async () => {
  loaded.policy.enabled = false;
  await mount();
  expect(screen.getByLabelText('Approval policy')).toHaveValue('tenant_approval_required');
  expect(screen.getByLabelText('Emergency start')).toHaveValue('2026-11-09T08:00');
  expect(
    within(screen.getByRole('region', { name: 'Current effective policy' })).getAllByText('Off')
      .length,
  ).toBeGreaterThan(0);
  expect(
    screen.queryByText(/staged only|Existing authorized passes remain valid/),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Enforce$/i })).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Visitor-policy enforcement' })).not.toBeChecked();
});
for (const mode of Object.keys(approvalOptions))
  it(`saves and enforces ${mode} immediately`, async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Approval policy'), { target: { value: mode } });
    fireEvent.click(screen.getByRole('button', { name: 'Save visitor settings' }));
    await screen.findByText(/Visitor settings saved and reloaded/);
    const [, payload, revision] = mock.save.mock.calls[0];
    expect(revision).toBe(4);
    expect(payload.approvalMode).toBe(mode);
    expect(payload.enabled).toBe(true);
    expect(mock.save.mock.calls[0][3]).toBeUndefined();
    expect(payload).not.toHaveProperty('revision');
    expect(payload).not.toHaveProperty('updatedBy');
  });
it('uses the current policy input contract, including both intervals and enabled: true', () => {
  expect(policyInput(fixture.policy)).toEqual({
    schemaVersion: 1,
    enabled: true,
    timeZone: 'Asia/Manila',
    approvalMode: 'tenant_approval_required',
    emergency: fixture.policy.emergency,
    pets: fixture.policy.pets,
  });
  expect(localSchedule(scheduleInstant('2026-11-09T08:00', 'Asia/Manila'), 'Asia/Manila')).toBe(
    '2026-11-09T08:00',
  );
});
it('rejects DST gaps, repeated local times, bad calendars and missing zones', () => {
  for (const [time, zone] of [
    ['2026-03-08T02:30', 'America/New_York'],
    ['2026-11-01T01:30', 'America/New_York'],
    ['2026-02-30T12:00', 'Asia/Manila'],
  ])
    expect(() => scheduleInstant(time, zone)).toThrow();
  expect(() => scheduleInstant('2026-11-09T08:00', null)).toThrow(/time zone/);
});
it('uses server-time half-open period boundaries and expiry', () => {
  const period = { startAt: 100, endAt: 200 };
  expect([99, 100, 199, 200, 201].map((now) => periodStatus(period, now))).toEqual([
    'Scheduled',
    'Active',
    'Active',
    'Expired',
    'Expired',
  ]);
});
it('cancels an emergency through a null interval and validates invalid ranges before submission', async () => {
  await mount();
  fireEvent.change(screen.getByLabelText('Emergency end'), {
    target: { value: '2026-11-09T07:59' },
  });
  fireEvent.click(screen.getByText('Save visitor settings'));
  await screen.findByText('End must be after start.');
  expect(mock.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Configure emergency approval period'));
  fireEvent.click(screen.getByText('Save visitor settings'));
  await waitFor(() => expect(mock.save).toHaveBeenCalled());
  expect(mock.save.mock.calls[0][1].emergency).toBeNull();
});
for (const mode of ['allowed', 'not_allowed', 'temporarily_restricted'])
  it(`saves pet mode ${mode} and its normal policy`, async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Pet entry'), { target: { value: mode } });
    fireEvent.click(screen.getByText('Save visitor settings'));
    await waitFor(() => expect(mock.save).toHaveBeenCalled());
    const pets = mock.save.mock.calls[0][1].pets;
    expect(pets.mode).toBe(mode);
    expect(pets.normalMode).toBe(mode === 'temporarily_restricted' ? 'allowed' : mode);
    expect(pets.restriction != null).toBe(mode === 'temporarily_restricted');
  });
it('shows loading, failure and retry without reporting success', async () => {
  mock.load.mockRejectedValueOnce(
    Object.assign(Error('denied'), { code: 'functions/permission-denied' }),
  );
  render(<VisitorPolicySettings session={makeSession('admin')} />);
  expect(screen.getByText('Loading visitor policy…')).toBeInTheDocument();
  await screen.findByText(/Community access denied/);
  expect(mock.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Reload policy'));
  await screen.findByLabelText('Approval policy');
});
it('does not display another community response or a non-Admin editor', async () => {
  loaded.communityId = 'community-2';
  const view = render(<VisitorPolicySettings session={makeSession('admin')} />);
  await screen.findByText('Policy is outside your community.');
  expect(screen.queryByText('Save visitor settings')).not.toBeInTheDocument();
  view.rerender(<VisitorPolicySettings session={makeSession()} />);
  expect(screen.queryByText('Visitor Approval Settings')).not.toBeInTheDocument();
});
it('refreshes other-platform changes and refuses to overwrite a dirty editor', async () => {
  await mount();
  loaded.policy.approvalMode = 'all_approval_required';
  loaded.policy.revision++;
  act(() => mock.changed!());
  await waitFor(() =>
    expect(screen.getByLabelText('Approval policy')).toHaveValue('all_approval_required'),
  );
  fireEvent.change(screen.getByLabelText('Approval policy'), {
    target: { value: 'resident_authorized' },
  });
  loaded.policy.revision++;
  act(() => mock.changed!());
  await waitFor(() => expect(screen.getByText('Save visitor settings')).toBeDisabled());
  fireEvent.click(screen.getByText('Reload policy'));
  await waitFor(() => expect(screen.getByText('Save visitor settings')).toBeEnabled());
});
it('locks duplicate saves and handles a backend revision conflict without optimistic success', async () => {
  let reject!: (error: unknown) => void;
  mock.save.mockReturnValue(
    new Promise((_resolve, fail) => {
      reject = fail;
    }),
  );
  await mount();
  fireEvent.click(screen.getByText('Save visitor settings'));
  fireEvent.click(screen.getByText('Saving…'));
  expect(mock.save).toHaveBeenCalledTimes(1);
  await act(async () => reject(Object.assign(Error('conflict'), { code: 'functions/aborted' })));
  expect(screen.getByText(/This record changed/)).toBeInTheDocument();
  expect(screen.getByText('Save visitor settings')).toBeDisabled();
});
it('finishes saving when its policy snapshot publishes a new session for the same community', async () => {
  let finish!: (value: VisitorPolicyResponse) => void;
  mock.save.mockReturnValue(new Promise<VisitorPolicyResponse>(resolve => { finish = resolve; }));
  const session = makeSession('admin');
  const view = render(<VisitorPolicySettings session={session} />);
  await screen.findByLabelText('Approval policy');
  fireEvent.click(screen.getByText('Save visitor settings'));
  loaded = { ...loaded, writeRevision: 5, policy: { ...loaded.policy, revision: 5 } };
  view.rerender(<VisitorPolicySettings session={{ ...session,
    community: { ...session.community!, data: { ...session.community!.data, visitorPolicy: loaded.policy } },
  }} />);
  await act(async () => { finish(clone(loaded)); });
  await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
  expect(screen.getByText('Save visitor settings')).toBeEnabled();
  expect(mock.save).toHaveBeenCalledOnce();
});
it('clears the prior editor immediately when the active community changes', async () => {
  const view = await mount();
  loaded = {
    ...loaded,
    communityId: secondCommunity.id,
    policy: { ...loaded.policy, approvalMode: 'resident_authorized' },
  };
  view.rerender(
    <VisitorPolicySettings session={{ ...makeSession('admin'), community: secondCommunity }} />,
  );
  expect(screen.queryByLabelText('Approval policy')).not.toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByLabelText('Approval policy')).toHaveValue('resident_authorized'),
  );
});
it('preserves an edited draft when focus refresh confirms the same backend revision', async () => {
  await mount();
  fireEvent.change(screen.getByLabelText('Approval policy'), {
    target: { value: 'resident_authorized' },
  });
  fireEvent.focus(window);
  await waitFor(() => expect(mock.load.mock.calls.length).toBeGreaterThan(1));
  expect(screen.getByLabelText('Approval policy')).toHaveValue('resident_authorized');
  expect(screen.getByText('Save visitor settings')).toBeEnabled();
});
it('allows editing an active policy and saves its changes as enforced', async () => {
  loaded.policy.enabled = true;
  await mount();
  expect(screen.getByText('Save visitor settings')).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Approval policy'), {
    target: { value: 'all_approval_required' },
  });
  fireEvent.click(screen.getByText('Save visitor settings'));
  await screen.findByText(/Enforcement is active/);
  expect(mock.save.mock.calls[0][1]).toMatchObject({
    enabled: true,
    approvalMode: 'all_approval_required',
  });
});

it('schedules enforcement at a future community-local instant and shows both policies', async () => {
  loaded.policy.enabled = false;
  await mount();
  fireEvent.click(screen.getByRole('checkbox', {name: 'Visitor-policy enforcement'}));
  fireEvent.change(screen.getByLabelText('Apply policy'), { target: { value: 'scheduled' } });
  fireEvent.change(screen.getByLabelText('Policy effective time'), {
    target: { value: '2026-11-10T09:00' },
  });
  fireEvent.click(screen.getByText('Save visitor settings'));
  await screen.findByText(/Enforcement scheduled for 2026-11-10 09:00 \(Asia\/Manila\)/);
  expect(mock.save.mock.calls[0][3]).toBe(Date.UTC(2026, 10, 10, 1));
  expect(mock.save.mock.calls[0][1].enabled).toBe(true);
  expect(
    within(screen.getByRole('region', { name: 'Current effective policy' })).getAllByText('Off')
      .length,
  ).toBeGreaterThan(0);
  const pending = screen.getByRole('region', { name: 'Scheduled policy' });
  expect(within(pending).getByText('Scheduled', { exact: true })).toBeInTheDocument();
  expect(within(pending).getByText('2026-11-10 09:00')).toHaveAttribute(
    'datetime',
    '2026-11-10T01:00:00.000Z',
  );
});

it('edits the pending policy, preserves its precise instant, and can replace it immediately', async () => {
  const effectiveAt = Date.UTC(2026, 10, 10, 1, 0, 37, 234);
  loaded.writeRevision = 7;
  loaded.pendingSchedule = {
    revision: 7,
    effectiveAt,
    policy: { ...loaded.policy, enabled: true, approvalMode: 'all_approval_required' },
  };
  await mount();
  expect(screen.getByLabelText('Approval policy')).toHaveValue('all_approval_required');
  expect(screen.getByLabelText('Apply policy')).toHaveValue('scheduled');
  fireEvent.click(screen.getByText('Save visitor settings'));
  await screen.findByText(/Enforcement scheduled/);
  expect(mock.save.mock.calls[0][2]).toBe(7);
  expect(mock.save.mock.calls[0][3]).toBe(effectiveAt);
  fireEvent.change(screen.getByLabelText('Apply policy'), { target: { value: 'immediate' } });
  fireEvent.click(screen.getByText('Save visitor settings'));
  await screen.findByText(/Enforcement is active/);
  expect(mock.save.mock.calls[1][2]).toBe(8);
  expect(mock.save.mock.calls[1][3]).toBeUndefined();
  expect(screen.queryByRole('region', { name: 'Scheduled policy' })).not.toBeInTheDocument();
});

for (const time of ['', '2026-11-09T08:00', '2026-11-09T08:30'])
  it(`rejects an incomplete or non-future scheduled time: ${time}`, async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Apply policy'), { target: { value: 'scheduled' } });
    fireEvent.change(screen.getByLabelText('Policy effective time'), { target: { value: time } });
    fireEvent.click(screen.getByText('Save visitor settings'));
    await screen.findByText(
      time ? 'Choose a future policy effective time.' : 'Enter a complete date and time.',
    );
    expect(mock.save).not.toHaveBeenCalled();
  });

for (const time of ['2026-03-08T02:30', '2026-11-01T01:30'])
  it(`rejects a nonexistent or ambiguous policy time in the canonical zone: ${time}`, async () => {
    loaded.timeZone = 'America/New_York';
    loaded.serverTime = Date.UTC(2026, 0, 1);
    // The policy's old zone must not override the canonical community zone.
    await mount();
    fireEvent.change(screen.getByLabelText('Apply policy'), { target: { value: 'scheduled' } });
    fireEvent.change(screen.getByLabelText('Policy effective time'), { target: { value: time } });
    fireEvent.click(screen.getByText('Save visitor settings'));
    await screen.findByText(/This community-local time is skipped or repeated/);
    expect(mock.save).not.toHaveBeenCalled();
  });

it('validates calendar dates, zone errors, future boundaries, and preserves sub-minute pending instants', () => {
  expect(() => scheduleInstant('2026-11-10T09:00', 'Invalid/Zone')).toThrow(/time zone/);
  expect(() => scheduleInstant('not a date', 'Asia/Manila')).toThrow(/complete/);
  const original = Date.UTC(2026, 10, 10, 1, 0, 37, 234);
  expect(futureSchedule('2026-11-10T09:00', 'Asia/Manila', original - 1, original)).toBe(original);
  expect(() => futureSchedule('2026-11-10T09:00', 'Asia/Manila', original, original)).toThrow(
    /future/,
  );
  expect(futureSchedule('2026-11-10T09:01', 'Asia/Manila', original, original)).toBe(
    Date.UTC(2026, 10, 10, 1, 1),
  );
});

for (const zone of [null, 'Invalid/Zone', '+08:00'])
  it(`blocks editing when the canonical community time zone is unavailable: ${zone}`, async () => {
    loaded.timeZone = zone;
    await mount();
    expect(screen.getByRole('alert')).toHaveTextContent(/time zone/);
    expect(screen.getByText('Save visitor settings')).toBeDisabled();
    expect(screen.getByLabelText('Approval policy')).toBeDisabled();
    fireEvent.submit(screen.getByText('Save visitor settings').closest('form')!);
    expect(mock.save).not.toHaveBeenCalled();
  });

it('blocks unready communities and refreshes readiness changes without a revision change', async () => {
  loaded.rolloutReady = false;
  await mount();
  expect(screen.getByRole('alert')).toHaveTextContent(
    /Enabling is blocked until visitor policy rollout/,
  );
  expect(screen.getByText('Save visitor settings')).toBeDisabled();
  fireEvent.submit(screen.getByText('Save visitor settings').closest('form')!);
  expect(mock.save).not.toHaveBeenCalled();
  loaded.rolloutReady = true;
  act(() => mock.changed!());
  await waitFor(() => expect(screen.getByText('Save visitor settings')).toBeEnabled());
});

it('detects pending-only cross-device changes and preserves a dirty draft', async () => {
  await mount();
  fireEvent.change(screen.getByLabelText('Approval policy'), {
    target: { value: 'resident_authorized' },
  });
  loaded.writeRevision = 5;
  loaded.pendingSchedule = {
    revision: 5,
    effectiveAt: loaded.serverTime + 3600_000,
    policy: { ...loaded.policy, enabled: true, approvalMode: 'all_approval_required' },
  };
  act(() => mock.changed!());
  await screen.findByText('Policy changed on another device. Reload before saving.');
  expect(screen.getByLabelText('Approval policy')).toHaveValue('resident_authorized');
  expect(screen.getByText('Save visitor settings')).toBeDisabled();
  fireEvent.click(screen.getByText('Reload policy'));
  await waitFor(() =>
    expect(screen.getByLabelText('Approval policy')).toHaveValue('all_approval_required'),
  );
  fireEvent.click(screen.getByText('Save visitor settings'));
  await screen.findByText(/Enforcement scheduled/);
  expect(mock.save.mock.calls[0][2]).toBe(5);
});

it('refreshes untouched editors when only a pending schedule is replaced elsewhere', async () => {
  await mount();
  loaded.writeRevision = 9;
  loaded.pendingSchedule = {
    revision: 9,
    effectiveAt: loaded.serverTime + 3600_000,
    policy: { ...loaded.policy, enabled: true, approvalMode: 'all_approval_required' },
  };
  act(() => mock.changed!());
  await screen.findByRole('region', { name: 'Scheduled policy' });
  expect(screen.getByLabelText('Approval policy')).toHaveValue('all_approval_required');
  expect(screen.getByText('Save visitor settings')).toBeEnabled();
});

for (const dirty of [false, true])
  it(`refreshes scheduled activation without a Firestore write (dirty=${dirty})`, async () => {
    vi.useFakeTimers();
    const next = {
      ...loaded.policy,
      enabled: true,
      revision: 5,
      approvalMode: 'all_approval_required' as const,
    };
    loaded.writeRevision = 5;
    loaded.pendingSchedule = { revision: 5, effectiveAt: loaded.serverTime + 60_000, policy: next };
    render(<VisitorPolicySettings session={makeSession('admin')} />);
    await act(async () => {});
    expect(screen.getByRole('region', { name: 'Scheduled policy' })).toBeInTheDocument();
    if (dirty)
      fireEvent.change(screen.getByLabelText('Approval policy'), {
        target: { value: 'resident_authorized' },
      });
    loaded = {
      ...loaded,
      serverTime: loaded.serverTime + 60_000,
      policy: next,
      pendingSchedule: null,
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_001);
    });
    expect(screen.queryByRole('region', { name: 'Scheduled policy' })).not.toBeInTheDocument();
    expect(screen.getByText('Save visitor settings'))[dirty ? 'toBeDisabled' : 'toBeEnabled']();
    expect(screen.getByLabelText('Approval policy')).toHaveValue(
      dirty ? 'resident_authorized' : 'all_approval_required',
    );
    expect(mock.save).not.toHaveBeenCalled();
  });

it('ignores a save response that arrives after switching communities', async () => {
  let finish!: (value: VisitorPolicyResponse) => void;
  mock.save.mockReturnValue(
    new Promise<VisitorPolicyResponse>((resolve) => {
      finish = resolve;
    }),
  );
  const previous = clone(loaded);
  const view = await mount();
  fireEvent.click(screen.getByText('Save visitor settings'));
  loaded = {
    ...loaded,
    communityId: secondCommunity.id,
    policy: { ...loaded.policy, approvalMode: 'resident_authorized' },
  };
  view.rerender(
    <VisitorPolicySettings session={{ ...makeSession('admin'), community: secondCommunity }} />,
  );
  await screen.findByLabelText('Approval policy');
  await act(async () => finish(previous));
  expect(screen.getByLabelText('Approval policy')).toHaveValue('resident_authorized');
  expect(screen.queryByText(/saved and reloaded/)).not.toBeInTheDocument();
});

it('recovers a stalled initial read and offers a bounded explicit reload', async () => {
  vi.useFakeTimers();
  mock.load.mockReturnValueOnce(new Promise(() => {}));
  render(<VisitorPolicySettings session={makeSession('admin')} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(visitorPolicyReadTimeoutMs); });
  expect(screen.queryByText('Loading visitor policy…')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/timed out/);
  expect(screen.getByText('Reload policy')).toBeEnabled();
  fireEvent.click(screen.getByText('Reload policy'));
  await act(async () => {});
  expect(screen.getByLabelText('Approval policy')).toBeInTheDocument();
  expect(mock.save).not.toHaveBeenCalled();
});

it('exits a stalled Save, ignores late completion, and requires Reload without retrying the write', async () => {
  vi.useFakeTimers();
  let finish!: (value: VisitorPolicyResponse) => void;
  mock.save.mockReturnValueOnce(new Promise<VisitorPolicyResponse>(resolve => { finish = resolve; }));
  render(<VisitorPolicySettings session={makeSession('admin')} />);
  await act(async () => {});
  fireEvent.click(screen.getByText('Save visitor settings'));
  const signal = mock.save.mock.calls[0][4] as AbortSignal;
  await act(async () => { await vi.advanceTimersByTimeAsync(visitorPolicySaveTimeoutMs); });
  expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/may have been saved/);
  expect(screen.getByText('Save visitor settings')).toBeDisabled();
  expect(screen.getByText('Reload policy')).toBeEnabled();
  expect(signal.aborted).toBe(true);
  act(() => { mock.changed!(); fireEvent.focus(window); });
  await act(async () => { finish(clone(loaded)); });
  expect(screen.queryByText(/saved and reloaded/)).not.toBeInTheDocument();
  expect(mock.save).toHaveBeenCalledOnce();
  expect(mock.load).toHaveBeenCalledOnce();
  loaded = { ...loaded, writeRevision: 5, policy: { ...loaded.policy, revision: 5 } };
  fireEvent.click(screen.getByText('Reload policy'));
  await act(async () => {});
  expect(screen.getByText('Save visitor settings')).toBeEnabled();
  expect(mock.save).toHaveBeenCalledOnce();
});

it('keeps a confirmed-write/reload-failure message and permits only an explicit Reload', async () => {
  let fail!: (error: unknown) => void;
  mock.save.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
  await mount();
  fireEvent.click(screen.getByText('Save visitor settings'));
  act(() => mock.changed!());
  await act(async () => { fail(new VisitorPolicySaveError('confirmed', Error('Read unavailable'))); });
  expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/was saved.*could not be reloaded/);
  expect(screen.getByText('Save visitor settings')).toBeDisabled();
  expect(screen.getByText('Reload policy')).toBeEnabled();
  act(() => { mock.changed!(); fireEvent.focus(window); });
  expect(mock.load).toHaveBeenCalledOnce();
  loaded = { ...loaded, writeRevision: 5, policy: { ...loaded.policy, revision: 5 } };
  fireEvent.click(screen.getByText('Reload policy'));
  await screen.findByLabelText('Approval policy');
  await waitFor(() => expect(screen.getByText('Save visitor settings')).toBeEnabled());
  expect(mock.save).toHaveBeenCalledOnce();
});

it('exits Saving on a rejected write without claiming success', async () => {
  mock.save.mockRejectedValueOnce(Object.assign(Error('Rejected'), { code: 'functions/permission-denied' }));
  await mount();
  fireEvent.click(screen.getByText('Save visitor settings'));
  await screen.findByText(/Community access denied/);
  expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
  expect(screen.queryByText(/saved and reloaded/)).not.toBeInTheDocument();
  expect(screen.getByText('Reload policy')).toBeEnabled();
  expect(mock.save).toHaveBeenCalledOnce();
});

it('aborts an unmounted Save and cleans up deadlines without a late refresh', async () => {
  vi.useFakeTimers();
  let finish!: (value: VisitorPolicyResponse) => void;
  mock.save.mockReturnValueOnce(new Promise<VisitorPolicyResponse>(resolve => { finish = resolve; }));
  const view = render(<VisitorPolicySettings session={makeSession('admin')} />);
  await act(async () => {});
  fireEvent.click(screen.getByText('Save visitor settings'));
  const signal = mock.save.mock.calls[0][4] as AbortSignal;
  view.unmount();
  await act(async () => {});
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => { finish(clone(loaded)); });
  expect(mock.load).toHaveBeenCalledOnce();
  expect(mock.save).toHaveBeenCalledOnce();
});

const row: Row = {
  id: 'visitor-1',
  data: {
    communityId: 'community-1',
    visitorName: 'Guest',
    hostName: 'Host',
    flatLabel: 'N014',
    status: 'expected',
    isApproved: false,
    authorizationManaged: true,
    authorizationState: 'pending_admin',
    authorizationRevision: 7,
  },
};
for (const action of ['approve', 'reject'] as const)
  it(`${action} requires confirmation and preserves revision and physical state`, async () => {
    const saved = vi.fn();
    render(<VisitorDecisionActions session={makeSession('admin')} row={row} onSaved={saved} />);
    expect(screen.getByText(/Expected — not checked in/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(action === 'approve' ? 'Approve visitor' : 'Reject visitor'));
    expect(mock.decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm ' + action));
    await screen.findByText('Decision confirmed by the server.');
    expect(mock.decide).toHaveBeenCalledWith(expect.anything(), row, action);
    expect(saved).toHaveBeenCalledOnce();
    expect(row.data.status).toBe('expected');
  });
it('decision conflict disables repeat actions and asks the queue to refresh', async () => {
  mock.decide.mockRejectedValue(Object.assign(Error('stale'), { code: 'functions/aborted' }));
  const saved = vi.fn();
  render(<VisitorDecisionActions session={makeSession('admin')} row={row} onSaved={saved} />);
  fireEvent.click(screen.getByText('Approve visitor'));
  fireEvent.click(screen.getByText('Confirm approve'));
  await screen.findByText(/This record changed/);
  expect(screen.queryByText('Approve visitor')).not.toBeInTheDocument();
  expect(saved).toHaveBeenCalledOnce();
});
it('partitions every visitor state without confusing authorization with physical entry', () => {
  const data = row.data;
  expect(visitorQueue(data)).toBe('pending');
  expect(visitorQueue({ ...data, authorizationState: 'auto_authorized' })).toBe('expected');
  expect(
    visitorQueue({
      ...data,
      authorizationState: 'admin_authorized',
      status: 'approved',
      isApproved: true,
    }),
  ).toBe('expected');
  expect(
    visitorQueue({ ...data, authorizationState: 'admin_authorized', actualArrival: new Date() }),
  ).toBe('inside');
  for (const extra of [
    { authorizationState: 'rejected' },
    { authorizationState: 'revoked' },
    { gateAccessStatus: 'denied' },
    { status: 'completed' },
    { status: 'cancelled' },
    { status: 'unknown', authorizationState: null },
  ])
    expect(visitorQueue({ ...data, ...extra })).toBe('history');
  expect(authorizationLabel({ ...data, authorizationState: 'auto_authorized' })).toBe(
    'Resident authorized',
  );
});

it.each([true, false])('enforcement toggle saves selected state %s', async selected => {
  loaded.policy.enabled = !selected;
  loaded.rolloutReady = selected;
  await mount();
  fireEvent.click(screen.getByRole('checkbox', {name: 'Visitor-policy enforcement'}));
  fireEvent.click(screen.getByRole('button', {name: 'Save visitor settings'}));
  await waitFor(() => expect(mock.save).toHaveBeenCalled());
  expect(mock.save.mock.calls[0][1].enabled).toBe(selected);
  expect(screen.queryByRole('button', {name: /^Enforce$/})).not.toBeInTheDocument();
});

it('offers only callable-supported decisions across lifecycle and current-policy approval states', () => {
  const policy = { ...fixture.policy, approvalMode: 'all_approval_required' as const, emergency: null };
  const approved = { ...row.data, status: 'approved', authorizationState: 'admin_authorized',
    isApproved: true, authorizationActorUid: 'admin-1', approvedBy: 'admin-1',
    authorizationPolicyRevision: 4, approvedAt: new Date(fixture.serverTime - 1000) };
  expect(visitorDecisionActions(row.data)).toEqual(['approve', 'reject']);
  expect(visitorDecisionActions(approved, policy, fixture.serverTime)).toEqual(['revoke']);
  expect(visitorDecisionActions(approved, { ...policy, revision: 5 }, fixture.serverTime))
    .toEqual(['reapprove', 'revoke']);
  for (const extra of [{ authorizationManaged: false }, { approvedBy: 'other' },
    { approvedAt: new Date(fixture.serverTime + 1) }, { isApproved: false }])
    expect(visitorDecisionActions({ ...approved, ...extra }, policy, fixture.serverTime))
      .toEqual(['reapprove', 'revoke']);
  const tenantPolicy = { ...policy, approvalMode: 'tenant_approval_required' as const, revision: 5 };
  expect(visitorDecisionActions(approved, tenantPolicy, fixture.serverTime, 'owner')).toEqual(['revoke']);
  expect(visitorDecisionActions(approved, tenantPolicy, fixture.serverTime, 'tenant'))
    .toEqual(['reapprove', 'revoke']);
  for (const extra of [{ actualArrival: new Date() }, { checkInTime: new Date() },
    { departure: new Date() }, { checkOutTime: new Date() }, { status: 'cancelled' },
    { status: 'completed' }, { status: 'unknown' }, { authorizationState: 'revoked' },
    { authorizationState: 'rejected' }, { gateAccessStatus: 'denied' }, { gateEntryDeniedAt: new Date() }])
    expect(visitorDecisionActions({ ...row.data, ...extra }, policy, fixture.serverTime)).toEqual([]);
  const emergency = { startAt: fixture.serverTime, endAt: fixture.serverTime + 1000 };
  const emergencyPolicy = { ...policy, approvalMode: 'resident_authorized' as const, emergency };
  expect(visitorDecisionActions(approved, emergencyPolicy, emergency.startAt - 1)).toEqual(['revoke']);
  expect(visitorDecisionActions(approved, emergencyPolicy, emergency.startAt)).toEqual(['reapprove', 'revoke']);
  expect(visitorDecisionActions(approved, emergencyPolicy, emergency.endAt)).toEqual(['revoke']);
});

for (const action of ['reapprove', 'revoke'] as const)
  it(`confirms ${action} and maps it to the backend decision without changing the row`, async () => {
    const value = { ...row, data: { ...row.data, authorizationState: 'auto_authorized' } };
    const loadContext = vi.fn().mockResolvedValue({ config: {
      ...fixture, policy: { ...fixture.policy, approvalMode: 'all_approval_required', emergency: null },
    }, residentType: 'owner' });
    render(<VisitorDecisionActions session={makeSession('admin')} row={value}
      loadContext={loadContext} watchContext={() => () => {}} />);
    const label = action === 'reapprove' ? 'Reapprove visitor' : 'Revoke visitor';
    fireEvent.click(await screen.findByText(label));
    expect(mock.decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm ' + action));
    await screen.findByText('Decision confirmed by the server.');
    expect(mock.decide).toHaveBeenCalledWith(expect.anything(), value,
      action === 'reapprove' ? 'approve' : 'revoke');
    expect(value.data.authorizationState).toBe('auto_authorized');
  });

it('rechecks authorized visitors at scheduled activation without a snapshot write', async () => {
  vi.useFakeTimers();
  const value = { ...row, data: { ...row.data, authorizationState: 'auto_authorized' } };
  const policy = { ...fixture.policy, emergency: null, approvalMode: 'all_approval_required' as const };
  const loadContext = vi.fn().mockResolvedValueOnce({ config: { ...fixture,
    policy: { ...policy, enabled: false },
    pendingSchedule: { effectiveAt: fixture.serverTime + 1000, revision: 5, policy },
  } }).mockResolvedValue({ config: { ...fixture, serverTime: fixture.serverTime + 1000, policy } });
  render(<VisitorDecisionActions session={makeSession('admin')} row={value}
    loadContext={loadContext} watchContext={() => () => {}} />);
  await act(async () => {});
  expect(screen.queryByText('Reapprove visitor')).not.toBeInTheDocument();
  expect(screen.getByText('Revoke visitor')).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText('Reapprove visitor')).toBeInTheDocument();
  expect(mock.decide).not.toHaveBeenCalled();
});

it('does not offer community decisions to Super Admin or for checked-out pending records', () => {
  const admin = makeSession('admin');
  const view = render(<VisitorDecisionActions session={{ ...admin, role: 'superAdmin',
    profile: { ...admin.profile, role: 'superAdmin' } }} row={row} />);
  expect(screen.queryByText('Approve visitor')).not.toBeInTheDocument();
  view.rerender(<VisitorDecisionActions session={makeSession('admin')}
    row={{ ...row, data: { ...row.data, checkOutTime: new Date() } }} />);
  expect(screen.queryByText('Approve visitor')).not.toBeInTheDocument();
});
