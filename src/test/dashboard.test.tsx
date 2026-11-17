import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../Dashboard';
import { type Resource } from '../data';
import * as models from '../models';
import { AuthContext, type AuthState } from '../session';
import { makeSession, secondCommunity } from './fixtures';

const mocks = vi.hoisted(() => ({ resources: new Map<string, Resource>() }));

vi.mock('../data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data')>();
  return {
    ...actual,
    useRows: vi.fn(
      (session: { community: { id: string } | null }, module: string) =>
        mocks.resources.get(`${session.community?.id ?? ''}:${module}`) ?? {
          rows: [],
          loading: false,
          error: '',
        },
    ),
  };
});

function setResource(communityId: string, module: string, rows: Resource['rows']) {
  mocks.resources.set(`${communityId}:${module}`, { rows, loading: false, error: '' });
}

function authValue(session: ReturnType<typeof makeSession>): AuthState {
  return {
    session,
    loading: false,
    error: '',
    authenticated: true,
    signOut: vi.fn(async () => {}),
    switchCommunity: vi.fn(),
  };
}

function renderDashboard(session: ReturnType<typeof makeSession>) {
  const value = authValue(session);
  return {
    ...render(
      <MemoryRouter>
        <AuthContext value={value}>
          <Dashboard />
        </AuthContext>
      </MemoryRouter>,
    ),
    value,
  };
}

beforeEach(() => mocks.resources.clear());
afterEach(() => vi.restoreAllMocks());

describe('Admin dashboard derived data', () => {
  it('keeps totals and ordering, reuses unchanged summaries, and refreshes for new tenant data', () => {
    const session = makeSession('admin');
    const bills = [
      { id: 'paid', data: { status: 'paid', amount: 100 } },
      { id: 'settled', data: { status: 'settled', amount: 50 } },
      { id: 'pending', data: { status: 'pending', amount: 30 } },
      { id: 'overdue', data: { status: 'overdue', amount: 20 } },
    ];
    const units = [
      { id: 'occupied', data: { status: 'occupied' } },
      { id: 'vacant', data: { status: 'vacant' } },
      { id: 'reserved', data: { status: 'reserved' } },
      { id: 'maintenance', data: { status: 'maintenance' } },
    ];
    setResource(session.community!.id, 'billing', bills);
    setResource(session.community!.id, 'units', units);
    setResource(session.community!.id, 'visitors', [
      {
        id: 'visitor-old',
        data: {
          title: 'Older visitor',
          visitorName: 'Older visitor',
          createdAt: new Date('2025-01-01'),
        },
      },
      {
        id: 'visitor-new',
        data: {
          title: 'Newest visitor',
          visitorName: 'Newest visitor',
          createdAt: new Date('2025-01-03'),
        },
      },
    ]);
    setResource(session.community!.id, 'complaints', [
      {
        id: 'complaint-middle',
        data: { title: 'Middle complaint', createdAt: new Date('2025-01-02') },
      },
    ]);
    for (const module of ['residents', 'bookings']) setResource(session.community!.id, module, []);

    const billRows = new Set<unknown>(bills.map((row) => row.data));
    const unitRows = new Set<unknown>(units.map((row) => row.data));
    const statusSpy = vi.spyOn(models, 'status');
    const amountSpy = vi.spyOn(models, 'amount');
    const view = renderDashboard(session);
    const financialCallsFor = (rows: Set<unknown>) =>
      statusSpy.mock.calls.filter(([data]) => rows.has(data)).length;

    const collection = screen.getByText('Maintenance Collection').closest('.card') as HTMLElement;
    expect(within(collection).getByText(models.money(200))).toBeInTheDocument();
    expect(within(collection).getByText(models.money(150))).toBeInTheDocument();
    expect(within(collection).getByText(models.money(30))).toBeInTheDocument();
    expect(within(collection).getByText(models.money(20))).toBeInTheDocument();

    const occupancy = screen
      .getByRole('heading', { name: 'Community Occupancy' })
      .closest('.card') as HTMLElement;
    expect(within(occupancy).getByText('25%')).toBeInTheDocument();
    const unitCounts = occupancy.querySelector('dl') as HTMLElement;
    for (const label of ['Occupied', 'Vacant', 'Reserved', 'Maintenance'])
      expect(within(unitCounts).getByText(label).parentElement as HTMLElement).toHaveTextContent(
        '1',
      );
    expect(
      within(unitCounts).getByText('Total Units').parentElement as HTMLElement,
    ).toHaveTextContent('4');

    const activity = screen
      .getByRole('heading', { name: 'Recent Activity' })
      .closest('.card') as HTMLElement;
    expect(
      [...activity.querySelectorAll('.record strong')].map((node) => node.textContent),
    ).toEqual(['Newest visitor', 'Middle complaint', 'Older visitor']);

    const initialBillStatusCalls = financialCallsFor(billRows);
    const initialUnitStatusCalls = financialCallsFor(unitRows);
    const initialAmountCalls = amountSpy.mock.calls.filter(([data]) => billRows.has(data)).length;

    setResource(session.community!.id, 'bookings', [
      { id: 'booking-1', data: { title: 'New booking' } },
    ]);
    view.rerender(
      <MemoryRouter>
        <AuthContext value={authValue(session)}>
          <Dashboard />
        </AuthContext>
      </MemoryRouter>,
    );
    expect(financialCallsFor(billRows)).toBe(initialBillStatusCalls);
    expect(financialCallsFor(unitRows)).toBe(initialUnitStatusCalls);
    expect(amountSpy.mock.calls.filter(([data]) => billRows.has(data))).toHaveLength(
      initialAmountCalls,
    );

    const nextBills = [{ id: 'paid-next', data: { status: 'paid', amount: 75 } }];
    const nextUnits = [
      { id: 'occupied-next', data: { status: 'occupied' } },
      { id: 'occupied-next-2', data: { status: 'occupied' } },
    ];
    setResource(session.community!.id, 'billing', nextBills);
    setResource(session.community!.id, 'units', nextUnits);
    view.rerender(
      <MemoryRouter>
        <AuthContext value={authValue(session)}>
          <Dashboard />
        </AuthContext>
      </MemoryRouter>,
    );
    expect(within(collection).getAllByText(models.money(75))).toHaveLength(2);
    expect(within(occupancy).getByText('100%')).toBeInTheDocument();

    const switchedSession = { ...session, community: secondCommunity };
    setResource(secondCommunity.id, 'billing', [
      { id: 'switch-pending', data: { status: 'pending', amount: 42 } },
    ]);
    setResource(secondCommunity.id, 'units', [{ id: 'switch-vacant', data: { status: 'vacant' } }]);
    for (const module of ['visitors', 'complaints', 'residents', 'bookings'])
      setResource(secondCommunity.id, module, []);
    view.rerender(
      <MemoryRouter>
        <AuthContext value={authValue(switchedSession)}>
          <Dashboard />
        </AuthContext>
      </MemoryRouter>,
    );
    expect(within(collection).getAllByText(models.money(42))).toHaveLength(2);
    expect(within(occupancy).getByText('0%')).toBeInTheDocument();
  });

  it('retains empty unit summaries', () => {
    const session = makeSession('admin');
    for (const module of ['billing', 'units', 'visitors', 'complaints', 'residents', 'bookings'])
      setResource(session.community!.id, module, []);
    renderDashboard(session);
    const occupancy = screen
      .getByRole('heading', { name: 'Community Occupancy' })
      .closest('.card') as HTMLElement;
    expect(within(occupancy).getByText('No units have been configured.')).toBeInTheDocument();
  });
});
