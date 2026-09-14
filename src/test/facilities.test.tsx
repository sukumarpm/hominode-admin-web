import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFacility, setFacilityAvailability, updateFacility } from '../actions';
import { querySpec, useRows, type Module, type Resource } from '../data';
import { type Row, type Session } from '../models';
import { ModulePage } from '../pages';
import { AuthContext } from '../session';
import { makeSession } from './fixtures';

vi.mock('../firebase', () => ({
  call: vi.fn(),
  firebase: vi.fn(() => {
    throw Error('No live Firebase in UI tests');
  }),
}));
vi.mock('../actions', async () => ({
  ...(await vi.importActual<typeof import('../actions')>('../actions')),
  createFacility: vi.fn(),
  updateFacility: vi.fn(),
  setFacilityAvailability: vi.fn(),
}));
vi.mock('../data', async () => ({
  ...(await vi.importActual<typeof import('../data')>('../data')),
  useRows: vi.fn(),
}));

let facilities: Row[];
let buildings: Resource;
const session = makeSession('admin');

function view(s: Session, module: Module = 'facilities') {
  return (
    <MemoryRouter>
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
        <ModulePage module={module} />
      </AuthContext>
    </MemoryRouter>
  );
}
function mount() {
  return render(view(session));
}
function openCreate() {
  fireEvent.click(screen.getByRole('button', { name: 'Add facility' }));
}
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function fillCreate() {
  change('Facility name', '  Garden Hall  ');
  change('Facility type', 'Function Hall');
  change('Building', 'tower-1');
}
function submit() {
  fireEvent.submit(screen.getByRole('form', { name: 'Facility form' }));
}
function openEdit() {
  fireEvent.click(screen.getByRole('button', { name: /Function Hall/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit facility' }));
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  facilities = [
    {
      id: 'hall',
      data: {
        name: 'Function Hall',
        type: 'Hall',
        communityId: 'community-1',
        buildingId: 'tower-1',
        buildingName: 'Tower A',
        description: 'Celebrations',
        iconName: 'event',
        imageUrl: 'https://example.com/hall.jpg',
        isAvailable: true,
        status: 'inactive',
        isFree: false,
        pricePerDay: 100,
        timeSlots: ['6:00 AM - 7:00 AM'],
        maxCapacity: 50,
        subscriptionPackages: { monthly: 1000 },
        legacy: 'keep',
      },
    },
    {
      id: 'pool',
      data: { name: 'Pool', communityId: 'community-1', isAvailable: false, status: 'active' },
    },
  ];
  buildings = {
    loading: false,
    error: '',
    rows: [
      { id: 'tower-1', data: { communityId: 'community-1', buildingName: 'Tower A' } },
      { id: 'tower-2', data: { communityId: 'community-2', name: 'Other community tower' } },
    ],
  };
  vi.mocked(useRows).mockImplementation((s, module) => {
    if (module === 'buildings')
      return {
        ...buildings,
        rows: buildings.rows.filter((row) => row.data.communityId === s.community?.id),
      };
    return {
      rows: facilities.filter((row) => row.data.communityId === s.community?.id),
      loading: false,
      error: '',
    };
  });
  vi.mocked(createFacility).mockImplementation(async (_s, input) => {
    facilities.push({ id: 'new', data: { ...input, communityId: 'community-1' } });
    return { id: 'new' } as Awaited<ReturnType<typeof createFacility>>;
  });
  vi.mocked(updateFacility).mockImplementation(async (_s, id, fields) => {
    const row = facilities.find((item) => item.id === id)!;
    row.data = { ...row.data, ...fields };
  });
  vi.mocked(setFacilityAvailability).mockImplementation(async (_s, id, isAvailable) => {
    const row = facilities.find((item) => item.id === id)!;
    row.data = { ...row.data, isAvailable };
  });
});

describe('Facilities page', () => {
  it('offers the predefined types and submits Gym as a string', async () => {
    mount();
    openCreate();
    fillCreate();
    const dropdown = screen.getByRole('combobox', { name: 'Facility type' });
    expect(
      within(dropdown)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Select facility type',
      'Gym',
      'Swimming Pool',
      'Clubhouse',
      'Function Hall',
      'Sports Court',
      'Playground',
      'Garden / Park',
      'Meeting Room',
      'Multipurpose Hall',
      'Recreation Area',
      'Other',
    ]);
    change('Facility type', 'Gym');
    expect(screen.queryByLabelText('Specify facility type')).not.toBeInTheDocument();
    submit();
    await waitFor(() => expect(createFacility).toHaveBeenCalledOnce());
    expect(vi.mocked(createFacility).mock.calls[0][1].type).toBe('Gym');
  });

  it.each(['', '   '])('rejects a blank Other type (%j)', (customType) => {
    mount();
    openCreate();
    fillCreate();
    change('Facility type', 'Other');
    expect(screen.getByRole('textbox', { name: 'Specify facility type' })).toBeInTheDocument();
    change('Specify facility type', customType);
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Specify a facility type');
    expect(createFacility).not.toHaveBeenCalled();
  });

  it('submits a trimmed custom type as the existing type string', async () => {
    mount();
    openCreate();
    fillCreate();
    change('Facility type', 'Other');
    change('Specify facility type', '  Yoga Studio  ');
    submit();
    await waitFor(() => expect(createFacility).toHaveBeenCalledOnce());
    expect(vi.mocked(createFacility).mock.calls[0][1].type).toBe('Yoga Studio');
    expect(vi.mocked(createFacility).mock.calls[0][1]).not.toHaveProperty('customType');
  });

  it('opens an existing custom type under Other and preserves it on an unrelated edit', async () => {
    facilities[0].data.type = 'Yoga Studio';
    mount();
    openEdit();
    expect(screen.getByRole('combobox', { name: 'Facility type' })).toHaveValue('Other');
    expect(screen.getByLabelText('Specify facility type')).toHaveValue('Yoga Studio');
    change('Description (optional)', 'New description');
    submit();
    await waitFor(() =>
      expect(updateFacility).toHaveBeenCalledExactlyOnceWith(session, 'hall', {
        description: 'New description',
      }),
    );
    expect(facilities[0].data.type).toBe('Yoga Studio');
  });

  it('selects an existing predefined type and supports changing it to a custom type', async () => {
    facilities[0].data.type = 'Gym';
    mount();
    openEdit();
    expect(screen.getByRole('combobox', { name: 'Facility type' })).toHaveValue('Gym');
    change('Facility type', 'Other');
    change('Specify facility type', '   ');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Specify a facility type');
    expect(updateFacility).not.toHaveBeenCalled();
    change('Specify facility type', '  Future Facility Type  ');
    submit();
    await waitFor(() =>
      expect(updateFacility).toHaveBeenCalledExactlyOnceWith(session, 'hall', {
        type: 'Future Facility Type',
      }),
    );
  });

  it('keeps existing page controls and opens/closes the create modal', () => {
    mount();
    expect(screen.getByRole('link', { name: /My bookings/ })).toHaveAttribute('href', '/bookings');
    expect(screen.getByRole('textbox', { name: 'Search facilities' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeInTheDocument();
    openCreate();
    expect(screen.getByRole('dialog', { name: 'Add facility' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    openCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses the existing community-scoped building query and only its results', () => {
    mount();
    openCreate();
    expect(querySpec(session, 'buildings')).toEqual({
      collection: 'buildings',
      filters: [['communityId', '==', 'community-1']],
    });
    expect(useRows).toHaveBeenCalledWith(session, 'buildings');
    expect(screen.getByRole('option', { name: 'Tower A' })).toHaveValue('tower-1');
    expect(screen.queryByRole('option', { name: 'Other community tower' })).not.toBeInTheDocument();
  });

  it('validates required fields without submitting', () => {
    mount();
    openCreate();
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a facility name');
    change('Facility name', '  ');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a facility name');
    change('Facility name', 'Hall');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a facility type');
    change('Facility type', 'Function Hall');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Select a building');
    expect(createFacility).not.toHaveBeenCalled();
  });

  it('creates with typed fields and refreshes the list after success', async () => {
    mount();
    openCreate();
    fillCreate();
    change('Description (optional)', '  Community events  ');
    change('Icon name (optional)', '  event  ');
    change('Image URL (optional)', '  https://example.com/garden.jpg  ');
    change('Availability', 'false');
    fireEvent.click(screen.getByRole('radio', { name: 'Chargeable' }));
    change('Fee per day', '125.5');
    fireEvent.click(screen.getByRole('button', { name: 'Add time slot' }));
    change('Time slot 1', '  6:00 AM - 7:00 AM  ');
    submit();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(createFacility).toHaveBeenCalledExactlyOnceWith(session, {
      name: 'Garden Hall',
      type: 'Function Hall',
      buildingId: 'tower-1',
      description: 'Community events',
      iconName: 'event',
      imageUrl: 'https://example.com/garden.jpg',
      isAvailable: false,
      isFree: false,
      pricingMode: 'flat',
      pricePerDay: 125.5,
      timeSlots: ['6:00 AM - 7:00 AM'],
    });
    expect(screen.getByRole('button', { name: /Garden Hall/ })).toBeInTheDocument();
    expect(useRows).toHaveBeenCalledWith(session, 'facilities', 1);
  });

  it('disables price and submits zero when free is enabled', async () => {
    mount();
    openCreate();
    fillCreate();
    fireEvent.click(screen.getByRole('radio', { name: 'Chargeable' }));
    change('Fee per day', '500');

    fireEvent.click(screen.getByRole('radio', { name: 'Free' }));

    expect(screen.queryByLabelText('Fee per day')).not.toBeInTheDocument();
    submit();
    await waitFor(() => expect(createFacility).toHaveBeenCalledOnce());
    expect(vi.mocked(createFacility).mock.calls[0][1]).toMatchObject({
      isFree: true,
      pricePerDay: 0,
    });
  });

  it('adds and removes slot strings and rejects blank entries', async () => {
    mount();
    openCreate();
    fillCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Add time slot' }));
    change('Time slot 1', '  ');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a time for every slot');
    expect(createFacility).not.toHaveBeenCalled();
    change('Time slot 1', 'Morning');
    fireEvent.click(screen.getByRole('button', { name: 'Add time slot' }));
    change('Time slot 2', 'Evening');
    fireEvent.click(screen.getByRole('button', { name: 'Remove time slot 1' }));
    expect(screen.getByLabelText('Time slot 1')).toHaveValue('Evening');
    expect(screen.queryByLabelText('Time slot 2')).not.toBeInTheDocument();
    submit();
    await waitFor(() => expect(createFacility).toHaveBeenCalledOnce());
    expect(vi.mocked(createFacility).mock.calls[0][1].timeSlots).toEqual(['Evening']);
  });

  it.each(['', '-1'])('rejects invalid paid price %j', (price) => {
    mount();
    openCreate();
    fillCreate();
    fireEvent.click(screen.getByRole('radio', { name: 'Chargeable' }));
    change('Fee per day', price);
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a fee per day');
    expect(createFacility).not.toHaveBeenCalled();
  });

  it('edits without building reassignment or advanced controls, omitting unchanged fields', async () => {
    mount();
    openEdit();
    expect(screen.getByRole('dialog', { name: 'Edit facility' })).toBeInTheDocument();
    expect(screen.getByText('Tower A')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Building' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Availability')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/capacity|subscription|duration|admin|community/i),
    ).not.toBeInTheDocument();
    change('Facility name', '  Renamed hall  ');
    submit();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(updateFacility).toHaveBeenCalledExactlyOnceWith(session, 'hall', {
      name: 'Renamed hall',
    });
    expect(screen.getByRole('button', { name: /Renamed hall/ })).toBeInTheDocument();
    expect(facilities[0].data).toMatchObject({
      buildingId: 'tower-1',
      legacy: 'keep',
      maxCapacity: 50,
      subscriptionPackages: { monthly: 1000 },
    });
  });

  it('does not issue a write for unchanged edit values', () => {
    mount();
    openEdit();
    change('Facility name', '  Function Hall  ');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('No changes to save');
    expect(updateFacility).not.toHaveBeenCalled();
  });

  it('sends intentional optional text and slot clearing', async () => {
    mount();
    openEdit();
    change('Description (optional)', '  ');
    change('Icon name (optional)', '');
    change('Image URL (optional)', '');
    fireEvent.click(screen.getByRole('button', { name: 'Remove time slot 1' }));
    submit();
    await waitFor(() =>
      expect(updateFacility).toHaveBeenCalledExactlyOnceWith(session, 'hall', {
        description: '',
        iconName: '',
        imageUrl: '',
        timeSlots: [],
      }),
    );
  });

  it('changes a paid facility to free with a numeric zero price', async () => {
    mount();
    openEdit();
    fireEvent.click(screen.getByRole('radio', { name: 'Free' }));
    submit();
    await waitFor(() =>
      expect(updateFacility).toHaveBeenCalledExactlyOnceWith(session, 'hall', {
        isFree: true,
        pricingMode: 'free',
        pricePerDay: 0,
      }),
    );
  });
  it('creates with different owner and tenant facility fees', async () => {
    mount();

    openCreate();
    fillCreate();

    fireEvent.click(screen.getByRole('radio', { name: 'Chargeable' }));
    fireEvent.click(
      screen.getByRole('radio', {
        name: 'Different fee by resident type',
      }),
    );

    change('Owner fee per day', '100');
    change('Tenant / Lease fee per day', '150');

    submit();

    await waitFor(() =>
      expect(createFacility).toHaveBeenCalledExactlyOnceWith(
        session,
        expect.objectContaining({
          isFree: false,
          pricingMode: 'resident_type',
          pricePerDay: 0,
          ownerPricePerDay: 100,
          tenantPricePerDay: 150,
        }),
      ),
    );
  });
  it('allows a name-only edit of a legacy amenity without rewriting missing fields', async () => {
    facilities[0].data = {
      name: 'Function Hall',
      communityId: 'community-1',
      pricePerDay: 'legacy',
      timeSlots: { legacy: true },
    };
    mount();
    openEdit();
    change('Facility name', 'New hall');
    submit();
    await waitFor(() =>
      expect(updateFacility).toHaveBeenCalledExactlyOnceWith(session, 'hall', { name: 'New hall' }),
    );
  });

  it.each([
    ['Function Hall', 'Deactivate facility', 'hall', false],
    ['Pool', 'Activate facility', 'pool', true],
  ] as const)(
    '%s availability action writes and refreshes',
    async (name, button, id, available) => {
      mount();
      fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
      fireEvent.click(screen.getByRole('button', { name: button }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(setFacilityAvailability).toHaveBeenCalledExactlyOnceWith(session, id, available);
      expect(
        within(screen.getByRole('button', { name: new RegExp(name) })).getByText(
          available ? 'Active' : 'Inactive',
        ),
      ).toBeInTheDocument();
    },
  );

  it('uses isAvailable for cards, details and filters despite conflicting legacy status', () => {
    mount();
    expect(
      within(screen.getByRole('button', { name: /Function Hall/ })).getByText('Active'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: /Pool/ })).getByText('Inactive'),
    ).toBeInTheDocument();
    change('Filter by status', 'Inactive');
    expect(screen.queryByRole('button', { name: /Function Hall/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Pool/ }));
    expect(within(screen.getByRole('dialog')).getByText('Inactive')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).queryByText('active')).not.toBeInTheDocument();
  });

  it('does not change generic status behavior in other modules', () => {
    render(view(session, 'events'));
    expect(
      within(screen.getByRole('button', { name: /Function Hall/ })).getByText('inactive'),
    ).toBeInTheDocument();
  });

  it('keeps the selected status filter valid after activating the last inactive facility', async () => {
    mount();
    change('Filter by status', 'Inactive');
    fireEvent.click(screen.getByRole('button', { name: /Pool/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate facility' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Filter by status')).toHaveValue('Inactive');
    expect(screen.getByText('No matches. Try another search or status.')).toBeInTheDocument();
    change('Filter by status', 'Active');
    expect(screen.getByRole('button', { name: /Pool/ })).toBeInTheDocument();
  });

  it('shows unspecified availability for a legacy facility without the boolean flag', () => {
    delete facilities[0].data.isAvailable;
    mount();
    expect(
      within(screen.getByRole('button', { name: /Function Hall/ })).getByText('Unspecified'),
    ).toBeInTheDocument();
  });

  it.each(['create', 'edit', 'availability'] as const)(
    'keeps %s errors visible and allows retry',
    async (kind) => {
      mount();
      if (kind === 'create') {
        vi.mocked(createFacility).mockRejectedValueOnce(Error('Community access revoked.'));
        openCreate();
        fillCreate();
        submit();
      } else if (kind === 'edit') {
        vi.mocked(updateFacility).mockRejectedValueOnce(Error('Community access revoked.'));
        openEdit();
        change('Facility name', 'New hall');
        submit();
      } else {
        vi.mocked(setFacilityAvailability).mockRejectedValueOnce(
          Error('Community access revoked.'),
        );
        fireEvent.click(screen.getByRole('button', { name: /Function Hall/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Deactivate facility' }));
      }
      expect(await screen.findByRole('alert')).toHaveTextContent('Community access revoked.');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      if (kind === 'availability')
        fireEvent.click(screen.getByRole('button', { name: 'Deactivate facility' }));
      else submit();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    },
  );

  it.each(['create', 'edit'] as const)(
    'prevents duplicate %s submits and dismissal while saving',
    async (kind) => {
      const pending = deferred();
      mount();
      if (kind === 'create') {
        vi.mocked(createFacility).mockImplementationOnce(async () => {
          await pending.promise;
          return { id: 'new' } as Awaited<ReturnType<typeof createFacility>>;
        });
        openCreate();
        fillCreate();
      } else {
        vi.mocked(updateFacility).mockReturnValueOnce(pending.promise);
        openEdit();
        change('Facility name', 'New hall');
      }
      const form = screen.getByRole('form', { name: 'Facility form' });
      act(() => {
        fireEvent.submit(form);
        fireEvent.submit(form);
      });
      expect(kind === 'create' ? createFacility : updateFacility).toHaveBeenCalledOnce();
      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
      expect(screen.getByLabelText('Facility name')).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
      expect(fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))).toBe(
        false,
      );
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await act(async () => pending.resolve());
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );

  it('prevents duplicate availability submissions', async () => {
    const pending = deferred();
    vi.mocked(setFacilityAvailability).mockReturnValueOnce(pending.promise);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Function Hall/ }));
    const button = screen.getByRole('button', { name: 'Deactivate facility' });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(setFacilityAvailability).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit facility' })).toBeDisabled();
    await act(async () => pending.resolve());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['loading', 'error', 'empty'] as const)('handles building %s state', (state) => {
    buildings = {
      rows: [],
      loading: state === 'loading',
      error: state === 'error' ? 'Access denied' : '',
    };
    mount();
    openCreate();
    expect(screen.getByRole('button', { name: 'Create facility' })).toBeDisabled();
    if (state === 'loading')
      expect(screen.getByRole('option', { name: 'Loading buildings…' })).toBeInTheDocument();
    if (state === 'error')
      expect(screen.getByRole('alert')).toHaveTextContent('Unable to load buildings');
    if (state === 'empty')
      expect(screen.getByRole('status')).toHaveTextContent('No buildings are available');
  });

  it('resets the form and building options when the current community changes', () => {
    const rendered = mount();
    openCreate();
    fillCreate();
    const secondSession = { ...session, community: session.communities[1] };
    rendered.rerender(view(secondSession));
    expect(screen.getByLabelText('Facility name')).toHaveValue('');
    expect(screen.queryByRole('option', { name: 'Tower A' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Other community tower' })).toBeInTheDocument();
  });

  it('does not dismiss a new community form when an old community write finishes', async () => {
    const pending = deferred();
    vi.mocked(createFacility).mockImplementationOnce(async () => {
      await pending.promise;
      return { id: 'new' } as Awaited<ReturnType<typeof createFacility>>;
    });
    const rendered = mount();
    openCreate();
    fillCreate();
    submit();
    rendered.rerender(view({ ...session, community: session.communities[1] }));
    change('Facility name', 'New community hall');
    await act(async () => pending.resolve());
    expect(screen.getByRole('dialog', { name: 'Add facility' })).toBeInTheDocument();
    expect(screen.getByLabelText('Facility name')).toHaveValue('New community hall');
    expect(createFacility).toHaveBeenCalledOnce();
    expect(vi.mocked(createFacility).mock.calls[0][0]).toBe(session);
  });

  it('does not expose admin facility actions to a resident session', () => {
    render(view(makeSession()));
    expect(screen.queryByRole('button', { name: 'Add facility' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Function Hall/ }));
    expect(screen.queryByRole('button', { name: 'Edit facility' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate facility' })).not.toBeInTheDocument();
  });
});
