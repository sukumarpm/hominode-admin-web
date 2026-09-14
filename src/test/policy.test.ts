import { describe, it, expect } from 'vitest';
import {
  assertResident,
  assertScope,
  parseProfile,
  parseCommunity,
  selectCommunity,
  validSlug,
} from '../policy';
import { adminData, residentData, community, makeSession, secondCommunity } from './fixtures';
import { querySpec } from '../data';
import { firebaseConfig } from '../firebase';
describe('canonical access policy', () => {
  it('accepts verified resident and active assigned admin', () => {
    expect(() => assertResident(makeSession().profile, community, 'green-valley')).not.toThrow();
    expect(assertScope(makeSession('admin'))).toBe('community-1');
  });
  it.each(['role', 'uid', 'isActive', 'phoneNumber'])(
    'fails closed for invalid admin %s',
    (field) => {
      expect(() =>
        parseProfile('admin-1', { ...adminData, [field]: 'invalid' }, 'admin', '+639171234567'),
      ).toThrow();
    },
  );
  it('rejects unassigned admin', () =>
    expect(() =>
      parseProfile(
        'admin-1',
        { ...adminData, authorizedCommunityIds: [] },
        'admin',
        '+639171234567',
      ),
    ).toThrow());
  it.each([
    { approvalStatus: 'pending' },
    { approvalStatus: undefined },
    { isActive: false },
    { status: 'blocked' },
    { uid: 'another-user' },
    { role: 'admin' },
  ])('rejects ineligible resident profile %j', (overrides) =>
    expect(() =>
      parseProfile('resident-1', { ...residentData, ...overrides }, 'resident', '+639171234567'),
    ).toThrow(),
  );
  it.each([
    { identityVerified: false },
    { identityVerificationStatus: 'pending' },
    { residentType: 'tenant', ownershipType: 'owner' },
    { residentType: 'unknown' },
    { flatId: '' },
    { occupancyStatus: 'moved_out' },
  ])('rejects resident lifecycle or identity mismatch %j', (overrides) => {
    const p = parseProfile(
      'resident-1',
      { ...residentData, ...overrides },
      'resident',
      '+639171234567',
    );
    expect(() => assertResident(p, community)).toThrow();
  });
  it('requires owner identity only when community policy requires it', () => {
    const p = parseProfile(
      'resident-1',
      { ...residentData, residentType: 'owner', identityVerified: false },
      'resident',
      '+639171234567',
    );
    expect(() => assertResident(p, community)).not.toThrow();
    expect(() =>
      assertResident(p, { ...community, ownerIdentityVerificationRequired: true }),
    ).toThrow();
  });
  it('rejects cross tenant and incorrect URL slug', () => {
    expect(() => assertResident(makeSession().profile, secondCommunity)).toThrow();
    expect(() => assertResident(makeSession().profile, community, 'sunridge')).toThrow();
  });
  it('only permits switching to assigned active communities', () => {
    expect(selectCommunity(makeSession('admin'), 'community-2').community?.name).toBe('Sunridge');
    expect(() => selectCommunity(makeSession('admin'), 'community-3')).toThrow();
    expect(() => selectCommunity(makeSession(), 'community-2')).toThrow();
  });
  it('rejects inactive communities', () =>
    expect(() =>
      parseCommunity('community-1', { name: 'Green Valley', isActive: false }),
    ).toThrow());
  it.each([
    'admin',
    'login',
    'ab',
    'Green-Valley',
    'green--valley',
    '../green-valley',
    'green-valley/visitors',
    'a'.repeat(64),
  ])('rejects noncanonical slug %s', (slug) => expect(validSlug(slug)).toBe(false));
  it('accepts canonical slugs', () => expect(validSlug('green-valley')).toBe(true));
});
describe('query boundaries', () => {
  it('scopes every operational admin collection', () => {
    for (const module of [
      'visitors',
      'complaints',
      'residents',
      'units',
      'billing',
      'payments',
      'bookings',
      'facilities',
      'deliveries',
      'parking',
      'vehicles',
    ] as const)
      expect(querySpec(makeSession('admin'), module).filters).toContainEqual([
        'communityId',
        '==',
        'community-1',
      ]);
  });
  it('uses hostUserId for resident visitors and both canonical owner fields for complaints', () => {
    expect(querySpec(makeSession(), 'visitors').filters).toContainEqual([
      'hostUserId',
      '==',
      'resident-1',
    ]);
    expect(querySpec(makeSession(), 'complaints').filters).toEqual(
      expect.arrayContaining([
        ['userId', '==', 'resident-1'],
        ['residentId', '==', 'resident-1'],
        ['flatId', '==', 'unit-1'],
      ]),
    );
  });
  it('scopes bills by assigned unit and chats by participant', () => {
    expect(querySpec(makeSession(), 'billing').filters).toContainEqual(['flatId', '==', 'unit-1']);
    expect(querySpec(makeSession(), 'messages').filters).toContainEqual([
      'participantIds',
      'array-contains',
      'resident-1',
    ]);
  });
  it('uses callable discovery for resident notices', () =>
    expect(querySpec(makeSession(), 'notices').notices).toBe(true));
  it('restricts inbox to canonical recipient role and app', () =>
    expect(querySpec(makeSession(), 'notifications').filters).toEqual(
      expect.arrayContaining([
        ['recipientId', '==', 'resident-1'],
        ['audience', '==', 'resident'],
        ['role', '==', 'resident'],
        ['appId', '==', 'resident'],
      ]),
    ));
  it('does not treat platform administrator as operational administrator', () => {
    const s = makeSession('admin');
    s.role = 'superAdmin';
    expect(() => querySpec(s, 'visitors')).toThrow();
    expect(querySpec(s, 'communities').collection).toBe('communities');
  });
  it('refuses unknown resident delivery ownership', () =>
    expect(() => querySpec(makeSession(), 'deliveries')).toThrow());
});
it('pins Firebase to the existing production project', () => {
  expect(firebaseConfig({}).projectId).toBe('hominode-prod');
  expect(firebaseConfig({}).appId).toBe('1:551984029668:web:5845083359a375d90db1f1');
});
