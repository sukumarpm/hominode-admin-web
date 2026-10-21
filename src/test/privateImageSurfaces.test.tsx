import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { type ReactNode } from 'react';
import { ProfilePage, CommunityPage, ModulePage } from '../pages';
import { AuthContext } from '../session';
import { type Module, type Resource } from '../data';
import { type Session } from '../models';
import { makeSession } from './fixtures';

const mock = vi.hoisted(() => ({ rows: [] as Resource['rows'] }));
vi.mock('../firebase', () => ({
  call: vi.fn(),
  firebase: () => {
    throw Error('No production Firebase in surface tests');
  },
}));
vi.mock('../data', async () => ({
  ...(await vi.importActual<typeof import('../data')>('../data')),
  useRows: () => ({ rows: mock.rows, loading: false, error: '' }),
  useApartmentImages: () => ({ rows: [], loading: false, error: '' }),
  useAdminV2PaymentProofs: () => ({ rows: [], loading: false, error: '' }),
  useAdminV2RecurringSchedules: () => ({ rows: [], loading: false, error: '' }),
}));
vi.mock('../subscriptionContext', () => ({
  useSubscription: () => ({ entitlement: null, loading: false, error: '' }),
}));
function wrap(child: ReactNode, s: Session = makeSession(), path = '/') {
  return (
    <AuthContext
      value={{
        session: s,
        loading: false,
        error: '',
        authenticated: true,
        signOut: vi.fn(),
        switchCommunity: vi.fn(),
      }}
    >
      <MemoryRouter initialEntries={[path]}>{child}</MemoryRouter>
    </AuthContext>
  );
}
beforeEach(() => {
  mock.rows = [];
});
it('existing alternate apartment view retains unit details and navigation', () => {
  mock.rows = [{ id: 'unit-1', data: { flatLabel: 'Tower A · 1203' } }];
  render(wrap(<ProfilePage apartment />));
  expect(screen.getByRole('heading', { name: 'My Apartment' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'My vehicles' })).toHaveAttribute(
    'href',
    '/green-valley/vehicles',
  );
});

it('Admin resident details display existing resident profile URLs', async () => {
  mock.rows = [
    {
      id: 'resident',
      data: {
        name: 'Resident Photo',
        communityId: 'community-1',
        photoURL: 'https://example.invalid/resident.jpg',
        role: 'resident',
        isActive: true,
      },
    },
  ];
  render(
    wrap(
      <ModulePage module={'residents' as Module} />,
      makeSession('admin'),
      '/residents?record=resident',
    ),
  );
  const detail = screen.getByRole('dialog', { name: 'Resident Photo' });
  expect(await within(detail).findByRole('img')).toHaveAttribute(
    'src',
    'https://example.invalid/resident.jpg',
  );
});
it('Admin building details contain apartment gallery and Community page contains community gallery', () => {
  mock.rows = [{ id: 'building', data: { name: 'Building One', communityId: 'community-1' } }];
  const view = render(
    wrap(
      <ModulePage module={'buildings' as Module} />,
      makeSession('admin'),
      '/buildings?record=building',
    ),
  );
  expect(
    within(screen.getByRole('dialog', { name: 'Building One' })).getByText('No photos available.'),
  ).toBeVisible();
  view.unmount();
  render(wrap(<CommunityPage />, makeSession('admin')));
  expect(screen.getByText('No photos available.')).toBeVisible();
});
