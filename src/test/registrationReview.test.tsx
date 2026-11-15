import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { makeSession } from './fixtures';
import type { Row } from '../models';
const mocks = vi.hoisted(() => ({ call: vi.fn(), authority: vi.fn() }));
vi.mock('../firebase', () => ({ call: mocks.call }));
vi.mock('../actions', () => ({ currentAuthority: mocks.authority }));
vi.mock('../data', () => ({
  safeUrl: (value: string) => value,
  useRows: (_: unknown, module: string) => ({
    loading: false,
    error: '',
    rows:
      module === 'buildings'
        ? [{ id: 'building', data: { communityId: 'community-1', name: 'Tower A' } }]
        : [
            {
              id: 'flat',
              data: {
                communityId: 'community-1',
                buildingId: 'building',
                flatLabel: '101',
                status: 'reserved',
              },
            },
          ],
  }),
}));
import { ResidentReview } from '../AdminTools';
const session = makeSession('admin');
const pending: Row = {
  id: 'resident',
  data: {
    communityId: 'community-1',
    role: 'resident',
    approvalStatus: 'pending',
    isActive: false,
    creationSource: 'resident_registration',
    residentType: 'owner',
    buildingId: 'building',
    flatId: 'flat',
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authority.mockResolvedValue(session);
  mocks.call.mockResolvedValue({ status: 'rejected' });
});

it('requires final rejection confirmation, permits cancellation, and uses the existing scoped callable', async () => {
  render(<ResidentReview s={session} row={pending} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reject Registration' }));
  expect(mocks.call).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/cancels onboarding/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(mocks.call).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reject Registration' }));
  fireEvent.change(screen.getByLabelText('Rejection reason (optional)'), {
    target: { value: 'Duplicate registration' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Reject Registration' }));
  await waitFor(() => expect(screen.getByText('Registration rejected.')).toBeInTheDocument());
  expect(mocks.call).toHaveBeenCalledExactlyOnceWith('rejectResidentRegistration', {
    communityId: 'community-1',
    userId: 'resident',
    reason: 'Duplicate registration',
  });
  expect(screen.queryByRole('button', { name: 'Reject Registration' })).not.toBeInTheDocument();
});

it('shows processing and blocks duplicate confirmations', async () => {
  let resolve!: (data: unknown) => void;
  mocks.call.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<ResidentReview s={session} row={pending} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reject Registration' }));
  const confirm = screen.getByRole('button', { name: 'Confirm Reject Registration' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(1));
  expect(confirm).toBeDisabled();
  const cancelEvent = new Event('cancel', { cancelable: true });
  fireEvent(screen.getByRole('dialog'), cancelEvent);
  expect(cancelEvent.defaultPrevented).toBe(true);
  expect(screen.getByText('Processing registration…')).toBeInTheDocument();
  resolve({ status: 'rejected' });
  await waitFor(() => expect(screen.getByText('Registration rejected.')).toBeInTheDocument());
});

it('retains server ownership errors and permits retry without releasing units locally', async () => {
  mocks.call.mockRejectedValueOnce(Error('Shared unit ownership conflict'));
  render(<ResidentReview s={session} row={pending} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reject Registration' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Reject Registration' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Shared unit ownership conflict'),
  );
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Reject Registration' }));
  await waitFor(() => expect(screen.getByText('Registration rejected.')).toBeInTheDocument());
  expect(mocks.call.mock.calls.every(([name]) => name === 'rejectResidentRegistration')).toBe(true);
});

it('approves pending registration using canonical assignment IDs', async () => {
  mocks.call.mockResolvedValue({ status: 'approved' });
  render(<ResidentReview s={session} row={pending} />);
  fireEvent.click(screen.getByRole('button', { name: 'Approve Registration' }));
  await waitFor(() => expect(screen.getByText('Registration approved.')).toBeInTheDocument());
  expect(mocks.call).toHaveBeenCalledWith('approveResidentRegistration', {
    communityId: 'community-1',
    userId: 'resident',
    buildingId: 'building',
    flatId: 'flat',
    residentType: 'owner',
  });
});

it('identity rejection stays independent from final registration rejection', async () => {
  render(<ResidentReview s={session} row={pending} />);
  fireEvent.change(screen.getByLabelText('Review note'), {
    target: { value: 'Upload a readable proof' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reject Identity Proof' }));
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith('reviewResidentIdentityProof', {
      communityId: 'community-1',
      userId: 'resident',
      decision: 'rejected',
      reason: 'Upload a readable proof',
    }),
  );
  expect(screen.getByRole('button', { name: 'Reject Registration' })).toBeInTheDocument();
  expect(mocks.call.mock.calls.some(([name]) => name === 'rejectResidentRegistration')).toBe(false);
});

it.each([
  { approvalStatus: 'approved' },
  { approvalStatus: 'approved', creationSource: 'admin_direct' },
  { creationSource: 'admin_direct' },
  { approvalStatus: 'deleted' },
  { status: 'deleted' },
  { approvalStatus: 'rejected' },
  { isActive: true },
  { communityId: 'other-community' },
])('hides pending registration actions for ineligible records %j', (patch) => {
  render(<ResidentReview s={session} row={{ ...pending, data: { ...pending.data, ...patch } }} />);
  expect(screen.queryByRole('button', { name: 'Reject Registration' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve Registration' })).not.toBeInTheDocument();
});

it('live approval update removes an open final-rejection confirmation', () => {
  const view = render(<ResidentReview s={session} row={pending} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reject Registration' }));
  view.rerender(
    <ResidentReview
      s={session}
      row={{ ...pending, data: { ...pending.data, approvalStatus: 'approved', isActive: true } }}
    />,
  );
  expect(
    screen.queryByRole('button', { name: 'Confirm Reject Registration' }),
  ).not.toBeInTheDocument();
  expect(mocks.call).not.toHaveBeenCalled();
});

const directPending: Row = {
  ...pending,
  data: {
    ...pending.data,
    creationSource: 'admin_direct',
    residentType: 'tenant',
    identityVerified: false,
    identityVerificationStatus: 'pending',
  },
};

it.each(['pending', 'approved'])(
  'finally rejects Admin-created identity-pending registration with approvalStatus=%s',
  async (approvalStatus) => {
    render(
      <ResidentReview
        s={session}
        row={{
          ...directPending,
          data: { ...directPending.data, approvalStatus, isActive: approvalStatus === 'approved' },
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Approve Registration' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify identity' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject Identity Proof' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reject Registration' }));
    expect(screen.getByText(/Only this Resident’s applicable unit allocation/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Reject Registration' }));
    await waitFor(() => expect(screen.getByText('Registration rejected.')).toBeInTheDocument());
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith('rejectResidentRegistration', {
      communityId: 'community-1',
      userId: 'resident',
      reason: null,
    });
  },
);

it('Admin-created proof rejection remains independent and permits later final rejection', async () => {
  render(<ResidentReview s={session} row={directPending} />);
  fireEvent.change(screen.getByLabelText('Review note'), { target: { value: 'Unreadable proof' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reject Identity Proof' }));
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith('reviewResidentIdentityProof', {
      communityId: 'community-1',
      userId: 'resident',
      decision: 'rejected',
      reason: 'Unreadable proof',
    }),
  );
  expect(screen.getByRole('button', { name: 'Reject Registration' })).toBeInTheDocument();
  expect(mocks.call.mock.calls.some(([name]) => name === 'rejectResidentRegistration')).toBe(false);
});

it.each([
  { identityVerified: true },
  { identityVerificationStatus: 'verified' },
  { registrationCompletedAt: 'timestamp' },
  { status: 'deleted' },
  { status: 'completed' },
  { occupancyStatus: 'moved_out' },
  { occupancyStatus: 'suspended' },
  { communityId: 'another' },
  { identityVerified: null },
  { isActive: null },
])('protects completed or ineligible Admin-created Residents %j', (patch) => {
  render(
    <ResidentReview
      s={session}
      row={{ ...directPending, data: { ...directPending.data, ...patch } }}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Reject Registration' })).not.toBeInTheDocument();
});

it('required-owner configuration controls Admin-created owner rejection eligibility', () => {
  const row = { ...directPending, data: { ...directPending.data, residentType: 'owner' } };
  const view = render(<ResidentReview s={session} row={row} />);
  expect(screen.queryByRole('button', { name: 'Reject Registration' })).not.toBeInTheDocument();
  view.rerender(
    <ResidentReview
      s={{
        ...session,
        community: { ...session.community!, ownerIdentityVerificationRequired: true },
      }}
      row={row}
    />,
  );
  expect(screen.getByRole('button', { name: 'Reject Registration' })).toBeInTheDocument();
});

it('live identity approval closes final-rejection confirmation', () => {
  const view = render(<ResidentReview s={session} row={directPending} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reject Registration' }));
  view.rerender(
    <ResidentReview
      s={session}
      row={{
        ...directPending,
        data: {
          ...directPending.data,
          identityVerified: true,
          identityVerificationStatus: 'verified',
        },
      }}
    />,
  );
  expect(
    screen.queryByRole('button', { name: 'Confirm Reject Registration' }),
  ).not.toBeInTheDocument();
  expect(mocks.call).not.toHaveBeenCalled();
});
