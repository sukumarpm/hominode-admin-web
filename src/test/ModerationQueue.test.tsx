import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ModerationQueue } from '../ModerationQueue';
import { AuthContext, type AuthState } from '../session';
import { makeSession } from './fixtures';
const mock = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../firebase', () => ({ call: mock.call }));
beforeEach(() => mock.call.mockReset());
it('shows community reports and history, then submits an authorized hide action', async () => {
  const session = makeSession('admin');
  const state: AuthState = {
    session,
    loading: false,
    error: '',
    authenticated: true,
    signOut: vi.fn(async () => {}),
    switchCommunity: vi.fn(),
  };
  mock.call.mockResolvedValueOnce({
    reports: [
      {
        id: 'r1',
        targetType: 'comment',
        status: 'open',
        reason: 'Abuse',
        contentSnapshot: 'Inappropriate comment',
      },
    ],
    history: [{ id: 'h1', action: 'dismiss', actorId: 'admin' }],
  });
  mock.call.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({
    reports: [],
    history: [{ id: 'h2', action: 'hide', actorId: 'admin' }],
  });
  render(
    <AuthContext value={state}>
      <ModerationQueue />
    </AuthContext>,
  );
  expect(await screen.findByText('Inappropriate comment')).toBeInTheDocument();
  expect(mock.call).toHaveBeenCalledWith('listWallModerationReports', {
    communityId: session.community!.id,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Hide content' }));
  expect(screen.getByRole('button', { name: 'Confirm decision' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Public decision reason'), {
    target: { value: 'harassment' },
  });
  fireEvent.change(screen.getByLabelText('Public explanation (optional)'), {
    target: { value: 'Personal attacks are not permitted.' },
  });
  fireEvent.change(screen.getByLabelText('Internal note (Admin only, optional)'), {
    target: { value: 'Internal context' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await waitFor(() =>
    expect(mock.call).toHaveBeenCalledWith('resolveWallModerationReport', {
      communityId: session.community!.id,
      reportId: 'r1',
      action: 'hide',
      reasonCode: 'harassment',
      publicExplanation: 'Personal attacks are not permitted.',
      internalNote: 'Internal context',
    }),
  );
  expect(await screen.findByText(/Content hidden/)).toBeInTheDocument();
});
it('loads further history using the current community and page offset', async () => {
  const session = makeSession('admin');
  const state: AuthState = {
    session,
    loading: false,
    error: '',
    authenticated: true,
    signOut: vi.fn(async () => {}),
    switchCommunity: vi.fn(),
  };
  mock.call.mockResolvedValueOnce({
    reports: [],
    history: [{ id: 'h1', action: 'dismiss', actorId: 'admin' }],
    historyTruncated: true,
  });
  mock.call.mockResolvedValueOnce({
    history: [{ id: 'h2', action: 'hide', actorId: 'admin' }],
    historyTruncated: false,
  });
  render(
    <AuthContext value={state}>
      <ModerationQueue />
    </AuthContext>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Load more history' }));
  expect(await screen.findByText(/Content hidden/)).toBeInTheDocument();
  expect(mock.call).toHaveBeenCalledWith('listWallModerationReports', {
    communityId: session.community!.id,
    historyOffset: 1,
  });
});

it('shows backend load errors and Retry without claiming the failed queue is empty', async () => {
  const session = makeSession('admin');
  const state: AuthState = {
    session,
    loading: false,
    error: '',
    authenticated: true,
    signOut: vi.fn(async () => {}),
    switchCommunity: vi.fn(),
  };
  mock.call.mockRejectedValueOnce(Error('An authorized active Admin is required.'));
  mock.call.mockResolvedValueOnce({ reports: [], history: [] });
  render(
    <AuthContext value={state}>
      <ModerationQueue />
    </AuthContext>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'An authorized active Admin is required.',
  );
  expect(screen.queryByText('No open reports.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No open reports.')).toBeInTheDocument();
  expect(screen.getByText('No moderation actions yet.')).toBeInTheDocument();
});

it('shows selected report reasons and ignores a stale response after switching communities', async () => {
  const session = makeSession('admin');
  const state: AuthState = {
    session,
    loading: false,
    error: '',
    authenticated: true,
    signOut: vi.fn(async () => {}),
    switchCommunity: vi.fn(),
  };
  let resolve!: (result: unknown) => void;
  mock.call.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(
    <AuthContext value={state}>
      <ModerationQueue />
    </AuthContext>,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Loading moderation queue');
  const changed = {
    ...state,
    session: { ...session, community: { ...session.community!, id: 'community-2' } },
  };
  mock.call.mockResolvedValueOnce({
    reports: [
      {
        id: 'r2',
        targetType: 'post',
        status: 'open',
        reason: 'Harassment or bullying: Personal attacks',
        contentSnapshot: 'New community post',
      },
    ],
    history: [],
  });
  view.rerender(
    <AuthContext value={changed}>
      <ModerationQueue />
    </AuthContext>,
  );
  expect(await screen.findByText('New community post')).toBeInTheDocument();
  expect(screen.getByText('Harassment or bullying: Personal attacks')).toBeInTheDocument();
  resolve({
    reports: [
      { id: 'r1', targetType: 'post', status: 'open', contentSnapshot: 'Wrong community post' },
    ],
    history: [],
  });
  await waitFor(() => expect(screen.queryByText('Wrong community post')).not.toBeInTheDocument());
  expect(mock.call).toHaveBeenCalledWith('listWallModerationReports', {
    communityId: 'community-2',
  });
});

it('dismiss reason is required, submitted separately from internal notes, and shown with author/moderator history', async () => {
  const session = makeSession('admin');
  const state: AuthState = {
    session,
    loading: false,
    error: '',
    authenticated: true,
    signOut: vi.fn(async () => {}),
    switchCommunity: vi.fn(),
  };
  mock.call.mockResolvedValueOnce({
    reports: [
      {
        id: 'private-report-id',
        targetType: 'post',
        status: 'open',
        authorName: 'Resident Name',
        reason: 'Spam: Repeated advertisements',
        contentSnapshot: 'Post preview',
        createdAtMs: 1760000000000,
      },
    ],
    history: [],
  });
  let finish!: (value: unknown) => void;
  mock.call.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  mock.call.mockResolvedValueOnce({
    reports: [],
    history: [
      {
        id: 'audit-id',
        action: 'dismiss',
        targetType: 'post',
        authorName: 'Resident Name',
        actorName: 'Moderator Name',
        publicReason: 'No community guideline violation: Within community rules.',
        internalNote: 'Private context',
        reportReason: 'Spam: Repeated advertisements',
        contentSnapshot: 'Post preview',
        createdAtMs: 1760000000000,
      },
    ],
  });
  render(
    <AuthContext value={state}>
      <ModerationQueue />
    </AuthContext>,
  );
  expect(await screen.findByText(/Author: Resident Name/)).toBeInTheDocument();
  expect(screen.queryByText('private-report-id')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss report' }));
  expect(screen.getByRole('button', { name: 'Confirm decision' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Public decision reason'), {
    target: { value: 'no_violation' },
  });
  fireEvent.change(screen.getByLabelText('Public explanation (optional)'), {
    target: { value: 'Within community rules.' },
  });
  fireEvent.change(screen.getByLabelText('Internal note (Admin only, optional)'), {
    target: { value: 'Private context' },
  });
  const confirm = screen.getByRole('button', { name: 'Confirm decision' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(mock.call).toHaveBeenCalledTimes(2));
  expect(confirm).toBeDisabled();
  expect(screen.getByText('Saving decision…')).toBeInTheDocument();
  const cancel = new Event('cancel', { cancelable: true });
  fireEvent(screen.getByRole('dialog'), cancel);
  expect(cancel.defaultPrevented).toBe(true);
  finish({ success: true });
  expect(
    await screen.findByText('No community guideline violation: Within community rules.'),
  ).toBeInTheDocument();
  expect(screen.getByText(/Moderator: Moderator Name/)).toBeInTheDocument();
  expect(screen.getByText('Dismissed')).toBeInTheDocument();
  expect(mock.call).toHaveBeenCalledWith('resolveWallModerationReport', {
    communityId: session.community!.id,
    reportId: 'private-report-id',
    action: 'dismiss',
    reasonCode: 'no_violation',
    publicExplanation: 'Within community rules.',
    internalNote: 'Private context',
  });
});

it('decision failure retains reason and permits retry without recording false success', async () => {
  const session = makeSession('admin');
  const state: AuthState = {
    session,
    loading: false,
    error: '',
    authenticated: true,
    signOut: vi.fn(async () => {}),
    switchCommunity: vi.fn(),
  };
  mock.call.mockResolvedValueOnce({
    reports: [{ id: 'r', status: 'open', targetType: 'post', reason: 'Spam' }],
    history: [],
  });
  mock.call.mockRejectedValueOnce(Error('Content author changed before review.'));
  mock.call
    .mockResolvedValueOnce({ success: true })
    .mockResolvedValueOnce({ reports: [], history: [] });
  render(
    <AuthContext value={state}>
      <ModerationQueue />
    </AuthContext>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Hide content' }));
  fireEvent.change(screen.getByLabelText('Public decision reason'), { target: { value: 'spam' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Content author changed before review.',
  );
  expect(screen.getByLabelText('Public decision reason')).toHaveValue('spam');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  expect(await screen.findByText('No open reports.')).toBeInTheDocument();
});
