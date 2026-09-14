import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { App } from '../App';
import { AuthContext, type AuthState } from '../session';
import { APP_ROLE } from '../role';
import { makeSession } from './fixtures';
vi.mock('../firebase', () => ({
  call: vi.fn(async (_name: string, p: { slug?: string }) => ({
    communityId: p.slug === 'sunridge' ? 'community-2' : 'community-1',
    slug: p.slug,
    name: p.slug === 'sunridge' ? 'Sunridge' : 'Green Valley',
  })),
  firebase: vi.fn(() => {
    throw Error('No live Firebase in UI tests');
  }),
}));
vi.mock('../data', async () => {
  const actual = await vi.importActual<typeof import('../data')>('../data');
  return { ...actual, useRows: vi.fn(() => ({ rows: [], loading: false, error: '' })) };
});
const base = APP_ROLE === 'resident' ? '/green-valley' : '/';
function path(module: string) {
  return APP_ROLE === 'resident' ? base + '/' + module : '/' + module;
}
function mount(url = path('visitors'), overrides: Partial<AuthState> = {}) {
  const value: AuthState = {
    session: makeSession(APP_ROLE),
    loading: false,
    error: '',
    authenticated: true,
    signOut: vi.fn(async () => {}),
    switchCommunity: vi.fn(),
    ...overrides,
  };
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <AuthContext value={value}>
            <App />
          </AuthContext>
        ),
      },
    ],
    { initialEntries: [url] },
  );
  const view = render(<RouterProvider router={router} />);
  return { router, value, ...view };
}
beforeEach(() => vi.clearAllMocks());
describe('protected nested routes', () => {
  it('renders direct deep links after tenant resolution', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Visitors', level: 1 })).toBeInTheDocument();
  });
  it('retains the shell and sidebar node across navigation and history', async () => {
    const { router } = mount();
    const shell = await screen.findByTestId('app-shell');
    const nav = screen.getAllByRole('navigation', { name: 'Main navigation' })[0];
    await act(() => router.navigate(path('complaints')));
    expect(
      await screen.findByRole('heading', { name: 'Complaints', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('app-shell')).toBe(shell);
    expect(screen.getAllByRole('navigation', { name: 'Main navigation' })[0]).toBe(nav);
    await act(() => router.navigate(-1));
    expect(await screen.findByRole('heading', { name: 'Visitors', level: 1 })).toBeInTheDocument();
    await act(() => router.navigate(1));
    expect(
      await screen.findByRole('heading', { name: 'Complaints', level: 1 }),
    ).toBeInTheDocument();
  });
  it('renders a login form without a session', async () => {
    mount(path('visitors'), { session: null, authenticated: false });
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
  });
  it('shows revoked profile access without rendering the shell', async () => {
    mount(path('visitors'), { session: null, error: 'Your account is inactive.' });
    expect(await screen.findByText('Your account is inactive.')).toBeInTheDocument();
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
  });
  it('uses localized module empty states', async () => {
    mount(path('facilities'));
    expect(await screen.findByText('No facilities to display yet.')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
  });
  it('signs out through the session lifecycle', async () => {
    const { value } = mount();
    await screen.findByTestId('app-shell');
    fireEvent.click(screen.getAllByRole('button', { name: 'Log out' })[0]);
    await waitFor(() => expect(value.signOut).toHaveBeenCalledOnce());
  });
  if (APP_ROLE === 'resident')
    it('rejects a cross-tenant deep link without mounting the shell', async () => {
      mount('/sunridge/visitors');
      expect(
        await screen.findByText('This account does not belong to the community in this address.'),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
    });
  if (APP_ROLE === 'admin')
    it('community switch calls the authorized selection boundary', async () => {
      const { value } = mount();
      await screen.findByTestId('app-shell');
      fireEvent.change(screen.getByRole('combobox', { name: 'Selected community' }), {
        target: { value: 'community-2' },
      });
      expect(value.switchCommunity).toHaveBeenCalledWith('community-2');
    });
});
