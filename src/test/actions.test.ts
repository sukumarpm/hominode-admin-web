import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createComplaint,
  createFacility,
  createVisitor,
  currentAuthority,
  deleteFacilityImage,
  setFacilityAvailability,
  submitProof,
  updateFacility,
  uploadFacilityImages,
} from '../actions';
import { type CreateFacilityInput, type Data, type UpdateFacilityInput } from '../models';
import { adminData, makeSession, residentData } from './fixtures';
const m = vi.hoisted(() => ({
  user: {
    uid: 'resident-1',
    phoneNumber: '+639171234567',
    getIdTokenResult: async () => ({ signInProvider: 'phone' }),
  } as {
    uid: string;
    phoneNumber: string;
    getIdTokenResult: () => Promise<{ signInProvider: string }>;
  } | null,
  profile: {} as Data,
  get: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
  downloadUrl: vi.fn(),
  deleteObject: vi.fn(),
  storageRef: vi.fn(),
  call: vi.fn(),
}));
vi.mock('../firebase', () => ({
  firebase: () => ({ auth: { currentUser: m.user }, db: {}, storage: {} }),
  call: m.call,
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => name,
  doc: (_db: unknown, col: string, id: string) => col + '/' + id,
  getDocFromServer: m.get,
  addDoc: m.add,
  updateDoc: m.update,
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  Timestamp: { fromDate: (date: Date) => date, now: () => new Date() },
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  setDoc: vi.fn(),
}));
vi.mock('firebase/storage', () => ({
  ref: m.storageRef,
  uploadBytes: m.upload,
  getDownloadURL: m.downloadUrl,
  deleteObject: m.deleteObject,
  getBlob: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  m.user = {
    uid: 'resident-1',
    phoneNumber: '+639171234567',
    getIdTokenResult: async () => ({ signInProvider: 'phone' }),
  };
  m.profile = { ...residentData };
  m.storageRef.mockImplementation((_storage: unknown, path: string) => path);
  m.downloadUrl.mockImplementation(async (path: string) => `https://storage.example/${encodeURIComponent(path)}`);
  m.deleteObject.mockResolvedValue(undefined);
  m.get.mockImplementation(async (path: string) => ({
    data: () =>
      path.startsWith('communities/')
        ? { name: 'Green Valley', slug: 'green-valley', isActive: true }
        : m.profile,
  }));
});
it('creates complaints with canonical ownership and pending status', async () => {
  await createComplaint(makeSession(), {
    title: 'Broken tap',
    description: 'Kitchen tap is leaking',
    category: 'Plumbing',
  });
  expect(m.add).toHaveBeenCalledWith(
    'complaints',
    expect.objectContaining({
      userId: 'resident-1',
      residentId: 'resident-1',
      communityId: 'community-1',
      flatId: 'unit-1',
      status: 'pending',
      category: 'plumbing',
      createdAt: 'SERVER_TIMESTAMP',
    }),
  );
});
it('creates expected visitor passes without granting entry', async () => {
  await createVisitor(makeSession(), {
    visitorName: 'Test Visitor',
    purpose: 'Friend',
    expectedArrival: '2099-09-09T12:00',
  });
  const payload = m.add.mock.calls[0][1];
  expect(payload).toEqual(
    expect.objectContaining({
      communityId: 'community-1',
      hostUserId: 'resident-1',
      flatId: 'unit-1',
      status: 'expected',
      isApproved: false,
      approvedBy: null,
      approvedAt: null,
      actualArrival: null,
      departure: null,
    }),
  );
  expect(payload.visitorPassCode).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  expect(payload.qrToken).toHaveLength(32);
  expect(payload).not.toHaveProperty('checkedInAt');
});
it('refuses stale unit assignments before writing', async () => {
  m.profile = { ...residentData, flatId: 'different-unit' };
  await expect(
    createComplaint(makeSession(), { title: 'Test', description: 'Test', category: 'other' }),
  ).rejects.toThrow('assignment changed');
  expect(m.add).not.toHaveBeenCalled();
});
it('refuses expired authentication before reading or writing data', async () => {
  m.user = null;
  await expect(currentAuthority(makeSession())).rejects.toThrow('Sign in again');
  expect(m.get).not.toHaveBeenCalled();
});
it('revalidates current admin assignments before mutations', async () => {
  const session = makeSession('admin');
  m.user = {
    uid: 'admin-1',
    phoneNumber: '+639171234567',
    getIdTokenResult: async () => ({ signInProvider: 'phone' }),
  };
  m.profile = { ...adminData, authorizedCommunityIds: ['community-2'] };
  await expect(currentAuthority(session)).rejects.toThrow('Community access revoked');
});
it('rejects invalid receipt files without uploading', async () => {
  await expect(
    submitProof(makeSession(), 'bill-1', new File(['text'], 'receipt.txt', { type: 'text/plain' })),
  ).rejects.toThrow('Choose a JPG');
  expect(m.upload).not.toHaveBeenCalled();
});

describe('facility writes', () => {
  let records: Record<string, Data | undefined>;
  const input = (): CreateFacilityInput => ({
    name: '  Function Hall  ',
    type: '  Hall  ',
    buildingId: 'tower-1',
    description: '  Shared hall  ',
    iconName: '  meeting_room  ',
    imageUrl: '  https://example.com/hall.jpg  ',
    timeSlots: ['  09:00–10:00  ', 'Evening'],
    isAvailable: true,
    isFree: false,
    pricePerDay: 150,
  });
  beforeEach(() => {
    m.user!.uid = 'admin-1';
    m.profile = { ...adminData, name: 'Current Admin' };
    records = {
      'buildings/tower-1': { communityId: 'community-1', buildingName: 'Tower A' },
      'amenities/facility-1': {
        communityId: 'community-1',
        buildingId: 'tower-1',
        buildingName: 'Tower A',
        name: 'Old hall',
        isFree: false,
        pricePerDay: 150,
        adminId: 'original-admin',
        createdAt: 'ORIGINAL_TIMESTAMP',
        maxCapacity: 50,
        allowMultipleBookings: true,
        bookingDurations: ['2 hours'],
        hasSubscriptionPackages: true,
        subscriptionPackages: { monthly: { price: 1000 } },
        legacyField: { nested: ['keep me'] },
      },
    };
    m.get.mockImplementation(async (path: string) => ({
      data: () =>
        path.startsWith('communities/')
          ? { name: 'Green Valley', slug: 'green-valley', isActive: true }
          : path.startsWith('admins/') || path.startsWith('users/')
            ? m.profile
            : records[path],
    }));
    m.add.mockResolvedValue({ id: 'new-facility' });
    m.update.mockImplementation(async (path: string, fields: Data) => {
      records[path] = { ...records[path], ...fields };
    });
  });

  it('creates in the current community with normalized fields, defaults and current attribution', async () => {
    await expect(createFacility(makeSession('admin'), input())).resolves.toEqual({
      id: 'new-facility',
    });
    expect(m.get.mock.calls.map(([path]) => path)).toEqual([
      'admins/admin-1',
      'communities/community-1',
      'buildings/tower-1',
    ]);
    expect(m.add).toHaveBeenCalledExactlyOnceWith('amenities', {
      name: 'Function Hall',
      type: 'Hall',
      buildingId: 'tower-1',
      buildingName: 'Tower A',
      description: 'Shared hall',
      iconName: 'meeting_room',
      imageUrl: 'https://example.com/hall.jpg',
      timeSlots: ['09:00–10:00', 'Evening'],
      isAvailable: true,
      isFree: false,
      pricingMode: 'flat',
      pricePerDay: 150,
      communityId: 'community-1',
      adminId: 'admin-1',
      authorId: 'admin-1',
      authorName: 'Current Admin',
      maxCapacity: 1,
      allowMultipleBookings: false,
      bookingDurations: ['1 hour'],
      hasSubscriptionPackages: false,
      subscriptionPackages: {},
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    });
    expect(m.call).not.toHaveBeenCalled();
  });

  it('ignores forged community, building name, metadata and advanced defaults on create', async () => {
    const values = {
      ...input(),
      communityId: 'community-2',
      buildingName: 'Forged',
      adminId: 'forged',
      authorId: 'forged',
      authorName: 'Forged',
      createdAt: 'forged',
      updatedAt: 'forged',
      maxCapacity: 99,
      subscriptionPackages: { forged: true },
      arbitrary: true,
    };
    await createFacility(makeSession('admin'), values);
    expect(m.add.mock.calls[0][1]).toMatchObject({
      communityId: 'community-1',
      buildingName: 'Tower A',
      adminId: 'admin-1',
      authorId: 'admin-1',
      authorName: 'Current Admin',
      maxCapacity: 1,
      subscriptionPackages: {},
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    });
    expect(m.add.mock.calls[0][1]).not.toHaveProperty('arbitrary');
  });

  it.each([
    [undefined, 'Building does not exist'],
    [{ communityId: 'community-2', name: 'Other tower' }, 'outside your community'],
    [{ name: 'Unscoped tower' }, 'outside your community'],
  ])('rejects a missing or out-of-scope building (%j)', async (building, message) => {
    records['buildings/tower-1'] = building;
    await expect(createFacility(makeSession('admin'), input())).rejects.toThrow(message);
    expect(m.add).not.toHaveBeenCalled();
  });

  it('supports legacy building names, optional text and facilities without slots', async () => {
    records['buildings/tower-1'] = { communityId: 'community-1', name: '  Legacy Tower  ' };
    const values = input();
    delete values.timeSlots;
    delete values.description;
    delete values.iconName;
    delete values.imageUrl;
    await createFacility(makeSession('admin'), values);
    expect(m.add.mock.calls[0][1]).toMatchObject({ buildingName: 'Legacy Tower', timeSlots: [] });
    expect(m.add.mock.calls[0][1]).not.toHaveProperty('description');
  });

  it('applies allowlisted partial edits while preserving ownership, metadata and advanced fields', async () => {
    const original = structuredClone(records['amenities/facility-1']);
    await updateFacility(makeSession('admin'), 'facility-1', {
      name: '  Updated hall  ',
      type: '  Event space  ',
      description: '  New description  ',
      iconName: '  event  ',
      imageUrl: '  http://example.com/new.jpg  ',
      timeSlots: ['  Anytime  '],
      isAvailable: false,
      isFree: false,
      pricingMode: 'flat',
      pricePerDay: 200,
    });
    const expected = {
      name: 'Updated hall',
      type: 'Event space',
      description: 'New description',
      iconName: 'event',
      imageUrl: 'http://example.com/new.jpg',
      timeSlots: ['Anytime'],
      isAvailable: false,
      isFree: false,
      pricingMode: 'flat',
      pricePerDay: 200,
      updatedAt: 'SERVER_TIMESTAMP',
    };
    expect(m.update).toHaveBeenCalledExactlyOnceWith('amenities/facility-1', expected);
    expect(records['amenities/facility-1']).toEqual({ ...original, ...expected });
  });

  it.each([
    'communityId',
    'buildingId',
    'buildingName',
    'adminId',
    'authorName',
    'createdAt',
    'updatedAt',
    'maxCapacity',
    'subscriptionPackages',
    'arbitrary',
    'legacyField.nested',
  ])('rejects noneditable update field %s', async (key) => {
    const values = { name: 'Hall', [key]: 'forged' };
    await expect(updateFacility(makeSession('admin'), 'facility-1', values)).rejects.toThrow(
      'not editable',
    );
    expect(m.update).not.toHaveBeenCalled();
  });

  it('allows unrelated edits to legacy documents without imposing create defaults or pricing validation', async () => {
    records['amenities/facility-1'] = {
      communityId: 'community-1',
      legacyField: 'keep',
      pricePerDay: 'legacy',
    };
    await updateFacility(makeSession('admin'), 'facility-1', { name: '  Hall  ' });
    expect(records['amenities/facility-1']).toEqual({
      communityId: 'community-1',
      legacyField: 'keep',
      pricePerDay: 'legacy',
      name: 'Hall',
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });

  it.each([true, false])(
    'toggles availability to %s with only its timestamp',
    async (available) => {
      const original = structuredClone(records['amenities/facility-1']);
      await setFacilityAvailability(makeSession('admin'), 'facility-1', available);
      expect(m.update).toHaveBeenCalledExactlyOnceWith('amenities/facility-1', {
        isAvailable: available,
        updatedAt: 'SERVER_TIMESTAMP',
      });
      expect(records['amenities/facility-1']).toEqual({
        ...original,
        isAvailable: available,
        updatedAt: 'SERVER_TIMESTAMP',
      });
    },
  );

  const targetMutations = [
    ['update', (s = makeSession('admin')) => updateFacility(s, 'facility-1', { name: 'Hall' })],
    ['availability', (s = makeSession('admin')) => setFacilityAvailability(s, 'facility-1', false)],
  ] as const;
  describe.each(targetMutations)('%s target checks', (_label, mutate) => {
    it.each([undefined, { communityId: 'community-2' }, {}])(
      'rejects a missing or foreign target (%j)',
      async (target) => {
        records['amenities/facility-1'] = target;
        await expect(mutate()).rejects.toThrow(
          target ? 'outside your community' : 'does not exist',
        );
        expect(m.update).not.toHaveBeenCalled();
      },
    );
  });
  describe.each([
    ['create', (s = makeSession('admin')) => createFacility(s, input())],
    ...targetMutations,
  ] as const)('%s authority checks', (_label, mutate) => {
    it('revalidates admin and community from the server', async () => {
      m.profile = { ...adminData, authorizedCommunityIds: ['community-2'] };
      await expect(mutate()).rejects.toThrow('Community access revoked');
      expect(m.get).toHaveBeenCalledWith('admins/admin-1');
      expect(m.get).toHaveBeenCalledWith('communities/community-1');
      expect(m.add).not.toHaveBeenCalled();
      expect(m.update).not.toHaveBeenCalled();
    });
    it('rejects unauthenticated and non-phone sessions', async () => {
      m.user!.getIdTokenResult = async () => ({ signInProvider: 'password' });
      await expect(mutate()).rejects.toThrow('Phone verification');
      m.user = null;
      await expect(mutate()).rejects.toThrow('Sign in again');
      expect(m.get).not.toHaveBeenCalled();
      expect(m.add).not.toHaveBeenCalled();
      expect(m.update).not.toHaveBeenCalled();
    });
    it('rejects resident accounts', async () => {
      m.user!.uid = 'resident-1';
      m.profile = { ...residentData };
      await expect(mutate(makeSession())).rejects.toThrow('An administrator is required');
      expect(m.add).not.toHaveBeenCalled();
      expect(m.update).not.toHaveBeenCalled();
    });
    it('rejects an admin session whose current profile became a platform account', async () => {
      m.profile = { ...adminData, role: 'superAdmin' };
      await expect(mutate()).rejects.toThrow('An administrator is required');
      expect(m.add).not.toHaveBeenCalled();
      expect(m.update).not.toHaveBeenCalled();
    });
  });

  it('writes zero price for free facilities on create and update', async () => {
    await createFacility(makeSession('admin'), { ...input(), isFree: true });
    expect(m.add.mock.calls[0][1]).toMatchObject({ isFree: true, pricePerDay: 0 });
    await updateFacility(makeSession('admin'), 'facility-1', { isFree: true, pricePerDay: 999 });
    expect(m.update).toHaveBeenLastCalledWith('amenities/facility-1', {
      isFree: true,
      pricingMode: 'free',
      pricePerDay: 0,
      updatedAt: 'SERVER_TIMESTAMP',
    });
    await updateFacility(makeSession('admin'), 'facility-1', { pricePerDay: 100 });
    expect(m.update).toHaveBeenLastCalledWith('amenities/facility-1', {
      isFree: true,
      pricingMode: 'free',
      pricePerDay: 0,
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });
  it('supports differentiated owner and tenant facility pricing', async () => {
    await createFacility(makeSession('admin'), {
      ...input(),
      pricingMode: 'resident_type',
      isFree: false,
      pricePerDay: 999,
      ownerPricePerDay: 100,
      tenantPricePerDay: 150,
    });

    expect(m.add.mock.calls[0][1]).toMatchObject({
      pricingMode: 'resident_type',
      isFree: false,
      pricePerDay: 0,
      ownerPricePerDay: 100,
      tenantPricePerDay: 150,
    });

    m.add.mockClear();
    m.update.mockClear();

    await updateFacility(makeSession('admin'), 'facility-1', {
      pricingMode: 'resident_type',
      isFree: false,
      ownerPricePerDay: 120,
      tenantPricePerDay: 175,
    });

    expect(m.update).toHaveBeenLastCalledWith('amenities/facility-1', {
      pricingMode: 'resident_type',
      isFree: false,
      pricePerDay: 0,
      ownerPricePerDay: 120,
      tenantPricePerDay: 175,
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });
  it('requires both owner and tenant prices for resident-type pricing', async () => {
    await expect(
      createFacility(makeSession('admin'), {
        ...input(),
        pricingMode: 'resident_type',
        isFree: false,
        ownerPricePerDay: 100,
      }),
    ).rejects.toThrow('Tenant price per day');

    await expect(
      createFacility(makeSession('admin'), {
        ...input(),
        pricingMode: 'resident_type',
        isFree: false,
        tenantPricePerDay: 150,
      }),
    ).rejects.toThrow('Owner price per day');

    expect(m.add).not.toHaveBeenCalled();
  });
  it('resolves partial pricing edits and requires a valid price when making legacy facilities paid', async () => {
    await updateFacility(makeSession('admin'), 'facility-1', { isFree: true });
    expect(records['amenities/facility-1']).toMatchObject({ isFree: true, pricePerDay: 0 });
    records['amenities/facility-1']!.pricePerDay = 'legacy';
    m.update.mockClear();
    await expect(
      updateFacility(makeSession('admin'), 'facility-1', { isFree: false }),
    ).rejects.toThrow('Price per day');
    expect(m.update).not.toHaveBeenCalled();
    await updateFacility(makeSession('admin'), 'facility-1', { isFree: false, pricePerDay: 250 });
    expect(records['amenities/facility-1']).toMatchObject({ isFree: false, pricePerDay: 250 });
  });

  it('accepts an ordered facility gallery and keeps legacy imageUrl synchronized to its primary image', async () => {
    const images = [
      {
        url: 'https://storage.example/primary.jpg',
        storagePath: 'facility_images/community-1/facility-1/primary.jpg',
        name: 'primary.jpg',
      },
      {
        url: 'https://storage.example/second.webp',
        storagePath: 'facility_images/community-1/facility-1/second.webp',
        name: 'second.webp',
      },
    ];

    await updateFacility(makeSession('admin'), 'facility-1', { images });

    expect(m.update).toHaveBeenCalledExactlyOnceWith('amenities/facility-1', {
      images,
      imageUrl: images[0].url,
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });

  it('clears legacy imageUrl when the ordered facility gallery is cleared', async () => {
    await updateFacility(makeSession('admin'), 'facility-1', { images: [] });
    expect(m.update).toHaveBeenCalledExactlyOnceWith('amenities/facility-1', {
      images: [],
      imageUrl: '',
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });

  it('rejects gallery metadata outside the target facility storage scope', async () => {
    await expect(
      updateFacility(makeSession('admin'), 'facility-1', {
        images: [
          {
            url: 'https://storage.example/wrong.jpg',
            storagePath: 'facility_images/community-2/facility-1/wrong.jpg',
          },
        ],
      }),
    ).rejects.toThrow('outside this facility');
    expect(m.update).not.toHaveBeenCalled();
  });

  it('uploads multiple validated facility images into the facility storage scope', async () => {
    const files = [
      new File(['jpg'], 'front.jpg', { type: 'image/jpeg' }),
      new File(['webp'], 'inside.webp', { type: 'image/webp' }),
    ];

    const result = await uploadFacilityImages(makeSession('admin'), 'facility-1', files);

    expect(m.upload).toHaveBeenCalledTimes(2);
    expect(m.downloadUrl).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: 'front.jpg' });
    expect(result[1]).toMatchObject({ name: 'inside.webp' });
    for (const image of result)
      expect(image.storagePath).toMatch(/^facility_images\/community-1\/facility-1\/.+\.(jpg|webp)$/);
    expect(result.every((image) => image.url.startsWith('https://storage.example/'))).toBe(true);
  });

  it.each([
    new File(['gif'], 'animated.gif', { type: 'image/gif' }),
    new File([], 'empty.jpg', { type: 'image/jpeg' }),
  ])('rejects unsupported or empty facility image files before uploading', async (file) => {
    await expect(uploadFacilityImages(makeSession('admin'), 'facility-1', [file])).rejects.toThrow(
      'JPG, PNG or WebP',
    );
    expect(m.upload).not.toHaveBeenCalled();
  });

  it('rejects more than six facility images before uploading', async () => {
    const files = Array.from(
      { length: 7 },
      (_, index) => new File(['x'], `${index}.jpg`, { type: 'image/jpeg' }),
    );
    await expect(uploadFacilityImages(makeSession('admin'), 'facility-1', files)).rejects.toThrow(
      'at most 6 images',
    );
    expect(m.upload).not.toHaveBeenCalled();
  });

  it('deletes only storage objects belonging to the selected facility', async () => {
    const image = {
      url: 'https://storage.example/photo.jpg',
      storagePath: 'facility_images/community-1/facility-1/photo.jpg',
      name: 'photo.jpg',
    };
    await deleteFacilityImage(makeSession('admin'), 'facility-1', image);
    expect(m.deleteObject).toHaveBeenCalledExactlyOnceWith(image.storagePath);

    m.deleteObject.mockClear();
    await expect(
      deleteFacilityImage(makeSession('admin'), 'facility-1', {
        ...image,
        storagePath: 'facility_images/community-1/other-facility/photo.jpg',
      }),
    ).rejects.toThrow('outside this facility');
    expect(m.deleteObject).not.toHaveBeenCalled();
  });

  const invalidFields: [string, unknown][] = [
    ['name', '  '],
    ['name', null],
    ['type', ''],
    ['type', 1],
    ['description', null],
    ['iconName', 42],
    ['timeSlots', 'Morning'],
    ['timeSlots', ['']],
    ['timeSlots', ['  ']],
    ['timeSlots', [42]],
    ['timeSlots', new Array(1)],
    ['imageUrl', 'ftp://example.com/a'],
    ['imageUrl', 'javascript:alert(1)'],
    ['imageUrl', 'https://'],
    ['imageUrl', '/relative.jpg'],
    ['imageUrl', 'https:example.com'],
    ['images', 'not-an-array'],
    ['images', new Array(7).fill({ url: 'https://example.com/a.jpg', storagePath: 'facility_images/community-1/facility-1/a.jpg' })],
    ['images', [{ url: '/relative.jpg', storagePath: 'facility_images/community-1/facility-1/a.jpg' }]],
    ['images', [{ url: 'https://example.com/a.jpg', storagePath: '../outside.jpg' }]],
    ['isFree', 'true'],
    ['isAvailable', 1],
    ['pricePerDay', -1],
    ['pricePerDay', NaN],
    ['pricePerDay', Infinity],
    ['pricePerDay', '10'],
  ];
  it.each(['name', 'type', 'buildingId', 'isAvailable', 'isFree', 'pricePerDay'])(
    'requires %s on create',
    async (key) => {
      const values: Data = { ...input() };
      delete values[key];
      await expect(
        createFacility(makeSession('admin'), values as unknown as CreateFacilityInput),
      ).rejects.toThrow();
      expect(m.add).not.toHaveBeenCalled();
    },
  );
  it.each(invalidFields)('rejects invalid %s = %j on create and update', async (key, value) => {
    await expect(
      createFacility(makeSession('admin'), { ...input(), [key]: value } as CreateFacilityInput),
    ).rejects.toThrow();
    await expect(
      updateFacility(makeSession('admin'), 'facility-1', { [key]: value } as UpdateFacilityInput),
    ).rejects.toThrow();
    expect(m.add).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });
  it.each(['', '  ', 'tower/other', '.', '..', '__reserved__', null, 42])(
    'rejects invalid building ID %j',
    async (buildingId) => {
      await expect(
        createFacility(makeSession('admin'), { ...input(), buildingId } as CreateFacilityInput),
      ).rejects.toThrow('Building ID');
      expect(m.add).not.toHaveBeenCalled();
    },
  );
  it('accepts blank optional strings and empty slots to clear values', async () => {
    await updateFacility(makeSession('admin'), 'facility-1', {
      description: ' ',
      iconName: '',
      imageUrl: '  ',
      timeSlots: [],
    });
    expect(m.update).toHaveBeenCalledWith('amenities/facility-1', {
      description: '',
      iconName: '',
      imageUrl: '',
      timeSlots: [],
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });
  it('rejects non-boolean availability', async () => {
    await expect(
      setFacilityAvailability(makeSession('admin'), 'facility-1', 'false' as unknown as boolean),
    ).rejects.toThrow('boolean');
    expect(m.update).not.toHaveBeenCalled();
  });
});
