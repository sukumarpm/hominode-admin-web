import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Login } from '../Login';

const mocks = vi.hoisted(() => ({
  auth: {},
  verifier: vi.fn(),
  instances: [] as { clear: ReturnType<typeof vi.fn> }[],
  signIn: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('../firebase', () => ({ firebase: () => ({ auth: mocks.auth }) }));
vi.mock('firebase/auth', () => ({
  RecaptchaVerifier: class {
    clear = vi.fn();
    constructor(auth: unknown, container: string, options: unknown) {
      mocks.verifier(auth, container, options);
      mocks.instances.push(this);
    }
  },
  signInWithPhoneNumber: mocks.signIn,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.instances.length = 0;
  mocks.signIn.mockResolvedValue({ confirm: mocks.confirm });
  mocks.confirm.mockResolvedValue({});
});
afterEach(() => vi.restoreAllMocks());

function enterPhone() {
  fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+639171234567' } });
}
function sendCode() {
  fireEvent.click(screen.getByRole('button', { name: 'Send verification code' }));
}

it('uses invisible verification, passes the real verifier to Phone Auth, and preserves OTP confirmation', async () => {
  const view = render(<Login />);
  enterPhone();
  sendCode();
  await screen.findByLabelText('Verification code');
  expect(mocks.verifier).toHaveBeenCalledWith(mocks.auth, 'phone-recaptcha', { size: 'invisible' });
  expect(mocks.signIn).toHaveBeenCalledWith(mocks.auth, '+639171234567', mocks.instances[0]);
  fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify & continue' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('123456'));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Verify & continue' })).toBeEnabled(),
  );
  expect(mocks.verifier).toHaveBeenCalledOnce();
  view.unmount();
  expect(mocks.instances[0].clear).toHaveBeenCalledOnce();
});

it('clears and recreates the verifier after Use another number and on unmount', async () => {
  const view = render(<Login />);
  enterPhone();
  sendCode();
  await screen.findByLabelText('Verification code');
  fireEvent.click(screen.getByRole('button', { name: 'Use another number' }));
  expect(mocks.instances[0].clear).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText('Verification code')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+639181234567' } });
  sendCode();
  await screen.findByLabelText('Verification code');
  expect(mocks.verifier).toHaveBeenCalledTimes(2);
  expect(mocks.signIn).toHaveBeenLastCalledWith(mocks.auth, '+639181234567', mocks.instances[1]);
  view.unmount();
  expect(mocks.instances[1].clear).toHaveBeenCalledOnce();
});

it('shows a friendly send error without console diagnostics and recreates verification on retry', async () => {
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.signIn.mockRejectedValueOnce({
    code: 'auth/too-many-requests',
    message: 'private error detail',
    customData: { phoneNumber: '+639171234567' },
  });
  render(<Login />);
  enterPhone();
  sendCode();
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Too many attempts. Please wait a few minutes and try again.',
  );
  expect(mocks.instances[0].clear).toHaveBeenCalledOnce();
  expect(errorLog).not.toHaveBeenCalled();
  expect(warnLog).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
  expect(screen.queryByText(/private error detail/)).not.toBeInTheDocument();
  sendCode();
  await screen.findByLabelText('Verification code');
  expect(mocks.verifier).toHaveBeenCalledTimes(2);
  expect(mocks.signIn).toHaveBeenLastCalledWith(mocks.auth, '+639171234567', mocks.instances[1]);
});

it('preserves friendly OTP errors and retries without sending a new OTP or logging raw errors', async () => {
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.confirm.mockRejectedValueOnce({
    code: 'auth/invalid-verification-code',
    message: 'private OTP detail',
  });
  render(<Login />);
  enterPhone();
  sendCode();
  await screen.findByLabelText('Verification code');
  fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify & continue' }));
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'The verification code is incorrect. Please check the code and try again.',
    ),
  );
  expect(errorLog).not.toHaveBeenCalled();
  expect(mocks.instances[0].clear).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '654321' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify & continue' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenLastCalledWith('654321'));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Verify & continue' })).toBeEnabled(),
  );
  expect(mocks.signIn).toHaveBeenCalledOnce();
});
