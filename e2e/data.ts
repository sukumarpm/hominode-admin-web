import { type Row, type Session } from '../src/models';
export { safeUrl, titleOf } from '../src/data';
export type { Resource, Module } from '../src/data';
import { type Module, type Resource } from '../src/data';
const at = new Date('2026-09-02T10:24:00');
export function useRows(s: Session, module: Module): Resource {
  const fixtures: Partial<Record<Module, Record<string, unknown>[]>> = {
    residents: [
      {
        name: 'Alex Resident',
        phoneNumber: '+639170000001',
        flatLabel: 'Tower A · 1203',
        isActive: true,
        role: 'resident',
      },
    ],
    visitors: [
      {
        visitorName: 'Rohit Sharma',
        purpose: 'Friend',
        flatLabel: 'Tower A · 1203',
        status: 'expected',
      },
      {
        visitorName: 'Priya Nair',
        purpose: 'House help',
        status: 'approved',
        flatLabel: 'Tower B · 804',
      },
    ],
    complaints: [
      {
        title: 'AC repair request',
        description: 'Air conditioning service',
        category: 'maintenance',
        status: 'inprogress',
        flatLabel: 'Tower A · 703',
      },
      {
        title: 'Plumbing issue',
        description: 'Water leakage in the kitchen',
        status: 'pending',
        flatLabel: 'Tower C · 1001',
      },
    ],
    billing: [
      {
        title: 'September maintenance',
        amount: 4800,
        status: 'pending',
        flatLabel: 'Tower A · 1203',
      },
      { title: 'August maintenance', amount: 4800, status: 'paid', flatLabel: 'Tower A · 1203' },
      { title: 'July maintenance', amount: 3500, status: 'overdue', flatLabel: 'Tower B · 804' },
    ],
    units: [
      { flatLabel: 'Tower A · 1203', status: 'occupied' },
      { flatLabel: 'Tower B · 804', status: 'vacant' },
      { flatLabel: 'Tower C · 1001', status: 'occupied' },
    ],
    notices: [
      {
        title: 'Swimming pool maintenance',
        content: 'The pool will be closed from 10 AM to 2 PM for routine maintenance.',
        status: 'published',
      },
      {
        title: 'Monthly society meeting',
        content: 'All residents are requested to attend.',
        status: 'published',
      },
    ],
    bookings: [
      { amenityName: 'Function Hall', date: at, status: 'confirmed' },
      { amenityName: 'Swimming Pool', date: at, status: 'confirmed' },
      { amenityName: 'Badminton Court', date: at, status: 'pending' },
    ],
    facilities: [
      {
        name: 'Function Hall',
        description: 'A space for community celebrations.',
        status: 'active',
      },
      { name: 'Swimming Pool', description: 'Relax and unwind.', status: 'active' },
    ],
    notifications: [
      {
        title: 'New visitor request',
        body: 'A visitor is waiting for approval.',
        status: 'pending',
        isRead: false,
      },
    ],
    vehicles: [{ vehicleNumber: 'ABC 1234', name: 'Family vehicle', status: 'active' }],
    events: [
      {
        title: 'Community gathering',
        description: 'Meet your neighbors.',
        eventDate: at,
        status: 'active',
      },
    ],
    community: [
      {
        title: 'Welcome to our community',
        content: 'A place to connect with neighbors.',
        status: 'published',
      },
    ],
  };
  const rows: Row[] = (fixtures[module] || []).map((d, i) => ({
    id: module + '-' + i,
    data: { communityId: s.community?.id, createdAt: at, updatedAt: at, ...d },
  }));
  if (new URLSearchParams(location.search).get('state') === 'error')
    return {
      rows: [],
      loading: false,
      error: 'Information is temporarily unavailable. Please try again.',
    };
  if (new URLSearchParams(location.search).get('state') === 'loading')
    return { rows: [], loading: true, error: '' };
  return { rows, loading: false, error: '' };
}
