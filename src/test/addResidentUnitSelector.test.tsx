import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { makeSession } from './fixtures';
import type { Row } from '../models';
const mocks = vi.hoisted(() => ({
  buildings: [] as Row[],
  units: [] as Row[],
  call: vi.fn(),
  authority: vi.fn(),
}));
vi.mock('../data', () => ({
  safeUrl: () => null,
  useRows: (_s: unknown, module: string) => ({
    rows: module === 'buildings' ? mocks.buildings : mocks.units,
    loading: false,
    error: '',
  }),
}));
vi.mock('../firebase', () => ({ call: mocks.call }));
vi.mock('../actions', () => ({ currentAuthority: mocks.authority }));
import { AdminCreateButtons } from '../AdminTools';
import { isResidentUnitAvailable } from '../residentUnitOptions';
const row = (id: string, data: Record<string, unknown>): Row => ({
  id,
  data: { communityId: 'community-1', ...data },
});
const session = {
  ...makeSession('admin'),
  community: { ...makeSession('admin').community!, data: { countryCode: 'PH' } },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildings = [
    row('b', { name: 'Tower B' }),
    row('a', { name: 'Tower A' }),
    row('empty', { name: 'Empty Tower' }),
  ];
  mocks.units = [
    row('b101', { buildingId: 'b', flatLabel: '101', status: 'vacant' }),
    row('a10', { buildingId: 'a', flatLabel: 'A10', status: 'vacant' }),
    row('a2', { buildingId: 'a', flatLabel: 'A2', status: 'vacant' }),
    row('a101', { buildingId: 'a', flatId: '101', status: 'vacant' }),
    row('occupied', { buildingId: 'a', flatLabel: 'Occupied', status: 'occupied' }),
    row('shared', {
      buildingId: 'a',
      flatLabel: 'Shared',
      status: 'vacant',
      residentIds: ['one', 'two'],
    }),
    row('reserved', {
      buildingId: 'a',
      flatLabel: 'Reserved',
      status: 'vacant',
      reservedOnboardingId: 'pending',
    }),
  ];
  mocks.call.mockResolvedValue({ onboardingId: 'onboarding-1' });
  mocks.authority.mockResolvedValue(undefined);
});
function open() {
  const rendered = render(<AdminCreateButtons s={session} module="residents" />);
  fireEvent.click(screen.getByRole('button', { name: 'Add Resident' }));
  return rendered;
}
it('filters eligible units by building and sorts labels naturally', () => {
  open();
  fireEvent.change(screen.getByLabelText('Building'), { target: { value: 'a' } });
  expect(
    within(screen.getByLabelText('Unit'))
      .getAllByRole('option')
      .map((o) => o.textContent),
  ).toEqual(['Select unit', '101', 'A2', 'A10']);
});
it('global search finds duplicate numbers across buildings and syncs both dropdowns', () => {
  open();
  fireEvent.change(screen.getByLabelText('Building'), { target: { value: 'a' } });
  fireEvent.change(screen.getByLabelText('Search units across all buildings'), {
    target: { value: '01' },
  });
  expect(screen.getByRole('button', { name: 'Tower A · 101' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tower B · 101' }));
  expect(screen.getByLabelText('Building')).toHaveValue('b');
  expect(screen.getByLabelText('Unit')).toHaveValue('b101');
  fireEvent.change(screen.getByLabelText('Building'), { target: { value: 'a' } });
  expect(screen.getByLabelText('Unit')).toHaveValue('');
});
it('handles empty buildings, units, and no matches', () => {
  const view = open();
  fireEvent.change(screen.getByLabelText('Building'), { target: { value: 'empty' } });
  expect(screen.getByText('No eligible units in this building')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search units across all buildings'), {
    target: { value: 'no-match' },
  });
  expect(screen.getByText('No matching eligible units')).toBeInTheDocument();
  mocks.buildings = [];
  view.rerender(<AdminCreateButtons s={session} module="residents" />);
  expect(screen.getByText('No buildings available')).toBeInTheDocument();
});
it('existing onboarding submission reserves canonical IDs selected through search', async () => {
  open();
  fireEvent.change(screen.getByLabelText('Resident name'), { target: { value: 'New Resident' } });
  fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+639171234567' } });
  fireEvent.change(screen.getByLabelText('Search units across all buildings'), {
    target: { value: '101' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tower B · 101' }));
  fireEvent.submit(screen.getByLabelText('Resident name').closest('form')!);
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith('assignResidentOnboardingToFlat', {
      communityId: 'community-1',
      onboardingId: 'onboarding-1',
      buildingId: 'b',
      flatId: 'b101',
    }),
  );
  expect(mocks.call).toHaveBeenCalledWith(
    'createResidentOnboarding',
    expect.objectContaining({ residentName: 'New Resident', residentType: 'owner' }),
  );
});
it('rechecks current eligibility before creating onboarding', async () => {
  const view = open();
  fireEvent.change(screen.getByLabelText('Building'), { target: { value: 'a' } });
  fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'a101' } });
  mocks.units = mocks.units.map((u) =>
    u.id === 'a101' ? { ...u, data: { ...u.data, status: 'occupied' } } : u,
  );
  view.rerender(<AdminCreateButtons s={session} module="residents" />);
  fireEvent.submit(screen.getByLabelText('Resident name').closest('form')!);
  await waitFor(() =>
    expect(screen.getByText('The selected unit is no longer available.')).toBeInTheDocument(),
  );
  expect(mocks.call).not.toHaveBeenCalled();
});
it('uses the existing vacancy contract for shared and reserved units', () => {
  expect(isResidentUnitAvailable({ status: 'vacant' })).toBe(true);
  for (const patch of [
    { isActive: false },
    { residentUid: 'other' },
    { residentUserId: 'other' },
    { residentId: 'legacy' },
    { residentIds: ['one', 'two'] },
    { residentIds: 'unknown' },
    { reservedOnboardingId: 'pending' },
    { status: 'occupied' },
  ]) {
    expect(isResidentUnitAvailable({ status: 'vacant', ...patch })).toBe(false);
  }
});
