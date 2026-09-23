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
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  createComplaint,
  createEvent,
  uploadEventImages,
  createVisitor,
  currentAuthority,
  publishNotice,
  receiptBlob,
  residentLifecycle,
  submitProof,
  updateScoped,
} from './actions';
import { AdminCreateButtons, ResidentReview } from './AdminTools';
import { BillingCreateModal } from './BillingCreateModal';
import { Card, Modal, Pill, State } from './components';
import { PhoneNumberInput } from './components/PhoneNumberInput';
import { safeUrl, titleOf, useRows, type Module } from './data';
import { FacilityActions, FacilityForm } from './FacilityForm';
import { call } from './firebase';
import {
  amount,
  dateLabel,
  first,
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
  payments: 'Payment Proofs',
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
const descriptions: Partial<Record<Module, string>> = {
  residents: 'The people who make your community home.',
  visitors: 'A warm welcome, with peace of mind.',
  complaints: 'Follow every request from report to resolution.',
  facilities: 'Spaces to connect, unwind and enjoy.',
  billing: 'A clear view of your community payments.',
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
  const rows = resource.rows
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
  const selected = resource.rows.find((r) => r.id === params.get('record'));
  const create = params.get('create') === '1' && canCreate(s, module);
  const statuses =
    module === 'facilities'
      ? ['Active', 'Maintenance', 'Inactive']
      : [...new Set(resource.rows.map((r) => status(r.data)).filter(Boolean))];
  const pageCount = Math.max(1, Math.ceil(rows.length / 12));
  const currentPage = Math.min(page, pageCount - 1);
  function close() {
    setParams((p) => {
      p.delete('record');
      p.delete('create');
      p.delete('edit');
      return p;
    });
  }
  function facilitySaved() {
    close();
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
              Payment proofs <ArrowRight size={16} />
            </Link>
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
            <strong>{resource.loading ? '…' : resource.error ? '—' : resource.rows.length}</strong>{' '}
            Total {title.toLowerCase()}
          </span>
          <span>
            <strong>
              {resource.loading
                ? '…'
                : resource.error
                  ? '—'
                  : resource.rows.filter((r) =>
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
        <State resource={resource} empty={'No ' + title.toLowerCase() + ' to display yet.'}>
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
                      {module === 'residents'
                        ? 'Resident'
                        : module === 'visitors'
                          ? 'Visitor'
                          : 'Name / Reference'}
                    </th>
                    <th scope="col">
                      {['billing', 'payments'].includes(module) ? 'Amount' : 'Details'}
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">Last updated</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(currentPage * 12, currentPage * 12 + 12).map((row) => (
                    <tr key={row.id}>
                      <th scope="row">
                        <strong>{titleOf(row.data)}</strong>
                        <small>
                          {first(row.data, ['phoneNumber', 'email', 'flatLabel'], row.id)}
                        </small>
                      </th>
                      <td>
                        {['billing', 'payments'].includes(module)
                          ? money(amount(row.data))
                          : first(
                              row.data,
                              ['flatLabel', 'description', 'purpose', 'role', 'category'],
                              '—',
                            )}
                      </td>
                      <td>
                        <Pill value={moduleStatus(module, row.data)} />
                      </td>
                      <td>{dateLabel(row.data.updatedAt ?? row.data.createdAt)}</td>
                      <td>
                        <button
                          className="text-button"
                          aria-label={'View ' + titleOf(row.data)}
                          onClick={() => setParams({ record: row.id })}
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
      {params.has('record') && !selected && !resource.loading && !resource.error && (
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
          startEditing={params.get('edit') === '1'}
        />
      )}{' '}
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
function RecordDetails({
  s,
  module,
  row,
  onClose,
  onFacilitySaved,
  startEditing = false,
}: {
  s: Session;
  module: Module;
  row: Row;
  onClose: () => void;
  onFacilitySaved: () => void;
  startEditing?: boolean;
}) {
  const [editingFacility, setEditingFacility] = useState(startEditing);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [reason, setReason] = useState(''),
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
    <Modal title={titleOf(d)} onClose={onClose}>
      {(module === 'facilities' || module === 'events') && (
        <FacilityGallery data={d} title={titleOf(d)} />
      )}
      <Pill value={moduleStatus(module, d)} />
      <DetailFields
        data={module === 'facilities' ? { ...d, status: undefined, pricePerDay: undefined } : d}
      />
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
          {module === 'payments' && str(d.receiptPath) && (
            <button
              onClick={() =>
                void perform(async () => {
                  const blob = await receiptBlob(s, str(d.receiptPath));
                  setReceipt(URL.createObjectURL(blob));
                })
              }
            >
              View receipt
            </button>
          )}
          {receipt && <img className="receipt-image" src={receipt} alt="Payment receipt" />}
          {module === 'payments' && s.role === 'admin' && d.status === 'pending' && (
            <>
              <button
                className="primary"
                onClick={() =>
                  void perform(async () => {
                    await currentAuthority(s);
                    return call('verifyPaymentProof', { paymentId: row.id });
                  })
                }
              >
                Verify payment
              </button>
              <label>
                Rejection reason
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <button
                disabled={!reason.trim() || busy}
                onClick={() =>
                  void perform(async () => {
                    await currentAuthority(s);
                    return call('rejectPaymentProof', {
                      paymentId: row.id,
                      rejectionReason: reason.trim(),
                    });
                  })
                }
              >
                Reject proof
              </button>
            </>
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
    complaints = useRows(s, 'complaints');
  const records = [
    ['Residents', residents],
    ['Visitors', visitors],
    ['Complaints', complaints],
    ['Bills', bills],
  ] as const;
  function exportReport() {
    const csv =
      'Metric,Count\r\n' + records.map(([name, r]) => name + ',' + r.rows.length).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'community-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Community intelligence</p>
          <h1>Reports</h1>
          <p>Current community totals from your operational records.</p>
        </div>
        <button
          className="primary"
          disabled={records.some(([, r]) => r.loading || !!r.error)}
          onClick={exportReport}
        >
          <Download size={18} />
          Export summary
        </button>
      </header>
      <div className="report-grid">
        {records.map(([title, r]) => (
          <Card title={title} key={title}>
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
    </>
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
