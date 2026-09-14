import {
  type Community,
  type Data,
  type Profile,
  type Session,
  first,
  str,
  strings,
} from './models';
export const reserved = new Set(
  'admin about api app assets auth c cdn contact docs features firebase help home legal login mail pricing privacy resident static status support super-admin terms www'.split(
    ' ',
  ),
);
export const validSlug = (s: string) =>
  s.length >= 3 && s.length <= 63 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && !reserved.has(s);
export function parseCommunity(id: string, d: Data): Community {
  if (!id || d.isActive !== true || !str(d.name)) throw Error('This community is unavailable.');
  return {
    id,
    name: str(d.name),
    slug: str(d.slug),
    isActive: true,
    ownerIdentityVerificationRequired: d.ownerIdentityVerificationRequired === true,
    data: d,
  };
}
export function parseProfile(
  uid: string,
  d: Data,
  appRole: 'admin' | 'resident',
  phone: string,
): Profile {
  if (d.isActive !== true)
    throw Error('Your account is inactive. Contact your community administrator.');
  if (d.uid !== uid) throw Error('Your profile identity could not be verified.');
  if (!phone || str(d.phoneNumber) !== phone)
    throw Error('Your profile does not match this verified phone account.');
  if (appRole === 'admin' && d.role !== 'admin' && d.role !== 'superAdmin')
    throw Error('An administrator account is required.');
  if (appRole === 'resident' && d.role !== 'resident')
    throw Error('A resident account is required.');
  const ids = strings(d.authorizedCommunityIds);
  if (d.role === 'admin' && !ids.length)
    throw Error('No communities are authorized for this administrator.');
  if (
    d.role === 'resident' &&
    (d.approvalStatus !== 'approved' ||
      ('status' in d && d.status !== 'active') ||
      !str(d.communityId))
  )
    throw Error('Your resident account must be active and approved.');
  return {
    uid,
    role: d.role as Profile['role'],
    name: first(d, ['name', 'fullName', 'displayName'], appRole === 'admin' ? 'Admin' : 'Resident'),
    phoneNumber: phone,
    communityId: str(d.communityId),
    flatId: str(d.flatId),
    buildingId: str(d.buildingId),
    flatLabel: first(d, ['flatLabel', 'flatNumber']),
    authorizedCommunityIds: ids,
    data: d,
  };
}
export function assertResident(p: Profile, c: Community, slug?: string) {
  if (
    p.role !== 'resident' ||
    p.communityId !== c.id ||
    !c.isActive ||
    (slug !== undefined && c.slug !== slug)
  )
    throw Error('This account does not belong to the selected community.');
  const d = p.data;
  const type = 'residentType' in d ? d.residentType : d.ownershipType;
  if (
    !['owner', 'tenant'].includes(str(type)) ||
    ('ownershipType' in d && d.ownershipType !== type)
  )
    throw Error('Your owner or tenant classification needs review.');
  if (
    (type === 'tenant' || c.ownerIdentityVerificationRequired) &&
    (d.identityVerified !== true || d.identityVerificationStatus !== 'verified')
  )
    throw Error(
      'Identity verification is required. Continue verification in the Resident mobile app.',
    );
  if (!p.flatId || !p.buildingId || d.occupancyStatus === 'moved_out')
    throw Error('Your unit assignment needs review. Contact your community administrator.');
}
export function selectCommunity(s: Session, id: string): Session {
  const community = s.communities.find((c) => c.id === id && c.isActive);
  if (s.role !== 'admin' || !s.profile.authorizedCommunityIds.includes(id) || !community)
    throw Error('That community is not authorized.');
  return { ...s, community };
}
export function assertScope(s: Session) {
  if (!s.community || !s.community.isActive) throw Error('Select an authorized community.');
  if (s.role === 'admin' && !s.profile.authorizedCommunityIds.includes(s.community.id))
    throw Error('Community access denied.');
  if (s.role === 'resident') assertResident(s.profile, s.community);
  if (s.role === 'superAdmin')
    throw Error('Platform accounts cannot access operational tenant data.');
  return s.community.id;
}
