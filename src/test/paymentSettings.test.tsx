import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityPaymentSettings } from '../CommunityPaymentSettings';
import { ProfilePage } from '../pages';
import {
  type CommunityPaymentConfig,
  type CommunityPaymentConfigInput,
  type Session,
} from '../models';
import { AuthContext, type AuthState } from '../session';
import { makeSession } from './fixtures';

const paymentActions = vi.hoisted(() => ({
  load: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../actions')>();
  return {
    ...actual,
    getCommunityPaymentConfig: paymentActions.load,
    updateCommunityPaymentConfig: paymentActions.update,
  };
});

function config(
  communityId: string,
  directUpi: CommunityPaymentConfig['directUpi'],
  configured = true,
): CommunityPaymentConfig {
  return {
    communityId,
    version: 1,
    directUpi,
    updatedAt: configured ? new Date('2026-01-02T03:04:05Z') : null,
    configured,
  };
}

const disabledConfig = (communityId: string) => config(communityId, { enabled: false }, false);
const enabledConfig = (
  communityId: string,
  vpa = 'greenvalley@upi-bank',
  payeeName = 'Green Valley Association',
) => config(communityId, { enabled: true, vpa, payeeName });

function withCommunity(session: Session, communityId: string): Session {
  const community = session.communities.find((item) => item.id === communityId);
  if (!community) throw Error('Fixture community missing');
  return { ...session, community };
}

function authState(session: Session): AuthState {
  return {
    session,
    loading: false,
    error: '',
    authenticated: true,
    signOut: vi.fn(async () => {}),
    switchCommunity: vi.fn(),
  };
}

function renderSettingsPage(session: Session) {
  return render(
    <AuthContext value={authState(session)}>
      <ProfilePage settings />
    </AuthContext>,
  );
}

function renderSettingsComponent(
  session: Session,
  loadConfig: (session: Session) => Promise<CommunityPaymentConfig>,
  updateConfig: (
    session: Session,
    input: CommunityPaymentConfigInput,
  ) => Promise<CommunityPaymentConfig>,
) {
  return render(
    <CommunityPaymentSettings
      session={session}
      loadConfig={loadConfig}
      updateConfig={updateConfig}
    />,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  paymentActions.load.mockImplementation(async () => disabledConfig('community-1'));
  paymentActions.update.mockImplementation(
    async (_session: Session, input: CommunityPaymentConfigInput) =>
      input.enabled
        ? enabledConfig('community-1', input.vpa, input.payeeName)
        : config('community-1', { enabled: false }),
  );
});

describe('Admin Direct UPI Settings', () => {
  it('shows the payment settings card on Admin Settings', async () => {
    renderSettingsPage(makeSession('admin'));
    expect(await screen.findByRole('heading', { name: 'Direct UPI payments' })).toBeInTheDocument();
    expect(paymentActions.load).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }));
  });

  it.each([
    ['resident', makeSession('resident')],
    [
      'Super Admin',
      {
        ...makeSession('admin'),
        role: 'superAdmin' as const,
        profile: { ...makeSession('admin').profile, role: 'superAdmin' as const },
        community: null,
      },
    ],
  ])('%s does not get editable community payment settings', async (_role, session) => {
    renderSettingsPage(session);
    expect(screen.queryByRole('heading', { name: 'Direct UPI payments' })).not.toBeInTheDocument();
    expect(paymentActions.load).not.toHaveBeenCalled();
  });

  it('shows Not configured and Configure for a missing document', async () => {
    renderSettingsPage(makeSession('admin'));
    expect(await screen.findByText('Not configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configure' })).toBeInTheDocument();
    expect(
      screen.getByText('Residents cannot use Direct UPI until it is configured.'),
    ).toBeInTheDocument();
  });

  it('shows Enabled, VPA, payee name and Edit for an enabled config', async () => {
    paymentActions.load.mockResolvedValueOnce(enabledConfig('community-1'));
    renderSettingsPage(makeSession('admin'));
    expect(await screen.findByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('greenvalley@upi-bank')).toBeInTheDocument();
    expect(screen.getByText('Green Valley Association')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('reveals fields after enabling and prevents empty enabled values from saving', async () => {
    renderSettingsPage(makeSession('admin'));
    await screen.findByRole('button', { name: 'Configure' });
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    const enabled = screen.getByRole('checkbox', { name: 'Enable Direct UPI' });
    expect(screen.queryByLabelText('UPI ID (VPA)')).not.toBeInTheDocument();
    fireEvent.click(enabled);
    expect(screen.getByLabelText('UPI ID (VPA)')).toBeInTheDocument();
    expect(screen.getByLabelText('Payee name')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a UPI ID (VPA).')).toBeInTheDocument();
    expect(paymentActions.update).not.toHaveBeenCalled();
  });

  it('prefills destination values when editing an enabled config', async () => {
    paymentActions.load.mockResolvedValueOnce(enabledConfig('community-1'));
    renderSettingsPage(makeSession('admin'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByLabelText('UPI ID (VPA)')).toHaveValue('greenvalley@upi-bank');
    expect(screen.getByLabelText('Payee name')).toHaveValue('Green Valley Association');
  });

  it('does not prefill destination values from a disabled config', async () => {
    paymentActions.load.mockResolvedValueOnce(
      config('community-1', {
        enabled: false,
        vpa: 'stale@upi',
        payeeName: 'Old Association',
      }),
    );
    renderSettingsPage(makeSession('admin'));
    fireEvent.click(await screen.findByRole('button', { name: 'Configure' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Direct UPI' }));
    expect(screen.getByLabelText('UPI ID (VPA)')).toHaveValue('');
    expect(screen.getByLabelText('Payee name')).toHaveValue('');
  });

  it('saves enabled values and displays the authoritative returned config', async () => {
    const session = makeSession('admin');
    renderSettingsPage(session);
    fireEvent.click(await screen.findByRole('button', { name: 'Configure' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Direct UPI' }));
    fireEvent.change(screen.getByLabelText('UPI ID (VPA)'), {
      target: { value: ' entered@upi-bank ' },
    });
    fireEvent.change(screen.getByLabelText('Payee name'), {
      target: { value: ' Entered Payee ' },
    });
    paymentActions.update.mockResolvedValueOnce(
      enabledConfig('community-1', 'authoritative@upi-bank', 'Authoritative Payee'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(paymentActions.update).toHaveBeenCalledWith(session, {
        enabled: true,
        vpa: 'entered@upi-bank',
        payeeName: 'Entered Payee',
      }),
    );
    expect(await screen.findByText('authoritative@upi-bank')).toBeInTheDocument();
    expect(screen.getByText('Authoritative Payee')).toBeInTheDocument();
    expect(screen.getByText('Direct UPI settings saved.')).toBeInTheDocument();
    expect(screen.queryByText('entered@upi-bank')).not.toBeInTheDocument();
  });

  it('requires disable confirmation and cancellation makes no update call', async () => {
    paymentActions.load.mockResolvedValueOnce(enabledConfig('community-1'));
    renderSettingsPage(makeSession('admin'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Enable Direct UPI' }));
    expect(
      screen.getByText(
        'Disabling Direct UPI will prevent residents from using this payment destination for new direct UPI payments.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('checkbox', { name: 'Enable Direct UPI' })).toBeChecked();
    expect(paymentActions.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('sends only enabled false after confirmed disable and hides the old destination', async () => {
    paymentActions.load.mockResolvedValueOnce(enabledConfig('community-1'));
    paymentActions.update.mockResolvedValueOnce(config('community-1', { enabled: false }));
    renderSettingsPage(makeSession('admin'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Direct UPI' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(screen.queryByLabelText('UPI ID (VPA)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(paymentActions.update).toHaveBeenCalledWith(makeSession('admin'), { enabled: false }),
    );
    expect(await screen.findByText('Disabled')).toBeInTheDocument();
    expect(screen.queryByText('greenvalley@upi-bank')).not.toBeInTheDocument();
    expect(screen.queryByText('Green Valley Association')).not.toBeInTheDocument();
    expect(screen.getByText('Direct UPI disabled.')).toBeInTheDocument();
  });

  it('shows a safe load error and Retry starts a fresh load', async () => {
    paymentActions.load
      .mockRejectedValueOnce(new Error('raw Firebase details'))
      .mockResolvedValueOnce(disabledConfig('community-1'));
    renderSettingsPage(makeSession('admin'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Payment settings could not be loaded.',
    );
    expect(screen.queryByText('raw Firebase details')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Not configured')).toBeInTheDocument();
    expect(paymentActions.load).toHaveBeenCalledTimes(2);
  });

  it('keeps the editor open and shows a safe error when update fails', async () => {
    paymentActions.update.mockRejectedValueOnce(new Error('raw Firebase details'));
    renderSettingsPage(makeSession('admin'));
    fireEvent.click(await screen.findByRole('button', { name: 'Configure' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Direct UPI' }));
    fireEvent.change(screen.getByLabelText('UPI ID (VPA)'), { target: { value: 'assoc@upi' } });
    fireEvent.change(screen.getByLabelText('Payee name'), { target: { value: 'Association' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Community payment settings could not be updated.',
    );
    expect(screen.queryByText('raw Firebase details')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Direct UPI payment settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('ignores a stale load after the selected community changes', async () => {
    const sessionA = makeSession('admin');
    const sessionB = withCommunity(sessionA, 'community-2');
    const loadA = deferred<CommunityPaymentConfig>();
    const loadB = deferred<CommunityPaymentConfig>();
    const loadConfig = vi.fn((session: Session) =>
      session.community?.id === 'community-1' ? loadA.promise : loadB.promise,
    );
    const view = renderSettingsComponent(sessionA, loadConfig, paymentActions.update);
    view.rerender(
      <CommunityPaymentSettings
        session={sessionB}
        loadConfig={loadConfig}
        updateConfig={paymentActions.update}
      />,
    );
    await act(async () => loadB.resolve(enabledConfig('community-2', 'sunridge@upi', 'Sunridge')));
    expect(await screen.findByText('sunridge@upi')).toBeInTheDocument();
    await act(async () =>
      loadA.resolve(enabledConfig('community-1', 'greenvalley@upi-bank', 'Green Valley')),
    );
    expect(screen.getByText('sunridge@upi')).toBeInTheDocument();
    expect(screen.queryByText('greenvalley@upi-bank')).not.toBeInTheDocument();
  });

  it('ignores a stale save result after the selected community changes', async () => {
    const sessionA = makeSession('admin');
    const sessionB = withCommunity(sessionA, 'community-2');
    const saveA = deferred<CommunityPaymentConfig>();
    const loadConfig = vi.fn(async (session: Session) =>
      enabledConfig(
        session.community?.id ?? '',
        session.community?.id === 'community-1' ? 'greenvalley@upi' : 'sunridge@upi',
        session.community?.id === 'community-1' ? 'Green Valley' : 'Sunridge',
      ),
    );
    const updateConfig = vi.fn(() => saveA.promise);
    const view = renderSettingsComponent(sessionA, loadConfig, updateConfig);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateConfig).toHaveBeenCalledOnce());

    view.rerender(
      <CommunityPaymentSettings
        session={sessionB}
        loadConfig={loadConfig}
        updateConfig={updateConfig}
      />,
    );
    expect(await screen.findByText('sunridge@upi')).toBeInTheDocument();
    await act(async () => saveA.resolve(enabledConfig('community-1', 'late@upi', 'Late A')));
    expect(screen.getByText('sunridge@upi')).toBeInTheDocument();
    expect(screen.queryByText('late@upi')).not.toBeInTheDocument();
    expect(screen.queryByText('Direct UPI settings saved.')).not.toBeInTheDocument();
  });
});
