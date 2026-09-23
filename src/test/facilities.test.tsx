import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFacility,
  deleteFacilityImage,
  setFacilityAvailability,
  updateFacility,
  uploadFacilityImages,
} from '../actions';
import { querySpec, useRows, type Module, type Resource } from '../data';
import { type FacilityImage, type Row, type Session } from '../models';
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
  uploadFacilityImages: vi.fn(),
  deleteFacilityImage: vi.fn(),
}));
vi.mock('../data', async () => ({
  ...(await vi.importActual<typeof import('../data')>('../data')),
  useRows: vi.fn(),
}));

vi.mock('../subscriptionContext', () => ({
  useSubscription: () => ({
    entitlement: {
      communityId: 'community-1',
      planId: 'plus',
      planName: 'Plus',
      status: 'active',
      startsAtMs: null,
      endsAtMs: null,
      features: {
        facilityDirectory: true,
        facilityBooking: true,
        events: true,
        communityWall: true,
      },
      limits: {},
      schemaVersion: 1,
    },
    loading: false,
    error: '',
  }),
  SubscriptionProvider: ({ children }: { children: ReactNode }) => children,
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

function change(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });
}

function fillCreate() {
  change('Facility name', '  Garden Hall  ');
  change('Facility type', 'Function Hall');
  change('Building', 'tower-1');
}

function submit() {
  fireEvent.submit(screen.getByRole('form', { name: 'Facility form' }));
}

function facilityCard(name: string) {
  const heading = screen.getByRole('heading', { name });
  const card = heading.closest('article');
  if (!card) throw Error(`Facility card not found: ${name}`);
  return card;
}

function openEdit(name = 'Function Hall') {
  fireEvent.click(within(facilityCard(name)).getByRole('button', { name: 'Edit Facility' }));
}

function openDetails(name = 'Function Hall') {
  const target = facilityCard(name).querySelector('.facility-image-v2');
  if (!target) throw Error(`Facility image target not found: ${name}`);
  fireEvent.click(target);
}

function selectFacilityPhotos(files: File[]) {
  fireEvent.change(screen.getByLabelText('Facility photos'), {
    target: { files },
  });
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
    if (module === 'buildings') {
      return {
        ...buildings,
        rows: buildings.rows.filter((row) => row.data.communityId === s.community?.id),
      };
    }
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

  vi.mocked(uploadFacilityImages).mockImplementation(async (_s, facilityId, files) =>
    files.map((file, index) => ({
      url: `https://example.com/${facilityId}/${index}-${file.name}`,
      storagePath: `facility_images/community-1/${facilityId}/${index}-${file.name}`,
      name: file.name,
    })),
  );
  vi.mocked(deleteFacilityImage).mockResolvedValue(undefined);
});

describe('Facilities page', () => {
  it('offers the predefined facility types and submits Gym as a string', async () => {
    mount();
    openCreate();
    fillCreate();

    const dropdown = screen.getByRole('combobox', { name: /Facility type/i });
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
    expect(screen.queryByLabelText(/Custom facility type/i)).not.toBeInTheDocument();
    submit();

    await waitFor(() => expect(createFacility).toHaveBeenCalledOnce());
    expect(vi.mocked(createFacility).mock.calls[0][1].type).toBe('Gym');
  });

  it.each(['', '   '])('rejects a blank custom facility type (%j)', (customType) => {
    mount();
    openCreate();
    fillCreate();
    change('Facility type', 'Other');

    expect(screen.getByRole('textbox', { name: /Custom facility type/i })).toBeInTheDocument();
    change('Custom facility type', customType);
    submit();

    expect(screen.getByRole('alert')).toHaveTextContent('Specify a facility type');
    expect(createFacility).not.toHaveBeenCalled();
  });

  it('submits a trimmed custom facility type', async () => {
    mount();
    openCreate();
    fillCreate();
    change('Facility type', 'Other');
    change('Custom facility type', '  Yoga Studio  ');
    submit();

    await waitFor(() => expect(createFacility).toHaveBeenCalledOnce());
    expect(vi.mocked(createFacility).mock.calls[0][1].type).toBe('Yoga Studio');
  });

  it('opens an existing custom type under Other and preserves it on an unrelated edit', async () => {
    facilities[0].data.type = 'Yoga Studio';
    mount();
    openEdit();

    expect(screen.getByRole('combobox', { name: /Facility type/i })).toHaveValue('Other');
    expect(screen.getByLabelText(/Custom facility type/i)).toHaveValue('Yoga Studio');
    change('Description', 'New description');
    submit();

    await waitFor(() =>
      expect(updateFacility).toHaveBeenCalledExactlyOnceWith(session, 'hall', {
        description: 'New description',
      }),
    );
    expect(facilities[0].data.type).toBe('Yoga Studio');
  });

  it('keeps the facilities page controls and create modal behavior', () => {
    mount();
    expect(screen.getByRole('link', { name: /^Bookings$/ })).toHaveAttribute('href', '/bookings');
    expect(screen.getByRole('textbox', { name: 'Search facilities' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeInTheDocument();

    openCreate();
    expect(screen.getByRole('dialog', { name: 'Add facility' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
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

  it('validates required create fields without submitting', () => {
    mount();
    openCreate();
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

  it('creates with the redesigned typed fields and refreshes the list', async () => {
    mount();
    openCreate();
    fillCreate();
    change('Description', '  Community events  ');
    change('Icon name', '  event  ');
    fireEvent.click(screen.getByRole('button', { name: /Paid facility/i }));
    change('Fee per day', '125.5');
    fireEvent.click(screen.getByRole('button', { name: 'Inactive' }));

    fireEvent.click(screen.getByRole('button', { name: /Add first slot/i }));
    change('Start', '06:00');
    change('End', '07:00');
    submit();

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(createFacility).toHaveBeenCalledExactlyOnceWith(session, {
      name: 'Garden Hall',
      type: 'Function Hall',
      buildingId: 'tower-1',
      description: 'Community events',
      iconName: 'event',
      isAvailable: false,
      isFree: false,
      pricingMode: 'flat',
      pricePerDay: 125.5,
      timeSlots: ['6:00 AM - 7:00 AM'],
    });
    expect(screen.getByRole('heading', { name: 'Garden Hall' })).toBeInTheDocument();
    expect(useRows).toHaveBeenCalledWith(session, 'facilities', 1);
  });

  it('switches a paid create form back to free and submits zero price', async () => {
    mount();
    openCreate();
    fillCreate();

    fireEvent.click(screen.getByRole('button', { name: /Paid facility/i }));
    change('Fee per day', '500');
    fireEvent.click(screen.getByRole('button', { name: /Free facility/i }));

    expect(screen.queryByLabelText(/Fee per day/i)).not.toBeInTheDocument();
    submit();
    await waitFor(() => expect(createFacility).toHaveBeenCalledOnce());
    expect(vi.mocked(createFacility).mock.calls[0][1]).toMatchObject({
      isFree: true,
      pricePerDay: 0,
    });
  });

  it('validates custom slot start/end values and serializes valid slots', async () => {
    mount();
    openCreate();
    fillCreate();

    fireEvent.click(screen.getByRole('button', { name: /Add first slot/i }));
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Complete the start and end time');
    expect(createFacility).not.toHaveBeenCalled();

    change('Start', '06:00');
    change('End', '07:00');
    submit();
    await waitFor(() => expect(createFacility).toHaveBeenCalledOnce());
    expect(vi.mocked(createFacility).mock.calls[0][1].timeSlots).toEqual(['6:00 AM - 7:00 AM']);
  });

  it.each(['', '-1'])('rejects invalid paid price %j', (price) => {
    mount();
    openCreate();
    fillCreate();
    fireEvent.click(screen.getByRole('button', { name: /Paid facility/i }));
    change('Fee per day', price);
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a fee per day');
    expect(createFacility).not.toHaveBeenCalled();
  });

  it('creates with different owner and tenant facility fees', async () => {
    mount();
    openCreate();
    fillCreate();
    fireEvent.click(screen.getByRole('button', { name: /Paid facility/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Fee by resident type' }));
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

  it('edits without building reassignment and omits unchanged fields', async () => {
    mount();
    openEdit();

    const dialog = screen.getByRole('dialog', { name: 'Edit facility' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getAllByText('Tower A').length).toBeGreaterThan(0);
    expect(screen.queryByRole('combobox', { name: /^Building/i })).not.toBeInTheDocument();

    change('Facility name', '  Renamed hall  ');
    submit();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(updateFacility).toHaveBeenCalledExactlyOnceWith(session, 'hall', {
      name: 'Renamed hall',
    });
    expect(screen.getByRole('heading', { name: 'Renamed hall' })).toBeInTheDocument();
    expect(facilities[0].data).toMatchObject({
      buildingId: 'tower-1',
      legacy: 'keep',
      maxCapacity: 50,
      subscriptionPackages: { monthly: 1000 },
    });
  });

  it('does not issue a write for an unchanged edit', () => {
    mount();
    openEdit();
    change('Facility name', '  Function Hall  ');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('No changes to save');
    expect(updateFacility).not.toHaveBeenCalled();
  });

  it('clears optional text and time slots without rewriting the legacy imageUrl', async () => {
    mount();
    openEdit();
    change('Description', '  ');
    change('Icon name', '');
    fireEvent.click(screen.getByRole('button', { name: 'Remove time slot 1' }));
    submit();

    await waitFor(() =>
      expect(updateFacility).toHaveBeenCalledExactlyOnceWith(session, 'hall', {
        description: '',
        iconName: '',
        timeSlots: [],
      }),
    );
  });

  it('changes a paid facility to free with a numeric zero price', async () => {
    mount();
    openEdit();
    fireEvent.click(screen.getByRole('button', { name: /Free facility/i }));
    submit();

    await waitFor(() =>
      expect(updateFacility).toHaveBeenCalledExactlyOnceWith(session, 'hall', {
        isFree: true,
        pricingMode: 'free',
        pricePerDay: 0,
      }),
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

  it('shows a legacy imageUrl in the edit form without converting it until the gallery changes', () => {
    mount();
    openEdit();
    expect(screen.getByAltText('Existing facility')).toHaveAttribute(
      'src',
      'https://example.com/hall.jpg',
    );
    expect(screen.getByText('Existing primary image')).toBeInTheDocument();
  });

  it('removes a legacy imageUrl by saving an empty managed gallery', async () => {
    mount();
    openEdit();
    fireEvent.click(
      within(screen.getByText('Existing primary image').parentElement!.parentElement!).getByRole(
        'button',
        { name: 'Remove' },
      ),
    );
    submit();

    await waitFor(() =>
      expect(updateFacility).toHaveBeenCalledExactlyOnceWith(session, 'hall', { images: [] }),
    );
  });

  it('selects multiple images, marks the first primary and uploads them after creating the facility', async () => {
    mount();
    openCreate();
    fillCreate();

    const first = new File(['one'], 'front.jpg', { type: 'image/jpeg' });
    const second = new File(['two'], 'inside.webp', { type: 'image/webp' });
    selectFacilityPhotos([first, second]);

    expect(screen.getByText('2/6')).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set primary' })).toBeInTheDocument();

    submit();
    await waitFor(() => expect(createFacility).toHaveBeenCalledOnce());
    await waitFor(() => expect(uploadFacilityImages).toHaveBeenCalledOnce());

    expect(uploadFacilityImages).toHaveBeenCalledWith(session, 'new', [first, second]);
    expect(updateFacility).toHaveBeenCalledWith(session, 'new', {
      images: [
        {
          url: 'https://example.com/new/0-front.jpg',
          storagePath: 'facility_images/community-1/new/0-front.jpg',
          name: 'front.jpg',
        },
        {
          url: 'https://example.com/new/1-inside.webp',
          storagePath: 'facility_images/community-1/new/1-inside.webp',
          name: 'inside.webp',
        },
      ],
    });
  });

  it('rejects more than six selected facility photos in the UI', () => {
    mount();
    openCreate();
    const files = Array.from(
      { length: 7 },
      (_, index) => new File(['x'], `photo-${index}.jpg`, { type: 'image/jpeg' }),
    );
    selectFacilityPhotos(files);

    expect(screen.getByRole('alert')).toHaveTextContent('at most 6 images');
    expect(screen.getByText('0/6')).toBeInTheDocument();
  });

  it('reorders an existing managed gallery when another image is made primary', async () => {
    const firstImage: FacilityImage = {
      url: 'https://example.com/first.jpg',
      storagePath: 'facility_images/community-1/hall/first.jpg',
    };
    const secondImage: FacilityImage = {
      url: 'https://example.com/second.jpg',
      storagePath: 'facility_images/community-1/hall/second.jpg',
    };
    facilities[0].data.images = [firstImage, secondImage];
    facilities[0].data.imageUrl = firstImage.url;

    mount();
    openEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Set primary' }));
    submit();

    await waitFor(() =>
      expect(updateFacility).toHaveBeenCalledExactlyOnceWith(session, 'hall', {
        images: [secondImage, firstImage],
      }),
    );
  });

  it('shows the primary image on the card and the full gallery in facility details', () => {
    facilities[0].data.images = [
      {
        url: 'https://example.com/hall.jpg',
        storagePath: 'facility_images/community-1/hall/front.jpg',
      },
      {
        url: 'https://example.com/inside.jpg',
        storagePath: 'facility_images/community-1/hall/inside.jpg',
      },
    ];

    mount();
    const card = facilityCard('Function Hall');
    expect(within(card).getByText('1 / 2')).toBeInTheDocument();
    expect(within(card).getByAltText('Function Hall')).toHaveAttribute(
      'src',
      'https://example.com/hall.jpg',
    );

    openDetails();
    expect(screen.getByRole('region', { name: 'Function Hall photos' })).toBeInTheDocument();
    expect(screen.getByAltText('Function Hall photo 1')).toHaveAttribute(
      'src',
      'https://example.com/hall.jpg',
    );
    fireEvent.click(screen.getByRole('button', { name: 'View facility photo 2' }));
    expect(screen.getByAltText('Function Hall photo 2')).toHaveAttribute(
      'src',
      'https://example.com/inside.jpg',
    );
  });

  it.each([
    ['Function Hall', 'Deactivate facility', 'hall', false],
    ['Pool', 'Activate facility', 'pool', true],
  ] as const)(
    '%s availability action writes and refreshes',
    async (name, button, id, available) => {
      mount();
      openDetails(name);
      fireEvent.click(screen.getByRole('button', { name: button }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      expect(setFacilityAvailability).toHaveBeenCalledExactlyOnceWith(session, id, available);
      expect(
        within(facilityCard(name)).getByText(available ? 'Active' : 'Inactive'),
      ).toBeInTheDocument();
    },
  );

  it('uses isAvailable for cards, details and filters despite conflicting legacy status', () => {
    mount();
    expect(within(facilityCard('Function Hall')).getByText('Active')).toBeInTheDocument();
    expect(within(facilityCard('Pool')).getByText('Inactive')).toBeInTheDocument();

    change('Filter by status', 'Inactive');
    expect(screen.queryByRole('heading', { name: 'Function Hall' })).not.toBeInTheDocument();
    openDetails('Pool');
    expect(within(screen.getByRole('dialog')).getByText('Inactive')).toBeInTheDocument();
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
    openDetails('Pool');
    fireEvent.click(screen.getByRole('button', { name: 'Activate facility' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(screen.getByLabelText('Filter by status')).toHaveValue('Inactive');
    expect(screen.getByText('No matches. Try another search or status.')).toBeInTheDocument();
    change('Filter by status', 'Active');
    expect(screen.getByRole('heading', { name: 'Pool' })).toBeInTheDocument();
  });

  it('shows unspecified availability for a legacy facility without the boolean flag', () => {
    delete facilities[0].data.isAvailable;
    mount();
    expect(within(facilityCard('Function Hall')).getByText('Unspecified')).toBeInTheDocument();
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
        openDetails();
        fireEvent.click(screen.getByRole('button', { name: 'Deactivate facility' }));
      }

      expect(await screen.findByRole('alert')).toHaveTextContent('Community access revoked.');
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      if (kind === 'availability') {
        fireEvent.click(screen.getByRole('button', { name: 'Deactivate facility' }));
      } else {
        submit();
      }
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
      expect(screen.getByLabelText(/Facility name/i)).toBeDisabled();
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
    openDetails();

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

    expect(screen.getByLabelText(/Facility name/i)).toHaveValue('');
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
    expect(screen.getByLabelText(/Facility name/i)).toHaveValue('New community hall');
    expect(createFacility).toHaveBeenCalledOnce();
    expect(vi.mocked(createFacility).mock.calls[0][0]).toBe(session);
  });

  it('does not expose admin facility actions to a resident session', () => {
    render(view(makeSession()));
    expect(screen.queryByRole('button', { name: 'Add facility' })).not.toBeInTheDocument();

    openDetails();
    expect(screen.queryByRole('button', { name: 'Edit facility' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate facility' })).not.toBeInTheDocument();
  });
});
