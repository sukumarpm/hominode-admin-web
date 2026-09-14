import {
  House,
  Building2,
  Users,
  UserRound,
  Truck,
  Wrench,
  TriangleAlert,
  CalendarDays,
  Megaphone,
  MessagesSquare,
  FileText,
  ChartNoAxesCombined,
  Settings,
  WalletCards,
  Car,
  ShieldAlert,
  ParkingCircle,
  type LucideIcon,
} from 'lucide-react';
export interface Navigation {
  path: string;
  label: string;
  icon: LucideIcon;
}
export const adminNav: Navigation[] = [
  { path: 'dashboard', label: 'Dashboard', icon: House },
  { path: 'residents', label: 'Residents', icon: Users },
  { path: 'visitors', label: 'Visitors', icon: UserRound },
  { path: 'deliveries', label: 'Deliveries', icon: Truck },
  { path: 'facilities', label: 'Facilities', icon: CalendarDays },
  { path: 'requests', label: 'Service Requests', icon: Wrench },
  { path: 'complaints', label: 'Complaints', icon: TriangleAlert },
  { path: 'notices', label: 'Notices', icon: FileText },
  { path: 'community', label: 'Community', icon: Building2 },
  { path: 'buildings', label: 'Buildings & Units', icon: Building2 },
  { path: 'billing', label: 'Billing', icon: WalletCards },
  { path: 'events', label: 'Events', icon: Megaphone },
  { path: 'parking', label: 'Parking', icon: ParkingCircle },
  { path: 'resident-vehicles', label: 'Resident Vehicles', icon: Car },
  { path: 'reports', label: 'Reports', icon: ChartNoAxesCombined },
  { path: 'sos', label: 'Emergency SOS', icon: ShieldAlert },
  { path: 'settings', label: 'Settings', icon: Settings },
];
export const residentNav: Navigation[] = [
  { path: '', label: 'Dashboard', icon: House },
  { path: 'apartment', label: 'My Apartment', icon: Building2 },
  { path: 'visitors', label: 'Visitors', icon: UserRound },
  { path: 'deliveries', label: 'Deliveries', icon: Truck },
  { path: 'requests', label: 'Service Requests', icon: Wrench },
  { path: 'complaints', label: 'Complaints', icon: TriangleAlert },
  { path: 'facilities', label: 'Facilities', icon: CalendarDays },
  { path: 'notices', label: 'Notices', icon: FileText },
  { path: 'community', label: 'Community', icon: Users },
  { path: 'messages', label: 'Messages', icon: MessagesSquare },
  { path: 'documents', label: 'Documents', icon: FileText },
  { path: 'bills', label: 'Bills & Payments', icon: WalletCards },
  { path: 'events', label: 'Events', icon: CalendarDays },
  { path: 'sos', label: 'Emergency SOS', icon: ShieldAlert },
  { path: 'profile', label: 'My Profile', icon: UserRound },
  { path: 'settings', label: 'Settings', icon: Settings },
];
export const platformNav: Navigation[] = [
  { path: 'dashboard', label: 'Platform Overview', icon: ChartNoAxesCombined },
  { path: 'communities', label: 'Communities', icon: Building2 },
  { path: 'admins', label: 'Administrators', icon: Users },
  { path: 'settings', label: 'Settings', icon: Settings },
];
