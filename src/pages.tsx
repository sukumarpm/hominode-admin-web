import { serverTimestamp } from 'firebase/firestore';
import {
  ArrowRight,
  Building2,
  CalendarCheck2,
  CalendarDays,
  Clock3,
  Download,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  WalletCards,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  createComplaint,
  createEvent,
  createVisitor,
  currentAuthority,
  getBillingV2FinancialReport,
  publishNotice,
  receiptBlob,
  removeEventImage,
  residentLifecycle,
  submitProof,
  updateAnnouncement,
  updateEvent,
  updateScoped,
  uploadEventImages,
  type BillingV2FinancialReport,
} from './actions';
import { AdminCreateButtons, ResidentReview } from './AdminTools';
import { BillingCreateModal } from './BillingCreateModal';
import { CommunityPaymentSettings } from './CommunityPaymentSettings';
import { Card, Modal, Pill, State } from './components';
import { CreateRecurringScheduleModal } from './components/CreateRecurringScheduleModal';
import {
  paymentAttributionLabel,
  paymentMethodLabel,
  paymentReference,
  PaymentReviewSection,
} from './components/PaymentReview';
import { PhoneNumberInput } from './components/PhoneNumberInput';
import { RecordOfflinePaymentV2Panel } from './components/RecordOfflinePaymentV2Panel';
import { RecordPaymentPanel } from './components/RecordPaymentPanel';
import { RecurringSchedulesPanel } from './components/RecurringSchedules';
import {
  safeUrl,
  titleOf,
  useAdminV2PaymentProofs,
  useAdminV2RecurringSchedules,
  useRows,
  type Module,
  type Resource,
} from './data';
import { FacilityActions, FacilityForm } from './FacilityForm';
import { call } from './firebase';
import {
  amount,
  classifyV2Bill,
  dateLabel,
  first,
  formatInrMinorUnits,
  hasValidV2BillFinancials,
  hasValidV2PaymentProof,
  isV2Bill,
  isV2PaymentProof,
  money,
  status,
  str,
  type Data,
  type Row,
  type Session,
} from './models';
import { useAuth } from './session';
import { canUseFeature } from './subscription';
import { useSubscription } from './subscriptionContext';
export const labels: Record<Module, string> = {
  residents: 'Residents',
  buildings: 'Buildings',
  units: 'Units',
  visitors: 'Visitors',
  complaints: 'Complaints',
  facilities: 'Facilities',
  bookings: 'Bookings',
  billing: 'Bills & Payments',
  payments: 'Payments',
  notices: 'Notices',
  events: 'Events',
  documents: 'Documents',
  community: 'Community Wall',
  messages: 'Messages',
  vehicles: 'Vehicles',
  parking: 'Parking',
  deliveries: 'Deliveries',
  notifications: 'Notifications',
  sos: 'Emergency SOS',
  communities: 'Communities',
  admins: 'Administrators',
};
function paymentMethodWithAttribution(value: unknown) {
  const method = paymentMethodLabel(value);
  const attribution = paymentAttributionLabel(value);
  return attribution ? `${method} · ${attribution}` : method;
}
const descriptions: Partial<Record<Module, string>> = {
  residents: 'The people who make your community home.',
  visitors: 'A warm welcome, with peace of mind.',
  complaints: 'Follow every request from report to resolution.',
  facilities: 'Spaces to connect, unwind and enjoy.',
  billing: 'A clear view of your community payments.',
  payments: 'Resident payment proofs and Admin-recorded settlements.',
  notices: 'Stay connected to what’s happening around you.',
  buildings: 'Your community, building by building.',
  notifications: 'Updates that matter to you.',
  documents: 'Community documents and circulars.',
  community: 'Stories and updates from your neighbors.',
};
const details: Record<string, string> = {
  name: 'Name',
  fullName: 'Name',
  visitorName: 'Visitor',
  phoneNumber: 'Phone',
  email: 'Email',
  flatLabel: 'Unit',
  buildingName: 'Building',
  reservedForName: 'Reserved for',
  reservedForPhone: 'Phone number',
  reservedResidentType: 'Reserved as',
  reservedAt: 'Reserved at',
  residentType: 'Resident type',
  approvalStatus: 'Approval',
  identityVerificationStatus: 'Identity verification',
  purpose: 'Purpose',
  expectedArrival: 'Expected arrival',
  actualArrival: 'Arrival',
  departure: 'Departure',
  visitorPassCode: 'Visitor pass',
  vehicleNumber: 'Vehicle number',
  description: 'Description',
  content: 'Content',
  category: 'Category',
  assignedTo: 'Assigned to',
  technicianPhone: 'Technician phone',
  progressUpdate: 'Progress',
  resolution: 'Resolution',
  resolvedAt: 'Resolved at',
  dueDate: 'Due date',
  amount: 'Amount',
  status: 'Status',
  date: 'Date',
  timeSlot: 'Time slot',
  amenityName: 'Facility',
  numberOfPeople: 'People',
  cancellationReason: 'Cancellation reason',
  location: 'Location',
  eventDate: 'Event date',
  createdAt: 'Created',
  updatedAt: 'Updated',
  body: 'Message',
  lastMessage: 'Last message',
  rejectionReason: 'Rejection reason',
  isAvailable: 'Available',
  capacity: 'Capacity',
  pricePerDay: 'Daily price',
  address: 'Address',
  slug: 'Community address',
};
function descriptionValue(key: string, value: unknown) {
  if (key === 'amount' || key === 'pricePerDay')
    return typeof value === 'number' ? money(value) : '—';
  if (/At$|Date$|Arrival$|^departure$|^date$/.test(key)) return dateLabel(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
export function DetailFields({ data }: { data: Data }) {
  return (
    <dl className="detail-fields">
      {Object.entries(details).map(([key, label]) => {
        const value = descriptionValue(key, data[key]);
        return value && value !== '—' ? (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ) : null;
      })}
    </dl>
  );
}

export function V2BillFinancialSummary({
  data,
  compact = false,
}: {
  data: Data;
  compact?: boolean;
}) {
  if (!hasValidV2BillFinancials(data)) {
    return <span role="status">V2 financial details unavailable</span>;
  }

  const rawLines = Array.isArray(data.chargeLines) ? data.chargeLines : [];
  const chargeLines = rawLines.flatMap((line, index) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return [];
    const item = line as Record<string, unknown>;
    const label = first(item, ['label', 'description', 'name', 'title']);
    const lineAmount = item.amountMinor;
    if (!label || typeof lineAmount !== 'number' || !Number.isSafeInteger(lineAmount) || lineAmount < 0) {
      return [];
    }
    return [{ key: `${label}-${index}`, label, amountMinor: lineAmount }];
  });
  const billingPeriod = typeof data.billingPeriod === 'string' ? data.billingPeriod.trim() : '';

  return (
    <div className={compact ? 'v2-bill-summary v2-bill-summary-compact' : 'v2-bill-summary'}>
      {billingPeriod && <p className="v2-bill-period">Billing period: {billingPeriod}</p>}
      <dl className="v2-bill-balances">
        <div><dt>Total</dt><dd>{formatInrMinorUnits(data.amountMinor)}</dd></div>
        <div><dt>Paid</dt><dd>{formatInrMinorUnits(data.paidAmountMinor)}</dd></div>
        <div><dt>Credit applied</dt><dd>{formatInrMinorUnits(data.creditAppliedMinor)}</dd></div>
        <div><dt>Outstanding</dt><dd>{formatInrMinorUnits(data.outstandingAmountMinor)}</dd></div>
      </dl>
      {chargeLines.length > 0 && (
        <div className="v2-bill-charge-lines">
          <strong>Charges</strong>
          <ul>
            {chargeLines.map((line) => (
              <li key={line.key}>
                <span>{line.label}</span>
                <span>{formatInrMinorUnits(line.amountMinor)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function pageBase(s: Session) {
  return s.role === 'resident' ? '/' + s.community!.slug + '/' : '/';
}
function canCreate(s: Session, m: Module) {
  return (
    (s.role === 'resident' && ['visitors', 'complaints'].includes(m)) ||
    (s.role === 'admin' && ['notices', 'billing', 'facilities', 'events'].includes(m))
  );
}
function moduleStatus(module: Module, data: Data) {
  if (module === 'billing' && isV2Bill(data)) {
    const classification = classifyV2Bill(data);
    if (classification === 'history') return 'settled';
    if (classification === 'unavailable') return 'unavailable';
    return str(data.status).toLowerCase();
  }
  if (module === 'facilities') {
    const facilityStatus = status(data).toLowerCase();
    if (['maintenance', 'under maintenance'].includes(facilityStatus)) return 'Maintenance';
    return data.isAvailable === true ? 'Active' : data.isAvailable === false ? 'Inactive' : '';
  }
  return status(data);
}

function facilityText(data: Data, keys: string[], fallback = 'Not specified') {
  return first(data, keys, fallback);
}

function facilityTags(data: Data) {
  const raw = data.amenities ?? data.features ?? data.facilities;
  if (!Array.isArray(raw)) return [] as string[];
  return raw
    .filter((value): value is string => typeof value === 'string' && !!value.trim())
    .slice(0, 5);
}

function facilityImageUrls(data: Data) {
  const urls: string[] = [];
  if (Array.isArray(data.images)) {
    for (const value of data.images) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const url = safeUrl((value as Record<string, unknown>).url);
      if (url && !urls.includes(url)) urls.push(url);
    }
  }
  const legacy = safeUrl(data.imageUrl);
  if (legacy && !urls.includes(legacy)) urls.unshift(legacy);
  return urls.slice(0, 6);
}

function FacilityGallery({ data, title }: { data: Data; title: string }) {
  const images = facilityImageUrls(data);
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [data]);
  if (!images.length) return null;
  const active = images[Math.min(selected, images.length - 1)];
  return (
    <section className="facility-detail-gallery" aria-label={`${title} photos`}>
      <div className="facility-detail-main-image">
        <img src={active} alt={`${title} photo ${Math.min(selected, images.length - 1) + 1}`} />
        {images.length > 1 && (
          <span>
            {Math.min(selected, images.length - 1) + 1} / {images.length}
          </span>
        )}
      </div>
      {images.length > 1 && (
        <div className="facility-detail-thumbnails">
          {images.map((url, index) => (
            <button
              type="button"
              className={index === selected ? 'active' : ''}
              aria-label={`View facility photo ${index + 1}`}
              aria-pressed={index === selected}
              onClick={() => setSelected(index)}
              key={url}
            >
              <img src={url} alt="" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}


function EventDetailView({ data, title }: { data: Data; title: string }) {
  const eventDate = data.eventDate ?? data.date;
  const category = str(data.category) || 'Community event';
  const location = str(data.location);
  const eventTime = str(data.time);

  const capacity =
    typeof data.totalCapacity === 'number' && Number.isFinite(data.totalCapacity)
      ? data.totalCapacity
      : typeof data.capacity === 'number' && Number.isFinite(data.capacity)
        ? data.capacity
        : null;

  const description = str(data.description);

  return (
    <section className="event-detail-shell">
      <FacilityGallery data={data} title={title} />

      <div className="event-detail-heading">
        <div>
          <span className="event-detail-category">{category}</span>
          <h2>{title}</h2>
        </div>

        <Pill value={status(data)} />
      </div>

      <div className="event-detail-meta">
        <div>
          <span className="event-detail-meta-icon">
            <CalendarDays size={19} />
          </span>
          <span>
            <small>Date</small>
            <strong>{dateLabel(eventDate)}</strong>
          </span>
        </div>

        {eventTime && (
          <div>
            <span className="event-detail-meta-icon">
              <Clock3 size={19} />
            </span>
            <span>
              <small>Time</small>
              <strong>{eventTime}</strong>
            </span>
          </div>
        )}

        {location && (
          <div>
            <span className="event-detail-meta-icon event-location-mark">
              ⌖
            </span>
            <span>
              <small>Location</small>
              <strong>{location}</strong>
            </span>
          </div>
        )}

        {capacity != null && (
          <div>
            <span className="event-detail-meta-icon">
              <Users size={19} />
            </span>
            <span>
              <small>Capacity</small>
              <strong>{capacity} people</strong>
            </span>
          </div>
        )}
      </div>

      {description && (
        <div className="event-detail-description">
          <small>About this event</small>
          <p>{description}</p>
        </div>
      )}
    </section>
  );
}

function facilityScheduleSummary(data: Data) {
  const explicit = str(data.operatingHours) || str(data.hours);
  const slots = Array.isArray(data.timeSlots)
    ? data.timeSlots.filter((value): value is string => typeof value === 'string' && !!value.trim())
    : [];

  let range = explicit;
  if (!range && slots.length) {
    const firstSlot = slots[0].trim();
    const lastSlot = slots[slots.length - 1].trim();
    const splitSlot = (value: string) =>
      value
        .split(/\s*(?:–|—|-)\s*/)
        .map((part) => part.trim())
        .filter(Boolean);
    const firstParts = splitSlot(firstSlot);
    const lastParts = splitSlot(lastSlot);
    if (firstParts.length >= 2 && lastParts.length >= 2) {
      range = `${firstParts[0]} – ${lastParts[lastParts.length - 1]}`;
    }
  }

  return {
    range: range || 'Schedule not set',
    slotCount: slots.length,
    slotLabel: slots.length
      ? `${slots.length} booking slot${slots.length === 1 ? '' : 's'}`
      : 'Flexible / no fixed slots',
  };
}
function facilityFeeSummary(data: Data) {
  if (data.isFree === true) return 'Free';
  const custom = str(data.feeSummary) || str(data.pricingSummary);
  if (custom) return custom;
  if (typeof data.pricePerDay === 'number') return money(data.pricePerDay) + ' / day';
  if (typeof data.pricePerHour === 'number') return money(data.pricePerHour) + ' / hour';
  return 'Paid — fee details not set';
}
export function ModulePage({ module, routeName }: { module: Module; routeName?: string }) {
  const { session } = useAuth();
  if (!session) return null;
  return (
    <ScopedModule
      key={session.uid + ':' + session.community?.id + ':' + module}
      s={session}
      module={module}
      routeName={routeName}
    />
  );
}
function ScopedModule({
  s,
  module,
  routeName,
}: {
  s: Session;
  module: Module;
  routeName?: string;
}) {
  const [revision, setRevision] = useState(0),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [categoryFilter, setCategoryFilter] = useState('all'),
    [sortBy, setSortBy] = useState('name'),
    [page, setPage] = useState(0);
  const [createRecurringOpen, setCreateRecurringOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const { entitlement } = useSubscription();

  // TEMP DEBUG: Events subscription / permission investigation
  if (module === 'events') {
    console.group('[Events Debug]');
    console.log('module:', module);
    console.log('session role:', s.role);
    console.log('profile role:', s.profile?.role);
    console.log('community:', s.community);
    console.log('community id:', s.community?.id);
    console.log('community name:', s.community?.name);
    console.log('entitlement:', entitlement);
    console.log('planId:', entitlement?.planId);
    console.log('planName:', entitlement?.planName);
    console.log('features:', entitlement?.features);
    console.log('events feature:', entitlement?.features?.events);
    console.log(
      'canUseFeature(events):',
      canUseFeature(entitlement, 'events')
    );
    console.groupEnd();
  }
  const bookingAllowed = canUseFeature(entitlement, 'facilityBooking');
  const resource = useRows(s, module, revision);
  const v2ProofResource = useAdminV2PaymentProofs(
    s,
    ['payments', 'billing'].includes(module) && s.role === 'admin',
    revision,
  );
  const recurringScheduleResource = useAdminV2RecurringSchedules(
    s,
    module === 'billing' && s.role === 'admin',
    revision,
  );
  const displayResource: Resource =
    module === 'payments' && s.role === 'admin'
      ? {
        rows: [...resource.rows, ...v2ProofResource.rows],
        loading: resource.loading || v2ProofResource.loading,
        error: resource.error,
      }
      : resource;
  const base = pageBase(s);
  const title = routeName === 'requests' ? 'Service Requests' : labels[module];
  const showCards =
    s.role === 'resident' ||
    ['facilities', 'notices', 'events', 'community', 'buildings'].includes(module);
  const categories =
    module === 'facilities'
      ? [
        ...new Set(
          resource.rows.map((r) => str(r.data.type) || str(r.data.category)).filter(Boolean),
        ),
      ]
      : [];
  const rows = displayResource.rows
    .filter(
      (r) =>
        (filter === 'all' || moduleStatus(module, r.data) === filter) &&
        (module !== 'facilities' ||
          categoryFilter === 'all' ||
          str(r.data.type) === categoryFilter ||
          str(r.data.category) === categoryFilter) &&
        [titleOf(r.data), ...Object.values(r.data).filter((v) => typeof v === 'string')]
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      if (module !== 'facilities') return 0;
      if (sortBy === 'status')
        return moduleStatus(module, a.data).localeCompare(moduleStatus(module, b.data));
      return titleOf(a.data).localeCompare(titleOf(b.data));
    });
  const recordSource = params.get('recordSource');
  const selected =
    module === 'payments' && s.role === 'admin' && recordSource === 'v2'
      ? v2ProofResource.rows.find((r) => r.id === params.get('record'))
      : displayResource.rows.find(
        (r) =>
          r.id === params.get('record') &&
          (recordSource === 'v1'
            ? !isV2PaymentProof(r.data)
            : recordSource === 'v2'
              ? isV2PaymentProof(r.data)
              : true),
      );
  const create = params.get('create') === '1' && canCreate(s, module);
  const statuses =
    module === 'facilities'
      ? ['Active', 'Maintenance', 'Inactive']
      : [...new Set(displayResource.rows.map((r) => moduleStatus(module, r.data)).filter(Boolean))];
  const pageCount = Math.max(1, Math.ceil(rows.length / 12));
  const currentPage = Math.min(page, pageCount - 1);
  function close() {
    setParams((p) => {
      p.delete('record');
      p.delete('recordSource');
      p.delete('create');
      p.delete('edit');
      return p;
    });
  }
  function facilitySaved() {
    close();
    setRevision((value) => value + 1);
  }
  function paymentRecorded() {
    setRevision((value) => value + 1);
  }
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">{s.community?.name || 'Hominode platform'}</p>
          <h1>{title}</h1>
          <p>{descriptions[module] || 'Everything you need, in one place.'}</p>
        </div>
        <div className="page-actions">
          <AdminCreateButtons s={s} module={module} />
          {module === 'billing' && (
            <Link className="outline-link" to={base + 'payments'}>
              Payments <ArrowRight size={16} />
            </Link>
          )}
          {module === 'billing' && s.role === 'admin' && (
            <button type="button" onClick={() => setCreateRecurringOpen(true)}>
              Create Recurring Schedule
            </button>
          )}
          {module === 'buildings' && (
            <Link className="outline-link" to={base + 'units'}>
              View units <ArrowRight size={16} />
            </Link>
          )}
          {module === 'facilities' && bookingAllowed && (
            <Link className="outline-link" to={base + 'bookings'}>
              Bookings <ArrowRight size={16} />
            </Link>
          )}
          {canCreate(s, module) && (
            <button className="primary" onClick={() => setParams({ create: '1' })}>
              <Plus size={18} />
              {module === 'visitors'
                ? 'Invite Visitor'
                : module === 'notices'
                  ? 'Publish Notice'
                  : module === 'billing'
                    ? 'Create Bill'
                    : module === 'facilities'
                      ? 'Add facility'
                      : module === 'events'
                        ? 'Create Event'
                        : 'New Request'}
            </button>
          )}
        </div>
      </header>
      {module === 'facilities' ? (
        <div className="facility-summary-grid">
          <div className="facility-summary-card total">
            <Building2 size={22} />
            <div>
              <strong>{resource.loading ? '…' : resource.rows.length}</strong>
              <span>Total Facilities</span>
            </div>
          </div>
          <div className="facility-summary-card active">
            <ShieldCheck size={22} />
            <div>
              <strong>
                {resource.loading
                  ? '…'
                  : resource.rows.filter((r) => moduleStatus(module, r.data) === 'Active').length}
              </strong>
              <span>Active</span>
            </div>
          </div>
          <div className="facility-summary-card maintenance">
            <Clock3 size={22} />
            <div>
              <strong>
                {resource.loading
                  ? '…'
                  : resource.rows.filter((r) => moduleStatus(module, r.data) === 'Maintenance')
                    .length}
              </strong>
              <span>Under Maintenance</span>
            </div>
          </div>
          <div className="facility-summary-card inactive">
            <span className="pause-mark">Ⅱ</span>
            <div>
              <strong>
                {resource.loading
                  ? '…'
                  : resource.rows.filter((r) => moduleStatus(module, r.data) === 'Inactive').length}
              </strong>
              <span>Inactive</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="module-summary">
          <span>
            <strong>{displayResource.loading ? '…' : displayResource.error ? '—' : displayResource.rows.length}</strong>{' '}
            Total {title.toLowerCase()}
          </span>
          <span>
            <strong>
              {displayResource.loading
                ? '…'
                : displayResource.error
                  ? '—'
                  : displayResource.rows.filter((r) =>
                    ['pending', 'expected', 'open'].includes(status(r.data)),
                  ).length}
            </strong>{' '}
            Awaiting action
          </span>
          <span className="summary-note">
            <ShieldCheck size={18} /> {s.community?.name || 'Platform registry'}
          </span>
        </div>
      )}
      {module === 'billing' && s.role === 'admin' && (
        <RecurringSchedulesPanel
          resource={recurringScheduleResource}
          session={s}
          onRefresh={() => setRevision((value) => value + 1)}
        />
      )}
      <Card>
        <div className="filters">
          <label className="search-field">
            <Search size={18} />
            <input
              aria-label={'Search ' + title.toLowerCase()}
              placeholder={'Search ' + title.toLowerCase() + '…'}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          {module === 'facilities' && (
            <label className="facility-filter-select">
              <span className="sr-only">Filter by category</span>
              <select
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setPage(0);
                }}
              >
                <option value="all">All categories</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span className="sr-only">Filter by status</span>
            <select
              aria-label="Filter by status"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">All statuses</option>
              {statuses.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {module === 'facilities' && (
            <label className="facility-sort-select">
              <span className="sr-only">Sort facilities</span>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="name">Name (A–Z)</option>
                <option value="status">Status</option>
              </select>
            </label>
          )}
          <button
            className="icon-button"
            aria-label="Refresh page data"
            onClick={() => setRevision(revision + 1)}
          >
            <RefreshCw size={19} />
          </button>
        </div>
        <State resource={displayResource} empty={'No ' + title.toLowerCase() + ' to display yet.'}>
          {!rows.length ? (
            <p className="empty-state">No matches. Try another search or status.</p>
          ) : showCards ? (
            <div className={'module-cards ' + module}>
              {rows.slice(currentPage * 12, currentPage * 12 + 12).map((row) =>
                module === 'facilities' ? (
                  <article className="facility-card facility-card-v2" key={row.id}>
                    <div
                      className="facility-image facility-image-v2"
                      onClick={() => setParams({ record: row.id })}
                    >
                      {facilityImageUrls(row.data)[0] ? (
                        <img
                          loading="lazy"
                          src={facilityImageUrls(row.data)[0]}
                          alt={titleOf(row.data)}
                        />
                      ) : (
                        <div className="facility-image-placeholder">
                          <Building2 size={52} />
                          <span>Add facility photo</span>
                        </div>
                      )}
                      {facilityImageUrls(row.data).length > 1 && (
                        <span className="facility-image-count">
                          1 / {facilityImageUrls(row.data).length}
                        </span>
                      )}
                      <span className="facility-status-float">
                        <Pill value={moduleStatus(module, row.data)} />
                      </span>
                    </div>

                    <div className="facility-card-content">
                      <div className="facility-heading-v2">
                        <div className="facility-title-row">
                          <span className="record-icon">
                            <Building2 size={20} />
                          </span>
                          <div>
                            <h3>{titleOf(row.data)}</h3>
                            <small>
                              {[
                                str(row.data.type) || str(row.data.category),
                                str(row.data.location),
                              ]
                                .filter(Boolean)
                                .join(' · ') || 'Community facility'}
                            </small>
                          </div>
                        </div>
                        <p>
                          {facilityText(
                            row.data,
                            ['description'],
                            'No description has been added yet.',
                          )}
                        </p>
                      </div>

                      {(() => {
                        const schedule = facilityScheduleSummary(row.data);
                        return (
                          <div className="facility-info-grid">
                            <div className="facility-info-tile schedule">
                              <Clock3 size={19} />
                              <span>
                                <small>Schedule</small>
                                <strong>{schedule.range}</strong>
                                <em>{schedule.slotLabel}</em>
                              </span>
                            </div>
                            <div className="facility-info-tile">
                              <Users size={19} />
                              <span>
                                <small>Capacity</small>
                                <strong>
                                  {row.data.capacity != null
                                    ? String(row.data.capacity) + ' people'
                                    : 'Not specified'}
                                </strong>
                              </span>
                            </div>
                            <div className="facility-info-tile">
                              <CalendarCheck2 size={19} />
                              <span>
                                <small>Booking</small>
                                <strong>
                                  {facilityText(
                                    row.data,
                                    ['bookingType', 'bookingRule'],
                                    'Advance booking required',
                                  )}
                                </strong>
                              </span>
                            </div>
                            <div
                              className={
                                'facility-info-tile fee ' +
                                (row.data.isFree === true ? 'free' : 'paid')
                              }
                            >
                              <WalletCards size={19} />
                              <span>
                                <small>Fee</small>
                                <strong>{facilityFeeSummary(row.data)}</strong>
                              </span>
                            </div>
                          </div>
                        );
                      })()}

                      {!!facilityTags(row.data).length && (
                        <div className="facility-tags facility-tags-v2">
                          {facilityTags(row.data).map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="facility-card-actions">
                      {bookingAllowed && (
                        <Link to={base + 'bookings?facility=' + row.id}>View Bookings</Link>
                      )}
                      {s.role === 'admin' ? (
                        <button
                          type="button"
                          onClick={() => setParams({ record: row.id, edit: '1' })}
                        >
                          <Pencil size={15} /> Edit Facility
                        </button>
                      ) : (
                        <button type="button" onClick={() => setParams({ record: row.id })}>
                          View Details <ArrowRight size={15} />
                        </button>
                      )}
                    </div>
                  </article>
                ) : module === 'events' ? (
                  <button
                    className="module-card event-card"
                    key={row.id}
                    onClick={() => setParams({ record: row.id })}
                  >
                    {facilityImageUrls(row.data)[0] ? (
                      <div className="event-card-image">
                        <img
                          loading="lazy"
                          src={facilityImageUrls(row.data)[0]}
                          alt={titleOf(row.data)}
                        />

                        {facilityImageUrls(row.data).length > 1 && (
                          <span className="event-card-photo-count">
                            {facilityImageUrls(row.data).length} photos
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="event-card-image event-card-placeholder">
                        <CalendarDays size={42} />
                      </div>
                    )}

                    <div className="module-card-body event-card-body">
                      <div className="event-card-top">
                        <span className="event-card-category">
                          {str(row.data.category) || 'Event'}
                        </span>

                        <Pill value={moduleStatus(module, row.data)} />
                      </div>

                      <h3>{titleOf(row.data)}</h3>

                      <p>
                        {first(
                          row.data,
                          ['description'],
                          'Community event',
                        )}
                      </p>

                      <div className="event-card-meta">
                        <span>
                          <CalendarDays size={14} />
                          {dateLabel(
                            row.data.eventDate ??
                            row.data.date ??
                            row.data.createdAt,
                          )}
                        </span>

                        {str(row.data.location) && (
                          <span>
                            <span aria-hidden="true">⌖</span>
                            {str(row.data.location)}
                          </span>
                        )}
                      </div>

                      <span className="card-more">
                        View details <ArrowRight size={16} />
                      </span>
                    </div>
                  </button>
                ) : (
                  <button
                    className="module-card"
                    key={row.id}
                    onClick={() => setParams({ record: row.id })}
                  >
                    <div className="module-card-body">
                      <div className="card-heading">
                        <span className="record-icon">
                          {module === 'visitors' ? (
                            <span>{titleOf(row.data).slice(0, 2).toUpperCase()}</span>
                          ) : module === 'bookings' ? (
                            <CalendarDays />
                          ) : (
                            <FileText />
                          )}
                        </span>
                        <Pill value={moduleStatus(module, row.data)} />
                      </div>
                      <h3>{titleOf(row.data)}</h3>
                      <p>
                        {first(
                          row.data,
                          [
                            'description',
                            'content',
                            'purpose',
                            'flatLabel',
                            'location',
                            'body',
                            'lastMessage',
                          ],
                          'View details',
                        )}
                      </p>
                      <small>
                        {dateLabel(row.data.expectedArrival ?? row.data.date ?? row.data.createdAt)}
                      </small>
                      <span className="card-more">
                        View details <ArrowRight size={16} />
                      </span>
                    </div>
                  </button>
                ),
              )}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">
                  {title} in {s.community?.name || 'the platform'}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">
                      {module === 'payments'
                        ? 'Payment / Bill reference'
                        : module === 'residents'
                          ? 'Resident'
                          : module === 'visitors'
                            ? 'Visitor'
                            : 'Name / Reference'}
                    </th>
                    <th scope="col">
                      {['billing', 'payments'].includes(module) ? 'Amount' : 'Details'}
                    </th>
                    {module === 'payments' && <th scope="col">Method</th>}
                    {module === 'billing' && <th scope="col">Payment</th>}
                    <th scope="col">Status</th>
                    <th scope="col">{module === 'payments' ? 'Date' : 'Last updated'}</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(currentPage * 12, currentPage * 12 + 12).map((row) => (
                    <tr
                      key={
                        module === 'payments' && isV2PaymentProof(row.data)
                          ? `v2:${row.id}`
                          : `v1:${row.id}`
                      }
                    >
                      <th scope="row">
                        <strong>
                          {module === 'payments'
                            ? paymentReference(row.data, row.id)
                            : titleOf(row.data)}
                        </strong>
                        <small>
                          {module === 'payments'
                            ? str(row.data.billId)
                              ? `Bill ${str(row.data.billId)} · Payment ${row.id}`
                              : `Payment ${row.id}`
                            : first(row.data, ['phoneNumber', 'email', 'flatLabel'], row.id)}
                        </small>
                      </th>
                      <td>
                        {module === 'payments' && isV2PaymentProof(row.data) ? (
                          hasValidV2PaymentProof(row.data, row.id)
                            ? formatInrMinorUnits(row.data.submittedAmountMinor)
                            : '—'
                        ) : module === 'billing' && isV2Bill(row.data) ? (
                          <V2BillFinancialSummary data={row.data} compact />
                        ) : ['billing', 'payments'].includes(module)
                          ? money(amount(row.data))
                          : first(
                            row.data,
                            ['flatLabel', 'description', 'purpose', 'role', 'category'],
                            '—',
                          )}
                      </td>
                      {module === 'payments' && (
                        <td>
                          <span>{paymentMethodLabel(row.data.method ?? row.data.paymentMethod)}</span>
                          {str(row.data.status).toLowerCase() === 'completed' &&
                            paymentAttributionLabel(row.data.method ?? row.data.paymentMethod) && (
                              <small>
                                {paymentAttributionLabel(row.data.method ?? row.data.paymentMethod)}
                              </small>
                            )}
                        </td>
                      )}
                      {module === 'billing' && (
                        <td>
                          {str(row.data.status).toLowerCase() === 'paid' && str(row.data.paymentMethod)
                            ? paymentMethodWithAttribution(row.data.paymentMethod)
                            : '—'}
                        </td>
                      )}
                      <td>
                        <Pill value={moduleStatus(module, row.data)} />
                      </td>
                      <td>
                        {module === 'payments'
                          ? dateLabel(
                            row.data.recordedAt ??
                            row.data.paidAt ??
                            row.data.paymentDate ??
                            row.data.createdAt ??
                            row.data.submittedAt,
                          )
                          : dateLabel(row.data.updatedAt ?? row.data.createdAt)}
                      </td>
                      <td>
                        <button
                          className="text-button"
                          aria-label={'View ' + titleOf(row.data)}
                          onClick={() =>
                            setParams(
                              module === 'payments'
                                ? {
                                  record: row.id,
                                  recordSource: isV2PaymentProof(row.data) ? 'v2' : 'v1',
                                }
                                : { record: row.id },
                            )
                          }
                        >
                          View <ArrowRight size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {module === 'payments' && s.role === 'admin' && v2ProofResource.error && (
            <p role="status">V2 payment proofs could not be loaded. Legacy payments remain available.</p>
          )}
        </State>
        {rows.length > 12 && (
          <div className="pagination">
            <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
              Previous
            </button>
            <span>
              Page {currentPage + 1} of {pageCount}
            </span>
            <button
              disabled={currentPage + 1 >= pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        )}
      </Card>
      {params.has('record') && !selected && !displayResource.loading && !displayResource.error && (
        <p role="status">This record is no longer available in your community.</p>
      )}
      {selected && (
        <RecordDetails
          key={selected.id}
          s={s}
          module={module}
          row={selected}
          onClose={close}
          onFacilitySaved={facilitySaved}
          onPaymentRecorded={paymentRecorded}
          v2ProofResource={v2ProofResource}
          startEditing={params.get('edit') === '1'}
        />
      )}{' '}
      {module === 'billing' && s.role === 'admin' && createRecurringOpen && (
        <CreateRecurringScheduleModal
          s={s}
          onClose={() => setCreateRecurringOpen(false)}
          onCreated={() => setRevision((value) => value + 1)}
        />
      )}
      {create &&
        (module === 'facilities' ? (
          <FacilityForm s={s} onClose={close} onSaved={facilitySaved} />
        ) : module === 'billing' ? (
          <BillingCreateModal s={s} onClose={close} />
        ) : (
          <CreateForm s={s} module={module} onClose={close} />
        ))}
    </>
  );
}
function CreateForm({ s, module, onClose }: { s: Session; module: Module; onClose: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');

  const [eventImageFiles, setEventImageFiles] = useState<File[]>([]);
  const [eventImagePreviews, setEventImagePreviews] = useState<string[]>([]);

  useEffect(() => {
    if (module !== 'events') return;

    const urls = eventImageFiles.map((file) => URL.createObjectURL(file));
    setEventImagePreviews(urls);

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [eventImageFiles, module]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(e.currentTarget);
    const eventImages = module === 'events' ? eventImageFiles : [];

    const data = Object.fromEntries(form) as Record<string, string>;
    try {
      if (module === 'visitors') await createVisitor(s, data);
      else if (module === 'complaints') await createComplaint(s, data);
      else if (module === 'notices') await publishNotice(s, data);
      else if (module === 'events') {
        const eventRef = await createEvent(s, {
          title: data.title,
          category: data.category,
          description: data.description,
          eventDate: data.eventDate,
          time: data.time,
          location: data.location,
          totalCapacity: data.totalCapacity ? Number(data.totalCapacity) : undefined,
        });

        if (eventImages.length) {
          await uploadEventImages(s, eventRef.id, eventImages);
        }
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        module === 'visitors'
          ? 'Invite a Visitor'
          : module === 'notices'
            ? 'Publish a Notice'
            : module === 'events'
              ? 'Create Event'
              : 'Raise a Request'
      }
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          {module === 'visitors' ? (
            <>
              <label>
                Visitor name
                <input name="visitorName" required maxLength={120} />
              </label>
              <label>
                Purpose
                <input name="purpose" required maxLength={200} />
              </label>
              <label>
                Expected arrival
                <input type="datetime-local" name="expectedArrival" required />
              </label>
              <PhoneNumberInput name="phoneNumber" label="Phone number" defaultCountry="PH" />
              <label>
                Vehicle number
                <input name="vehicleNumber" />
              </label>
            </>
          ) : (
            <>
              <label>
                Title
                <input name="title" required maxLength={160} />
              </label>
              {module === 'complaints' && (
                <label>
                  Category
                  <select name="category" required>
                    <option value="plumbing">Plumbing</option>
                    <option value="electrical">Electrical</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="other">Other</option>
                  </select>
                </label>
              )}
              {module === 'notices' && (
                <>
                  <label>
                    Category
                    <input
                      name="category"
                      placeholder="General, Maintenance, Security..."
                      maxLength={100}
                    />
                  </label>

                  <label>
                    Priority
                    <select name="priority" defaultValue="medium">
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                </>
              )}

              {module === 'events' && (
                <>
                  <label>
                    Category
                    <input
                      name="category"
                      placeholder="Festival, Meeting, Sports..."
                      maxLength={100}
                    />
                  </label>

                  <label>
                    Date
                    <input type="date" name="eventDate" required />
                  </label>

                  <label>
                    Time
                    <input type="time" name="time" />
                  </label>

                  <label>
                    Location
                    <input
                      name="location"
                      placeholder="Community Hall"
                      maxLength={200}
                      required
                    />
                  </label>

                  <label>
                    Capacity
                    <input
                      type="number"
                      name="totalCapacity"
                      min="1"
                      step="1"
                      placeholder="e.g. 250"
                    />
                  </label>

                  <div className="event-image-field">
                    <div className="event-image-heading">
                      <div>
                        <strong>Event photos</strong>
                        <span>Optional · Up to 6 photos · 5 MB each</span>
                      </div>
                      {eventImageFiles.length > 0 && (
                        <span className="event-image-counter">
                          {eventImageFiles.length}/6 selected
                        </span>
                      )}
                    </div>

                    <label className="event-image-picker">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        onChange={(e) => {
                          const selected = Array.from(e.target.files ?? []);

                          setEventImageFiles((current) => {
                            const merged = [...current];

                            for (const file of selected) {
                              const duplicate = merged.some(
                                (existing) =>
                                  existing.name === file.name &&
                                  existing.size === file.size &&
                                  existing.lastModified === file.lastModified,
                              );

                              if (!duplicate) {
                                merged.push(file);
                              }
                            }

                            if (merged.length > 6) {
                              setError('You can upload a maximum of 6 event photos.');
                              return merged.slice(0, 6);
                            }

                            setError('');
                            return merged;
                          });

                          e.target.value = '';
                        }}
                      />

                      <span className="event-image-picker-icon">＋</span>

                      <span className="event-image-picker-copy">
                        <strong>
                          {eventImageFiles.length
                            ? 'Choose different photos'
                            : 'Add event photos'}
                        </strong>
                        <small>
                          Select JPG, PNG or WebP images
                        </small>
                      </span>

                      <span className="event-image-picker-action">
                        Browse
                      </span>
                    </label>

                    {eventImageFiles.length > 0 && (
                      <div className="event-image-previews">
                        {eventImageFiles.map((file, index) => (
                          <div
                            className="event-image-preview"
                            key={`${file.name}-${file.size}-${file.lastModified}`}
                          >
                            <img
                              src={eventImagePreviews[index]}
                              alt={`Event preview ${index + 1}`}
                            />

                            {index === 0 && (
                              <span className="event-cover-badge">
                                Cover
                              </span>
                            )}

                            <button
                              type="button"
                              aria-label={`Remove ${file.name}`}
                              onClick={() =>
                                setEventImageFiles((current) =>
                                  current.filter((_, i) => i !== index),
                                )
                              }
                            >
                              ×
                            </button>

                            <small title={file.name}>
                              {file.name}
                            </small>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              <label>
                {module === 'notices' ? 'Announcement' : 'Description'}
                <textarea
                  name={module === 'notices' ? 'content' : 'description'}
                  rows={5}
                  required
                  maxLength={5000}
                />
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button className="primary" type="submit">
            {busy
              ? 'Saving…'
              : module === 'notices'
                ? 'Publish to community'
                : module === 'events'
                  ? 'Create Event'
                  : 'Submit'}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}

function contentDateInputValue(value: unknown) {
  let date: Date | null = null;

  if (value instanceof Date) {
    date = value;
  } else if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    date = (value as { toDate: () => Date }).toDate();
  } else if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }

  if (!date) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function ContentEditForm({
  s,
  module,
  row,
  onClose,
  onSaved,
}: {
  s: Session;
  module: 'events' | 'notices';
  row: Row;
  onClose: () => void;
  onSaved: () => void;
}) {
  const d = row.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newImages, setNewImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  const [existingEventImages, setExistingEventImages] = useState<
    Array<{
      url: string;
      storagePath: string;
      name: string;
    }>
  >(() =>
    Array.isArray(d.images)
      ? d.images
        .filter(
          (image): image is {
            url: string;
            storagePath: string;
            name: string;
          } =>
            !!image &&
            typeof image === 'object' &&
            !Array.isArray(image) &&
            typeof (image as Record<string, unknown>).url === 'string' &&
            typeof (image as Record<string, unknown>).storagePath === 'string',
        )
        .map((image) => ({
          url: image.url,
          storagePath: image.storagePath,
          name: typeof image.name === 'string' ? image.name : '',
        }))
      : [],
  );

  useEffect(() => {
    const urls = newImages.map((file) => URL.createObjectURL(file));
    setPreviews(urls);

    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [newImages]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');

    const values = Object.fromEntries(
      new FormData(e.currentTarget),
    ) as Record<string, string>;

    try {
      if (module === 'events') {
        await updateEvent(s, row.id, {
          title: values.title,
          category: values.category,
          description: values.description,
          eventDate: values.eventDate,
          time: values.time,
          location: values.location,
          totalCapacity: values.totalCapacity
            ? Number(values.totalCapacity)
            : undefined,
          status: values.status,
        });

        if (newImages.length) {
          await uploadEventImages(s, row.id, newImages);
        }
      } else {
        await updateAnnouncement(s, row.id, {
          title: values.title,
          description: values.description,
          category: values.category,
          priority: values.priority,
          status: values.status,
        });
      }

      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save changes.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={module === 'events' ? 'Edit Event' : 'Edit Announcement'}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            Title
            <input
              name="title"
              required
              maxLength={160}
              defaultValue={str(d.title)}
            />
          </label>

          <label>
            Category
            <input
              name="category"
              maxLength={100}
              defaultValue={str(d.category)}
            />
          </label>

          {module === 'events' ? (
            <>
              <label>
                Date
                <input
                  type="date"
                  name="eventDate"
                  required
                  defaultValue={contentDateInputValue(
                    d.eventDate ?? d.date,
                  )}
                />
              </label>

              <label>
                Time
                <input
                  type="time"
                  name="time"
                  defaultValue={str(d.time)}
                />
              </label>

              <label>
                Location
                <input
                  name="location"
                  required
                  maxLength={200}
                  defaultValue={str(d.location)}
                />
              </label>

              <label>
                Capacity
                <input
                  type="number"
                  name="totalCapacity"
                  min="1"
                  step="1"
                  defaultValue={
                    typeof d.totalCapacity === 'number'
                      ? d.totalCapacity
                      : ''
                  }
                />
              </label>

              <label>
                Status
                <select
                  name="status"
                  defaultValue={str(d.status) || 'upcoming'}
                >
                  <option value="upcoming">Upcoming</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>

              {existingEventImages.length > 0 && (
                <div className="event-image-field">
                  <div className="event-image-heading">
                    <div>
                      <strong>Existing photos</strong>
                      <span>
                        {existingEventImages.length} photo
                        {existingEventImages.length === 1 ? '' : 's'} currently attached
                      </span>
                    </div>

                    <span className="event-image-counter">
                      {existingEventImages.length + newImages.length}/6 total
                    </span>
                  </div>

                  <div className="event-image-previews">
                    {existingEventImages.map((image, index) => (
                      <div
                        className="event-image-preview"
                        key={image.storagePath}
                      >
                        <img
                          src={image.url}
                          alt={`Existing event photo ${index + 1}`}
                        />

                        {index === 0 && (
                          <span className="event-cover-badge">
                            Cover
                          </span>
                        )}

                        <button
                          type="button"
                          aria-label={`Remove existing photo ${index + 1}`}
                          disabled={busy}
                          onClick={() => {
                            const confirmed = window.confirm(
                              'Remove this event photo?',
                            );

                            if (!confirmed) return;

                            setBusy(true);
                            setError('');

                            void removeEventImage(
                              s,
                              row.id,
                              image.storagePath,
                            )
                              .then(() => {
                                setExistingEventImages((current) =>
                                  current.filter(
                                    (item) =>
                                      item.storagePath !== image.storagePath,
                                  ),
                                );
                              })
                              .catch((e: unknown) => {
                                setError(
                                  e instanceof Error
                                    ? e.message
                                    : 'Unable to remove image.',
                                );
                              })
                              .finally(() => {
                                setBusy(false);
                              });
                          }}
                        >
                          ×
                        </button>

                        {image.name && (
                          <small title={image.name}>
                            {image.name}
                          </small>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="event-image-field">
                <div className="event-image-heading">
                  <div>
                    <strong>Add more photos</strong>
                    <span>
                      JPG, PNG or WebP · Maximum 6 photos total
                    </span>
                  </div>

                  <span className="event-image-counter">
                    {existingEventImages.length + newImages.length}/6 total
                  </span>
                </div>

                <label className="event-image-picker">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={(e) => {
                      const selected = Array.from(e.target.files ?? []);

                      setNewImages((current) => {
                        const merged = [...current];

                        for (const file of selected) {
                          const duplicate = merged.some(
                            (existing) =>
                              existing.name === file.name &&
                              existing.size === file.size &&
                              existing.lastModified === file.lastModified,
                          );

                          if (!duplicate) {
                            merged.push(file);
                          }
                        }

                        const available =
                          Math.max(0, 6 - existingEventImages.length);

                        if (merged.length > available) {
                          setError(
                            `You can add only ${available} more photo${available === 1 ? '' : 's'
                            }. Maximum is 6 total.`,
                          );

                          return merged.slice(0, available);
                        }

                        setError('');
                        return merged;
                      });

                      e.target.value = '';
                    }}
                  />

                  <span className="event-image-picker-icon">＋</span>

                  <span className="event-image-picker-copy">
                    <strong>Add event photos</strong>
                    <small>JPG, PNG or WebP · 5 MB each</small>
                  </span>

                  <span className="event-image-picker-action">
                    Browse
                  </span>
                </label>

                {!!previews.length && (
                  <div className="event-image-previews">
                    {newImages.map((file, index) => (
                      <div
                        className="event-image-preview"
                        key={`${file.name}-${file.lastModified}`}
                      >
                        <img
                          src={previews[index]}
                          alt={`New event photo ${index + 1}`}
                        />

                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          onClick={() =>
                            setNewImages((current) =>
                              current.filter((_, i) => i !== index),
                            )
                          }
                        >
                          ×
                        </button>

                        <small title={file.name}>
                          {file.name}
                        </small>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <label>
                Priority
                <select
                  name="priority"
                  defaultValue={str(d.priority) || 'medium'}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>

              <label>
                Status
                <select
                  name="status"
                  defaultValue={str(d.status) || 'active'}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </>
          )}

          <label>
            {module === 'events' ? 'Description' : 'Announcement'}
            <textarea
              name="description"
              rows={5}
              required
              maxLength={5000}
              defaultValue={
                str(d.description) ||
                str(d.content)
              }
            />
          </label>

          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}

          <div className="button-row">
            <button type="button" onClick={onClose}>
              Cancel
            </button>

            <button className="primary" type="submit">
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

function RecordDetails({
  s,
  module,
  row,
  onClose,
  onFacilitySaved,
  onPaymentRecorded,
  v2ProofResource,
  startEditing = false,
}: {
  s: Session;
  module: Module;
  row: Row;
  onClose: () => void;
  onFacilitySaved: () => void;
  onPaymentRecorded: () => void;
  v2ProofResource: Resource;
  startEditing?: boolean;
}) {
  const [editingFacility, setEditingFacility] = useState(
    module === 'facilities' && startEditing,
  );
  const [editingContent, setEditingContent] = useState(
    (module === 'events' || module === 'notices') && startEditing,
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [receipt, setReceipt] = useState('');
  useEffect(
    () => () => {
      if (receipt) URL.revokeObjectURL(receipt);
    },
    [receipt],
  );
  const d = row.data;

  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage('');
    try {
      await action();
      setMessage('Saved successfully.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'The action could not be completed.');
    } finally {
      setBusy(false);
    }
  }
  const pendingVisitor =
    ['pending', 'expected'].includes(status(d)) &&
    d.isApproved !== true &&
    d.actualArrival == null &&
    d.departure == null;
  if (
    (module === 'events' || module === 'notices') &&
    s.role === 'admin' &&
    editingContent
  )
    return (
      <ContentEditForm
        s={s}
        module={module}
        row={row}
        onClose={() => setEditingContent(false)}
        onSaved={onFacilitySaved}
      />
    );

  if (module === 'facilities' && s.role === 'admin' && editingFacility)
    return (
      <FacilityForm
        s={s}
        row={row}
        onClose={() => setEditingFacility(false)}
        onSaved={onFacilitySaved}
      />
    );
  return (
    <Modal
      title={module === 'payments' ? 'Payment details' : titleOf(d)}
      className={module === 'payments' ? 'payment-details-dialog' : undefined}
      onClose={onClose}
    >
      {module === 'events' ? (
        <EventDetailView data={d} title={titleOf(d)} />
      ) : module === 'payments' ? (
        <>
          <PaymentReviewSection
            data={d}
            paymentId={row.id}
            canReview={s.role === 'admin'}
            busy={busy}
            receipt={receipt}
            onViewReceipt={() =>
              void perform(async () => {
                const blob = await receiptBlob(s, str(d.receiptPath));
                setReceipt(URL.createObjectURL(blob));
              })
            }
            onVerify={() =>
              void perform(async () => {
                if (isV2PaymentProof(d)) {
                  if (!hasValidV2PaymentProof(d, row.id)) return;
                  await currentAuthority(s);
                  return call('verifyPaymentProofV2', { paymentId: row.id });
                }
                await currentAuthority(s);
                return call('verifyPaymentProof', { paymentId: row.id });
              })
            }
            onReject={(rejectionReason) =>
              void perform(async () => {
                if (isV2PaymentProof(d)) {
                  if (!hasValidV2PaymentProof(d, row.id) || !rejectionReason.trim()) return;
                  await currentAuthority(s);
                  return call('rejectPaymentProofV2', {
                    paymentId: row.id,
                    rejectionReason: rejectionReason.trim(),
                  });
                }
                await currentAuthority(s);
                return call('rejectPaymentProof', {
                  paymentId: row.id,
                  rejectionReason,
                });
              })
            }
          />
        </>
      ) : (
        <>
          {module === 'facilities' && (
            <FacilityGallery data={d} title={titleOf(d)} />
          )}
          <Pill value={moduleStatus(module, d)} />
          <DetailFields
            data={
              module === 'facilities'
                ? { ...d, status: undefined, pricePerDay: undefined }
                : module === 'billing' && isV2Bill(d)
                  ? { ...d, amount: undefined }
                  : d
            }
          />
          {module === 'billing' && isV2Bill(d) && (
            <>
              <V2BillFinancialSummary data={d} />
              {s.role === 'admin' && (
                <RecordOfflinePaymentV2Panel
                  session={s}
                  bill={row}
                  proofsLoading={v2ProofResource.loading}
                  proofsError={v2ProofResource.error}
                  hasPendingProof={v2ProofResource.rows.some(
                    (proof) =>
                      proof.data.schemaVersion === 2 &&
                      proof.data.billId === row.id &&
                      proof.data.status === 'pending',
                  )}
                  onRecorded={onPaymentRecorded}
                  onClose={onClose}
                />
              )}
            </>
          )}
          {module === 'billing' && !isV2Bill(d) && str(d.status).toLowerCase() === 'paid' && (
            <dl className="detail-fields payment-settlement-fields">
              <div>
                <dt>Payment status</dt>
                <dd>Paid</dd>
              </div>
              {str(d.paymentMethod) && (
                <div>
                  <dt>Paid via</dt>
                  <dd>{paymentMethodLabel(d.paymentMethod)}</dd>
                </div>
              )}
              {(str(d.paymentReference) || str(d.transactionId)) && (
                <div>
                  <dt>Payment reference</dt>
                  <dd>{str(d.paymentReference) || str(d.transactionId)}</dd>
                </div>
              )}
              <div>
                <dt>Paid on</dt>
                <dd>{dateLabel(d.paidAt)}</dd>
              </div>
              {paymentAttributionLabel(d.paymentMethod) && (
                <div>
                  <dt>Settlement</dt>
                  <dd>{paymentAttributionLabel(d.paymentMethod)}</dd>
                </div>
              )}
            </dl>
          )}
          {module === 'billing' && s.role === 'admin' && !isV2Bill(d) && (
            <RecordPaymentPanel session={s} bill={row} onRecorded={onPaymentRecorded} />
          )}
        </>
      )}
      {module === 'facilities' && (
        <>
          <dl className="detail-fields">
            <div>
              <dt>Facility type</dt>
              <dd>{str(d.type) || 'Unspecified'}</dd>
            </div>
            <div>
              <dt>Pricing</dt>
              <dd>
                {d.isFree === true
                  ? 'Free facility'
                  : typeof d.pricePerDay === 'number'
                    ? money(d.pricePerDay) + ' per day'
                    : 'Unspecified'}
              </dd>
            </div>
          </dl>
          {Array.isArray(d.timeSlots) && (
            <div>
              <strong>Time slots</strong>
              <ul>
                {d.timeSlots
                  .filter((slot): slot is string => typeof slot === 'string' && !!slot.trim())
                  .map((slot, index) => (
                    <li key={index}>{slot}</li>
                  ))}
              </ul>
            </div>
          )}
          {s.role === 'admin' && (
            <FacilityActions
              s={s}
              row={row}
              onEdit={() => setEditingFacility(true)}
              onSaved={onFacilitySaved}
            />
          )}
        </>
      )}
      {module === 'complaints' && (
        <ol className="timeline">
          <li>
            <strong>Request submitted</strong>
            <span>{dateLabel(d.createdAt)}</span>
          </li>
          {d.assignedTo != null && (
            <li>
              <strong>Assigned to {str(d.assignedTo)}</strong>
            </li>
          )}
          {d.progressUpdate != null && <li>{str(d.progressUpdate)}</li>}
          {d.resolvedAt != null && (
            <li>
              <strong>Resolved</strong>
              <span>{dateLabel(d.resolvedAt)}</span>
            </li>
          )}
        </ol>
      )}
      {safeUrl(d.fileUrl) && (
        <a
          className="outline-link"
          href={safeUrl(d.fileUrl)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Download size={17} />
          Open document
        </a>
      )}
      {module === 'buildings' && (
        <Link className="outline-link" to="/units" onClick={onClose}>
          View community units
        </Link>
      )}
      {module === 'facilities' && (
        <p>
          For new bookings, use the Resident mobile app. Your existing bookings are available on the
          Bookings page.
        </p>
      )}
      {module === 'residents' && s.role === 'admin' && <ResidentReview s={s} row={row} />}
      <div className="detail-actions">
        <fieldset disabled={busy}>
          {(module === 'events' || module === 'notices') &&
            s.role === 'admin' && (
              <button
                type="button"
                className="primary"
                onClick={() => setEditingContent(true)}
              >
                <Pencil size={16} />
                {module === 'events'
                  ? 'Edit Event'
                  : 'Edit Announcement'}
              </button>
            )}
          {module === 'notifications' && d.isRead !== true && (
            <button
              className="primary"
              onClick={() => void perform(() => updateScoped(s, 'notifications', row.id, {}))}
            >
              Mark as read
            </button>
          )}
          {module === 'complaints' && s.role === 'admin' && (
            <>
              <label>
                Update status
                <select
                  defaultValue={status(d)}
                  onChange={(e) =>
                    void perform(() =>
                      updateScoped(s, 'complaints', row.id, { status: e.target.value }),
                    )
                  }
                >
                  <option value="pending">Pending</option>
                  <option value="inprogress">In progress</option>
                  <option value="completed">Completed</option>
                </select>
              </label>
            </>
          )}
          {module === 'visitors' && s.role === 'admin' && pendingVisitor && (
            <div className="button-row">
              <button
                className="primary"
                onClick={() =>
                  void perform(() =>
                    updateScoped(s, 'visitors', row.id, {
                      isApproved: true,
                      approvedAt: serverTimestamp(),
                    }),
                  )
                }
              >
                Approve visitor
              </button>
              <button
                onClick={() =>
                  void perform(() =>
                    updateScoped(s, 'visitors', row.id, {
                      status: 'rejected',
                      isApproved: false,
                      rejectedBy: s.uid,
                      rejectedAt: serverTimestamp(),
                    }),
                  )
                }
              >
                Reject visitor
              </button>
            </div>
          )}
          {module === 'units' &&
            s.role === 'admin' &&
            status(d) === 'reserved' &&
            str(d.reservedOnboardingId) && (
              <button
                type="button"
                onClick={() => {
                  const residentName = str(d.reservedForName) || 'this resident';

                  const confirmed = window.confirm(
                    `Release reservation for ${residentName}?\n\n` +
                    `${str(d.flatLabel) || 'This unit'} will become vacant. ` +
                    `The resident onboarding will remain available for assignment to another unit.`,
                  );

                  if (!confirmed) return;

                  void perform(async () => {
                    await currentAuthority(s);

                    return call('cancelResidentOnboardingReservation', {
                      communityId: s.community!.id,
                      onboardingId: str(d.reservedOnboardingId),
                      buildingId: str(d.buildingId),
                      flatId: row.id,
                    });
                  });
                }}
                style={{
                  color: '#b91c1c',
                  borderColor: '#fca5a5',
                }}
              >
                Release Reservation
              </button>
            )}
          {module === 'residents' && s.role === 'admin' && (
            <button
              onClick={() =>
                void perform(() =>
                  residentLifecycle(
                    s,
                    row.id,
                    d.isActive === true ? 'deactivateResident' : 'reactivateResident',
                  ),
                )
              }
            >
              {d.isActive === true ? 'Deactivate resident' : 'Reactivate resident'}
            </button>
          )}

          {module === 'billing' && s.role === 'resident' && d.status === 'pending' && (
            <label>
              Upload payment proof
              <input
                type="file"
                accept="image/jpeg,image/png,image/heic,image/heif"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void perform(() => submitProof(s, row.id, file));
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </fieldset>
      </div>
      {message && (
        <p role="status" className="form-message">
          {message}
        </p>
      )}
    </Modal>
  );
}
export function ProfilePage({
  apartment = false,
  settings = false,
}: {
  apartment?: boolean;
  settings?: boolean;
}) {
  const { session: s, signOut } = useAuth();
  if (!s) return null;
  const title = settings ? 'Settings' : apartment ? 'My Apartment' : 'My Profile';
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Your Hominode account</p>
          <h1>{title}</h1>
          <p>{settings ? 'Your account and community preferences.' : 'A place to belong.'}</p>
        </div>
      </header>
      <div className="profile-grid">
        <Card>
          <div className="profile-heading">
            <span className="avatar large">{s.profile.name.slice(0, 2).toUpperCase()}</span>
            <h2>{s.profile.name}</h2>
            <p>{s.community?.name || 'Hominode platform'}</p>
            <Pill value="active" />
          </div>
          <DetailFields data={s.profile.data} />
        </Card>
        <Card title={apartment ? 'Your home' : 'Account access'}>
          {apartment && s.role === 'resident' ? (
            <ApartmentInfo s={s} />
          ) : (
            <>
              <p>You’re signed in with your verified phone number.</p>
              <p>{s.profile.phoneNumber}</p>
              <p>Contact your community administrator to update your registered account details.</p>
              <button onClick={() => void signOut()}>Sign out</button>
            </>
          )}
          {settings && (
            <div className="settings-note">
              <h3>Notifications</h3>
              <p>
                Your community updates are available in the notification center. Use the mobile app
                for push alerts.
              </p>
              <h3>Display</h3>
              <p>This portal follows your browser’s language and date preferences.</p>
            </div>
          )}
        </Card>
      </div>
      {settings && s.role === 'admin' && s.community && (
        <CommunityPaymentSettings session={s} />
      )}
    </>
  );
}
function ApartmentInfo({ s }: { s: Session }) {
  const unit = useRows(s, 'units');
  return (
    <State resource={unit} empty="Your unit details are not available.">
      {unit.rows.map((r) => (
        <DetailFields data={r.data} key={r.id} />
      ))}
      <Link className="outline-link" to={pageBase(s) + 'vehicles'}>
        My vehicles
      </Link>
    </State>
  );
}
export function CommunityPage() {
  const { session: s } = useAuth();
  if (!s?.community) return null;
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Connected living</p>
          <h1>{s.community.name}</h1>
          <p>Your community at a glance.</p>
        </div>
      </header>
      <div className="profile-grid">
        <section className="community-banner lifestyle">
          <h2>
            Better Community.
            <br />
            Happier Living.
          </h2>
          <span>HOMINODE</span>
        </section>
        <Card title="Community information">
          <DetailFields data={s.community.data} />
          <Link className="outline-link" to="/buildings">
            View buildings <ArrowRight size={17} />
          </Link>
        </Card>
      </div>
    </>
  );
}
export function ReportsPage() {
  const { session: s } = useAuth();
  return s ? <ReportData s={s} /> : null;
}
function ReportData({ s }: { s: Session }) {
  const bills = useRows(s, 'billing'),
    residents = useRows(s, 'residents'),
    visitors = useRows(s, 'visitors'),
    complaints = useRows(s, 'complaints'),
    deliveries = useRows(s, 'deliveries'),
    units = useRows(s, 'units'),
    bookings = useRows(s, 'bookings');

  const resources = [bills, residents, visitors, complaints, deliveries, units, bookings];
  const loading = resources.some((resource) => resource.loading);
  const hasError = resources.some((resource) => !!resource.error);

  const occupied = units.rows.filter((row) => status(row.data) === 'occupied').length;
  const vacant = units.rows.filter((row) => status(row.data) === 'vacant').length;
  const reserved = units.rows.filter((row) => status(row.data) === 'reserved').length;
  const maintenance = units.rows.filter((row) => status(row.data) === 'maintenance').length;
  const occupancyRate = units.rows.length ? Math.round((occupied / units.rows.length) * 100) : 0;

  const resolvedComplaints = complaints.rows.filter((row) =>
    ['resolved', 'closed', 'completed'].includes(status(row.data)),
  ).length;
  const activeComplaints = Math.max(0, complaints.rows.length - resolvedComplaints);

  const completedDeliveries = deliveries.rows.filter((row) =>
    ['collected', 'delivered', 'completed'].includes(status(row.data)),
  ).length;
  const activeDeliveries = Math.max(0, deliveries.rows.length - completedDeliveries);

  const records = [
    ['Residents', residents],
    ['Visitors', visitors],
    ['Deliveries', deliveries],
    ['Complaints', complaints],
    ['Bills', bills],
    ['Bookings', bookings],
  ] as const;
  const currentMonth = new Date();
  const [billingPeriod, setBillingPeriod] = useState(
    `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`,
  );
  const communityId = s.community?.id ?? '';
  const requestKey = `${communityId}:${billingPeriod}`;
  const requestId = useRef(0);
  const [financialState, setFinancialState] = useState<{
    key: string;
    loading: boolean;
    report: BillingV2FinancialReport | null;
    error: boolean;
  }>({ key: '', loading: true, report: null, error: false });

  useEffect(() => {
    const id = ++requestId.current;
    setFinancialState({ key: requestKey, loading: true, report: null, error: false });
    if (!communityId) {
      setFinancialState({ key: requestKey, loading: false, report: null, error: true });
      return;
    }
    void getBillingV2FinancialReport(s, billingPeriod).then(
      (report) => {
        if (requestId.current === id) {
          setFinancialState({ key: requestKey, loading: false, report, error: false });
        }
      },
      () => {
        if (requestId.current === id) {
          setFinancialState({ key: requestKey, loading: false, report: null, error: true });
        }
      },
    );
    return () => {
      if (requestId.current === id) requestId.current += 1;
    };
  }, [s, communityId, billingPeriod, requestKey]);

  const visibleFinancialState =
    financialState.key === requestKey
      ? financialState
      : { key: requestKey, loading: true, report: null, error: false };
  function exportFinancialReport(report: BillingV2FinancialReport) {
    const rows: Array<[string, string | number]> = [
      ['community id', report.communityId],
      ['community name', s.community?.name ?? ''],
      ['billing period', report.billingPeriod],
      ['generated timestamp', new Date(report.generatedAtMs).toISOString()],
      ['total billed minor', report.liabilitySummary.billedMinor],
      ['paid allocations minor', report.liabilitySummary.paidAllocationMinor],
      ['credit applied minor', report.liabilitySummary.creditAppliedMinor],
      ['outstanding minor', report.liabilitySummary.outstandingMinor],
      ['overdue outstanding minor', report.liabilitySummary.overdueOutstandingMinor],
      ['pending count', report.liabilitySummary.statusCounts.pending],
      ['partially paid count', report.liabilitySummary.statusCounts.partially_paid],
      ['paid count', report.liabilitySummary.statusCounts.paid],
      ['overdue count', report.liabilitySummary.statusCounts.overdue],
      ['collections received minor', report.collectionActivity.totalReceivedMinor],
      ['transaction count', report.collectionActivity.transactionCount],
      ['upi count', report.collectionActivity.methods.upi.count],
      ['upi amount minor', report.collectionActivity.methods.upi.totalMinor],
      ['cash count', report.collectionActivity.methods.cash.count],
      ['cash amount minor', report.collectionActivity.methods.cash.totalMinor],
      ['bank transfer count', report.collectionActivity.methods.bank_transfer.count],
      ['bank transfer amount minor', report.collectionActivity.methods.bank_transfer.totalMinor],
      ['cheque count', report.collectionActivity.methods.cheque.count],
      ['cheque amount minor', report.collectionActivity.methods.cheque.totalMinor],
      ['credit accounts count', report.creditPosition.accountsCount],
      ['residents with available credit', report.creditPosition.residentsWithCreditCount],
      ['total available resident credit minor', report.creditPosition.totalAvailableCreditMinor],
    ];
    const escapeCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const csv = `Metric,Value\r\n${rows.map(([name, value]) => `${escapeCell(name)},${escapeCell(value)}`).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `billing-v2-financial-report-${report.billingPeriod}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function exportReport() {
    const rows: [string, number][] = [
      ...records.map(([name, resource]): [string, number] => [name, resource.rows.length]),
      ['Resolved complaints', resolvedComplaints],
      ['Active complaints', activeComplaints],
      ['Units', units.rows.length],
      ['Occupied units', occupied],
      ['Vacant units', vacant],
      ['Reserved units', reserved],
      ['Maintenance units', maintenance],
      ['Occupancy rate (%)', occupancyRate],
      ['Completed deliveries', completedDeliveries],
      ['Active deliveries', activeDeliveries],
    ];
    const csv = 'Metric,Count\r\n' + rows.map(([name, value]) => name + ',' + value).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'community-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <section className="financial-report" aria-labelledby="financial-report-title">
        <header className="financial-report-header">
          <div>
            <p className="eyebrow">Community finance</p>
            <h1 id="financial-report-title">Financial Reports</h1>
            <p>Billing, collections and payment insights for your community.</p>
          </div>
          <div className="financial-report-actions">
            <label className="financial-report-period">
              <span>Current Billing period</span>
              <input
                aria-label="Billing period"
                type="month"
                value={billingPeriod}
                onChange={(event) => setBillingPeriod(event.target.value)}
              />
            </label>
            <button
              className="outline-link financial-report-export"
              disabled={
                visibleFinancialState.loading ||
                visibleFinancialState.error ||
                !visibleFinancialState.report
              }
              onClick={() =>
                visibleFinancialState.report && exportFinancialReport(visibleFinancialState.report)
              }
            >
              <Download size={18} />
              Export financial CSV
            </button>
          </div>
        </header>
        {visibleFinancialState.loading ? (
          <div className="financial-report-state" role="status">
            <span className="financial-report-spinner" aria-hidden="true" />
            <span>Loading financial report…</span>
          </div>
        ) : visibleFinancialState.error || !visibleFinancialState.report ? (
          <div className="financial-report-error" role="alert">
            <h2>Financial report unavailable</h2>
            <p>Financial report is unavailable. Please try again later.</p>
          </div>
        ) : (
          <FinancialReportDashboard report={visibleFinancialState.report} />
        )}
      </section>
      <section className="community-overview" aria-labelledby="community-overview-title">
        <header className="community-overview-header">
          <div>
            <h2 id="community-overview-title">Community overview</h2>
            <p>Operational and occupancy indicators from current community records.</p>
          </div>
          <button className="primary" disabled={loading || hasError} onClick={exportReport}>
            <Download size={18} />
            Export summary
          </button>
        </header>
        <div className="report-grid report-summary-grid">
          {records.map(([title, r]) => (
            <Card title={title} key={title} className="community-overview-card">
              {r.loading ? (
                <p role="status">Loading…</p>
              ) : r.error ? (
                <p role="alert">{r.error}</p>
              ) : (
                <strong className="report-number">{r.rows.length}</strong>
              )}
            </Card>
          ))}
        </div>
        <div className="report-analytics-grid">
          <Card title="Community Occupancy">
            {units.loading ? (
              <p role="status">Loading occupancy…</p>
            ) : units.error ? (
              <p role="alert">{units.error}</p>
            ) : (
              <div className="report-kpi-list">
                <div>
                  <span>Total units</span>
                  <strong>{units.rows.length}</strong>
                </div>
                <div>
                  <span>Occupied</span>
                  <strong>{occupied}</strong>
                </div>
                <div>
                  <span>Vacant</span>
                  <strong>{vacant}</strong>
                </div>
                <div>
                  <span>Reserved</span>
                  <strong>{reserved}</strong>
                </div>
                <div>
                  <span>Maintenance</span>
                  <strong>{maintenance}</strong>
                </div>
                <div className="report-highlight">
                  <span>Occupancy rate</span>
                  <strong>{occupancyRate}%</strong>
                </div>
              </div>
            )}
          </Card>

          <Card title="Complaint resolution">
            {complaints.loading ? (
              <p role="status">Loading complaint analytics…</p>
            ) : complaints.error ? (
              <p role="alert">{complaints.error}</p>
            ) : (
              <div className="report-kpi-list">
                <div>
                  <span>Total complaints</span>
                  <strong>{complaints.rows.length}</strong>
                </div>
                <div>
                  <span>Resolved / closed</span>
                  <strong>{resolvedComplaints}</strong>
                </div>
                <div>
                  <span>Active</span>
                  <strong>{activeComplaints}</strong>
                </div>
                <div className="report-highlight">
                  <span>Resolution rate</span>
                  <strong>
                    {complaints.rows.length
                      ? Math.round((resolvedComplaints / complaints.rows.length) * 100)
                      : 0}
                    %
                  </strong>
                </div>
              </div>
            )}
          </Card>

          <Card title="Delivery activity">
            {deliveries.loading ? (
              <p role="status">Loading delivery analytics…</p>
            ) : deliveries.error ? (
              <p role="alert">{deliveries.error}</p>
            ) : (
              <div className="report-kpi-list">
                <div>
                  <span>Total parcel records</span>
                  <strong>{deliveries.rows.length}</strong>
                </div>
                <div>
                  <span>Completed / collected</span>
                  <strong>{completedDeliveries}</strong>
                </div>
                <div>
                  <span>Active</span>
                  <strong>{activeDeliveries}</strong>
                </div>
              </div>
            )}
          </Card>
        </div>

        {hasError && !loading && (
          <p className="report-note" role="status">
            Some analytics are unavailable because one or more data sources could not be loaded.
          </p>
        )}
      </section>
    </>
  );
}

function FinancialReportDashboard({ report }: { report: BillingV2FinancialReport }) {
  const statuses = [
    ['Paid', report.liabilitySummary.statusCounts.paid],
    ['Pending', report.liabilitySummary.statusCounts.pending],
    ['Partially paid', report.liabilitySummary.statusCounts.partially_paid],
    ['Overdue', report.liabilitySummary.statusCounts.overdue],
  ] as const;
  const methods = [
    ['UPI', report.collectionActivity.methods.upi],
    ['Cash', report.collectionActivity.methods.cash],
    ['Bank transfer', report.collectionActivity.methods.bank_transfer],
    ['Cheque', report.collectionActivity.methods.cheque],
  ] as const;
  const largestStatusCount = Math.max(0, ...statuses.map(([, count]) => count));
  const totalReceivedMinor = report.collectionActivity.totalReceivedMinor;

  return (
    <div className="financial-report-content">
      <div className="financial-report-kpis" aria-label="Financial highlights">
        <article className="financial-report-kpi">
          <span>Total billed</span>
          <strong>{formatInrMinorUnits(report.liabilitySummary.billedMinor)}</strong>
        </article>
        <article className="financial-report-kpi">
          <span>Collections received</span>
          <strong>{formatInrMinorUnits(totalReceivedMinor)}</strong>
        </article>
        <article className="financial-report-kpi">
          <span>Outstanding</span>
          <strong>{formatInrMinorUnits(report.liabilitySummary.outstandingMinor)}</strong>
        </article>
        <article className="financial-report-kpi">
          <span>Available credit</span>
          <strong>{formatInrMinorUnits(report.creditPosition.totalAvailableCreditMinor)}</strong>
        </article>
      </div>

      <div className="financial-report-primary-grid">
        <section className="financial-report-card" aria-labelledby="financial-bill-status-title">
          <header className="financial-report-card-header">
            <div>
              <p className="eyebrow">Liability</p>
              <h2 id="financial-bill-status-title">Bill status</h2>
            </div>
            <span className="financial-report-card-note">
              {report.liabilitySummary.billsCount} bills
            </span>
          </header>
          <div className="financial-report-status-list">
            {statuses.map(([label, count]) => (
              <div className="financial-report-status-row" key={label}>
                <div className="financial-report-row-label">
                  <strong>{label}</strong>
                  <span>{count}</span>
                </div>
                <div className="financial-report-track" aria-hidden="true">
                  <span
                    className={`financial-report-status-fill status-${label.toLowerCase().replace(' ', '-')}`}
                    style={{
                      width:
                        largestStatusCount === 0
                          ? '0%'
                          : `${(count / largestStatusCount) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="financial-report-card" aria-labelledby="financial-payment-methods-title">
          <header className="financial-report-card-header">
            <div>
              <p className="eyebrow">Collections</p>
              <h2 id="financial-payment-methods-title">Payment methods</h2>
            </div>
            <span className="financial-report-card-note">
              {formatInrMinorUnits(totalReceivedMinor)} received
            </span>
          </header>
          <div className="financial-report-method-list">
            {methods.map(([label, method]) => (
              <div className="financial-report-method-row" key={label}>
                <div className="financial-report-row-label">
                  <strong>{label}</strong>
                  <span>
                    {method.count} {method.count === 1 ? 'transaction' : 'transactions'}
                  </span>
                </div>
                <strong className="financial-report-method-total">
                  {formatInrMinorUnits(method.totalMinor)}
                </strong>
                <div className="financial-report-track" aria-hidden="true">
                  <span
                    className="financial-report-method-fill"
                    style={{
                      width:
                        totalReceivedMinor === 0
                          ? '0%'
                          : `${Math.min((method.totalMinor / totalReceivedMinor) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="financial-report-card financial-summary-card" aria-labelledby="financial-summary-title">
        <header className="financial-report-card-header">
          <div>
            <p className="eyebrow">At a glance</p>
            <h2 id="financial-summary-title">Financial Summary</h2>
          </div>
        </header>
        <div className="financial-summary-groups">
          <section>
            <h3>Liability / settlement</h3>
            <dl>
              <div>
                <dt>Paid allocations</dt>
                <dd>{formatInrMinorUnits(report.liabilitySummary.paidAllocationMinor)}</dd>
              </div>
              <div>
                <dt>Credit applied</dt>
                <dd>{formatInrMinorUnits(report.liabilitySummary.creditAppliedMinor)}</dd>
              </div>
              <div>
                <dt>Overdue outstanding</dt>
                <dd>{formatInrMinorUnits(report.liabilitySummary.overdueOutstandingMinor)}</dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>Activity</h3>
            <dl>
              <div>
                <dt>Transaction count</dt>
                <dd>{report.collectionActivity.transactionCount}</dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>Credit position</h3>
            <dl>
              <div>
                <dt>Accounts count</dt>
                <dd>{report.creditPosition.accountsCount}</dd>
              </div>
              <div>
                <dt>Residents with available credit</dt>
                <dd>{report.creditPosition.residentsWithCreditCount}</dd>
              </div>
            </dl>
          </section>
        </div>
      </section>
    </div>
  );
}
export function UnsupportedPage({ title, message }: { title: string; message: string }) {
  return (
    <>
      <header className="page-header">
        <h1>{title}</h1>
      </header>
      <Card>
        <p>{message}</p>
      </Card>
    </>
  );
}
