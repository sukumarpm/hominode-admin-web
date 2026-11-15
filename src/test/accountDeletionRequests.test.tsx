import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDeletionRequests } from '../AccountDeletionRequests';
import { AuthContext, type AuthState } from '../session';
import { makeSession } from './fixtures';

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../firebase', () => ({ call: mocks.call }));

function mount() {
  const session = makeSession('admin');
  const auth: AuthState = {
    session,
    loading: false,
    error: '',
    authenticated: true,
    signOut: vi.fn(async () => {}),
    switchCommunity: vi.fn(),
  };
  return render(
    <AuthContext value={auth}>
      <AccountDeletionRequests />
    </AuthContext>,
  );
}

const queue = {
  requests: [
    {
      requestId: 'request-1',
      status: 'pending_review',
      financialReviewStatus: 'UNKNOWN_REQUIRES_REVIEW',
      reviewStatus: 'pending_admin_review',
      createdAt: '2026-03-01T10:00:00.000Z',
    },
  ],
};

describe('Community Admin account deletion queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.call.mockResolvedValue(queue);
  });

  it('loads only through the community-scoped callable and keeps unknown status unknown', async () => {
    mount();
    expect(await screen.findByText('Financial verification status')).toBeInTheDocument();
    expect(screen.getByText('Unknown: requires reconciliation')).toBeInTheDocument();
    expect(mocks.call).toHaveBeenCalledWith('listCommunityAccountDeletionRequests', {
      communityId: 'community-1',
    });
    expect(screen.getByText(/Zero dues are processed automatically/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /reject|cancel|complete deletion/i }),
    ).not.toBeInTheDocument();
  });

  it('does not offer a generic Admin finding or a delete action', async () => {
    mount();
    await screen.findByText('Financial verification status');
    expect(screen.queryByRole('button', { name: 'Record finding' })).not.toBeInTheDocument();
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: /reject|cancel|complete deletion/i }),
    ).not.toBeInTheDocument();
  });

  it('renders extended backend details and uses verification wording when identity is withheld', async () => {
    mocks.call.mockResolvedValueOnce({
      requests: [
        {
          requestId: 'request-2',
          createdAt: '2026-03-01T10:00:00.000Z',
          status: 'pending_review',
          reviewStatus: 'dependency_unresolved',
          reviewDueAt: '2026-03-08T10:00:00.000Z',
          financialReviewStatus: 'UNKNOWN_REQUIRES_REVIEW',
          resident: { displayName: 'Resident Two', unit: 'Tower B / 8' },
          residentProfileStatus: 'verified',
          reviewFinding: 'dependency_unresolved',
          reviewNote: 'Handover is pending.',
          reviewedAt: '2026-03-02T10:00:00.000Z',
          unresolvedDependencies: [],
        },
      ],
    });
    mount();
    expect(await screen.findByText('Resident Two')).toBeInTheDocument();
    expect(screen.getByText('Unit / apartment: Tower B / 8')).toBeInTheDocument();
    expect(screen.getByText('Current deletion status')).toBeInTheDocument();
    expect(screen.getByText('Previous Admin finding')).toBeInTheDocument();
    expect(screen.getByText('Previous review note')).toBeInTheDocument();
    expect(screen.queryByText(/Unresolved dependency:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open details' }));
    expect(await screen.findByText('Previous review timestamp:')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /reject|cancel|complete deletion/i }),
    ).not.toBeInTheDocument();
  });

  it('handles an older payload and withholds identity without direct profile access', async () => {
    mocks.call.mockResolvedValueOnce({ requests: [{ requestId: 'legacy-request' }] });
    mount();
    expect(await screen.findByText('Identity verification required')).toBeInTheDocument();
    expect(screen.getByText('Unknown: requires reconciliation')).toBeInTheDocument();
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });

  it('renders errors with retry and does not expose requests on failure', async () => {
    mocks.call.mockRejectedValueOnce(new Error('permission-denied'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Requests could not be loaded');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('allows verified handover only with current zero-dues evidence', async () => {
    mocks.call.mockResolvedValueOnce({
      requests: [
        {
          requestId: 'settled-1',
          status: 'pending_review',
          reviewStatus: 'pending_admin_review',
          financialReviewRequired: true,
          financialEvidence: {
            digest: 'a'.repeat(64),
            recordCount: 2,
            outstandingMinor: 0,
            currency: 'INR',
          },
        },
      ],
    });
    mount();
    expect(
      await screen.findByText('Zero dues: eligible for financial verification'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verify financial handover' }));
    expect(screen.getByText(/Zero dues confirmed/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Financial handover note/), {
      target: { value: 'Zero dues reviewed from current financial evidence.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify handover' }));
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith('recordAccountDeletionFinancialReview', {
        requestId: 'settled-1',
        finding: 'verified_handover',
        note: 'Zero dues reviewed from current financial evidence.',
        evidenceDigest: 'a'.repeat(64),
        retainFinancialRecords: true,
      }),
    );
  });

  it('keeps the dialog open and blocks duplicates until saving succeeds, then refreshes asynchronously', async () => {
    let resolveSave!: (value: unknown) => void;
    let resolveRefresh!: (value: unknown) => void;
    const save = new Promise((resolve) => {resolveSave = resolve;});
    const refresh = new Promise((resolve) => {resolveRefresh = resolve;});
    mocks.call.mockResolvedValueOnce({requests: [{requestId: 'settled', status: 'pending_review', financialReviewStatus: 'UNKNOWN_REQUIRES_REVIEW', financialReviewRequired: true, financialEvidence: {digest: 'a'.repeat(64), outstandingMinor: 0}}]})
      .mockReturnValueOnce(save).mockReturnValueOnce(refresh);
    mount();
    fireEvent.click(await screen.findByRole('button', {name: 'Verify financial handover'}));
    fireEvent.change(screen.getByLabelText(/Financial handover note/), {target: {value: 'Reviewed the settlement records'}});
    fireEvent.click(screen.getByRole('button', {name: 'Verify handover'}));
    expect(screen.getByRole('button', {name: 'Verifying...'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Close'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button', {name: 'Verifying...'}));
    expect(mocks.call.mock.calls.filter(([name]) => name === 'recordAccountDeletionFinancialReview')).toHaveLength(1);
    resolveSave({status: 'deletion_processing'});
    expect(await screen.findByText('Financial handover verified. Deletion processing.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    resolveRefresh({requests: []});
  });

  it('keeps a failed verification open and permits a safe retry', async () => {
    mocks.call.mockResolvedValueOnce({requests: [{requestId: 'settled', status: 'pending_review', financialReviewRequired: true, financialEvidence: {digest: 'a'.repeat(64), outstandingMinor: 0}}]})
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({status: 'deletion_processing'});
    mount();
    fireEvent.click(await screen.findByRole('button', {name: 'Verify financial handover'}));
    fireEvent.change(screen.getByLabelText(/Financial handover note/), {target: {value: 'Reviewed the settlement records'}});
    fireEvent.click(screen.getByRole('button', {name: 'Verify handover'}));
    expect(await screen.findByText('Financial verification could not be saved. Please retry.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Verify handover'}));
    expect(await screen.findByText('Financial handover verified. Deletion processing.')).toBeInTheDocument();
  });

  it('shows unpaid dues and withholds financial verification', async () => {
    mocks.call.mockResolvedValueOnce({
      requests: [
        {
          requestId: 'due-1',
          status: 'pending_review',
          reviewStatus: 'pending_admin_review',
          financialEvidence: {
            digest: 'b'.repeat(64),
            recordCount: 1,
            outstandingMinor: 500,
            currency: 'INR',
          },
        },
      ],
    });
    mount();
    expect(await screen.findByText('Outstanding dues: awaiting settlement')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Verify financial handover' }),
    ).not.toBeInTheDocument();
  });

  it('shows completed request-time identity, dates and final status without stale review state', async () => {
    mocks.call.mockResolvedValueOnce({
      requests: [
        {
          requestId: 'deleted-request',
          communityId: 'community-1',
          communityName: 'Green Wave',
          createdAt: { _seconds: 1777623300, _nanoseconds: 0 },
          completedAt: { seconds: 1777714200, nanoseconds: 0 },
          status: 'completed',
          reviewStatus: 'pending_admin_review',
          financialReviewStatus: 'VERIFIED_HANDOVER',
          financialReviewRequired: true,
          financialEvidence: { outstandingMinor: 0, digest: 'd'.repeat(64) },
          resident: {
            displayName: 'Resident Full Name',
            phoneNumber: '+15550000011',
            unit: 'Tower 4 / 1202',
            residentType: 'tenant',
          },
          residentProfileStatus: 'retained_after_deletion',
          reviewFinding: 'verified_handover',
          reviewNote: 'Settlement checked against current records.',
          reviewedAt: '2026-05-01T09:00:00.000Z',
        },
      ],
    });
    mount();

    expect(await screen.findByText('Resident Full Name')).toBeInTheDocument();
    expect(screen.getByText('Unit / apartment: Tower 4 / 1202')).toBeInTheDocument();
    expect(screen.getByText('Community: Green Wave')).toBeInTheDocument();
    expect(screen.getByText('Resident role: Tenant')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.getByText('Account Deleted')).toBeInTheDocument();
    expect(screen.getAllByText('Financial handover verified')).toHaveLength(2);
    expect(screen.queryByText('Zero dues: eligible for financial verification')).not.toBeInTheDocument();
    expect(screen.getByText(new Date(1777623300 * 1000).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText(new Date(1777714200 * 1000).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText('Financial verification status')).toBeInTheDocument();
    expect(screen.queryByText('pending_admin_review')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open details' }));
    expect(await screen.findByText('Deletion completion date and time:')).toBeInTheDocument();
    expect(screen.getByText('Request date and time:')).toBeInTheDocument();
    expect(
      screen.getAllByText(/Settlement checked against current records/).length,
    ).toBeGreaterThan(0);
  });

  it('does not show pending financial review labels on a completed request', async () => {
    mocks.call.mockResolvedValueOnce({requests: [{requestId: 'completed', status: 'completed', reviewStatus: 'pending_admin_review', financialReviewStatus: 'UNKNOWN_REQUIRES_REVIEW', financialReviewRequired: true}]});
    mount();
    expect(await screen.findByText('Account Deleted')).toBeInTheDocument();
    expect(screen.queryByText('Unknown — requires review')).not.toBeInTheDocument();
    expect(screen.queryByText('pending_admin_review')).not.toBeInTheDocument();
    expect(screen.getByText('Deletion completed')).toBeInTheDocument();
  });

  it('rechecks a pending request with verified handover and refreshes its status', async () => {
    mocks.call.mockResolvedValueOnce({
      requests: [
        {
          requestId: 'settled-pending',
          status: 'pending_review',
          financialReviewStatus: 'VERIFIED_HANDOVER',
          financialReviewRequired: false,
          financialEvidence: { outstandingMinor: 0, digest: 'c'.repeat(64) },
        },
      ],
    });
    mount();
    const button = await screen.findByRole('button', { name: 'Recheck deletion' });
    mocks.call
      .mockResolvedValueOnce({ status: 'completed', completed: true })
      .mockResolvedValueOnce({
        requests: [
          {
            requestId: 'settled-pending',
            status: 'completed',
            completedAt: '2026-03-02T10:00:00.000Z',
          },
        ],
      });

    fireEvent.click(button);

    await waitFor(() =>
      expect(mocks.call).toHaveBeenNthCalledWith(2, 'reassessAccountDeletionRequest', {
        requestId: 'settled-pending',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Account deletion completed.');
    expect(await screen.findByText('Account Deleted')).toBeInTheDocument();
    expect(mocks.call).toHaveBeenNthCalledWith(3, 'listCommunityAccountDeletionRequests', {
      communityId: 'community-1',
    });
  });

  it('shows loading and disables repeated reassessment taps', async () => {
    let finishReassessment!: (value: { status: string }) => void;
    const reassessment = new Promise<{ status: string }>((resolve) => {
      finishReassessment = resolve;
    });
    mount();
    const button = await screen.findByRole('button', { name: 'Recheck deletion' });
    mocks.call.mockReturnValueOnce(reassessment);

    fireEvent.click(button);

    expect(await screen.findByRole('button', { name: 'Rechecking…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Rechecking…' }));
    expect(mocks.call).toHaveBeenCalledTimes(2);
    finishReassessment({ status: 'pending_review' });
    await screen.findByText(/Deletion reassessment finished/);
  });

  it('shows a retryable error when reassessment fails', async () => {
    mount();
    const button = await screen.findByRole('button', { name: 'Recheck deletion' });
    mocks.call.mockRejectedValueOnce(new Error('failed-precondition'));

    fireEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent('Deletion could not be rechecked');
  });
});
