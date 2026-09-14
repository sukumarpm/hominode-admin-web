// Offline test fixtures only. Never imported by a production entry point.
import { type Session, type Data } from '../models';
import { parseCommunity, parseProfile } from '../policy';
export const adminData: Data = {
  uid: 'admin-1',
  role: 'admin',
  name: 'Test Admin',
  phoneNumber: '+639171234567',
  isActive: true,
  authorizedCommunityIds: ['community-1', 'community-2'],
};
export const residentData: Data = {
  uid: 'resident-1',
  role: 'resident',
  name: 'Test Resident',
  phoneNumber: '+639171234567',
  isActive: true,
  approvalStatus: 'approved',
  status: 'active',
  communityId: 'community-1',
  residentType: 'tenant',
  identityVerified: true,
  identityVerificationStatus: 'verified',
  buildingId: 'tower-1',
  flatId: 'unit-1',
  flatLabel: 'Tower A · 1203',
};
export const community = parseCommunity('community-1', {
  name: 'Green Valley',
  slug: 'green-valley',
  isActive: true,
});
export const secondCommunity = parseCommunity('community-2', {
  name: 'Sunridge',
  slug: 'sunridge',
  isActive: true,
});
export function makeSession(role: 'admin' | 'resident' = 'resident'): Session {
  const data = role === 'admin' ? adminData : residentData;
  const p = parseProfile(String(data.uid), data, role, '+639171234567');
  return {
    uid: p.uid,
    role,
    profile: p,
    community,
    communities: role === 'admin' ? [community, secondCommunity] : [community],
  };
}
