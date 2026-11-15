import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssistedDeletionDialog,
  canVerifyAssisted,
  type AssistedRequest,
} from '../AssistedDeletionDialog';
import { makeSession } from './fixtures';

const mocks = vi.hoisted(() => ({ call: vi.fn(), useRows: vi.fn() }));
vi.mock('../firebase', () => ({ call: mocks.call }));
vi.mock('../data', () => ({ useRows: mocks.useRows }));

const digest = 'a'.repeat(64);
const createResult = {
  requestId: 'assisted-001',
  sourceApp: 'admin_assisted',
  status: 'pending_assisted_verification',
  intakeDigest: digest,
};
const pendingRequest: AssistedRequest = {
  requestId: 'assisted-001',
  communityId: 'community-1',
  sourceApp: 'admin_assisted',
  status: 'pending_assisted_verification',
  verificationStatus: 'pending',
  intakeDigest: digest,
  assistedIntake: {
    supportCaseReference: 'CASE-001',
    verificationMethod: 'in_person_with_community_records',
    verificationEvidenceReference: 'EVIDENCE-001',
    verificationNotes: 'Resident identity and deletion consent checked in person.',
    consentAttested: true,
  },
};

const residents = [
  {
    id: 'resident-one',
    data: {
      uid: 'resident-one',
      role: 'resident',
      communityId: 'community-1',
      fullName: 'Mira Example',
      flatId: 'flat-1',
      buildingId: 'building-1',
    },
  },
  {
    id: 'resident-other-community',
    data: {
      uid: 'resident-other-community',
      role: 'resident',
      communityId: 'community-2',
      fullName: 'Another Community Resident',
    },
  },
];

function mockCommunityRows() {
  mocks.useRows.mockImplementation((_session: unknown, name: string) => {
    const rows =
      name === 'residents'
        ? residents
        : name === 'buildings'
          ? [
              {
                id: 'building-1',
                data: { communityId: 'community-1', name: 'Tower One' },
              },
            ]
          : name === 'units'
            ? [
                {
                  id: 'flat-1',
                  data: {
                    communityId: 'community-1',
                    buildingId: 'building-1',
                    flatLabel: 'A101',
                  },
                },
              ]
            : [];
    return { rows, loading: false, error: '' };
  });
}

function showDialog(request?: AssistedRequest) {
  const success = vi.fn();
  const close = vi.fn();
  const view = render(
    <AssistedDeletionDialog
      session={makeSession('admin')}
      request={request}
      onClose={close}
      onSuccess={success}
    />,
  );
  return { ...view, success, close };
}

function fillIntake() {
  fireEvent.change(screen.getByLabelText('Resident'), {
    target: { value: 'resident-one' },
  });
  fireEvent.change(screen.getByLabelText('Support-case reference'), {
    target: { value: 'CASE-001' },
  });
  fireEvent.change(screen.getByLabelText('Identity-verification method'), {
    target: { value: 'in_person_with_community_records' },
  });
  fireEvent.change(screen.getByLabelText('Protected evidence reference'), {
    target: { value: 'EVIDENCE-001' },
  });
  fireEvent.change(screen.getByLabelText(/Verification notes/), {
    target: { value: 'Resident identity and deletion consent checked in person.' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: /I attest that the Resident/ }));
}

describe('Admin-assisted deletion — Phase 2B Web UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommunityRows();
    mocks.call.mockResolvedValue(createResult);
  });

  it('restricts the Resident picker to the current community and requires completed intake', () => {
    showDialog();
    expect(screen.getByRole('button', { name: 'Save pending intake' })).toBeDisabled();
    expect(screen.getByRole('option', { name: /Mira Example/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Another Community Resident/ })).not.toBeInTheDocument();
    fillIntake();
    expect(screen.getByRole('button', { name: 'Save pending intake' })).toBeEnabled();
  });

  it('saves only a pending intake; disables duplicate submissions and never verifies automatically', async () => {
    let finish!: (value: typeof createResult) => void;
    mocks.call.mockReturnValueOnce(new Promise<typeof createResult>((resolve) => { finish = resolve; }));
    const { success } = showDialog();
    fillIntake();
    fireEvent.click(screen.getByRole('button', { name: 'Save pending intake' }));
    expect(screen.getByRole('button', { name: 'Saving intake…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(mocks.call).toHaveBeenCalledWith('createAdminAssistedDeletionRequest', {
      residentUid: 'resident-one',
      communityId: 'community-1',
      supportCaseReference: 'CASE-001',
      verificationMethod: 'in_person_with_community_records',
      verificationEvidenceReference: 'EVIDENCE-001',
      verificationNotes: 'Resident identity and deletion consent checked in person.',
      consentAttested: true,
    });
    expect(mocks.call.mock.calls.some(([name]) => name === 'verifyAdminAssistedDeletionRequest')).toBe(false);
    finish(createResult);
    await waitFor(() => expect(success).toHaveBeenCalledWith(expect.stringContaining('Pending identity verification')));
  });

  it('requires both verification confirmations and preserves the server digest unchanged', async () => {
    mocks.call.mockResolvedValueOnce({ verificationStatus: 'verified' });
    const { success } = showDialog(pendingRequest);
    const confirm = screen.getByRole('button', { name: 'Confirm identity and consent' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /independently verified/ }));
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /personally consented/ }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith('verifyAdminAssistedDeletionRequest', {
      requestId: 'assisted-001',
      intakeDigest: digest,
      identityConfirmed: true,
      consentConfirmed: true,
    }));
    await waitFor(() => expect(success).toHaveBeenCalledWith(expect.stringContaining('does not mean deletion is complete')));
  });

  it('rejects a pending request from another community or with invalid digest', () => {
    expect(canVerifyAssisted({ ...pendingRequest, communityId: 'community-2' }, 'community-1')).toBe(false);
    expect(canVerifyAssisted({ ...pendingRequest, intakeDigest: 'incorrect' }, 'community-1')).toBe(false);
    showDialog({ ...pendingRequest, communityId: 'community-2' });
    fireEvent.click(screen.getByRole('checkbox', { name: /independently verified/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /personally consented/ }));
    expect(screen.getByRole('button', { name: 'Confirm identity and consent' })).toBeDisabled();
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('keeps a failed verification open and allows a safe retry', async () => {
    mocks.call.mockRejectedValueOnce({ code: 'functions/failed-precondition' })
      .mockResolvedValueOnce({ verificationStatus: 'verified' });
    const { success } = showDialog(pendingRequest);
    fireEvent.click(screen.getByRole('checkbox', { name: /independently verified/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /personally consented/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm identity and consent' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reauthenticate');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm identity and consent' }));
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(mocks.call.mock.calls.filter(([name]) => name === 'verifyAdminAssistedDeletionRequest')).toHaveLength(2);
  });
});
